import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  FlatList,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
import { staffService, type StaffSession } from '@/services/api/staff';

export type StaffSessionStackParamList = {
  SessionList: undefined;
  SessionDetail: { session: ActiveSession };
};

export type ActiveSession = StaffSession;

type Props = NativeStackScreenProps<StaffSessionStackParamList, 'SessionList'>;
type FilterType = 'active' | 'completed' | 'all';

const SOURCE_LABELS: Record<string, string> = {
  kiosk: 'Kiosk',
  app_booking: 'App',
  booking: 'Booked',
  staff_manual: 'Staff',
  walk_in: 'Walk-in',
};

function elapsedLabel(session: ActiveSession) {
  const end = session.checkOutTime ? new Date(session.checkOutTime).getTime() : Date.now();
  const elapsed = Math.max(0, Math.floor((end - new Date(session.checkInTime).getTime()) / 60000));
  const hours = Math.floor(elapsed / 60);
  const mins = elapsed % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function SessionOperationalRow({ session, index, onPress }: { session: ActiveSession; index: number; onPress: () => void }) {
  const isActive = session.status === 'active';
  const tone = isActive ? 'success' : 'muted';
  const accent = staffToneColor(tone);

  return (
    <FadeInView delay={Math.min(index * 28, 180)}>
      <AnimatedPressable row onPress={onPress}>
        <View style={styles.sessionRow}>
          <View style={styles.plateColumn}>
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.plateText}>
              {session.licensePlate}
            </Text>
            <Text numberOfLines={1} style={styles.rowMeta}>
              {session.parkingSlot ?? 'No space'} / {SOURCE_LABELS[session.source ?? ''] ?? session.source ?? 'Unknown'}
            </Text>
          </View>
          <View style={styles.statusColumn}>
            <View style={[styles.statusPill, { backgroundColor: `${accent}14`, borderColor: `${accent}44` }]}>
              <View style={[styles.statusDot, { backgroundColor: accent }]} />
              <Text style={[styles.statusText, { color: accent }]}>{isActive ? 'Active' : 'Done'}</Text>
            </View>
            <Text numberOfLines={1} style={styles.durationText}>{elapsedLabel(session)}</Text>
          </View>
          <View style={styles.detailColumn}>
            <Text numberOfLines={1} style={styles.timeText}>{format(new Date(session.checkInTime), 'HH:mm dd/MM')}</Text>
            {session.phone ? <Text numberOfLines={1} style={styles.phoneText}>{session.phone}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={17} color={COLORS.textMuted} />
        </View>
      </AnimatedPressable>
    </FadeInView>
  );
}

export const SessionListScreen = ({ navigation }: Props) => {
  const tabBarHeight = useBottomTabBarHeight();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await staffService.getSessions();
      setSessions(res.data ?? []);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load parking sessions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filtered = filter === 'all' ? sessions : sessions.filter((session) => session.status === filter);
  const activeCount = sessions.filter((session) => session.status === 'active').length;
  const completedCount = sessions.filter((session) => session.status === 'completed').length;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <StaffHeader
        eyebrow="Sessions"
        title="Parking activity"
        right={<StatusBadge label={`${activeCount} active`} tone="success" />}
      />

      <View style={styles.summaryWrap}>
        <MetricStrip>
          <OperationalMetric icon="pulse-outline" label="Active" tone="success" value={activeCount} />
          <OperationalMetric icon="checkmark-circle-outline" label="Completed" tone="muted" value={completedCount} />
          <OperationalMetric icon="albums-outline" label="Total" value={sessions.length} />
        </MetricStrip>
      </View>

      <View style={styles.filterRow}>
        {(['active', 'completed', 'all'] as FilterType[]).map((item) => {
          const active = filter === item;
          return (
            <AnimatedPressable key={item} onPress={() => setFilter(item)} style={[styles.filterTab, active && styles.filterTabActive]}>
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {item === 'active' ? 'Active' : item === 'completed' ? 'Completed' : 'All'}
              </Text>
            </AnimatedPressable>
          );
        })}
      </View>

      {loading ? (
        <SessionSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item._id}
          contentContainerStyle={[styles.listContent, { paddingBottom: tabBarHeight + SPACING.lg }]}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={COLORS.gold} colors={[COLORS.gold]} onRefresh={onRefresh} />}
          renderItem={({ item, index }) => (
            <SessionOperationalRow
              index={index}
              session={item}
              onPress={() => navigation.navigate('SessionDetail', { session: item })}
            />
          )}
          ListEmptyComponent={<EmptyState icon="car-outline" title="No sessions found" message="No sessions match the current filter." accentColor={COLORS.gold} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
};

function SessionSkeleton() {
  return (
    <View style={styles.skeleton}>
      {[0, 1, 2, 3, 4].map((item) => (
        <View key={item} style={styles.skeletonRow}>
          <SkeletonBlock height={20} width="28%" />
          <SkeletonBlock height={14} width="38%" />
          <SkeletonBlock height={14} width="22%" />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: COLORS.background, flex: 1 },
  summaryWrap: { paddingHorizontal: SPACING.lg },
  filterRow: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 2,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    minHeight: 46,
    padding: 3,
  },
  filterTab: {
    alignItems: 'center',
    borderRadius: RADIUS.round,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
  },
  filterTabActive: { backgroundColor: 'rgba(226,186,75,0.16)' },
  filterText: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '900', textTransform: 'uppercase' },
  filterTextActive: { color: COLORS.gold },
  listContent: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  sessionRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.sm,
    minHeight: 64,
    paddingVertical: SPACING.xs,
  },
  plateColumn: { flex: 1.18, minWidth: 0 },
  statusColumn: { alignItems: 'flex-start', flex: 0.62, gap: 4, minWidth: 66 },
  detailColumn: { alignItems: 'flex-end', flex: 0.78, minWidth: 0 },
  plateText: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '900', letterSpacing: 0.4 },
  rowMeta: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 3 },
  phoneText: { color: COLORS.textMuted, fontSize: 10, marginTop: 3 },
  statusPill: {
    alignItems: 'center',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    minHeight: 24,
    paddingHorizontal: SPACING.sm,
  },
  statusDot: { borderRadius: 3, height: 6, width: 6 },
  statusText: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  durationText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, fontWeight: '900' },
  timeText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, fontWeight: '800' },
  skeleton: { gap: SPACING.md, padding: SPACING.lg },
  skeletonRow: {
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: SPACING.sm,
    minHeight: 64,
    paddingVertical: SPACING.sm,
  },
});
