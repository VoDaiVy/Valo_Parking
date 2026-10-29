import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, ScreenHeader } from '@/components/common';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import type { WalletStackParamList } from '@/navigation/types';
import { subscriptionsService } from '@/services/api/subscriptions';
import type { SubscriptionPackage } from '@/types/subscription.types';
import { formatCurrency } from '@/utils/formatters';

type Props = NativeStackScreenProps<WalletStackParamList, 'SubscriptionPackages'>;

export const PriceBadge = ({ changePercent, priceLabel }: { changePercent: number; priceLabel?: string }) => {
  const decrease = changePercent < 0;
  return (
    <View style={[styles.priceBadge, decrease ? styles.priceBadgeDiscount : styles.priceBadgePeak]}>
      <Ionicons name={decrease ? 'trending-down' : 'trending-up'} size={14} color={decrease ? COLORS.success : COLORS.warning} />
      <Text style={[styles.priceBadgeText, { color: decrease ? COLORS.success : COLORS.warning }]}>
        {decrease ? '▼' : '▲'} {Math.abs(changePercent)}% · {priceLabel || (decrease ? 'Discounted price' : 'Peak price')}
      </Text>
    </View>
  );
};

export const SubscriptionPackagesScreen = ({ navigation }: Props) => {
  const [packages, setPackages] = useState<SubscriptionPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadPackages = useCallback(async () => {
    setError('');
    try {
      const response = await subscriptionsService.getPackages();
      setPackages((response.data || []).filter((pkg) => pkg.isActive && ['monthly', 'yearly'].includes(pkg.type)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load membership plans.');
      setPackages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  const renderPackage = ({ item }: { item: SubscriptionPackage }) => {
    const yearly = item.type === 'yearly';
    const changePercent = Number(item.changePercent ?? 0);
    const basePrice = Number(item.price || 0);
    const adjustedPrice = Number.isFinite(Number(item.adjustedPrice)) ? Number(item.adjustedPrice) : basePrice;
    const dynamicPricing = changePercent !== 0 && adjustedPrice !== basePrice;

    return (
      <Pressable
        accessibilityRole="button"
        style={[styles.packageCard, yearly && styles.packageCardFeatured]}
        onPress={() => navigation.navigate('SubscriptionCheckout', { packageId: item._id })}
      >
        {yearly ? (
          <View style={styles.featuredBadge}>
            <Ionicons name="star" size={12} color={COLORS.textInverse} />
            <Text style={styles.featuredText}>Best value</Text>
          </View>
        ) : null}
        <View style={styles.packageTop}>
          <View style={styles.packageIcon}>
            <Ionicons name={yearly ? 'diamond-outline' : 'ribbon-outline'} size={24} color={COLORS.gold} />
          </View>
          <View style={styles.packageTitleWrap}>
            <Text style={styles.packageName}>{item.name}</Text>
            <Text style={styles.packageDuration}>{yearly ? '12 months' : '1 month'}</Text>
          </View>
        </View>
        {dynamicPricing ? <PriceBadge changePercent={changePercent} priceLabel={item.priceLabel} /> : null}
        {dynamicPricing ? <Text style={styles.basePrice}>{formatCurrency(basePrice)}</Text> : null}
        <Text style={styles.price}>{formatCurrency(dynamicPricing ? adjustedPrice : basePrice)}</Text>
        {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
        {(item.benefits ?? []).slice(0, 4).map((benefit) => (
          <View key={benefit} style={styles.benefitRow}>
            <Ionicons name="checkmark-circle-outline" size={16} color={COLORS.success} />
            <Text style={styles.benefitText}>{benefit}</Text>
          </View>
        ))}
        {yearly ? (
          <View style={styles.yearlyNote}>
            <Text style={styles.yearlyNoteText}>Includes 12 complimentary services</Text>
          </View>
        ) : null}
        <View style={styles.selectRow}>
          <Text style={styles.selectText}>Choose plan</Text>
          <Ionicons name="chevron-forward" size={18} color={COLORS.gold} />
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#080808" />
      <ScreenHeader title="Membership plans" onBack={() => navigation.goBack()} />

      {loading ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={COLORS.gold} size="large" />
        </View>
      ) : error ? (
        <ErrorState message={error} onRetry={loadPackages} />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={packages}
          keyExtractor={(item) => item._id}
          ListEmptyComponent={
            <EmptyState
              icon="cube-outline"
              title="No plans available"
              message="New membership plans will appear here."
            />
          }
          renderItem={renderPackage}
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
  stateWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  list: {
    gap: SPACING.md,
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xxl,
  },
  packageCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    gap: SPACING.md,
    overflow: 'hidden',
    padding: SPACING.lg,
  },
  packageCardFeatured: {
    borderColor: 'rgba(212,175,55,0.35)',
  },
  featuredBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.round,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
  },
  featuredText: {
    color: COLORS.textInverse,
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
  },
  packageTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.md,
  },
  packageIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.12)',
    borderRadius: RADIUS.md,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  packageTitleWrap: {
    flex: 1,
  },
  packageName: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.lg,
    fontWeight: '900',
  },
  packageDuration: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginTop: 2,
  },
  price: {
    color: COLORS.gold,
    fontSize: 28,
    fontWeight: '900',
  },
  basePrice: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.sm,
    textDecorationLine: 'line-through',
    marginBottom: -8,
  },
  priceBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: RADIUS.round,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  priceBadgeDiscount: {
    backgroundColor: 'rgba(76,175,80,0.15)',
  },
  priceBadgePeak: {
    backgroundColor: 'rgba(255,159,67,0.16)',
  },
  priceBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
  },
  description: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
  },
  benefitRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  benefitText: {
    color: COLORS.textSecondary,
    flex: 1,
    fontSize: FONT_SIZES.sm,
  },
  yearlyNote: {
    backgroundColor: 'rgba(126,232,162,0.1)',
    borderColor: 'rgba(126,232,162,0.22)',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.sm,
  },
  yearlyNoteText: {
    color: COLORS.success,
    fontSize: FONT_SIZES.xs,
    fontWeight: '700',
  },
  selectRow: {
    alignItems: 'center',
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: SPACING.md,
  },
  selectText: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.sm,
    fontWeight: '800',
  },
});
