import { PackageText as Text } from '@/components/profile/PackageText';
import { PackageParkingBreakdown } from './PackageParkingBreakdown';
import QRCode from 'react-native-qrcode-svg';
import type { CheckoutBankPayment } from '@/services/api/sessions';
import { useLanguage } from '@/contexts/LanguageContext';
import { useEffect, useState } from 'react';
import { Image, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { WorkflowButton, WorkflowChip, workflowStyles as s } from '@/components/common/WorkflowUI';
import { COLORS } from '@/constants/theme';
import { sessionsService } from '@/services/api/sessions';
import type { StaffSession, PackageParkingQuote } from '@/services/api/staff';
import parkingFloorService from '@/services/ParkingFloorService';
import type { ParkingFloor, Slot } from '@/types/booking.types';
import { formatCurrency } from '@/utils/formatters';

export function SessionActionsPanel({
  session,
  onUpdated,
}: {
  session: StaffSession;
  onUpdated: (session: StaffSession) => void;
}) {
  const { t: translateUi } = useLanguage();
  const [mode, setMode] = useState<'none' | 'move' | 'checkout'>('none');
  const [floors, setFloors] = useState<ParkingFloor[]>([]);
  const [floorId, setFloorId] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotCode, setSlotCode] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [quote, setQuote] = useState<{
    totalPrice: number;
    amountToPay: number;
    refundAmount: number;
    pricingBreakdown?: PackageParkingQuote;
  } | null>(null);
  const [method, setMethod] = useState<'CASH' | 'WALLET' | 'BANK'>('CASH');
  const [bankPayment, setBankPayment] = useState<CheckoutBankPayment | null>(null);
  useEffect(() => {
    if (mode !== 'move') return;
    void parkingFloorService
      .getParkingFloors()
      .then(setFloors)
      .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load floors.'));
  }, [mode]);
  useEffect(() => {
    setSlots([]);
    setSlotCode('');
    if (!floorId) return;
    let active = true;
    void parkingFloorService
      .getSlotsByFloor(floorId)
      .then((data) => {
        if (active) setSlots(data);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Unable to load parking spaces.');
      });
    return () => {
      active = false;
    };
  }, [floorId]);
  const move = async () => {
    if (!slotCode || !reason.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const fresh = await parkingFloorService.getSlotsByFloor(floorId);
      const slot = fresh.find((item) => item.slotNumber === slotCode);
      if (!slot || slot.status !== 'available' || slot.reservedFor)
        throw new Error('This space is no longer available. Please choose another.');
      const response = await sessionsService.reassignSlot(session._id, {
        floorId,
        newSlotCode: slotCode,
        reason: reason.trim(),
      });
      if (!response.data) throw new Error('No confirmation received for the space change.');
      onUpdated(response.data);
      setMode('none');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to reassign the space.');
    } finally {
      setBusy(false);
    }
  };
  const capture = async () => {
    setBusy(true);
    setError('');
    setQuote(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error('Allow camera access to capture the exiting vehicle.');
      const image = await ImagePicker.launchCameraAsync({ quality: 0.7, mediaTypes: ['images'] });
      if (image.canceled) return;
      const processed = await ImageManipulator.manipulateAsync(
        image.assets[0].uri,
        [{ resize: { width: 1280 } }],
        { base64: true, compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      );
      if (!processed.base64) throw new Error('Unable to process the photo.');
      setPhoto({ uri: processed.uri, base64: `data:image/jpeg;base64,${processed.base64}` });
      const response = await sessionsService.getExitQuote(session.licensePlate);
      if (!response.data || response.data.session._id !== session._id)
        throw new Error('The parking session has changed. Please refresh the list.');
      setQuote(response.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load the invoice.');
    } finally {
      setBusy(false);
    }
  };
  const checkout = async (refreshQr = false) => {
    if (!photo || !quote || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await sessionsService.checkout(session._id, photo.base64, refreshQr ? 'BANK' : bankPayment ? 'QR' : method, quote.amountToPay, bankPayment?.checkoutAttemptId);
      if (response.requiresPayment) {
        setBankPayment(response.data);
        setQuote({ ...quote, amountToPay: response.data.amountDue, pricingBreakdown: response.data.pricingBreakdown || quote.pricingBreakdown });
        return;
      }
      if (!response.data) throw new Error('No checkout confirmation received.');
      onUpdated(response.data);
      setMode('none');
      setBankPayment(null);
      setPhoto(null);
      setQuote(null);
    } catch (e) {
      const refreshed = (e as { data?: { data?: { amountToPay: number; pricingBreakdown?: PackageParkingQuote } } }).data?.data;
      if (refreshed && typeof refreshed.amountToPay === 'number') setQuote({ ...quote, ...refreshed });
      setError(e instanceof Error ? e.message : 'Unable to end the session.');
    } finally {
      setBusy(false);
    }
  };
  if (session.status !== 'active') return null;
  return (
    <View style={s.panel}>
      <Text style={s.title}>{translateUi("Parking session actions")}</Text>
      <View style={s.row}>
        <WorkflowChip
          selected={mode === 'move'}
          onPress={() => {
            if (!busy) {
              setMode('move');
              setError('');
            }
          }}
        >
          {" "}{translateUi("Reassign space")}{" "}</WorkflowChip>
        <WorkflowChip
          selected={mode === 'checkout'}
          onPress={() => {
            if (!busy) {
              setMode('checkout');
              setError('');
            }
          }}
        >
          {" "}{translateUi("Vehicle checkout")}{" "}</WorkflowChip>
      </View>
      {mode === 'move' ? (
        <>
          <Text style={s.body}>{translateUi("Select a floor and available space, then enter a reason.")}</Text>
          <View style={s.row}>
            {floors.map((floor) => (
              <WorkflowChip
                key={floor._id}
                selected={floorId === floor._id}
                onPress={() => !busy && setFloorId(floor._id)}
              >
                {floor.name}
              </WorkflowChip>
            ))}
          </View>
          <View style={s.row}>
            {slots
              .filter((slot) => slot.status === 'available' && !slot.reservedFor)
              .map((slot) => (
                <WorkflowChip
                  key={slot._id || slot.id}
                  selected={slotCode === (slot.slotNumber || slot.slotCode)}
                  onPress={() => !busy && setSlotCode(slot.slotNumber || slot.slotCode)}
                >
                  {slot.slotNumber || slot.slotCode}
                </WorkflowChip>
              ))}
          </View>
          {floorId && !slots.some((slot) => slot.status === 'available' && !slot.reservedFor) ? (
            <Text style={s.body}>{translateUi("No suitable spaces are available on this floor.")}</Text>
          ) : null}
          <TextInput
            accessibilityLabel={translateUi("Reason for reassignment")}
            editable={!busy}
            placeholder={translateUi("Reason for reassignment")}
            placeholderTextColor={COLORS.textMuted}
            style={s.input}
            value={reason}
            onChangeText={setReason}
          />
          <WorkflowButton
            title={busy ? 'Updating…' : translateUi("Confirm reassignment")}
            disabled={busy || !floorId || !slotCode || !reason.trim()}
            onPress={() => void move()}
          />
        </>
      ) : null}
      {mode === 'checkout' ? (
        <>
          <Text style={s.body}>
            {" "}{translateUi("Capture the exiting vehicle, review the invoice and confirm payment. Successful checkout authorizes exit; use gate controls to release the vehicle.")}{" "}</Text>
          <WorkflowButton
            title={
              busy ? 'Processing…' : photo ? 'Retake photo & refresh invoice' : 'Capture exit photo'
            }
            disabled={busy || Boolean(bankPayment)}
            onPress={() => void capture()}
          />
          {photo ? (
            <Image
              source={{ uri: photo.uri }}
              style={{ width: '100%', height: 160, borderRadius: 12 }}
            />
          ) : null}
          {quote ? (
            <>
              <PackageParkingBreakdown pricing={quote.pricingBreakdown} paymentStatus={bankPayment ? 'pending' : 'unpaid'} />
              <Text style={s.body}>{translateUi("Total fee:")}{" "}{formatCurrency(quote.totalPrice)}</Text>
              <Text style={[s.title, { color: COLORS.gold, fontVariant: ['tabular-nums'] }]}>{translateUi("Amount due:")}{" "}{formatCurrency(quote.amountToPay)}</Text>
              <Text style={s.body}>{translateUi("Estimated refund:")}{" "}{formatCurrency(quote.refundAmount)}</Text>
              {!bankPayment && <View style={s.row}>
                <WorkflowChip
                  selected={method === 'CASH'}
                  onPress={() => !busy && setMethod('CASH')}
                >
                  {" "}{translateUi("Cash received")}{" "}</WorkflowChip>
                <WorkflowChip
                  selected={method === 'WALLET'}
                  onPress={() => !busy && setMethod('WALLET')}
                >
                  {" "}{translateUi("Customer wallet")}{" "}</WorkflowChip>
                <WorkflowChip selected={method === 'BANK'} onPress={() => !busy && setMethod('BANK')}>Bank QR</WorkflowChip>
              </View>}
              {bankPayment && <View style={{ alignItems: 'center', gap: 12, backgroundColor: '#fff', padding: 16, borderRadius: 12 }}><QRCode value={bankPayment.qrCode || bankPayment.checkoutUrl} size={180} /><Text style={{ color: '#0f172a' }}>Complete bank payment before verifying checkout.</Text></View>}
              {bankPayment && <WorkflowButton title="Refresh expired QR" disabled={busy} onPress={() => void checkout(true)} />}
              <WorkflowButton
                title={bankPayment ? 'Verify payment & complete checkout' : translateUi("Confirm checkout & payment")}
                disabled={busy}
                onPress={() => void checkout()}
              />
            </>
          ) : null}
        </>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {translateUi(error)}
        </Text>
      ) : null}
    </View>
  );
}
