import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, ScreenHeader } from '@/components/common';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import type { WalletStackParamList } from '@/navigation/types';
import { subscriptionsService } from '@/services/api/subscriptions';
import type {
  MembershipTransferClaimResult,
  MembershipTransferMarketplaceListing,
} from '@/types/subscription.types';
import { formatCurrency, formatDate } from '@/utils/formatters';

type Props = NativeStackScreenProps<WalletStackParamList, 'MembershipMarketplaceDetail'>;

const formatCountdown = (milliseconds: number) => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

export const MembershipTransferMarketplaceDetailScreen = ({ navigation, route }: Props) => {
  const { transferId } = route.params;
  const [listing, setListing] = useState<MembershipTransferMarketplaceListing | null>(null);
  const [claim, setClaim] = useState<MembershipTransferClaimResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  const loadListing = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await subscriptionsService.getTransferMarketplaceListing(transferId);
      setListing(response.data ?? null);
      if (response.data?.canSettle) setClaim(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load this listing.');
    } finally {
      setLoading(false);
    }
  }, [transferId]);

  useFocusEffect(
    useCallback(() => {
      void loadListing();
    }, [loadListing]),
  );

  useEffect(() => {
    if (!(claim?.lockExpiresAt || listing?.lockExpiresAt)) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [claim?.lockExpiresAt, listing?.lockExpiresAt]);

  const holdRemaining = useMemo(
    () => {
      const lockExpiresAt = claim?.lockExpiresAt || listing?.lockExpiresAt;
      return lockExpiresAt ? new Date(lockExpiresAt).getTime() - now : 0;
    },
    [claim?.lockExpiresAt, listing?.lockExpiresAt, now],
  );

  const claimListing = async () => {
    setSubmitting(true);
    setError('');
    try {
      const response = await subscriptionsService.claimTransferMarketplaceListing(transferId);
      if (response.data) {
        setClaim(response.data);
      }
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : 'This listing is no longer available.');
      await loadListing();
    } finally {
      setSubmitting(false);
    }
  };

  const settle = async () => {
    setSubmitting(true);
    setError('');
    try {
      await subscriptionsService.settleEntitlementTransfer(transferId);
      Alert.alert('Transfer completed', 'The membership space is now in your account.', [
        { text: 'View membership', onPress: () => navigation.navigate('Membership') },
      ]);
    } catch (settleError) {
      setError(settleError instanceof Error ? settleError.message : 'Wallet payment failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const current = listing;
  const shortfall = claim?.shortfall ?? listing?.shortfall ?? 0;
  const ownsHold = Boolean(claim || current?.canSettle);
  const canSettle = Boolean(ownsHold && holdRemaining > 0 && shortfall <= 0);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScreenHeader
        title="Listing details"
        subtitle="Review live availability before claiming"
        onBack={() => navigation.goBack()}
      />
      {loading && !current ? (
        <View style={styles.state}>
          <ActivityIndicator color={COLORS.gold} size="large" />
        </View>
      ) : error && !current ? (
        <ErrorState message={error} onRetry={() => void loadListing()} />
      ) : current ? (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Ionicons name="car-sport-outline" color={COLORS.gold} size={30} />
            </View>
            <Text style={styles.slotCode}>{current.slotCode}</Text>
            <Text style={styles.location}>
              {[current.parkingLot?.name, current.floor?.name].filter(Boolean).join(' · ') || 'VALO parking'}
            </Text>
            {current.parkingLot?.address ? (
              <Text style={styles.address}>{current.parkingLot.address}</Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <Row label="Package" value={current.package?.name || 'Membership'} />
            <Row label="Valid until" value={formatDate(current.expireAt)} />
            <Row label="Listing expires" value={formatDate(current.listingExpiresAt)} />
            <View style={styles.divider} />
            <Row label="Asking price" value={formatCurrency(current.askingPrice)} />
            <Row label="Transfer fee" value={formatCurrency(current.transferFee)} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total due</Text>
              <Text style={styles.total}>{formatCurrency(current.totalDue)}</Text>
            </View>
          </View>

          {ownsHold ? (
            <View style={styles.holdCard}>
              <Ionicons name="timer-outline" color={holdRemaining > 0 ? COLORS.warning : COLORS.error} size={23} />
              <View style={styles.holdCopy}>
                <Text style={styles.holdTitle}>
                  {holdRemaining > 0 ? `Reserved for ${formatCountdown(holdRemaining)}` : 'Reservation expired'}
                </Text>
                <Text style={styles.holdText}>
                  {typeof (claim?.walletBalance ?? listing?.walletBalance) === 'number'
                    ? `Wallet balance: ${formatCurrency((claim?.walletBalance ?? listing?.walletBalance)!)}`
                    : 'This payment hold belongs to you.'}
                </Text>
                {shortfall > 0 ? (
                  <Text style={styles.shortfall}>Top up {formatCurrency(shortfall)} before paying.</Text>
                ) : null}
              </View>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {!ownsHold && current.status === 'LISTED' && current.available !== false ? (
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={submitting}
              onPress={() => void claimListing()}
              style={[styles.primaryButton, submitting && styles.disabled]}
            >
              {submitting ? <ActivityIndicator color={COLORS.textInverse} /> : null}
              <Text style={styles.primaryText}>Claim for 15 minutes</Text>
            </TouchableOpacity>
          ) : null}

          {ownsHold ? (
            <>
              {shortfall > 0 ? (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => navigation.navigate('TopUp')}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryText}>Top up wallet</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={!canSettle || submitting}
                onPress={() => void settle()}
                style={[styles.primaryButton, (!canSettle || submitting) && styles.disabled]}
              >
                {submitting ? <ActivityIndicator color={COLORS.textInverse} /> : null}
                <Text style={styles.primaryText}>Pay with wallet</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  safe: { backgroundColor: COLORS.background, flex: 1 },
  state: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  scroll: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  hero: { alignItems: 'center', paddingBottom: SPACING.xl },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.12)',
    borderRadius: RADIUS.round,
    height: 64,
    justifyContent: 'center',
    marginBottom: SPACING.md,
    width: 64,
  },
  slotCode: { color: COLORS.textPrimary, fontSize: 30, fontWeight: '900' },
  location: { color: COLORS.gold, fontSize: FONT_SIZES.md, fontWeight: '700', marginTop: SPACING.xs },
  address: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: SPACING.xs, textAlign: 'center' },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: SPACING.md,
    padding: SPACING.lg,
  },
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm },
  rowValue: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '700' },
  divider: { backgroundColor: COLORS.border, height: StyleSheet.hairlineWidth },
  totalRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '800' },
  total: { color: COLORS.gold, fontSize: FONT_SIZES.lg, fontWeight: '900' },
  holdCard: {
    backgroundColor: COLORS.surface,
    borderColor: 'rgba(255,193,7,0.35)',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.md,
    padding: SPACING.md,
  },
  holdCopy: { flex: 1 },
  holdTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '800' },
  holdText: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 4 },
  shortfall: { color: COLORS.error, fontSize: FONT_SIZES.xs, fontWeight: '700', marginTop: 4 },
  error: { color: COLORS.error, fontSize: FONT_SIZES.sm, marginTop: SPACING.md, textAlign: 'center' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'center',
    marginTop: SPACING.md,
    minHeight: 52,
    paddingHorizontal: SPACING.lg,
  },
  primaryText: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '900' },
  secondaryButton: {
    alignItems: 'center',
    borderColor: COLORS.gold,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: SPACING.md,
    minHeight: 50,
  },
  secondaryText: { color: COLORS.gold, fontSize: FONT_SIZES.sm, fontWeight: '800' },
  disabled: { opacity: 0.45 },
});
