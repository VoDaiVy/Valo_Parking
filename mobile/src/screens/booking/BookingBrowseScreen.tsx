import { useLanguage } from '@/contexts/LanguageContext';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PriceBreakdown } from '@/components/booking/PriceBreakdown';
import { ServiceCard } from '@/components/booking/ServiceCard';
import { TimeRangePicker } from '@/components/booking/TimeRangePicker';
import { AppText, Button, Card, LoadingSpinner } from '@/components/common';
import { Screen } from '@/components/layout/Screen';
import { useAuth } from '@/hooks/useAuth';
import { useBooking } from '@/hooks/useBooking';
import { useToast } from '@/hooks/useToast';
import type { BookingStackParamList } from '@/navigation/types';
import { vehiclesService } from '@/services/api/vehicles';
import { borderRadius, colors, spacing } from '@/theme';
import type { AvailableSlot, Service } from '@/types/booking.types';
import type { Vehicle } from '@/types/models';
import { getDefaultBookingRange, validateTimeRange, validateWalletBalance } from '@/utils/bookingValidation';
import {
  calculateParkingCost,
  calculateServiceCost,
  calculateTotalBookingCost,
} from '@/utils/priceCalculation';

type Props = NativeStackScreenProps<BookingStackParamList, 'BookingBrowse'>;

const HOURLY_RATE = 10000;

export const BookingBrowseScreen = ({ navigation }: Props) => {
  const { t: translateUi } = useLanguage();
  const toast = useToast();
  const { user } = useAuth();
  const {
    availableSlots,
    services,
    walletBalance,
    isLoading,
    error,
    fetchParkingFloors,
    fetchServices,
    fetchWalletBalance,
    getAvailableSlots,
    createBooking,
  } = useBooking();
  const defaults = useMemo(() => getDefaultBookingRange(), []);
  const [startTime, setStartTime] = useState(defaults.startTime);
  const [endTime, setEndTime] = useState(defaults.endTime);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const isFreeServiceEligible = Boolean(user?.membership?.freeServiceCount);
  const parkingCost = calculateParkingCost(startTime, endTime, HOURLY_RATE, false);
  const serviceCost = calculateServiceCost(selectedServices, isFreeServiceEligible);
  const totalCost = calculateTotalBookingCost({ parkingCost, serviceCost });
  const timeValidation = validateTimeRange(startTime, endTime);
  const balanceValidation = validateWalletBalance(walletBalance, totalCost);

  useEffect(() => {
    void fetchParkingFloors();
    void fetchServices();
    void fetchWalletBalance();
    void vehiclesService.getMyVehicles().then((response) => {
      const approved = (response.data || []).filter((vehicle) => !vehicle.status || vehicle.status === 'approved');
      setVehicles(approved);
      setSelectedVehicleId(
        approved.find((vehicle) => vehicle.isDefault)?.id ||
          approved.find((vehicle) => vehicle.isDefault)?._id ||
          approved[0]?.id ||
          approved[0]?._id ||
          '',
      );
    });
  }, [fetchParkingFloors, fetchServices, fetchWalletBalance]);

  useEffect(() => {
    if (timeValidation.valid) {
      void getAvailableSlots(startTime, endTime);
    }
  }, [endTime, getAvailableSlots, startTime, timeValidation.valid]);

  const groupedSlots = useMemo(() => {
    return availableSlots.reduce<Record<string, AvailableSlot[]>>((acc, slot) => {
      const group = slot.floorName || String(slot.floorId);
      acc[group] = [...(acc[group] || []), slot];
      return acc;
    }, {});
  }, [availableSlots]);

  const toggleService = (service: Service) => {
    setSelectedServices((current) =>
      current.some((item) => item._id === service._id)
        ? current.filter((item) => item._id !== service._id)
        : [...current, service],
    );
  };

  const handleCreateBooking = async () => {
    if (!selectedSlot || !selectedVehicleId || !timeValidation.valid || !balanceValidation.valid) {
      return;
    }

    setSubmitting(true);
    try {
      const booking = await createBooking({
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        floorId: selectedSlot.floorId,
        slotCode: selectedSlot.slotCode,
        vehicleId: selectedVehicleId,
        serviceIds: selectedServices.map((service) => service._id),
      });
      toast.showSuccess('Booking confirmed');
      navigation.navigate('BookingConfirmation', { bookingId: booking._id });
    } catch (submitError) {
      toast.showError('Booking failed', submitError instanceof Error ? submitError.message : undefined);
      void getAvailableSlots(startTime, endTime);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scrollable>
      <View style={styles.header}>
        <AppText variant="h1">{translateUi("Create Booking")}</AppText>
        <Button title={translateUi("My Bookings")} variant="outline" onPress={() => navigation.navigate('MyBookings')} />
      </View>
      <TimeRangePicker
        endTime={endTime}
        startTime={startTime}
        onEndTimeChange={setEndTime}
        onStartTimeChange={(date) => {
          setStartTime(date);
          if (endTime.getTime() - date.getTime() < 60 * 60 * 1000) {
            setEndTime(new Date(date.getTime() + 60 * 60 * 1000));
          }
        }}
      />
      <Card style={styles.section}>
        <AppText variant="h3">{translateUi("Available slots:")}{" "}{availableSlots.length}</AppText>
        {isLoading ? <LoadingSpinner /> : null}
        {error ? <AppText color={colors.error.main}>{translateUi(error)}</AppText> : null}
        {!isLoading && availableSlots.length === 0 ? (
          <AppText color={colors.light.text.secondary}>{translateUi("No available slots for this time.")}</AppText>
        ) : null}
      </Card>
      {Object.entries(groupedSlots).map(([floor, slots]) => (
        <Card key={floor} style={styles.section}>
          <View style={styles.header}>
            <AppText variant="h3">{floor}</AppText>
            <Button
              title={translateUi("Map")}
              variant="ghost"
              onPress={() =>
                navigation.navigate('ParkingMap', {
                  floorId: slots[0]?.floorId,
                  selectedTimeRange: {
                    startTime: startTime.toISOString(),
                    endTime: endTime.toISOString(),
                  },
                })
              }
            />
          </View>
          {slots.map((slot) => (
            <Pressable
              key={`${slot.floorId}-${slot.slotCode}`}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedSlot?.slotCode === slot.slotCode }}
              onPress={() => setSelectedSlot(slot)}
              style={({ pressed }) => [styles.option, selectedSlot?.slotCode === slot.slotCode && styles.optionSelected, pressed && styles.pressed]}
            >
              <AppText variant="body2">{slot.slotCode}</AppText>
              <AppText color={colors.light.text.secondary} variant="caption">
                {slot.zoneName || 'General zone'}
              </AppText>
            </Pressable>
          ))}
        </Card>
      ))}
      <Card style={styles.section}>
        <AppText variant="h3">{translateUi("Vehicle")}</AppText>
        {vehicles.length === 0 ? (
          <AppText color={colors.warning.main}>{translateUi("Add a vehicle to start booking.")}</AppText>
        ) : (
          vehicles.map((vehicle) => {
            const vehicleId = vehicle.id || vehicle._id || '';
            return (
              <Pressable
                key={vehicleId}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedVehicleId === vehicleId }}
                onPress={() => setSelectedVehicleId(vehicleId)}
                style={({ pressed }) => [styles.option, selectedVehicleId === vehicleId && styles.optionSelected, pressed && styles.pressed]}
              >
                <AppText>{vehicle.licensePlate}</AppText>
                <AppText color={colors.light.text.secondary} variant="caption">
                  {vehicle.brand} {vehicle.model} - {vehicle.color}
                </AppText>
              </Pressable>
            );
          })
        )}
      </Card>
      {services.length > 0 ? (
        <View>
          <AppText variant="h3">{translateUi("Optional services")}</AppText>
          {services.map((service, index) => (
            <ServiceCard
              key={service._id}
              isFree={isFreeServiceEligible && index === 0}
              selected={selectedServices.some((item) => item._id === service._id)}
              service={service}
              onToggle={() => toggleService(service)}
            />
          ))}
        </View>
      ) : null}
      <PriceBreakdown parkingCost={parkingCost} serviceCost={serviceCost} finalTotal={totalCost} />
      <Card style={styles.section}>
        <AppText>{translateUi("Wallet balance:")}{" "}{walletBalance.toLocaleString('en-US')} VND</AppText>
        {!balanceValidation.valid ? (
          <>
            <AppText color={colors.error.main}>{balanceValidation.error}</AppText>
            <Button title={translateUi("Top Up Wallet")} variant="outline" onPress={() => navigation.getParent()?.navigate('WalletTab')} />
          </>
        ) : null}
      </Card>
      <Button
        disabled={!selectedSlot || !selectedVehicleId || !timeValidation.valid || !balanceValidation.valid}
        loading={submitting}
        title={submitting ? 'Creating booking...' : 'Confirm Booking'}
        onPress={handleCreateBooking}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  section: {
    gap: spacing.md,
  },
  option: {
    borderColor: colors.light.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.light.surfaceElevated,
    minHeight: 48,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  optionSelected: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
  },
  pressed: { opacity: 0.85 },
});
