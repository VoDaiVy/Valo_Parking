import { useRef, useEffect, useState } from 'react';
import { Camera, ScanLine, Car, AlertCircle } from 'lucide-react';
import { API_BASE } from '../../services/api';

export default function KioskOutWelcome({ onScanSuccess }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isScanning, setIsScanning] = useState(false);
  const isScanningRef = useRef(false);
  const [streamError, setStreamError] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [manualInput, setManualInput] = useState('');
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
        body: JSON.stringify({ licensePlate: plate })
      });
      const data = await res.json();
      if (data.success) {
        onScanSuccess(data.data, imageBase64);
      } else {
        setAlarmState(Boolean(data.alarm));
        if (data.alarmReason === 'already_checked_out') {
          setErrorMessage(`Vehicle with plate ${plate} has already checked out.`);
        } else {
          setErrorMessage(`Vehicle with plate ${plate} is not currently checked in.`);
        }
        console.warn(data.message);
      }
    } catch (err) {
      console.error("API error", err);
      setErrorMessage('System error while verifying license plate.');
    }
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

  // Fetch AI API from Backend to analyze plate
  const captureAndAnalyze = async () => {
    if (!videoRef.current) return null;
    try {
      const canvas = canvasRef.current;
      // Scale down image to 50% to prevent UI stuttering on toDataURL
      const scale = 0.5;
      canvas.width = videoRef.current.videoWidth * scale;
      canvas.height = videoRef.current.videoHeight * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const imageBase64 = canvas.toDataURL('image/jpeg', 0.6);

      const response = await fetch(`${API_BASE}/ai/scan-plate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageBase64 })
      });

      const data = await response.json();
      if (response.ok && data.success && data.plate) {
        return { plate: data.plate, imageBase64 };
      }
    } catch (error) {
      console.error('Scan error:', error);
    }
    return null;
  };

  const lastScannedPlateRef = useRef(null);

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
              const formatted = formatVietnamesePlate(cleaned) || cleaned; // Fallback to raw string if format fails
              
              if (formatted) {
                setRecognizedText(formatted);
                // Only process if it's a NEW plate to avoid spamming the backend
                if (formatted !== lastScannedPlateRef.current) {
                  lastScannedPlateRef.current = formatted;
                  handlePlateDetected(formatted, result.imageBase64);
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

  // Manual fallback for Tester
  const handleManualInputChange = (e) => {
    const raw = e.target.value.toUpperCase();
    const clean = raw.replace(/[^A-Z0-9]/g, '');
    let formatted = formatVietnamesePlate(clean);
    
    if (!formatted) {
       if (clean.length >= 3) {
          const seriesMatch = clean.substring(2).match(/^[A-Z][A-Z0-9]?/);
          if (seriesMatch) {
             const series = seriesMatch[0];
             const numbers = clean.substring(2 + series.length);
             if (numbers.length > 0) {
               formatted = `${clean.substring(0, 2)}${series}-${numbers}`;
               if (numbers.length > 3) {
                 formatted = `${clean.substring(0, 2)}${series}-${numbers.substring(0,3)}.${numbers.substring(3)}`;
               }
             } else {
               formatted = clean;
             }
          } else {
             formatted = clean;
          }
       } else {
          formatted = clean;
       }
    }
    setManualInput(formatted);
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (manualInput) {
      // Clean input and format
      const cleaned = manualInput.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const formattedPlate = formatVietnamesePlate(cleaned) || manualInput.toUpperCase(); // fallback to raw if not matching standard format

      // Capture current frame anyway
      let imageBase64 = null;
      if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        const canvas = canvasRef.current;
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        imageBase64 = canvas.toDataURL('image/jpeg', 0.8);
      }
      handlePlateDetected(formattedPlate, imageBase64);
    }
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-black overflow-hidden">

      {/* Live Camera Background */}
      {streamError ? (
        <div className="flex flex-col items-center justify-center text-red-400 z-10">
          <AlertCircle size={48} className="mb-4" />
          <p>Cannot access Camera.</p>
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover opacity-80"
        />
      )}

      {/* Hidden Canvas for OCR */}
      <canvas ref={canvasRef} className="hidden" />

      {/* AI Scanner UI Overlay */}
      <div className="z-10 flex flex-col items-center">
        <div className="mb-8 text-center">
          <h1 className="text-4xl md:text-5xl font-black text-white mb-3 tracking-wider drop-shadow-lg">
            EXIT KIOSK
          </h1>
          <p className="text-gray-300 text-lg flex items-center gap-2 drop-shadow-md">
            <Camera size={20} className="text-yellow-400" />
            Please proceed into the license plate scanning area
          </p>
        </div>

        {/* Scanner UI */}
        <div className="relative w-80 h-48 md:w-[32rem] md:h-64 rounded-3xl flex items-center justify-center overflow-hidden mb-4">
          {/* Scanning Line Animation */}
          <div className="absolute top-0 left-0 w-full h-1 bg-yellow-400 shadow-[0_0_15px_3px_rgba(250,204,21,0.6)] animate-scan" />

          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-yellow-400 rounded-tl-xl" />
          <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-yellow-400 rounded-tr-xl" />
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-yellow-400 rounded-bl-xl" />
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-yellow-400 rounded-br-xl" />

          {/* Center icon */}
          <ScanLine size={48} className={`text-yellow-400/30 ${isScanning ? 'animate-pulse' : ''}`} />
        </div>

        {/* OCR Debug Info (For demonstration) */}
        {recognizedText && (
          <p className="mt-4 text-xs font-mono text-gray-500">AI Reading: {recognizedText}</p>
        )}

        {/* Error Message for Tailgating / Invalid Sessions */}
        {errorMessage && (
          <div className={`mt-6 rounded-lg p-4 text-center animate-pulse ${
            alarmState ? 'bg-red-600/25 border border-red-500/70' : 'bg-red-500/20 border border-red-500/50'
          }`}>
            <p className="text-red-400 font-bold">{errorMessage}</p>
            <p className="text-gray-300 text-sm mt-1">
              {alarmState
                ? 'Security alert triggered. Barrier must remain closed.'
                : 'Barrier cannot open. Please contact security.'}
            </p>
          </div>
        )}
      </div>

      {/* Tester Fallback Input (Subtle) */}
      <form
        onSubmit={handleManualSubmit}
        className="absolute bottom-10 z-20 flex flex-col items-center opacity-30 hover:opacity-100 transition-opacity"
      >
        <p className="text-[10px] text-gray-400 mb-1 font-mono uppercase tracking-widest">Tester / Fallback Input</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={manualInput}
            onChange={handleManualInputChange}
            placeholder="e.g. 51H-595.65"
            className="bg-white/10 border border-white/20 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-yellow-400"
          />
          <button
            type="submit"
            className="bg-yellow-500 hover:bg-yellow-400 text-black p-2 rounded-lg transition-colors"
          >
            <Car size={20} />
          </button>
        </div>
      </form>
    </div>
  );
}
