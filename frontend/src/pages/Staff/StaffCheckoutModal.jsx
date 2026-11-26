import { useState, useEffect, useRef } from 'react';
import { Camera, X, Check, ArrowRight, Loader2, AlertCircle, ShieldAlert, Clock, PauseCircle, Wallet, CheckCircle2 } from 'lucide-react';
import { API_BASE } from '../../services/api';
import StaffDropdown from './components/StaffDropdown.jsx';

export default function StaffCheckoutModal({ isOpen, onClose, session, onSuccess }) {
  const [step, setStep] = useState('camera'); // 'camera', 'scanning', 'invoice', 'submitting', 'success'
  const [exitImageBase64, setExitImageBase64] = useState(null);
  const [invoiceData, setInvoiceData] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [cashReceivedAmount, setCashReceivedAmount] = useState('');
  const [completedCheckout, setCompletedCheckout] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      streamRef.current = stream;
      setErrorMsg('');
    } catch (err) {
      console.error('Camera access denied or error:', err);
      setErrorMsg('Could not access camera. Please allow camera permissions.');
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  useEffect(() => {
    let cameraTimer;
    if (isOpen && step === 'camera') {
      cameraTimer = window.setTimeout(startCamera, 0);
    }
    return () => {
      if (cameraTimer) window.clearTimeout(cameraTimer);
      stopCamera();
    };
  }, [isOpen, step]);

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    setExitImageBase64(dataUrl);
    stopCamera();
    handleExitScan(dataUrl);
  };

  const handleExitScan = async (imageOverride = null) => {
    setStep('scanning');
    setErrorMsg('');
    try {
      const token = localStorage.getItem("accessToken");
      const res = await fetch(`${API_BASE}/sessions/kiosk-exit-scan`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          licensePlate: session.licensePlate,
          exitImageBase64: imageOverride || exitImageBase64,
        })
      });
      const data = await res.json();
      
      if (!data.success) {
        setErrorMsg(data.message || 'Failed to scan exit');
        setStep('camera');
        return;
      }

      const invoice = data.data || data;
      const totalAmount = Number(invoice.amountToPay || 0);
      setInvoiceData({
        ...invoice,
        checkoutToken: invoice.checkoutToken || data.checkoutToken || null,
        totalAmount,
        parkingFee: Number(invoice.totalPrice || 0),
      });
      if (invoice.canAutoPay && totalAmount > 0) {
        setPaymentMethod('WALLET');
      } else {
        setPaymentMethod('CASH');
      }
      setCashReceivedAmount('');
      setStep('invoice');
    } catch (err) {
      console.error(err);
      setErrorMsg('Network error while processing check-out.');
      setStep('camera');
    }
  };

  const handleConfirmCheckout = async (keepPaused = false) => {
    setStep('submitting');
    setErrorMsg('');
    try {
      const token = localStorage.getItem("accessToken");
      const idempotencyKey = `staff-checkout:${session._id}:${paymentMethod}:${cashReceivedAmount || 'vietqr'}:${keepPaused ? 'paused' : 'ended'}`;
      const res = await fetch(`${API_BASE}/sessions/kiosk-checkout`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ 
          sessionId: session._id,
          exitImageBase64,
          paymentMethod: paymentMethod === 'CASH' ? 'cash' : paymentMethod === 'WALLET' ? 'wallet' : 'vietqr',
          cashReceivedAmount: paymentMethod === 'CASH' ? Number(cashReceivedAmount) : null,
          checkoutToken: invoiceData?.checkoutToken || null,
          keepPaused,
        })
      });
      const data = await res.json();
      
      if (!data.success) {
        setErrorMsg(data.message || 'Failed to check out');
        setStep('invoice');
        return;
      }

      if (data.requiresPayment) {
        setErrorMsg('Bank payment is required. Complete checkout at the exit kiosk or use the staff mobile QR scanner.');
        setStep('invoice');
        return;
      }
      setCompletedCheckout(data.data || null);
      setStep('success');
      setTimeout(() => {
        onSuccess();
      }, 2000);

    } catch (err) {
      console.error(err);
      setErrorMsg('Network error while finalizing check-out.');
      setStep('invoice');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
      <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[#ffd555]/15 bg-[#111111] shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#ffd555]/30 bg-[#ffd555]/15">
              <Check size={16} className="text-[#ffd555]" />
            </div>
            <div>
              <h3 className="text-white font-bold tracking-wide uppercase text-sm">Process Check-out</h3>
              <p className="text-xs text-gray-400 font-mono">SLOT: {session.parkingSlot || '--'} • PLATE: {session.licensePlate}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white bg-black/20 hover:bg-black/40 p-2 rounded-full transition-colors border border-white/5">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 relative min-h-[400px] flex flex-col">
          
          {errorMsg && (
            <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-lg flex items-center gap-2">
              <AlertCircle size={16} />
              {errorMsg}
            </div>
          )}

          {step === 'camera' && (
            <div className="flex flex-col flex-1">
              <div className="relative flex-1 bg-black rounded-xl overflow-hidden border border-white/10 flex items-center justify-center min-h-[300px]">
                <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
                <div className="pointer-events-none absolute inset-0 m-8 rounded-xl border-2 border-dashed border-[#ffd555]/50" />
                <div className="absolute bottom-4 left-0 right-0 text-center">
                  <span className="bg-black/60 backdrop-blur px-3 py-1.5 rounded-full text-xs font-bold text-white tracking-wider border border-white/10">
                    ALIGN VEHICLE & CAPTURE
                  </span>
                </div>
              </div>
              <button 
                onClick={capturePhoto}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ffd555] py-4 font-extrabold uppercase tracking-wider text-[#080808] shadow-[0_0_20px_rgba(255,213,85,0.18)] transition-all hover:bg-[#ffe58a] active:scale-[0.98]"
              >
                <Camera size={20} />
                Capture Photo
              </button>
            </div>
          )}

          {step === 'scanning' && (
            <div className="flex flex-col items-center justify-center flex-1 py-12">
              <Loader2 size={48} className="mb-4 animate-spin text-[#ffd555]" />
              <h3 className="text-xl font-bold text-white mb-2">Calculating Price</h3>
              <p className="text-sm text-gray-400">Verifying session duration and pricing...</p>
            </div>
          )}

          {step === 'invoice' && invoiceData && (
            <div className="flex flex-col flex-1 animate-in fade-in slide-in-from-bottom-4 duration-300">
              {/* Parking Violation Alert detected by AI Camera */}
              {invoiceData.violationDetails && (
                <div className="mb-4 rounded-xl border border-red-500/50 bg-red-950/70 p-4 text-xs text-red-200 shadow-lg space-y-2.5">
                  <div className="flex items-center justify-between pb-2 border-b border-red-500/30">
                    <span className="flex items-center gap-1.5 font-black text-red-400 uppercase tracking-wider text-[11px]">
                      <ShieldAlert size={16} className="animate-pulse text-red-400" />
                      Wrong-Slot Violation Detected
                    </span>
                    <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 font-mono text-[10px] font-bold border border-red-500/30">
                      AI CAMERA
                    </span>
                  </div>

                  <div className="space-y-1">
                    <p className="text-white font-medium">
                      <strong className="text-red-300">Violation Reason:</strong>{' '}
                      {typeof invoiceData.violationDetails === 'string'
                        ? invoiceData.violationDetails
                        : (invoiceData.violationDetails.violationMessage || `Unauthorized parking at slot ${invoiceData.violationDetails.slotCode || 'N/A'}`)}
                    </p>
                    <div className="flex items-center gap-1.5 text-slate-300 text-[11px]">
                      <Clock size={13} className="text-amber-400 flex-shrink-0" />
                      <span>
                        <strong className="text-slate-200">Violation Duration:</strong> From{' '}
                        <span className="text-white font-mono font-bold">
                          {invoiceData.violationDetails.detectedAt
                            ? new Date(invoiceData.violationDetails.detectedAt).toLocaleString('en-US')
                            : 'N/A'}
                        </span>{' '}
                        to{' '}
                        <span className="text-white font-mono font-bold">
                          {invoiceData.violationDetails.resolvedAt
                            ? new Date(invoiceData.violationDetails.resolvedAt).toLocaleString('en-US')
                            : 'Present'}
                        </span>{' '}
                        ({invoiceData.violationDetails.durationMinutes || 0} min)
                      </span>
                    </div>
                  </div>

                  {invoiceData.violationDetails.evidenceSnapshot && (
                    <div className="mt-2 rounded-lg overflow-hidden border border-red-500/30 max-h-[100px] bg-black/60 flex items-center justify-center">
                      <img src={invoiceData.violationDetails.evidenceSnapshot} alt="Evidence" className="w-full h-auto max-h-[100px] object-contain" />
                    </div>
                  )}

                  <p className="text-[10px] text-amber-300/80 italic pt-1">
                    * Staff please review and explain this violation to the driver before completing checkout.
                  </p>
                </div>
              )}

              <div className="bg-black/40 border border-white/5 rounded-xl p-5 mb-4 flex-1">
                <div className="flex justify-between items-center pb-3 border-b border-white/5 mb-3">
                  <span className="text-gray-400 text-sm">Check-in Time</span>
                  <span className="text-white font-medium">{new Date(session.checkInTime).toLocaleString('vi-VN')}</span>
                </div>
                <div className="flex justify-between items-center pb-3 border-b border-white/5 mb-3">
                  <span className="text-gray-400 text-sm">Duration</span>
                  <span className="text-white font-medium">{invoiceData.remainingHours || invoiceData.durationHours || 0} hours</span>
                </div>
                
                {invoiceData.isSubActive ? (
                   <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 my-2 text-center">
                     <p className="text-purple-400 font-bold uppercase text-sm tracking-wider">VIP Subscription Active</p>
                     <p className="text-xs text-purple-300 mt-1">This checkout is fully covered by VIP membership.</p>
                   </div>
                ) : (
                  <>
                    <div className="flex justify-between items-center pb-3 border-b border-white/5 mb-3">
                      <span className="text-gray-400 text-sm">Base Price</span>
                      <span className="text-white font-medium">{(invoiceData.amountToPay || 0).toLocaleString()} VND</span>
                    </div>
                    {invoiceData.refundAmount > 0 && (
                      <div className="flex justify-between items-center pb-3 border-b border-white/5 mb-3">
                        <span className="text-emerald-400 text-sm font-bold">Refund Due</span>
                        <span className="text-emerald-400 font-bold">+{invoiceData.refundAmount.toLocaleString()} VND</span>
                      </div>
                    )}
                  </>
                )}

                <div className="flex justify-between items-center pt-2">
                  <span className="text-gray-300 font-bold uppercase tracking-wide">Final Amount</span>
                  <span className="text-3xl font-black text-[#ffd555]">{(invoiceData.amountToPay || 0).toLocaleString()} VND</span>
                </div>
              </div>

              {/* Registration & Wallet Status Info */}
              <div className="mb-4 rounded-xl border border-white/10 bg-black/40 p-3 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-white">
                    {invoiceData.isRegisteredVehicle || invoiceData.registeredVehicleInfo?.isRegisteredVehicle ? (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 size={14} /> Registered ({invoiceData.registeredVehicleInfo?.ownerName || 'Customer'})
                      </span>
                    ) : invoiceData.registeredVehicleInfo?.isMemberAccount || invoiceData.hasWallet ? (
                      <span className="flex items-center gap-1 text-sky-400">
                        <Check size={14} /> Member ({invoiceData.registeredVehicleInfo?.ownerName || 'Customer'})
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-amber-400">
                        <AlertCircle size={14} /> Unregistered / Guest
                      </span>
                    )}
                  </div>
                  {invoiceData.hasWallet && (
                    <span className="rounded bg-cyan-400/20 px-2 py-0.5 text-[10px] font-mono text-cyan-300 border border-cyan-400/30">
                      Wallet: {invoiceData.walletBalance?.toLocaleString()} VND
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400">
                  {invoiceData.canAutoPay
                    ? 'Customer has sufficient wallet balance for 1-click Auto-Debit.'
                    : invoiceData.hasWallet
                      ? `Wallet balance insufficient (deficit ${(invoiceData.totalAmount - (invoiceData.walletBalance || 0)).toLocaleString()} VND). Collect cash.`
                      : 'Vehicle has no Valo account. Staff must collect cash or VietQR.'}
                </p>
              </div>

              <div className="mb-4">
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Payment Method</label>
                <StaffDropdown
                  value={paymentMethod}
                  onChange={setPaymentMethod}
                  options={[
                    ...(invoiceData.canAutoPay ? [['WALLET', `Valo Wallet Auto-Debit (${invoiceData.walletBalance?.toLocaleString()} VND)`]] : []),
                    ['CASH', 'Cash (Direct Collection)'],
                  ]}
                  ariaLabel="Select payment method"
                  placement="top"
                  className="w-full"
                  buttonClassName="bg-black/50 font-bold uppercase tracking-wide"
                  menuClassName="w-full"
                />
              </div>

              {paymentMethod === 'CASH' && invoiceData.totalAmount > 0 && (
                <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
                  <label className="block text-xs font-bold uppercase tracking-widest text-yellow-300">
                    Cash received from customer
                  </label>
                  <input
                    type="number"
                    min={invoiceData.totalAmount}
                    step="1000"
                    value={cashReceivedAmount}
                    onChange={(event) => setCashReceivedAmount(event.target.value)}
                    placeholder={`Minimum ${invoiceData.totalAmount.toLocaleString()} VND`}
                    className="mt-2 w-full rounded-lg border border-yellow-500/40 bg-black/50 px-3 py-2 font-mono text-white outline-none"
                  />
                  {Number(cashReceivedAmount) >= Number(invoiceData.totalAmount) && (
                    <p className="mt-2 text-sm font-bold text-emerald-300">
                      Change: {(Number(cashReceivedAmount) - Number(invoiceData.totalAmount)).toLocaleString()} VND
                    </p>
                  )}
                </div>
              )}

              {invoiceData?.isEarlyExit ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs text-cyan-200">
                    <div className="flex items-center gap-1.5 font-bold mb-1 text-cyan-300">
                      <PauseCircle size={15} className="text-cyan-400" />
                      <span>Early Departure Choice</span>
                      <span className="ml-auto rounded bg-cyan-400/20 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300 border border-cyan-400/30">
                        {invoiceData.remainingHours || 0}h Left
                      </span>
                    </div>
                    <p className="text-[11px] text-cyan-100/70">
                      Booking valid until {invoiceData.bookingEnd ? new Date(invoiceData.bookingEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'scheduled end'}. Pause to keep slot for return, or complete session now.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => handleConfirmCheckout(true)}
                      disabled={paymentMethod === 'CASH' && invoiceData.totalAmount > 0 && Number(cashReceivedAmount) < Number(invoiceData.totalAmount)}
                      className="flex items-center justify-center gap-2 rounded-xl bg-cyan-500 py-3.5 font-extrabold uppercase tracking-wider text-[#080808] shadow-[0_0_20px_rgba(6,182,212,0.2)] transition-all hover:bg-cyan-400 active:scale-[0.98] disabled:opacity-50 text-xs"
                    >
                      <PauseCircle size={16} />
                      Pause (Keep Slot)
                    </button>
                    <button 
                      onClick={() => handleConfirmCheckout(false)}
                      disabled={paymentMethod === 'CASH' && invoiceData.totalAmount > 0 && Number(cashReceivedAmount) < Number(invoiceData.totalAmount)}
                      className="flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 py-3.5 font-extrabold uppercase tracking-wider text-white transition-all hover:bg-white/20 active:scale-[0.98] disabled:opacity-50 text-xs"
                    >
                      End Session
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={() => handleConfirmCheckout(false)}
                  disabled={paymentMethod === 'CASH' && invoiceData.totalAmount > 0 && Number(cashReceivedAmount) < Number(invoiceData.totalAmount)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ffd555] py-4 font-extrabold uppercase tracking-wider text-[#080808] shadow-[0_0_20px_rgba(255,213,85,0.18)] transition-all hover:bg-[#ffe58a] active:scale-[0.98] disabled:opacity-50"
                >
                  Confirm Payment & Checkout
                  <ArrowRight size={18} />
                </button>
              )}
            </div>
          )}

          {step === 'submitting' && (
            <div className="flex flex-col items-center justify-center flex-1 py-12">
              <Loader2 size={48} className="mb-4 animate-spin text-[#ffd555]" />
              <h3 className="text-xl font-bold text-white mb-2">Processing</h3>
              <p className="text-sm text-gray-400">Finalizing checkout and opening gate...</p>
            </div>
          )}

          {step === 'success' && (
            <div className="flex flex-col items-center justify-center flex-1 py-12 animate-in zoom-in duration-300">
              <div className="w-20 h-20 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center border border-emerald-500/50 mb-6">
                <Check size={40} strokeWidth={3} />
              </div>
              <h3 className="text-2xl font-black text-white mb-2 uppercase tracking-wide">
                {completedCheckout?.bookingStatus === 'PAUSED' || completedCheckout?.isPaused ? 'Session Paused' : 'Checkout Success'}
              </h3>
              <p className="text-gray-400">
                {completedCheckout?.bookingStatus === 'PAUSED' || completedCheckout?.isPaused
                  ? `Slot ${session.parkingSlot} is retained. Vehicle can return anytime.`
                  : 'Vehicle is clear to exit.'}
              </p>
              {completedCheckout?.changeAmount != null && (
                <p className="mt-3 text-lg font-bold text-emerald-300">
                  Change: {Number(completedCheckout.changeAmount).toLocaleString()} VND
                </p>
              )}
            </div>
          )}

          <canvas ref={canvasRef} className="hidden" />
        </div>
      </div>
    </div>
  );
}
