import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ParkingMap2D } from '@/components/booking/ParkingMap2D';
import { OccupancyForecast } from '@/components/booking/OccupancyForecast';
import { EmptyState, ErrorState, ScreenHeader } from '@/components/common';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useBooking } from '@/hooks/useBooking';
import bookingService from '@/services/BookingService';
import parkingFloorService from '@/services/ParkingFloorService';
import type { BookingStackParamList } from '@/navigation/BookingStackNavigator';
import type { AvailableSlot, ParkingFloor } from '@/types/booking.types';

type Props = NativeStackScreenProps<BookingStackParamList, 'FindParking'>;

const getFloorId = (floor: ParkingFloor) => floor._id ?? floor.id ?? String(floor.floorNumber);

export const FindParkingScreen = ({ navigation, route }: Props) => {
  const { availableSlots, parkingFloors, isLoading, error, fetchParkingFloors, getAvailableSlots } = useBooking();
  const [selectedFloor, setSelectedFloor] = useState<ParkingFloor | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);

  const [dbSlots, setDbSlots] = useState<any[]>([]);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [activeHolds, setActiveHolds] = useState<any[]>([]);

  const startTime = useMemo(
    () => (route.params?.startTime ? new Date(route.params.startTime) : new Date()),
    [route.params?.startTime],
  );
  const endTime = useMemo(
    () => (route.params?.endTime ? new Date(route.params.endTime) : new Date(Date.now() + 2 * 3600_000)),
    [route.params?.endTime],
  );

  useEffect(() => {
    void fetchParkingFloors();
    void getAvailableSlots(startTime, endTime);
  }, [endTime, fetchParkingFloors, getAvailableSlots, startTime]);

  useEffect(() => {
    if (parkingFloors.length === 0 || selectedFloor) return;

    const preferredFloor = route.params?.floorId
      ? parkingFloors.find((floor) => getFloorId(floor) === route.params?.floorId)
      : undefined;
    setSelectedFloor(preferredFloor ?? parkingFloors[0]);
  }, [parkingFloors, route.params?.floorId, selectedFloor]);

  useEffect(() => {
    const fetchExtraData = async () => {
      try {
        const [sessionsRes, holdsRes] = await Promise.all([
          bookingService.getActiveSessions(),
          bookingService.getActiveHolds()
        ]);
        setActiveSessions(sessionsRes.data || []);
        setActiveHolds(holdsRes.data || []);
      } catch (err) {
        console.warn('Failed to fetch extra map data:', err);
      }
    };
    void fetchExtraData();
  }, []);

  useEffect(() => {
    const fetchSlots = async () => {
      if (!selectedFloor) return;
      try {
        const floorId = getFloorId(selectedFloor);
        const slots = await parkingFloorService.getSlotsByFloor(floorId);
        setDbSlots(slots || []);
      } catch (err) {
        console.warn('Failed to fetch db slots:', err);
      }
    };
    void fetchSlots();
  }, [selectedFloor]);

  const selectedFloorId = selectedFloor ? getFloorId(selectedFloor) : '';
  const floorSlots = useMemo(
    () => availableSlots.filter((slot) => slot.floorId === selectedFloorId),
    [availableSlots, selectedFloorId],
  );
  const handleConfirmSlot = () => {
    if (!selectedSlot) return;

    navigation.navigate('CreateBooking', {
      selectedFloorId: selectedSlot.floorId,
      selectedFloorName: selectedFloor?.name ?? selectedSlot.floorName,
      selectedSlotCode: selectedSlot.slotCode,
    });
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#080808" />
      <ScreenHeader
        accentColor="#7EE8A2"
        headerIcon="map-outline"
        headerIconBackground="rgba(126,232,162,0.12)"
        headerIconColor="#7EE8A2"
        subtitle="Select a parking space"
        title="Parking map"
        onBack={() => navigation.goBack()}
      />

      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <View style={[styles.statDot, { backgroundColor: '#7EE8A2' }]} />
          <Text style={styles.statText}>Available</Text>
        </View>
        <View style={styles.statItem}>
          <View style={[styles.statDot, { backgroundColor: '#FF6B6B' }]} />
          <Text style={styles.statText}>Occupied</Text>
        </View>
        <View style={styles.statItem}>
          <View style={[styles.statDot, { backgroundColor: '#FFD700' }]} />
          <Text style={styles.statText}>VIP</Text>
        </View>
        <View style={styles.statItem}>
          <View style={[styles.statDot, { backgroundColor: '#FFA500' }]} />
          <Text style={styles.statText}>Reserved</Text>
        </View>
        <View style={styles.statItem}>
          <View style={[styles.statDot, { backgroundColor: '#A0A0A0' }]} />
          <Text style={styles.statText}>Maintenance</Text>
        </View>
      </View>

      {parkingFloors.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.floorTabs}
          style={styles.floorTabScroll}
        >
          {parkingFloors.map((floor) => {
            const floorId = getFloorId(floor);
            const active = selectedFloorId === floorId;
            const floorCount = availableSlots.filter((slot) => slot.floorId === floorId).length;
            return (
              <Pressable
                key={floorId}
                style={[styles.floorTab, active && styles.floorTabActive]}
                onPress={() => {
                  setSelectedFloor(floor);
                  setSelectedSlot(null);
                }}
              >
                <Text style={[styles.floorTabText, active && styles.floorTabTextActive]}>{floor.name}</Text>
                <View style={[styles.floorCount, active && styles.floorCountActive]}>
                  <Text style={[styles.floorCountText, active && styles.floorCountTextActive]}>
                    {floorCount}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <ScrollView style={styles.mapScroll}>
        <OccupancyForecast floorId={selectedFloorId || undefined} onSelectTime={(initialStartTime, initialEndTime) => navigation.navigate('CreateBooking', { initialStartTime, initialEndTime, selectedFloorId: selectedFloorId || undefined })} />
        <View style={styles.mapCanvas}>
            {isLoading ? (
              <View style={styles.mapState}>
                <ActivityIndicator color={COLORS.gold} size="large" />
                <Text style={styles.mapStateText}>Loading parking map...</Text>
              </View>
            ) : error ? (
              <View style={styles.mapState}>
                <ErrorState
                  message={error}
                  onRetry={() => {
                    void fetchParkingFloors();
                    void getAvailableSlots(startTime, endTime);
                  }}
                />
              </View>
            ) : !selectedFloor ? (
              <View style={styles.mapState}>
                <EmptyState
                  icon="layers-outline"
                  title="No floors available"
                  message="No parking floors are available to display."
                />
              </View>
            ) : (
              <ParkingMap2D
                floor={selectedFloor}
                floorSlots={floorSlots}
                selectedSlot={selectedSlot}
                onSelectSlot={setSelectedSlot}
                dbSlots={dbSlots}
                activeSessions={activeSessions}
                activeHolds={activeHolds}
              />
            )}
        </View>
      </ScrollView>

      {selectedSlot ? (
        <View style={styles.selectedPanel}>
          <View style={styles.selectedInfo}>
            <Text style={styles.selectedSlotCode}>{selectedSlot.slotCode}</Text>
            <Text style={styles.selectedFloor}>
              {selectedFloor?.name ?? selectedSlot.floorName ?? selectedSlot.floorId}
              {selectedSlot.zoneName ? ` - ${selectedSlot.zoneName}` : ''}
            </Text>
          </View>
          <TouchableOpacity activeOpacity={0.85} style={styles.selectBtn} onPress={handleConfirmSlot}>
            <Text style={styles.selectBtnText}>Select this space</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  statsBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.lg,
    paddingBottom: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  statItem: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  statDot: { borderRadius: 5, height: 10, width: 10 },
  statText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs },
  floorTabScroll: { maxHeight: 44 },
  floorTabs: {
    alignItems: 'center',
    gap: SPACING.sm,
    paddingBottom: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  floorTab: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: 7,
  },
  floorTabActive: { backgroundColor: 'rgba(212,175,55,0.12)', borderColor: COLORS.gold },
  floorTabText: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '600' },
  floorTabTextActive: { color: COLORS.gold },
  floorCount: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.round,
    minWidth: 20,
    paddingHorizontal: 5,
  },
  floorCountActive: { backgroundColor: COLORS.gold },
  floorCountText: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700' },
  floorCountTextActive: { color: COLORS.textInverse },
  mapScroll: { flex: 1 },
  mapCanvas: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    margin: SPACING.md,
    minHeight: 420,
    position: 'relative',
    overflow: 'hidden',
  },
  mapState: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    minHeight: 300,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  mapStateText: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm, marginTop: SPACING.md },
  slotBox: {
    alignItems: 'center',
    borderRadius: RADIUS.sm,
    borderWidth: 1.5,
    gap: 2,
    height: 56,
    justifyContent: 'center',
    position: 'absolute',
    width: 62,
  },
  slotBoxText: { fontSize: 10, fontWeight: '700' },
  selectedPanel: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: 'rgba(96,180,255,0.35)',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    margin: SPACING.md,
    padding: SPACING.md,
  },
  selectedInfo: { flex: 1 },
  selectedSlotCode: { color: COLORS.staffBlue, fontSize: FONT_SIZES.lg, fontWeight: '800' },
  selectedFloor: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, marginTop: 2 },
  selectBtn: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: SPACING.md,
  },
  selectBtnText: { color: COLORS.textInverse, fontSize: FONT_SIZES.sm, fontWeight: '700' },
});
