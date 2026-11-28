import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../../services/api';
import { useSocket } from '../../hooks/useSocket';
import KioskExitFlow from './KioskExitFlow';

const LazyKioskEntryFlow = lazy(() => import('../Kiosk/KioskEntryFlow'));

export default function KioskOutFlow({ assignedGate = 'EXIT_1', basePath = '/kiosk-out', isTidalReversed = false }) {
  const navigate = useNavigate();
  const socket = useSocket();
  const [laneMode, setLaneMode] = useState('STANDARD');
  const currentModeRef = useRef('STANDARD');

  // Lắng nghe chế độ làn (Tidal Flow) nếu đây là Kiosk gốc
  useEffect(() => {
    if (isTidalReversed) return;

    const handleModeUpdate = (newMode) => {
      if (!newMode || newMode === currentModeRef.current) return;
      currentModeRef.current = newMode;
      setLaneMode(newMode);
      setTimeout(() => {
        navigate(basePath, { replace: true });
      }, 0);
    };

    fetch(`${API_BASE}/iot/lane-mode`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.mode) handleModeUpdate(data.mode);
      })
      .catch(() => {});

    if (socket) {
      socket.on('gate:lane_mode_changed', (data) => handleModeUpdate(data?.mode));
    }

    let channel = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel('valo_gate_channel');
        channel.onmessage = (e) => {
          if (e.data?.type === 'LANE_MODE_CHANGED') {
            handleModeUpdate(e.data.mode);
          }
        };
      } catch (_) {}
    }

    return () => {
      if (socket) socket.off('gate:lane_mode_changed');
      if (channel) channel.close();
    };
  }, [socket, isTidalReversed, basePath, navigate]);

  // Nếu bãi xe đang ở chế độ Cao điểm Vào (PEAK_ENTRY) và màn hình này là Cổng Phải (EXIT_1 đảo chiều):
  // Tự động chuyển luồng hiển thị sang Kiosk Vào nhưng gắn chặt với Barrier Phải (assignedGate)
  if (!isTidalReversed && laneMode === 'PEAK_ENTRY') {
    return (
      <Suspense fallback={<div className="w-screen h-screen bg-[#0a0a0a] flex items-center justify-center text-white font-bold">Loading Tidal Flow...</div>}>
        <LazyKioskEntryFlow
          assignedGate={assignedGate}
          basePath={basePath}
          isTidalReversed={true}
        />
      </Suspense>
    );
  }

  return <KioskExitFlow assignedGate={assignedGate} basePath={basePath} isTidalReversed={isTidalReversed} />;
}
