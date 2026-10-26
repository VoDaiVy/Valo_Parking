import { useCallback, useEffect, useRef, useState } from 'react';
import { usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
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
import { formatCurrency, formatDate } from '@/utils/formatters';
import { isPolicyAcceptanceRequired } from '@/utils/policyErrors';

export function BookingCartScreen({
  navigation,
}: NativeStackScreenProps<BookingStackParamList, 'BookingCart'>) {
  const cart = useBookingCart();
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
    if (!cart.items.length) {
      setQuote(null);
      return;
    }
    setLoading(true);
    setError('');
    setQuote(null);
    try {
      const [response, wallet] = await Promise.all([
        bookingService.quoteBulkBooking(cart.items.map(toBookingApiItem)),
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
  }, [cart.items]);
  useEffect(() => {
    void load();
  }, [load]);

  const checkout = async () => {
    if (inFlight.current || !quote || !cart.items.length) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setPolicyRequired(false);
    const holds: string[] = [];
    let committed = false;
    try {
      const apiItems = cart.items.map(toBookingApiItem);
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
          licensePlate: cart.items[index].plateLabel,
          startTime: item.startTime,
          endTime: item.endTime,
        });
        if (!response.data?._id) throw new Error('Unable to hold the space. Please try again.');
        holds.push(response.data._id);
        heldItems.push({ ...item, holdId: response.data._id });
      }
      const response = await bookingService.createBulkBooking({
        idempotencyKey: cart.checkoutKey,
        items: heldItems,
        expectedTotal: latest.data.grandTotal,
      });
      if (!response.success || !response.data?.bookings?.length)
        throw new Error(
          'No booking confirmation received. Please check your bookings before trying again.',
        );
      committed = true;
      setCompletedIds(response.data.bookings.map((booking) => booking._id));
      cart.clear();
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
        title="Booking cart"
        subtitle="Review times, rewards and total before payment"
        onBack={busy ? undefined : () => navigation.goBack()}
      />
      <ScrollView contentContainerStyle={s.content}>
        {completedIds.length ? (
          <View style={s.panel}>
            <Text style={s.title}>Reserved {completedIds.length} spaces</Text>
            <Text style={s.body}>Your bookings and QR codes are ready.</Text>
            <WorkflowButton title="View bookings" onPress={() => navigation.replace('BookingList')} />
          </View>
        ) : null}
        {!cart.items.length && !completedIds.length ? (
          <EmptyState
            icon="cart-outline"
            title="Your cart is empty"
            message="Choose a space and add the vehicles you want to book."
          />
        ) : null}
        {cart.items.map((item, index) => (
          <View style={s.panel} key={item.clientItemId}>
            <Text style={s.title}>
              {index + 1}. {item.slotCode} · {item.plateLabel}
            </Text>
            <Text style={s.body}>{item.floorLabel}</Text>
            <Text style={s.body}>
              {formatDate(item.startTime)} → {formatDate(item.endTime)}
            </Text>
            {item.voucherLabel ? <Text style={s.body}>Voucher: {item.voucherLabel}</Text> : null}
            {quote?.items[index] ? (
              <Text style={s.title}>{formatCurrency(quote.items[index].totalAmount)}</Text>
            ) : null}
            {!busy ? (
              <WorkflowChip onPress={() => cart.remove(item.clientItemId)}>
                Remove from cart
              </WorkflowChip>
            ) : null}
          </View>
        ))}
        {error ? <ErrorState message={error} onRetry={busy ? undefined : load} /> : null}
        {policyRequired ? (
          <WorkflowButton
            title="Review and accept policies"
            onPress={() => navigation.getParent()?.navigate('ProfileTab', { screen: 'Policies' })}
          />
        ) : null}
        {loading ? <ActivityIndicator color={COLORS.gold} /> : null}
        {quote && cart.items.length ? (
          <View style={s.panel}>
            <Text style={s.body}>Payment total · {cart.items.length} spaces</Text>
            <Text style={s.amount}>{formatCurrency(quote.grandTotal)}</Text>
            <Text style={s.body}>Wallet balance: {formatCurrency(balance)}</Text>
            <WorkflowButton
              disabled={busy || loading || balance < quote.grandTotal}
              title={busy ? 'Confirming…' : 'Confirm & pay with wallet'}
              onPress={() => void checkout()}
            />
            {balance < quote.grandTotal ? (
              <WorkflowButton
                title="Top up wallet"
                onPress={() => navigation.getParent()?.navigate('WalletTab', { screen: 'TopUp' })}
              />
            ) : null}
          </View>
        ) : null}
        {!busy ? (
          <WorkflowChip onPress={() => navigation.navigate('CreateBooking')}>
            Add another space
          </WorkflowChip>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
