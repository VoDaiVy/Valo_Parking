import { getPackageDurationLabel } from '@/utils/ticketPackageRules';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, type CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/common';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CustomerTabParamList } from '@/navigation/CustomerNavigator';
import type { WalletStackParamList } from '@/navigation/types';
import { ticketPackagesService } from '@/services/api/ticketPackages';
import type { ExplorePackageCatalog, ExploreTicketPackage, TicketPackageType } from '@/types/ticketPackage.types';
import { formatCurrency } from '@/utils/formatters';

type Props = CompositeScreenProps<
  NativeStackScreenProps<WalletStackParamList, 'ExplorePackages'>,
  BottomTabScreenProps<CustomerTabParamList, 'WalletTab'>
>;

const TYPES: Array<TicketPackageType | 'all'> = ['all', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'custom'];
const TYPE_COPY = {
  all: { en: 'All', vi: 'Tất cả' },
  hourly: { en: 'Hourly', vi: 'Theo giờ' },
  daily: { en: 'Daily', vi: 'Theo ngày' },
  weekly: { en: 'Weekly', vi: 'Theo tuần' },
  monthly: { en: 'Monthly', vi: 'Theo tháng' },
  yearly: { en: 'Yearly', vi: 'Theo năm' },
  custom: { en: 'Custom', vi: 'Tùy chỉnh' },
};
const UNITS = {
  hourly: { en: '/ hour', vi: '/ giờ' },
  daily: { en: '/ day / space', vi: '/ ngày / chỗ' },
  weekly: { en: '/ week / space', vi: '/ tuần / chỗ' },
  monthly: { en: '/ month / space', vi: '/ tháng / chỗ' },
  yearly: { en: '/ year / space', vi: '/ năm / chỗ' },
  custom: { en: '/ package / space', vi: '/ gói / chỗ' },
};

export function ExplorePackagesScreen({ navigation }: Props) {
  const { language } = useLanguage();
  const [type, setType] = useState<TicketPackageType | 'all'>('all');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [catalog, setCatalog] = useState<ExplorePackageCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const vi = language === 'vi';

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await ticketPackagesService.getExplore({ type, page, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!response.success || !response.data) throw new Error(vi ? 'Không thể tải danh sách gói vé.' : 'Unable to load parking packages.');
        setCatalog(response.data);
      } catch (loadError) {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : (vi ? 'Không thể tải danh sách gói vé.' : 'Unable to load parking packages.'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [type, page, reload, vi]));

  const refresh = () => setReload((value) => value + 1);
  const choosePackage = (item: ExploreTicketPackage) => {
    if (item.type === 'hourly') {
      navigation.navigate('Bookings', { screen: 'CreateBooking' });
    } else {
      navigation.navigate('SubscriptionCheckout', { packageId: item._id });
    }
  };

  const renderPackage = (item: ExploreTicketPackage, featured = false) => (
    <View key={item._id} style={[styles.card, featured && styles.featuredCard]}>
      <View style={styles.cardTop}>
        <Text style={styles.type}>{TYPE_COPY[item.type][language]}</Text>
        {featured && <Text style={styles.badge}>{item.selectionReason === 'bestseller' ? (vi ? 'Bán chạy · 30 ngày' : 'Best seller · 30 days') : (vi ? 'Gói đề xuất' : 'Recommended')}</Text>}
      </View>
      <Text style={styles.name}>{item.name}</Text>
      <Text style={styles.price}>{formatCurrency(item.price)}</Text>
      <Text style={styles.muted}>{item.type === 'custom' ? `/ ${getPackageDurationLabel(item)} / space` : UNITS[item.type][language]}</Text>
      {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
      {item.benefits?.map((benefit) => <Text key={benefit} style={styles.description}>{benefit}</Text>)}
      {item.type === 'hourly' && <Text style={styles.description}>{vi ? 'Phí đỗ xe được tính theo bảng giá khung giờ hiện hành. Tổng phí hiển thị trước khi thanh toán.' : 'Parking charges follow current time-block pricing. Your booking shows the total before payment.'}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel={`${vi ? 'Chọn gói' : 'Choose package'} ${item.name}`} onPress={() => choosePackage(item)} style={styles.chooseButton}>
          <Text style={styles.chooseText}>{item.type === 'hourly' ? (vi ? 'Đặt chỗ đỗ xe' : 'Book parking') : (vi ? 'Chọn gói' : 'Choose package')}</Text>
          <Ionicons name="arrow-forward" size={18} color={COLORS.textInverse} />
        </Pressable>
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScreenHeader title={vi ? 'Khám phá gói vé' : 'Explore packages'} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading && catalog !== null} onRefresh={refresh} tintColor={COLORS.gold} />}>
        {loading ? <View style={styles.state}><ActivityIndicator color={COLORS.gold} /><Text style={styles.muted}>{vi ? 'Đang tải gói vé…' : 'Loading packages…'}</Text></View> : error ? (
          <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={refresh} style={styles.chooseButton}><Text style={styles.chooseText}>{vi ? 'Thử lại' : 'Try again'}</Text></Pressable></View>
        ) : catalog ? (
          <>
            {catalog.featured.length > 0 && <View style={styles.section}><Text accessibilityRole="header" style={styles.heading}>{vi ? 'Gói phổ biến' : 'Popular packages'}</Text>{catalog.featured.map((item) => renderPackage(item, true))}</View>}
            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.heading}>{vi ? 'Khám phá thêm' : 'Explore more'}</Text>
              <View style={styles.filters}>{TYPES.map((value) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: type === value }} onPress={() => { setType(value); setPage(1); }} style={[styles.filter, type === value && styles.activeFilter]}><Text style={[styles.filterText, type === value && styles.activeFilterText]}>{TYPE_COPY[value][language]}</Text></Pressable>)}</View>
              {catalog.items.length > 0 ? catalog.items.map((item) => renderPackage(item)) : <Text style={styles.empty}>{catalog.featured.length === 0 && type === 'all' ? (vi ? 'Chưa có gói vé đang mở bán.' : 'No packages are available yet.') : (vi ? 'Chưa có gói bổ sung trong loại này.' : 'No additional packages in this category.')}</Text>}
              {catalog.pagination.totalPages > 1 && <View style={styles.pagination}><Pressable accessibilityRole="button" disabled={page <= 1} onPress={() => setPage((value) => value - 1)} style={[styles.pageButton, page <= 1 && styles.disabled]}><Text style={styles.filterText}>{vi ? 'Trước' : 'Previous'}</Text></Pressable><Text style={styles.muted}>{page} / {catalog.pagination.totalPages}</Text><Pressable accessibilityRole="button" disabled={page >= catalog.pagination.totalPages} onPress={() => setPage((value) => value + 1)} style={[styles.pageButton, page >= catalog.pagination.totalPages && styles.disabled]}><Text style={styles.filterText}>{vi ? 'Tiếp' : 'Next'}</Text></Pressable></View>}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl, gap: SPACING.xl },
  section: { gap: SPACING.md },
  heading: { color: COLORS.textPrimary, fontSize: FONT_SIZES.xxl, fontWeight: '700' },
  card: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: RADIUS.xl, padding: SPACING.lg },
  featuredCard: { borderColor: COLORS.goldDark },
  cardTop: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: SPACING.sm, marginBottom: SPACING.md },
  type: { color: COLORS.gold, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  badge: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs },
  name: { color: COLORS.textPrimary, fontSize: FONT_SIZES.xl, fontWeight: '700' },
  price: { color: COLORS.textPrimary, fontSize: 28, fontWeight: '800', marginTop: SPACING.lg, marginBottom: SPACING.xs },
  muted: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm },
  description: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, lineHeight: 22, marginTop: SPACING.md },
  chooseButton: { minHeight: 48, backgroundColor: COLORS.gold, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.lg },
  chooseText: { color: COLORS.textInverse, fontSize: FONT_SIZES.sm, fontWeight: '700' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  filter: { minHeight: 44, justifyContent: 'center', paddingHorizontal: SPACING.md, borderWidth: 1, borderColor: COLORS.borderLight, borderRadius: RADIUS.round },
  activeFilter: { borderColor: COLORS.gold, backgroundColor: COLORS.gold },
  filterText: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  activeFilterText: { color: COLORS.textInverse },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.md, marginTop: SPACING.sm },
  pageButton: { minHeight: 44, minWidth: 64, justifyContent: 'center', alignItems: 'center', paddingHorizontal: SPACING.md, borderColor: COLORS.borderLight, borderWidth: 1, borderRadius: RADIUS.md },
  disabled: { opacity: 0.35 },
  empty: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm, lineHeight: 22, paddingVertical: SPACING.lg },
  state: { paddingVertical: SPACING.xxl, alignItems: 'center', gap: SPACING.md },
  error: { color: COLORS.error, fontSize: FONT_SIZES.sm, lineHeight: 22, textAlign: 'center' },
});
