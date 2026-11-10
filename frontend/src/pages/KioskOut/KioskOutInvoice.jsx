import { useCallback, useState, useEffect, useRef } from 'react';
import { Camera, Clock, ChevronRight, AlertTriangle, Wallet, Image as ImageIcon } from 'lucide-react';
import { QRCodeSVG as QRCode } from 'qrcode.react';
import { API_BASE } from '../../services/api';

export default function KioskOutInvoice({ sessionData, exitImage, onCheckoutSuccess, onBack }) {
  const processingRef = useRef(false);
  const completedRef = useRef(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const [isEarlyExitModalOpen, setIsEarlyExitModalOpen] = useState(false);
  const [paymentData, setPaymentData] = useState(null);
  const [keepPausedChoice, setKeepPausedChoice] = useState(false);

  const handleCheckout = useCallback(async (paymentMethod, keepPaused = false, checkoutAttemptId = null) => {
    if (processingRef.current || completedRef.current) return;
    processingRef.current = true;
    setCheckoutError('');
    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE}/sessions/kiosk-checkout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Kiosk-Gate': 'EXIT_1' },
        body: JSON.stringify({
          qrPayload: sessionData?.qrPayload,
          licensePlate: sessionData?.observedLicensePlate || sessionData?.session?.licensePlate,
          checkoutAttemptId,
          sessionId: sessionData?.session?._id,
          exitImageBase64: exitImage,
          paymentMethod,
          keepPaused
        })
      });
      const data = await res.json();
      if (data.success) {
        if (data.requiresPayment) {
          setPaymentData(data.data);
          setIsProcessing(false);
        } else {
          completedRef.current = true;
          onCheckoutSuccess();
        }
      } else {
        setCheckoutError(data.message || 'Checkout could not be completed.');
        setIsProcessing(false);
      }
    } catch (err) {
      setCheckoutError(err.message || 'Unable to complete checkout. Retry when connected.');
      setIsProcessing(false);
    } finally { processingRef.current = false; }
  }, [exitImage, onCheckoutSuccess, sessionData]);

  useEffect(() => {
    const timerIds = [];
    if (sessionData && sessionData.isEarlyExit) {
      timerIds.push(setTimeout(() => setIsEarlyExitModalOpen(true), 0));
    }
    // If AutoPay is allowed AND it's not an early exit, auto-trigger checkout
    if (sessionData && sessionData.canAutoPay && !sessionData.isEarlyExit) {
      const timerId = setTimeout(() => handleCheckout('wallet', false), 0);
      timerIds.push(timerId);
    } else if (sessionData && !sessionData.canAutoPay && sessionData.totalPrice > 0 && !sessionData.isEarlyExit) {
      const timerId = setTimeout(() => handleCheckout('vietqr', false), 0);
      timerIds.push(timerId);
    }

    return () => timerIds.forEach((timerId) => clearTimeout(timerId));
  }, [handleCheckout, sessionData]);

  // Polling for PayOS payment status
  useEffect(() => {
    let intervalId;
    if (paymentData && paymentData.orderCode) {
      intervalId = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/sessions/check-payos/${paymentData.orderCode}?checkoutAttemptId=${encodeURIComponent(paymentData.checkoutAttemptId || '')}`, { credentials: 'include', headers: { 'X-Kiosk-Gate': 'EXIT_1' } });
          const data = await res.json();
          if (data.success && data.isPaid) {
            handleCheckout('qr', keepPausedChoice, paymentData.checkoutAttemptId); // Call handleCheckout to complete the session
          }
        } catch (err) {
          console.error('Error polling payment status:', err);
        }
      }, 3000); // Check every 3 seconds
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [paymentData, handleCheckout, keepPausedChoice]);

  if (!sessionData) {
    return (
      <div className="flex items-center justify-center h-full">
        <p>No session data</p>
      </div>
    );
  }

  const { session, durationHours, expectedHours, totalPrice, walletBalance, canAutoPay, isEarlyExit, remainingHours, bookingEnd, isSubscriptionExpired } = sessionData;

  // If AutoPay AND NOT early exit, show a loading screen while it processes
  if (canAutoPay && !isEarlyExit && !checkoutError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-black">
        <div className="w-20 h-20 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mb-8" />
        <h2 className="text-3xl font-bold text-yellow-400 mb-2">
          {totalPrice > 0 ? 'Processing Auto-Pay (ETC)...' : 'Exit Authorized...'}
        </h2>
        <p className="text-gray-400">
          {totalPrice > 0
            ? 'Please wait while we verify your wallet and open the barrier.'
            : 'Your booking or membership is valid. The barrier is being opened now.'}
        </p>
      </div>
    );
  }

  // Format currency
  const formatVND = (amount) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

  return (
    <div className="w-full h-full flex flex-col md:flex-row bg-[#0D0D0D]">
      
      {/* LEFT: Dual Screen Camera View */}
      <div className="flex-1 bg-black flex flex-col border-r border-white/10">
        <div className="p-6 bg-gradient-to-b from-black to-transparent">
          <h2 className="text-2xl font-black text-white tracking-widest flex items-center gap-3">
            <Camera className="text-yellow-400" /> CAMERA VERIFICATION
          </h2>
        </div>
        
        <div className="flex-1 p-6 flex flex-col justify-center gap-6">
          <div className="bg-[#111] border border-white/5 rounded-2xl overflow-hidden relative group">
            <div className="absolute top-0 left-0 bg-yellow-500 text-black font-bold px-3 py-1 text-xs rounded-br-lg z-10">ENTRY CAMERA</div>
            {session.entryImage_url ? (
              <img src={session.entryImage_url} alt="Entry" className="w-full h-[30vh] object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
            ) : (
              <div className="w-full h-[30vh] flex items-center justify-center text-gray-600"><ImageIcon size={48} /></div>
            )}
          </div>

          <div className="bg-[#111] border border-white/5 rounded-2xl overflow-hidden relative group">
            <div className="absolute top-0 left-0 bg-yellow-500 text-black font-bold px-3 py-1 text-xs rounded-br-lg z-10">EXIT CAMERA (LIVE)</div>
            {exitImage ? (
              <img src={exitImage} alt="Exit" className="w-full h-[30vh] object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
            ) : (
              <div className="w-full h-[30vh] flex items-center justify-center text-gray-600"><ImageIcon size={48} /></div>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT: Invoice & Payment */}
      <div className="w-full md:w-[450px] bg-[#111] flex flex-col">
        <div className="p-8 flex-1 overflow-y-auto">
          <h2 className="text-3xl font-black text-white mb-2">CHECKOUT</h2>
          <p className="text-gray-400 text-sm mb-8">Please review your parking details and complete payment.</p>

          <div className="bg-[#1A1A1A] rounded-2xl border border-white/5 p-6 mb-6">
            <div className="flex justify-between items-center mb-6 border-b border-white/5 pb-6">
              <div>
                <p className="text-xs text-gray-500 font-semibold tracking-wider mb-1">LICENSE PLATE</p>
                <p className="text-2xl font-black text-yellow-400 tracking-wider">{session.licensePlate}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500 font-semibold tracking-wider mb-1">SLOT</p>
                <p className="text-xl font-bold text-white">{session.parkingSlot || 'N/A'}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400 flex items-center gap-2"><Clock size={16}/> Expected Duration</span>
                <span className="font-bold">{expectedHours} hrs</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400 flex items-center gap-2"><Clock size={16}/> Actual Duration</span>
                <span className={`font-bold ${durationHours > expectedHours ? 'text-red-400' : 'text-white'}`}>{durationHours} hrs</span>
              </div>
              
              {durationHours > expectedHours && !isEarlyExit && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mt-2 flex items-start gap-3">
                  <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={16} />
                  <div>
                    <p className="text-red-400 font-semibold text-xs">OVERTIME PENALTY</p>
                    <p className="text-gray-300 text-xs mt-1">You exceeded your booked time by {durationHours - expectedHours} hours. A 30% penalty rate is applied to the extra hours.</p>
                  </div>
                </div>
              )}

              {isSubscriptionExpired && (
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 mt-2 flex items-start gap-3">
                  <AlertTriangle className="text-orange-400 shrink-0 mt-0.5" size={16} />
                  <div>
                    <p className="text-orange-400 font-semibold text-xs">SUBSCRIPTION EXPIRED</p>
                    <p className="text-gray-300 text-xs mt-1">Your subscription has expired. This session is charged as a standard hourly ticket.</p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 pt-6 border-t border-white/5 flex justify-between items-end">
              <span className="text-gray-400 text-sm font-semibold">TOTAL AMOUNT</span>
              <span className="text-4xl font-black text-yellow-400">{formatVND(totalPrice)}</span>
            </div>
          </div>

          {/* Wallet Status Box (If User) */}
          {session.userId && session.type !== 'WALK_IN' && (
            <div className="bg-blue-900/20 border border-blue-500/20 rounded-2xl p-5 mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Wallet className="text-blue-400" />
                <div>
                  <p className="text-xs text-blue-400 font-semibold">VALO WALLET BALANCE</p>
                  <p className="text-lg font-bold text-white">{formatVND(walletBalance)}</p>
                </div>
              </div>
              {/* Wallet is insufficient based on the logic evaluated in backend */}
              <p className="text-xs text-red-400 font-semibold max-w-[120px] text-right">
                Insufficient limit. Please use QR to pay.
              </p>
            </div>
          )}

          {checkoutError ? <p role="alert" className="mb-4 text-red-400">{checkoutError}</p> : null}
          {/* QR Code Section */}
          <div className="bg-white rounded-2xl p-6 flex flex-col items-center text-black">
            <p className="font-bold text-sm mb-4">SCAN TO PAY</p>
            {paymentData ? (
              <QRCode value={paymentData.qrCode} size={160} />
            ) : (
              <div className="w-[160px] h-[160px] bg-gray-200 flex items-center justify-center text-gray-500 text-xs text-center p-4 rounded-lg">
                {isProcessing ? "Generating QR Code..." : "Please select payment method"}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-4 text-center">Use any banking app to scan and pay.</p>
          </div>
        </div>

        <div className="p-6 bg-[#0D0D0D] border-t border-white/5 flex gap-4 shrink-0">
          <button 
            onClick={onBack}
            className="px-6 py-4 rounded-xl border border-white/10 text-white font-bold hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          {paymentData ? (
            <button 
              disabled={true}
              className="flex-1 bg-green-500/50 text-white font-black text-lg py-4 rounded-xl flex items-center justify-center gap-2 transition-colors cursor-wait"
            >
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Waiting for payment...
            </button>
          ) : (
            <button 
              onClick={() => handleCheckout('vietqr', keepPausedChoice)}
              disabled={isProcessing || (sessionData?.canAutoPay && !isEarlyExit)}
              className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black font-black text-lg py-4 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {isProcessing ? 'Processing...' : 'GENERATE QR'} <ChevronRight />
            </button>
          )}
        </div>
      </div>
      {/* Early Exit Modal */}
      {isEarlyExitModalOpen && isEarlyExit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#1A1A1A] border border-white/10 p-8 rounded-3xl max-w-[550px] w-[90%] flex flex-col items-center text-center shadow-2xl">
            <div className="w-16 h-16 bg-yellow-500/20 text-yellow-400 flex items-center justify-center rounded-full mb-6">
              <Clock size={32} />
            </div>
            
            <h2 className="text-3xl font-black text-white mb-2 uppercase tracking-wide">EARLY DEPARTURE!</h2>
            <p className="text-gray-400 mb-6 text-lg">
              You still have <strong className="text-yellow-400">{remainingHours} hours</strong> left in your Booking.<br />
              Valid until: <br />
              <strong className="text-white">{new Date(bookingEnd).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} - {new Date(bookingEnd).toLocaleDateString('vi-VN')}</strong>
            </p>

            <div className="flex flex-col gap-4 w-full">
              <button 
                onClick={() => {
                  setIsEarlyExitModalOpen(false);
                  setKeepPausedChoice(true);
                  if (canAutoPay) handleCheckout('wallet', true);
                  else handleCheckout('vietqr', true);
                }}
                disabled={isProcessing}
                className={`w-full py-4 px-6 rounded-xl font-bold text-lg text-black transition-colors bg-yellow-500 hover:bg-yellow-400`}
              >
                PAUSE (I WILL RETURN LATER)
              </button>
              
              <button 
                onClick={() => {
                  setIsEarlyExitModalOpen(false);
                  setKeepPausedChoice(false);
                  if (canAutoPay) handleCheckout('wallet', false);
                  else handleCheckout('vietqr', false);
                }}
                disabled={isProcessing}
                className={`w-full py-4 px-6 rounded-xl font-bold text-lg text-white border-2 transition-colors border-white/20 hover:bg-white/10`}
              >
                END SESSION (RETURN SLOT)
              </button>
            </div>
            {!canAutoPay && (
              <p className="mt-6 text-sm text-gray-400">
                Please close this dialog, pay via QR, and the system will process your early exit automatically.
              </p>
            )}
            
            {!canAutoPay && (
              <button onClick={() => setIsEarlyExitModalOpen(false)} className="mt-6 text-gray-400 underline hover:text-white">
                Close
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
