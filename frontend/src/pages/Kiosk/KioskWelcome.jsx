import { useEffect, useRef, useState } from 'react';
import { Loader2, Pointer } from 'lucide-react';
import backgroundImage from '../../assets/images/Kiosk/BackgroundWelcomeKiosk.png';
import logoImage from '../../assets/images/Kiosk/LogoKiosk.png';
import ParkingFullModal from './ParkingFullModal';
import PlateMismatchModal from './PlateMismatchModal';
import { API_BASE } from '../../services/api';
import { getAvailableBookingSlots } from '../../services/bookingService';
import { normalizeLicensePlate } from '../../utils/licensePlate';
import { useQrScannerListener } from '../../hooks/useQrScannerListener';

const SCAN_ATTEMPTS = 20;
const SCAN_RETRY_DELAY_MS = 800;
const CAMERA_WARMUP_MS = 1200;
const SCAN_TIMEOUT_MS = 7000;
const VIDEO_READY_TIMEOUT_MS = 5000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isLikelyVietnamesePlate = (plate) => {
  const clean = normalizeLicensePlate(plate);
  return (
    /^\d{2}[A-Z]{1,2}\d{4,5}$/.test(clean) ||
    /^\d{2}[A-Z]\d\d{4,5}$/.test(clean)
  );
};

const plateFingerprint = (plate) => {
  const clean = normalizeLicensePlate(plate);
  if (!clean) return '';
  if (clean.length <= 6) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(-4)}`;
};

export default function KioskWelcome({ onStart, updateFormData, onDirectFastPass }) {
  const [isScanning, setIsScanning] = useState(false);
  const isParkingFullRef = useRef(false);
  const [scanMessage, setScanMessage] = useState('Scanning Plate...');
  const [showFullModal, setShowFullModal] = useState(false);
  const [showAlreadyInsideModal, setShowAlreadyInsideModal] = useState(false);
  const [mismatchData, setMismatchData] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);


  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  // Khởi động Camera ngầm để luôn sẵn sàng chụp ảnh tức thì khi quét QR từ GM65
  useEffect(() => {
    let isMounted = true;
    const initCam = async () => {
      try {
        if (!streamRef.current) {
          const stream = await openCameraStream();
          if (!isMounted) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => {});
            await configureCameraTrack(stream);
          }
        }
      } catch (e) {
        console.warn('[KioskWelcome] Background camera warmup skipped:', e?.message);
      }
    };
    initCam();
    return () => {
      isMounted = false;
      stopCamera();
    };
  }, []);

  const openCameraStream = async () => {
    const cameraOptions = [
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          aspectRatio: { ideal: 16 / 9 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      },
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          aspectRatio: { ideal: 16 / 9 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      },
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      },
      { video: true, audio: false },
    ];

    let lastError;
    for (const constraints of cameraOptions) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  };

  const configureCameraTrack = async (stream) => {
    const track = stream.getVideoTracks()[0];
    if (!track?.applyConstraints) return;

    const capabilities = track.getCapabilities?.() || {};
    const advanced = [];

    if (capabilities.focusMode?.includes?.('continuous')) {
      advanced.push({ focusMode: 'continuous' });
    }
    if (capabilities.exposureMode?.includes?.('continuous')) {
      advanced.push({ exposureMode: 'continuous' });
    }
    if (capabilities.whiteBalanceMode?.includes?.('continuous')) {
      advanced.push({ whiteBalanceMode: 'continuous' });
    }
    if (capabilities.zoom?.max && capabilities.zoom.max >= 1) {
      advanced.push({ zoom: Math.min(1.1, capabilities.zoom.max) });
    }
    if (capabilities.torch) {
      advanced.push({ torch: false });
    }

    if (!advanced.length) return;

    try {
      await track.applyConstraints({ advanced });
      console.info('[Kiosk scan] Camera track tuned', track.getSettings?.());
    } catch (error) {
      console.info('[Kiosk scan] Camera track tuning skipped', error?.message || error);
    }
  };

  const waitForVideoFrame = async (video) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < VIDEO_READY_TIMEOUT_MS) {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
        return true;
      }
      await wait(100);
    }
    return false;
  };

  const buildScanImageBase64 = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL('image/jpeg', 0.82);
  };

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
      if (numbers.length === 5) formattedNumbers = `${numbers.slice(0, 3)}.${numbers.slice(3)}`;
      const isMotorbike = /\d/.test(series);
      return isMotorbike ? `${province}-${series} ${formattedNumbers}` : `${province}${series} - ${formattedNumbers}`;
    }
    return clean; // Fallback to raw string
  };

  const captureAndAnalyze = async () => {
    if (!videoRef.current) return null;
    if (!videoRef.current.videoWidth || !videoRef.current.videoHeight) return null;
    const imageBase64 = await buildScanImageBase64();
    if (!imageBase64) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

    try {
      const response = await fetch(`${API_BASE}/ai/scan-plate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageBase64 }),
        signal: controller.signal,
      });

      const data = await response.json();
      if (response.status === 429) {
        return {
          rateLimited: true,
          retryAfterSeconds: data.retryAfterSeconds || null,
          message: data.message || 'AI plate scanning is temporarily unavailable.',
        };
      }
      const normalizedPlate = normalizeLicensePlate(data.plate || '');
      if (response.ok && data.success && isLikelyVietnamesePlate(normalizedPlate)) {
        return { plate: normalizedPlate, imageBase64 };
      }
      console.info('[Kiosk scan] AI did not return a valid plate', {
        status: response.status,
        plate: data.plate,
        message: data.message,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    return null;
  };

  const verifyScannedPlate = async ({ plate, imageBase64 }) => {
    const formatted = formatVietnamesePlate(plate);
    if (!formatted) return false;

    setScanMessage('Checking registration...');

    const response = await fetch(`${API_BASE}/sessions/verify-plate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licensePlate: formatted }),
    });
    const data = await response.json();
    const verifyData = data.data || {};

    if (!data.success) {
      updateFormData({ licensePlate: formatted, entryImageBase64: imageBase64 });
      return false;
    }

    if (verifyData.isActive) {
      setShowAlreadyInsideModal(true);
      updateFormData({ licensePlate: formatted, entryImageBase64: imageBase64 });
      return true;
    }

    if (verifyData.isMonthly || verifyData.hasPreBooking) {
      updateFormData({
        step3Mode: verifyData.requiresSlotReallocation ? 'policy' : 'fastpass',
        isMonthly: verifyData.isMonthly,
        membershipType: verifyData.membershipType || null,
        hasPreBooking: verifyData.hasPreBooking,
        isVipReallocation: !!verifyData.requiresSlotReallocation,
        selectedSlot: verifyData.assignedSlot,
        floorId: verifyData.assignedFloorId,
        bookingId: verifyData.bookingId,
        bookingFloorName: verifyData.assignedFloorName,
        durationHours: verifyData.bookingDurationHours || 1,
        licensePlate: formatted,
        phone: verifyData.phone || '',
        ticketPackageId: verifyData.bookingTicketPackageId || null,
        entryImageBase64: imageBase64,
        bookingMode: verifyData.bookingMode || 'hourly',
      });

      if (verifyData.assignedSlot && !verifyData.requiresSlotReallocation) {
        setScanMessage('Opening Barrier & Assigning Slot...');
        try {
          const entryPayload = {
            licensePlate: formatted,
            phone: verifyData.phone || '',
            parkingSlot: verifyData.assignedSlot,
            floorId: verifyData.assignedFloorId,
            durationHours: verifyData.bookingDurationHours || 1,
            entryImageBase64: imageBase64,
            ticketPackageId: verifyData.bookingTicketPackageId || null,
            bookingMode: verifyData.bookingMode || 'hourly',
            bookingId: verifyData.bookingId || null,
            bookingHoldId: null,
          };

          const entryRes = await fetch(`${API_BASE}/sessions/kiosk-entry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entryPayload),
          });
          const entryData = await entryRes.json();

          if (entryData.success) {
            onDirectFastPass?.(entryData.data, {
              licensePlate: formatted,
              phone: verifyData.phone || '',
              selectedSlot: verifyData.assignedSlot,
              floorId: verifyData.assignedFloorId,
              step3Mode: 'fastpass',
              isMonthly: verifyData.isMonthly,
              hasPreBooking: verifyData.hasPreBooking,
              entryImageBase64: imageBase64,
            });
            return true;
          }
        } catch (entryErr) {
          console.error('Direct fast pass check-in error:', entryErr);
        }
      }

      onStart(verifyData.assignedSlot ? 3 : 2);
      return true;
    }

    if (isParkingFullRef.current) {
      setShowFullModal(true);
      updateFormData({ licensePlate: '', phone: '', entryImageBase64: null, isParkingFull: false });
      return true;
    }

    if (verifyData.isRegisteredVehicle || verifyData.isVIP) {
      updateFormData({
        step3Mode: verifyData.assignedSlot ? 'fastpass' : 'policy',
        licensePlate: formatted,
        entryImageBase64: imageBase64,
        phone: verifyData.phone || '',
        isVIP: !!verifyData.isVIP,
        isRegisteredVehicle: true,
        membershipType: verifyData.membershipType || null,
        pricingPackage: verifyData.pricingPackage || null,
        pricingSource: verifyData.pricingSource || 'default',
        ticketPackageId: verifyData.pricingPackage?._id || null,
        bookingMode: 'hourly',
        selectedSlot: verifyData.assignedSlot || null,
        floorId: verifyData.assignedFloorId || null,
        bookingFloorName: verifyData.assignedFloorName || null,
      });
      onStart(verifyData.assignedSlot ? 3 : 2);
      return true;
    }

    updateFormData({
      step3Mode: 'policy',
      licensePlate: formatted,
      entryImageBase64: imageBase64,
      phone: verifyData.phone || '',
      pricingPackage: verifyData.pricingPackage || null,
      pricingSource: verifyData.pricingSource || 'default',
      ticketPackageId: verifyData.pricingPackage?._id || null,
      bookingMode: 'hourly',
      membershipType: verifyData.membershipType || null,
    });
    return false;
  };

  const handleStart = async () => {
    setIsScanning(true);
    setScanMessage('Scanning Plate...');

    try {
      const fullRes = await fetch(`${API_BASE}/sessions/check-full`);
      const fullData = await fullRes.json();
      if (fullData.success && fullData.data && fullData.data.isFull) {
        isParkingFullRef.current = true;
      } else {
        isParkingFullRef.current = false;
      }
    } catch (e) {
      console.error('Failed to check full status', e);
      isParkingFullRef.current = false;
    }

    try {
      if (!streamRef.current) {
        const stream = await openCameraStream();
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          await configureCameraTrack(stream);
        }
      }

      if (videoRef.current) {
        const ready = await waitForVideoFrame(videoRef.current);
        if (!ready) {
          console.warn('[Kiosk scan] Video frame not ready in time, proceeding anyway');
        }
      }

      await wait(CAMERA_WARMUP_MS);

      const detectedPlates = new Map();
      for (let i = 0; i < SCAN_ATTEMPTS; i++) {
        try {
          const rawResult = await captureAndAnalyze();
          if (rawResult) {
            if (rawResult.rateLimited) {
              updateFormData({ licensePlate: '', phone: '', entryImageBase64: null });
              stopCamera();
              setIsScanning(false);
              setScanMessage(rawResult.message);
              alert(rawResult.message);
              onStart(1);
              return;
            }
            const normalizedPlate = normalizeLicensePlate(rawResult.plate);
            const fingerprint = plateFingerprint(normalizedPlate);
            const previous = detectedPlates.get(fingerprint);
            const nextCandidate = previous
              ? { ...previous, count: previous.count + 1, plate: normalizedPlate, imageBase64: rawResult.imageBase64 }
              : { ...rawResult, plate: normalizedPlate, count: 1, fingerprint };
            detectedPlates.set(fingerprint, nextCandidate);

            if (nextCandidate.count >= 2 || i >= 3) {
              const handled = await verifyScannedPlate(nextCandidate);
              stopCamera();
              setIsScanning(false);
              if (handled) return;
              onStart(1);
              return;
            }
          }
        } catch (scanError) {
          console.error('Welcome scan attempt failed:', scanError);
        }
        await wait(SCAN_RETRY_DELAY_MS);
      } // End of loop
      updateFormData({ licensePlate: '', phone: '', entryImageBase64: null, isParkingFull: isParkingFullRef.current });
      stopCamera();
      setIsScanning(false);
      onStart(1);
    } catch (error) {
      console.error('Welcome camera scan error:', error);

      updateFormData({ licensePlate: '', phone: '', entryImageBase64: null, isParkingFull: isParkingFullRef.current });
      stopCamera();
      setIsScanning(false);
      onStart(1);
    }
  };

  // Quét mã QR trực tiếp từ mắt đọc GM65 (USB / UART) ngay tại màn hình Welcome
  const handleHardwareQrScan = async (qrPayload) => {
    if (!qrPayload || isScanning) return;
    setIsScanning(true);
    setScanMessage('Verifying QR Code & License Plate...');

    try {
      // 1. Chụp ảnh nhanh từ camera nếu camera đang khả dụng
      let entryImage = null;
      try {
        if (!videoRef.current?.videoWidth && !streamRef.current) {
          const stream = await openCameraStream();
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => {});
          }
          await wait(300);
        }
        if (videoRef.current && videoRef.current.videoWidth) {
          entryImage = await buildScanImageBase64();
        }
      } catch (e) {
        console.warn('Camera snapshot error:', e);
      }

      // 2. Xác thực mã QR và đối chiếu biển số xe thực tế qua API Backend
      const response = await fetch(`${API_BASE}/sessions/kiosk-verify-qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrPayload, entryImageBase64: entryImage }),
      });
      const qrData = await response.json();

      if (!qrData.success) {
        setIsScanning(false);
        setScanMessage('Scanning Plate...');
        alert(qrData.message || 'Mã QR không hợp lệ!');
        return;
      }

      // 3. KIỂM TRA ĐỐI CHIẾU BIỂN SỐ THỰC TẾ VS MÃ QR (ANTI-FRAUD CHECK)
      if (qrData.isPlateMatched === false) {
        setIsScanning(false);
        setScanMessage('Scanning Plate...');
        setMismatchData({
          qrPlate: qrData.licensePlate,
          detectedPlate: qrData.detectedPlate,
          reason: qrData.mismatchReason,
          entryImageBase64: entryImage,
        });
        return;
      }

      const cleanPlate = (qrData.licensePlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
      const phone = qrData.phone || '';

      // 4. Kiểm tra thông tin xe / đặt chỗ / VIP
      const verifyRes = await fetch(`${API_BASE}/sessions/verify-plate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licensePlate: cleanPlate }),
      });
      const verifyJson = await verifyRes.json();
      const verifyData = verifyJson.success ? verifyJson.data : null;

      if (verifyData?.isActive) {
        setIsScanning(false);
        setScanMessage('Scanning Plate...');
        setShowAlreadyInsideModal(true);
        return;
      }

      // 5. Nếu là Khách VIP hoặc Đặt trước -> Tự động tạo phiên check-in & Mở barrier & Chuyển thẳng đến màn hình chỉ ô đỗ
      if (verifyData && (verifyData.hasPreBooking || verifyData.isMonthly) && !verifyData.requiresSlotReallocation) {
        setScanMessage('Opening Barrier & Assigning Slot...');
        const entryPayload = {
          licensePlate: cleanPlate,
          phone: phone || verifyData.phone || '',
          parkingSlot: verifyData.assignedSlot,
          floorId: verifyData.assignedFloorId,
          durationHours: 1,
          entryImageBase64: entryImage,
          ticketPackageId: verifyData.pricingPackage?._id || null,
          bookingMode: 'hourly',
          bookingId: verifyData.bookingId || null,
          bookingHoldId: null,
        };

        const entryRes = await fetch(`${API_BASE}/sessions/kiosk-entry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entryPayload),
        });
        const entryData = await entryRes.json();

        if (entryData.success) {
          stopCamera();
          setIsScanning(false);
          onDirectFastPass?.(entryData.data, {
            licensePlate: cleanPlate,
            phone: phone || verifyData.phone || '',
            selectedSlot: verifyData.assignedSlot,
            floorId: verifyData.assignedFloorId,
            step3Mode: 'fastpass',
            isMonthly: verifyData.isMonthly,
            hasPreBooking: verifyData.hasPreBooking,
            entryImageBase64: entryImage,
          });
          return;
        }
      }

      // 6. Nếu xe cần chọn ô đỗ hoặc cần duyệt lại
      updateFormData({
        licensePlate: cleanPlate,
        phone: phone || verifyData?.phone || '',
        entryImageBase64: entryImage,
        step3Mode: verifyData?.requiresSlotReallocation ? 'policy' : (verifyData?.hasPreBooking || verifyData?.isMonthly ? 'fastpass' : 'policy'),
        isMonthly: verifyData?.isMonthly || false,
        hasPreBooking: verifyData?.hasPreBooking || false,
        selectedSlot: verifyData?.assignedSlot || null,
        floorId: verifyData?.assignedFloorId || null,
        bookingId: verifyData?.bookingId || null,
      });

      stopCamera();
      setIsScanning(false);
      onStart(verifyData?.assignedSlot ? 3 : 2);

    } catch (err) {
      console.error('Error during QR hardware scan:', err);
      setIsScanning(false);
      alert('Lỗi khi xử lý mã QR từ máy quét!');
    }
  };

  useQrScannerListener(handleHardwareQrScan, !isScanning);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-gray-900 overflow-hidden font-sans">
      {/* Background Image */}
      <div
        className="absolute inset-0 z-0 bg-cover bg-center blur-sm scale-105 opacity-90"
        style={{ backgroundImage: `url(${backgroundImage})` }}
      ></div>

      {/* Main Card */}
      <div className="relative z-10 bg-white/95 backdrop-blur-md w-[85%] max-w-[1000px] rounded-[32px] shadow-[0_30px_60px_rgba(0,0,0,0.3)] p-16 flex flex-col items-center">

        <div className="absolute top-5 right-0 w-44">
          <img src={logoImage} alt="Valo Parking" className="w-full h-auto object-contain" />
        </div>

        <div className="w-full text-left mt-8 mb-10">
          <h2 className="text-4xl font-extrabold text-[#0f172a] tracking-tight mb-2">WELCOME TO</h2>
          <h1
            className="text-[100px] font-black tracking-tight leading-none text-[#FFEB00]"
            style={{ textShadow: '2px 4px 10px rgba(0,0,0,0.3), 1px 1px 0px #0f172a' }}
          >
            VALO PARKING
          </h1>
          <p className="text-2xl font-bold text-gray-600 mt-6 tracking-wide">
            Fast, Secure, and Fully Automated Experience
          </p>
        </div>

        <button
          onClick={handleStart}
          disabled={isScanning}
          className="mt-12 bg-[#FFEB00] hover:bg-[#FFE000] text-[#0f172a] font-black text-3xl px-16 py-6 rounded-full flex items-center gap-4 transition-all shadow-[0_15px_30px_rgba(255,235,0,0.4)] border border-[#F2D600] group min-w-[400px] justify-center hover:shadow-[0_20px_40px_rgba(255,235,0,0.6)] active:scale-95 active:shadow-md cursor-pointer"
        >
          {isScanning ? 'Scanning...' : 'Click to start'}
          {isScanning ? (
            <Loader2 size={36} className="animate-spin" strokeWidth={2.5} />
          ) : (
            <Pointer size={36} className="transform -rotate-12 group-hover:scale-110 transition-transform" strokeWidth={2.5} />
          )}
        </button>

      </div>

      <video
        ref={videoRef}
        className="absolute h-px w-px opacity-0 pointer-events-none"
        playsInline
        muted
        aria-hidden="true"
      />
      <canvas
        ref={canvasRef}
        className="absolute h-px w-px opacity-0 pointer-events-none"
        aria-hidden="true"
      />

      <ParkingFullModal
        isOpen={showFullModal}
        onClose={() => {
          setShowFullModal(false);
          window.location.replace('/kiosk');
        }}
      />

      <ParkingFullModal
        isOpen={showAlreadyInsideModal}
        title="ALREADY INSIDE"
        message="This vehicle is already inside the parking lot!"
        onClose={() => {
          setShowAlreadyInsideModal(false);
          window.location.replace('/kiosk');
        }}
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
