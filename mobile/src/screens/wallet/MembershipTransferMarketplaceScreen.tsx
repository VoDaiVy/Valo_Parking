import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, ScreenHeader } from '@/components/common';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import type { WalletStackParamList } from '@/navigation/types';
import { subscriptionsService } from '@/services/api/subscriptions';
import type {
  MembershipTransferMarketplaceListing,
  MembershipTransferMarketplaceList,
} from '@/types/subscription.types';
import { formatCurrency, formatDate } from '@/utils/formatters';

type Props = NativeStackScreenProps<WalletStackParamList, 'MembershipMarketplace'>;

const getListings = (
  data: MembershipTransferMarketplaceList | MembershipTransferMarketplaceListing[] | undefined,
) => {
  if (Array.isArray(data)) return data;
  return data?.items ?? [];
};

export const MembershipTransferMarketplaceScreen = ({ navigation }: Props) => {
  const [listings, setListings] = useState<MembershipTransferMarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<'newest' | 'price_asc' | 'expiry_asc'>('newest');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadListings = useCallback(async (pageToLoad = 1, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else if (pageToLoad === 1) setLoading(true);
    else setLoadingMore(true);
    setError('');
    try {
      const response = await subscriptionsService.getTransferMarketplace({
        sort,
        page: pageToLoad,
        limit: 20,
      });
      const nextItems = getListings(response.data);
      setListings((current) => pageToLoad === 1 ? nextItems : [...current, ...nextItems]);
      setPage(pageToLoad);
      setTotalPages(response.data && !Array.isArray(response.data)
        ? response.data.pagination.totalPages
        : 1);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load Marketplace.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  }, [sort]);

  useFocusEffect(
    useCallback(() => {
      void loadListings(1);
    }, [loadListings]),
  );

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScreenHeader
        title="Transfer Marketplace"
        subtitle="Admin-approved membership spaces"
        onBack={() => navigation.goBack()}
      />

      <View style={styles.sortRow}>
        {([
          ['newest', 'Newest'],
          ['price_asc', 'Lowest price'],
          ['expiry_asc', 'Ending soon'],
        ] as const).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            onPress={() => setSort(value)}
            style={[styles.sortButton, sort === value && styles.sortButtonActive]}
          >
            <Text style={[styles.sortText, sort === value && styles.sortTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={COLORS.gold} size="large" />
        </View>
      ) : error ? (
        <ErrorState message={error} onRetry={() => void loadListings(1)} />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={listings}
          keyExtractor={(item) => item.transferId || item._id || item.slotCode}
          ListEmptyComponent={
            <EmptyState
              icon="storefront-outline"
              title="No listings available"
              message="Approved membership transfers will appear here."
            />
          }
          refreshControl={
            <RefreshControl
              colors={[COLORS.gold]}
              refreshing={refreshing}
              tintColor={COLORS.gold}
              onRefresh={() => void loadListings(1, true)}
            />
          }
          ListFooterComponent={loadingMore ? (
            <ActivityIndicator color={COLORS.gold} style={styles.footerLoader} />
          ) : null}
          renderItem={({ item }) => {
            const transferId = item.transferId || item._id;
            return (
              <Pressable
                accessibilityRole="button"
                disabled={!transferId}
                onPress={() => {
                  if (transferId) navigation.navigate('MembershipMarketplaceDetail', { transferId });
                }}
                style={styles.card}
              >
                <View style={styles.cardTop}>
                  <View style={styles.slotIcon}>
                    <Ionicons name="car-sport-outline" color={COLORS.gold} size={22} />
                  </View>
                  <View style={styles.cardTitle}>
                    <Text style={styles.slotCode}>{item.slotCode}</Text>
                    <Text numberOfLines={1} style={styles.location}>
                      {[item.parkingLot?.name, item.floor?.name].filter(Boolean).join(' · ') || 'VALO parking'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" color={COLORS.textMuted} size={20} />
                </View>
                <View style={styles.divider} />
                <View style={styles.priceRow}>
                  <View>
                    <Text style={styles.label}>Total due</Text>
                    <Text style={styles.price}>{formatCurrency(item.totalDue)}</Text>
                  </View>
                  <View style={styles.expires}>
                    <Text style={styles.label}>Listing expires</Text>
                    <Text style={styles.expiry}>{formatDate(item.listingExpiresAt)}</Text>
                  </View>
                </View>
              </Pressable>
            );
          }}
          showsVerticalScrollIndicator={false}
          onEndReached={() => {
            if (!loadingMore && page < totalPages) void loadListings(page + 1);
          }}
          onEndReachedThreshold={0.4}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { backgroundColor: COLORS.background, flex: 1 },
  state: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  sortRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingBottom: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  sortButton: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.round,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  sortButtonActive: { backgroundColor: 'rgba(212,175,55,0.12)', borderColor: COLORS.gold },
  sortText: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontWeight: '700' },
  sortTextActive: { color: COLORS.gold },
  list: { flexGrow: 1, padding: SPACING.lg, paddingTop: 0 },
  footerLoader: { paddingVertical: SPACING.lg },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    marginBottom: SPACING.md,
    padding: SPACING.md,
  },
  cardTop: { alignItems: 'center', flexDirection: 'row', gap: SPACING.md },
  slotIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.12)',
    borderRadius: RADIUS.md,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  cardTitle: { flex: 1 },
  slotCode: { color: COLORS.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '900' },
  location: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 3 },
  divider: { backgroundColor: COLORS.border, height: StyleSheet.hairlineWidth, marginVertical: SPACING.md },
  priceRow: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' },
  label: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
  price: { color: COLORS.gold, fontSize: FONT_SIZES.md, fontWeight: '900', marginTop: 3 },
  expires: { alignItems: 'flex-end' },
  expiry: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, fontWeight: '700', marginTop: 3 },
});
