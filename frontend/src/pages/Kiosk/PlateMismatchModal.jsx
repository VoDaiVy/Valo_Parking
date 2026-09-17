import React, { useState, useEffect } from 'react';
import { ShieldAlert, RefreshCw, Camera } from 'lucide-react';
import { formatLicensePlateDisplay } from '../../utils/licensePlate';

export default function PlateMismatchModal({
  isOpen,
  onClose,
  qrPlate = '',
  detectedPlate = '',
  entryImageBase64 = null,
}) {
  const [timeLeft, setTimeLeft] = useState(15);

  useEffect(() => {
    if (!isOpen) {
      setTimeLeft(15);
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isNoPlate = !detectedPlate;
  const formattedQrPlate = formatLicensePlateDisplay(qrPlate);
  const formattedDetectedPlate = formatLicensePlateDisplay(detectedPlate);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 font-sans">
      <div className="bg-[#11141b] border-2 border-red-500/40 shadow-[0_30px_90px_rgba(239,68,68,0.35)] rounded-[28px] p-8 max-w-xl w-full text-center transform scale-100 animate-in zoom-in-95 duration-200 relative overflow-hidden">
        
        {/* Glow Top Bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-600 via-amber-500 to-red-600" />

        {/* Pulsing Shield Icon */}
        <div className="w-18 h-18 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4 relative border border-red-500/40 shadow-[0_0_30px_rgba(239,68,68,0.35)]">
          <ShieldAlert size={40} className="text-red-500 animate-bounce" strokeWidth={2.5} />
          <svg className="absolute inset-0 w-full h-full -rotate-90 text-red-500/20" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="4" />
            <circle
              cx="50"
              cy="50"
              r="48"
              fill="none"
              stroke="#ef4444"
              strokeWidth="4"
              strokeDasharray="301.59"
              strokeDashoffset={301.59 * (1 - timeLeft / 15)}
              className="transition-all duration-1000 ease-linear"
            />
          </svg>
        </div>

        {/* Title */}
        <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-6 uppercase">
          {isNoPlate ? 'NO VEHICLE DETECTED' : 'LICENSE PLATE MISMATCH'}
        </h2>

        {/* Side-by-Side Comparison Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-5 text-left">
          {/* Registered Vehicle Plate */}
          <div className="bg-[#181d28] border border-amber-500/30 rounded-2xl p-4 flex flex-col justify-between shadow-inner">
            <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider mb-2">
              Registered Vehicle Plate
            </span>
            <div className="text-2xl font-black font-mono text-white tracking-wide bg-black/60 px-3 py-2.5 rounded-xl border border-white/10 text-center shadow-sm">
              {formattedQrPlate || 'N/A'}
            </div>
            <span className="text-[10px] text-gray-400 mt-2 text-center">
              Booking / VIP Pass
            </span>
          </div>

          {/* Camera Detected Plate */}
          <div className="bg-[#181d28] border border-red-500/40 rounded-2xl p-4 flex flex-col justify-between shadow-inner">
            <span className="text-[11px] font-bold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Camera size={13} />
              <span>Camera Detected Plate</span>
            </span>
            <div className="text-2xl font-black font-mono text-red-400 tracking-wide bg-black/60 px-3 py-2.5 rounded-xl border border-red-500/30 text-center shadow-sm">
              {formattedDetectedPlate || 'NOT DETECTED'}
            </div>
            <span className="text-[10px] text-red-300/70 mt-2 text-center">
              Live Entry Gate Camera
            </span>
          </div>
        </div>

        {/* Camera Snapshot Preview */}
        {entryImageBase64 && (
          <div className="mb-5 rounded-2xl overflow-hidden border border-white/10 max-h-32 relative bg-black/50 shadow-inner">
            <img
              src={entryImageBase64}
              alt="Gate Snapshot"
              className="w-full h-32 object-cover object-center opacity-85"
            />
            <div className="absolute bottom-2 left-2 bg-black/75 backdrop-blur-sm px-2.5 py-1 rounded-md text-[10px] text-gray-200 font-mono flex items-center gap-1 border border-white/10">
              <Camera size={11} className="text-amber-400" />
              <span>Gate Snapshot</span>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/10">
          <div className="text-gray-400 text-xs font-medium">
            Auto closing in <span className="text-red-400 font-bold font-mono text-sm">{timeLeft}s</span>
          </div>
          <button
            onClick={onClose}
            className="flex items-center gap-2 bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white font-bold text-sm px-6 py-2.5 rounded-full transition-all shadow-[0_4px_15px_rgba(239,68,68,0.4)] active:scale-95 cursor-pointer"
          >
            <RefreshCw size={15} />
            <span>Retry Scan</span>
          </button>
        </div>

      </div>
    </div>
  );
}

