import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { useSocket } from '../../hooks/useSocket';
import { API_BASE } from '../../services/api';

export default function KioskOutSuccess({ targetGate = 'EXIT_1', basePath = '/kiosk-out', onFinish }) {
  const navigate = useNavigate();
  const socket = useSocket();
  const mountTimeRef = useRef(0);
  const hasSeenOpenRef = useRef(false);
  const isRedirectingRef = useRef(false);

  useEffect(() => {
    mountTimeRef.current = Date.now();
    const activeGate = String(targetGate || 'EXIT_1').toUpperCase();
    const activeBasePath = basePath || '/kiosk-out';

    const handleDone = () => {
      if (isRedirectingRef.current) return;
      isRedirectingRef.current = true;
      try {
        onFinish?.();
      } catch (e) {
        console.error(e);
      } finally {
        navigate(activeBasePath, { replace: true });
      }
    };

    const processGateState = (gateData) => {
      if (!gateData || (gateData.gate && gateData.gate !== activeGate)) return;
      if (gateData.open) {
        hasSeenOpenRef.current = true;
        return;
      }
      const closedAfterMount = Boolean(gateData.forceClose)
        && Number(gateData.timestamp || 0) >= mountTimeRef.current;
      if (hasSeenOpenRef.current || closedAfterMount) {
        // Xe đi qua rồi và barrier đóng xuống (isOpen: false) -> lập tức quay về màn hình chính
        handleDone();
      }
    };

    // 1. Polling trạng thái đóng của Barrier theo cổng được gán
    const checkBarrier = async () => {
      try {
        const res = await fetch(`${API_BASE}/iot/barrier-status?gate=${activeGate}&_t=${Date.now()}`, {
          cache: 'no-store'
        });
        const data = await res.json();
        if (data.success && data.data) {
          processGateState(data.data);
        }
      } catch {
        // ignore
      }
    };

    // Initial check immediately
    checkBarrier();
    const interval = setInterval(checkBarrier, 300);

    // Bộ đếm an toàn 35s chỉ kích hoạt nếu ESP32 mất kết nối hoàn toàn
    const safetyTimer = setTimeout(() => {
      handleDone();
    }, 35000);

    // 2. Lắng nghe qua Socket.IO (chỉ nhận sự kiện của đúng cổng)
    const handleBarrierControl = (data) => {
      processGateState(data);
    };

    if (socket) {
      socket.on('gate:barrier_control', handleBarrierControl);
    }

    return () => {
      clearInterval(interval);
      clearTimeout(safetyTimer);
      if (socket) {
        socket.off('gate:barrier_control', handleBarrierControl);
      }
    };
  }, [onFinish, socket, targetGate, basePath, navigate]);

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
          Please proceed through the gate. Have a safe journey!
        </p>
      </div>
    </div>
  );
}

