import { useRef, useEffect, useState } from 'react';
import { Camera, ScanLine, AlertCircle, QrCode } from 'lucide-react';
import valoLogo from '../../assets/images/Kiosk/ValoExitLogo.png';
import KioskQrScannerModal from '../Kiosk/KioskQrScannerModal';
import { API_BASE } from '../../services/api';
import { useQrScannerListener } from '../../hooks/useQrScannerListener';
import { normalizeLicensePlate } from '../../utils/licensePlate';
import {
  captureVideoLaneBase64,
  computeLaneFrameSignature,
  hasLaneMotionChanged,
} from '../../utils/cameraLaneCapture';
import { useGateCameraConfig } from '../../hooks/useGateCameraConfig';
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
  const [showQrModal, setShowQrModal] = useState(false);
  const qrScanningRef = useRef(false);
  const [alarmState, setAlarmState] = useState(false);
  const { cameraConfig } = useGateCameraConfig();
  const cameraConfigRef = useRef(cameraConfig);
  const prevFrameSigRef = useRef(null);
  const lastAiScanAtRef = useRef(0);

  useEffect(() => {
    cameraConfigRef.current = cameraConfig;
    prevFrameSigRef.current = null;
  }, [cameraConfig]);

  // Start webcam
  useEffect(() => {
    let stream = null;
    const startCamera = async () => {
      const options = [
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { min: 960, ideal: 1280 },
            height: { min: 540, ideal: 720 },
            aspectRatio: { ideal: 16 / 9 },
          },
          audio: false,
        },
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            aspectRatio: { ideal: 16 / 9 },
          },
          audio: false,
        },
        { video: true, audio: false },
      ];

      for (const constraints of options) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
          return;
        } catch (err) {
          console.warn('KioskOut camera constraint fallback:', err?.message || err);
        }
      }
      setStreamError(true);
    };
    startCamera();
    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  }, []);

  const handlePlateDetected = async (plate, imageBase64) => {
    try {
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
        setErrorMessage('');
        setAlarmState(false);
        onScanSuccess(data.data, imageBase64);
      } else {
        lastErrorPlateAtRef.current = { plate, at: Date.now() };
        setAlarmState(Boolean(data.alarm));
        if (data.alarmReason === 'already_checked_out') {
          setErrorMessage(`Vehicle with plate ${plate} has already checked out.`);
        } else if (data.code === 'EXIT_PLATE_UNREADABLE') {
          setErrorMessage('Unable to read license plate clearly. Please position the plate inside the frame.');
        } else if (data.code === 'EXIT_PLATE_MISMATCH') {
          setErrorMessage(`Exit plate does not match active parking session for ${plate}.`);
        } else if (res.status === 404) {
          setErrorMessage(`No active parking session found for plate ${plate}.`);
        } else {
          setErrorMessage(`Unable to verify parking session for plate ${plate}.`);
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
    return captureVideoLaneBase64(videoRef.current, canvasRef.current, 'exit', cameraConfigRef.current);
  };
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

  const handleTicketScanned = async (qrPayload) => {
    if (qrScanningRef.current) return;
    qrScanningRef.current = true;
    setShowQrModal(false); setErrorMessage(''); setAlarmState(false);
    try {
      const captured = await captureAndAnalyze();
      const exitImg = captured?.imageBase64 || captureFrameBase64();
      const payload = captured?.plate
        ? { qrPayload, licensePlate: captured.plate, detectedPlate: captured.plate, exitImageBase64: exitImg }
        : { qrPayload, exitImageBase64: exitImg };
      const response = await fetch(`${API_BASE}/sessions/kiosk-exit-scan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!result.success) {
        setAlarmState(Boolean(result.alarm));
        throw new Error(result.message || 'This parking ticket cannot be used for checkout.');
      }
      onScanSuccess({ ...result.data, qrPayload, observedLicensePlate: captured?.plate || null }, exitImg);
    } catch (err) { setErrorMessage(err.message || 'Unable to verify ticket.'); }
    finally { qrScanningRef.current = false; }
  };

  useQrScannerListener(handleTicketScanned, !showQrModal);

  const lastScannedPlateRef = useRef(null);
  const lastErrorPlateAtRef = useRef({ plate: null, at: 0 });

  // Camera Scanning Loop
  useEffect(() => {
    let interval;
    if (!streamError && videoRef.current) {
      let consecutiveEmptyFrames = 0;
      interval = setInterval(async () => {
        if (isScanningRef.current || qrScanningRef.current || showQrModal) return; // Skip if already processing

        const video = videoRef.current;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          const nextSig = computeLaneFrameSignature(video, 'exit', cameraConfigRef.current);
          const motionDetected = !prevFrameSigRef.current || hasLaneMotionChanged(prevFrameSigRef.current, nextSig);
          const heartbeatDue = Date.now() - lastAiScanAtRef.current >= 4000;
          if (!motionDetected && !heartbeatDue) return;

          prevFrameSigRef.current = nextSig;
          lastAiScanAtRef.current = Date.now();
          isScanningRef.current = true;
          // Only show scanning state when motion is detected so silent 4s heartbeats don't flash the UI
          if (motionDetected) {
            setIsScanning(true);
          }
          try {
            const result = await captureAndAnalyze();
            if (result && result.plate) {
              const cleaned = result.plate.replace(/[^A-Z0-9]/g, '');
              const formatted = formatVietnamesePlate(cleaned) || cleaned;

              if (formatted) {
                consecutiveEmptyFrames = 0;
                setRecognizedText(formatted);
                const recentlyFailedSamePlate =
                  lastErrorPlateAtRef.current.plate === formatted &&
                  Date.now() - lastErrorPlateAtRef.current.at < 10000;
                if (formatted !== lastScannedPlateRef.current && !recentlyFailedSamePlate) {
                  lastScannedPlateRef.current = formatted;
                  await handlePlateDetected(formatted, result.imageBase64);
                }
              }
            } else {
              consecutiveEmptyFrames += 1;
              // Require 3 consecutive empty frames before resetting so a single missed OCR frame doesn't flicker
              if (consecutiveEmptyFrames >= 3) {
                lastScannedPlateRef.current = null;
                setRecognizedText('');
                setErrorMessage('');
                setAlarmState(false);
              }
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
  }, [streamError, showQrModal]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-gradient-to-br from-[#151e34] via-[#0f172a] to-[#131b2e] overflow-hidden px-6 py-8 lg:px-12 text-white select-none">
      {/* Luminous Ambient Glows */}
      <div className="pointer-events-none absolute -top-32 -left-20 h-[560px] w-[560px] rounded-full bg-amber-400/[0.16] blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-32 -right-20 h-[560px] w-[560px] rounded-full bg-sky-400/[0.14] blur-[120px]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.08),transparent_60%)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.75) 1px, transparent 0)',
          backgroundSize: '28px 28px',
        }}
      />

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

      {/* Minimal Brand Logo Mark */}
      <div className="absolute top-5 left-6 lg:left-12 z-20 flex items-center gap-3.5">
        <img
          src={valoLogo}
          alt="Valo Parking"
          className="h-14 w-14 object-contain brightness-0 invert drop-shadow-[0_0_16px_rgba(250,204,21,0.45)]"
        />
        <span className="text-base md:text-lg font-black tracking-[0.22em] text-white uppercase drop-shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
          Valo Parking
        </span>
      </div>

      {/* Main Split Kiosk Layout */}
      <div className="relative z-10 w-full max-w-7xl grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-center">
        {/* Left: Larger, Brighter Glass-Bezel Camera Viewfinder */}
        <div className="lg:col-span-6 flex flex-col items-center">
          <div className="relative w-full max-w-[580px] rounded-[36px] p-[1.5px] bg-gradient-to-br from-white/40 via-amber-300/45 to-sky-300/25 shadow-[0_28px_80px_rgba(15,23,42,0.75),0_0_50px_rgba(250,204,21,0.12)]">
            <div className="relative w-full aspect-[4/3.6] rounded-[34px] overflow-hidden bg-slate-900 flex items-center justify-center">
              {streamError ? (
                <div className="flex flex-col items-center justify-center text-red-300 p-6 text-center">
                  <AlertCircle size={52} className="mb-3" />
                  <p className="font-bold text-lg">Cannot access Camera.</p>
                  <p className="text-sm text-slate-300 mt-1">Please check camera permissions for this browser.</p>
                </div>
              ) : (
                <>
                  <LaneCameraPreview
                    videoRef={videoRef}
                    lane="exit"
                    cameraConfig={cameraConfig}
                    active={!streamError}
                    className="w-full h-full object-cover brightness-[1.04] contrast-[1.03]"
                  />

                  {/* Minimal Top HUD */}
                  <div className="pointer-events-none absolute top-4 left-4 right-4 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 rounded-full bg-slate-950/60 backdrop-blur-md border border-white/25 px-4 py-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
                      <span className="text-[11px] font-bold tracking-[0.18em] text-white uppercase">
                        Exit Gate Live
                      </span>
                    </div>
                    <div className="rounded-full bg-slate-950/60 backdrop-blur-md border border-white/20 px-3.5 py-1.5">
                      <span className={`text-[11px] font-mono font-bold tracking-widest uppercase ${isScanning ? 'text-amber-300' : 'text-slate-100'}`}>
                        {isScanning ? 'Scanning' : 'AI Ready'}
                      </span>
                    </div>
                  </div>

                  {/* Clean Corner Reticle & Laser Beam */}
                  <div className="pointer-events-none absolute top-18 bottom-8 inset-x-6 rounded-2xl overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-[2.5px] bg-gradient-to-r from-transparent via-amber-300 to-transparent shadow-[0_0_18px_3px_rgba(253,224,71,0.85)] animate-scan" />
                    <div className="absolute top-0 left-0 w-7 h-7 border-t-[3px] border-l-[3px] border-amber-300 rounded-tl-xl" />
                    <div className="absolute top-0 right-0 w-7 h-7 border-t-[3px] border-r-[3px] border-amber-300 rounded-tr-xl" />
                    <div className="absolute bottom-0 left-0 w-7 h-7 border-b-[3px] border-l-[3px] border-amber-300 rounded-bl-xl" />
                    <div className="absolute bottom-0 right-0 w-7 h-7 border-b-[3px] border-r-[3px] border-amber-300 rounded-br-xl" />
                  </div>

                  {/* Floating Detected Plate Pill (only when a plate is recognized) */}
                  {recognizedText && (
                    <div className="pointer-events-none absolute bottom-5 right-5 rounded-xl bg-amber-400 px-4 py-2 text-base font-mono font-black tracking-wider text-slate-950 shadow-[0_12px_28px_rgba(250,204,21,0.5)]">
                      {recognizedText}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Larger, Brighter Glassmorphic Control Panel */}
        <div className="lg:col-span-6 flex flex-col items-center lg:items-start text-center lg:text-left">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/35 bg-amber-400/15 backdrop-blur-md px-4 py-2 text-xs font-bold tracking-[0.2em] text-amber-200 uppercase mb-5">
            <span className="h-2 w-2 rounded-full bg-amber-300" />
            <span>Automated Exit</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-4 text-white drop-shadow-[0_6px_24px_rgba(255,255,255,0.15)]">
            EXIT KIOSK
          </h1>
          <p className="text-slate-200 text-lg md:text-xl flex items-center gap-3 mb-9">
            <Camera size={22} className="text-amber-300 shrink-0" />
            <span>Drive into the exit lane to scan your license plate.</span>
          </p>

          {/* Brighter Glass Card */}
          <div className="w-full rounded-[28px] p-[1.5px] bg-gradient-to-b from-white/30 to-white/10 mb-5 shadow-[0_24px_60px_rgba(15,23,42,0.55)]">
            <div className="rounded-[27px] bg-white/[0.08] backdrop-blur-2xl p-7 space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300/30 to-amber-400/10 border border-amber-300/45 text-amber-300 shadow-[0_0_24px_rgba(250,204,21,0.18)]">
                    <ScanLine size={26} className={isScanning ? 'animate-pulse' : ''} />
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-300">
                      AI Plate Reader
                    </p>
                    <p className="text-lg font-bold text-white mt-0.5">
                      {isScanning ? 'Scanning vehicle...' : 'Waiting for vehicle...'}
                    </p>
                  </div>
                </div>

                {recognizedText && (
                  <div className="rounded-xl border border-amber-300/60 bg-slate-950/75 px-4 py-2.5 font-mono text-lg font-black tracking-wider text-amber-300">
                    {recognizedText}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-5 border-t border-white/15">
                <span className="text-sm font-medium text-slate-200">Or check out with QR</span>
                <button
                  type="button"
                  disabled={isScanning}
                  onClick={() => setShowQrModal(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-400/20 hover:bg-amber-400 text-amber-200 hover:text-slate-950 border border-amber-300/55 px-5 py-2.5 text-sm font-bold tracking-wide transition-all active:scale-95 disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  <QrCode size={16} />
                  <span>Scan QR</span>
                </button>
              </div>
            </div>
          </div>

          {/* Error Message for Tailgating / Invalid Sessions */}
          {errorMessage && (
            <div className={`w-full rounded-2xl p-4 text-left ${alarmState ? 'bg-red-500/25 border border-red-400/75' : 'bg-red-500/20 border border-red-400/50'}`}>
              <p className="text-red-200 font-bold text-sm">{errorMessage}</p>
              <p className="text-slate-200 text-xs mt-1">
                {alarmState
                  ? 'Security alert triggered. Barrier must remain closed.'
                  : 'Barrier cannot open. Please contact security.'}
              </p>
            </div>
          )}
        </div>
      </div>

      <KioskQrScannerModal isOpen={showQrModal} onClose={() => setShowQrModal(false)} onScan={handleTicketScanned} />
    </div>
  );
}
