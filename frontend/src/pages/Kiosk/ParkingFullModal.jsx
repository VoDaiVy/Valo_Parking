import { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';

export default function ParkingFullModal({ isOpen, onClose, title = "PARKING FULL", message = "We apologize, but the parking lot is currently full. Please come back again later!" }) {
  const [timeLeft, setTimeLeft] = useState(20);

  useEffect(() => {
    if (!isOpen) {
      const resetTimer = window.setTimeout(() => setTimeLeft(20), 0);
      return () => window.clearTimeout(resetTimer);
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

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#181c23] border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.4)] rounded-3xl p-10 max-w-lg w-full text-center transform scale-100 animate-in zoom-in-95 duration-200">
        <div className="w-24 h-24 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-8 relative">
          <AlertCircle size={52} className="text-red-500 animate-pulse" strokeWidth={2.5} />
          {/* Circular progress ring around the icon */}
          <svg className="absolute inset-0 w-full h-full -rotate-90 text-red-500/30" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="4" />
            <circle cx="50" cy="50" r="48" fill="none" stroke="#ef4444" strokeWidth="4"
              strokeDasharray="301.59"
              strokeDashoffset={301.59 * (1 - timeLeft / 20)}
              className="transition-all duration-1000 ease-linear"
            />
          </svg>
        </div>

        <h2 className="text-4xl font-black text-white tracking-tight mb-5 uppercase">
          {title}
        </h2>

        <p className="text-gray-300 text-xl leading-relaxed mb-8 font-medium">
          {message}
        </p>

        <div className="bg-white/5 rounded-2xl py-4 px-6 border border-white/10 text-gray-400 font-medium text-lg">
          Close in <span className="text-cyan-400 font-bold">{timeLeft}s</span>...
        </div>
      </div>
    </div>
  );
}
