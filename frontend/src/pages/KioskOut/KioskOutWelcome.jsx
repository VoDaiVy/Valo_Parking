import { useRef, useEffect, useState } from 'react';
import { Camera, ScanLine, AlertCircle, QrCode, Loader2 } from 'lucide-react';
import valoLogo from '../../assets/images/Kiosk/ValoExitLogo.png';
import KioskQrScannerModal from '../Kiosk/KioskQrScannerModal';
import { API_BASE } from '../../services/api';
import { useSocket } from '../../hooks/useSocket';
import { useQrScannerListener } from '../../hooks/useQrScannerListener';
import { normalizeLicensePlate } from '../../utils/licensePlate';
import {
  captureVideoLaneBase64,
  computeLaneFrameSignature,
  hasLaneMotionChanged,
  rotateImageBase64,
} from '../../utils/cameraLaneCapture';
import { useGateCameraConfig } from '../../hooks/useGateCameraConfig';
import LaneCameraPreview from '../../components/LaneCameraPreview';

const isLikelyVietnamesePlate = (plate) => {
  const clean = normalizeLicensePlate(plate);
  if (!clean || clean.length < 6 || clean.length > 10) return false;
  const prov = parseInt(clean.slice(0, 2), 10);
  if (isNaN(prov) || prov < 11 || prov > 99) return false;
  return (
    /^\d{2}[A-Z]{1,2}\d{4,5}$/.test(clean) ||
    /^\d{2}[A-Z]\d\d{4,5}$/.test(clean) ||
    /^\d{2}[A-Z]\d{5,6}$/.test(clean)
  );
};

export default function KioskOutWelcome({ onScanSuccess, targetGate = 'EXIT_1' }) {
  const socket = useSocket();
  const cameraLane = targetGate === 'ENTRY_1' ? 'entry' : 'exit';
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [remoteFrame, setRemoteFrame] = useState(null);
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
  const [autoScanEnabled, setAutoScanEnabled] = useState(() => localStorage.getItem('valo_auto_scan') !== 'false');

  // Lắng nghe đồng bộ trạng thái Auto-Scan từ Staff qua Socket và BroadcastChannel
  useEffect(() => {
    const handleAutoScanChange = (data) => {
      if (typeof data?.enabled === 'boolean') {
        setAutoScanEnabled(data.enabled);
        localStorage.setItem('valo_auto_scan', String(data.enabled));
      }
    };

    if (socket) {
      socket.on('gate:auto_scan_status', handleAutoScanChange);
    }

    let channel = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel('valo_gate_channel');
        channel.onmessage = (event) => {
          if (event.data?.type === 'AUTO_SCAN_CHANGED' && event.data?.payload) {
            handleAutoScanChange(event.data.payload);
          }
        };
      } catch (_) { }
    }

    return () => {
      if (socket) socket.off('gate:auto_scan_status', handleAutoScanChange);
      if (channel) channel.close();
    };
  }, [socket]);

  // Lắng nghe thay đổi chế độ làn (Tidal Flow) để reset ngay lập tức bộ nhớ cache quét
  useEffect(() => {
    const handleModeChange = () => {
      // Reset hoàn toàn mọi trạng thái scan để bắt đầu quét mới ngay lập tức
      lastAiScanAtRef.current = 0;
      scanStartedAtRef.current = 0;
      lastScannedPlateRef.current = null;
      lastErrorPlateAtRef.current = { plate: null, at: 0 };
      isScanningRef.current = false;
      qrScanningRef.current = false;
      setIsScanning(false);
      setErrorMessage('');
      setRecognizedText('');
      setAlarmState(false);
      // Reset remote frame reference để buộc lấy frame mới từ luồng đúng
      remoteFrameRef.current = null;
      prevFrameSigRef.current = null;
    };

    let channel = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel('valo_gate_channel');
        channel.onmessage = (e) => {
          if (e.data?.type === 'LANE_MODE_CHANGED') {
            handleModeChange();
          }
        };
      } catch (_) {}
    }

    if (socket) {
      socket.on('gate:lane_mode_changed', handleModeChange);
    }

    return () => {
      if (channel) channel.close();
      if (socket) socket.off('gate:lane_mode_changed', handleModeChange);
    };
  }, [socket]);

  // Lắng nghe luồng ảnh trực tiếp từ đúng trạm camera của Staff qua Socket
  // Ghép nối 1:1 chính xác theo targetGate ('EXIT_1' hoặc 'ENTRY_1')
  const remoteFrameRef = useRef(null);
  useEffect(() => {
    if (!socket) return;
    const normTargetGate = String(targetGate || 'EXIT_1').toUpperCase();
    const handleRemoteFrame = (data) => {
      const dataGate = String(data?.gate || '').toUpperCase();
      const isMatchingGate = dataGate === normTargetGate;
      const isFallbackLane = !dataGate && (
        normTargetGate === 'ENTRY_1' ? data?.lane === 'entry' : data?.lane === 'exit'
      );

      if ((isMatchingGate || isFallbackLane) && data?.frameBase64) {
        setRemoteFrame(data.frameBase64);
        remoteFrameRef.current = data.frameBase64;
        setStreamError(false);
      }
    };
    socket.on('gate:live_frame', handleRemoteFrame);
    return () => socket.off('gate:live_frame', handleRemoteFrame);
  }, [socket, targetGate]);

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
          if (!remoteFrameRef.current) {
            console.warn('KioskOut camera constraint fallback:', err?.message || err);
          }
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
    // 1. Broadcast to staff tabs in real-time via BroadcastChannel (0ms delay)
    try {
      const ch = new BroadcastChannel('valo_gate_channel');
      ch.postMessage({
        type: 'VEHICLE_DETECTED',
        payload: {
          gate: targetGate || 'EXIT_1',
          mode: cameraLane,
          licensePlate: plate,
          exitImageBase64: imageBase64,
          vehicleModelInfo: 'Vehicle at Exit Gate',
          timestamp: Date.now(),
        },
      });
      ch.close();
    } catch (_) { }

    // 2. Notify backend IoT
    fetch(`${API_BASE}/iot/vehicle-detected`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gate: targetGate || 'EXIT_1',
        mode: 'exit',
        licensePlate: plate,
        exitImageBase64: imageBase64,
        vehicleModelInfo: 'Vehicle at Exit Gate',
      }),
    }).catch(() => { });

    try {
      const res = await fetch(`${API_BASE}/sessions/kiosk-exit-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gate: targetGate || 'EXIT_1',
          licensePlate: plate,
          detectedPlate: plate,
          exitImageBase64: imageBase64,
        })
      });
      const data = await res.json();
      if (data.success) {
        setErrorMessage('');
        setAlarmState(false);
        try {
          const ch = new BroadcastChannel('valo_gate_channel');
          ch.postMessage({
            type: 'VEHICLE_DETECTED',
            payload: {
              gate: targetGate || 'EXIT_1',
              mode: 'exit',
              licensePlate: plate,
              hasSession: true,
              vehicleModelInfo: data.data?.session?.vehicle?.model || 'Vehicle at Exit Gate',
              registeredOwnerName: data.data?.session?.user?.fullName || data.data?.session?.vehicle?.ownerName || 'Valued Customer',
              phone: data.data?.session?.user?.phone || data.data?.session?.vehicle?.ownerPhone || null,
              amountToPay: data.data?.amountToPay || 0,
              parkingDuration: data.data?.parkingDuration || '1 hrs',
              exitImageBase64: imageBase64,
              timestamp: Date.now(),
            },
          });
          ch.close();
        } catch (_) { }
        onScanSuccess(data.data, imageBase64);
      } else {
        lastErrorPlateAtRef.current = { plate, at: Date.now() };
        setAlarmState(Boolean(data.alarm));
        let errText = `No active parking session found for plate ${plate}.`;
        if (data.alarmReason === 'already_checked_out') {
          errText = `Vehicle with plate ${plate} has already checked out.`;
        } else if (data.code === 'EXIT_PLATE_UNREADABLE') {
          errText = 'Unable to read license plate clearly. Please position the plate inside the frame.';
        } else if (data.code === 'EXIT_PLATE_MISMATCH') {
          errText = `Exit plate does not match active parking session for ${plate}.`;
        } else if (res.status === 404) {
          errText = `No active parking session found for plate ${plate}.`;
        } else {
          errText = `Unable to verify parking session for plate ${plate}.`;
        }
        setErrorMessage(errText);
        try {
          const ch = new BroadcastChannel('valo_gate_channel');
          ch.postMessage({
            type: 'VEHICLE_DETECTED',
            payload: {
              gate: targetGate || 'EXIT_1',
              mode: 'exit',
              licensePlate: plate,
              hasSession: false,
              errorMessage: errText,
              exitImageBase64: imageBase64,
              timestamp: Date.now(),
            },
          });
          ch.close();
        } catch (_) { }
        console.warn(data.message);
      }
    } catch (err) {
      console.error("API error", err);
      lastErrorPlateAtRef.current = { plate, at: Date.now() };
      setErrorMessage('System error while verifying license plate.');
    }
  };

  const captureFrameBase64 = () => {
    return captureVideoLaneBase64(videoRef.current, canvasRef.current, cameraLane, cameraConfigRef.current);
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
  const scanStartedAtRef = useRef(0);

  const triggerScan = () => {
    isScanningRef.current = false;
    setIsScanning(false);
    lastAiScanAtRef.current = 0;
    lastScannedPlateRef.current = null;
    lastErrorPlateAtRef.current = { plate: null, at: 0 };
    setErrorMessage('');
  };

  // Camera Scanning Loop (Tự động quét thông minh từ luồng camera C270 của PC hoặc Camera local)
  useEffect(() => {
    let interval;
    let consecutiveEmptyFrames = 0;

    interval = setInterval(async () => {
      if (isScanningRef.current) {
        if (Date.now() - scanStartedAtRef.current > 11000) {
          console.warn('[KioskOut] Scan watchdog: releasing stuck scan lock after 11s');
          isScanningRef.current = false;
          setIsScanning(false);
        } else {
          return;
        }
      }
      if (qrScanningRef.current || showQrModal) return;

      const currentRemoteFrame = remoteFrameRef.current;
      const video = videoRef.current;
      const hasLocalVideo = !streamError && video && video.readyState === video.HAVE_ENOUGH_DATA;

      // Nếu không có cả ảnh từ PC lẫn camera local thì bỏ qua
      if (!currentRemoteFrame && !hasLocalVideo) return;

      const now = Date.now();
      const heartbeatDue = now - lastAiScanAtRef.current >= 1500; // Mỗi 1.5 giây quét AI
      if (!heartbeatDue) return;

      lastAiScanAtRef.current = now;
      scanStartedAtRef.current = now;
      isScanningRef.current = true;
      setIsScanning(true);

      try {
        let result = null;
        // 1. Ưu tiên quét trực tiếp trên frame live truyền từ webcam C270 của PC
        // (Backend ai_service /scan đã tự động thử cả góc 0° và 180°, không cần gọi lại lần 2)
        if (currentRemoteFrame) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            const response = await fetch(`${API_BASE}/ai/scan-plate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image: currentRemoteFrame, lane: cameraLane, gate: targetGate || 'EXIT_1' }),
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            const data = await response.json();
            const detectedPlate = data.plate || data.licensePlate || data.data?.licensePlate || data.data?.plate;
            const normalized = normalizeLicensePlate(detectedPlate);
            if (response.ok && data.success && isLikelyVietnamesePlate(normalized)) {
              result = { plate: normalized, imageBase64: currentRemoteFrame };
            }
          } catch (e) {
            if (e?.name !== 'AbortError') {
              console.warn('[KioskOut] AI scan on remote frame error:', e?.message);
            }
          }
        }

        // 2. Nếu không có remote frame thì fallback quét camera local
        if (!result && hasLocalVideo) {
          result = await captureAndAnalyze();
        }

        if (result && result.plate) {
          const cleaned = result.plate.replace(/[^A-Z0-9]/g, '');
          const formatted = formatVietnamesePlate(cleaned) || cleaned;

          if (formatted) {
            consecutiveEmptyFrames = 0;
            setRecognizedText(formatted);
            const recentlyFailedSamePlate =
              lastErrorPlateAtRef.current.plate === formatted &&
              Date.now() - lastErrorPlateAtRef.current.at < 2000;
            const recentlyScanned =
              lastScannedPlateRef.current?.plate === formatted &&
              Date.now() - (lastScannedPlateRef.current?.at || 0) < 3000;
            if (!recentlyScanned && !recentlyFailedSamePlate) {
              lastScannedPlateRef.current = { plate: formatted, at: Date.now() };
              await handlePlateDetected(formatted, result.imageBase64);
            }
          }
        } else {
          consecutiveEmptyFrames += 1;
          if (consecutiveEmptyFrames >= 3) {
            try {
              const ch = new BroadcastChannel('valo_gate_channel');
              ch.postMessage({
                type: 'VEHICLE_CLEARED',
                gate: targetGate || 'EXIT_1',
                reason: 'NO_VEHICLE_DETECTED',
              });
              ch.close();
            } catch (_) { }

            fetch(`${API_BASE}/iot/vehicle-detected`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ gate: targetGate || 'EXIT_1', cleared: true, reason: 'NO_VEHICLE_DETECTED' }),
            }).catch(() => { });

            lastScannedPlateRef.current = null;
            lastErrorPlateAtRef.current = { plate: null, at: 0 };
            setRecognizedText('');
            setErrorMessage('');
            setAlarmState(false);
          }
        }
      } catch (err) {
        console.error("KioskOut OCR Loop Error:", err);
      } finally {
        isScanningRef.current = false;
        setIsScanning(false);
      }
    }, 1000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoScanEnabled, streamError, targetGate, cameraLane, showQrModal]);

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
              {remoteFrame ? (
                <div className="relative w-full h-full">
                  <img
                    src={remoteFrame}
                    alt="Exit Lane Live Feed"
                    className="w-full h-full object-cover brightness-[1.04] contrast-[1.03]"
                  />
                  {/* Minimal Top HUD */}
                  <div className="pointer-events-none absolute top-4 left-4 right-4 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 rounded-full bg-slate-950/60 backdrop-blur-md border border-white/25 px-4 py-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
                      <span className="text-[11px] font-bold tracking-[0.18em] text-white uppercase">
                        Station Live (C270)
                      </span>
                    </div>
                    <div className="rounded-full bg-slate-950/60 backdrop-blur-md border border-white/20 px-3.5 py-1.5">
                      <span className="text-[11px] font-mono font-bold tracking-widest uppercase text-emerald-400">
                        AI Active
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
                </div>
              ) : streamError ? (
                <div className="flex flex-col items-center justify-center text-amber-200 p-6 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-400/20 border border-amber-300/40 text-amber-300 mb-4 animate-pulse">
                    <ScanLine size={36} />
                  </div>
                  <p className="font-bold text-xl text-white">Station Camera Active</p>
                  <p className="text-sm text-slate-300 mt-2 max-w-sm">
                    Station camera is scanning from the lane. Please drive to the exit barrier to check out.
                  </p>
                  <div className="mt-4 flex items-center gap-2 rounded-full bg-emerald-500/20 border border-emerald-400/40 px-3.5 py-1 text-xs text-emerald-300 font-semibold">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>Connected to Gate System</span>
                  </div>
                </div>
              ) : (
                <>
                  <LaneCameraPreview
                    videoRef={videoRef}
                    lane={cameraLane}
                    cameraConfig={cameraConfig}
                    active={!streamError}
                    className="w-full h-full object-cover brightness-[1.04] contrast-[1.03]"
                  />

                  {/* Minimal Top HUD */}
                  <div className="pointer-events-none absolute top-4 left-4 right-4 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 rounded-full bg-slate-950/60 backdrop-blur-md border border-white/25 px-4 py-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
                      <span className="text-[11px] font-bold tracking-[0.18em] text-white uppercase">
                        {cameraLane === 'entry' ? 'Entry Gate Live' : 'Exit Gate Live'}
                      </span>
                    </div>
                    <div className="rounded-full bg-slate-950/60 backdrop-blur-md border border-white/20 px-3.5 py-1.5">
                      <span className="text-[11px] font-mono font-bold tracking-widest uppercase text-emerald-400">
                        AI Active
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
          <div
            onClick={triggerScan}
            className="w-full rounded-[28px] p-[1.5px] bg-gradient-to-b from-white/30 to-white/10 mb-5 shadow-[0_24px_60px_rgba(15,23,42,0.55)] cursor-pointer active:scale-[0.99] transition hover:from-amber-400/50 hover:to-white/20"
            title="Click to scan license plate"
          >
            <div className="rounded-[27px] bg-white/[0.08] backdrop-blur-2xl p-7 space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300/30 to-amber-400/10 border border-amber-300/45 text-amber-300 shadow-[0_0_24px_rgba(250,204,21,0.18)]">
                    {isScanning ? <Loader2 size={26} className="animate-spin text-amber-300" /> : <ScanLine size={26} />}
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-300">
                      AI Plate Reader
                    </p>
                    <p className="text-lg font-bold text-white mt-0.5">
                      {isScanning ? 'Scanning Plate...' : (recognizedText ? `Scanned: ${recognizedText}` : 'Waiting for vehicle...')}
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
                <span className="text-sm font-medium text-slate-200">Or check out with Parking Ticket / QR</span>
                <div className="inline-flex items-center gap-2 rounded-xl bg-amber-400/15 border border-amber-300/40 px-4 py-2 text-sm font-bold tracking-wide text-amber-300 shadow-sm">
                  <QrCode size={18} className="text-amber-400" />
                  <span>Scan QR on Reader</span>
                </div>
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
