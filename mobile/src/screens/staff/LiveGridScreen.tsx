import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ParkingMap2D,
  type ParkingSlotInspection,
} from '@/components/booking/ParkingMap2D';
import { EmptyState, ErrorState } from '@/components/common';
import {
  MetricStrip,
  OperationalMetric,
  StaffHeader,
  StatusStrip,
} from '@/components/staff';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { sessionsService } from '@/services/api/sessions';
import { parkingFloorService } from '@/services/ParkingFloorService';
import type { ParkingFloor, Slot } from '@/types/booking.types';

interface ActiveSession {
  _id: string;
  licensePlate: string;
  parkingSlot?: string;
  floorId?: string | { _id?: string };
  checkInTime: string;
  status: string;
  phone?: string;
  vehicleType?: string;
  expectedDurationHours?: number;
  userId?: string | {
    email?: string;
    username?: string;
  };
}

const getFloorId = (floor: ParkingFloor) =>
  String(floor._id ?? floor.id ?? floor.floorNumber);

const EMPTY_AVAILABLE_SLOTS: [] = [];
const ignoreSlotSelection = () => undefined;

const getSessionFloorId = (session: ActiveSession) =>
  String(
    typeof session.floorId === 'object'
      ? session.floorId?._id ?? ''
      : session.floorId ?? '',
  );

const getLayoutElements = (floor: ParkingFloor | null) => {
  if (!floor) return [];
  try {
    const layout = typeof floor.layoutData === 'string'
      ? JSON.parse(floor.layoutData)
      : floor.layoutData ?? floor.layout;
    return Array.isArray(layout?.elements) ? layout.elements : [];
  } catch {
    return [];
  }
};

function LiveActiveBadge({ count }: { count: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 1100,
          easing: Easing.out(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 1100,
          easing: Easing.in(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.36, 0] });

  return (
    <View style={styles.liveBadge}>
      <View style={styles.liveDotWrap}>
        <Animated.View style={[styles.liveDotHalo, { opacity, transform: [{ scale }] }]} />
        <View style={styles.liveDot} />
      </View>
      <Text style={styles.liveBadgeText}>{count} active</Text>
    </View>
  );
}

export default function LiveGridScreen() {
  const [floors, setFloors] = useState<ParkingFloor[]>([]);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [floorSlots, setFloorSlots] = useState<Slot[]>([]);
  const [selectedFloor, setSelectedFloor] = useState<ParkingFloor | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<ParkingSlotInspection | null>(null);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const handleInspectSlot = useCallback((nextSlot: ParkingSlotInspection) => {
    setSelectedSlot((currentSlot) => {
      if (
        currentSlot?.slotCode === nextSlot.slotCode
        && currentSlot.status === nextSlot.status
        && currentSlot.dbSlot === nextSlot.dbSlot
        && currentSlot.session === nextSlot.session
      ) {
        return currentSlot;
      }
      return nextSlot;
    });
  }, []);

  const loadOverview = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const [floorsData, sessionsResponse] = await Promise.all([
        parkingFloorService.getParkingFloors(),
        sessionsService.getActiveParkingStatus(),
      ]);
      setFloors(floorsData);
      setSessions(
        (sessionsResponse as { data?: ActiveSession[] }).data ?? [],
      );
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load the parking grid.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFloorSlots = useCallback(async (
    floorId: string,
    showLoading = true,
  ) => {
    if (showLoading) setSlotsLoading(true);
    try {
      setFloorSlots(await parkingFloorService.getSlotsByFloor(floorId));
    } catch (slotError: unknown) {
      if (showLoading) {
        setError(
          slotError instanceof Error
            ? slotError.message
            : 'Unable to load parking spaces.',
        );
        setFloorSlots([]);
      }
    } finally {
      if (showLoading) setSlotsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    const interval = setInterval(() => {
      void loadOverview();
    }, 15000);
    return () => clearInterval(interval);
  }, [loadOverview]);

  useEffect(() => {
    if (floors.length === 0) {
      setSelectedFloor(null);
      return;
    }
    const selectedStillExists = selectedFloor
      ? floors.find((floor) => getFloorId(floor) === getFloorId(selectedFloor))
      : null;
    setSelectedFloor(selectedStillExists ?? floors[0]);
  }, [floors, selectedFloor]);

  const selectedFloorId = selectedFloor ? getFloorId(selectedFloor) : '';

  useEffect(() => {
    if (!selectedFloorId) return;
    setSelectedSlot(null);
    void loadFloorSlots(selectedFloorId);
    const interval = setInterval(() => {
      void loadFloorSlots(selectedFloorId, false);
    }, 15000);
    return () => clearInterval(interval);
  }, [loadFloorSlots, selectedFloorId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      loadOverview(),
      selectedFloor
        ? loadFloorSlots(getFloorId(selectedFloor))
        : Promise.resolve(),
    ]);
    setRefreshing(false);
  };

  const activeSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          !session.status || session.status.toLowerCase() === 'active',
      ),
    [sessions],
  );
  const floorSessions = useMemo(
    () =>
      activeSessions.filter(
        (session) =>
          !selectedFloorId || getSessionFloorId(session) === selectedFloorId,
      ),
    [activeSessions, selectedFloorId],
  );
  const layoutElements = useMemo(
    () => getLayoutElements(selectedFloor),
    [selectedFloor],
  );
  const layoutSlotCount = useMemo(
    () =>
      layoutElements.filter((element: { type?: string }) =>
        element.type?.startsWith('slot'),
      ).length,
    [layoutElements],
  );
  const capacity = floorSlots.length || layoutSlotCount;
  const maintenanceCount = floorSlots.filter(
    (slot) => slot.status === 'maintenance',
  ).length;
  const reservedCount = floorSlots.filter(
    (slot) =>
      ['reserved', 'booked'].includes(String(slot.status))
      || Boolean(slot.reservedFor)
      || Boolean((slot as Slot & { subscriptionType?: string }).subscriptionType),
  ).length;
  const availableCount = Math.max(
    0,
    capacity - floorSessions.length - maintenanceCount - reservedCount,
  );
  const occupancy =
    capacity > 0 ? Math.round((floorSessions.length / capacity) * 100) : 0;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />

      <StaffHeader
        eyebrow="Live parking"
        title="Floor monitor"
        right={<LiveActiveBadge count={activeSessions.length} />}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.floorTabs}
        style={styles.floorTabScroll}
      >
        {floors.map((floor) => {
          const floorId = getFloorId(floor);
          const active = selectedFloorId === floorId;
          const count = activeSessions.filter(
            (session) => getSessionFloorId(session) === floorId,
          ).length;

          return (
            <Pressable
              key={floorId}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.floorTab,
                active && styles.floorTabActive,
                pressed && styles.pressed,
              ]}
              onPress={() => setSelectedFloor(floor)}
            >
              <Text
                style={[
                  styles.floorTabText,
                  active && styles.floorTabTextActive,
                ]}
              >
                {floor.name}
              </Text>
              {count > 0 ? (
                <View style={styles.floorBadge}>
                  <Text style={styles.floorBadgeText}>{count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={COLORS.staffBlue}
            colors={[COLORS.staffBlue]}
            onRefresh={onRefresh}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={COLORS.staffBlue} size="large" />
            <Text style={styles.loadingText}>Loading live parking...</Text>
          </View>
        ) : error ? (
          <ErrorState
            message={error}
            onRetry={() => {
              void loadOverview(true);
            }}
          />
        ) : !selectedFloor ? (
          <EmptyState
            icon="layers-outline"
            title="No parking floors"
            message="Create a parking floor before opening the live monitor."
            accentColor={COLORS.staffBlue}
          />
        ) : (
          <>
            <MetricStrip style={styles.liveMetricStrip}>
              <OperationalMetric icon="speedometer-outline" value={`${occupancy}%`} label="Occupied" tone={occupancy >= 90 ? 'danger' : occupancy >= 80 ? 'warning' : 'info'} />
              <OperationalMetric icon="checkmark-circle-outline" value={String(availableCount)} label="Available" tone="success" />
              <OperationalMetric icon="bookmark-outline" value={String(reservedCount)} label="Reserved" tone="warning" />
              <OperationalMetric icon="construct-outline" value={String(maintenanceCount)} label="Repair" tone={maintenanceCount > 0 ? 'danger' : 'muted'} />
            </MetricStrip>

            <View style={styles.floorStatus}>
              <StatusStrip
                icon="layers-outline"
                label={selectedFloor.name}
                value={`${capacity} spaces · ${floorSessions.length} active vehicles`}
                tone={occupancy >= 90 ? 'danger' : occupancy >= 80 ? 'warning' : 'success'}
              />
            </View>

            <View style={styles.mapCard}>
              <View style={styles.mapHeader}>
                <View>
                  <Text style={styles.mapEyebrow}>Current floor</Text>
                  <Text style={styles.mapTitle}>{selectedFloor.name}</Text>
                </View>
                <View style={styles.mapHint}>
                  <Ionicons
                    name="hand-left-outline"
                    size={14}
                    color={COLORS.textMuted}
                  />
                  <Text style={styles.mapHintText}>Tap a space</Text>
                </View>
              </View>

              <View style={styles.legend}>
                <LegendItem color="#7EE8A2" label="Available" />
                <LegendItem color="#FF6B6B" label="Occupied" />
                <LegendItem color="#FFD700" label="Reserved" />
                <LegendItem color="#A0A0A0" label="Maintenance" />
              </View>

              <View style={styles.mapViewport}>
                {slotsLoading ? (
                  <View style={styles.mapLoading}>
                    <ActivityIndicator color={COLORS.staffBlue} />
                    <Text style={styles.mapLoadingText}>
                      Updating spaces...
                    </Text>
                  </View>
                ) : layoutElements.length === 0 ? (
                  <View style={styles.noLayout}>
                    <Ionicons
                      name="map-outline"
                      size={28}
                      color={COLORS.textMuted}
                    />
                    <Text style={styles.noLayoutTitle}>No floor plan yet</Text>
                    <Text style={styles.noLayoutText}>
                      Add a layout in Parking lot management to display it here.
                    </Text>
                  </View>
                ) : (
                  <ParkingMap2D
                    floor={selectedFloor}
                    floorSlots={EMPTY_AVAILABLE_SLOTS}
                    selectedSlot={null}
                    onSelectSlot={ignoreSlotSelection}
                    dbSlots={floorSlots}
                    activeSessions={floorSessions}
                    interactionMode="monitor"
                    inspectedSlotCode={selectedSlot?.slotCode}
                    onInspectSlot={handleInspectSlot}
                  />
                )}
              </View>
            </View>

            {selectedSlot ? (
              <SlotDetail
                slot={selectedSlot}
                onClose={() => setSelectedSlot(null)}
              />
            ) : null}

            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>
                  Vehicles on {selectedFloor.name}
                </Text>
                <Text style={styles.sectionSubtitle}>
                  {floorSessions.length === 0
                    ? 'This floor is currently clear'
                    : `${floorSessions.length} active parking ${
                        floorSessions.length === 1 ? 'session' : 'sessions'
                      }`}
                </Text>
              </View>
              <View style={styles.vehicleCount}>
                <Text style={styles.vehicleCountText}>
                  {floorSessions.length}
                </Text>
              </View>
            </View>

            {floorSessions.length === 0 ? (
              <View style={styles.clearState}>
                <Ionicons
                  name="checkmark-circle"
                  size={22}
                  color={COLORS.success}
                />
                <Text style={styles.clearStateText}>
                  All spaces are ready for incoming vehicles.
                </Text>
              </View>
            ) : (
              <View style={styles.sessionList}>
                {floorSessions.map((session) => (
                  <SessionSlotCard key={session._id} session={session} />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SessionSlotCard({ session }: { session: ActiveSession }) {
  const elapsed = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(session.checkInTime).getTime()) / 60000,
    ),
  );
  const hours = Math.floor(elapsed / 60);
  const mins = elapsed % 60;

  return (
    <View style={styles.slotCard}>
      <View style={styles.slotIcon}>
        <Ionicons name="car-sport" size={18} color="#FF7A7A" />
      </View>
      <View style={styles.slotCardBody}>
        <Text style={styles.slotCardCode}>{session.parkingSlot ?? '---'}</Text>
        <Text style={styles.slotCardPlate}>{session.licensePlate}</Text>
      </View>
      <View style={styles.durationChip}>
        <Text style={styles.slotCardTime}>
          {hours > 0 ? `${hours}h ` : ''}
          {mins}m
        </Text>
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function SlotDetail({
  slot,
  onClose,
}: {
  slot: ParkingSlotInspection;
  onClose: () => void;
}) {
  const statusLabel: Record<ParkingSlotInspection['status'], string> = {
    available: 'Available',
    occupied: 'Occupied',
    reserved: 'Reserved',
    held: 'On hold',
    maintenance: 'Maintenance',
  };
  const statusColor: Record<ParkingSlotInspection['status'], string> = {
    available: '#7EE8A2',
    occupied: '#FF6B6B',
    reserved: '#FFD700',
    held: '#FFA500',
    maintenance: '#A0A0A0',
  };
  const color = statusColor[slot.status];
  const session = slot.session;
  const subscription = slot.dbSlot?.subscriptionDetail;
  const user = subscription?.user;
  const ticketPackage = subscription?.ticketPackage;
  const zoneName =
    typeof slot.dbSlot?.zoneID === 'object'
      ? slot.dbSlot.zoneID?.zoneName
      : undefined;
  const durationHours = session?.expectedDurationHours;
  const expirationTime =
    session?.checkInTime && durationHours
      ? new Date(
          new Date(session.checkInTime).getTime() + durationHours * 3600000,
        )
      : null;

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible
    >
      <View style={styles.detailModal}>
        <Pressable
          accessibilityLabel="Close space details"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.detailBackdrop}
        />
        <SafeAreaView edges={['bottom']} style={styles.detailPanel}>
          <View style={styles.sheetHandle} />
          <View style={[styles.detailAccent, { backgroundColor: color }]} />
          <ScrollView
            contentContainerStyle={styles.detailContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.detailHeader}>
              <View>
                <View style={styles.detailLiveRow}>
                  <Text style={styles.detailLabel}>Space details</Text>
                  <View style={styles.detailLiveDot} />
                  <Text style={styles.detailLiveText}>LIVE API</Text>
                </View>
                <View style={styles.detailTitleRow}>
                  <Text style={styles.detailSlot}>SLOT {slot.slotCode}</Text>
                  {zoneName ? (
                    <Text style={styles.detailZone}>{zoneName}</Text>
                  ) : null}
                </View>
              </View>
              <Pressable
                accessibilityLabel="Close space details"
                accessibilityRole="button"
                hitSlop={8}
                onPress={onClose}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons name="close" size={20} color={COLORS.textSecondary} />
              </Pressable>
            </View>

            <View
              style={[
                styles.detailStatusHero,
                {
                  backgroundColor: `${color}14`,
                  borderColor: `${color}45`,
                },
              ]}
            >
              <View style={[styles.detailStatusIcon, { backgroundColor: `${color}20` }]}>
                <Ionicons
                  name={
                    slot.status === 'occupied'
                      ? 'car-sport'
                      : slot.status === 'maintenance'
                        ? 'construct'
                        : slot.status === 'available'
                          ? 'checkmark'
                          : 'lock-closed'
                  }
                  size={20}
                  color={color}
                />
              </View>
              <View>
                <Text style={styles.detailStatusCaption}>Current status</Text>
                <Text style={[styles.detailStatus, { color }]}>
                  {statusLabel[slot.status]}
                </Text>
              </View>
            </View>

            {slot.status === 'occupied' && session ? (
              <View style={styles.detailRows}>
                <DetailRow
                  label="License plate"
                  value={session.licensePlate || 'Not available'}
                  mono
                />
                <DetailRow
                  label="Customer"
                  value={
                    typeof session.userId === 'object'
                      ? session.userId?.username || 'Guest'
                      : 'Guest'
                  }
                />
                <DetailRow label="Phone" value={session.phone || 'Not available'} />
                {typeof session.userId === 'object' && session.userId?.email ? (
                  <DetailRow label="Email" value={session.userId.email} accent />
                ) : null}
                <DetailRow
                  label="Vehicle type"
                  value={formatVehicleType(session.vehicleType)}
                />
                <DetailRow
                  label="Check-in time"
                  value={formatDateTime(session.checkInTime)}
                />
                <DetailRow
                  label="Expected duration"
                  value={
                    durationHours
                      ? `${durationHours} ${durationHours === 1 ? 'hour' : 'hours'}`
                      : 'Not specified'
                  }
                />
                {expirationTime ? (
                  <DetailRow
                    label="Expiration time"
                    value={formatDateTime(expirationTime)}
                    accent
                    last
                  />
                ) : null}
              </View>
            ) : slot.status === 'reserved' || slot.status === 'held' ? (
              subscription ? (
                <View style={styles.detailRows}>
                  <DetailRow
                    label="Customer"
                    value={user?.username || 'Not available'}
                  />
                  <DetailRow label="Phone" value={user?.phone || 'Not available'} />
                  <DetailRow
                    label="Email"
                    value={user?.email || 'Not available'}
                    accent
                  />
                  <DetailRow
                    label="Package"
                    value={ticketPackage?.name || ticketPackage?.type || 'Subscription'}
                  />
                  <DetailRow
                    label="Valid until"
                    value={formatDateTime(subscription.expireAt)}
                    accent
                    last
                  />
                </View>
              ) : (
                <DetailNotice
                  icon="lock-closed-outline"
                  color={color}
                  title={slot.status === 'held' ? 'Space temporarily held' : 'Reserved space'}
                  message="This space is reserved for a subscription or an upcoming booking."
                />
              )
            ) : slot.status === 'maintenance' ? (
              <DetailNotice
                icon="construct-outline"
                color={color}
                title="Under maintenance"
                message="This space is locked and cannot receive vehicles."
              />
            ) : (
              <DetailNotice
                icon="checkmark-circle-outline"
                color={color}
                title="Space is empty"
                message="Ready for the next incoming vehicle assignment."
              />
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function DetailRow({
  label,
  value,
  accent = false,
  mono = false,
  last = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, last && styles.infoRowLast]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text
        numberOfLines={2}
        style={[
          styles.infoValue,
          accent && styles.infoValueAccent,
          mono && styles.infoValueMono,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function DetailNotice({
  icon,
  color,
  title,
  message,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  message: string;
}) {
  return (
    <View style={styles.detailNotice}>
      <View style={[styles.noticeIcon, { backgroundColor: `${color}18` }]}>
        <Ionicons name={icon} size={24} color={color} />
      </View>
      <Text style={[styles.noticeTitle, { color }]}>{title}</Text>
      <Text style={styles.noticeMessage}>{message}</Text>
    </View>
  );
}

function formatDateTime(value?: string | Date) {
  if (!value) return 'Not available';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleString('vi-VN');
}

function formatVehicleType(value?: string) {
  if (!value) return 'Not available';
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.xxl,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 },
  statChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(126,232,162,0.1)',
    borderColor: 'rgba(126,232,162,0.25)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
  },
  onlineDot: { backgroundColor: '#7EE8A2', borderRadius: 3, height: 6, width: 6 },
  statChipText: { color: '#7EE8A2', fontSize: FONT_SIZES.xs, fontWeight: '700' },
  liveBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(76,175,80,0.12)',
    borderColor: 'rgba(76,175,80,0.32)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    minHeight: 40,
    paddingHorizontal: SPACING.md,
  },
  liveBadgeText: {
    color: COLORS.success,
    fontSize: FONT_SIZES.xs,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  liveDot: { backgroundColor: COLORS.success, borderRadius: 5, height: 10, width: 10 },
  liveDotHalo: {
    borderColor: COLORS.success,
    borderRadius: 10,
    borderWidth: 1,
    height: 20,
    position: 'absolute',
    width: 20,
  },
  liveDotWrap: {
    alignItems: 'center',
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  floorTabScroll: { flexGrow: 0, height: 46, marginBottom: SPACING.sm, marginTop: SPACING.xs, maxHeight: 46 },
  floorTabs: {
    alignItems: 'center',
    gap: SPACING.sm,
    paddingBottom: 0,
    paddingHorizontal: SPACING.lg,
  },
  floorTab: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 42,
    paddingHorizontal: SPACING.md,
  },
  floorTabActive: {
    backgroundColor: 'rgba(96,180,255,0.1)',
    borderColor: COLORS.staffBlue,
    shadowColor: COLORS.staffBlue,
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
  },
  floorTabText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.sm,
    fontWeight: '800',
  },
  floorTabTextActive: { color: COLORS.staffBlue },
  floorBadge: {
    alignItems: 'center',
    backgroundColor: COLORS.staffBlue,
    borderRadius: RADIUS.round,
    height: 20,
    justifyContent: 'center',
    minWidth: 20,
    paddingHorizontal: 3,
  },
  floorBadgeText: { color: COLORS.background, fontSize: 10, fontWeight: '800' },
  content: { paddingBottom: SPACING.xl },
  liveMetricStrip: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
  },
  floorStatus: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
  },
  loadingWrap: { alignItems: 'center', gap: SPACING.md, paddingTop: 80 },
  loadingText: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm },
  mapCard: {
    backgroundColor: '#111419',
    borderColor: COLORS.border,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    overflow: 'hidden',
  },
  mapHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  mapEyebrow: { color: COLORS.staffBlue, fontSize: FONT_SIZES.xs, fontWeight: '700' },
  mapTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.lg,
    fontWeight: '800',
    marginTop: 2,
  },
  mapHint: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  mapHintText: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  legendItem: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  legendDot: { borderRadius: 3, height: 6, width: 6 },
  legendText: { color: COLORS.textMuted, fontSize: 10 },
  mapViewport: {
    backgroundColor: '#F2F4F7',
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    minHeight: 190,
    overflow: 'hidden',
  },
  mapLoading: {
    alignItems: 'center',
    gap: SPACING.sm,
    justifyContent: 'center',
    minHeight: 210,
  },
  mapLoadingText: { color: '#697586', fontSize: FONT_SIZES.xs },
  noLayout: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 210,
    padding: SPACING.lg,
  },
  noLayoutTitle: {
    color: '#3D4653',
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    marginTop: SPACING.sm,
  },
  noLayoutText: {
    color: '#697586',
    fontSize: FONT_SIZES.xs,
    lineHeight: 18,
    marginTop: 4,
    textAlign: 'center',
  },
  detailModal: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  detailBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2, 5, 9, 0.72)',
  },
  detailPanel: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.borderLight,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: 1,
    maxHeight: '82%',
    overflow: 'hidden',
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: COLORS.borderLight,
    borderRadius: 2,
    height: 4,
    marginTop: SPACING.sm,
    width: 38,
  },
  detailContent: {
    paddingBottom: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  detailAccent: {
    backgroundColor: COLORS.staffBlue,
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 3,
  },
  detailHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailLiveRow: { alignItems: 'center', flexDirection: 'row' },
  detailLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
  },
  detailLiveDot: {
    backgroundColor: '#7EE8A2',
    borderRadius: 3,
    height: 6,
    marginLeft: SPACING.sm,
    width: 6,
  },
  detailLiveText: {
    color: '#7EE8A2',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginLeft: 4,
  },
  detailTitleRow: { alignItems: 'center', flexDirection: 'row', marginTop: 2 },
  detailSlot: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.xl,
    fontWeight: '800',
  },
  detailZone: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginLeft: SPACING.sm,
    maxWidth: 130,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.sm,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  detailStatusHero: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: SPACING.md,
    padding: SPACING.sm,
  },
  detailStatusIcon: {
    alignItems: 'center',
    borderRadius: RADIUS.sm,
    height: 40,
    justifyContent: 'center',
    marginRight: SPACING.sm,
    width: 40,
  },
  detailStatusCaption: {
    color: COLORS.textMuted,
    fontSize: 10,
  },
  detailStatus: {
    fontSize: FONT_SIZES.md,
    fontWeight: '800',
    marginTop: 1,
  },
  detailRows: { marginTop: SPACING.sm },
  infoRow: {
    alignItems: 'flex-start',
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 42,
    paddingVertical: 11,
  },
  infoRowLast: { borderBottomWidth: 0 },
  infoLabel: {
    color: COLORS.textMuted,
    flex: 0.42,
    fontSize: FONT_SIZES.xs,
  },
  infoValue: {
    color: COLORS.textPrimary,
    flex: 0.58,
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    lineHeight: 17,
    textAlign: 'right',
  },
  infoValueAccent: { color: COLORS.staffBlue },
  infoValueMono: {
    fontSize: FONT_SIZES.sm,
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  detailNotice: {
    alignItems: 'center',
    paddingBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
  },
  noticeIcon: {
    alignItems: 'center',
    borderRadius: RADIUS.round,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  noticeTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '800',
    marginTop: SPACING.sm,
  },
  noticeMessage: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    lineHeight: 18,
    marginTop: 4,
    maxWidth: 260,
    textAlign: 'center',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
  sectionSubtitle: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 3 },
  vehicleCount: {
    alignItems: 'center',
    backgroundColor: 'rgba(96,180,255,0.12)',
    borderRadius: RADIUS.sm,
    height: 32,
    justifyContent: 'center',
    minWidth: 32,
  },
  vehicleCountText: { color: COLORS.staffBlue, fontSize: FONT_SIZES.sm, fontWeight: '800' },
  sessionList: { gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
  slotCard: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    padding: SPACING.sm,
  },
  slotIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,107,107,0.1)',
    borderRadius: RADIUS.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  slotCardBody: { flex: 1, marginLeft: SPACING.sm },
  slotCardCode: { color: COLORS.staffBlue, fontSize: FONT_SIZES.sm, fontWeight: '800' },
  slotCardPlate: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    letterSpacing: 1,
    marginTop: 2,
  },
  durationChip: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  slotCardTime: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
  clearState: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    padding: SPACING.md,
  },
  clearStateText: { color: COLORS.textSecondary, flex: 1, fontSize: FONT_SIZES.sm },
});

