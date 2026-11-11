import { useState, useEffect, useRef } from 'react';
import { Delete, AlertCircle, ScanLine } from 'lucide-react';
import KioskQrScannerModal from './KioskQrScannerModal';
import { API_BASE } from '../../services/api';
import { captureKioskPlate } from '../../services/kioskCamera';
import { isValidLicensePlate } from '../../utils/licensePlate';
import KioskDeviceSetup from './KioskDeviceSetup';
import ParkingFullModal from './ParkingFullModal';
import PlateMismatchModal from './PlateMismatchModal';
import { useQrScannerListener } from '../../hooks/useQrScannerListener';

export default function KioskStep1({ formData, updateFormData, onNext }) {
  const [activeField, setActiveField] = useState('plate'); // Default to plate
  const [isVerifying, setIsVerifying] = useState(false);
  const [showFullModal, setShowFullModal] = useState(false);
  const [showReallocationModal, setShowReallocationModal] = useState(false);
  const [reallocationTitle, setReallocationTitle] = useState('Slot Reallocation');
  const [reallocationMessage, setReallocationMessage] = useState('');
  const [stepAlert, setStepAlert] = useState(null);
  const [verifiedPhone, setVerifiedPhone] = useState('');
  const [modalTitle, setModalTitle] = useState(undefined);
  const [modalMessage, setModalMessage] = useState(undefined);
  const [showQrModal, setShowQrModal] = useState(false);
  const [mismatchData, setMismatchData] = useState(null);
  const [userTypedPlate, setUserTypedPlate] = useState(false);
  const lastCheckedPlateRef = useRef(
    formData.licensePlate ? formData.licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase() : ''
  );
  const pastGuestVerified = Boolean(verifiedPhone && verifiedPhone === (formData.phone || '').trim());

  const handleQrScan = async (qrPayload) => {
    setShowQrModal(false);
    setIsVerifying(true);
    try {
      const response = await fetch(`${API_BASE}/sessions/kiosk-verify-qr`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Kiosk-Gate': 'ENTRY_1' },
        body: JSON.stringify({
          qrPayload,
          entryImageBase64: formData.entryImageBase64 || null,
        }),
      });
      const data = await response.json();

      if (!data.success) {
        setIsVerifying(false);
        setStepAlert({
          title: 'QR Verification Failed',
          message: data.message || 'Mã QR không hợp lệ',
        });
        return;
      }

      // Check anti-fraud plate mismatch
      if (data.isPlateMatched === false) {
        setIsVerifying(false);
        setMismatchData({
          qrPlate: data.licensePlate,
          detectedPlate: data.detectedPlate,
          reason: data.mismatchReason,
          entryImageBase64: formData.entryImageBase64 || null,
        });
        return;
      }

      let capturedPlate = data.licensePlate;
      let capturedImage = formData.entryImageBase64 || null;
      if (!capturedImage) {
        const vehicle = await captureKioskPlate(data.licensePlate);
        capturedPlate = vehicle.licensePlate;
        capturedImage = vehicle.imageBase64;
      }

      lastCheckedPlateRef.current = '';
      setUserTypedPlate(true);
      updateFormData({
        qrPayload,
        licensePlate: capturedPlate,
        entryImageBase64: capturedImage,
        phone: data.phone || formData.phone || '',
      });
      setIsVerifying(false);
      setActiveField('plate');
    } catch (err) {
      console.error(err);
      setIsVerifying(false);
      setStepAlert({
        title: 'Connection Error',
        message: err.message || 'Lỗi kết nối khi xác thực mã QR.',
      });
    }
  };

  useQrScannerListener(handleQrScan, !isVerifying);

  const routeFromVerifyData = (verifyData, { phoneFallback = '', requirePhone = false } = {}) => {
    if (verifyData.isActive) {
      setModalTitle('VEHICLE ALREADY INSIDE');
      setModalMessage('This license plate is currently parked in the lot. Please check again.');
      setShowFullModal(true);
      return true;
    }

    if (verifyData.hasPreBooking || verifyData.isMonthly) {
      const needsReallocation = Boolean(verifyData.requiresSlotReallocation);
      const canFastPass = Boolean(!needsReallocation && verifyData.assignedSlot);
      updateFormData({
        step3Mode: canFastPass ? 'fastpass' : 'policy',
        isMonthly: Boolean(verifyData.isMonthly),
        membershipType: verifyData.membershipType || null,
        hasPreBooking: Boolean(verifyData.hasPreBooking),
        isVipReallocation: Boolean(verifyData.vipSlotOccupiedByOther),
        isBookingReallocation: Boolean(verifyData.isBookingReallocation),
        quotaExhausted: Boolean(verifyData.quotaExhausted),
        originalSlot: verifyData.originalSlot || null,
        selectedSlot: needsReallocation ? null : (verifyData.assignedSlot || null),
        floorId: needsReallocation ? null : (verifyData.assignedFloorId || null),
        bookingId: verifyData.bookingId || null,
        bookingFloorName: verifyData.assignedFloorName || null,
        durationHours: verifyData.bookingDurationHours || formData.durationHours || 1,
        licensePlate: formData.licensePlate,
        phone: verifyData.phone || phoneFallback || formData.phone || '',
        ticketPackageId: verifyData.bookingTicketPackageId || formData.ticketPackageId || null,
        bookingMode: verifyData.bookingMode || formData.bookingMode || 'hourly',
      });

      if (needsReallocation) {
        setReallocationTitle('Slot Reallocation');
        setReallocationMessage(
          verifyData.vipSlotOccupiedByOther
            ? 'Your VIP slot is currently occupied. Please choose an available replacement slot on the map (0 VND/hr).'
            : 'Your reserved booking slot is currently unavailable. Please choose another available slot on the map (No extra charge).'
        );
        setShowReallocationModal(true);
      } else {
        onNext(canFastPass ? '3' : '2');
      }
      return true;
    }

    if (verifyData.isVIP || verifyData.isRegisteredVehicle || verifyData.quotaExhausted) {
      if (formData.isParkingFull || verifyData.isFull) {
        setModalTitle(undefined);
        setModalMessage(undefined);
        setShowFullModal(true);
        updateFormData({ licensePlate: '', phone: '', entryImageBase64: null, isParkingFull: false });
        return true;
      }

      updateFormData({
        step3Mode: 'policy',
        isVIP: Boolean(verifyData.isVIP),
        isRegisteredVehicle: Boolean(verifyData.isRegisteredVehicle),
        quotaExhausted: Boolean(verifyData.quotaExhausted),
        isVipReallocation: false,
        isBookingReallocation: false,
        upcomingBookingTooEarly: verifyData.upcomingBookingTooEarly || null,
        suggestedSlot: verifyData.suggestedSlot || null,
        suggestedFloorId: verifyData.suggestedFloorId || null,
        suggestedFloorName: verifyData.suggestedFloorName || null,
        membershipType: verifyData.membershipType || null,
        phone: verifyData.phone || phoneFallback || formData.phone || '',
        licensePlate: formData.licensePlate,
        pricingPackage: verifyData.pricingPackage || formData.pricingPackage || null,
        pricingSource: verifyData.pricingSource || formData.pricingSource || 'default',
        ticketPackageId: verifyData.pricingPackage?._id || formData.ticketPackageId || null,
        bookingMode: 'hourly',
        selectedSlot: null,
        floorId: null,
        bookingFloorName: null,
      });

      if (verifyData.quotaExhausted) {
        setReallocationTitle('VIP Slot Limit Reached');
        setReallocationMessage('Your VIP quota has been reached (maximum number of slots in use). Please select another slot on the map; standard hourly rates apply.');
        setShowReallocationModal(true);
      } else {
        onNext('2');
      }
      return true;
    }

    if (formData.isParkingFull || verifyData.isFull) {
      setModalTitle(undefined);
      setModalMessage(undefined);
      setShowFullModal(true);
      updateFormData({ licensePlate: '', phone: '', entryImageBase64: null, isParkingFull: false });
      return true;
    }

    const resolvedPhone = verifyData.phone && verifyData.phone.length >= 10
      ? verifyData.phone
      : phoneFallback;
    const hasValidPhone = /^0[35789]\d{8}$/.test(String(resolvedPhone || '').trim());

    updateFormData({
      step3Mode: 'policy',
      isVIP: false,
      isRegisteredVehicle: false,
      isVipReallocation: false,
      isBookingReallocation: false,
      quotaExhausted: false,
      upcomingBookingTooEarly: verifyData.upcomingBookingTooEarly || null,
      membershipType: verifyData.membershipType || null,
      phone: resolvedPhone || '',
      licensePlate: formData.licensePlate,
      pricingPackage: verifyData.pricingPackage || formData.pricingPackage || null,
      pricingSource: verifyData.pricingSource || formData.pricingSource || 'default',
      ticketPackageId: verifyData.pricingPackage?._id || formData.ticketPackageId || null,
      bookingMode: 'hourly',
    });

    if (hasValidPhone) {
      onNext('2');
      return true;
    }

    setActiveField('phone');
    if (requirePhone) {
      setStepAlert({
        title: 'Phone Number Required',
        message: 'Please enter a valid 10-digit Vietnamese phone number to continue.',
      });
    }
    return false;
  };

  // Auto-verify logic
  useEffect(() => {
    const plate = formData.licensePlate || '';
    const cleanPlate = plate.replace(/[^A-Z0-9]/gi, '').toUpperCase();

    // Trigger auto-verify if plate is valid, actively typed by user, and not yet verified
    if (
      activeField === 'plate' &&
      userTypedPlate &&
      isValidLicensePlate(plate) &&
      cleanPlate !== lastCheckedPlateRef.current
    ) {
      const timerId = setTimeout(async () => {
        try {
          lastCheckedPlateRef.current = cleanPlate;
          setUserTypedPlate(false);

          const response = await fetch(`${API_BASE}/sessions/verify-plate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licensePlate: cleanPlate })
          });
          const data = await response.json();
          if (data.success && data.data) {
            routeFromVerifyData(data.data, { phoneFallback: formData.phone || '', requirePhone: false });
          } else if (formData.isParkingFull) {
            setModalTitle(undefined);
            setModalMessage(undefined);
            setShowFullModal(true);
            updateFormData({ licensePlate: '', phone: '', entryImageBase64: null, isParkingFull: false });
          }
        } catch (e) {
          console.error("Auto verify failed", e);
        }
      }, 900); // Ngưng gõ khoảng 0.9s (giữa nửa giây và 1 giây) mới bắt đầu kiểm tra biển số
      return () => clearTimeout(timerId);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.licensePlate, activeField, userTypedPlate]);

  // Verify phone (privacy-preserving check)
  useEffect(() => {
    const phone = formData.phone || '';
    if (activeField === 'phone' && phone.length >= 10) {
      const timerId = setTimeout(async () => {
        try {
          const response = await fetch(`${API_BASE}/sessions/verify-phone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phone.trim() })
          });
          const data = await response.json();
          if (data.success && data.data?.hasPastSession) {
            setVerifiedPhone(phone.trim());
          } else {
            setVerifiedPhone('');
          }
        } catch (e) {
          setVerifiedPhone('');
          console.error("Phone verify failed", e);
        }
      }, 800);
      return () => clearTimeout(timerId);
    }
    return undefined;
  }, [formData.phone, activeField]);

  const formatVietnamesePlate = (plate) => {
    if (!plate) return null;
    const clean = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let province, series, numbers;
    if (clean.length === 9) {
      if (/^\d{2}[A-Z]\d\d{5}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 4); numbers = clean.slice(4); }
      else if (/^\d{2}[A-Z]{2}\d{5}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 4); numbers = clean.slice(4); }
    } else if (clean.length === 8) {
      if (/^\d{2}[A-Z]\d{5}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 3); numbers = clean.slice(3); }
      else if (/^\d{2}[A-Z]\d\d{4}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 4); numbers = clean.slice(4); }
      else if (/^\d{2}[A-Z]{2}\d{4}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 4); numbers = clean.slice(4); }
    } else if (clean.length === 7) {
      if (/^\d{2}[A-Z]\d{4}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 3); numbers = clean.slice(3); }
    }
    if (province && series && numbers) {
      let formattedNumbers = numbers;
      if (numbers.length === 5) { formattedNumbers = `${numbers.slice(0, 3)}.${numbers.slice(3)}`; }
      const isMotorbike = /\d/.test(series);
      if (isMotorbike) return `${province}-${series} ${formattedNumbers}`;
      else return `${province}${series} - ${formattedNumbers}`;
    }
    return null;
  };

  const handleKeyClick = (key) => {
    if (activeField === 'phone') {
      const currentPhone = formData.phone || '';

      // Validation for Vietnamese mobile phone numbers
      if (currentPhone.length === 0 && key !== '0') return; // Must start with 0
      if (currentPhone.length === 1 && !['3', '5', '7', '8', '9'].includes(key)) return; // Valid 2nd digits

      if (currentPhone.length < 10) {
        updateFormData({ phone: currentPhone + key });
      }
    } else if (activeField === 'plate') {
      setUserTypedPlate(true);
      if ((formData.licensePlate || '').length < 15) {
        const currentRaw = (formData.licensePlate || '') + key;
        const clean = currentRaw.replace(/[^A-Z0-9]/g, '');
        const formatted = formatVietnamesePlate(clean);

        if (formatted) {
          updateFormData({ licensePlate: formatted });
        } else {
          updateFormData({ licensePlate: currentRaw.toUpperCase() });
        }
      }
    }
  };

  const handleDelete = () => {
    if (activeField === 'phone' && (formData.phone || '').length > 0) {
      updateFormData({ phone: (formData.phone || '').slice(0, -1) });
    } else if (activeField === 'plate' && (formData.licensePlate || '').length > 0) {
      setUserTypedPlate(true);
      updateFormData({ licensePlate: (formData.licensePlate || '').slice(0, -1) });
    }
  };

  const handleSpace = () => {
    if (activeField === 'plate') {
      setUserTypedPlate(true);
      updateFormData({ licensePlate: (formData.licensePlate || '') + ' ' });
    }
  };

  const renderNumpad = () => (
    <div className="w-[90%] mx-auto relative mt-2">
      <div className="grid grid-cols-5 gap-3 mb-3 pr-14">
        {[0, 1, 2, 3, 4].map(num => (
          <button
            key={num}
            onClick={() => handleKeyClick(num.toString())}
            className="bg-[#0f172a] text-white text-2xl font-bold rounded-[14px] h-[44px] flex items-center justify-center active:bg-gray-700 active:scale-95 transition-all"
          >
            {num}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-3 pr-14">
        {[5, 6, 7, 8, 9].map(num => (
          <button
            key={num}
            onClick={() => handleKeyClick(num.toString())}
            className="bg-[#0f172a] text-white text-2xl font-bold rounded-[14px] h-[44px] flex items-center justify-center active:bg-gray-700 active:scale-95 transition-all"
          >
            {num}
          </button>
        ))}
      </div>
      {/* Delete Button Absolute Right */}
      <button
        onClick={handleDelete}
        className="absolute right-0 top-0 h-[100px] w-11 flex items-center justify-center border-2 border-[#0f172a] bg-white rounded-[14px] text-[#0f172a] hover:bg-gray-100 active:bg-gray-200 active:scale-95 transition-all"
      >
        <Delete size={20} strokeWidth={2} />
      </button>
    </div>
  );

  const qwertyRows = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '-', '.']
  ];

  const renderKeyboard = () => (
    <div className="w-full mx-auto relative mt-1 flex flex-col gap-1.5">
      {qwertyRows.map((row, i) => (
        <div key={i} className={`flex justify-center gap-1.5 ${i === 1 ? 'px-3' : ''} ${i === 2 ? 'px-6' : ''}`}>
          {row.map(key => (
            <button
              key={key}
              onClick={() => handleKeyClick(key)}
              className="bg-[#0f172a] text-white text-lg font-bold rounded-lg h-[40px] flex-1 max-w-[44px] flex items-center justify-center active:bg-gray-700 active:scale-95 transition-all shadow-sm"
            >
              {key}
            </button>
          ))}
          {i === 3 && (
            <button
              onClick={handleDelete}
              className="bg-white border-2 border-[#0f172a] text-[#0f172a] text-sm font-bold rounded-lg h-[40px] px-3 flex items-center justify-center active:bg-gray-100 active:scale-95 transition-all shadow-sm ml-1"
            >
              <Delete size={20} strokeWidth={2} />
            </button>
          )}
        </div>
      ))}
      <div className="flex justify-center gap-2 mt-1 px-10">
        <button
          onClick={handleSpace}
          className="bg-[#0f172a] text-white text-sm font-bold rounded-lg h-[40px] flex-1 flex items-center justify-center active:bg-gray-700 active:scale-95 transition-all shadow-sm"
        >
          SPACE
        </button>
      </div>
    </div>
  );

  const handleManualNext = async () => {
    setIsVerifying(true);
    try {
      const plate = (formData.licensePlate || '').trim();
      const cleanPlate = plate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      const phone = (formData.phone || '').trim();
      const response = await fetch(`${API_BASE}/sessions/verify-plate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licensePlate: cleanPlate })
      });
      const data = await response.json();
      const verifyData = data.data || {};
      setIsVerifying(false);

      if (data.success) {
        routeFromVerifyData(verifyData, { phoneFallback: phone, requirePhone: true });
      } else {
        setStepAlert({
          title: 'Verification Failed',
          message: data.message || 'Could not verify the license plate. Please try again.',
        });
      }
    } catch (e) {
      console.error("verify-plate backend error", e);
      setIsVerifying(false);
      setStepAlert({
        title: 'Connection Error',
        message: 'Could not verify the license plate. Please try again.',
      });
    }
  };
  return (
    <div className="flex flex-col items-center justify-center flex-1 w-full max-w-[650px] mx-auto pb-4">
      {/* FULL BANNER (Only shows if forced via formData) */}
      {formData.isParkingFull && (
        <div className="w-full bg-red-600 text-white font-bold py-3 px-6 rounded-2xl mb-4 flex items-center justify-center gap-3 shadow-lg animate-pulse">
          <AlertCircle size={24} />
          <span className="text-lg tracking-wide uppercase">Parking Full - Reserved Only</span>
        </div>
      )}

      {/* ─── Yellow Card Container (Flat & Soft) ─── */}
      <div className="bg-[#FFDF00] w-full rounded-[28px] py-4 px-4 sm:px-8 flex flex-col items-center transition-all duration-500">

        {/* License Plate Field */}
        <div className="w-full text-center mb-3 relative flex flex-col items-center">
          <label className="block text-[10px] font-bold text-[#0f172a] tracking-widest mb-1 uppercase">
            License Plate Number
            {isVerifying && <span className="ml-2 text-blue-500 animate-pulse font-normal lowercase tracking-normal">(verifying...)</span>}
          </label>
          {!isValidLicensePlate(formData.licensePlate || '') && (formData.licensePlate || '').length > 0 && (
            <div className="absolute -top-10 flex items-center gap-2 text-rose-600 bg-white/80 px-4 py-1 rounded-full font-bold shadow-sm animate-pulse">
              <AlertCircle size={16} /> License plate format is incorrect.
            </div>
          )}
          <div
            className={`relative bg-white rounded-2xl h-[52px] flex items-center justify-between px-2 w-[90%] mx-auto transition-all border-2 cursor-pointer ${activeField === 'plate' ? 'border-[#0f172a] shadow-[0_4px_15px_rgba(0,0,0,0.05)]' : 'border-transparent'}`}
            onClick={() => setActiveField('plate')}
          >
            {/* Left side empty for centering balance */}
            <div className="w-[44px]"></div>

            <div className="flex items-center justify-center">
              <span className="text-2xl font-bold font-mono tracking-[0.2em] text-[#0f172a]">
                {formData.licensePlate || 'TAP TO ENTER'}
              </span>
              {activeField === 'plate' && (
                <span className="w-0.5 h-[26px] bg-[#0f172a] animate-pulse ml-1"></span>
              )}
            </div>

            {/* QR Scan Button inside the input */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowQrModal(true);
              }}
              className="h-[40px] w-[44px] flex items-center justify-center bg-[#0f172a] text-[#FFDF00] rounded-xl hover:bg-black active:scale-95 transition-all shadow-sm"
              title="Scan VIP / Booking QR"
            >
              <ScanLine size={20} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Phone Number Field */}
        <div className="w-full text-center mb-3 animate-in fade-in slide-in-from-top-4 duration-500">
          <label className="block text-[10px] font-bold text-[#0f172a] tracking-widest mb-1 uppercase">
            Enter Phone
            {pastGuestVerified && <span className="ml-2 text-emerald-700 normal-case font-semibold">• Returning guest recognized</span>}
          </label>
          <div
            className={`relative bg-white rounded-2xl h-[52px] flex items-center justify-center px-6 w-[90%] mx-auto transition-all border-2 cursor-pointer ${activeField === 'phone' ? 'border-[#0f172a] shadow-[0_4px_15px_rgba(0,0,0,0.05)]' : 'border-transparent'}`}
            onClick={() => setActiveField('phone')}
          >
            <div className="flex items-center justify-center w-full font-mono text-3xl font-bold pl-[0.2em]">
              <span className="text-[#0f172a] tracking-[0.2em]">{formData.phone || ''}</span>
              {/* Dynamic blinking cursor */}
              {activeField === 'phone' && (
                <span className="w-0.5 h-[30px] bg-[#0f172a] animate-pulse -ml-[0.1em] mr-[0.1em]"></span>
              )}
              <span className="text-gray-300 tracking-[0.2em]">
                {'0123456789'.slice((formData.phone || '').length)}
              </span>
            </div>
          </div>
        </div>

        {/* Dynamic Keyboard based on active field */}
        {activeField === 'phone' ? renderNumpad() : renderKeyboard()}

      </div>

      {/* Actions Row */}
      <div className="flex items-center justify-center gap-4 mt-4 mb-1">
        <button
          type="button"
          onClick={() => setShowQrModal(true)}
          className="flex items-center gap-2 font-bold text-[16px] px-8 h-[52px] rounded-full transition-all border-2 border-[#0f172a] bg-white text-[#0f172a] hover:bg-slate-50 shadow-sm active:scale-95"
        >
          <ScanLine size={20} />
          <span>Scan QR</span>
        </button>

        <button
          onClick={handleManualNext}
          disabled={isVerifying || !(formData.licensePlate || '') || !isValidLicensePlate(formData.licensePlate || '')}
          className={`font-bold text-[16px] px-16 h-[52px] rounded-full transition-all border-2 ${(isVerifying || !(formData.licensePlate || '') || !isValidLicensePlate(formData.licensePlate || ''))
            ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
            : 'bg-[#0f172a] border-[#0f172a] text-white hover:bg-black shadow-[0_10px_20px_rgba(0,0,0,0.2)] active:scale-95'
            }`}
        >
          Next step
        </button>
      </div>

      <KioskDeviceSetup gate="ENTRY_1" />
      <KioskQrScannerModal
        isOpen={showQrModal}
        onClose={() => setShowQrModal(false)}
        onScan={handleQrScan}
      />

      <ParkingFullModal
        isOpen={showFullModal}
        onClose={() => window.location.replace('/kiosk')}
        title={modalTitle}
        message={modalMessage}
      />

      {/* Reallocation Modal */}
      {showReallocationModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-[32px] p-8 max-w-[400px] w-full shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-amber-100 text-amber-500 rounded-full flex items-center justify-center mb-6 shadow-inner">
              <AlertCircle size={40} strokeWidth={2.5} />
            </div>
            <h3 className="text-xl font-black text-slate-800 uppercase tracking-wide mb-3">
              {reallocationTitle}
            </h3>
            <p className="text-sm font-medium text-slate-600 mb-8 leading-relaxed">
              {reallocationMessage}
            </p>
            <button
              onClick={() => {
                setShowReallocationModal(false);
                onNext('2');
              }}
              className="w-full h-[60px] bg-amber-500 hover:bg-amber-400 text-white text-lg font-black rounded-2xl transition-all shadow-[0_8px_20px_rgba(245,158,11,0.3)] active:scale-95"
            >
              CHOOSE NEW SLOT
            </button>
          </div>
        </div>
      )}

      <ParkingFullModal
        isOpen={!!stepAlert}
        title={stepAlert?.title || 'NOTICE'}
        message={stepAlert?.message || ''}
        onClose={() => setStepAlert(null)}
      />

      {/* Plate Mismatch & Anti-Fraud Alert Modal */}
      <PlateMismatchModal
        isOpen={!!mismatchData}
        qrPlate={mismatchData?.qrPlate || ''}
        detectedPlate={mismatchData?.detectedPlate || ''}
        entryImageBase64={mismatchData?.entryImageBase64 || null}
        reason={mismatchData?.reason || ''}
        onClose={() => {
          setMismatchData(null);
        }}
      />
    </div>
  );
}

