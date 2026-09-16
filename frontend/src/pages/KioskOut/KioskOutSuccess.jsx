import { useEffect, useRef } from 'react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { useSocket } from '../../hooks/useSocket';
import { API_BASE } from '../../services/api';

export default function KioskOutSuccess({ onFinish }) {
  const socket = useSocket();
  const hasFinishedRef = useRef(false);

  useEffect(() => {
    let hasSeenOpen = false;

    const handleDone = () => {
      if (hasFinishedRef.current) return;
      hasFinishedRef.current = true;
      onFinish();
    };

    // 1. Polling trạng thái đóng của Barrier EXIT_1
    const checkBarrier = async () => {
      try {
        const res = await fetch(`${API_BASE}/iot/barrier-status?gate=EXIT_1`);
        const data = await res.json();
        if (data.success && data.data) {
          if (data.data.open) {
            hasSeenOpen = true;
          } else if (hasSeenOpen && !data.data.open) {
            handleDone();
          }
        }
      } catch (err) {
        // ignore
      }
    };

    const interval = setInterval(checkBarrier, 500);

    // 2. Lắng nghe qua Socket.IO (chỉ nhận sự kiện của cổng EXIT_1)
    const handleBarrierControl = (data) => {
      if (data && (data.gate === 'EXIT_1' || !data.gate)) {
        if (data.open) {
          hasSeenOpen = true;
        } else if (hasSeenOpen && !data.open) {
          handleDone();
        }
      }
    };

    if (socket) {
      socket.on('gate:barrier_control', handleBarrierControl);
    }

    return () => {
      clearInterval(interval);
      if (socket) {
        socket.off('gate:barrier_control', handleBarrierControl);
      }
    };
  }, [onFinish, socket]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-black relative overflow-hidden">
      {/* Celebration background elements */}
      <div className="absolute inset-0 bg-yellow-500/10" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-yellow-500/20 blur-[100px] rounded-full" />
      
      <div className="z-10 flex flex-col items-center animate-float">
        <div className="w-32 h-32 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center mb-8 shadow-[0_0_50px_rgba(234,179,8,0.5)]">
          <CheckCircle2 size={80} className="text-black" />
        </div>
        
        <h1 className="text-5xl font-black text-white mb-4 tracking-wider text-center drop-shadow-lg">
          PAYMENT SUCCESSFUL
        </h1>
        
        <p className="text-xl text-yellow-400 font-semibold mb-8 flex items-center gap-2">
          <ShieldCheck /> BARRIER OPEN
        </p>

        <p className="text-gray-400 text-lg">
          Vui lòng lái xe qua cổng. Chúc quý khách thượng lộ bình an!
        </p>
      </div>
    </div>
  );
}

