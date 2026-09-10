import { useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { API_BASE } from '../../services/api';
import KioskOutWelcome from './KioskOutWelcome';
import KioskOutInvoice from './KioskOutInvoice';
import KioskOutSuccess from './KioskOutSuccess';

export default function KioskOutFlow() {
  const navigate = useNavigate();
  const [sessionData, setSessionData] = useState(null);
  const [exitImage, setExitImage] = useState(null);

  const handleScanSuccess = (data, imageBase64) => {
    setSessionData(data);
    setExitImage(imageBase64);
    navigate('/kiosk-out/invoice');
  };

  const handleCheckoutSuccess = () => {
    navigate('/kiosk-out/success');
  };

  const handleRestart = () => {
    fetch(`${API_BASE}/iot/close-barrier`, { method: 'POST' }).catch(() => null);
    setSessionData(null);
    setExitImage(null);
    navigate('/kiosk-out');
  };

  return (
    <div className="w-screen h-[100dvh] overflow-hidden bg-[#0a0a0a] text-white selection:bg-gold/30">
      <Routes>
        <Route
          path="/"
          element={<KioskOutWelcome onScanSuccess={handleScanSuccess} />}
        />
        <Route
          path="invoice"
          element={
            <KioskOutInvoice
              sessionData={sessionData}
              exitImage={exitImage}
              onCheckoutSuccess={handleCheckoutSuccess}
              onBack={handleRestart}
            />
          }
        />
        <Route
          path="success"
          element={<KioskOutSuccess onFinish={handleRestart} />}
        />
      </Routes>
    </div>
  );
}
