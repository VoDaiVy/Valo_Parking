import { useLanguage } from '@/contexts/LanguageContext';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

import { PriceBreakdown } from '@/components/booking/PriceBreakdown';
import { QRCodeDisplay } from '@/components/booking/QRCodeDisplay';
import { StatusBadge } from '@/components/booking/StatusBadge';
import { AppText, Button, Card, LoadingSpinner } from '@/components/common';
import { Screen } from '@/components/layout/Screen';
import { useBooking } from '@/hooks/useBooking';
import { useToast } from '@/hooks/useToast';
import type { BookingStackParamList } from '@/navigation/types';
import { colors, spacing } from '@/theme';
import { formatCurrency, formatDate } from '@/utils/formatters';

type Props = NativeStackScreenProps<BookingStackParamList, 'BookingDetails'>;

export const BookingDetailsScreen = ({ navigation, route }: Props) => {
  const { t: translateUi } = useLanguage();
  const toast = useToast();
  const { bookings, isLoading, fetchBookings, getBookingById, checkInBooking, checkOutBooking } = useBooking();
  const booking = getBookingById(route.params.bookingId);

  useEffect(() => {
    if (!booking && bookings.length === 0) {
      void fetchBookings();
    }
  }, [booking, bookings.length, fetchBookings]);

  const handleCheckIn = async () => {
    try {
      await checkInBooking(route.params.bookingId);
      toast.showSuccess('Checked in');
    } catch (error) {
      toast.showError('Check-in failed', error instanceof Error ? error.message : undefined);
    }
  };

  const handleCheckOut = async () => {
    try {
      await checkOutBooking(route.params.bookingId);
      toast.showSuccess('Checked out');
    } catch (error) {
      toast.showError('Check-out failed', error instanceof Error ? error.message : undefined);
    }
  };

  if (!booking) {
    return (
      <Screen>
        {isLoading ? <LoadingSpinner /> : <AppText>{translateUi("Booking not found.")}</AppText>}
      </Screen>
    );
  }

  return (
    <Screen scrollable>
      <AppText variant="h1">{translateUi("Booking Details")}</AppText>
      <Card style={styles.card}>
        <StatusBadge status={booking.status} />
        <AppText style={styles.identifier} variant="body2">#{booking._id}</AppText>
        <AppText color={colors.light.text.secondary}>{translateUi("Created:")}{" "}{formatDate(booking.createdAt)}</AppText>
      </Card>
      <Card style={styles.card}>
        <AppText variant="h3">{translateUi("Parking")}</AppText>
        <AppText>{translateUi("Slot:")}{" "}{booking.slotCode}</AppText>
        <AppText>{translateUi("Zone:")}{" "}{booking.zoneName || 'General zone'}</AppText>
        <AppText>{translateUi("Start:")}{" "}{formatDate(booking.startTime)}</AppText>
        <AppText>{translateUi("End:")}{" "}{formatDate(booking.endTime)}</AppText>
      </Card>
      <Card style={styles.card}>
        <AppText variant="h3">{translateUi("Vehicle")}</AppText>
        <AppText>{booking.licensePlate}</AppText>
      </Card>
      <PriceBreakdown
        finalTotal={booking.finalAmount || booking.totalAmount || 0}
        parkingCost={booking.prepaidAmount || 0}
        refundAmount={booking.refundAmount || 0}
        serviceCost={booking.serviceAmount || 0}
      />
      <Card style={styles.card}>
        <AppText variant="h3">{translateUi("Payment")}</AppText>
        <AppText>{translateUi("Method:")}{" "}{booking.paymentMethod}</AppText>
        <AppText>{translateUi("Status:")}{" "}{booking.paymentStatus}</AppText>
        <AppText color={colors.primary[500]} style={styles.amount}>{translateUi("Total:")}{" "}{formatCurrency(booking.finalAmount || booking.totalAmount || 0)}</AppText>
      </Card>
      {['confirmed', 'active'].includes(booking.status) ? <QRCodeDisplay bookingId={booking._id} /> : null}
      {booking.status === 'confirmed' ? (
        <>
          <Button loading={isLoading} title={translateUi("Manual Check-In")} onPress={handleCheckIn} />
          <Button
            title={translateUi("Scan QR to Check-In")}
            variant="outline"
            onPress={() => navigation.navigate('QRScanner', { mode: 'check-in', bookingId: booking._id })}
          />
        </>
      ) : null}
      {booking.status === 'active' ? (
        <>
          <Button loading={isLoading} title={translateUi("Check-Out")} onPress={handleCheckOut} />
          <Button
            title={translateUi("Scan QR to Check-Out")}
            variant="outline"
            onPress={() => navigation.navigate('QRScanner', { mode: 'check-out', bookingId: booking._id })}
          />
        </>
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  identifier: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  amount: { fontWeight: '600', fontVariant: ['tabular-nums'] },
});
