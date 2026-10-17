import { useBottomTabBarHeight, type BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState } from '@/components/common';
import { GateControlPanel } from '@/components/staff/dashboard/GateControlPanel';
import {
  DashboardEntry,
  EmptyRecentActivity,
  StaffAlertRow,
  StaffCommandHeader,
  StaffDashboardSkeleton,
  StaffLiveStatus,
  StaffMetricsStrip,
  StaffPrimaryActions,
  StaffRecentActivityRow,
} from '@/components/staff/dashboard';
import { COLORS, FONT_SIZES, SPACING } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import type { StaffTabParamList } from '@/navigation/StaffNavigator';
import { staffService, type StaffBooking, type StaffSession } from '@/services/api/staff';
import { parkingFloorService } from '@/services/ParkingFloorService';
import type { ParkingFloor } from '@/types/booking.types';

type Props = BottomTabScreenProps<StaffTabParamList, 'Dashboard'>;
type Snapshot = { floors: ParkingFloor[]; sessions: StaffSession[]; bookings: StaffBooking[] };
type CapacityTone = 'danger' | 'warning' | 'success';

const floorCapacity = (floor: ParkingFloor) =>
  floor.slots?.length
  ?? floor.layout?.elements?.filter((item) => item.type === 'slot').length
  ?? floor.layoutData?.elements?.filter((item: { type?: string }) => item.type === 'slot').length
  ?? 0;

const isToday = (value?: string) => Boolean(value && new Date(value).toDateString() === new Date().toDateString());

export default function StaffDashboardScreen({ navigation }: Props) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const [snapshot, setSnapshot] = useState<Snapshot>({ floors: [], sessions: [], bookings: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [floors, sessionResponse, bookingResponse] = await Promise.all([
        parkingFloorService.getParkingFloors(),
        staffService.getSessions(),
        staffService.getBookings({ date: today }),
      ]);
      setSnapshot({
        floors,
        sessions: sessionResponse.data ?? [],
        bookings: bookingResponse.data ?? [],
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the operations overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = useMemo(() => {
    const capacity = snapshot.floors.reduce((sum, floor) => sum + floorCapacity(floor), 0);
    const activeSessions = snapshot.sessions.filter((item) => item.status?.toLowerCase() === 'active');
    const completedToday = snapshot.sessions.filter((item) => item.status === 'completed' && isToday(item.checkOutTime));
    const maintenance = snapshot.floors.reduce(
      (sum, floor) => sum + (floor.slots?.filter((slot) => slot.status === 'maintenance').length ?? 0),
      0,
    );
    const reserved = snapshot.floors.reduce(
      (sum, floor) => sum + (floor.slots?.filter((slot) => ['reserved', 'booked'].includes(String(slot.status))).length ?? 0),
      0,
    );
    const available = Math.max(capacity - activeSessions.length - reserved - maintenance, 0);
    const occupancy = capacity > 0 ? Math.round((activeSessions.length / capacity) * 100) : 0;
    const avgMinutes = completedToday.length
      ? Math.round(
          completedToday.reduce(
            (sum, item) => sum + (new Date(item.checkOutTime!).getTime() - new Date(item.checkInTime).getTime()) / 60000,
            0,
          ) / completedToday.length,
        )
      : 0;
    const waiting = snapshot.bookings.filter((item) => ['PAID', 'ACTIVE'].includes(item.status?.toUpperCase())).length;
    const blocked = snapshot.bookings.filter((item) => ['CANCELLED', 'EXPIRED'].includes(item.status?.toUpperCase())).length;
    return {
      active: activeSessions.length,
      available,
      avgMinutes,
      blocked,
      bookings: snapshot.bookings.length,
      capacity,
      maintenance,
      occupancy,
      reserved,
      waiting,
    };
  }, [snapshot]);

  const recentBookings = useMemo(
    () => [...snapshot.bookings]
      .sort((a, b) => new Date(b.updatedAt ?? b.createdAt ?? b.scheduledStart).getTime() - new Date(a.updatedAt ?? a.createdAt ?? a.scheduledStart).getTime())
      .slice(0, 4),
    [snapshot.bookings],
  );

  const displayName = user?.username || 'Staff';
  const capacityTone: CapacityTone = metrics.occupancy >= 92 ? 'danger' : metrics.occupancy >= 82 ? 'warning' : 'success';
  const capacityLabel = metrics.occupancy >= 92 ? 'Parking almost full' : metrics.occupancy >= 82 ? 'Capacity tightening' : 'Capacity stable';
  const dateLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  const bottomPadding = Math.max(tabBarHeight + insets.bottom + SPACING.lg, 112);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <StaffCommandHeader
        dateLabel={dateLabel}
        displayName={displayName}
        onAvatarPress={() => navigation.navigate('StaffProfile', { screen: 'StaffProfileHome' })}
      />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPadding }]}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={COLORS.gold} onRefresh={refresh} />}
        showsVerticalScrollIndicator={false}
      >
        <DashboardEntry delay={80}>
          <GateControlPanel />
        </DashboardEntry>

        {loading ? (
          <StaffDashboardSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <>
            <DashboardEntry delay={120}>
              <Text style={styles.blockLabel}>Today</Text>
              <StaffMetricsStrip
                active={metrics.active}
                capacity={`${metrics.occupancy}%`}
                capacityTone={capacityTone}
                vehicles={metrics.bookings}
              />
            </DashboardEntry>

            <StaffPrimaryActions
              onLiveParking={() => navigation.navigate('LiveGrid')}
              onScanQr={() => navigation.navigate('Manage', { screen: 'BookingScanner' })}
              onSessions={() => navigation.navigate('Sessions')}
            />

            <StaffLiveStatus
              available={metrics.available}
              capacity={metrics.capacity}
              capacityLabel={capacityLabel}
              maintenance={metrics.maintenance}
              reserved={metrics.reserved}
              tone={capacityTone}
            />

            {metrics.blocked > 0 ? (
              <StaffAlertRow count={metrics.blocked} onPress={() => navigation.navigate('Manage', { screen: 'Bookings' })} />
            ) : null}

            <DashboardEntry delay={metrics.blocked > 0 ? 650 : 520} style={styles.activityBlock}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Recent activity</Text>
                <Text numberOfLines={1} style={styles.sectionMeta}>
                  {metrics.avgMinutes ? `${metrics.avgMinutes} min avg` : 'No completed sessions'}
                </Text>
              </View>
              <View style={styles.activityList}>
                {recentBookings.length ? recentBookings.map((booking) => (
                  <StaffRecentActivityRow
                    key={booking._id}
                    meta={booking.status}
                    subtitle={`${booking.parkingSlot || 'No space'} / ${booking.userId?.fullName || booking.userId?.email || 'Customer'}`}
                    title={booking.licensePlate}
                    tone={booking.status?.toUpperCase() === 'CANCELLED' ? 'danger' : 'brand'}
                    onPress={() => navigation.navigate('Manage', { screen: 'Bookings' })}
                  />
                )) : (
                  <EmptyRecentActivity />
                )}
              </View>
            </DashboardEntry>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  activityBlock: { gap: SPACING.sm },
  activityList: { borderTopColor: COLORS.border, borderTopWidth: StyleSheet.hairlineWidth },
  blockLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    fontWeight: '900',
    letterSpacing: 0.9,
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
  },
  safe: { backgroundColor: COLORS.background, flex: 1 },
  scroll: { gap: SPACING.lg, padding: SPACING.lg },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 26,
  },
  sectionMeta: {
    color: COLORS.textMuted,
    flexShrink: 1,
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
    textAlign: 'right',
  },
  sectionTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '900' },
});
