import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { COLORS, SPACING } from '@/constants/theme';
import type { AvailableSlot, ParkingFloor } from '@/types/booking.types';
import type { SubscriptionSlotSelection } from '@/types/subscription.types';
import {
  isParkingSlotSelectable,
  isVipParkingSlotLayoutName,
  type ParkingSlotVisualStatus,
  resolveParkingSlotStatus,
} from '@/utils/parkingSlotStatus';

export interface ParkingSlotInspection {
  slotCode: string;
  status: ParkingSlotVisualStatus;
  dbSlot?: {
    _id?: string;
    slotNumber?: string;
    status?: string;
    slotType?: string;
    reservedFor?: unknown;
    subscriptionType?: string | null;
    subscriptionDetail?: {
      expireAt?: string;
      user?: {
        username?: string;
        email?: string;
        phone?: string;
      } | null;
      ticketPackage?: {
        name?: string;
        type?: string;
      } | null;
    } | null;
    zoneID?: {
      zoneName?: string;
      zoneType?: string;
    } | string;
  };
  session?: {
    licensePlate?: string;
    phone?: string;
    vehicleType?: string;
    checkInTime?: string;
    expectedDurationHours?: number;
    userId?: {
      email?: string;
      username?: string;
    } | string;
  };
}

interface ParkingMap2DProps {
  floor: ParkingFloor;
  floorSlots: AvailableSlot[];
  selectedSlot: AvailableSlot | null;
  onSelectSlot: (slot: AvailableSlot | null) => void;
  dbSlots?: any[] | null;
  activeSessions?: any[];
  activeHolds?: any[];
  selectionMode?: 'booking' | 'membership';
  selectedSlots?: SubscriptionSlotSelection[];
  onToggleSlot?: (slot: SubscriptionSlotSelection) => void;
  interactionMode?: 'selection' | 'monitor';
  inspectedSlotCode?: string | null;
  onInspectSlot?: (slot: ParkingSlotInspection) => void;
}

const SLOT_STATUS_COLOR: Record<string, string> = {
  available: '#7EE8A2',
  occupied: '#FF6B6B',
  booked: COLORS.staffBlue,
  reserved: '#FFD700', // Gold
  held: '#FFA500', // Orange
  maintenance: '#A0A0A0',
};

export const ParkingMap2D = ({
  floor,
  floorSlots,
  selectedSlot,
  onSelectSlot,
  dbSlots = [],
  activeSessions = [],
  activeHolds = [],
  selectionMode = 'booking',
  selectedSlots = [],
  onToggleSlot,
  interactionMode = 'selection',
  inspectedSlotCode = null,
  onInspectSlot,
}: ParkingMap2DProps) => {
  const { width: windowWidth } = useWindowDimensions();
  const [viewportWidth, setViewportWidth] = useState(0);

  // Parse layout data safely
  const layout = useMemo(() => {
    let parsedLayout = { width: 1000, height: 600, elements: [] as any[] };
    try {
      if (typeof floor.layoutData === 'string') {
        parsedLayout = JSON.parse(floor.layoutData);
      } else if (floor.layoutData) {
        parsedLayout = floor.layoutData;
      } else if (floor.layout) {
        parsedLayout = floor.layout as any;
      }
    } catch (e) {
      console.warn('Failed to parse layout data', e);
    }
    parsedLayout.elements = Array.isArray(parsedLayout.elements) ? parsedLayout.elements : [];
    return parsedLayout;
  }, [floor.layout, floor.layoutData]);

  // Create lookup for slots by name
  const slotLookup = useMemo(() => {
    const lookup: Record<string, AvailableSlot> = {};
    floorSlots.forEach((slot) => {
      // Assuming slotCode maps to the element name in layout
      if (slot.slotCode) {
        lookup[slot.slotCode.toUpperCase()] = slot;
      }
    });
    return lookup;
  }, [floorSlots]);

  const mapWidth = useMemo(
    () => Math.max(
      Number(layout.width) || 1000,
      ...layout.elements.map((element: any) => (Number(element.x) || 0) + (Number(element.w) || 0)),
    ),
    [layout.elements, layout.width],
  );
  const mapHeight = useMemo(
    () => Math.max(
      Number(layout.height) || 600,
      ...layout.elements.map((element: any) => (Number(element.y) || 0) + (Number(element.h) || 0)),
    ),
    [layout.elements, layout.height],
  );
  const availableWidth = viewportWidth || Math.max(1, windowWidth - SPACING.lg * 2);
  const scale = Math.min(1, availableWidth / mapWidth);
  const renderedWidth = mapWidth * scale;
  const renderedHeight = mapHeight * scale;
  const mapLeft = (availableWidth - renderedWidth) / 2 - (mapWidth - renderedWidth) / 2;
  const mapTop = -(mapHeight - renderedHeight) / 2;

  const handleViewportLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    if (nextWidth > 0) setViewportWidth((current) => current === nextWidth ? current : nextWidth);
  }, []);

  const floorId = String(floor._id ?? floor.id ?? floor.floorNumber);
  const getSlotInteractionState = useCallback((slotName: string) => {
    const normalizedSlotName = slotName.toUpperCase();
    const isVipLayoutSlot = isVipParkingSlotLayoutName(slotName);
    const bookingSlotData = slotLookup[normalizedSlotName];
    const dbSlot = dbSlots?.find(
      (slot: any) => String(slot.slotNumber ?? '').toUpperCase() === normalizedSlotName,
    );
    const isHeld = activeHolds.some((hold: any) => {
      const holdFloorId = String(hold.floorId?._id ?? hold.floorId ?? '');
      const holdSlotCode = String(hold.slotCode ?? hold.parkingSlot ?? '').toUpperCase();
      return holdFloorId === floorId && holdSlotCode === normalizedSlotName;
    });
    const isOccupied = activeSessions.some((session: any) => {
      const sessionFloorId = String(session.floorId?._id ?? session.floorId ?? '');
      const sessionSlotCode = String(session.slotCode ?? session.parkingSlot ?? '').toUpperCase();
      return sessionFloorId === floorId && sessionSlotCode === normalizedSlotName;
    });
    const activeSession = activeSessions.find((session: any) => {
      const sessionFloorId = String(session.floorId?._id ?? session.floorId ?? '');
      const sessionSlotCode = String(session.slotCode ?? session.parkingSlot ?? '').toUpperCase();
      return sessionFloorId === floorId && sessionSlotCode === normalizedSlotName;
    });
    const isMembershipMode = selectionMode === 'membership';
    const isDbOccupied = dbSlot?.status === 'occupied'
      || (interactionMode !== 'monitor' && dbSlot?.status === 'booked');
    const slotData = isMembershipMode && dbSlot
      ? {
          id: String(dbSlot._id ?? `${floorId}-${normalizedSlotName}`),
          slotCode: String(dbSlot.slotNumber ?? normalizedSlotName),
          floorId,
          status: dbSlot.status ?? 'available',
        } as AvailableSlot
      : bookingSlotData;
    const status = resolveParkingSlotStatus({
      hasAvailableSlot: interactionMode === 'monitor'
        ? true
        : isMembershipMode
          ? Boolean(dbSlot)
          : Boolean(bookingSlotData),
      isMaintenance: dbSlot?.status === 'maintenance',
      isOccupied: isOccupied || isDbOccupied,
      isHeld,
      isReserved:
        dbSlot?.status === 'booked'
        || Boolean(dbSlot?.subscriptionType)
        || (isMembershipMode ? false : isVipLayoutSlot)
        || Boolean(dbSlot?.reservedFor),
    });

    return {
      activeSession,
      dbSlot,
      slotData,
      status,
      isSelectable: interactionMode === 'monitor'
        ? true
        : isParkingSlotSelectable(status, Boolean(slotData)),
    };
  }, [activeHolds, activeSessions, dbSlots, floorId, interactionMode, selectionMode, slotLookup]);

  useEffect(() => {
    if (selectionMode === 'membership' || !selectedSlot || String(selectedSlot.floorId) !== floorId) return;
    const selectedLayoutElement = layout.elements.find(
      (element: any) => element.type?.startsWith('slot')
        && String(element.name ?? '').toUpperCase() === selectedSlot.slotCode.toUpperCase(),
    );
    const { isSelectable } = getSlotInteractionState(
      selectedLayoutElement?.name ?? selectedSlot.slotCode,
    );
    if (!isSelectable) onSelectSlot(null);
  }, [floorId, getSlotInteractionState, layout.elements, onSelectSlot, selectedSlot, selectionMode]);

  useEffect(() => {
    if (interactionMode !== 'monitor' || !inspectedSlotCode || !onInspectSlot) return;
    const {
      activeSession,
      dbSlot,
      status,
    } = getSlotInteractionState(inspectedSlotCode);
    onInspectSlot({
      slotCode: inspectedSlotCode.toUpperCase(),
      status,
      dbSlot,
      session: activeSession,
    });
  }, [
    getSlotInteractionState,
    inspectedSlotCode,
    interactionMode,
    onInspectSlot,
  ]);

  const renderElement = (el: any) => {
    const isSlot = el.type && el.type.startsWith('slot');
    const hasName = !!el.name && el.name.trim() !== '';

    const baseStyle = {
      position: 'absolute' as const,
      left: Number(el.x) || 0,
      top: Number(el.y) || 0,
      width: Number(el.w) || 0,
      height: Number(el.h) || 0,
      transform: [{ rotate: `${el.rot || 0}deg` }],
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    };

    if (isSlot) {
      if (!hasName) return null; // Ignore slots without names

      const layoutSlotName = String(el.name);
      const slotName = layoutSlotName.toUpperCase();
      const { activeSession, dbSlot, slotData, status, isSelectable } = getSlotInteractionState(layoutSlotName);
      const isSelected = selectionMode === 'membership'
        ? selectedSlots.some((slot) => String(slot.floorId) === floorId && slot.slotCode.toUpperCase() === slotName)
        : interactionMode === 'monitor'
          ? inspectedSlotCode?.toUpperCase() === slotName
          : selectedSlot?.slotCode?.toUpperCase() === slotName && String(selectedSlot?.floorId) === floorId;

      const color = isSelected ? COLORS.staffBlue : SLOT_STATUS_COLOR[status] || COLORS.textMuted;
      const bgColor = isSelected ? 'rgba(96,180,255,0.2)' : `${color}18`;

      return (
        <Pressable
          key={el.id}
          style={[
            baseStyle,
            styles.slotBox,
            {
              backgroundColor: bgColor,
              borderColor: color,
            },
          ]}
          disabled={!isSelectable}
          accessibilityLabel={`${slotName}, ${status}`}
          accessibilityRole="button"
          accessibilityState={{ disabled: !isSelectable, selected: isSelected }}
          onPress={() => {
            if (!isSelectable) return;
            if (interactionMode === 'monitor') {
              onInspectSlot?.({
                slotCode: slotName,
                status,
                dbSlot,
                session: activeSession,
              });
              return;
            }
            if (!slotData) return;
            if (selectionMode === 'membership') {
              onToggleSlot?.({ floorId, slotCode: slotData.slotCode || slotName });
            } else {
              onSelectSlot(isSelected ? null : slotData);
            }
          }}
        >
          {status === 'held' || status === 'reserved' ? (
            <Ionicons name="lock-closed" size={el.w < 40 ? 12 : 18} color={color} />
          ) : status === 'maintenance' ? (
            <Ionicons name="construct" size={el.w < 40 ? 12 : 18} color={color} />
          ) : (
            <Ionicons name={status === 'occupied' ? 'car' : 'car-outline'} size={el.w < 40 ? 14 : 20} color={color} />
          )}
          <Text style={[styles.slotBoxText, { color, fontSize: el.w < 40 ? 8 : 10 }]}>{el.name}</Text>
        </Pressable>
      );
    }

    if (el.type === 'zone') {
      const themeColor = el.color || 'purple';
      const borderColors: Record<string, string> = { purple: '#a855f7', emerald: '#10b981', blue: '#3b82f6', amber: '#f59e0b' };
      const bgColors: Record<string, string> = { purple: 'rgba(168,85,247,0.1)', emerald: 'rgba(16,185,129,0.1)', blue: 'rgba(59,130,246,0.1)', amber: 'rgba(245,158,11,0.1)' };
      const color = borderColors[themeColor] || '#a855f7';

      return (
        <View key={el.id} style={[baseStyle, { backgroundColor: bgColors[themeColor] || 'rgba(168,85,247,0.1)', borderColor: color, borderWidth: 2, borderRadius: 12 }]} pointerEvents="none">
          {hasName && (
            <View style={{ position: 'absolute', top: -16, left: 16, backgroundColor: 'white', borderColor: color, borderWidth: 2, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' }}>{el.name}</Text>
            </View>
          )}
        </View>
      );
    }

    if (el.type === 'wall') {
      return (
        <View
          key={el.id}
          style={[baseStyle, { backgroundColor: '#475569', borderColor: '#334155', borderWidth: 2, borderRadius: 4 }]}
          pointerEvents="none"
        />
      );
    }

    if (el.type === 'door' || el.type === 'entry') {
      return (
        <View key={el.id} style={[baseStyle, { backgroundColor: 'rgba(52,211,153,0.2)', borderColor: 'rgba(52,211,153,0.5)', borderWidth: 1, borderRadius: 2 }]} pointerEvents="none">
          <Text style={{ color: '#34d399', fontSize: 8, fontWeight: 'bold', letterSpacing: 2 }}>ENTRANCE</Text>
        </View>
      );
    }

    if (el.type === 'exit') {
      return (
        <View key={el.id} style={[baseStyle, { backgroundColor: 'rgba(248,113,113,0.2)', borderColor: 'rgba(248,113,113,0.5)', borderWidth: 1, borderRadius: 2 }]} pointerEvents="none">
          <Text style={{ color: '#f87171', fontSize: 8, fontWeight: 'bold', letterSpacing: 2 }}>EXIT</Text>
        </View>
      );
    }

    if (el.type === 'gate') {
      return (
        <View key={el.id} style={[baseStyle, { backgroundColor: '#dcfce7', borderColor: '#22c55e', borderWidth: 2, borderRadius: 4 }]} pointerEvents="none">
          <Text style={{ color: '#15803d', fontSize: 10, fontWeight: '900', letterSpacing: 1 }}>{el.name || 'GATE'}</Text>
        </View>
      );
    }

    if (el.type === 'road') {
      return (
        <View key={el.id} style={[baseStyle, { opacity: 0.6, flexDirection: 'row', gap: 8 }]} pointerEvents="none">
          <Ionicons name="arrow-forward" size={24} color="#f59e0b" />
          <Text style={{ color: '#f59e0b', fontSize: 18, fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase' }}>{el.name}</Text>
        </View>
      );
    }

    if (el.type === 'pillar') {
      return (
        <View key={el.id} style={[baseStyle, { backgroundColor: '#cbd5e1', borderColor: '#94a3b8', borderWidth: 2, borderRadius: 2 }]} pointerEvents="none">
          <Text style={{ color: '#475569', fontSize: 10, fontWeight: 'bold' }}>{el.name}</Text>
        </View>
      );
    }

    if (el.type === 'elevator') {
      return (
        <View key={el.id} style={[baseStyle, { backgroundColor: '#f8fafc', borderColor: '#cbd5e1', borderWidth: 4, borderStyle: 'dotted', borderRadius: 4 }]} pointerEvents="none">
          <Ionicons name="layers-outline" size={20} color="#94a3b8" />
          <Text style={{ color: '#64748b', fontSize: 10, fontWeight: 'bold' }}>{el.name}</Text>
        </View>
      );
    }
    
    if (el.type === 'sign') {
      return (
        <View key={el.id} style={[baseStyle, { justifyContent: 'center', alignItems: 'center' }]} pointerEvents="none">
          <View style={{ backgroundColor: '#ef4444', width: '100%', height: '100%', borderRadius: 100, borderColor: 'white', borderWidth: 3, justifyContent: 'center', alignItems: 'center', zIndex: 10 }}>
            <Text style={{ color: 'white', fontWeight: '900', fontSize: el.w < 30 ? 6 : 10, textAlign: 'center' }}>{el.name}</Text>
          </View>
          <View style={{ width: 4, height: 32, backgroundColor: '#94a3b8', position: 'absolute', bottom: -24, zIndex: 0 }} />
        </View>
      );
    }

    if (el.type === 'ramp') {
      return (
        <View key={el.id} style={[baseStyle, { backgroundColor: '#cbd5e1', borderColor: '#64748b', borderWidth: 2, borderRadius: 2 }]} pointerEvents="none">
          <Ionicons name="navigate-outline" size={20} color="#475569" />
          <Text style={{ color: '#334155', fontSize: 10, fontWeight: 'bold' }}>{el.name}</Text>
        </View>
      );
    }

    return null; // Fallback for unsupported types
  };

  return (
    <View
      onLayout={handleViewportLayout}
      style={[styles.viewport, { height: renderedHeight }]}
    >
      <View
        style={[
          styles.container,
          {
            left: mapLeft,
            top: mapTop,
            width: mapWidth,
            height: mapHeight,
            backgroundColor: interactionMode === 'monitor' ? '#F2F4F7' : COLORS.surface,
            transform: [{ scale }],
          }
        ]}
      >
        {/* Background Grid Pattern (Simulated with absolute views or just plain background for simplicity) */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {/* React Native doesn't have a simple repeating linear gradient background like CSS.
              We'll stick to a solid color to maintain performance. */}
        </View>

        {layout.elements.map((el: any) => renderElement(el))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
  },
  viewport: {
    alignSelf: 'stretch',
    overflow: 'hidden',
    width: '100%',
  },
  slotBox: {
    borderRadius: 4,
    borderWidth: 1.5,
  },
  slotBoxText: {
    fontWeight: '700',
    marginTop: 2,
  },
});
