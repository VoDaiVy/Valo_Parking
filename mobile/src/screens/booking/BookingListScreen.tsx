import { Ionicons } from '@expo/vector-icons';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { format } from 'date-fns';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedPressable, StatusChip, StaggeredView } from '@/components/profile/ProfileUI';
import { ErrorState } from '@/components/common';
import { CustomerAmbientBackground } from '@/components/customer/CustomerAmbientBackground';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useBooking } from '@/hooks/useBooking';
import { useBookingCart } from '@/contexts/BookingCartContext';
import { WorkflowChip, workflowStyles } from '@/components/common/WorkflowUI';
import { useFocusEffect } from '@react-navigation/native';
import type { CustomerTabParamList } from '@/navigation/CustomerNavigator';
import type { Booking, BookingStatus, ParkingFloor } from '@/types/booking.types';
import { formatCurrency } from '@/utils/formatters';
import { useLanguage } from '@/contexts/LanguageContext';

type Props = { navigation: any };
type FilterType = BookingStatus | 'all';

const STATUS_CONFIG: Record<BookingStatus | 'all', { label: string; color: string; bg: string }> = {
  all: { label: 'All', color: COLORS.textSecondary, bg: 'rgba(255,255,255,0.04)' },
  pending: { label: 'Payment pending', color: COLORS.warning, bg: 'rgba(255,159,67,0.11)' },
  confirmed: { label: 'Confirmed', color: COLORS.staffBlue, bg: 'rgba(96,180,255,0.11)' },
  active: { label: 'Parked', color: COLORS.success, bg: 'rgba(76,175,80,0.11)' },
  paused: { label: 'Paused', color: COLORS.warning, bg: 'rgba(255,159,67,0.11)' },
  completed: { label: 'Completed', color: COLORS.textMuted, bg: 'rgba(255,255,255,0.04)' },
  cancelled: { label: 'Cancelled', color: COLORS.error, bg: 'rgba(255,77,77,0.1)' },
  expired: { label: 'Expired', color: COLORS.warning, bg: 'rgba(255,159,67,0.11)' },
};

const FILTERS: FilterType[] = ['all', 'pending', 'confirmed', 'active', 'paused', 'completed', 'cancelled', 'expired'];

function getStatusConfig(status: BookingStatus) {
  return STATUS_CONFIG[status] ?? STATUS_CONFIG.all;
}

function safeFormat(dateStr: string | undefined | null, fmt: string) {
  try {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'N/A';
    return format(d, fmt);
  } catch {
    return 'N/A';
  }
}

function getFloorLabel(floorId: Booking['floorId']) {
  if (typeof floorId === 'string') return 'VALO Parking';
  const floor = floorId as ParkingFloor;
  return floor.name || `Floor ${floor.floorNumber}`;
}

function NewBookingButton({ compact, onPress }: { compact?: boolean; onPress: () => void }) {
  return (
    <AnimatedPressable accessibilityLabel="Create a new booking" onPress={onPress} style={styles.newBtn} tint="rgba(226,186,75,0.08)">
      <LinearGradient
        colors={[COLORS.goldLight, COLORS.gold]}
        end={{ x: 1, y: 0 }}
        start={{ x: 0, y: 0 }}
        style={[styles.newBtnGrad, compact && styles.newBtnCompact]}
      >
        <Ionicons name="add" size={18} color={COLORS.textInverse} />
        <Text numberOfLines={1} style={styles.newBtnText}>New booking</Text>
      </LinearGradient>
    </AnimatedPressable>
  );
}

function FilterChip({
  active,
  count,
  filterType,
  onPress,
}: {
  active: boolean;
  count: number;
  filterType: FilterType;
  onPress: () => void;
}) {
  const config = STATUS_CONFIG[filterType];

  return (
    <AnimatedPressable accessibilityLabel={`Filter ${config.label}`} onPress={onPress} style={styles.filterPress}>
      <View
        style={[
          styles.filterPill,
          active
            ? { backgroundColor: config.bg, borderColor: config.color }
            : { backgroundColor: 'rgba(255,255,255,0.025)', borderColor: 'rgba(255,255,255,0.08)' },
        ]}
      >
        <Text style={[styles.filterText, { color: active ? config.color : COLORS.textMuted }]}>{config.label}</Text>
        <View style={[styles.filterBadge, { backgroundColor: active ? config.color : 'rgba(255,255,255,0.08)' }]}>
          <Text style={[styles.filterBadgeText, { color: active ? COLORS.background : COLORS.textMuted }]}>{count}</Text>
        </View>
      </View>
    </AnimatedPressable>
  );
}

function EmptyBookings({ filter, onCreate }: { filter: FilterType; onCreate: () => void }) {
  const title = filter === 'all' ? 'No bookings yet' : `No ${STATUS_CONFIG[filter].label.toLowerCase()} bookings`;

  return (
    <StaggeredView delay={120} style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name="calendar-outline" size={34} color={COLORS.gold} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>Create a booking to reserve your space before arrival.</Text>
      <View style={styles.emptyButton}>
        <NewBookingButton compact onPress={onCreate} />
      </View>
    </StaggeredView>
  );
}

function BookingRow({
  booking,
  index,
  onPress,
}: {
  booking: Booking;
  index: number;
  onPress: () => void;
}) {
  const entrance = useRef(new Animated.Value(0)).current;
  const arrow = useRef(new Animated.Value(0)).current;
  const statusConfig = getStatusConfig(booking.status);
  const startDate = safeFormat(booking.startTime, 'dd MMM yyyy');
  const startTime = safeFormat(booking.startTime, 'HH:mm');
  const endTime = safeFormat(booking.endTime, 'HH:mm');

  useEffect(() => {
    Animated.timing(entrance, {
      delay: 90 + index * 55,
      duration: 430,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [entrance, index]);

  const animateArrow = (toValue: number) => {
    Animated.spring(arrow, {
      damping: 16,
      stiffness: 260,
      toValue,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={[
        styles.bookingWrap,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [18, 0],
              }),
            },
          ],
        },
      ]}
    >
      <AnimatedPressable
        accessibilityLabel={`Space ${booking.slotCode}, ${statusConfig.label}`}
        onPress={onPress}
        onPressIn={() => animateArrow(1)}
        onPressOut={() => animateArrow(0)}
      >
        <View style={styles.bookingRow}>
          <View style={[styles.timelineDot, { backgroundColor: statusConfig.color }]} />
          <View style={styles.bookingBody}>
            <View style={styles.bookingTop}>
              <View style={styles.bookingTimeBlock}>
                <Text style={styles.bookingDate}>{startDate}</Text>
                <Text style={styles.bookingTime}>{startTime} - {endTime}</Text>
              </View>
              <Animated.View
                style={{
                  opacity: entrance,
                  transform: [
                    {
                      translateX: entrance.interpolate({
                        inputRange: [0, 1],
                        outputRange: [8, 0],
                      }),
                    },
                  ],
                }}
              >
                <Text numberOfLines={1} style={styles.amount}>{formatCurrency(booking.finalAmount ?? booking.prepaidAmount ?? 0)}</Text>
              </Animated.View>
            </View>

            <Text numberOfLines={1} style={styles.slotCode}>Space {booking.slotCode}</Text>
            <Text numberOfLines={1} style={styles.floorLabel}>{getFloorLabel(booking.floorId)}</Text>

            <View style={styles.bookingFooter}>
              <StatusChip color={statusConfig.color} label={statusConfig.label} />
              <View style={styles.platePill}>
                <Ionicons name="car-outline" size={13} color={COLORS.textMuted} />
                <Text numberOfLines={1} style={styles.plateText}>{booking.licensePlate}</Text>
              </View>
              <Animated.View
                style={{
                  marginLeft: 'auto',
                  transform: [
                    {
                      translateX: arrow.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 4],
                      }),
                    },
                  ],
                }}
              >
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </Animated.View>
            </View>
          </View>
        </View>
      </AnimatedPressable>
      <View style={styles.rowDivider} />
    </Animated.View>
  );
}

export const BookingListScreen = ({ navigation }: Props) => {
  const cart = useBookingCart();
  const { bookings, isLoading, error, fetchBookings } = useBooking();
  const { t } = useLanguage();
  const [filter, setFilter] = useState<FilterType>('all');

  useFocusEffect(useCallback(() => {
    void fetchBookings();
  }, [fetchBookings]));

  const filtered = filter === 'all' ? bookings : bookings.filter((booking) => booking.status === filter);

  const countFor = useCallback(
    (filterType: FilterType) =>
      filterType === 'all' ? bookings.length : bookings.filter((booking) => booking.status === filterType).length,
    [bookings],
  );

  const openCreateBooking = useCallback(() => {
    const tabNavigation = navigation.getParent?.() as BottomTabNavigationProp<CustomerTabParamList> | undefined;

    if (tabNavigation) {
      tabNavigation.navigate('Bookings', { screen: 'CreateBooking' });
      return;
    }

    navigation.navigate('CreateBooking');
  }, [navigation]);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <CustomerAmbientBackground />

      <StaggeredView delay={20} style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>{t('myBookings')}</Text>
          <Text style={styles.headerSubtitle}>Manage your parking reservations</Text>
        </View>
        <NewBookingButton onPress={openCreateBooking} />
      </StaggeredView>

      <View style={[workflowStyles.row, { paddingHorizontal: 20, paddingBottom: 12 }]}>
        <WorkflowChip onPress={() => navigation.getParent()?.navigate('Bookings', { screen: 'FindParking' })}>Parking map</WorkflowChip>
        <WorkflowChip onPress={() => navigation.getParent()?.navigate('Bookings', { screen: 'BookingCart' })}>Booking cart ({cart.items.length})</WorkflowChip>
        <WorkflowChip onPress={() => navigation.getParent()?.navigate('Bookings', { screen: 'BookingAssistant' })}>AI assistant</WorkflowChip>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filtersWrap}
        style={styles.filterScroll}
      >
        {FILTERS.map((filterType) => (
          <FilterChip
            key={filterType}
            active={filter === filterType}
            count={countFor(filterType)}
            filterType={filterType}
            onPress={() => setFilter(filterType)}
          />
        ))}
      </ScrollView>

      {error ? (
        <ErrorState message={error} onRetry={fetchBookings} />
      ) : isLoading && bookings.length === 0 ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={COLORS.gold} size="large" />
          <Text style={styles.loadingText}>Loading bookings...</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={filtered}
          keyExtractor={(item) => item._id}
          ListEmptyComponent={!isLoading ? <EmptyBookings filter={filter} onCreate={openCreateBooking} /> : null}
          refreshControl={
            <RefreshControl refreshing={isLoading} tintColor={COLORS.gold} colors={[COLORS.gold]} onRefresh={fetchBookings} />
          }
          renderItem={({ item, index }) => (
            <BookingRow
              booking={item}
              index={index}
              onPress={() => navigation.navigate('BookingDetail', { bookingId: item._id })}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: SPACING.md,
    justifyContent: 'space-between',
    paddingBottom: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    color: COLORS.textPrimary,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 36,
  },
  headerSubtitle: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '500',
    marginTop: 3,
  },
  newBtn: {
    borderRadius: RADIUS.md,
    maxWidth: 148,
    minWidth: 118,
  },
  newBtnGrad: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    gap: 6,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  newBtnCompact: {
    minHeight: 46,
    paddingHorizontal: SPACING.lg,
  },
  newBtnText: {
    color: COLORS.textInverse,
    flexShrink: 1,
    fontSize: FONT_SIZES.sm,
    fontWeight: '900',
  },
  filterScroll: {
    flexGrow: 0,
    maxHeight: 50,
  },
  filtersWrap: {
    alignItems: 'center',
    gap: SPACING.sm,
    paddingBottom: 4,
    paddingHorizontal: SPACING.lg,
  },
  filterPress: {
    borderRadius: RADIUS.round,
  },
  filterPill: {
    alignItems: 'center',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 14,
  },
  filterText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
  },
  filterBadge: {
    alignItems: 'center',
    borderRadius: 9,
    height: 18,
    justifyContent: 'center',
    minWidth: 18,
    paddingHorizontal: 4,
  },
  filterBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  listContent: {
    paddingBottom: 118,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  bookingWrap: {
    marginBottom: SPACING.xl,
  },
  bookingRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    minHeight: 128,
    paddingHorizontal: SPACING.xs,
    paddingVertical: SPACING.sm,
  },
  timelineDot: {
    borderRadius: 5,
    height: 10,
    marginTop: 7,
    width: 10,
  },
  bookingBody: {
    flex: 1,
    minWidth: 0,
  },
  bookingTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: SPACING.md,
    justifyContent: 'space-between',
  },
  bookingTimeBlock: {
    flex: 1,
    minWidth: 0,
  },
  bookingDate: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  bookingTime: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 3,
  },
  amount: {
    color: COLORS.gold,
    fontSize: 18,
    fontWeight: '900',
    maxWidth: 118,
    textAlign: 'right',
  },
  slotCode: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    marginTop: SPACING.md,
  },
  floorLabel: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
  bookingFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  platePill: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderRadius: RADIUS.round,
    flexDirection: 'row',
    gap: 5,
    maxWidth: 120,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
  },
  plateText: {
    color: COLORS.textSecondary,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  rowDivider: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    height: StyleSheet.hairlineWidth,
    marginLeft: 26,
    marginTop: SPACING.sm,
  },
  empty: {
    alignItems: 'center',
    minHeight: 420,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xxl,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 40,
    borderWidth: 1,
    height: 80,
    justifyContent: 'center',
    marginBottom: SPACING.lg,
    width: 80,
  },
  emptyTitle: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '900',
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: SPACING.lg,
  },
  loadingState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: SPACING.xxl,
  },
  loadingText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.sm,
    marginTop: SPACING.md,
  },
});
