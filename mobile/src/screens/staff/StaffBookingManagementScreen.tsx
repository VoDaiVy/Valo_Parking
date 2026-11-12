import { useLanguage } from '@/contexts/LanguageContext';
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { addDays, format, subDays } from 'date-fns';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState } from '@/components/common';
import { StaffHeader, StatusBadge } from '@/components/staff';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import type { StaffManagementStackParamList } from '@/navigation/StaffNavigator';
import { staffService, type StaffBooking } from '@/services/api/staff';
import { formatCurrency } from '@/utils/formatters';
import {
  getStaffBookingGroup,
  groupAndSortStaffBookings,
  type StaffBookingGroup,
} from '@/utils/staffBookingGroups';

type Props = NativeStackScreenProps<StaffManagementStackParamList, 'Bookings'>;
type BookingFilter = 'ALL' | StaffBookingGroup;

interface BookingSection {
  key: StaffBookingGroup;
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  data: StaffBooking[];
}

const FILTERS: BookingFilter[] = ['ALL', 'ACTIVE', 'UPCOMING', 'HISTORY'];
const SECTION_META: Record<
  StaffBookingGroup,
  Omit<BookingSection, 'key' | 'data'>
> = {
  ACTIVE: {
    title: 'Currently parked',
    subtitle: 'Requires attention now',
    icon: 'pulse-outline',
    color: COLORS.success,
  },
  UPCOMING: {
    title: 'Arriving soon',
    subtitle: 'Nearest arrival first',
    icon: 'time-outline',
    color: COLORS.warning,
  },
  HISTORY: {
    title: 'History',
    subtitle: 'Most recent first',
    icon: 'checkmark-circle-outline',
    color: COLORS.textMuted,
  },
};

const statusColor = (status: string) => {
  const normalizedStatus = status.toUpperCase();
  if (normalizedStatus === 'ACTIVE') return COLORS.success;
  if (normalizedStatus === 'PAUSED') return COLORS.warning;
  if (normalizedStatus === 'PAID') return COLORS.staffBlue;
  if (normalizedStatus === 'CANCELLED' || normalizedStatus === 'EXPIRED') return COLORS.error;
  if (normalizedStatus === 'COMPLETED') return COLORS.success;
  return COLORS.warning;
};

const getDurationProgress = (start: string, end: string) => {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  const duration = endTime - startTime;

  if (!Number.isFinite(duration) || duration <= 0) return 0;

  return Math.min(100, Math.max(0, Math.round(((Date.now() - startTime) / duration) * 100)));
};

export function StaffBookingManagementScreen({ navigation }: Props) {
  const { t: translateUi } = useLanguage();
  const tabBarHeight = useBottomTabBarHeight();
  const [date, setDate] = useState(new Date());
  const [bookings, setBookings] = useState<StaffBooking[]>([]);
  const [filter, setFilter] = useState<BookingFilter>('ALL');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<StaffBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await staffService.getBookings({ date: format(date, 'yyyy-MM-dd') });
      setBookings(response.data ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load bookings.');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const searchedBookings = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return bookings;

    return bookings.filter((booking) => {
      const customer = booking.userId?.fullName || booking.userId?.email || '';
      return [booking.licensePlate, booking.parkingSlot, customer].some((value) =>
        value.toLowerCase().includes(needle),
      );
    });
  }, [bookings, query]);

  const grouped = useMemo(
    () => groupAndSortStaffBookings(searchedBookings),
    [searchedBookings],
  );

  const allCounts = useMemo(() => groupAndSortStaffBookings(bookings), [bookings]);

  const sections = useMemo(
    () =>
      (['ACTIVE', 'UPCOMING', 'HISTORY'] as StaffBookingGroup[])
        .filter((group) => filter === 'ALL' || filter === group)
        .map((group) => ({
          key: group,
          ...SECTION_META[group],
          data: grouped[group],
        }))
        .filter((section) => section.data.length > 0),
    [filter, grouped],
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <StaffHeader
        eyebrow="Verification"
        title={translateUi("Booking Management")}
        onBack={() => navigation.navigate('ManagementHome')}
        right={<TouchableOpacity
          accessibilityLabel={translateUi("Scan booking QR")}
          accessibilityRole="button"
          onPress={() => navigation.navigate('BookingScanner')}
          style={styles.scanButton}
        >
          <Ionicons name="qr-code-outline" size={22} color={COLORS.textInverse} />
        </TouchableOpacity>}
      />
      <View style={styles.headerStatus}>
        <StatusBadge label={`${allCounts.ACTIVE.length} active`} tone="success" />
        <StatusBadge label={`${allCounts.UPCOMING.length} upcoming`} tone="warning" />
      </View>

      <View style={styles.dateBar}>
        <TouchableOpacity
          accessibilityLabel={translateUi("Previous day")}
          onPress={() => setDate((current) => subDays(current, 1))}
          style={styles.dateButton}
        >
          <Ionicons name="chevron-back" size={20} color={COLORS.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setDate(new Date())} style={styles.dateCopy}>
          <Text style={styles.dateTitle}>{format(date, 'EEEE')}</Text>
          <Text style={styles.dateValue}>{format(date, 'dd MMM yyyy')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel={translateUi("Next day")}
          onPress={() => setDate((current) => addDays(current, 1))}
          style={styles.dateButton}
        >
          <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.summary}>
        <SummaryMetric label={translateUi("Active")} value={allCounts.ACTIVE.length} color={COLORS.success} />
        <View style={styles.summaryDivider} />
        <SummaryMetric label={translateUi("Upcoming")} value={allCounts.UPCOMING.length} color={COLORS.warning} />
        <View style={styles.summaryDivider} />
        <SummaryMetric label={translateUi("Total")} value={bookings.length} color={COLORS.textPrimary} />
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color={COLORS.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={translateUi("Plate, space, or customer")}
          placeholderTextColor={COLORS.textMuted}
          style={styles.searchInput}
        />
        {query ? (
          <TouchableOpacity
            accessibilityLabel={translateUi("Clear search")}
            onPress={() => setQuery('')}
            style={styles.clearSearch}
          >
            <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
        style={styles.filterScroll}
      >
        {FILTERS.map((item) => {
          const count =
            item === 'ALL' ? searchedBookings.length : grouped[item as StaffBookingGroup].length;
          const isActive = filter === item;

          return (
            <Pressable
              key={item}
              onPress={() => setFilter(item)}
              style={[styles.filter, isActive && styles.filterActive]}
            >
              <Text style={[styles.filterText, isActive && styles.filterTextActive]}>
                {item.charAt(0) + item.slice(1).toLowerCase()}
              </Text>
              <View style={[styles.filterCount, isActive && styles.filterCountActive]}>
                <Text style={[styles.filterCountText, isActive && styles.filterCountTextActive]}>
                  {count}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.staffBlue} size="large" />
        </View>
      ) : error ? (
        <ErrorState message={translateUi(error)} onRetry={load} />
      ) : (
        <SectionList
          key={filter}
          sections={sections}
          keyExtractor={(item) => item._id}
          contentContainerStyle={[styles.list, { paddingBottom: tabBarHeight + SPACING.lg }, sections.length === 0 && styles.emptyList]}
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={COLORS.staffBlue}
              onRefresh={refresh}
            />
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionIcon, { backgroundColor: `${section.color}18` }]}>
                <Ionicons name={section.icon} size={17} color={section.color} />
              </View>
              <View style={styles.sectionCopy}>
                <Text style={[styles.sectionTitle, { color: section.color }]}>
                  {section.title}
                </Text>
                <Text style={styles.sectionSubtitle}>{section.subtitle}</Text>
              </View>
              <View style={[styles.sectionCount, { borderColor: `${section.color}55` }]}>
                <Text style={[styles.sectionCountText, { color: section.color }]}>
                  {section.data.length}
                </Text>
              </View>
            </View>
          )}
          renderItem={({ item }) => (
            <BookingCard booking={item} onPress={() => setSelected(item)} />
          )}
          ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
          SectionSeparatorComponent={() => <View style={styles.sectionSeparator} />}
          ListEmptyComponent={
            <EmptyState
              icon="calendar-outline"
              title={translateUi("No bookings found")}
              message={query ? 'Try a different search or filter.' : 'Try another date or filter.'}
              accentColor={COLORS.staffBlue}
            />
          }
        />
      )}

      <Modal
        animationType="slide"
        transparent
        visible={Boolean(selected)}
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>{selected?.licensePlate}</Text>
                <Text style={styles.sheetSub}>{translateUi("Booking details")}</Text>
              </View>
              <TouchableOpacity
                accessibilityLabel={translateUi("Close booking details")}
                onPress={() => setSelected(null)}
                style={styles.close}
              >
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <Detail
              label={translateUi("Customer")}
              value={selected?.userId?.fullName || selected?.userId?.email || 'Guest'}
            />
            <Detail
              label={translateUi("Parking space")}
              value={`${typeof selected?.floorId === 'object' ? selected.floorId?.name || 'Floor' : 'Floor'} / ${selected?.parkingSlot || '--'}`}
            />
            <Detail
              label={translateUi("Schedule")}
              value={
                selected
                  ? `${format(new Date(selected.scheduledStart), 'dd MMM, HH:mm')} - ${format(new Date(selected.scheduledEnd), 'dd MMM, HH:mm')}`
                  : '--'
              }
            />
            <Detail
              label={translateUi("Payment")}
              value={`${selected?.paymentMethod || 'Wallet'} / ${formatCurrency(selected?.prepaidAmount ?? 0)}`}
            />
            <Detail label={translateUi("Status")} value={selected?.status || '--'} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SummaryMetric({ label, value, color }: { label: string; value: number; color: string }) {
  const { t: translateUi } = useLanguage();
  return (
    <View style={styles.summaryMetric}>
      <Text style={styles.summaryLabel}>{translateUi(label)}</Text>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
    </View>
  );
}

function BookingCard({ booking, onPress }: { booking: StaffBooking; onPress: () => void }) {
  const { t: translateUi } = useLanguage();
  const color = statusColor(booking.status);
  const group = getStaffBookingGroup(booking.status);
  const floor =
    typeof booking.floorId === 'string'
      ? 'Floor'
      : booking.floorId?.name || `Floor ${booking.floorId?.floorNumber ?? ''}`;
  const progress =
    group === 'ACTIVE'
      ? getDurationProgress(booking.scheduledStart, booking.scheduledEnd)
      : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View booking ${booking.licensePlate}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.accent, { backgroundColor: color }]} />
      <View style={styles.cardHeader}>
        <View style={styles.bookingIdentity}>
          <View style={styles.plateBadge}>
            <Text style={styles.plate}>{booking.licensePlate}</Text>
          </View>
          <Text style={styles.customer} numberOfLines={1}>
            {booking.userId?.fullName || booking.userId?.email || 'Guest'}
          </Text>
        </View>
        <View style={[styles.status, { backgroundColor: `${color}18`, borderColor: `${color}88` }]}>
          <Text style={[styles.statusText, { color }]}>{booking.status}</Text>
        </View>
      </View>

      <View style={styles.routeRow}>
        <View style={styles.routeItem}>
          <Ionicons name="location-outline" size={15} color={COLORS.gold} />
          <Text style={styles.routeText}>
            {floor} / {booking.parkingSlot}
          </Text>
        </View>
        <View style={styles.routeItem}>
          <Ionicons name="time-outline" size={15} color={COLORS.staffBlue} />
          <Text style={styles.routeText}>
            {format(new Date(booking.scheduledStart), 'HH:mm')} -{' '}
            {format(new Date(booking.scheduledEnd), 'HH:mm')}
          </Text>
        </View>
      </View>

      {progress !== null ? (
        <View style={styles.progressWrap}>
          <View style={styles.progressCopy}>
            <View style={styles.liveLabel}>
              <View style={styles.liveDot} />
              <Text style={styles.progressLabel}>{translateUi("Duration progress")}</Text>
            </View>
            <Text style={styles.progressValue}>{progress}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const { t: translateUi } = useLanguage();
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{translateUi(label)}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  scanButton: {
    alignItems: 'center',
    backgroundColor: COLORS.staffBlue,
    borderRadius: RADIUS.md,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  headerStatus: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingBottom: SPACING.xs,
    paddingHorizontal: SPACING.md,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  dateBar: {
    alignItems: 'center',
    flexDirection: 'row',
    marginHorizontal: SPACING.md,
    marginTop: SPACING.xs,
  },
  dateButton: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  dateCopy: {
    alignItems: 'center',
    flex: 1,
  },
  dateTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
  dateValue: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginTop: 2,
  },
  summary: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderTopColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  summaryMetric: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
  },
  summaryLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
  },
  summaryValue: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
  },
  summaryDivider: {
    backgroundColor: COLORS.border,
    height: 28,
    width: 1,
  },
  searchWrap: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    minHeight: 46,
    paddingHorizontal: SPACING.sm,
  },
  searchInput: {
    color: COLORS.textPrimary,
    flex: 1,
    fontSize: FONT_SIZES.sm,
  },
  clearSearch: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    marginRight: -SPACING.sm,
    width: 44,
  },
  filterScroll: {
    flexGrow: 0,
    height: 48,
    marginBottom: SPACING.md,
    marginTop: SPACING.sm,
    maxHeight: 48,
  },
  filters: {
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  filter: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 40,
    paddingHorizontal: SPACING.md,
  },
  filterActive: {
    backgroundColor: `${COLORS.staffBlue}14`,
    borderColor: COLORS.staffBlue,
  },
  filterText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  filterTextActive: {
    color: COLORS.staffBlue,
  },
  filterCount: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.round,
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  filterCountActive: {
    backgroundColor: `${COLORS.staffBlue}22`,
  },
  filterCountText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
  },
  filterCountTextActive: {
    color: COLORS.staffBlue,
  },
  list: {
    paddingBottom: SPACING.xxl,
    paddingHorizontal: SPACING.md,
    paddingTop: 0,
  },
  emptyList: {
    flexGrow: 1,
  },
  sectionHeader: {
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingBottom: SPACING.sm,
    paddingTop: 0,
  },
  sectionIcon: {
    alignItems: 'center',
    borderRadius: RADIUS.sm,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  sectionCopy: {
    flex: 1,
    marginLeft: SPACING.sm,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginTop: 1,
  },
  sectionCount: {
    alignItems: 'center',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    minWidth: 28,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
  },
  sectionCountText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
  },
  itemSeparator: {
    height: SPACING.xs,
  },
  sectionSeparator: {
    height: SPACING.md,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: SPACING.sm,
    overflow: 'hidden',
    padding: SPACING.sm,
  },
  pressed: {
    backgroundColor: COLORS.surfaceElevated,
    transform: [{ scale: 0.98 }],
  },
  accent: {
    bottom: SPACING.md,
    left: 0,
    position: 'absolute',
    top: SPACING.md,
    width: 3,
  },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'space-between',
  },
  bookingIdentity: {
    flex: 1,
    gap: 5,
  },
  plateBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.background,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
  },
  plate: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
    letterSpacing: 1,
  },
  customer: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
  },
  status: {
    borderRadius: RADIUS.round,
    borderWidth: 1,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
  },
  statusText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
  },
  routeRow: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    gap: 7,
    padding: SPACING.sm,
  },
  routeItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  routeText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.xs,
  },
  progressWrap: {
    gap: 7,
  },
  progressCopy: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  liveLabel: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  liveDot: {
    backgroundColor: COLORS.success,
    borderRadius: RADIUS.round,
    height: 6,
    width: 6,
  },
  progressLabel: {
    color: COLORS.success,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  progressValue: {
    color: COLORS.success,
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
  },
  progressTrack: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.round,
    height: 5,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: COLORS.success,
    borderRadius: RADIUS.round,
    height: '100%',
  },
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.68)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  sheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  sheetTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.xl,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  sheetSub: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginTop: 2,
  },
  close: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  detail: {
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingVertical: SPACING.sm,
  },
  detailLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
  },
  detailValue: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
});
