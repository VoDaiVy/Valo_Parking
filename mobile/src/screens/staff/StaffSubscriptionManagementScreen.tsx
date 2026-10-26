import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState } from '@/components/common';
import {
  AnimatedPressable,
  FadeInView,
  MetricStrip,
  OperationalMetric,
  SkeletonBlock,
  StaffHeader,
  StatusBadge,
  staffToneColor,
} from '@/components/staff';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import type { StaffManagementStackParamList } from '@/navigation/StaffNavigator';
import { statisticsService, type AdminSubscriptionStatistics } from '@/services/api/statistics';
import { staffService, type StaffSubscription } from '@/services/api/staff';
import { formatCurrency } from '@/utils/formatters';

type Props = NativeStackScreenProps<StaffManagementStackParamList, 'Subscriptions'>;
const FILTERS = ['all', 'active', 'pending', 'expired', 'cancelled'] as const;

const statusTone = (status: string) => {
  if (status === 'active') return 'success' as const;
  if (status === 'pending') return 'warning' as const;
  if (status === 'expired' || status === 'cancelled') return 'danger' as const;
  return 'muted' as const;
};

function MembershipRow({
  amount,
  email,
  plates,
  status,
  title,
}: {
  amount: string;
  email: string;
  plates: string;
  status: string;
  title: string;
}) {
  const tone = statusTone(status);
  const accent = staffToneColor(tone);

  return (
    <AnimatedPressable row>
      <View style={styles.membershipRow}>
        <View style={[styles.membershipIcon, { backgroundColor: `${accent}14` }]}>
          <Ionicons name="diamond-outline" size={19} color={accent} />
        </View>
        <View style={styles.membershipCopy}>
          <Text numberOfLines={1} style={styles.membershipTitle}>{title}</Text>
          <Text numberOfLines={1} style={styles.membershipMeta}>{email}</Text>
          <Text numberOfLines={1} style={styles.membershipMeta}>{plates}</Text>
        </View>
        <View style={styles.membershipRight}>
          <Text numberOfLines={1} style={styles.amountText}>{amount}</Text>
          <StatusBadge label={status} tone={tone} />
        </View>
      </View>
    </AnimatedPressable>
  );
}

export function StaffSubscriptionManagementScreen({ navigation }: Props) {
  const tabBarHeight = useBottomTabBarHeight();
  const [items, setItems] = useState<StaffSubscription[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [statistics, setStatistics] = useState<AdminSubscriptionStatistics | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [subscriptionsResult, statisticsResult] = await Promise.allSettled([
        staffService.getSubscriptions(),
        statisticsService.getAdminSubscriptions('30d'),
      ]);
      if (subscriptionsResult.status === 'rejected') throw subscriptionsResult.reason;
      setItems(subscriptionsResult.value.data ?? []);
      if (statisticsResult.status === 'fulfilled') setStatistics(statisticsResult.value.data ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load subscriptions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => items.filter((item) => {
      const needle = query.trim().toLowerCase();
      const matchesSearch = !needle || [item.user?.username, item.user?.email, ...(item.user?.vehicles ?? [])]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(needle));
      return matchesSearch && (filter === 'all' || item.status === filter);
    }),
    [filter, items, query],
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <StaffHeader
        eyebrow="Memberships"
        title="VIP memberships"
        onBack={() => navigation.navigate('ManagementHome')}
        right={<StatusBadge label={`${items.length} total`} />}
      />

      {statistics ? (
        <FadeInView style={styles.summary}>
          <MetricStrip>
            <OperationalMetric icon="diamond-outline" label="Active" tone="success" value={statistics.summary.active} />
            <OperationalMetric icon="timer-outline" label="Expiring" tone="warning" value={statistics.summary.expiringWithin7Days} />
            <OperationalMetric icon="repeat-outline" label="Renewal" value={`${statistics.summary.renewalRate}%`} />
          </MetricStrip>
        </FadeInView>
      ) : null}

      <FadeInView delay={45} style={styles.search}>
        <Ionicons name="search-outline" size={17} color={COLORS.textMuted} />
        <TextInput
          accessibilityLabel="Search memberships"
          onChangeText={setQuery}
          placeholder="Customer, email, or license plate"
          placeholderTextColor={COLORS.textMuted}
          style={styles.searchInput}
          value={query}
        />
      </FadeInView>

      <ScrollView horizontal style={styles.filterScroll} contentContainerStyle={styles.filters} showsHorizontalScrollIndicator={false}>
        {FILTERS.map((item) => {
          const active = filter === item;
          return (
            <AnimatedPressable key={item} onPress={() => setFilter(item)} style={[styles.filter, active && styles.filterActive]}>
              <Text numberOfLines={1} style={[styles.filterText, active && styles.filterTextActive]}>
                {item.charAt(0).toUpperCase() + item.slice(1)}
              </Text>
            </AnimatedPressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <SubscriptionSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item._id}
          contentContainerStyle={[styles.list, { paddingBottom: tabBarHeight + SPACING.lg }]}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={COLORS.gold} onRefresh={refresh} />}
          renderItem={({ item, index }) => (
            <FadeInView delay={Math.min(index * 28, 180)}>
              <MembershipRow
                amount={formatCurrency(item.amount)}
                email={item.user?.email || 'No email'}
                plates={(item.user?.vehicles ?? []).join(', ') || 'No vehicle'}
                status={item.status}
                title={item.user?.username || item.ticketPackage?.name || 'Unknown customer'}
              />
            </FadeInView>
          )}
          ListEmptyComponent={<EmptyState icon="diamond-outline" title="No memberships found" message="Try a different search or status." />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

function SubscriptionSkeleton() {
  return (
    <View style={styles.skeleton}>
      {[0, 1, 2, 3, 4].map((item) => (
        <View key={item} style={styles.skeletonRow}>
          <SkeletonBlock height={18} width="50%" />
          <SkeletonBlock height={14} width="84%" />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: COLORS.background, flex: 1 },
  summary: { paddingHorizontal: SPACING.lg },
  search: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    minHeight: 50,
    paddingHorizontal: SPACING.sm,
  },
  searchInput: { color: COLORS.textPrimary, flex: 1, fontSize: FONT_SIZES.sm },
  filterScroll: { flexGrow: 0, flexShrink: 0, minHeight: 68 },
  filters: { alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingVertical: 12 },
  filter: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 78,
    paddingHorizontal: SPACING.md,
  },
  filterActive: {
    backgroundColor: 'rgba(226,186,75,0.12)',
    borderColor: COLORS.gold,
    shadowColor: COLORS.gold,
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  filterText: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '800' },
  filterTextActive: { color: COLORS.gold },
  list: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  membershipRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 72,
    paddingVertical: SPACING.sm,
  },
  membershipIcon: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  membershipCopy: { flex: 1, minWidth: 0 },
  membershipTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '900' },
  membershipMeta: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 },
  membershipRight: { alignItems: 'flex-end', gap: 5, maxWidth: 116 },
  amountText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, fontWeight: '900' },
  skeleton: { gap: SPACING.md, padding: SPACING.lg },
  skeletonRow: {
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: SPACING.sm,
    minHeight: 72,
    paddingVertical: SPACING.sm,
  },
});
