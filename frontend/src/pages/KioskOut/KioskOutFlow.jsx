import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import KioskOutWelcome from './KioskOutWelcome';
import KioskOutInvoice from './KioskOutInvoice';
import KioskOutSuccess from './KioskOutSuccess';
import { API_BASE } from '../../services/api';
import { useSocket } from '../../hooks/useSocket';

const LazyKioskFlow = lazy(() => import('../Kiosk/KioskFlow'));

const PENDING_CHECKOUT_KEY = 'valo-kiosk-out-pending-checkout';

const readPendingCheckout = () => {
  try {
    const value = sessionStorage.getItem(PENDING_CHECKOUT_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

function KioskExitFlowInner({ assignedGate, basePath, isTidalReversed }) {
  const navigate = useNavigate();
  const socket = useSocket();
  const [sessionData, setSessionData] = useState(readPendingCheckout);
  const [exitImage, setExitImage] = useState(null);

  // Lắng nghe tín hiệu đồng bộ hóa đơn/quét xe từ Staff Gate Control (PC cắm Camera)
  useEffect(() => {
    const handleSyncedExit = (payload) => {
      const { gate = 'EXIT_1', invoiceData, exitImageBase64 = null } = payload || {};
      if (assignedGate && String(gate).toUpperCase() !== String(assignedGate).toUpperCase()) return;
      if (!invoiceData) return;

      setSessionData(invoiceData);
      setExitImage(exitImageBase64);
      navigate(`${basePath}/invoice`);
    };

    let channel = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel('valo_kiosk_exit_sync');
        channel.onmessage = (event) => {
          if (event.data) handleSyncedExit(event.data);
        };
      } catch {
        // Fallback to socket only
      }
    }

    if (socket) {
      socket.on('kiosk:exit_plate_synced', handleSyncedExit);
    }

    return () => {
      if (channel) channel.close();
      if (socket) {
        socket.off('kiosk:exit_plate_synced', handleSyncedExit);
      }
    };
  }, [socket, assignedGate, basePath, navigate]);

  useEffect(() => {
    if (sessionData) {
      sessionStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(sessionData));
    } else {
      sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
    }
  }, [sessionData]);

  const handleScanSuccess = (data, imageBase64) => {
    setSessionData(data);
    setExitImage(imageBase64);
    navigate(`${basePath}/invoice`);
  };

  const handleCheckoutSuccess = () => {
    navigate(`${basePath}/success`);
  };

  const handleRestart = () => {
    setSessionData(null);
    setExitImage(null);
    sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
    navigate(basePath);
  };

  return (
    <div className="w-screen h-[100dvh] overflow-hidden bg-[#0a0a0a] text-white selection:bg-gold/30 relative">
      <Routes>
        <Route
          index
          element={<KioskOutWelcome onScanSuccess={handleScanSuccess} targetGate={assignedGate} />}
        />
        <Route
          path="invoice"
          element={
            <KioskOutInvoice
              sessionData={sessionData}
              exitImage={exitImage}
              targetGate={assignedGate}
              onCheckoutSuccess={handleCheckoutSuccess}
              onBack={handleRestart}
            />
          }
        />
        <Route
          path="success"
          element={<KioskOutSuccess targetGate={assignedGate} basePath={basePath} onFinish={handleRestart} />}
        />
      </Routes>
    </div>
  );
}

export default function KioskOutFlow({ assignedGate = 'EXIT_1', basePath = '/kiosk-out', isTidalReversed = false }) {
  const socket = useSocket();
  const [laneMode, setLaneMode] = useState('STANDARD');

  // Lắng nghe chế độ làn (Tidal Flow) nếu đây là Kiosk gốc
  useEffect(() => {
    if (isTidalReversed) return;

    fetch(`${API_BASE}/iot/lane-mode`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.mode) setLaneMode(data.mode);
      })
      .catch(() => {});

    if (!socket) return;
    const handleLaneModeChanged = (data) => {
      if (data?.mode) {
        setLaneMode(data.mode);
      }
    };
    socket.on('gate:lane_mode_changed', handleLaneModeChanged);
    return () => socket.off('gate:lane_mode_changed', handleLaneModeChanged);
  }, [socket, isTidalReversed]);

  // Nếu bãi xe đang ở chế độ Cao điểm Vào (PEAK_ENTRY) và màn hình này là Cột bên Trái:
  // Tự động chuyển luồng hiển thị sang Kiosk Vào nhưng gắn chặt với Barrier Trái (assignedGate)
  if (!isTidalReversed && laneMode === 'PEAK_ENTRY') {
    return (
      <Suspense fallback={<div className="w-screen h-screen bg-[#0a0a0a] flex items-center justify-center text-white">Loading Tidal Flow...</div>}>
        <LazyKioskFlow
          assignedGate={assignedGate}
          basePath={basePath}
          isTidalReversed={true}
        />
      </Suspense>
    );
  }

  return <KioskExitFlowInner assignedGate={assignedGate} basePath={basePath} isTidalReversed={isTidalReversed} />;
}
