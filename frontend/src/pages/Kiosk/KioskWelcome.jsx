import { useEffect, useRef, useState } from 'react';
import { Loader2, Pointer } from 'lucide-react';
import backgroundImage from '../../assets/images/Kiosk/BackgroundWelcomeKiosk.png';
import logoImage from '../../assets/images/Kiosk/LogoKiosk.png';
import ParkingFullModal from './ParkingFullModal';
import { API_BASE } from '../../services/api';
import { getAvailableBookingSlots } from '../../services/bookingService';
import { normalizeLicensePlate } from '../../utils/licensePlate';

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

export default function KioskWelcome({ onStart, updateFormData }) {
  const [isScanning, setIsScanning] = useState(false);
  const isParkingFullRef = useRef(false);
  const [, setScanMessage] = useState('Scanning Plate...');
  const [showFullModal, setShowFullModal] = useState(false);
  const [showAlreadyInsideModal, setShowAlreadyInsideModal] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopCamera();
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

    setScanMessage(`Detected ${formatted}. Checking registration...`);

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
        step3Mode: 'fastpass',
        licensePlate: formatted,
        entryImageBase64: imageBase64,
        phone: verifyData.phone || '',
        isMonthly: verifyData.isMonthly,
        membershipType: verifyData.membershipType || null,
        hasPreBooking: verifyData.hasPreBooking,
        selectedSlot: verifyData.assignedSlot,
        floorId: verifyData.assignedFloorId || null,
        bookingId: verifyData.bookingId || null,
        bookingFloorName: verifyData.assignedFloorName || null,
        durationHours: verifyData.bookingDurationHours || 1,
        pricingPackage: verifyData.pricingPackage || null,
        pricingSource: verifyData.pricingSource || 'default',
        ticketPackageId: verifyData.bookingTicketPackageId || verifyData.pricingPackage?._id || null,
        bookingMode: verifyData.bookingMode || 'hourly',
        isParkingFull: isParkingFullRef.current
      });
      onStart(3);
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
    setScanMessage('Checking availability...');

    try {
      const startTimeStr = new Date().toISOString();
      const endTimeStr = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString();
      const availableRes = await getAvailableBookingSlots({
        startTime: startTimeStr,
        endTime: endTimeStr,
      });

      let isFull = false;
      if (availableRes.ok && availableRes.data?.data?.slots) {
        if (availableRes.data.data.slots.length === 0) {
          isFull = true;
          setScanMessage('HOURLY PARKING FULL (VIP ONLY)');
        }
      }
      isParkingFullRef.current = isFull;

      setScanMessage('Initializing camera...');
      const stream = await openCameraStream();
      streamRef.current = stream;
      await configureCameraTrack(stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const hasFrame = await waitForVideoFrame(videoRef.current);
        if (!hasFrame) {
          throw new Error('Camera did not produce a readable video frame');
        }
        await wait(CAMERA_WARMUP_MS);
      }

      setScanMessage('Scanning license plate...');
      const settings = stream.getVideoTracks()[0]?.getSettings?.();
      console.info('[Kiosk scan] Camera started', settings);
      const detectedPlates = new Map();
      for (let i = 0; i < SCAN_ATTEMPTS; i++) {
        try {
          const rawResult = await captureAndAnalyze();
          if (rawResult) {
            if (rawResult.rateLimited) {
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
      // After loop finishes without returning, it means it timed out or didn't find plate
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
          className="mt-12 bg-[#FFEB00] hover:bg-[#FFE000] text-[#0f172a] font-black text-3xl px-16 py-6 rounded-full flex items-center gap-4 transition-all shadow-[0_15px_30px_rgba(255,235,0,0.4)] border border-[#F2D600] group min-w-[400px] justify-center hover:shadow-[0_20px_40px_rgba(255,235,0,0.6)] active:scale-95 active:shadow-md"
        >
          {isScanning ? 'Please wait...' : 'Click to start'}
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
    </div>
  );
}
