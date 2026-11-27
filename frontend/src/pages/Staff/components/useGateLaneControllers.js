import { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { API_BASE } from '../../../services/api';
import { getFloorSlots } from '../../../services/parkingFloorService';
import {
  createBookingHold,
  getActiveHolds,
  getActiveMapBookings,
  releaseBookingHold,
} from '../../../services/bookingService';
import { normalizeLicensePlate, formatLicensePlateDisplay } from '../../../utils/licensePlate';
import { cropImageDataUrlForLane, rotateImageBase64 } from '../../../utils/cameraLaneCapture';
import { normalizeSlotCodeLocal, formatGateCurrency } from './gateControlUtils';

/**
 * Reusable controller hook for an Entry-role lane (used by ENTRY_1 normally, and by EXIT_1 when PEAK_ENTRY is active).
 */
export function useEntryLaneController({
  gate = 'ENTRY_1',
  cameraLane = 'entry',
  snapshot,
  setSnapshot,
  floors,
  activeSessionsList,
  captureFrame,
  cameraConfigRef,
  triggerBarrier,
  refreshFloorsAndSessions,
  emitKioskEntrySync,
}) {
  const [plate, setPlate] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType] = useState('car');
  const [floorId, setFloorId] = useState('');
  const [slotCode, setSlotCode] = useState('');
  const [floorSlotsData, setFloorSlotsData] = useState([]);
  const [activeHoldsList, setActiveHoldsList] = useState([]);
  const [activeMapBookings, setActiveMapBookings] = useState([]);
  const [isLoadingFloorSlots, setIsLoadingFloorSlots] = useState(false);
  const [slotPickerOpen, setSlotPickerOpen] = useState(false);
  const [slotFilterMode, setSlotFilterMode] = useState('available');
  const [verifyData, setVerifyData] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [dismissSameOwnerBooking, setDismissSameOwnerBooking] = useState(false);

  const scanLockRef = useRef(false);
  const snapshotRef = useRef(snapshot);
  const phoneRef = useRef(phone);
  const otherSelectedSlotKeyRef = useRef('');
  const lastVerifiedPlateRef = useRef('');
  const lastScannedPlateRef = useRef('');
  const emptyFramesCountRef = useRef(0);

  const setOtherSelectedSlotKey = useCallback((key) => {
    otherSelectedSlotKeyRef.current = key || '';
  }, []);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    phoneRef.current = phone;
  }, [phone]);

  const reset = useCallback(() => {
    scanLockRef.current = false;
    setIsScanning(false);
    emptyFramesCountRef.current = 0;
    lastScannedPlateRef.current = '';
    lastVerifiedPlateRef.current = '';
    toast.dismiss(`entry-verify-${gate}`);
    toast.dismiss(`gate-scan-${gate}`);
    toast.dismiss(`remote-detect-${gate}`);
    setPlate('');
    setPhone('');
    setSlotCode('');
    setVerifyData(null);
    setSnapshot(null);
    setSlotPickerOpen(false);
    setDismissSameOwnerBooking(false);
  }, [gate, setSnapshot]);

  const effectiveFloorId = floorId || floors[0]?._id || '';

  const fetchFloorSlotOptions = useCallback(async (targetFloorId) => {
    if (!targetFloorId) {
      setFloorSlotsData([]);
      return;
    }
    setIsLoadingFloorSlots(true);
    try {
      const [slotsRes, holdsRes, bookingsRes] = await Promise.all([
        getFloorSlots(targetFloorId),
        getActiveHolds().catch(() => ({ ok: false })),
        getActiveMapBookings().catch(() => ({ ok: false })),
      ]);
      if (slotsRes?.ok && Array.isArray(slotsRes.data?.data)) {
        setFloorSlotsData(slotsRes.data.data);
      }
      if (holdsRes?.ok && Array.isArray(holdsRes.data?.data)) {
        setActiveHoldsList(holdsRes.data.data);
      }
      if (bookingsRes?.ok && Array.isArray(bookingsRes.data?.data)) {
        setActiveMapBookings(bookingsRes.data.data);
      }
    } catch (e) {
      console.error(`[${gate}] Error fetching floor slots:`, e);
    } finally {
      setIsLoadingFloorSlots(false);
    }
  }, [gate]);

  useEffect(() => {
    if (!effectiveFloorId) return undefined;
    const timer = setTimeout(() => {
      fetchFloorSlotOptions(effectiveFloorId);
    }, 0);
    return () => clearTimeout(timer);
  }, [effectiveFloorId, fetchFloorSlotOptions]);

  const verifyPlate = useCallback(async (plateToCheck, imageOverride = null, isSilent = false, phoneToCheck = null) => {
    const cleanPlate = normalizeLicensePlate(plateToCheck || plate);
    if (!cleanPlate) return;

    try {
      const activePhone = phoneToCheck !== null ? phoneToCheck : phoneRef.current;
      const res = await fetch(`${API_BASE}/sessions/verify-plate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
        },
        body: JSON.stringify({
          licensePlate: cleanPlate,
          phone: activePhone || undefined,
          gate,
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        const v = data.data;
        const isNewPlate = lastVerifiedPlateRef.current !== cleanPlate;
        lastVerifiedPlateRef.current = cleanPlate;
        setVerifyData(v);

        const resolvedPhone = v.phone || v.registeredVehicleInfo?.phone || '';
        const shouldUseAssignedSlot = Boolean(
          !v.isActive && (!v.requiresSlotReallocation || v.slotAutoReallocated)
        );
        const autoSlot = shouldUseAssignedSlot ? (v.assignedSlot || v.suggestedSlot || '') : '';
        const autoFloorId = shouldUseAssignedSlot ? (v.assignedFloorId || v.suggestedFloorId || '') : '';

        if (isNewPlate) {
          if (resolvedPhone) {
            setPhone(resolvedPhone);
          } else if (phoneToCheck === null && !activePhone) {
            setPhone('');
          }
          setSlotCode(autoSlot);
          if (autoFloorId) setFloorId(autoFloorId);
        } else {
          if (resolvedPhone) setPhone(resolvedPhone);
          if (autoSlot) setSlotCode(autoSlot);
          if (autoFloorId) setFloorId(autoFloorId);
        }

        if (!v.isActive) {
          // Đồng bộ sang Tablet Kiosk In cho TẤT CẢ các loại xe (VIP, Đặt trước, và cả Xe vãng lai)
          emitKioskEntrySync?.({
            gate,
            mode: 'verified',
            licensePlate: cleanPlate,
            verifyData: v,
            entryImageBase64: imageOverride || snapshotRef.current || null,
          });
        }

        if (v.isActive) {
          toast.error(`[${gate}] Warning: Vehicle already has an active session in the lot.`, { id: `entry-verify-${gate}` });
        } else if (v.isPausedResume) {
          if (v.slotAutoReallocated) {
            toast.success(`[${gate}] Paused booking resumed! Replacement slot ${v.assignedSlot} auto-assigned.`, { id: `entry-verify-${gate}` });
          } else {
            toast.success(`[${gate}] Paused booking resumed! Slot ${v.assignedSlot} retained.`, { id: `entry-verify-${gate}` });
          }
        } else if (v.isMonthly) {
          toast.success(`[${gate}] VIP Member (${v.membershipType || 'Monthly Pass'}) verified.`, { id: `entry-verify-${gate}` });
        } else if (v.hasPreBooking) {
          toast.success(`[${gate}] Pre-booking found (Slot: ${v.assignedSlot || 'Reallocate'}).`, { id: `entry-verify-${gate}` });
        } else if (v.isVIP) {
          toast.success(`[${gate}] VIP Member verified.`, { id: `entry-verify-${gate}` });
        } else if (!isSilent) {
          toast(`[${gate}] Valid walk-in vehicle. Ready to assign slot.`, { id: `entry-verify-${gate}` });
        }
      }
    } catch (e) {
      console.error(`[${gate}] Verify plate error:`, e);
    }
  }, [plate, gate, emitKioskEntrySync]);

  const scanPlate = useCallback(async (manualImage = null, isAuto = false) => {
    if (scanLockRef.current) return;
    scanLockRef.current = true;
    try {
      const rawImage = manualImage
        ? await cropImageDataUrlForLane(manualImage, cameraLane, cameraConfigRef.current)
        : captureFrame(cameraLane);
      if (manualImage) setSnapshot(rawImage);
      const imageToScan = rawImage;
      if (!imageToScan) {
        if (!isAuto) toast.error('Please enable the camera or upload a photo to scan.');
        return;
      }

      setIsScanning(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);
        const scanRes = await fetch(`${API_BASE}/ai/scan-plate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
          },
          body: JSON.stringify({ image: imageToScan, lane: cameraLane, gate }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const scanData = await scanRes.json();

        let detectedPlate = '';
        const plateVal = scanData.data?.licensePlate || scanData.data?.plate || scanData.plate || scanData.licensePlate;
        if (scanData.success && plateVal) {
          detectedPlate = normalizeLicensePlate(plateVal);
        }

        // Cổng thông thoáng: nếu trước đó có xe nhưng bây giờ khung hình trống/không còn biển số
        if (!detectedPlate) {
          emptyFramesCountRef.current += 1;
          if (emptyFramesCountRef.current >= 2) {
            if (plate || lastScannedPlateRef.current) {
              lastScannedPlateRef.current = '';
              lastVerifiedPlateRef.current = '';
              toast.dismiss(`entry-verify-${gate}`);
              toast.dismiss(`gate-scan-${gate}`);
              toast.dismiss(`remote-detect-${gate}`);
              reset();
            }
          }
          if (!isAuto) {
            toast.error(`[${gate}] Plate unclear. Enter manually or use AI Plate Assistant.`, { id: `gate-scan-${gate}` });
          }
          return;
        }

        emptyFramesCountRef.current = 0;

        // Nếu xe vẫn là xe cũ đang đứng ở cổng và input đã có biển số -> Bỏ qua không spam thông báo
        if (isAuto && plate && normalizeLicensePlate(plate) === detectedPlate && detectedPlate === lastScannedPlateRef.current) {
          return;
        }

        // Xe mới tới hoặc đã thay đổi xe!
        lastScannedPlateRef.current = detectedPlate;
        const formatted = formatLicensePlateDisplay(detectedPlate);
        setPlate(formatted);
        setDismissSameOwnerBooking(false);
        toast.success(`[${gate}] Detected entry plate: ${formatted}`, { id: `gate-scan-${gate}` });

        await verifyPlate(detectedPlate, imageToScan);
      } catch (err) {
        if (!isAuto) {
          console.error(`[${gate}] Entry scan plate error:`, err);
          toast.error('Failed to scan license plate.', { id: `gate-scan-${gate}` });
        }
      } finally {
        setIsScanning(false);
      }
    } finally {
      scanLockRef.current = false;
    }
  }, [cameraLane, cameraConfigRef, captureFrame, setSnapshot, gate, verifyPlate, reset]);

  const checkIn = useCallback(async (overridePlate = null, overrideVerify = null) => {
    const cleanPlate = overridePlate ? normalizeLicensePlate(overridePlate) : normalizeLicensePlate(plate);
    let verify = overrideVerify || verifyData;

    if (!cleanPlate) {
      toast.error('Please enter or scan the entry license plate.');
      return;
    }

    const targetFloorId = effectiveFloorId || verify?.assignedFloorId || '';
    const targetSlotCode = (slotCode || verify?.assignedSlot || '').trim().toUpperCase();

    if (!targetSlotCode) {
      toast.error('Please select an available parking slot before check-in.');
      setSlotPickerOpen(true);
      if (targetFloorId) fetchFloorSlotOptions(targetFloorId);
      return;
    }

    const chosenKey = `${String(targetFloorId || '')}:${normalizeSlotCodeLocal(targetSlotCode)}`;
    if (otherSelectedSlotKeyRef.current && otherSelectedSlotKeyRef.current === chosenKey) {
      toast.error(`Slot ${targetSlotCode} is currently selected on the other entry lane. Please pick another slot.`);
      setSlotPickerOpen(true);
      if (targetFloorId) fetchFloorSlotOptions(targetFloorId);
      return;
    }

    setIsCheckingIn(true);
    let acquiredHoldId = null;

    const acquireSlotHold = async (bookingSource = 'KIOSK_WALK_IN', reallocateBookingId = null) => {
      const now = new Date();
      const end = new Date(now.getTime() + 60 * 60 * 1000);
      const holdRes = await createBookingHold(
        {
          floorId: targetFloorId,
          slotCode: targetSlotCode,
          licensePlate: cleanPlate,
          startTime: now.toISOString(),
          endTime: end.toISOString(),
          bookingSource,
          ...(reallocateBookingId ? { reallocateBookingId } : {}),
        },
        { anonymous: true }
      );
      if (!holdRes?.ok || !holdRes?.data?.data?._id) {
        throw new Error(holdRes?.data?.message || 'Unable to lock this slot temporarily for check-in.');
      }
      return holdRes.data.data._id;
    };

    const entryCameraName = gate === 'EXIT_1' ? 'CAM_GATE_EXIT_01' : 'CAM_GATE_ENTRY_01';

    const callKioskEntry = async (holdId) => {
      const res = await fetch(`${API_BASE}/sessions/kiosk-entry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
          'Idempotency-Key': `staff-entry:${gate}:${cleanPlate}:${Date.now()}`,
        },
        body: JSON.stringify({
          licensePlate: cleanPlate,
          phone: phoneRef.current || verify?.phone || '',
          vehicleType,
          parkingSlot: targetSlotCode,
          floorId: targetFloorId,
          durationHours: 2,
          entryImageBase64: snapshotRef.current || null,
          entryCamera: entryCameraName,
          entryGate: gate,
          ...(holdId ? { bookingHoldId: holdId } : {}),
          ...(verify?.bookingId ? { bookingId: verify.bookingId } : {}),
          ...(verify?.slotAutoReallocated ? { isAutoReallocated: true } : {}),
        }),
      });
      return res.json();
    };

    try {
      if (!verify) {
        try {
          const vRes = await fetch(`${API_BASE}/sessions/verify-plate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
            },
            body: JSON.stringify({ licensePlate: cleanPlate }),
          });
          const vData = await vRes.json();
          if (vData?.success && vData?.data) {
            verify = vData.data;
            setVerifyData(verify);
            if (verify.isActive) {
              toast.error('Warning: Vehicle already has an active session in the lot.');
              return;
            }
          }
        } catch {
          // Proceed with direct check-in flow if pre-verify lookup fails transiently
        }
      }

      const hasDirectAssignedAccess = Boolean(
        (verify?.hasPreBooking && !verify?.requiresSlotReallocation && !verify?.tooEarly) ||
        (verify?.isMonthly && !verify?.quotaExhausted)
      );

      if (!hasDirectAssignedAccess && targetFloorId) {
        const source = verify?.requiresSlotReallocation ? 'KIOSK_REALLOCATION' : 'KIOSK_WALK_IN';
        acquiredHoldId = await acquireSlotHold(
          source,
          verify?.requiresSlotReallocation ? verify?.bookingId : null
        );
      }

      let data = await callKioskEntry(acquiredHoldId);

      if (!data.success && data.code === 'HOLD_REQUIRED' && !acquiredHoldId && targetFloorId) {
        const source = verify?.requiresSlotReallocation ? 'KIOSK_REALLOCATION' : 'KIOSK_WALK_IN';
        acquiredHoldId = await acquireSlotHold(
          source,
          verify?.requiresSlotReallocation ? verify?.bookingId : null
        );
        data = await callKioskEntry(acquiredHoldId);
      }

      if (!data.success && data.code === 'BOOKING_NOT_AVAILABLE' && targetFloorId && targetSlotCode) {
        if (!acquiredHoldId) {
          acquiredHoldId = await acquireSlotHold('KIOSK_WALK_IN', null);
        }
        const retryRes = await fetch(`${API_BASE}/sessions/kiosk-entry`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
            'Idempotency-Key': `staff-entry-walkin:${gate}:${cleanPlate}:${Date.now()}`,
          },
          body: JSON.stringify({
            licensePlate: cleanPlate,
            phone: phoneRef.current || verify?.phone || '',
            vehicleType,
            parkingSlot: targetSlotCode,
            floorId: targetFloorId,
            durationHours: 2,
            entryImageBase64: snapshotRef.current || null,
            entryCamera: entryCameraName,
            entryGate: gate,
            ...(acquiredHoldId ? { bookingHoldId: acquiredHoldId } : {}),
          }),
        });
        data = await retryRes.json();
      }

      if (data.success) {
        toast.success(`[${gate}] Checked in ${cleanPlate} at Slot ${targetSlotCode}. Opening barrier...`);
        if (data.data) {
          emitKioskEntrySync?.({
            gate,
            mode: 'checked_in',
            licensePlate: cleanPlate,
            session: {
              ...data.data,
              pass: data.pass || null,
              vipRedirected: data.vipRedirected,
              originalVipSlot: data.originalVipSlot,
              bookingSlotReallocated: data.bookingSlotReallocated,
              originalBookingSlot: data.originalBookingSlot,
            },
            entryImageBase64: snapshotRef.current || null,
          });
        }
        await triggerBarrier('open', gate, cleanPlate, targetSlotCode);
        setPlate('');
        setPhone('');
        setSlotCode('');
        setVerifyData(null);
        setSnapshot(null);
        setSlotPickerOpen(false);
        refreshFloorsAndSessions();
        if (targetFloorId) fetchFloorSlotOptions(targetFloorId);
      } else {
        if (acquiredHoldId) {
          await releaseBookingHold(acquiredHoldId, {
            licensePlate: cleanPlate,
            floorId: targetFloorId,
            slotCode: targetSlotCode,
          }).catch(() => null);
        }
        toast.error(data.message || 'Check-in failed.');
      }
    } catch (err) {
      if (acquiredHoldId) {
        await releaseBookingHold(acquiredHoldId, {
          licensePlate: cleanPlate,
          floorId: targetFloorId,
          slotCode: targetSlotCode,
        }).catch(() => null);
      }
      console.error(`[${gate}] Check-in error:`, err);
      toast.error(err?.message || 'Server error during check-in.');
    } finally {
      setIsCheckingIn(false);
    }
  }, [
    plate,
    verifyData,
    effectiveFloorId,
    slotCode,
    fetchFloorSlotOptions,
    gate,
    vehicleType,
    emitKioskEntrySync,
    triggerBarrier,
    setSnapshot,
    refreshFloorsAndSessions,
  ]);

  const handlePlateChange = useCallback((nextVal) => {
    const upper = String(nextVal || '').toUpperCase();
    setPlate(upper);
    setDismissSameOwnerBooking(false);
    if (!normalizeLicensePlate(upper)) {
      lastVerifiedPlateRef.current = '';
      setVerifyData(null);
      setPhone('');
      setSlotCode('');
    }
  }, []);

  // Debounced verify on typing
  useEffect(() => {
    const clean = normalizeLicensePlate(plate);
    if (!clean || clean.length < 5) return undefined;
    const timer = setTimeout(() => {
      verifyPlate(clean, null, true);
    }, 400);
    return () => clearTimeout(timer);
  }, [plate, verifyPlate]);

  // Refresh slot options when active sessions list changes while picker is open
  useEffect(() => {
    if (!slotPickerOpen || !effectiveFloorId) return undefined;
    const timer = setTimeout(() => {
      fetchFloorSlotOptions(effectiveFloorId);
    }, 0);
    return () => clearTimeout(timer);
  }, [activeSessionsList.length, slotPickerOpen, effectiveFloorId, fetchFloorSlotOptions]);

  const selectedSlotKey =
    effectiveFloorId && slotCode ? `${String(effectiveFloorId)}:${normalizeSlotCodeLocal(slotCode)}` : '';

  return {
    gate,
    cameraLane,
    plate,
    setPlate: handlePlateChange,
    phone,
    setPhone,
    floorId: effectiveFloorId,
    setFloorId,
    slotCode,
    setSlotCode,
    selectedSlotKey,
    setOtherSelectedSlotKey,
    floorSlotsData,
    activeHoldsList,
    activeMapBookings,
    isLoadingFloorSlots,
    slotPickerOpen,
    setSlotPickerOpen,
    slotFilterMode,
    setSlotFilterMode,
    verifyData,
    setVerifyData,
    isScanning,
    isCheckingIn,
    dismissSameOwnerBooking,
    setDismissSameOwnerBooking,
    scanLockRef,
    fetchFloorSlotOptions,
    verifyPlate,
    scanPlate,
    checkIn,
    reset,
  };
}

/**
 * Reusable controller hook for an Exit-role lane (used by EXIT_1 normally, and by ENTRY_1 when PEAK_EXIT is active).
 */
export function useExitLaneController({
  gate = 'EXIT_1',
  cameraLane = 'exit',
  snapshot,
  setSnapshot,
  captureFrame,
  cameraConfigRef,
  triggerBarrier,
  refreshFloorsAndSessions,
  emitKioskExitSync,
}) {
  const [plate, setPlate] = useState('');
  const [invoiceData, setInvoiceData] = useState(null);
  const [statusInfo, setStatusInfo] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [cashReceivedAmount, setCashReceivedAmount] = useState('');
  const [depositChangeToWallet, setDepositChangeToWallet] = useState(false);

  const scanLockRef = useRef(false);
  const snapshotRef = useRef(snapshot);
  const lastScannedPlateRef = useRef('');
  const emptyFramesCountRef = useRef(0);
  const isAutoSettingPlateRef = useRef(false);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const reset = useCallback(() => {
    scanLockRef.current = false;
    setIsScanning(false);
    emptyFramesCountRef.current = 0;
    lastScannedPlateRef.current = '';
    toast.dismiss(`exit-lookup-${gate}`);
    toast.dismiss(`gate-scan-${gate}`);
    toast.dismiss(`remote-detect-${gate}`);
    setPlate('');
    setInvoiceData(null);
    setStatusInfo(null);
    setSnapshot(null);
    setCashReceivedAmount('');
    setDepositChangeToWallet(false);
  }, [gate, setSnapshot]);

  const lookupSession = useCallback(async (plateToLookup, imageOverride = null, isAuto = false) => {
    const cleanPlate = normalizeLicensePlate(plateToLookup || plate);
    if (!cleanPlate) return;

    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_BASE}/sessions/kiosk-exit-scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': `staff-exit-scan:${gate}:${cleanPlate}`,
        },
        body: JSON.stringify({
          gate,
          licensePlate: cleanPlate,
          exitImageBase64: imageOverride || snapshotRef.current || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const invoice = data.data || data;
        setInvoiceData({
          ...invoice,
          checkoutToken: invoice.checkoutToken || data.checkoutToken || null,
          totalAmount: Number(invoice.amountToPay || 0),
          parkingFee: Number(invoice.totalPrice || 0),
        });
        setStatusInfo({
          found: true,
          licensePlate: cleanPlate,
          sessionType: invoice.session?.type || 'WALK_IN',
          bookingId: invoice.session?.bookingId || null,
          parkingSlot: invoice.session?.parkingSlot || null,
          violationDetails: invoice.violationDetails || null,
          violations: invoice.violations || null,
        });
        setCashReceivedAmount((prev) => (prev && Number(prev) > 0 ? prev : String(Number(invoice.amountToPay || 0))));
        toast.success(`[${gate}] Found active session for ${cleanPlate}.`, { id: `exit-lookup-${gate}`, duration: 3500 });

        // Đồng bộ hóa đơn sang màn hình Kiosk Out trên tablet
        if (typeof emitKioskExitSync === 'function') {
          emitKioskExitSync({
            gate,
            licensePlate: cleanPlate,
            invoiceData: invoice,
            exitImageBase64: imageOverride || snapshotRef.current || null,
          });
        }
      } else {
        setInvoiceData(null);
        const errorText = res.status === 404
          ? `No active parking session found for ${cleanPlate}.`
          : data.code === 'EXIT_PLATE_MISMATCH'
            ? `Exit plate does not match active session for ${cleanPlate}.`
            : (data.message || 'No active parking session found.');
        setStatusInfo({
          found: false,
          licensePlate: cleanPlate,
          code: data.code || (res.status === 404 ? 'NOT_FOUND' : 'ERROR'),
          message: errorText,
          violations: data.violations || null,
        });
        if (!isAuto) {
          toast.error(`[${gate}] ${errorText}`, { id: `exit-lookup-${gate}` });
        }
      }
    } catch (e) {
      console.error(`[${gate}] Lookup exit session error:`, e);
      if (!isAuto) toast.error('Failed to look up parking session.', { id: `exit-lookup-${gate}` });
    }
  }, [plate, gate, emitKioskExitSync]);

  const scanPlate = useCallback(async (manualImage = null, isAuto = false) => {
    if (scanLockRef.current) return;
    scanLockRef.current = true;
    try {
      const rawImage = manualImage
        ? await cropImageDataUrlForLane(manualImage, cameraLane, cameraConfigRef.current)
        : captureFrame(cameraLane);
      if (manualImage) setSnapshot(rawImage);
      const imageToScan = rawImage;
      if (!imageToScan) {
        if (!isAuto) toast.error('Please enable the camera or upload a photo.');
        return;
      }

      setIsScanning(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);
        const scanRes = await fetch(`${API_BASE}/ai/scan-plate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: imageToScan, lane: cameraLane, gate }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const scanData = await scanRes.json();

        let detectedPlate = '';
        const plateVal = scanData.data?.licensePlate || scanData.data?.plate || scanData.plate || scanData.licensePlate;
        if (scanData.success && plateVal) {
          detectedPlate = normalizeLicensePlate(plateVal);
        }

        // Cổng thông thoáng: nếu trước đó có xe nhưng bây giờ khung hình trống/không còn biển số
        if (!detectedPlate) {
          emptyFramesCountRef.current += 1;
          if (emptyFramesCountRef.current >= 2) {
            if (plate || lastScannedPlateRef.current) {
              lastScannedPlateRef.current = '';
              toast.dismiss(`exit-lookup-${gate}`);
              toast.dismiss(`gate-scan-${gate}`);
              toast.dismiss(`remote-detect-${gate}`);
              reset();
            }
          }
          if (!isAuto) {
            toast.error(`[${gate}] Exit plate unclear. Enter manually or use AI Plate Assistant.`, { id: `gate-scan-${gate}` });
          }
          return;
        }

        emptyFramesCountRef.current = 0;

        // Nếu xe vẫn là xe cũ đang đứng ở cổng và input đã có biển số -> Bỏ qua không spam thông báo
        if (isAuto && plate && normalizeLicensePlate(plate) === detectedPlate && detectedPlate === lastScannedPlateRef.current) {
          return;
        }

        // Xe mới tới hoặc đã thay đổi xe!
        lastScannedPlateRef.current = detectedPlate;
        const formatted = formatLicensePlateDisplay(detectedPlate);
        isAutoSettingPlateRef.current = true;
        setPlate(formatted);
        toast.success(`[${gate}] Detected exit plate: ${formatted}`, { id: `gate-scan-${gate}` });

        await lookupSession(detectedPlate, imageToScan, isAuto);
      } catch (err) {
        if (!isAuto) {
          console.error(`[${gate}] Exit scan plate error:`, err);
          toast.error('Failed to scan exit license plate.', { id: `gate-scan-${gate}` });
        }
      } finally {
        setIsScanning(false);
      }
    } finally {
      scanLockRef.current = false;
    }
  }, [cameraLane, cameraConfigRef, captureFrame, setSnapshot, gate, lookupSession, reset]);

  const checkOut = useCallback(async (overrideInvoice = null, keepPausedChoice = false, paymentMethodChoice = null) => {
    const inv = overrideInvoice || invoiceData;
    if (!inv || !inv.session) {
      toast.error('No active parking session selected for check-out.');
      return;
    }

    const dueAmount = Number(inv.totalAmount || 0);
    const effectiveCashAmount = cashReceivedAmount ? Number(cashReceivedAmount) : dueAmount;
    const chosenMethod =
      paymentMethodChoice || (cashReceivedAmount ? 'cash' : dueAmount === 0 ? 'cash' : (inv.canAutoPay ? 'wallet' : 'cash'));
    const isCash = chosenMethod === 'cash';
    const isWallet = chosenMethod === 'wallet';

    if (isCash && dueAmount > 0 && effectiveCashAmount < dueAmount) {
      toast.error(`Please collect at least ${formatGateCurrency(dueAmount)} in cash.`);
      return;
    }

    setIsCheckingOut(true);
    try {
      const token = localStorage.getItem('accessToken');
      const exitCameraName = gate === 'ENTRY_1' ? 'CAM_GATE_ENTRY_01' : 'CAM_GATE_EXIT_01';
      const res = await fetch(`${API_BASE}/sessions/kiosk-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': `staff-checkout:${gate}:${inv.session._id}:${chosenMethod}:${effectiveCashAmount || 'auto'}:${keepPausedChoice ? 'paused' : 'ended'}`,
        },
        body: JSON.stringify({
          sessionId: inv.session._id,
          exitImageBase64: snapshotRef.current || null,
          paymentMethod: chosenMethod,
          cashReceivedAmount: isCash && dueAmount > 0 ? effectiveCashAmount : null,
          depositChangeToWallet: isCash && depositChangeToWallet,
          checkoutToken: inv.checkoutToken || null,
          exitCamera: exitCameraName,
          exitGate: gate,
          keepPaused: keepPausedChoice,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const changeMessage = data.data?.depositChangeToWallet
          ? ` Deposited ${formatGateCurrency(data.data.changeDepositedAmount)} change into customer's Valo Wallet.`
          : data.data?.changeAmount != null
            ? ` Change: ${formatGateCurrency(data.data.changeAmount)}.`
            : '';
        const paymentMethodNote = isWallet ? ' (Paid via Valo Wallet)' : '';
        if (keepPausedChoice) {
          toast.success(`[${gate}] Session PAUSED for ${inv.session.licensePlate}. Slot ${inv.session.parkingSlot} retained!${paymentMethodNote}${changeMessage}`);
        } else {
          toast.success(`[${gate}] Checked out ${inv.session.licensePlate}.${paymentMethodNote}${changeMessage} Opening barrier...`);
        }
        await triggerBarrier('open', gate, inv.session.licensePlate, '', 'CHECKOUT_SUCCESS', 'Checkout completed');

        // Bắn broadcast channel cục bộ để Kiosk Out chuyển màn hình ngay tức thì (0ms latency)
        if (typeof BroadcastChannel !== 'undefined') {
          try {
            const ch = new BroadcastChannel('valo_kiosk_checkout_sync');
            ch.postMessage({
              sessionId: inv.session._id,
              licensePlate: inv.session.licensePlate,
              gate,
              paymentMethod: chosenMethod,
            });
            ch.close();
          } catch (_) { }
        }

        setPlate('');
        setInvoiceData(null);
        setStatusInfo(null);
        setSnapshot(null);
        setCashReceivedAmount('');
        setDepositChangeToWallet(false);
        refreshFloorsAndSessions();
      } else {
        toast.error(data.message || 'Check-out failed.');
      }
    } catch (err) {
      console.error(`[${gate}] Check-out error:`, err);
      toast.error('Server error during check-out.');
    } finally {
      setIsCheckingOut(false);
    }
  }, [invoiceData, cashReceivedAmount, depositChangeToWallet, gate, triggerBarrier, setSnapshot, refreshFloorsAndSessions]);

  const handlePlateChange = useCallback((nextVal) => {
    const upper = String(nextVal || '').toUpperCase();
    setPlate(upper);
    if (!normalizeLicensePlate(upper)) {
      setInvoiceData(null);
      setStatusInfo(null);
    }
  }, []);

  // Debounced lookup on typing
  useEffect(() => {
    if (isAutoSettingPlateRef.current) {
      isAutoSettingPlateRef.current = false;
      return undefined;
    }
    const clean = normalizeLicensePlate(plate);
    if (!clean || clean.length < 5) return undefined;
    const timer = setTimeout(() => {
      lookupSession(clean);
    }, 450);
    return () => clearTimeout(timer);
  }, [plate, lookupSession]);

  return {
    gate,
    cameraLane,
    plate,
    setPlate: handlePlateChange,
    invoiceData,
    statusInfo,
    isScanning,
    isCheckingOut,
    cashReceivedAmount,
    setCashReceivedAmount,
    depositChangeToWallet,
    setDepositChangeToWallet,
    scanLockRef,
    lookupSession,
    scanPlate,
    checkOut,
    reset,
  };
}
