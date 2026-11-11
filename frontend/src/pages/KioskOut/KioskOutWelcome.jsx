import { useRef, useEffect, useState } from 'react';
import { Camera, ScanLine, AlertCircle, QrCode, Car } from 'lucide-react';
import { API_BASE } from '../../services/api';
import { useQrScannerListener } from '../../hooks/useQrScannerListener';
import { normalizeLicensePlate } from '../../utils/licensePlate';
import { captureVideoLaneBase64 } from '../../utils/cameraLaneCapture';
import LaneCameraPreview from '../../components/LaneCameraPreview';

const isLikelyVietnamesePlate = (plate) => {
  const clean = normalizeLicensePlate(plate);
  return (
    /^\d{2}[A-Z]{1,2}\d{4,5}$/.test(clean) ||
    /^\d{2}[A-Z]\d\d{4,5}$/.test(clean)
  );
};

export default function KioskOutWelcome({ onScanSuccess }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isScanning, setIsScanning] = useState(false);
  const isScanningRef = useRef(false);
  const [streamError, setStreamError] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [alarmState, setAlarmState] = useState(false);

  // Start webcam
  useEffect(() => {
    let stream = null;
    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Error accessing webcam:", err);
        setStreamError(true);
      }
    };
    startCamera();
    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  }, []);

  const handlePlateDetected = async (plate, imageBase64) => {
    try {
      setErrorMessage(''); // clear previous errors
      setAlarmState(false);
      const res = await fetch(`${API_BASE}/sessions/kiosk-exit-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licensePlate: plate,
          detectedPlate: plate,
          exitImageBase64: imageBase64,
        })
      });
      const data = await res.json();
      if (data.success) {
        onScanSuccess(data.data, imageBase64);
      } else {
        lastErrorPlateAtRef.current = { plate, at: Date.now() };
        setAlarmState(Boolean(data.alarm));
        if (data.alarmReason === 'already_checked_out') {
          setErrorMessage(`Vehicle with plate ${plate} has already checked out.`);
        } else if (data.code === 'EXIT_PLATE_UNREADABLE') {
          setErrorMessage('Không đọc được biển số tại cổng ra. Vui lòng đưa biển số vào đúng khung camera.');
        } else if (data.code === 'EXIT_PLATE_MISMATCH') {
          setErrorMessage(data.message || 'Biển số tại cổng ra không khớp với session.');
        } else {
          setErrorMessage(data.message || `Vehicle with plate ${plate} is not currently checked in.`);
        }
        console.warn(data.message);
      }
    } catch (err) {
      console.error("API error", err);
      lastErrorPlateAtRef.current = { plate, at: Date.now() };
      setErrorMessage('System error while verifying license plate.');
    }
  };

  const captureFrameBase64 = () => {
    return captureVideoLaneBase64(videoRef.current, canvasRef.current, 'exit');
  };

  const handleHardwareQrScan = async (qrPayload) => {
    if (!qrPayload) return;
    try {
      setErrorMessage('');
      setAlarmState(false);
      const exitImage = captureFrameBase64();
      const res = await fetch(`${API_BASE}/sessions/kiosk-exit-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrPayload, exitImageBase64: exitImage })
      });
      const data = await res.json();
      if (data.success) {
        onScanSuccess(data.data, exitImage);
      } else {
        setErrorMessage(data.message || 'Mã QR không hợp lệ hoặc phiên đỗ xe đã kết thúc.');
      }
    } catch (err) {
      console.error('API error', err);
      setErrorMessage('Lỗi hệ thống khi xác thực mã QR.');
    }
  };

  useQrScannerListener(handleHardwareQrScan, true);

  const formatVietnamesePlate = (clean) => {
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
    return clean; // Fallback to raw string
  };

  // Fetch AI API from Backend to analyze plate (left half = exit lane)
  const captureAndAnalyze = async () => {
    try {
      const imageBase64 = captureFrameBase64();
      if (!imageBase64) return null;

      const response = await fetch(`${API_BASE}/ai/scan-plate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageBase64 })
      });

      const data = await response.json();
      const detectedPlate = data.plate || data.licensePlate || data.data?.licensePlate || data.data?.plate;
      const normalized = normalizeLicensePlate(detectedPlate);
      if (response.ok && data.success && isLikelyVietnamesePlate(normalized)) {
        return { plate: normalized, imageBase64 };
      }
    } catch (error) {
      console.error('Scan error:', error);
    }
    return null;
  };

  const lastScannedPlateRef = useRef(null);
  const lastErrorPlateAtRef = useRef({ plate: null, at: 0 });

  // Camera Scanning Loop
  useEffect(() => {
    let interval;
    if (!streamError && videoRef.current) {
      interval = setInterval(async () => {
        if (isScanningRef.current) return; // Skip if already processing

        const video = videoRef.current;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          isScanningRef.current = true;
          setIsScanning(true);
          try {
            const result = await captureAndAnalyze();
            if (result && result.plate) {
              const cleaned = result.plate.replace(/[^A-Z0-9]/g, '');
              const formatted = formatVietnamesePlate(cleaned) || cleaned;

              if (formatted) {
                setRecognizedText(formatted);
                const recentlyFailedSamePlate =
                  lastErrorPlateAtRef.current.plate === formatted &&
                  Date.now() - lastErrorPlateAtRef.current.at < 2500;
                if (formatted !== lastScannedPlateRef.current && !recentlyFailedSamePlate) {
                  lastScannedPlateRef.current = formatted;
                  await handlePlateDetected(formatted, result.imageBase64);
                }
              }
            } else {
              // Reset if no plate is seen, so it can scan the same car again later if needed
              lastScannedPlateRef.current = null;
            }
          } catch (err) {
            console.error("OCR Error:", err);
          } finally {
            isScanningRef.current = false;
            setIsScanning(false);
          }
        }
      }, 1000); // Scan every 1 second to prevent UI stuttering
    }

    return () => {
      if (interval) clearInterval(interval);
    };
    // Scanner loop intentionally captures the current handlers for this mounted camera session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamError]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-[#07080b] overflow-hidden px-6 py-8">
      {/* Subtle Ambient Background */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-yellow-400/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-amber-500/10 blur-3xl" />

      {/* Hidden Video Source & Capture Canvas (Decoding runs continuously in background) */}
      {!streamError && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute h-px w-px opacity-0 pointer-events-none"
          aria-hidden="true"
        />
      )}
      <canvas ref={canvasRef} className="hidden" />

      {/* Main Split Kiosk Layout: Dedicated Exit Camera Viewfinder (Left) + Instructions (Right) */}
      <div className="relative z-10 w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left: Cropped Exit-Only Camera Viewfinder */}
        <div className="lg:col-span-6 flex flex-col items-center">
          <div className="relative w-full max-w-[460px] aspect-[4/4.5] rounded-[28px] overflow-hidden border-2 border-yellow-400/40 bg-black shadow-[0_25px_70px_rgba(250,204,21,0.12)] flex items-center justify-center">
            {streamError ? (
              <div className="flex flex-col items-center justify-center text-red-400 p-6 text-center">
                <AlertCircle size={48} className="mb-3" />
                <p className="font-bold">Cannot access Camera.</p>
                <p className="text-xs text-gray-400 mt-1">Please check camera permissions for this browser.</p>
              </div>
            ) : (
              <>
                <LaneCameraPreview
                  videoRef={videoRef}
                  lane="exit"
                  rotate180={true}
                  active={!streamError}
                  className="w-full h-full object-contain"
                />

                {/* Top Live Badge */}
                <div className="pointer-events-none absolute top-4 left-4 flex items-center gap-2 rounded-full bg-black/75 backdrop-blur-md border border-yellow-400/40 px-3.5 py-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                  <span className="text-[11px] font-black tracking-wider text-yellow-400 uppercase">
                    Exit Gate Camera
                  </span>
                </div>

                {/* Scanning Line Animation */}
                <div className="pointer-events-none absolute inset-6 rounded-2xl overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-yellow-400 shadow-[0_0_15px_3px_rgba(250,204,21,0.7)] animate-scan" />
                  <div className="absolute top-0 left-0 w-7 h-7 border-t-4 border-l-4 border-yellow-400 rounded-tl-xl" />
                  <div className="absolute top-0 right-0 w-7 h-7 border-t-4 border-r-4 border-yellow-400 rounded-tr-xl" />
                  <div className="absolute bottom-0 left-0 w-7 h-7 border-b-4 border-l-4 border-yellow-400 rounded-bl-xl" />
                  <div className="absolute bottom-0 right-0 w-7 h-7 border-b-4 border-r-4 border-yellow-400 rounded-br-xl" />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right: Exit Kiosk Instructions & Live Detection Status */}
        <div className="lg:col-span-6 flex flex-col items-center lg:items-start text-center lg:text-left">
          <div className="inline-flex items-center gap-2 rounded-full border border-yellow-400/30 bg-yellow-400/10 px-4 py-1.5 text-xs font-black tracking-widest text-yellow-400 uppercase mb-4">
            <Car size={15} />
            <span>Automated Exit Station</span>
          </div>

          <h1 className="text-4xl md:text-6xl font-black text-white tracking-wider mb-3">
            EXIT KIOSK
          </h1>
          <p className="text-gray-300 text-base md:text-lg flex items-center gap-2 mb-8">
            <Camera size={20} className="text-yellow-400 shrink-0" />
            <span>Please proceed into the exit lane license plate scanning area</span>
          </p>

          {/* Live AI Status Card */}
          <div className="w-full rounded-2xl border border-white/10 bg-[#12141a] p-5 mb-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-400/15 text-yellow-400">
                  <ScanLine size={22} className={isScanning ? 'animate-pulse' : ''} />
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-400">AI License Plate Reader</p>
                  <p className="text-sm font-semibold text-white">
                    {isScanning ? 'Analyzing exit lane...' : 'Waiting for exiting vehicle...'}
                  </p>
                </div>
              </div>

              {recognizedText && (
                <div className="rounded-xl border border-yellow-400/40 bg-black px-3.5 py-2 font-mono text-base font-black tracking-wider text-yellow-400">
                  {recognizedText}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-white/10 text-xs text-gray-400">
              <QrCode size={15} className="text-yellow-400 shrink-0" />
              <span>You can also scan your Parking / Membership QR code at the reader below.</span>
            </div>
          </div>

          {/* Error Message for Tailgating / Invalid Sessions */}
          {errorMessage && (
            <div className={`w-full rounded-2xl p-4 text-left ${alarmState ? 'bg-red-600/25 border border-red-500/70' : 'bg-red-500/15 border border-red-500/45'}`}>
              <p className="text-red-300 font-bold text-sm">{errorMessage}</p>
              <p className="text-gray-300 text-xs mt-1">
                {alarmState
                  ? 'Security alert triggered. Barrier must remain closed.'
                  : 'Barrier cannot open. Please contact security.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
