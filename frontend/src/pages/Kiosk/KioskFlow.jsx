import { useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import KioskWelcome from './KioskWelcome';
import KioskStep1 from './KioskStep1';
import KioskStep2 from './KioskStep2';
import KioskStep3 from './KioskStep3';
import KioskLayout from './KioskLayout';
import { API_BASE } from '../../services/api';
import { createBookingHold, releaseBookingHold } from '../../services/bookingService';
import { formatLicensePlateDisplay } from '../../utils/licensePlate';

const createEmptyKioskFormData = () => ({
  licensePlate: '',
  phone: '',
  selectedSlot: null,
  floorId: null,
  bookingHoldId: null,
  bookingHoldSlot: null,
  bookingHoldFloorId: null,
  bookingId: null,
  bookingFloorName: null,
  step3Mode: 'policy',
  durationHours: 1,
  entryImageBase64: null,
  ticketPackageId: null,
  pricingPackage: null,
  pricingSource: 'default',
  bookingMode: 'hourly',
  isMonthly: false,
  membershipType: null,
  hasPreBooking: false,
  isVIP: false,
  isRegisteredVehicle: false,
});

export default function KioskFlow() {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successSession, setSuccessSession] = useState(null); // stores the successful session data

  // Shared State across steps
  const [formData, setFormData] = useState(createEmptyKioskFormData);

  const updateFormData = (data) => {
    setFormData(prev => ({ ...prev, ...data }));
  };

  const handleNext = (step) => {
    navigate(`/kiosk/step${step}`);
  };

  const releaseCurrentHold = async () => {
    if (!formData.bookingHoldId) return;

    const cleanPlate = formData.licensePlate
      ? formData.licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase()
      : '';
    await releaseBookingHold(formData.bookingHoldId, {
      licensePlate: cleanPlate,
      floorId: formData.bookingHoldFloorId,
      slotCode: formData.bookingHoldSlot,
    }).catch(() => null);
    clearCurrentHoldState();
  };

  const clearCurrentHoldState = () => {
    updateFormData({
      bookingHoldId: null,
      bookingHoldSlot: null,
      bookingHoldFloorId: null,
    });
  };

  const handleHoldSlotAndNext = async () => {
    if (!formData.selectedSlot || !formData.floorId) {
      alert('Please select a parking slot first.');
      return;
    }

    const hasCurrentHold =
      formData.bookingHoldId &&
      formData.bookingHoldSlot === formData.selectedSlot &&
      formData.bookingHoldFloorId === formData.floorId;

    if (hasCurrentHold) {
      handleNext(3);
      return;
    }

    setIsSubmitting(true);
    try {
      if (formData.bookingHoldId) {
        const previousCleanPlate = formData.licensePlate
          ? formData.licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase()
          : '';
        await releaseBookingHold(formData.bookingHoldId, {
          licensePlate: previousCleanPlate,
          floorId: formData.bookingHoldFloorId,
          slotCode: formData.bookingHoldSlot,
        }).catch(() => null);
      }

      const cleanPlate = formData.licensePlate
        ? formData.licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase()
        : '';
      const now = new Date();
      const endTime = new Date(now.getTime() + 60 * 60 * 1000);

      const res = await createBookingHold({
        floorId: formData.floorId,
        slotCode: formData.selectedSlot,
        licensePlate: cleanPlate,
        startTime: now.toISOString(),
        endTime: endTime.toISOString(),
      });

      if (!res.ok) {
        alert('Ô đỗ này vừa có người khác chọn. Vui lòng chọn ô khác!');
        updateFormData({
          selectedSlot: null,
          floorId: null,
          bookingHoldId: null,
          bookingHoldSlot: null,
          bookingHoldFloorId: null,
        });
        return;
      }

      updateFormData({
        bookingHoldId: res.data?.data?._id || null,
        bookingHoldSlot: formData.selectedSlot,
        bookingHoldFloorId: formData.floorId,
      });
      handleNext(3);
    } catch (error) {
      console.error('Hold slot error:', error);
      alert('Network error while holding this slot. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = async (step) => {
    if (step === 2) {
      await releaseCurrentHold();
    }
    navigate(step === 0 ? '/kiosk' : `/kiosk/step${step}`);
  };

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      const cleanPlate = formData.licensePlate ? formData.licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase() : '';
      const response = await fetch(`${API_BASE}/sessions/kiosk-entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licensePlate: cleanPlate,
          phone: formData.phone,
          parkingSlot: formData.selectedSlot,
          floorId: formData.floorId,
          durationHours: formData.durationHours,
          entryImageBase64: formData.entryImageBase64,
          ticketPackageId: formData.ticketPackageId,
          bookingMode: formData.bookingMode,
          bookingId: formData.bookingId,
          bookingHoldId: formData.bookingHoldId,
        }),
      });

      const data = await response.json();
      if (data.success) {
        clearCurrentHoldState();

        // Show success screen
        setSuccessSession(data.data);

        // Auto close after 10 seconds
        setTimeout(() => {
          handleCloseSuccess();
        }, 10000);
      } else {
        alert(data.message || 'Something went wrong.');
      }
    } catch (error) {
      console.error('Submission error:', error);
      alert('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetKioskFlow = () => {
    // Đóng barrier khi quay về màn hình chính
    fetch(`${API_BASE}/iot/close-barrier`, { method: 'POST' }).catch(() => null);
    setSuccessSession(null);
    setFormData(createEmptyKioskFormData());
    navigate('/kiosk', { replace: true });
  };

  const handleCloseSuccess = () => {
    resetKioskFlow();
  };

  const handleFastPassComplete = () => {
    fetch(`${API_BASE}/iot/close-barrier`, { method: 'POST' }).catch(() => null);
    setSuccessSession(null);
    setFormData(createEmptyKioskFormData());
    window.location.replace('/kiosk');
  };

  const handleFastPassEntry = async () => {
    const response = await fetch(`${API_BASE}/sessions/kiosk-entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licensePlate: formData.licensePlate,
        phone: formData.phone,
        parkingSlot: formData.selectedSlot,
        floorId: formData.floorId,
        durationHours: formData.durationHours,
        entryImageBase64: formData.entryImageBase64,
        ticketPackageId: formData.ticketPackageId,
        bookingMode: formData.bookingMode,
        bookingId: formData.bookingId,
        bookingHoldId: formData.bookingHoldId,
      }),
    });

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.message || 'Fast-pass check-in failed.');
    }

    clearCurrentHoldState();
    return data;
  };

  return (
    <div className="w-screen h-screen overflow-hidden bg-white selection:bg-gold/30">
      {isSubmitting && (
        <div className="fixed inset-0 bg-white/80 z-[100] flex items-center justify-center">
          <div className="text-2xl font-bold text-[#0f172a] animate-pulse">CREATING SESSION...</div>
        </div>
      )}

      {/* Success Modal */}
      {successSession && (
        <div className="fixed inset-0 bg-[#0f172a] z-[200] flex flex-col items-center justify-center text-white">
          <div className="bg-white text-[#0f172a] p-10 rounded-[32px] shadow-2xl flex flex-col items-center max-w-[500px] w-full text-center">
            <div className="w-20 h-20 bg-green-100 text-green-500 rounded-full flex items-center justify-center mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h2 className="text-3xl font-black mb-2 uppercase tracking-tight">Booking Confirmed</h2>
            <p className="text-gray-500 font-medium mb-6">Please proceed to your slot.</p>

            <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl p-6 w-full flex flex-col items-center mb-6">
              <QRCodeSVG value={successSession._id || successSession.sessionId || 'UNKNOWN'} size={200} className="mb-4" />
              <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">Scan at Exit</p>
              <div className="text-sm font-mono bg-gray-200 px-3 py-1 rounded text-gray-600 font-bold">{successSession._id || successSession.sessionId}</div>
            </div>

            <div className="flex justify-between w-full text-left mb-6 border-t border-gray-100 pt-4">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">License Plate</p>
                <p className="text-xl font-black text-[#0f172a]">
                  {formatLicensePlateDisplay(successSession.licensePlate || formData.licensePlate)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Slot</p>
                <p className="text-xl font-black text-blue-600">{successSession.parkingSlot || formData.selectedSlot}</p>
              </div>
            </div>

            <button
              onClick={handleCloseSuccess}
              className="bg-[#FFDF00] text-[#0f172a] font-bold text-lg w-full py-4 rounded-xl hover:bg-[#e6c800] active:scale-95 transition-all"
            >
              Done
            </button>
          </div>
          <p className="mt-8 text-gray-400 text-sm">This screen will close automatically in 10 seconds.</p>
        </div>
      )}

      <Routes>
        {/* Step 0: Welcome Screen (Full width, no split layout) */}
        <Route index element={<KioskWelcome onStart={(step = 1) => handleNext(step)} updateFormData={updateFormData} />} />

        {/* Steps 1-3 use the Split-Screen KioskLayout */}
        <Route element={<KioskLayout />}>
          <Route
            path="step1"
            element={<KioskStep1 formData={formData} updateFormData={updateFormData} onNext={handleNext} />}
          />
          <Route
            path="step2"
            element={<KioskStep2 formData={formData} updateFormData={updateFormData} onNext={handleHoldSlotAndNext} onBack={() => handleBack(1)} isHoldingSlot={isSubmitting} />}
          />
          <Route
            path="step3"
            element={
              <KioskStep3
                formData={formData}
                onConfirm={handleConfirm}
                onBack={() => handleBack(formData.step3Mode === 'fastpass' ? 0 : 2)}
                onAutoCheckIn={handleFastPassEntry}
                onComplete={handleFastPassComplete}
              />
            }
          />
        </Route>
      </Routes>
    </div>
  );
}
