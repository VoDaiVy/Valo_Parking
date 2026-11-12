import { useLanguage } from '@/contexts/LanguageContext';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet } from 'react-native';

import { PriceBreakdown } from '@/components/booking/PriceBreakdown';
import { QRCodeDisplay } from '@/components/booking/QRCodeDisplay';
import { StatusBadge } from '@/components/booking/StatusBadge';
import { AppText, Button, Card } from '@/components/common';
import { Screen } from '@/components/layout/Screen';
import { useBooking } from '@/hooks/useBooking';
import type { BookingStackParamList } from '@/navigation/types';
import { colors, spacing } from '@/theme';
import { formatCurrency, formatDate } from '@/utils/formatters';

type Props = NativeStackScreenProps<BookingStackParamList, 'BookingConfirmation'>;

export const BookingConfirmationScreen = ({ navigation, route }: Props) => {
  const { t: translateUi } = useLanguage();
  const { getBookingById } = useBooking();
  const booking = getBookingById(route.params.bookingId);

  if (!booking) {
    return (
      <Screen scrollable>
        <AppText color={colors.success.main} variant="h1">{translateUi("Booking Confirmed")}</AppText>
        <QRCodeDisplay bookingId={route.params.bookingId} />
        <Button title={translateUi("My Bookings")} onPress={() => navigation.navigate('MyBookings')} />
      </Screen>
    );
  }

  return (
    <Screen scrollable>
      <AppText color={colors.success.main} variant="h1">{translateUi("Booking Confirmed")}</AppText>
      <QRCodeDisplay bookingId={booking._id} />
      <Card style={styles.card}>
        <StatusBadge status={booking.status} />
        <AppText variant="h3">{booking.slotCode}</AppText>
        <AppText color={colors.light.text.secondary}>{booking.licensePlate}</AppText>
        <AppText>{translateUi("Start:")}{" "}{formatDate(booking.startTime)}</AppText>
        <AppText>{translateUi("End:")}{" "}{formatDate(booking.endTime)}</AppText>
        <AppText color={colors.primary[500]} style={styles.amount}>{translateUi("Total paid:")}{" "}{formatCurrency(booking.finalAmount || booking.totalAmount || 0)}</AppText>
      </Card>
      {booking.services?.length ? (
        <Card style={styles.card}>
          <AppText variant="h3">{translateUi("Services")}</AppText>
          {booking.services.map((service) => (
            <AppText key={service._id || service.serviceId || service.name}>
              {service.name} - {formatCurrency(service.price)}
            </AppText>
          ))}
        </Card>
      ) : null}
      <PriceBreakdown
        finalTotal={booking.finalAmount || booking.totalAmount || 0}
        parkingCost={booking.prepaidAmount || 0}
        serviceCost={booking.serviceAmount || 0}
      />
      <Button title={translateUi("My Bookings")} onPress={() => navigation.navigate('MyBookings')} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  amount: { fontWeight: '600', fontVariant: ['tabular-nums'] },
});
