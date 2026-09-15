import { useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import KioskWelcome from './KioskWelcome';
import KioskStep1 from './KioskStep1';
import KioskStep2 from './KioskStep2';
import KioskStep3 from './KioskStep3';
import KioskLayout from './KioskLayout';
import { API_BASE } from '../../services/api';
import { createBookingHold, releaseBookingHold } from '../../services/bookingService';

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
        // Cập nhật session thành công để chuyển sang màn hình chào đón & chỉ ô đỗ
        setSuccessSession(data.data);
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
    setSuccessSession(null);
    setFormData(createEmptyKioskFormData());
    navigate('/kiosk', { replace: true });
  };

  const handleFastPassComplete = () => {
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

  const handleDirectFastPass = (sessionData, newFormData) => {
    if (newFormData) {
      setFormData(prev => ({ ...prev, ...newFormData }));
    }
    setSuccessSession(sessionData);
    navigate('/kiosk/step3');
  };

  return (
    <div className="w-screen h-screen overflow-hidden bg-white selection:bg-gold/30">
      {isSubmitting && (
        <div className="fixed inset-0 bg-white/80 z-[100] flex items-center justify-center">
          <div className="text-2xl font-bold text-[#0f172a] animate-pulse">CREATING SESSION...</div>
        </div>
      )}

      <Routes>
        {/* Step 0: Welcome Screen (Full width, no split layout) */}
        <Route index element={<KioskWelcome onStart={(step = 1) => handleNext(step)} updateFormData={updateFormData} onDirectFastPass={handleDirectFastPass} />} />

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
                successSession={successSession}
              />
            }
          />
        </Route>
      </Routes>
    </div>
  );
}
