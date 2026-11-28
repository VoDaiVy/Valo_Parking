import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import KioskOutWelcome from './KioskOutWelcome';
import KioskOutInvoice from './KioskOutInvoice';
import KioskOutSuccess from './KioskOutSuccess';
import { useSocket } from '../../hooks/useSocket';

const getPendingCheckoutKey = (gate) => `valo-kiosk-pending-checkout-${String(gate || 'EXIT_1').toUpperCase()}`;

export default function KioskExitFlow({ assignedGate = 'EXIT_1', basePath = '/kiosk-out', isTidalReversed = false }) {
  const navigate = useNavigate();
  const socket = useSocket();
  const pendingKey = getPendingCheckoutKey(assignedGate);
  const [sessionData, setSessionData] = useState(() => {
    try {
      const value = sessionStorage.getItem(pendingKey);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  });
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
    const key = getPendingCheckoutKey(assignedGate);
    if (sessionData) {
      sessionStorage.setItem(key, JSON.stringify(sessionData));
    } else {
      sessionStorage.removeItem(key);
    }
  }, [sessionData, assignedGate]);

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
    sessionStorage.removeItem(getPendingCheckoutKey(assignedGate));
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
        <Route path="*" element={<Navigate to={basePath} replace />} />
      </Routes>
    </div>
  );
}
