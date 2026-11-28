import { useCallback, useState, useEffect, useRef } from 'react';
import { Camera, Clock, ChevronRight, AlertTriangle, Wallet, Image as ImageIcon, Loader2 } from 'lucide-react';
import { QRCodeSVG as QRCode } from 'qrcode.react';
import { API_BASE } from '../../services/api';
import { useSocket } from '../../hooks/useSocket';
import { formatLicensePlateDisplay } from '../../utils/licensePlate';

export default function KioskOutInvoice({ sessionData: initialSessionData, exitImage, targetGate = 'EXIT_1', onCheckoutSuccess, onBack }) {
  const socket = useSocket();
  const [sessionData, setSessionData] = useState(initialSessionData);
  useEffect(() => {
    if (initialSessionData) setSessionData(initialSessionData);
  }, [initialSessionData]);

  const processingRef = useRef(false);
  const completedRef = useRef(false);

  // Lắng nghe sự kiện Checkout hoàn tất từ Backend (khi nhân viên thu tiền mặt hoặc xác nhận tại Gate)
  useEffect(() => {
    const handleCheckoutDone = (payload) => {
      if (completedRef.current) return;
      const currentSessionId = sessionData?.session?._id;
      const currentPlate = sessionData?.observedLicensePlate || sessionData?.session?.licensePlate || sessionData?.licensePlate;

      const matchesSession = payload?.sessionId && currentSessionId && String(payload.sessionId) === String(currentSessionId);
      const matchesPlate = payload?.licensePlate && currentPlate && String(payload.licensePlate).replace(/[^A-Z0-9]/gi, '').toUpperCase() === String(currentPlate).replace(/[^A-Z0-9]/gi, '').toUpperCase();

      if (matchesSession || matchesPlate) {
        completedRef.current = true;
        onCheckoutSuccess();
      }
    };

    let channel = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel('valo_kiosk_checkout_sync');
        channel.onmessage = (event) => {
          if (event.data) handleCheckoutDone(event.data);
        };
      } catch {
        // Fallback to socket only
      }
    }

    if (socket) {
      socket.on('kiosk:checkout_completed', handleCheckoutDone);
    }

    return () => {
      if (channel) channel.close();
      if (socket) {
        socket.off('kiosk:checkout_completed', handleCheckoutDone);
      }
    };
  }, [socket, sessionData, onCheckoutSuccess]);
  const [checkoutError, setCheckoutError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const [isEarlyExitModalOpen, setIsEarlyExitModalOpen] = useState(false);
  const [earlyExitDecisionMade, setEarlyExitDecisionMade] = useState(false);
  const [paymentData, setPaymentData] = useState(null);
  const [keepPausedChoice, setKeepPausedChoice] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [liveExitFrame, setLiveExitFrame] = useState(null);

  // 15-minute payment hold timeout (900 seconds) -> Return to main welcome screen
  const PAYMENT_TIMEOUT_SECONDS = 15 * 60;
  const [timeLeft, setTimeLeft] = useState(PAYMENT_TIMEOUT_SECONDS);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onBack?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onBack]);

  const formatCountdown = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Lắng nghe luồng camera live đúng trạm (ENTRY_1 hoặc EXIT_1) từ Staff Gate Control
  useEffect(() => {
    if (!socket) return;
    const normTargetGate = String(targetGate || 'EXIT_1').toUpperCase();
    const handleRemoteFrame = (data) => {
      const dataGate = String(data?.gate || '').toUpperCase();
      const isMatchingGate = dataGate === normTargetGate;
      const isFallbackLane = !dataGate && (
        normTargetGate === 'ENTRY_1' ? data?.lane === 'entry' : data?.lane === 'exit'
      );
      if ((isMatchingGate || isFallbackLane) && data?.frameBase64) {
        setLiveExitFrame(data.frameBase64);
      }
    };
    socket.on('gate:live_frame', handleRemoteFrame);
    return () => socket.off('gate:live_frame', handleRemoteFrame);
  }, [socket, targetGate]);

  const handleCheckout = useCallback(async (paymentMethod, keepPaused = false, paymentRef = null, forceRefresh = false) => {
    if (processingRef.current || completedRef.current) return;
    processingRef.current = true;
    setCheckoutError('');
    setPaymentError('');
    setIsProcessing(true);
    try {
      let currentData = sessionData;
      const targetPlate = sessionData?.observedLicensePlate || sessionData?.session?.licensePlate || sessionData?.licensePlate;

      // If user is retrying after challenge expired or forceRefresh, request fresh challenge token
      if (forceRefresh || paymentError || checkoutError) {
        try {
          const refreshRes = await fetch(`${API_BASE}/sessions/kiosk-exit-scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              licensePlate: targetPlate,
              detectedPlate: targetPlate,
              exitImageBase64: exitImage,
            })
          });
          const refreshed = await refreshRes.json();
          if (refreshed.success && refreshed.data) {
            currentData = refreshed.data;
            setSessionData(refreshed.data);
          }
        } catch (e) {
          console.warn('Failed to refresh challenge token before checkout:', e);
        }
      }

      const sessionId = currentData?.session?._id;
      const checkoutAttemptId = paymentRef && typeof paymentRef === 'object' ? (paymentRef.checkoutAttemptId || null) : null;
      const paymentIntentId = paymentRef && typeof paymentRef === 'object'
        ? (paymentRef.paymentIntentId || null)
        : (typeof paymentRef === 'string' ? paymentRef : null);
      const res = await fetch(`${API_BASE}/sessions/kiosk-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `kiosk-checkout:${sessionId}:${paymentIntentId || checkoutAttemptId || paymentMethod}:${Date.now()}`,
        },
        body: JSON.stringify({
          qrPayload: currentData?.qrPayload,
          licensePlate: currentData?.observedLicensePlate || currentData?.session?.licensePlate || currentData?.licensePlate,
          checkoutAttemptId,
          sessionId,
          exitImageBase64: exitImage,
          paymentMethod,
          paymentIntentId,
          keepPaused,
          checkoutToken: currentData?.checkoutToken,
          exitGate: targetGate || 'EXIT_1',
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
        const msg = data.message || 'Unable to complete checkout.';
        setPaymentError(msg);
        setCheckoutError(msg);
        setIsProcessing(false);
      }
    } catch (err) {
      const msg = err.message || 'Unable to complete checkout. Retry when connected.';
      setPaymentError(msg);
      setCheckoutError(msg);
      setIsProcessing(false);
    } finally { processingRef.current = false; }
  }, [exitImage, onCheckoutSuccess, sessionData, paymentError, checkoutError]);

  const autoCheckoutTriggeredRef = useRef(null);
  useEffect(() => {
    if (!sessionData || !sessionData.session?._id) return undefined;
    const currentSessionId = sessionData.session._id;
    if (autoCheckoutTriggeredRef.current === currentSessionId) return undefined;
    autoCheckoutTriggeredRef.current = currentSessionId;

    const timerIds = [];
    if (sessionData.isEarlyExit) {
      timerIds.push(setTimeout(() => setIsEarlyExitModalOpen(true), 0));
    }
    // If AutoPay is allowed AND it's not an early exit, auto-trigger checkout
    if (sessionData.canAutoPay && !sessionData.isEarlyExit) {
      const timerId = setTimeout(() => handleCheckout('wallet', false), 50);
      timerIds.push(timerId);
    } else if (!sessionData.canAutoPay && sessionData.amountToPay > 0 && !sessionData.isEarlyExit) {
      const timerId = setTimeout(() => handleCheckout('vietqr', false), 50);
      timerIds.push(timerId);
    } else if (sessionData.amountToPay <= 0 && !sessionData.isEarlyExit) {
      const timerId = setTimeout(() => handleCheckout('free', false), 50);
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
          const attemptQuery = paymentData.checkoutAttemptId
            ? `?checkoutAttemptId=${encodeURIComponent(paymentData.checkoutAttemptId)}`
            : '';
          const res = await fetch(`${API_BASE}/sessions/check-payos/${paymentData.orderCode}${attemptQuery}`);
          const data = await res.json();
          if (data.success && data.isPaid) {
            clearInterval(intervalId);
            handleCheckout('qr', keepPausedChoice, {
              paymentIntentId: data.paymentIntentId || paymentData.paymentIntentId || null,
              checkoutAttemptId: data.checkoutAttemptId || paymentData.checkoutAttemptId || null,
            });
          } else if (data.expired) {
            clearInterval(intervalId);
            setPaymentData(null);
            setPaymentError('QR code has expired. Please generate a new payment QR code.');
          }
        } catch (err) {
          console.error('Error polling payment status:', err);
        }
      }, 1500); // Check every 1.5 seconds for instant response upon payment
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

  const {
    session,
    durationHours,
    expectedHours = session?.expectedDurationHours || 0,
    amountToPay = Number(sessionData.amountToPay != null ? sessionData.amountToPay : (sessionData.totalPrice || 0)),
    walletBalance = 0,
    canAutoPay,
    isEarlyExit,
    remainingHours,
    bookingEnd,
    isSubscriptionExpired,
    subscriptionExpiredAt,
    violationDetails,
  } = sessionData;

  const chooseEarlyExitAction = (paused) => {
    setEarlyExitDecisionMade(true);
    setKeepPausedChoice(paused);
    setIsEarlyExitModalOpen(false);
    if (amountToPay <= 0) {
      handleCheckout('free', paused);
    } else if (canAutoPay) {
      handleCheckout('wallet', paused);
    } else {
      handleCheckout('vietqr', paused);
    }
  };

  // If AutoPay AND NOT early exit, show a loading screen while it processes
  if (canAutoPay && !isEarlyExit && !checkoutError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-black">
        <div className="w-20 h-20 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mb-8" />
        <h2 className="text-3xl font-bold text-yellow-400 mb-2">
          {amountToPay > 0 ? 'Processing Auto-Pay (ETC)...' : 'Exit Authorized...'}
        </h2>
        <p className="text-gray-400">
          {amountToPay > 0
            ? 'Please wait while we verify your wallet and open the barrier.'
            : 'Your booking or membership is valid. The barrier is being opened now.'}
        </p>
      </div>
    );
  }

  // Format currency
  const formatVND = (amount) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

  const plateForQr = sessionData?.observedLicensePlate || sessionData?.session?.licensePlate || sessionData?.licensePlate || '';
  const cleanPlateForQr = String(plateForQr).replace(/[^A-Z0-9]/g, '');
  const instantVietQrUrl = amountToPay > 0 && cleanPlateForQr
    ? `https://img.vietqr.io/image/970422-0904555791-qr_only.png?amount=${amountToPay}&addInfo=${encodeURIComponent(`VALO ${cleanPlateForQr}`)}&accountName=VALO%20PARKING`
    : (sessionData?.qrCode || sessionData?.vietQrUrl || null);
  const currentQr = instantVietQrUrl || paymentData?.qrCode;

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
          <div className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden relative group flex items-center justify-center min-h-[220px] max-h-[36vh]">
            <div className="absolute top-0 left-0 bg-yellow-500 text-black font-bold px-3 py-1 text-xs rounded-br-lg z-10 shadow">CHECK-IN SNAPSHOT</div>
            {session.entryImage_url ? (
              <img src={session.entryImage_url} alt="Entry Snapshot" className="w-full h-full max-h-[36vh] object-contain opacity-90 group-hover:opacity-100 transition-opacity" />
            ) : (
              <div className="w-full h-[220px] flex items-center justify-center text-gray-600"><ImageIcon size={48} /></div>
            )}
          </div>

          <div className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden relative group flex items-center justify-center min-h-[220px] max-h-[36vh]">
            <div className="absolute top-0 left-0 bg-yellow-500 text-black font-bold px-3 py-1 text-xs rounded-br-lg z-10 shadow flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              {targetGate === 'ENTRY_1' ? 'LEFT LANE (ENTRY_1) · LIVE' : 'RIGHT LANE (EXIT_1) · LIVE'}
            </div>
            {(liveExitFrame || exitImage) ? (
              <img src={liveExitFrame || exitImage} alt="Exit Station Live Camera" className="w-full h-full max-h-[36vh] object-contain brightness-[1.03] opacity-90 group-hover:opacity-100 transition-opacity" />
            ) : (
              <div className="w-full h-[220px] flex items-center justify-center text-gray-600"><ImageIcon size={48} /></div>
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
                <p className="text-2xl font-black text-yellow-400 tracking-wider">{formatLicensePlateDisplay(session.licensePlate)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500 font-semibold tracking-wider mb-1">SLOT</p>
                <p className="text-xl font-bold text-white">{session.parkingSlot || 'N/A'}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400 flex items-center gap-2"><Clock size={16} /> Expected Duration</span>
                <span className="font-bold">{expectedHours} hrs</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400 flex items-center gap-2"><Clock size={16} /> Actual Duration</span>
                <span className={`font-bold ${durationHours > expectedHours ? 'text-red-400' : 'text-white'}`}>{durationHours} hrs</span>
              </div>

              {durationHours > expectedHours && !isEarlyExit && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mt-2 flex items-start gap-3">
                  <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={16} />
                  <div>
                    <p className="text-red-400 font-semibold text-xs">OVERTIME CHARGE</p>
                    <p className="text-gray-300 text-xs mt-1">
                      You exceeded your booked time by {durationHours - expectedHours} hrs. Extra duration is billed according to standard hourly parking blocks.
                    </p>
                  </div>
                </div>
              )}

              {isSubscriptionExpired && (
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 mt-2 flex items-start gap-3">
                  <AlertTriangle className="text-orange-400 shrink-0 mt-0.5" size={16} />
                  <div>
                    <p className="text-orange-400 font-semibold text-xs">SUBSCRIPTION EXPIRED</p>
                    <p className="text-gray-300 text-xs mt-1">
                      {subscriptionExpiredAt
                        ? `Your subscription expired on ${new Date(subscriptionExpiredAt).toLocaleString('vi-VN')}. Only parking duration after expiration is charged.`
                        : 'Your subscription has expired. This session is charged as a standard hourly ticket.'}
                    </p>
                  </div>
                </div>
              )}

              {violationDetails && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mt-2 flex items-start gap-3">
                  <AlertTriangle className="text-amber-400 shrink-0 mt-0.5" size={16} />
                  <div>
                    <p className="text-amber-400 font-semibold text-xs">PARKING NOTICE ({violationDetails.slotCode || 'N/A'})</p>
                    <p className="text-gray-300 text-xs mt-1">{violationDetails.violationMessage}</p>
                  </div>
                </div>
              )}

              {isEarlyExit && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mt-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-yellow-400 font-semibold text-xs">
                      {earlyExitDecisionMade
                        ? (keepPausedChoice ? 'MODE: PAUSE (SLOT RETAINED)' : 'MODE: END SESSION (RETURN SLOT)')
                        : 'EARLY DEPARTURE DETECTED'}
                    </p>
                    <p className="text-gray-300 text-xs mt-0.5">
                      {remainingHours}h remaining in your booking.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEarlyExitModalOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 text-xs font-bold shrink-0"
                  >
                    {earlyExitDecisionMade ? 'Change' : 'Choose'}
                  </button>
                </div>
              )}
            </div>

            <div className="mt-6 pt-6 border-t border-white/5 flex justify-between items-end">
              <span className="text-gray-400 text-sm font-semibold">TOTAL AMOUNT</span>
              <span className="text-4xl font-black text-yellow-400">{formatVND(amountToPay)}</span>
            </div>
          </div>

          {/* Clean single error alert without duplicate card */}
          {(paymentError || checkoutError) ? (
            <p role="alert" className="mb-4 text-sm font-semibold text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
              {paymentError || checkoutError}
            </p>
          ) : null}
          {/* QR Code Section */}
          <div className="bg-white rounded-2xl p-6 flex flex-col items-center text-black">
            <p className="font-bold text-sm mb-3 tracking-wide">{amountToPay > 0 ? 'SCAN TO PAY' : 'NO PAYMENT REQUIRED'}</p>
            {amountToPay <= 0 ? (
              <p className="text-green-700 font-bold text-center">Your parking session is authorized for exit.</p>
            ) : currentQr ? (
              currentQr.startsWith('http') ? (
                <img src={currentQr} alt="VietQR" className="w-[180px] h-[235px] object-contain rounded-lg shadow-xs" />
              ) : (
                <QRCode value={currentQr} size={180} />
              )
            ) : (
              <div className="w-[180px] h-[235px] bg-gray-100 flex flex-col items-center justify-center text-gray-500 text-xs text-center p-3 rounded-lg gap-2">
                <Loader2 className="animate-spin text-amber-500" size={24} />
                <span>Loading QR Code...</span>
              </div>
            )}

            {/* 15-minute countdown hold badge */}
            <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 px-3.5 py-1.5 rounded-full font-bold border border-amber-200/80 shadow-xs">
              <Clock size={13} className="text-amber-600" />
              <span>Payment expires in: {formatCountdown(timeLeft)}</span>
            </div>

            <p className="text-xs text-gray-500 mt-2 text-center">
              {amountToPay > 0
                ? 'Use any banking app to scan and pay.'
                : (isEarlyExit ? 'Select Pause or End Session below to open the exit barrier.' : 'Barrier opens automatically after confirmation.')}
            </p>
          </div>
        </div>

        <div className="p-6 bg-[#0D0D0D] border-t border-white/5 flex gap-4 shrink-0">
          <button
            onClick={onBack}
            className="px-6 py-4 rounded-xl border border-white/10 text-white font-bold hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          {isEarlyExit && !earlyExitDecisionMade ? (
            <button
              onClick={() => setIsEarlyExitModalOpen(true)}
              disabled={isProcessing}
              className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black font-black text-lg py-4 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              CHOOSE EARLY EXIT OPTION <ChevronRight />
            </button>
          ) : amountToPay <= 0 ? (
            <button
              onClick={() => handleCheckout('free', keepPausedChoice)}
              disabled={isProcessing}
              className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-black font-black text-lg py-4 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {isProcessing ? 'Processing...' : 'COMPLETE EXIT'} <ChevronRight />
            </button>
          ) : (
            <button
              disabled={true}
              className="flex-1 bg-amber-500/20 border border-amber-400/40 text-amber-300 font-black text-lg py-4 rounded-xl flex items-center justify-center gap-2 cursor-wait shadow-sm"
            >
              <div className="w-5 h-5 border-2 border-amber-300 border-t-transparent rounded-full animate-spin" />
              <span>Waiting for payment...</span>
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
                onClick={() => chooseEarlyExitAction(true)}
                disabled={isProcessing}
                className="w-full py-4 px-6 rounded-xl font-bold text-lg text-black transition-colors bg-yellow-500 hover:bg-yellow-400"
              >
                PAUSE (I WILL RETURN LATER)
              </button>

              <button
                onClick={() => chooseEarlyExitAction(false)}
                disabled={isProcessing}
                className="w-full py-4 px-6 rounded-xl font-bold text-lg text-white border-2 transition-colors border-white/20 hover:bg-white/10"
              >
                END SESSION (RETURN SLOT)
              </button>
            </div>
            <p className="mt-6 text-sm text-gray-400">
              {amountToPay <= 0
                ? 'No extra fee applies. Select an option above to finish exit immediately.'
                : (!canAutoPay
                  ? 'After choosing, scan the payment QR to complete your early exit.'
                  : 'Your wallet will settle any remaining balance automatically.')}
            </p>

            <button onClick={() => setIsEarlyExitModalOpen(false)} className="mt-4 text-gray-400 underline hover:text-white">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
