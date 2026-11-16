import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import KioskOutWelcome from './KioskOutWelcome';
import KioskOutInvoice from './KioskOutInvoice';
import KioskOutSuccess from './KioskOutSuccess';

const PENDING_CHECKOUT_KEY = 'valo-kiosk-out-pending-checkout';

const readPendingCheckout = () => {
  try {
    const value = sessionStorage.getItem(PENDING_CHECKOUT_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

export default function KioskOutFlow() {
  const navigate = useNavigate();
  const [sessionData, setSessionData] = useState(readPendingCheckout);
  const [exitImage, setExitImage] = useState(null);

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
    navigate('/kiosk-out/invoice');
  };

  const handleCheckoutSuccess = () => {
    navigate('/kiosk-out/success');
  };

  const handleRestart = () => {
    setSessionData(null);
    setExitImage(null);
    sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
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
