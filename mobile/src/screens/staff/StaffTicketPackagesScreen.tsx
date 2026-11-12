import { useLanguage } from '@/contexts/LanguageContext';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState } from '@/components/common';
import {
  FadeInView,
  InfoBanner,
  OperationalRow,
  SectionTitle,
  SkeletonBlock,
  StaffHeader,
  StatusBadge,
} from '@/components/staff';
import { COLORS, SPACING } from '@/constants/theme';
import type { StaffManagementStackParamList } from '@/navigation/StaffNavigator';
import { staffService, type TicketPackage } from '@/services/api/staff';

type Props = NativeStackScreenProps<StaffManagementStackParamList, 'TicketPackages'>;

const TYPE_TONES: Record<TicketPackage['type'], 'info' | 'brand' | 'warning'> = {
  hourly: 'info',
  daily: 'info',
  monthly: 'brand',
  yearly: 'warning',
};

export function StaffTicketPackagesScreen({ navigation }: Props) {
  const { t: translateUi } = useLanguage();
  const [items, setItems] = useState<TicketPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await staffService.getTicketPackages();
      setItems(response.data ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load ticket packages.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <StaffHeader
        eyebrow="Catalog"
        title={translateUi("Ticket packages")}
        subtitle={translateUi("Package catalog")}
        onBack={() => navigation.navigate('ManagementHome')}
        right={<StatusBadge label={`${items.length} plans`} />}
      />

      {loading ? (
        <TicketSkeleton />
      ) : error ? (
        <ErrorState message={translateUi(error)} onRetry={load} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={COLORS.gold} onRefresh={refresh} />}
          showsVerticalScrollIndicator={false}
        >
          <InfoBanner
            icon="eye-outline"
            message={translateUi("Packages are maintained by administrators; staff can inspect active plans for customer support.")}
            title={translateUi("View-only access")}
          />
          <SectionTitle title={translateUi("Packages")} detail="Type · price · status" />
          {items.length === 0 ? (
            <EmptyState icon="ticket-outline" title={translateUi("No ticket packages")} message={translateUi("No ticket packages are currently configured.")} accentColor={COLORS.gold} />
          ) : (
            <View style={styles.list}>
              {items.map((item, index) => {
                const tone = item.isActive ? TYPE_TONES[item.type] : 'muted';
                return (
                  <FadeInView delay={Math.min(index * 35, 220)} key={item._id}>
                    <OperationalRow
                      icon="ticket-outline"
                      meta={item.isActive ? 'Active' : 'Inactive'}
                      subtitle={`${item.type === 'monthly' ? '30 days (720 hours)' : item.type === 'yearly' ? '12 calendar months' : item.type.toUpperCase()} · ${item.price.toLocaleString('vi-VN')} VND / ${item.service === 'RESERVED_PAID' ? 'Reserved space; standard parking fees' : item.service === 'RESERVED_FREE' ? 'Base parking included while effective' : 'Legacy purchased terms'}${item.description ? ` · ${item.description}` : ''}`}
                      title={item.name}
                      tone={tone}
                      right={<StatusBadge label={item.type} tone={tone} />}
                    />
                  </FadeInView>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function TicketSkeleton() {
  return (
    <View style={styles.skeleton}>
      {[0, 1, 2, 3].map((item) => (
        <View key={item} style={styles.skeletonRow}>
          <SkeletonBlock height={18} width="46%" />
          <SkeletonBlock height={14} width="70%" />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: COLORS.background, flex: 1 },
  scroll: { gap: SPACING.lg, padding: SPACING.lg, paddingBottom: 112 },
  list: { borderTopColor: COLORS.border, borderTopWidth: StyleSheet.hairlineWidth },
  skeleton: { gap: SPACING.md, padding: SPACING.lg },
  skeletonRow: { gap: SPACING.sm, minHeight: 68 },
});
