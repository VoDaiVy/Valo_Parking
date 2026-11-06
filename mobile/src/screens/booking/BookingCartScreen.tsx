import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { format } from 'date-fns';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState, ErrorState, ScreenHeader } from '@/components/common';
import { WorkflowButton, WorkflowChip, workflowStyles as s } from '@/components/common/WorkflowUI';
import { COLORS } from '@/constants/theme';
import { useBookingCart } from '@/contexts/BookingCartContext';
import { useBooking } from '@/hooks/useBooking';
import { bookingService } from '@/services/BookingService';
import { walletService } from '@/services/api/wallet';
import type { BulkBookingQuoteResponse } from '@/types/api.types';
import type { BookingStackParamList } from '@/navigation/BookingStackNavigator';
import { toBookingApiItem } from '@/utils/bookingCart';
import { formatCurrency } from '@/utils/formatters';
import { isPolicyAcceptanceRequired } from '@/utils/policyErrors';

export function BookingCartScreen({
  navigation,
  route,
}: NativeStackScreenProps<BookingStackParamList, 'BookingCart'>) {
  const { t: translateUi } = useLanguage();
  const cart = useBookingCart();
  const directItem = route?.params?.directItem;
  const directItems = useRef(directItem ? [directItem] : null).current;
  const directKey = useRef(directItem?.clientItemId || Crypto.randomUUID()).current;
  const items = directItems ?? cart.items;
  const checkoutKey = directItems ? directKey : cart.checkoutKey;
  const { fetchBookings, fetchWalletBalance } = useBooking();
  const [quote, setQuote] = useState<BulkBookingQuoteResponse['data'] | null>(null);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [policyRequired, setPolicyRequired] = useState(false);
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  usePreventRemove(busy, () => {});

  const load = useCallback(async () => {
    if (!items.length) {
      setQuote(null);
      return;
    }
    setLoading(true);
    setError('');
    setQuote(null);
    try {
      const [response, wallet] = await Promise.all([
        bookingService.quoteBulkBooking(items.map(toBookingApiItem)),
        walletService.getWallet(),
      ]);
      if (!response.data || !Number.isFinite(response.data.grandTotal))
        throw new Error('Invalid price quote.');
      setQuote(response.data);
      setBalance(Number(wallet.data?.balance || 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load the quote.');
    } finally {
      setLoading(false);
    }
  }, [items]);
  useEffect(() => {
    void load();
  }, [load]);

  const checkout = async () => {
    if (inFlight.current || completedIds.length || !quote || !items.length) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setPolicyRequired(false);
    const holds: string[] = [];
    let committed = false;
    try {
      const apiItems = items.map(toBookingApiItem);
      const [latest, wallet] = await Promise.all([
        bookingService.quoteBulkBooking(apiItems),
        walletService.getWallet(),
      ]);
      if (!latest.data || !Number.isFinite(latest.data.grandTotal))
        throw new Error('Invalid price quote.');
      setBalance(Number(wallet.data?.balance || 0));
      if (latest.data.grandTotal !== quote.grandTotal) {
        setQuote(latest.data);
        throw new Error('The price has changed. Please review the new total and confirm again.');
      }
      if (Number(wallet.data?.balance || 0) < latest.data.grandTotal)
        throw new Error('Insufficient wallet balance. Please top up.');
      const heldItems = [];
      for (const [index, item] of apiItems.entries()) {
        const response = await bookingService.createBookingHold({
          floorId: item.floorId,
          slotCode: item.slotCode,
          licensePlate: items[index].plateLabel,
          startTime: item.startTime,
          endTime: item.endTime,
        });
        if (!response.data?._id) throw new Error('Unable to hold the space. Please try again.');
        holds.push(response.data._id);
        heldItems.push({ ...item, holdId: response.data._id });
      }
      const response = await bookingService.createBulkBooking({
        idempotencyKey: checkoutKey,
        items: heldItems,
        expectedTotal: latest.data.grandTotal,
      });
      if (!response.success || !response.data?.bookings?.length)
        throw new Error(
          'No booking confirmation received. Please check your bookings before trying again.',
        );
      committed = true;
      setCompletedIds(response.data.bookings.map((booking) => booking._id));
      if (!directItems) cart.clear();
      await Promise.allSettled([fetchBookings(), fetchWalletBalance()]);
    } catch (e) {
      setPolicyRequired(isPolicyAcceptanceRequired(e));
      setError(e instanceof Error ? e.message : 'Payment failed.');
    } finally {
      if (!committed)
        await Promise.allSettled(holds.map((id) => bookingService.releaseBookingHold(id)));
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={s.safe}>
      <ScreenHeader
        title={translateUi(directItems ? "Confirm booking" : "Booking cart")}
        subtitle={translateUi("Review times, rewards and total before payment")}
        onBack={busy ? undefined : () => navigation.goBack()}
      />
      <ScrollView contentContainerStyle={s.content}>
        {completedIds.length ? (
          <View style={[s.panel, styles.successPanel]}>
            <Text style={[s.title, styles.successTitle]}>{translateUi("Reserved")}{" "}{completedIds.length} {" "}{translateUi("spaces")}</Text>
            <Text style={s.body}>{translateUi("Your bookings and QR codes are ready.")}</Text>
            <WorkflowButton title={translateUi("View bookings")} onPress={() => navigation.replace('BookingList')} />
          </View>
        ) : null}
        {!items.length && !completedIds.length ? (
          <EmptyState
            icon="cart-outline"
            title={translateUi("Your cart is empty")}
            message={translateUi("Choose a space and add the vehicles you want to book.")}
          />
        ) : null}
        {!completedIds.length && items.length ? <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{translateUi(directItems ? 'Your reservation' : 'Your selected spaces')}</Text><Text style={styles.countBadge}>{items.length}</Text></View> : null}
        {!completedIds.length ? items.map((item, index) => (
          <View style={styles.reservationCard} key={item.clientItemId}>
            <View style={styles.cardHeading}>
              <View style={styles.slotBadge}><Text style={styles.slotCode}>{item.slotCode}</Text></View>
              <View style={styles.cardIdentity}><Text style={styles.plate}>{item.plateLabel}</Text><Text style={styles.muted}>{item.floorLabel}</Text></View>
              {!busy && !directItems ? <Pressable accessibilityRole="button" accessibilityLabel={`${translateUi('Remove from cart')} ${item.plateLabel}`} onPress={() => cart.remove(item.clientItemId)} style={styles.removeButton}><Ionicons name="trash-outline" size={19} color={COLORS.error} /></Pressable> : null}
            </View>
            <View style={styles.timeRow}>
              <View style={styles.timeColumn}><Text style={styles.timeLabel}>{translateUi('Arrival')}</Text><Text style={styles.time}>{format(new Date(item.startTime), 'HH:mm')}</Text><Text style={styles.muted}>{format(new Date(item.startTime), 'dd MMM yyyy')}</Text></View>
              <Ionicons name="arrow-forward" size={18} color={COLORS.gold} />
              <View style={styles.timeColumn}><Text style={styles.timeLabel}>{translateUi('Departure')}</Text><Text style={styles.time}>{format(new Date(item.endTime), 'HH:mm')}</Text><Text style={styles.muted}>{format(new Date(item.endTime), 'dd MMM yyyy')}</Text></View>
            </View>
            <View style={styles.itemBottom}><Text style={styles.muted}>{translateUi('Reservation total')}</Text><Text style={styles.itemPrice}>{quote?.items[index] ? formatCurrency(quote.items[index].totalAmount) : '?'}</Text></View>
            {item.voucherLabel ? <Text style={styles.voucher}>{translateUi('Voucher:')} {item.voucherLabel}</Text> : null}
          </View>
        )) : null}
        {error ? <ErrorState message={translateUi(error)} onRetry={busy ? undefined : load} /> : null}
        {policyRequired ? (
          <WorkflowButton
            title={translateUi("Review and accept policies")}
            onPress={() => navigation.getParent()?.navigate('ProfileTab', { screen: 'Policies' })}
          />
        ) : null}
        {loading ? <ActivityIndicator color={COLORS.gold} /> : null}
        {quote && items.length && !completedIds.length ? (
          <View style={styles.paymentPanel}>
            <View style={styles.paymentHeading}><Ionicons name="wallet-outline" size={20} color={COLORS.gold} /><Text style={styles.sectionTitle}>{translateUi("Payment summary")}</Text></View>
            <Text style={s.body}>{translateUi("Payment total ·")}{" "}{items.length} {" "}{translateUi("spaces")}</Text>
            <Text style={s.amount}>{formatCurrency(quote.grandTotal)}</Text>
            <Text style={s.body}>{translateUi("Wallet balance:")}{" "}{formatCurrency(balance)}</Text>
            <WorkflowButton
              disabled={busy || loading || balance < quote.grandTotal}
              title={busy ? 'Confirming…' : translateUi("Confirm & pay with wallet")}
              onPress={() => void checkout()}
            />
            {balance < quote.grandTotal ? (
              <WorkflowButton
                title={translateUi("Top up wallet")}
                onPress={() => navigation.getParent()?.navigate('WalletTab', { screen: 'TopUp' })}
              />
            ) : null}
          </View>
        ) : null}
        {!busy && !directItems && !completedIds.length ? (
          <WorkflowChip onPress={() => navigation.navigate('CreateBooking')}>
            {" "}{translateUi("Add another space")}{" "}</WorkflowChip>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: -4 },
  sectionTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
  countBadge: { color: COLORS.gold, backgroundColor: COLORS.goldTint, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, fontSize: 13, fontWeight: '700' },
  reservationCard: { backgroundColor: COLORS.surface, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, padding: 18, gap: 16 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  slotBadge: { minWidth: 52, minHeight: 52, padding: 8, backgroundColor: COLORS.goldTint, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  slotCode: { color: COLORS.gold, fontSize: 22, fontWeight: '700' },
  cardIdentity: { flex: 1, gap: 5 },
  plate: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  muted: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },
  removeButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: COLORS.errorTint },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.border },
  timeColumn: { flex: 1, gap: 4 },
  timeLabel: { color: COLORS.textMuted, fontSize: 12 },
  time: { color: COLORS.textPrimary, fontSize: 23, fontWeight: '700', fontVariant: ['tabular-nums'] },
  itemBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  itemPrice: { color: COLORS.gold, fontSize: 20, fontWeight: '700' },
  voucher: { color: COLORS.success, fontSize: 13 },
  paymentPanel: { backgroundColor: COLORS.surface, borderRadius: 20, borderWidth: 1, borderColor: COLORS.goldDark, padding: 20, gap: 14 },
  paymentHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  successPanel: { backgroundColor: COLORS.successTint },
  successTitle: { color: COLORS.success },
  amount: { color: COLORS.gold, fontVariant: ['tabular-nums'] },
});
