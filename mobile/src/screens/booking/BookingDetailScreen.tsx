import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ScreenHeader, SectionTitle } from '@/components/common';
import {
  BookingActionModal,
  type BookingModalVariant,
} from '@/components/booking/BookingActionModal';
import { QRCodeDisplay } from '@/components/booking/QRCodeDisplay';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import { useBooking } from '@/hooks/useBooking';
import { bookingService } from '@/services/BookingService';
import type { BookingStackParamList } from '@/navigation/BookingStackNavigator';
import { vehiclesService } from '@/services/api/vehicles';
import type { BookingStatus, PaymentStatus } from '@/types/booking.types';
import type { Vehicle } from '@/types/models';
import { canExtendBookingBy, getBookingActionAvailability } from '@/utils/bookingActions';
import { formatCurrency } from '@/utils/formatters';

type Props = NativeStackScreenProps<BookingStackParamList, 'BookingDetail'>;

interface ActionDialog {
  variant: BookingModalVariant;
  title: string;
  message: string;
  primaryLabel: string;
  secondaryLabel?: string;
  destructive?: boolean;
  onConfirm?: () => Promise<void>;
}

const EXTENSION_OPTIONS = [30, 60, 120];

const STATUS_LABELS: Record<BookingStatus, { label: string; color: string; bg: string }> = {
  pending: { label: 'Payment pending', color: COLORS.warning, bg: 'rgba(255,159,67,0.12)' },
  confirmed: { label: 'Confirmed', color: COLORS.staffBlue, bg: 'rgba(96,180,255,0.12)' },
  active: { label: 'Parked', color: COLORS.success, bg: 'rgba(76,175,80,0.12)' },
  paused: { label: 'Paused', color: COLORS.warning, bg: 'rgba(255,159,67,0.12)' },
  completed: { label: 'Completed', color: COLORS.textMuted, bg: COLORS.surfaceElevated },
  cancelled: { label: 'Cancelled', color: COLORS.error, bg: 'rgba(255,77,77,0.12)' },
  expired: { label: 'Expired', color: COLORS.warning, bg: 'rgba(255,159,67,0.12)' },
};

function safeFormat(dateValue: string, pattern: string) {
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? 'N/A' : format(date, pattern);
}

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  paid: 'Paid',
  partially_refunded: 'Partially refunded',
  refunded: 'Refunded',
  failed: 'Payment failed',
  pending: 'Payment pending',
};

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

export const BookingDetailScreen = ({ navigation, route }: Props) => {
  const {
    isLoading,
    fetchBookings,
    getBookingById,
    checkInBooking,
    checkOutBooking,
    cancelBooking,
    extendBooking,
    updateBookingVehicle,
  } = useBooking();
  const [actionLoading, setActionLoading] = useState(false);
  const [extendModalVisible, setExtendModalVisible] = useState(false);
  const [extendingMinutes, setExtendingMinutes] = useState<number | null>(null);
  const [vehicleModalVisible, setVehicleModalVisible] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [actionDialog, setActionDialog] = useState<ActionDialog | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState('');
  const booking = getBookingById(route.params.bookingId);

  useEffect(() => {
    if (!booking) {
      void fetchBookings();
    }
  }, [booking, fetchBookings]);

  useEffect(() => {
    if (!booking || !['confirmed', 'active', 'paused'].includes(booking.status)) {
      setQrPayload(null);
      setQrError('');
      return;
    }

    let active = true;
    setQrLoading(true);
    setQrError('');
    void bookingService.getBookingQr(booking._id)
      .then((response) => {
        if (!active) return;
        setQrPayload(response.data?.payload || null);
      })
      .catch((error) => {
        if (!active) return;
        setQrError(error instanceof Error ? error.message : 'Unable to load booking QR.');
      })
      .finally(() => {
        if (active) setQrLoading(false);
      });

    return () => {
      active = false;
    };
  }, [booking?._id, booking?.status]);

  useEffect(() => {
    if (!vehicleModalVisible) return;

    let active = true;
    setVehiclesLoading(true);
    void vehiclesService.getMyVehicles()
      .then((response) => {
        if (!active) return;
        const approved = (response.data || []).filter((vehicle) => !vehicle.status || vehicle.status === 'approved');
        setVehicles(approved);
        setSelectedVehicleId((current) => current || String(approved[0]?._id ?? approved[0]?.id ?? ''));
      })
      .catch((error) => {
        if (active) {
          setVehicleModalVisible(false);
          showFeedback('error', 'Unable to load vehicles', error instanceof Error ? error.message : 'Unable to load the vehicle list.');
        }
      })
      .finally(() => {
        if (active) setVehiclesLoading(false);
      });

    return () => { active = false; };
  }, [vehicleModalVisible]);

  const showFeedback = (variant: BookingModalVariant, title: string, message: string) => {
    setActionDialog({ variant, title, message, primaryLabel: 'Close' });
  };

  const runAction = async (
    action: () => Promise<void>,
    successTitle: string,
    successMessage: string,
    fallbackError: string,
  ) => {
    setActionLoading(true);
    try {
      await action();
      showFeedback('success', successTitle, successMessage);
    } catch (error) {
      showFeedback('error', 'Action unavailable', error instanceof Error ? error.message : fallbackError);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDialogPrimary = () => {
    if (!actionDialog?.onConfirm) {
      setActionDialog(null);
      return;
    }

    void actionDialog.onConfirm();
  };

  const handleCheckIn = () => {
    setActionDialog({
      variant: 'info',
      title: 'Confirm check-in',
      message: 'Are you at the assigned space and ready to start your parking session?',
      primaryLabel: 'Check-in ngay',
      secondaryLabel: 'Not now',
      onConfirm: () =>
        runAction(
          () => checkInBooking(route.params.bookingId),
          'Check-in successful',
          'Your parking session has started.',
          'Check-in failed',
        ),
    });
  };

  const handleCheckOut = () => {
    setActionDialog({
      variant: 'warning',
      title: 'End parking session?',
      message: 'The final fee will be calculated automatically, with any difference charged to or refunded to your wallet.',
      primaryLabel: 'Confirm check-out',
      secondaryLabel: 'Keep parking',
      onConfirm: () =>
        runAction(
          () => checkOutBooking(route.params.bookingId),
          'Check-out successful',
          'Your parking session has ended and your wallet balance has been updated.',
          'Check-out failed',
        ),
    });
  };

  const handleCancel = async () => {
    if (!booking) return;
    setActionLoading(true);
    try {
      const response = await bookingService.getCancellationQuote(booking._id);
      const amount = response.data?.refundAmount;
      if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error('Unable to load the refund amount. Please try again.');
      setActionDialog({
      variant: 'error',
      title: 'Cancel booking?',
      message: `Estimated refund: ${formatCurrency(amount)}. The booking refund policy applies; the final amount is calculated when cancellation is confirmed.`,
      primaryLabel: 'Confirm cancellation',
      secondaryLabel: 'Keep booking',
      destructive: true,
      onConfirm: () =>
        runAction(
          () => cancelBooking(booking._id),
          'Booking cancelled',
          'Booking cancelled. Check your wallet and transaction history for the policy-based refund.',
          'Cancellation failed',
        ),
      });
    } catch (error) {
      showFeedback('error', 'Unable to load refund quote', error instanceof Error ? error.message : 'Please try again.');
    } finally { setActionLoading(false); }
  };

  const handleExtend = async (minutes: number) => {
    if (!booking) return;

    const currentEnd = new Date(booking.endTime);
    if (Number.isNaN(currentEnd.getTime())) {
      showFeedback('error', 'Unable to extend', 'The current end time is invalid.');
      return;
    }

    if (!canExtendBookingBy(booking, minutes)) {
      showFeedback('warning', 'Invalid extension', 'The new end time must be in the future and total duration must be at least one hour.');
      return;
    }

    const newEnd = new Date(currentEnd.getTime() + minutes * 60_000);
    setExtendingMinutes(minutes);
    setActionLoading(true);
    try {
      await extendBooking(booking._id, {
        newStart: booking.startTime,
        newEnd: newEnd.toISOString(),
      });
      setExtendModalVisible(false);
      showFeedback(
        'success',
        'Booking extended',
        `New end time: ${safeFormat(newEnd.toISOString(), 'HH:mm dd/MM/yyyy')}`,
      );
    } catch (error) {
      setExtendModalVisible(false);
      showFeedback(
        'error',
        'Unable to extend',
        error instanceof Error ? error.message : 'Failed to extend the booking',
      );
    } finally {
      setExtendingMinutes(null);
      setActionLoading(false);
    }
  };

  const handleChangeVehicle = async () => {
    if (!booking || !selectedVehicleId) return;

    setActionLoading(true);
    try {
      await updateBookingVehicle(booking._id, selectedVehicleId);
      setVehicleModalVisible(false);
      showFeedback('success', 'Vehicle updated', 'The vehicle for this booking has been updated.');
    } catch (error) {
      setVehicleModalVisible(false);
      showFeedback('error', 'Unable to change vehicle', error instanceof Error ? error.message : 'Failed to change the vehicle.');
    } finally {
      setActionLoading(false);
    }
  };

  if (!booking) {
    return (
      <SafeAreaView edges={['top']} style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#080808" />
        <ScreenHeader title="Booking details" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          {isLoading ? (
            <ActivityIndicator color={COLORS.gold} size="large" />
          ) : (
            <EmptyState
              icon="calendar-outline"
              title="Booking not found"
              message="The booking may have changed. Return to the list and refresh."
            />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const statusConfig = STATUS_LABELS[booking.status];
  const floorName = typeof booking.floorId === 'object' ? booking.floorId.name : booking.floorId;
  const { canCancel, canChangeVehicle, canCheckIn, canCheckOut, canExtend } = getBookingActionAvailability(booking);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#080808" />
      <ScreenHeader title="Booking details" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.statusCard}>
          <LinearGradient
            colors={[COLORS.gold, 'transparent']}
            end={{ x: 1, y: 0 }}
            start={{ x: 0, y: 0 }}
            style={styles.cardTopLine}
          />
          <View style={styles.statusRow}>
            <View style={styles.slotCircle}>
              <Ionicons name="location" size={20} color={COLORS.gold} />
              <Text style={styles.slotBig}>{booking.slotCode}</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: statusConfig.bg }]}>
              <Text style={[styles.statusText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
            </View>
          </View>
          {floorName ? <Text style={styles.floorName}>Floor: {floorName}</Text> : null}
        </View>

        {['confirmed', 'active', 'paused'].includes(booking.status) ? (
          <View style={styles.section}>
            <SectionTitle>Booking QR</SectionTitle>
            {qrLoading ? (
              <ActivityIndicator color={COLORS.gold} size="large" />
            ) : qrPayload ? (
              <>
                <QRCodeDisplay
                  value={qrPayload}
                  reference={booking._id}
                  showBrightnessControl
                />
                <Text style={styles.qrHint}>
                  Present this same code on mobile or web to the kiosk or a staff member.
                </Text>
              </>
            ) : (
              <Text style={styles.qrError}>{qrError || 'This QR code is no longer available.'}</Text>
            )}
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionTitle>Booking time</SectionTitle>
          <View style={styles.timeRow}>
            <View style={styles.timeBlock}>
              <Text style={styles.timeLabel}>Arrival</Text>
              <Text style={styles.timeValue}>{safeFormat(booking.startTime, 'HH:mm')}</Text>
              <Text style={styles.timeDate}>{safeFormat(booking.startTime, 'dd/MM/yyyy')}</Text>
            </View>
            <View style={styles.timeSep}>
              <Ionicons name="arrow-forward" size={18} color={COLORS.textMuted} />
              <Text style={styles.timeDuration}>{booking.paidHours}h</Text>
            </View>
            <View style={[styles.timeBlock, styles.timeBlockRight]}>
              <Text style={styles.timeLabel}>Departure</Text>
              <Text style={styles.timeValue}>{safeFormat(booking.endTime, 'HH:mm')}</Text>
              <Text style={styles.timeDate}>{safeFormat(booking.endTime, 'dd/MM/yyyy')}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle>Vehicle</SectionTitle>
          <View style={styles.infoCard}>
            <View style={styles.plateBig}>
              <Text style={styles.plateBigText}>{booking.licensePlate}</Text>
            </View>
            {canChangeVehicle ? (
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={actionLoading}
                style={styles.changeVehicleBtn}
                onPress={() => setVehicleModalVisible(true)}
              >
                <Ionicons name="swap-horizontal-outline" size={18} color={COLORS.staffBlue} />
                <Text style={styles.changeVehicleText}>Change vehicle</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle>Payment</SectionTitle>
          <View style={styles.infoCard}>
            <InfoRow label="Method" value={booking.paymentMethod === 'vietqr' ? 'VietQR' : 'VALO Wallet'} />
            <View style={styles.divider} />
            <InfoRow
              label="Status"
              value={PAYMENT_LABELS[booking.paymentStatus]}
              valueColor={booking.paymentStatus === 'paid' ? COLORS.success : undefined}
            />
            <View style={styles.divider} />
            <InfoRow label="Prepaid" value={formatCurrency(booking.prepaidAmount)} />
            {booking.serviceAmount > 0 ? (
              <>
                <View style={styles.divider} />
                <InfoRow label="Services" value={formatCurrency(booking.serviceAmount)} />
              </>
            ) : null}
            {(booking.refundAmount ?? 0) > 0 ? (
              <>
                <View style={styles.divider} />
                <InfoRow
                  label="Refund"
                  value={`-${formatCurrency(booking.refundAmount ?? 0)}`}
                  valueColor={COLORS.success}
                />
              </>
            ) : null}
            <View style={[styles.divider, styles.strongDivider]} />
            <View style={styles.infoRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{formatCurrency(booking.finalAmount ?? booking.prepaidAmount ?? 0)}</Text>
            </View>
          </View>
        </View>

        {canExtend || canCancel ? (
          <View style={styles.managementRow}>
            {canExtend ? (
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={actionLoading}
                style={[styles.managementBtn, styles.extendBtn]}
                onPress={() => setExtendModalVisible(true)}
              >
                <Ionicons name="time-outline" size={19} color={COLORS.gold} />
                <Text style={styles.extendText}>Extend</Text>
              </TouchableOpacity>
            ) : null}
            {canCancel ? (
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={actionLoading}
                style={[styles.managementBtn, styles.cancelBtn]}
                onPress={handleCancel}
              >
                <Ionicons name="trash-outline" size={19} color={COLORS.error} />
                <Text style={styles.cancelText}>Cancel booking</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {canCheckIn || canCheckOut ? (
          <View style={styles.actionsRow}>
            {canCheckIn ? (
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={actionLoading}
                style={styles.checkInBtn}
                onPress={handleCheckIn}
              >
                {actionLoading ? (
                  <ActivityIndicator color={COLORS.staffBlue} size="small" />
                ) : (
                  <>
                    <Ionicons name="log-in-outline" size={20} color={COLORS.staffBlue} />
                    <Text style={styles.checkInText}>Check-in</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
            {canCheckOut ? (
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={actionLoading}
                style={styles.checkoutBtn}
                onPress={handleCheckOut}
              >
                <LinearGradient
                  colors={[COLORS.goldLight, COLORS.gold, COLORS.goldDark]}
                  end={{ x: 1, y: 0 }}
                  start={{ x: 0, y: 0 }}
                  style={styles.checkoutGrad}
                >
                  {actionLoading ? (
                    <ActivityIndicator color={COLORS.textInverse} size="small" />
                  ) : (
                    <>
                      <Ionicons name="log-out-outline" size={20} color={COLORS.textInverse} />
                      <Text style={styles.checkoutText}>Check-out</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <Modal
        animationType="fade"
        transparent
        visible={vehicleModalVisible}
        onRequestClose={() => setVehicleModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Change vehicle</Text>
            <Text style={styles.modalSubtitle}>Only approved vehicles can be used for this booking.</Text>
            {vehiclesLoading ? (
              <ActivityIndicator color={COLORS.gold} size="large" style={styles.vehicleLoader} />
            ) : (
              <View style={styles.vehicleOptions}>
                {vehicles.map((vehicle) => {
                  const vehicleId = String(vehicle._id ?? vehicle.id);
                  const selected = vehicleId === selectedVehicleId;
                  return (
                    <TouchableOpacity
                      key={vehicleId}
                      activeOpacity={0.8}
                      style={[styles.vehicleOption, selected && styles.vehicleOptionSelected]}
                      onPress={() => setSelectedVehicleId(vehicleId)}
                    >
                      <View>
                        <Text style={styles.vehiclePlate}>{vehicle.licensePlate}</Text>
                        <Text style={styles.vehicleMeta}>{[vehicle.brand, vehicle.model].filter(Boolean).join(' ')}</Text>
                      </View>
                      <Ionicons
                        name={selected ? 'radio-button-on' : 'radio-button-off'}
                        size={20}
                        color={selected ? COLORS.gold : COLORS.textMuted}
                      />
                    </TouchableOpacity>
                  );
                })}
                {!vehicles.length ? <Text style={styles.modalNote}>You do not have any approved vehicles.</Text> : null}
              </View>
            )}
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={!selectedVehicleId || actionLoading || vehiclesLoading}
              style={[styles.vehicleConfirmBtn, (!selectedVehicleId || vehiclesLoading) && styles.vehicleConfirmDisabled]}
              onPress={() => void handleChangeVehicle()}
            >
              {actionLoading ? <ActivityIndicator color={COLORS.textInverse} size="small" /> : <Text style={styles.vehicleConfirmText}>Confirm vehicle</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={actionLoading}
              style={styles.modalCloseBtn}
              onPress={() => setVehicleModalVisible(false)}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={extendModalVisible}
        onRequestClose={() => setExtendModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconGlow}>
              <Ionicons name="time" size={70} color={COLORS.gold} />
            </View>
            <Text style={styles.modalTitle}>Extend booking</Text>
            <Text style={styles.modalSubtitle}>
              Current end time: {safeFormat(booking.endTime, 'HH:mm dd/MM/yyyy')}
            </Text>
            <Text style={styles.modalHint}>Choose an extension</Text>
            <View style={styles.extensionOptions}>
              {EXTENSION_OPTIONS.map((minutes) => {
                const optionAvailable = canExtendBookingBy(booking, minutes);
                return (
                  <TouchableOpacity
                    key={minutes}
                    activeOpacity={0.8}
                    disabled={actionLoading || !optionAvailable}
                    style={[styles.extensionOption, !optionAvailable && styles.extensionOptionDisabled]}
                    onPress={() => void handleExtend(minutes)}
                  >
                    {extendingMinutes === minutes ? (
                      <ActivityIndicator color={COLORS.gold} size="small" />
                    ) : (
                      <>
                        <Ionicons
                          name="add-circle-outline"
                          size={20}
                          color={optionAvailable ? COLORS.gold : COLORS.textMuted}
                        />
                        <Text
                          style={[
                            styles.extensionOptionText,
                            !optionAvailable && styles.extensionOptionTextDisabled,
                          ]}
                        >
                          +{minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.modalNote}>Any additional fee will be charged to your wallet after availability is verified.</Text>
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={actionLoading}
              style={styles.modalCloseBtn}
              onPress={() => setExtendModalVisible(false)}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <BookingActionModal
        destructive={actionDialog?.destructive}
        loading={actionLoading}
        message={actionDialog?.message}
        primaryLabel={actionDialog?.primaryLabel ?? 'Close'}
        secondaryLabel={actionDialog?.secondaryLabel}
        title={actionDialog?.title ?? ''}
        variant={actionDialog?.variant ?? 'info'}
        visible={Boolean(actionDialog)}
        onClose={() => {
          if (!actionLoading) setActionDialog(null);
        }}
        onPrimary={handleDialogPrimary}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  scroll: { gap: SPACING.md, padding: SPACING.lg, paddingBottom: SPACING.xxl },
  statusCard: {
    backgroundColor: COLORS.surface,
    borderColor: 'rgba(212,175,55,0.2)',
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    gap: SPACING.sm,
    overflow: 'hidden',
    padding: SPACING.lg,
  },
  cardTopLine: { height: 2, left: 0, position: 'absolute', right: 0, top: 0 },
  statusRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  slotCircle: { alignItems: 'center', flexDirection: 'row', gap: SPACING.xs },
  slotBig: { color: COLORS.textPrimary, fontSize: FONT_SIZES.xxl, fontWeight: '800' },
  statusPill: { borderRadius: RADIUS.round, paddingHorizontal: SPACING.md, paddingVertical: 5 },
  statusText: { fontSize: FONT_SIZES.sm, fontWeight: '600' },
  floorName: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
  section: { gap: SPACING.sm },
  timeRow: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    padding: SPACING.lg,
  },
  timeBlock: { flex: 1 },
  timeBlockRight: { alignItems: 'flex-end' },
  timeLabel: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
  timeValue: { color: COLORS.textPrimary, fontSize: FONT_SIZES.xl, fontWeight: '700' },
  timeDate: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs },
  timeSep: { alignItems: 'center', paddingHorizontal: SPACING.sm },
  timeDuration: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 },
  infoCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md,
  },
  qrHint: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
  qrError: {
    color: COLORS.error,
    fontSize: FONT_SIZES.sm,
    textAlign: 'center',
  },
  plateBig: {
    alignSelf: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.borderLight,
    borderRadius: RADIUS.md,
    borderWidth: 2,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
  },
  plateBigText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.xxl,
    fontWeight: '800',
    letterSpacing: 3,
  },
  changeVehicleBtn: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: SPACING.xs,
    marginTop: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  changeVehicleText: { color: COLORS.staffBlue, fontSize: FONT_SIZES.sm, fontWeight: '700' },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs,
  },
  infoLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
  infoValue: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '500' },
  divider: { backgroundColor: COLORS.border, height: 1, marginVertical: 2 },
  strongDivider: { backgroundColor: COLORS.borderLight },
  totalLabel: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '700' },
  totalValue: { color: COLORS.gold, fontSize: FONT_SIZES.lg, fontWeight: '800' },
  actionsRow: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.sm },
  managementRow: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.sm },
  managementBtn: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: SPACING.xs,
    height: 52,
    justifyContent: 'center',
  },
  extendBtn: { backgroundColor: 'rgba(212,175,55,0.1)', borderColor: COLORS.gold },
  extendText: { color: COLORS.gold, fontSize: FONT_SIZES.md, fontWeight: '600' },
  cancelBtn: { backgroundColor: 'rgba(255,77,77,0.1)', borderColor: COLORS.error },
  cancelText: { color: COLORS.error, fontSize: FONT_SIZES.md, fontWeight: '600' },
  checkInBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(96,180,255,0.12)',
    borderColor: COLORS.staffBlue,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: SPACING.xs,
    height: 52,
    justifyContent: 'center',
  },
  checkInText: { color: COLORS.staffBlue, fontSize: FONT_SIZES.md, fontWeight: '600' },
  checkoutBtn: { borderRadius: RADIUS.md, flex: 1, overflow: 'hidden' },
  checkoutGrad: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.xs,
    height: 52,
    justifyContent: 'center',
  },
  checkoutText: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '700' },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    flex: 1,
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  modalCard: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: 'rgba(212,175,55,0.3)',
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SPACING.xl,
    width: '100%',
  },
  modalIconGlow: {
    alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.1)',
    borderRadius: RADIUS.round,
    height: 92,
    justifyContent: 'center',
    marginBottom: SPACING.md,
    width: 92,
  },
  modalTitle: {
    color: COLORS.gold,
    fontSize: FONT_SIZES.xl,
    fontWeight: '800',
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  modalSubtitle: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    lineHeight: 21,
    textAlign: 'center',
  },
  modalHint: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '600', marginTop: SPACING.lg },
  extensionOptions: { gap: SPACING.sm, marginTop: SPACING.md, width: '100%' },
  vehicleLoader: { marginVertical: SPACING.xl },
  vehicleOptions: { gap: SPACING.sm, marginTop: SPACING.lg, width: '100%' },
  vehicleOption: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: SPACING.md,
  },
  vehicleOptionSelected: { borderColor: COLORS.gold },
  vehiclePlate: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '800' },
  vehicleMeta: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 },
  vehicleConfirmBtn: {
    alignItems: 'center',
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    marginTop: SPACING.lg,
    minHeight: 50,
    width: '100%',
  },
  vehicleConfirmDisabled: { opacity: 0.55 },
  vehicleConfirmText: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '800' },
  extensionOption: {
    alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.08)',
    borderColor: 'rgba(212,175,55,0.35)',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    height: 50,
    justifyContent: 'center',
  },
  extensionOptionText: { color: COLORS.gold, fontSize: FONT_SIZES.md, fontWeight: '700' },
  extensionOptionDisabled: { backgroundColor: COLORS.surfaceElevated, borderColor: COLORS.border, opacity: 0.55 },
  extensionOptionTextDisabled: { color: COLORS.textMuted },
  modalNote: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    lineHeight: 18,
    marginTop: SPACING.md,
    textAlign: 'center',
  },
  modalCloseBtn: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: SPACING.lg,
    minHeight: 50,
    width: '100%',
  },
  modalCloseText: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '600' },
});
