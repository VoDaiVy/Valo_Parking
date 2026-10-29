import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BarcodeScanningResult } from 'expo-camera';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Linking,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { StaffHeader, StatusBadge, StatusStrip } from '@/components/staff';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '@/constants/theme';
import type { StaffManagementStackParamList } from '@/navigation/StaffNavigator';
import {
  staffService,
  type StaffBookingQrAction,
  type StaffBookingQrResolution,
  type StaffMembershipQrResolution,
  type StaffParkingPassResolution,
  type ParkingCheckoutQuote,
} from '@/services/api/staff';

type Props = NativeStackScreenProps<StaffManagementStackParamList, 'BookingScanner'>;
type Phase = 'scan' | 'detail' | 'capture' | 'confirm' | 'success';
type QrResolution = StaffBookingQrResolution | StaffMembershipQrResolution | StaffParkingPassResolution;

const actionLabel = (action: StaffBookingQrAction) =>
  action === 'CHECK_IN' ? 'Check in vehicle' : 'Check out vehicle';
const isMembershipResolution = (
  value: QrResolution | null,
): value is StaffMembershipQrResolution => Boolean(value && 'membership' in value);

export function StaffBookingQrScreen({ navigation }: Props) {
  const cameraRef = useRef<CameraView | null>(null);
  const resolvingRef = useRef(false);
  const submittingRef = useRef(false);
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('scan');
  const [busy, setBusy] = useState(false);
  const [qrCapturing, setQrCapturing] = useState(false);
  const [error, setError] = useState('');
  const [qrPayload, setQrPayload] = useState('');
  const [resolution, setResolution] = useState<QrResolution | null>(null);
  const [selectedAction, setSelectedAction] = useState<StaffBookingQrAction | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedSlotKey, setSelectedSlotKey] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [evidenceUri, setEvidenceUri] = useState('');
  const [evidenceBase64, setEvidenceBase64] = useState('');
  const [reason, setReason] = useState('Staff assisted parking');
  const [quote, setQuote] = useState<ParkingCheckoutQuote | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [payment, setPayment] = useState<{ orderCode?: number; qrCode?: string; checkoutUrl?: string; checkoutAttemptId?: string } | null>(null);
  const [keepPaused, setKeepPaused] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  useEffect(() => {
    if (!permission) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const reset = () => {
    setPhase('scan');
    setBusy(false);
    setQrCapturing(false);
    setError('');
    setQrPayload('');
    setResolution(null);
    setSelectedAction(null);
    setSelectedVehicleId('');
    setSelectedSlotKey('');
    setSelectedSessionId('');
    setEvidenceUri('');
    setEvidenceBase64('');
    setReason('Staff assisted parking');
    setQuote(null); setPayment(null); setPaymentMethod('cash'); setKeepPaused(false);
    setIdempotencyKey('');
  };

  const resolveQr = async (payload: string) => {
    if (busy || resolvingRef.current) return;
    resolvingRef.current = true;
    setBusy(true);
    setError('');
    try {
      const isMembershipQr =
        payload.startsWith('VALO_MEMBERSHIP:') ||
        payload.startsWith('VALO_MEMBERSHIP_ACCOUNT:');
      const isParkingPass = !isMembershipQr;
      const response = isParkingPass ? await staffService.resolveParkingPass(payload) : isMembershipQr
        ? await staffService.resolveMembershipQr(payload)
        : await staffService.resolveBookingQr(payload);
      const result = response.data;
      if (
        !result ||
        (!isMembershipQr && !isParkingPass && !('booking' in result)) ||
        (isMembershipQr && !('membership' in result))
      ) {
        throw new Error('Parking credential information was not returned.');
      }
      if (isParkingPass && result && 'pass' in result && result.allowedActions.includes('CHECK_OUT')) {
        const response = await staffService.quoteParkingPass(result.pass._id, payload);
        setQuote(response.data || null);
      }
      setQrPayload(payload);
      setResolution(result as QrResolution);
      setPhase('detail');
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : 'Unable to resolve this QR code.');
    } finally {
      resolvingRef.current = false;
      setBusy(false);
    }
  };

  const handleQrScanned = ({ data }: BarcodeScanningResult) => {
    if (busy || qrCapturing || phase !== 'scan') return;
    void resolveQr(data);
  };

  const captureQrFrame = async () => {
    if (!cameraRef.current || busy || qrCapturing) return;
    setQrCapturing(true);
    setError('');
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        skipProcessing: true,
      });
      if (!photo?.uri) {
        throw new Error('Unable to capture the QR frame.');
      }
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Unable to capture the QR frame.');
    } finally {
      setQrCapturing(false);
    }
  };

  const startEvidenceCapture = (action: StaffBookingQrAction) => {
    if (isMembershipResolution(resolution)) {
      if (action === 'CHECK_IN' && (!selectedVehicleId || !selectedSlotKey)) {
        setError('Select a membership vehicle and reserved parking space first.');
        return;
      }
      if (action === 'CHECK_OUT' && !selectedSessionId) {
        setError('Select the active parking session to check out.');
        return;
      }
    }
    setSelectedAction(action);
    setEvidenceUri('');
    setEvidenceBase64('');
    setError('');
    setIdempotencyKey(Crypto.randomUUID());
    setPhase('capture');
  };

  const captureEvidence = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    setError('');
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      });
      if (!photo?.uri) {
        throw new Error('Unable to capture the vehicle photo.');
      }

      const processed = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 1280 } }],
        {
          base64: true,
          compress: 0.78,
          format: ImageManipulator.SaveFormat.JPEG,
        },
      );
      if (!processed.base64) {
        throw new Error('Unable to process the evidence photo.');
      }

      setEvidenceUri(processed.uri);
      setEvidenceBase64(`data:image/jpeg;base64,${processed.base64}`);
      setPhase('confirm');
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Unable to capture evidence.');
    } finally {
      setBusy(false);
    }
  };

  const submitTransition = async () => {
    const passResolution = resolution && 'pass' in resolution ? resolution : null;
    const booking = resolution && 'booking' in resolution ? resolution.booking : null;
    const membershipResolution = isMembershipResolution(resolution) ? resolution : null;
    if (
      (!booking && !membershipResolution && !passResolution) ||
      !selectedAction ||
      !evidenceBase64 ||
      !reason.trim() ||
      !idempotencyKey ||
      busy || submittingRef.current
    ) return;

    submittingRef.current = true;
    setBusy(true);
    setError('');
    try {
      const commonPayload = {
        action: selectedAction,
        payload: qrPayload,
        evidenceImageBase64: evidenceBase64,
        idempotencyKey,
        reason: reason.trim(),
      };
      if (passResolution) {
        const result = await staffService.transitionParkingPass(passResolution.pass._id, { ...commonPayload, paymentMethod: selectedAction === 'CHECK_OUT' ? (payment?.checkoutAttemptId ? 'qr' : paymentMethod) : undefined, checkoutAttemptId: payment?.checkoutAttemptId, keepPaused });
        if (result.requiresPayment) { setPayment(result.data || null); setIdempotencyKey(Crypto.randomUUID()); return; }
      } else if (booking) {
        await staffService.transitionBookingByQr(booking._id, commonPayload);
      } else if (membershipResolution) {
        const selectedSlot = membershipResolution.membership.slots?.find((slot) => {
          const floorId = typeof slot.floorId === 'object' ? slot.floorId?._id : slot.floorId;
          return `${floorId}:${slot.slotCode}` === selectedSlotKey;
        });
        const floorId = typeof selectedSlot?.floorId === 'object'
          ? selectedSlot.floorId?._id
          : selectedSlot?.floorId;
        await staffService.transitionMembershipByQr(membershipResolution.membership._id, {
          ...commonPayload,
          entitlementId:
            selectedAction === 'CHECK_IN' ? selectedSlot?.entitlementId : undefined,
          vehicleId: selectedAction === 'CHECK_IN' ? selectedVehicleId : undefined,
          floorId: selectedAction === 'CHECK_IN' ? floorId : undefined,
          parkingSlot: selectedAction === 'CHECK_IN' ? selectedSlot?.slotCode : undefined,
          sessionId: selectedAction === 'CHECK_OUT' ? selectedSessionId : undefined,
        });
      }
      setPhase('success');
    } catch (transitionError) {
      if (transitionError && typeof transitionError === 'object' && 'status' in transitionError) {
        setIdempotencyKey(Crypto.randomUUID());
      }
      setError(
        transitionError instanceof Error
          ? transitionError.message
          : 'Unable to update parking access.',
      );
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  const passResolution = resolution && 'pass' in resolution ? resolution : null;
  const bookingResolution = resolution && !('pass' in resolution) && 'booking' in resolution ? resolution : null;
  const booking = bookingResolution?.booking || null;
  const membershipResolution = isMembershipResolution(resolution) ? resolution : null;
  const selectedVehicle = membershipResolution?.vehicles.find(
    (vehicle) => vehicle._id === selectedVehicleId,
  );
  const selectedSession = membershipResolution?.activeSessions.find(
    (session) => session._id === selectedSessionId,
  );
  const stickyBottom = Math.max(tabBarHeight, 76);
  const stickyPaddingBottom = Math.max(insets.bottom, SPACING.sm);
  const shutterBottom = Math.max(insets.bottom + 18, 26);
  const stickyContentPadding = stickyBottom + stickyPaddingBottom + 132;
  const shutterContentPadding = shutterBottom + 132;

  if (permission?.granted === false) {
    return (
      <SafeAreaView style={styles.safe}>
        <StaffHeader
          eyebrow="Verification"
          title="Parking QR"
          onBack={() => navigation.goBack()}
          right={<StatusBadge label="Blocked" tone="danger" />}
        />
        <View style={styles.center}>
          <Ionicons name="camera-outline" size={42} color={COLORS.error} />
          <Text style={styles.title}>Camera permission required</Text>
          <Text style={styles.helper}>Camera access is required for QR scanning and vehicle evidence.</Text>
          <ActionButton label="Open settings" onPress={() => Linking.openSettings()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <StaffHeader
        eyebrow="Verification"
        title="Parking QR"
        onBack={() => navigation.goBack()}
        right={<StatusBadge label={phase === 'scan' ? 'Scan' : phase} tone={phase === 'success' ? 'success' : phase === 'confirm' ? 'warning' : 'info'} />}
      />

      {phase === 'scan' ? (
        <>
          <View style={[styles.scanContent, { paddingBottom: shutterContentPadding }]}>
            <View style={styles.cameraFrame}>
              {permission?.granted ? (
                <CameraView
                  ref={cameraRef}
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  facing="back"
                  onBarcodeScanned={busy || qrCapturing ? undefined : handleQrScanned}
                  style={StyleSheet.absoluteFill}
                />
              ) : (
                <ActivityIndicator color={COLORS.staffBlue} size="large" />
              )}
              <View pointerEvents="none" style={styles.viewfinder} />
            </View>
            <Text style={styles.scanHint}>Align QR inside frame</Text>
            {busy ? <ActivityIndicator color={COLORS.staffBlue} /> : null}
            {error ? <ErrorMessage message={error} /> : null}
          </View>
          <ShutterActionBar bottom={shutterBottom}>
            <CameraShutterControl
              disabled={busy || qrCapturing || !permission?.granted}
              label={busy || qrCapturing ? 'Capturing' : 'Capture'}
              onPress={() => void captureQrFrame()}
            />
          </ShutterActionBar>
        </>
      ) : null}

      {phase === 'detail' && booking ? (
        <ScrollView contentContainerStyle={styles.content}>
          <StatusStrip icon="shield-checkmark-outline" label="Step 2" value="Verify booking" tone="success" />
          <View style={styles.bookingCard}>
            <View style={styles.statusRow}>
              <Text style={styles.plate}>{booking.licensePlate}</Text>
              <View style={styles.statusPill}>
                <Text style={styles.statusText}>{booking.status}</Text>
              </View>
            </View>
            <DetailRow label="Booking" value={booking._id} />
            <DetailRow
              label="Customer"
              value={booking.userId?.fullName || booking.userId?.email || 'Customer'}
            />
            <DetailRow
              label="Parking space"
              value={`${typeof booking.floorId === 'object' ? booking.floorId.name || 'Floor' : 'Floor'} / ${booking.parkingSlot}`}
            />
            <DetailRow
              label="Schedule"
              value={`${new Date(booking.scheduledStart).toLocaleString()} - ${new Date(booking.scheduledEnd).toLocaleString()}`}
            />
          </View>
          {bookingResolution?.allowedActions.map((action) => (
            <ActionButton
              key={action}
              label={actionLabel(action)}
              onPress={() => startEvidenceCapture(action)}
            />
          ))}
          {bookingResolution?.allowedActions.length === 0 ? (
            <ErrorMessage message="No manual action is allowed for this booking status." />
          ) : null}
          <ActionButton label="Scan another QR" secondary onPress={reset} />
        </ScrollView>
      ) : null}

      {phase === 'detail' && passResolution ? (
        <ScrollView contentContainerStyle={styles.content}>
          <StatusStrip icon="ticket-outline" label="Parking ticket" value="Verify vehicle" tone="success" />
          <View style={styles.bookingCard}>
            <Text style={styles.plate}>{passResolution.licensePlate}</Text>
            <DetailRow label="Ticket status" value={passResolution.booking?.status || passResolution.session?.status || 'Unavailable'} />
            <DetailRow label="Parking space" value={passResolution.session?.parkingSlot || passResolution.booking?.parkingSlot || 'Not assigned'} />
            {passResolution.session ? <DetailRow label="Check-in" value={new Date(passResolution.session.checkInTime).toLocaleString()} /> : null}
            {quote ? <><DetailRow label="Amount due" value={`${quote.amountToPay.toLocaleString('vi-VN')} VND`} /><DetailRow label="Refund" value={`${(quote.refundAmount || 0).toLocaleString('vi-VN')} VND`} /></> : null}
          </View>
          {quote ? <>
            <Text style={styles.sectionLabel}>Checkout payment</Text>
            {['cash', 'vietqr', ...(passResolution.session?.userId && passResolution.session.type !== 'WALK_IN' ? ['wallet'] : [])].map(method => <SelectionCard key={method} selected={paymentMethod === method} title={method === 'cash' ? 'Cash received by staff' : method === 'vietqr' ? 'Bank QR ? wait for verified payment' : 'Customer wallet'} onPress={() => setPaymentMethod(method)} />)}
            {quote.isEarlyExit ? <SelectionCard selected={keepPaused} title={keepPaused ? 'Pause booking ? customer will return' : 'End booking and release space'} subtitle="Tap to change the departure choice" onPress={() => setKeepPaused(value => !value)} /> : null}
          </> : null}
          {passResolution.allowedActions.map(action => <ActionButton key={action} label={actionLabel(action)} onPress={() => startEvidenceCapture(action)} />)}
          {!passResolution.allowedActions.length ? <ErrorMessage message="This ticket has no available parking action." /> : null}
          {error ? <ErrorMessage message={error} /> : null}
          <ActionButton label="Scan another QR" secondary onPress={reset} />
        </ScrollView>
      ) : null}

      {phase === 'detail' && membershipResolution ? (
        <ScrollView contentContainerStyle={styles.content}>
          <StatusStrip icon="diamond-outline" label="Step 2" value="Select vehicle or session" tone="success" />
          <View style={styles.bookingCard}>
            <View style={styles.statusRow}>
              <Text style={styles.membershipTitle}>
                {membershipResolution.membership.ticketPackage?.name || 'Membership'}
              </Text>
              <View style={styles.statusPill}>
                <Text style={styles.statusText}>{membershipResolution.membership.status}</Text>
              </View>
            </View>
            <DetailRow
              label="Customer"
              value={
                membershipResolution.membership.user?.username ||
                membershipResolution.membership.user?.email ||
                'Customer'
              }
            />
            <DetailRow
              label="Valid until"
              value={new Date(membershipResolution.membership.expireAt).toLocaleString()}
            />
          </View>

          {membershipResolution.allowedActions.includes('CHECK_IN') ? (
            <>
              <Text style={styles.sectionLabel}>Vehicle for check-in</Text>
              {membershipResolution.vehicles.map((vehicle) => (
                <SelectionCard
                  key={vehicle._id}
                  selected={selectedVehicleId === vehicle._id}
                  title={vehicle.licensePlate}
                  subtitle={[vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(' / ')}
                  onPress={() => setSelectedVehicleId(vehicle._id)}
                />
              ))}
              <Text style={styles.sectionLabel}>Reserved parking space</Text>
              {membershipResolution.membership.slots?.map((slot) => {
                const floor = typeof slot.floorId === 'object' ? slot.floorId : null;
                const floorId = floor?._id || (typeof slot.floorId === 'string' ? slot.floorId : '');
                const key = `${floorId}:${slot.slotCode}`;
                return (
                  <SelectionCard
                    key={key}
                    selected={selectedSlotKey === key}
                    title={slot.slotCode}
                    subtitle={floor?.name || `Floor ${floor?.floorNumber || ''}`.trim()}
                    onPress={() => setSelectedSlotKey(key)}
                  />
                );
              })}
              <ActionButton
                label={actionLabel('CHECK_IN')}
                onPress={() => startEvidenceCapture('CHECK_IN')}
              />
            </>
          ) : null}

          {membershipResolution.allowedActions.includes('CHECK_OUT') ? (
            <>
              <Text style={styles.sectionLabel}>Active session for check-out</Text>
              {membershipResolution.activeSessions.map((session) => (
                <SelectionCard
                  key={session._id}
                  selected={selectedSessionId === session._id}
                  title={session.licensePlate}
                  subtitle={`${session.parkingSlot || 'No space'} / ${new Date(session.checkInTime).toLocaleString()}`}
                  onPress={() => setSelectedSessionId(session._id)}
                />
              ))}
              <ActionButton
                label={actionLabel('CHECK_OUT')}
                onPress={() => startEvidenceCapture('CHECK_OUT')}
              />
            </>
          ) : null}

          {membershipResolution.allowedActions.length === 0 ? (
            <ErrorMessage message="No manual action is available for this membership." />
          ) : null}
          {error ? <ErrorMessage message={error} /> : null}
          <ActionButton label="Scan another QR" secondary onPress={reset} />
        </ScrollView>
      ) : null}

      {phase === 'capture' ? (
        <>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: shutterContentPadding }]}>
            <StatusStrip icon="camera-outline" label="Step 3" value="Vehicle evidence" tone="warning" />
            <View style={styles.evidenceCamera}>
              {permission?.granted ? (
                <CameraView ref={cameraRef} facing="back" style={StyleSheet.absoluteFill} />
              ) : (
                <ActivityIndicator color={COLORS.staffBlue} size="large" />
              )}
              <View pointerEvents="none" style={styles.plateGuide} />
            </View>
            <Text style={styles.scanHint}>Keep plate readable</Text>
            {error ? <ErrorMessage message={error} /> : null}
          </ScrollView>
          <ShutterActionBar bottom={shutterBottom}>
            <CameraShutterControl
              disabled={busy}
              label={busy ? 'Capturing' : 'Capture'}
              onPress={() => void captureEvidence()}
            />
          </ShutterActionBar>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.78}
            onPress={() => setPhase('detail')}
            style={[styles.floatingBackAction, { bottom: shutterBottom + 108 }]}
          >
            <Text style={styles.shutterTextActionLabel}>Back to details</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {phase === 'confirm' && (booking || membershipResolution || passResolution) && selectedAction ? (
        <>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: stickyContentPadding }]}>
            <StatusStrip icon="checkmark-done-outline" label="Final step" value="Confirm transition" tone="warning" />
            <Image source={{ uri: evidenceUri }} style={styles.preview} />
            <Text style={styles.title}>Confirm {actionLabel(selectedAction).toLowerCase()}</Text>
            <Text style={styles.helper}>
              {passResolution ? `${passResolution.licensePlate} / ${passResolution.session?.parkingSlot || passResolution.booking?.parkingSlot || ''}` : booking
                ? `${booking.licensePlate} / ${booking.parkingSlot}`
                : selectedAction === 'CHECK_IN'
                  ? `${selectedVehicle?.licensePlate || 'Vehicle'} / ${selectedSlotKey.split(':')[1] || 'Parking space'}`
                  : `${selectedSession?.licensePlate || 'Vehicle'} / ${selectedSession?.parkingSlot || 'Parking space'}`}
            </Text>
            <Text style={styles.inputLabel}>Staff action reason</Text>
            <TextInput
              maxLength={500}
              multiline
              placeholder="Why is staff performing this action?"
              placeholderTextColor={COLORS.textMuted}
              style={styles.input}
              value={reason}
              onChangeText={setReason}
            />
            {passResolution && selectedAction === 'CHECK_OUT' ? <Text style={styles.helper}>{quote?.amountToPay.toLocaleString('vi-VN')} VND ? {paymentMethod === 'cash' ? 'Confirm only after receiving cash.' : paymentMethod === 'wallet' ? 'Backend will verify wallet payment.' : 'Checkout completes after bank payment is verified.'}</Text> : null}
            {payment?.qrCode ? <View style={styles.center}><QRCode value={payment.qrCode} size={200} /><Text style={styles.helper}>Ask the customer to pay. Then verify payment below.</Text></View> : null}
            {error ? <ErrorMessage message={error} /> : null}
          </ScrollView>
          <StickyActionBar bottom={stickyBottom} paddingBottom={stickyPaddingBottom}>
            <ActionButton
              disabled={busy || !reason.trim()}
              label={busy ? 'Submitting...' : payment ? 'Verify bank payment and checkout' : `Confirm ${actionLabel(selectedAction)}`}
              onPress={() => void (async () => {
                if (payment?.orderCode && payment.checkoutAttemptId) {
                  try { const result = await staffService.checkParkingPayment(payment.orderCode, payment.checkoutAttemptId); if (!result.isPaid) { setError('Payment has not been confirmed yet.'); return; } }
                  catch (err) { setError(err instanceof Error ? err.message : 'Unable to verify payment.'); return; }
                }
                await submitTransition();
              })()}
            />
            <ActionButton label="Retake photo" secondary onPress={() => setPhase('capture')} />
          </StickyActionBar>
        </>
      ) : null}

      {phase === 'success' ? (
        <View style={styles.center}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={42} color={COLORS.textInverse} />
          </View>
          <Text style={styles.title}>Parking access updated</Text>
          <Text style={styles.helper}>Evidence saved to the parking session.</Text>
          <ActionButton label="Scan another QR" onPress={reset} />
          <ActionButton label="Back to bookings" secondary onPress={() => navigation.navigate('Bookings')} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <View style={styles.errorBox}>
      <Ionicons name="alert-circle-outline" size={18} color={COLORS.error} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

function SelectionCard({
  onPress,
  selected,
  subtitle,
  title,
}: {
  onPress: () => void;
  selected: boolean;
  subtitle?: string;
  title: string;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.84}
      onPress={onPress}
      style={[styles.selectionCard, selected && styles.selectionCardSelected]}
    >
      <View style={styles.selectionText}>
        <Text style={styles.selectionTitle}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={styles.selectionSubtitle}>{subtitle}</Text> : null}
      </View>
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={23}
        color={selected ? COLORS.staffBlue : COLORS.textMuted}
      />
    </TouchableOpacity>
  );
}

function StickyActionBar({
  bottom,
  children,
  paddingBottom,
}: {
  bottom: number;
  children: React.ReactNode;
  paddingBottom: number;
}) {
  return (
    <View style={[styles.stickyActionBar, { bottom, paddingBottom }]}>
      {children}
    </View>
  );
}

function ShutterActionBar({
  bottom,
  children,
}: {
  bottom: number;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.shutterActionBar, { bottom }]}>
      {children}
    </View>
  );
}

function CameraShutterControl({
  disabled = false,
  label,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  const press = useRef(new Animated.Value(0)).current;
  const ripple = useRef(new Animated.Value(0)).current;
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] });
  const rippleScale = ripple.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1.28] });
  const rippleOpacity = ripple.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  const pressIn = () => {
    Animated.spring(press, {
      damping: 18,
      mass: 0.6,
      stiffness: 360,
      toValue: 1,
      useNativeDriver: true,
    }).start();
    ripple.setValue(0);
    Animated.timing(ripple, {
      duration: 220,
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  const pressOut = () => {
    Animated.spring(press, {
      damping: 16,
      mass: 0.55,
      stiffness: 320,
      toValue: 0,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={styles.shutterWrap}>
      <Animated.View style={[styles.shutterAnimated, { opacity: disabled ? 0.5 : 1, transform: [{ scale }] }]}>
        <TouchableOpacity
          accessibilityLabel="Capture QR"
          accessibilityRole="button"
          activeOpacity={0.92}
          disabled={disabled}
          onPress={onPress}
          onPressIn={pressIn}
          onPressOut={pressOut}
          style={styles.shutterButton}
        >
          <Animated.View
            pointerEvents="none"
            style={[styles.shutterRipple, { opacity: rippleOpacity, transform: [{ scale: rippleScale }] }]}
          />
          <View style={styles.shutterInner}>
            <Ionicons name="camera-outline" size={26} color={COLORS.staffBlue} />
          </View>
        </TouchableOpacity>
      </Animated.View>
      <Text style={styles.shutterLabel}>{label}</Text>
    </View>
  );
}

function ActionButton({
  disabled = false,
  label,
  onPress,
  secondary = false,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.84}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, secondary && styles.buttonSecondary, disabled && styles.buttonDisabled]}
    >
      <Text numberOfLines={1} style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: COLORS.background, flex: 1 },
  content: { gap: SPACING.sm, padding: SPACING.md, paddingBottom: SPACING.xxl },
  scanContent: { gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingTop: SPACING.sm },
  center: {
    alignItems: 'center',
    flex: 1,
    gap: SPACING.md,
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  cameraFrame: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    height: 300,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  evidenceCamera: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    height: 340,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  viewfinder: {
    borderColor: COLORS.staffBlue,
    borderRadius: RADIUS.lg,
    borderWidth: 3,
    height: 220,
    width: 220,
  },
  plateGuide: {
    borderColor: COLORS.gold,
    borderRadius: RADIUS.md,
    borderWidth: 3,
    height: 112,
    width: '82%',
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.xl,
    fontWeight: '800',
    textAlign: 'center',
  },
  scanHint: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '800',
    lineHeight: 20,
    textAlign: 'center',
  },
  helper: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
  bookingCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  plate: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.xxl,
    fontWeight: '900',
    letterSpacing: 2,
  },
  membershipTitle: {
    color: COLORS.textPrimary,
    flex: 1,
    fontSize: FONT_SIZES.xl,
    fontWeight: '900',
  },
  sectionLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '800',
    marginTop: SPACING.xs,
  },
  selectionCard: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.md,
    minHeight: 58,
    padding: SPACING.md,
  },
  selectionCardSelected: {
    backgroundColor: 'rgba(96,180,255,0.1)',
    borderColor: COLORS.staffBlue,
  },
  selectionText: { flex: 1, gap: SPACING.xs },
  selectionTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.md,
    fontWeight: '800',
  },
  selectionSubtitle: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
  statusPill: {
    backgroundColor: 'rgba(96,180,255,0.14)',
    borderColor: 'rgba(96,180,255,0.5)',
    borderRadius: RADIUS.round,
    borderWidth: 1,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  statusText: { color: COLORS.staffBlue, fontSize: FONT_SIZES.xs, fontWeight: '800' },
  detailRow: {
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
  },
  detailLabel: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
  detailValue: { color: COLORS.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  preview: {
    aspectRatio: 4 / 3,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    width: '100%',
  },
  inputLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, fontWeight: '700' },
  input: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    color: COLORS.textPrimary,
    minHeight: 92,
    padding: SPACING.md,
    textAlignVertical: 'top',
  },
  errorBox: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,77,77,0.1)',
    borderColor: 'rgba(255,77,77,0.3)',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  errorText: { color: COLORS.error, flex: 1, fontSize: FONT_SIZES.sm },
  stickyActionBar: {
    backgroundColor: 'rgba(11,12,14,0.97)',
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    gap: SPACING.sm,
    left: 0,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    position: 'absolute',
    right: 0,
  },
  shutterActionBar: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
    elevation: 24,
    justifyContent: 'center',
    left: 0,
    overflow: 'visible',
    position: 'absolute',
    right: 0,
    width: '100%',
    zIndex: 24,
  },
  shutterWrap: {
    alignItems: 'center',
    alignSelf: 'center',
    gap: SPACING.xs,
    justifyContent: 'center',
    width: 124,
  },
  shutterLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.xs,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  shutterAnimated: {
    borderRadius: RADIUS.round,
    elevation: 14,
    shadowColor: COLORS.staffBlue,
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.36,
    shadowRadius: 18,
  },
  shutterButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(244,248,255,0.96)',
    borderColor: 'rgba(226,241,255,0.98)',
    borderRadius: 38,
    borderWidth: 4,
    height: 76,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 76,
  },
  shutterInner: {
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderColor: 'rgba(96,180,255,0.36)',
    borderRadius: 27,
    borderWidth: 1,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  shutterRipple: {
    backgroundColor: 'rgba(96,180,255,0.22)',
    borderRadius: RADIUS.round,
    height: 96,
    position: 'absolute',
    width: 96,
  },
  shutterTextAction: {
    alignItems: 'center',
    minHeight: 32,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  floatingBackAction: {
    alignItems: 'center',
    alignSelf: 'center',
    left: 0,
    minHeight: 32,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    position: 'absolute',
    right: 0,
    zIndex: 23,
  },
  shutterTextActionLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.xs,
    fontWeight: '800',
  },
  button: {
    alignItems: 'center',
    backgroundColor: COLORS.staffBlue,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: SPACING.md,
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderColor: COLORS.borderLight,
    borderWidth: 1,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '800' },
  buttonTextSecondary: { color: COLORS.textSecondary },
  successIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.success,
    borderRadius: RADIUS.round,
    height: 80,
    justifyContent: 'center',
    width: 80,
  },
});
