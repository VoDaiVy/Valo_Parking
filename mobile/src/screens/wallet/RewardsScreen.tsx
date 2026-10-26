import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState, ErrorState, ScreenHeader } from '@/components/common';
import { WorkflowButton, WorkflowChip, workflowStyles as s } from '@/components/common/WorkflowUI';
import { COLORS } from '@/constants/theme';
import { loyaltyService } from '@/services/api/loyalty';
import type { WalletStackParamList } from '@/navigation/types';
import type { SpendingProgress, UserVoucher, VoucherStatus } from '@/types/loyalty.types';
import { formatCurrency, formatDate } from '@/utils/formatters';

const STATUS: Record<VoucherStatus, string> = {
  available: 'Available',
  used: 'Used',
  expired: 'Expired',
  revoked: 'Revoked',
};

export function voucherBenefit(voucher: UserVoucher) {
  const benefit = voucher.benefitSnapshot;
  if (benefit.type === 'FIXED_DISCOUNT')
    return `Save ${formatCurrency(benefit.discountAmount || 0)}`;
  if (benefit.type === 'PERCENT_DISCOUNT') return `Save ${benefit.discountPercent}%`;
  return `Free ${typeof benefit.serviceId === 'object' && benefit.serviceId ? benefit.serviceId.name : 'service'}`;
}

export function RewardsScreen({
  navigation,
}: NativeStackScreenProps<WalletStackParamList, 'Rewards'>) {
  const [vouchers, setVouchers] = useState<UserVoucher[]>([]);
  const [progress, setProgress] = useState<SpendingProgress | null>(null);
  const [filter, setFilter] = useState<VoucherStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [owned, spending] = await Promise.all([
        loyaltyService.getVouchers(),
        loyaltyService.getSpending(),
      ]);
      setVouchers(owned.data || []);
      setProgress(spending.data || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load rewards.');
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const visible = vouchers.filter((v) => filter === 'all' || v.status === filter);
  const next = progress?.tiers.find(
    (tier) => tier.threshold > Math.max(progress.total, progress.highestAwardedThreshold),
  );
  return (
    <SafeAreaView edges={['top']} style={s.safe}>
      <ScreenHeader
        title="Vouchers & rewards"
        subtitle="The same rewards as your web account"
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={COLORS.gold} />
        }
      >
        {error ? <ErrorState message={error} onRetry={load} /> : null}
        {progress ? (
          <View style={s.panel}>
            <Text style={s.title}>Monthly spending · {progress.month}</Text>
            <Text style={s.amount}>{formatCurrency(progress.total)}</Text>
            <Text style={s.body}>
              {!progress.enabled
                ? 'The rewards program is currently paused.'
                : next
                  ? `Spend ${formatCurrency(Math.max(0, next.threshold - progress.total))} more to receive a voucher worth ${formatCurrency(next.discountAmount)}.`
                  : 'You have reached all reward milestones this month.'}
            </Text>
            {progress.tiers.map((tier) => (
              <Text key={tier.threshold} style={s.body}>
                {progress.total >= tier.threshold ? '✓' : '○'} {formatCurrency(tier.threshold)} →
                save {formatCurrency(tier.discountAmount)} · minimum spend{' '}
                {formatCurrency(tier.minimumAmount)}
              </Text>
            ))}
            <Text style={s.body}>
              Rewards are issued automatically for eligible transactions, excluding top-ups and fines. Refunds may revoke unused vouchers.
            </Text>
          </View>
        ) : null}
        <View style={s.row}>
          {(['all', ...Object.keys(STATUS)] as Array<VoucherStatus | 'all'>).map((value) => (
            <WorkflowChip key={value} selected={filter === value} onPress={() => setFilter(value)}>
              {value === 'all' ? 'All' : STATUS[value]}
            </WorkflowChip>
          ))}
        </View>
        {loading && !vouchers.length ? <ActivityIndicator color={COLORS.gold} /> : null}
        {visible.map((voucher) => (
          <View key={voucher._id} style={s.panel}>
            <Text style={s.body}>
              {STATUS[voucher.status]}
              {voucher.bookingId ? ' · Reserved for a booking' : ''}
            </Text>
            <Text style={s.title}>{voucher.benefitSnapshot.name}</Text>
            <Text style={[s.title, { color: COLORS.gold }]}>{voucherBenefit(voucher)}</Text>
            <Text style={s.body}>
              Minimum spend {formatCurrency(voucher.benefitSnapshot.minimumAmount)} · Single use
            </Text>
            <Text style={s.body}>Expires {formatDate(voucher.expiresAt)}</Text>
            {voucher.status === 'available' && !voucher.bookingId ? (
              <WorkflowButton
                title="Use in a booking"
                onPress={() =>
                  navigation.getParent()?.navigate('Bookings', {
                    screen: 'CreateBooking',
                    params: { selectedVoucherId: voucher._id },
                  })
                }
              />
            ) : null}
          </View>
        ))}
        {!loading && !error && !visible.length ? (
          <EmptyState
            icon="gift-outline"
            title="No vouchers yet"
            message="VALO offers and spending rewards will appear here."
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
