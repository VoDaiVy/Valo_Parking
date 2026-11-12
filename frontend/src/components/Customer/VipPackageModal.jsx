import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Crown, Sparkles, Check, Loader2, ArrowRight, AlertCircle, 
  Wallet, QrCode, X, CheckCircle2, ShieldCheck, Car, MapPin,
  Plus, RefreshCw
} from 'lucide-react';
import { 
  getTicketPackages, 
  paySubscriptionWithWallet, 
  createSubscriptionPayment,
  verifySubscriptionPayment,
} from '../../services/subscriptionService';
import { getMyVehicles } from '../../services/vehicleService';
import { getWalletInfo } from '../../services/walletService';
import { apiFetch } from '../../services/api';
import PolicyAcceptancePrompt from '../policies/PolicyAcceptancePrompt';
import ParkingMapViewer from '../ParkingMapViewer';
import { extractMissingPolicies, isPolicyAcceptanceRequired } from '../../utils/policyErrors';

export default function VipPackageModal({ isOpen, onClose, onSubscribed }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [packages, setPackages] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [refreshingVehicles, setRefreshingVehicles] = useState(false);
  const [floors, setFloors] = useState([]);
  const [selectedFloorId, setSelectedFloorId] = useState('');
  const [floorSlots, setFloorSlots] = useState([]);
  const [floorDbSlots, setFloorDbSlots] = useState([]);
  const [mapActiveSessions, setMapActiveSessions] = useState([]);
  const [mapActiveHolds, setMapActiveHolds] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);

  // Flow states
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedSlotCode, setSelectedSlotCode] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('payos');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [successResult, setSuccessResult] = useState(null);
  const [paymentData, setPaymentData] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState('');
  const [policyPrompt, setPolicyPrompt] = useState({
    open: false,
    missingPolicies: [],
  });
  const finishPurchaseRef = useRef(() => {});

  useEffect(() => {
    if (!isOpen) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setSelectedPackage(null);
        setSelectedSlotCode('');
        setErrorMsg('');
        setErrorCode('');
        setSuccessResult(null);
        setPaymentData(null);
        setPaymentStatus('');
        setPaymentMethod('payos');
        setPolicyPrompt({ open: false, missingPolicies: [] });
        const [pkgRes, vRes, floorRes, walletRes] = await Promise.all([
          getTicketPackages().catch(() => ({ ok: false })),
          getMyVehicles().catch(() => ({ ok: false })),
          apiFetch('/parking-floors').catch(() => ({ ok: false })),
          getWalletInfo().catch(() => ({ ok: false })),
        ]);

        if (pkgRes.ok && pkgRes.data?.data) {
          setPackages(pkgRes.data.data.filter((p) => p.isActive));
        }
        if (vRes.ok && vRes.data?.data) {
          const approved = vRes.data.data.filter((v) => v.status === 'approved');
          setVehicles(approved);
          if (approved.length > 0) setSelectedVehicleId(approved[0]._id);
        }
        if (floorRes.ok && floorRes.data?.data) {
          const fls = floorRes.data.data;
          setFloors(fls);
          if (fls.length > 0) setSelectedFloorId(fls[0]._id);
        }
        if (walletRes.ok && walletRes.data?.data) {
          setWalletBalance(Number(walletRes.data.data.balance || 0));
        }
      } catch (err) {
        console.error('Error fetching VIP modal data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isOpen]);

  useEffect(() => {
    finishPurchaseRef.current = () => {
      const successData = {
        package: selectedPackage,
        slotCode: selectedSlotCode,
        floorName: floors.find((floor) => floor._id === selectedFloorId)?.name || 'Selected floor',
        vehicle: vehicles.find((vehicle) => vehicle._id === selectedVehicleId),
      };
      setSuccessResult(successData);
      onSubscribed?.(successData);
    };
  }, [floors, onSubscribed, selectedFloorId, selectedPackage, selectedSlotCode, selectedVehicleId, vehicles]);

  useEffect(() => {
    if (!isOpen || !paymentData?.orderCode) return undefined;

    let disposed = false;
    let checking = false;
    let attempts = 0;
    const verify = async () => {
      if (checking || disposed) return;
      checking = true;
      attempts += 1;
      setPaymentStatus('checking');
      try {
        const response = await verifySubscriptionPayment(paymentData.orderCode);
        if (disposed) return;
        if (response.ok && response.data?.success) {
          setPaymentStatus('paid');
          setPaymentData(null);
          finishPurchaseRef.current();
          return;
        }
        const message = response.data?.message || '';
        if (message !== 'Payment not completed.') {
          setErrorMsg(message || 'Unable to verify the PayOS payment.');
        }
        if (attempts >= 100) {
          setPaymentStatus('timeout');
          setErrorMsg('Payment verification timed out. If you have paid, open Membership to check the transaction or contact support.');
        } else {
          setPaymentStatus('waiting');
        }
      } catch {
        if (!disposed) {
          setPaymentStatus('waiting');
          setErrorMsg('The payment status could not be checked. The system will try again automatically.');
        }
      } finally {
        checking = false;
      }
    };

    const initialTimer = window.setTimeout(verify, 1200);
    const intervalId = window.setInterval(verify, 3000);
    return () => {
      disposed = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
    };
  }, [isOpen, paymentData?.orderCode]);

  const handleRefreshVehicles = async () => {
    setRefreshingVehicles(true);
    try {
      const vRes = await getMyVehicles();
      const approved = (vRes.data?.data || []).filter((v) => v.status === 'approved');
      setVehicles(approved);
      if (approved.length && !selectedVehicleId) {
        setSelectedVehicleId(approved[0]._id);
      }
    } catch {
      // ignore
    } finally {
      setRefreshingVehicles(false);
    }
  };

  // Load slots when selectedFloorId changes in slot selection view
  useEffect(() => {
    if (!selectedPackage || !selectedFloorId) return;

    const fetchSlots = async () => {
      try {
        setLoadingSlots(true);
        setFloorSlots([]);
        setFloorDbSlots([]);
        setMapActiveSessions([]);
        setMapActiveHolds([]);
        const [res, liveMapRes] = await Promise.all([
          apiFetch(`/parking-floors/${selectedFloorId}/slots`),
          apiFetch('/parking-floors/live-map').catch(() => ({ ok: false })),
        ]);
        if (res.ok && res.data?.data) {
          // Only show standard car slots or EV slots that are available
          const rawSlots = res.data.data;
          const liveSlots = (liveMapRes.ok && Array.isArray(liveMapRes.data?.data)
            ? liveMapRes.data.data : []).filter((slot) => String(slot.floorId) === String(selectedFloorId));
          const unavailableLiveCodes = new Set(liveSlots
            .filter((slot) => slot.status !== 'available')
            .map((slot) => String(slot.id || '').toUpperCase()));
          setFloorDbSlots(rawSlots);
          const available = rawSlots.filter((s) => 
            (s.status === 'available' || s.isAvailable) 
            && s.slotType !== 'SLOT-MOTO' 
            && s.slotType !== 'SLOT-HANDICAP'
            && !s.reservedBySubscriptionId
            && !s.reservedByEntitlementId
            && !unavailableLiveCodes.has(String(s.slotNumber || s.slotCode).toUpperCase())
          );
          setMapActiveSessions(liveSlots
            .filter((slot) => slot.status === 'occupied')
            .map((slot) => ({ floorId: slot.floorId, parkingSlot: slot.id })));
          setMapActiveHolds(liveSlots
            .filter((slot) => slot.status === 'reserved')
            .map((slot) => ({ floorId: slot.floorId, slotCode: slot.id })));
          setFloorSlots(available);
          setSelectedSlotCode((current) => {
            const stillAvailable = available.some((slot) => (
              String(slot.slotNumber || slot.slotCode).toUpperCase() === String(current).toUpperCase()
            ));
            return stillAvailable ? current : '';
          });
        }
      } catch (err) {
        setFloorSlots([]);
        setFloorDbSlots([]);
        setMapActiveSessions([]);
        setMapActiveHolds([]);
        setSelectedSlotCode('');
        console.error('Error fetching floor slots:', err);
      } finally {
        setLoadingSlots(false);
      }
    };

    fetchSlots();
  }, [selectedPackage, selectedFloorId]);

  if (!isOpen) return null;

  const handleSelectPackage = (pkg) => {
    setSelectedPackage(pkg);
    setSelectedSlotCode('');
    setErrorMsg('');
    setErrorCode('');
  };

  const handleConfirmSubscription = async () => {
    if (!selectedPackage) return;
    if (vehicles.length === 0) {
      setErrorMsg('You need at least one approved vehicle in your account to subscribe to a VIP package.');
      return;
    }
    if (!selectedSlotCode) {
      setErrorMsg('Please choose a dedicated parking space to complete the subscription.');
      return;
    }

    const price = Number(selectedPackage.price || 0);
    if (paymentMethod === 'wallet' && walletBalance < price) {
      setErrorMsg(`Your wallet balance (${walletBalance.toLocaleString('en-US')} VND) is not enough to pay ${price.toLocaleString('en-US')} VND. Please top up or use PayOS.`);
      return;
    }

    try {
      setSubmitting(true);
      setErrorMsg('');
      setErrorCode('');

      const slots = [{ floorId: selectedFloorId, slotCode: selectedSlotCode }];

      if (paymentMethod === 'wallet') {
        const res = await paySubscriptionWithWallet(selectedPackage._id, slots, price);
        if (res.ok && res.data?.success) {
          setWalletBalance((current) => Math.max(0, current - price));
          finishPurchaseRef.current();
        } else if (isPolicyAcceptanceRequired(res.data)) {
          setPolicyPrompt({
            open: true,
            missingPolicies: extractMissingPolicies(res.data),
          });
        } else {
          setErrorMsg(res.data?.message || 'Unable to pay with the VALO Wallet. Please try again.');
        }
      } else {
        const res = await createSubscriptionPayment(selectedPackage._id, slots, price);
        const createdPayment = res.data?.data;
        if (res.ok && createdPayment?.orderCode && (createdPayment.qrCode || createdPayment.checkoutUrl)) {
          setPaymentData(createdPayment);
          setPaymentStatus('waiting');
        } else if (isPolicyAcceptanceRequired(res.data)) {
          setPolicyPrompt({
            open: true,
            missingPolicies: extractMissingPolicies(res.data),
          });
        } else {
          setErrorCode(res.data?.code || '');
          setErrorMsg(res.data?.message || 'Unable to create the PayOS payment.');
        }
      }
    } catch (err) {
      setErrorCode('');
      setErrorMsg(err.message || 'Server connection error.');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedPrice = Number(selectedPackage?.price || 0);
  const walletNeedsTopUp = paymentMethod === 'wallet' && walletBalance < selectedPrice;
  const handlePrimaryAction = () => {
    if (walletNeedsTopUp) {
      onClose?.();
      navigate('/wallet');
      return;
    }
    handleConfirmSubscription();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/70 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[32px] border border-gray-100 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 bg-gradient-to-r from-amber-500/10 via-yellow-500/10 to-transparent p-5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-md shadow-amber-500/25">
              <Crown size={22} className="fill-current" />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900">VALO VIP & Monthly Packages</h2>
              <p className="text-xs font-semibold text-gray-500">Dedicated space 24/7 · Unlimited entry and exit · Review each package for current savings</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-900 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto scrollbar-hidden p-5 sm:p-6 space-y-6">
          {loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-gray-400">
              <Loader2 size={36} className="animate-spin text-amber-500" />
              <p className="text-sm font-bold">Loading VIP packages...</p>
            </div>
          ) : successResult ? (
            /* Success State */
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shadow-inner">
                <CheckCircle2 size={44} />
              </div>
              <h3 className="text-2xl font-black text-gray-900">VIP package activated!</h3>
              <p className="mt-1 max-w-md text-sm text-gray-600">
                <strong>{successResult.package.name}</strong> has been activated for vehicle{' '}
                <strong className="text-gray-900">{successResult.vehicle?.licensePlate}</strong>.
              </p>

              <div className="my-6 w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50/60 p-5 text-left text-sm text-amber-950 shadow-sm space-y-2.5">
                <div className="flex justify-between items-center pb-2 border-b border-amber-200">
                  <span className="text-xs uppercase font-black text-amber-800">Membership details</span>
                  <span className="inline-flex items-center gap-1 text-xs font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                    <ShieldCheck size={13} /> Active
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Package:</span>
                  <strong>{successResult.package.name}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Dedicated space:</span>
                  <strong className="text-amber-900 font-black">{successResult.floorName} · Space {successResult.slotCode}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">License plate:</span>
                  <strong className="font-mono">{successResult.vehicle?.licensePlate}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Term:</span>
                  <strong>30 days (automatic renewal)</strong>
                </div>
              </div>

              <div className="rounded-xl bg-gray-50 p-4 text-xs text-gray-600 max-w-md text-center">
                💡 You can now enter and leave dedicated space <strong>{successResult.slotCode}</strong> without making an hourly booking. The gate will recognize your vehicle automatically.
              </div>

              <button
                type="button"
                onClick={onClose}
                className="mt-6 rounded-xl bg-gray-900 px-8 py-3 text-sm font-black text-white hover:bg-black transition shadow-sm"
              >
                Done & Close
              </button>
            </div>
          ) : paymentData ? (
            /* Step 3: PayOS / VietQR payment */
            <div className="mx-auto flex w-full max-w-lg flex-col items-center py-4 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-100 text-cyan-700">
                <QrCode size={28} />
              </div>
              <h3 className="text-2xl font-black text-gray-900">Pay with PayOS / VietQR</h3>
              <p className="mt-1 text-sm text-gray-500">
                Scan the QR code with your banking app. This window will confirm and activate the package automatically.
              </p>

              <div className="my-6 rounded-3xl border border-cyan-100 bg-white p-5 shadow-lg shadow-cyan-900/5">
                {(paymentData.qrCode || paymentData.checkoutUrl) ? (
                  <QRCodeSVG
                    value={String(paymentData.qrCode || paymentData.checkoutUrl)}
                    size={220}
                    level="M"
                  />
                ) : (
                  <div className="flex h-[220px] w-[220px] items-center justify-center rounded-2xl bg-gray-50 text-gray-400">
                    <QrCode size={64} />
                  </div>
                )}
              </div>

              <div className="w-full rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-semibold text-gray-500">Amount</span>
                  <strong className="text-gray-900">{Number(paymentData.amount || selectedPackage?.price || 0).toLocaleString('en-US')} VND</strong>
                </div>
                <div className="mt-2 flex items-center justify-between gap-4">
                  <span className="font-semibold text-gray-500">Order code</span>
                  <strong className="font-mono text-gray-900">{paymentData.orderCode}</strong>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2 text-sm font-bold text-cyan-700">
                {paymentStatus === 'checking' || paymentStatus === 'waiting' ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : (
                  <AlertCircle size={17} />
                )}
                {paymentStatus === 'timeout'
                  ? 'Automatic verification timed out.'
                  : 'Waiting for payment confirmation...'}
              </div>

              {errorMsg && (
                <div className="mt-4 flex w-full items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-left text-xs font-bold text-rose-700">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="mt-6 flex w-full flex-col gap-3 sm:flex-row">
                {paymentData.checkoutUrl && (
                  <a
                    href={paymentData.checkoutUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 rounded-xl bg-cyan-600 px-5 py-3.5 text-sm font-black text-white shadow-md shadow-cyan-600/20 transition hover:bg-cyan-700"
                  >
                    Open PayOS checkout
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setPaymentData(null);
                    setPaymentStatus('');
                    setErrorMsg('');
                  }}
                  className="rounded-xl border border-gray-200 px-5 py-3.5 text-sm font-bold text-gray-600 transition hover:bg-gray-50"
                >
                  Back to payment methods
                </button>
              </div>
            </div>
          ) : selectedPackage ? (
            /* Step 2: Slot & Vehicle Selection & Payment */
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
              <button
                type="button"
                onClick={() => setSelectedPackage(null)}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-900 transition lg:col-span-2"
              >
                ← Back to packages
              </button>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50 p-3 lg:col-span-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-white font-black">
                    <Crown size={20} />
                  </div>
                  <div>
                    <h4 className="font-black text-gray-900">{selectedPackage.name}</h4>
                    <p className="text-xs text-gray-500">{selectedPackage.type === 'yearly' ? 'Yearly package (365 days)' : 'Monthly package (30 days)'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-black text-amber-900">
                    {Number(selectedPackage.price).toLocaleString('en-US')} VND
                  </div>
                </div>
              </div>

              {errorMsg && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-700 lg:col-span-2">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <div>
                    {errorCode === 'PAYOS_CHANNEL_UNAVAILABLE' && (
                      <strong className="mb-1 block text-sm">PayOS payment channel is not active</strong>
                    )}
                    <span className="font-bold">{errorMsg}</span>
                    {errorCode === 'PAYOS_CHANNEL_UNAVAILABLE' && (
                      <span className="mt-1 block font-medium text-rose-600">
                        No bank-transfer QR was returned by PayOS, so the app cannot display or verify a payment yet.
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 lg:col-start-2 lg:row-start-4">
                {/* Vehicle Selection */}
                <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50/50">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-black uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                      <Car size={15} /> Choose a vehicle
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleRefreshVehicles}
                        disabled={refreshingVehicles}
                        className="text-gray-400 hover:text-amber-600 transition"
                        title="Refresh vehicle list"
                      >
                        <RefreshCw size={13} className={refreshingVehicles ? "animate-spin" : ""} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onClose?.();
                          navigate('/customer/vehicles');
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 hover:text-amber-700 hover:underline transition cursor-pointer"
                      >
                        <Plus size={13} /> Register a new vehicle
                      </button>
                    </div>
                  </div>
                  {vehicles.length > 0 ? (
                    <select
                      value={selectedVehicleId}
                      onChange={(e) => setSelectedVehicleId(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white p-3 text-sm font-bold text-gray-800 outline-none focus:border-amber-500"
                    >
                      {vehicles.map((v) => (
                        <option key={v._id} value={v._id}>
                          {v.licensePlate} ({v.brand || 'Vehicle'} {v.model || ''})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-xs text-rose-600 bg-rose-50 p-3.5 rounded-xl border border-rose-100 flex flex-col gap-1.5">
                      <span>You do not have an approved car. Select <strong>Register a new vehicle</strong> above to add one.</span>
                    </div>
                  )}
                </div>

                {/* Floor Selection */}
                <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50/50">
                  <label className="text-xs font-black uppercase tracking-wider text-gray-500 block mb-2 flex items-center gap-1.5">
                    <MapPin size={15} /> Choose a parking floor
                  </label>
                  <select
                    value={selectedFloorId}
                    onChange={(e) => {
                      setSelectedFloorId(e.target.value);
                      setSelectedSlotCode('');
                    }}
                    className="w-full rounded-xl border border-gray-200 bg-white p-3 text-sm font-bold text-gray-800 outline-none focus:border-amber-500"
                  >
                    {floors.map((f) => (
                      <option key={f._id} value={f._id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Slot Selection */}
              <div className="rounded-2xl border border-gray-200 p-4 lg:col-start-1 lg:row-span-4 lg:row-start-4">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-black uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                    <Sparkles size={15} className="text-amber-500" /> Choose your dedicated parking space
                  </label>
                  <span className="text-xs font-bold text-emerald-600">
                    {floorSlots.length} spaces available
                  </span>
                </div>

                <p className="mb-3 text-xs font-medium text-gray-500">
                  Click an available space on the parking map. Unavailable, reserved and maintenance spaces cannot be selected.
                </p>

                {loadingSlots ? (
                  <div className="flex h-80 justify-center items-center text-gray-400 gap-2 text-xs font-bold rounded-2xl border border-gray-200 bg-gray-50">
                    <Loader2 size={18} className="animate-spin text-amber-500" /> Checking available spaces...
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-gray-200 bg-slate-50 shadow-inner">
                    <div className="relative h-80 sm:h-[520px]">
                      <ParkingMapViewer
                        floors={floors}
                        currentFloorId={selectedFloorId}
                        onFloorSelect={(floorId) => {
                          if (!floorId || floorId === selectedFloorId) return;
                          setSelectedFloorId(floorId);
                          setSelectedSlotCode('');
                        }}
                        dbSlots={floorDbSlots}
                        activeSessions={mapActiveSessions}
                        activeHolds={mapActiveHolds}
                        availableSlots={floorSlots.map((slot) => ({
                          ...slot,
                          floorId: selectedFloorId,
                          slotCode: slot.slotNumber || slot.slotCode,
                        }))}
                        onSelectSlot={(slot, floorId) => {
                          if (String(floorId) !== String(selectedFloorId)) return;
                          const code = String(slot.id || '').toUpperCase();
                          const isAvailable = floorSlots.some((item) => (
                            String(item.slotNumber || item.slotCode).toUpperCase() === code
                          ));
                          if (isAvailable) setSelectedSlotCode(code);
                        }}
                        selectedSlotId={selectedSlotCode ? `${selectedFloorId}:${selectedSlotCode}` : ''}
                        vehicleType={vehicles.find((vehicle) => vehicle._id === selectedVehicleId)?.vehicleType
                          || vehicles.find((vehicle) => vehicle._id === selectedVehicleId)?.type
                          || 'car'}
                        is2DMode
                        hideUI
                        staticFit
                      />
                      {!floorSlots.length && (
                        <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-xl border border-amber-200 bg-amber-50/95 p-3 text-center text-xs font-bold text-amber-800 shadow-sm backdrop-blur">
                          This floor has no space available for a new VIP package. Please choose another floor.
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 bg-white px-4 py-3">
                      <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold text-gray-500">
                        <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border-2 border-slate-400 bg-white" />Available</span>
                        <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border-2 border-cyan-500 bg-cyan-100" />Selected</span>
                        <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border-2 border-orange-500 bg-orange-100" />Unavailable</span>
                        <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border-2 border-red-500 bg-red-100" />Maintenance</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Payment Method */}
              <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50/50 p-4 lg:col-start-2 lg:row-start-5">
                <label className="text-xs font-black uppercase tracking-wider text-gray-500 block">
                  Payment method
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('wallet')}
                    className={`order-2 flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border bg-gray-900 p-3 text-center text-white transition ${
                      paymentMethod === 'wallet'
                        ? 'border-amber-400 shadow-sm'
                        : 'border-gray-700 hover:border-gray-500'
                    }`}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-800 text-gray-300">
                      <Wallet size={20} />
                    </div>
                    <div>
                      <div className="text-xs font-black text-white">VALO Wallet</div>
                      <div className="mt-1 text-[10px] text-gray-400">{walletBalance.toLocaleString('en-US')} VND</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('payos')}
                    className={`order-1 flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center transition ${
                      paymentMethod === 'payos'
                        ? 'border-cyan-500 bg-cyan-50/80 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-cyan-700">
                      <QrCode size={20} />
                    </div>
                    <div>
                      <div className="text-xs font-black text-cyan-600">PayOS</div>
                      <div className="mt-1 text-[10px] text-gray-500">QR code / Bank transfer</div>
                    </div>
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-4 lg:col-start-2 lg:row-start-6">
                <div className="flex items-center justify-between text-xs font-black uppercase tracking-wider text-gray-400">
                  <span>Selected</span>
                  <span>{selectedSlotCode ? '1 / 1' : '0 / 1'}</span>
                </div>
                <div className={`mt-3 flex min-h-24 items-center justify-center rounded-xl border border-dashed px-4 text-center ${selectedSlotCode ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                  {selectedSlotCode ? (
                    <div>
                      <strong className="block text-xl text-amber-900">{selectedSlotCode}</strong>
                      <span className="text-xs font-medium text-gray-500">Dedicated space on {floors.find((floor) => floor._id === selectedFloorId)?.name}</span>
                    </div>
                  ) : (
                    <span className="text-sm font-medium text-gray-400">Click the map to choose a parking space.</span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 lg:col-start-2 lg:row-start-7">
                <button
                  type="button"
                  disabled={submitting || !selectedSlotCode || vehicles.length === 0}
                  onClick={handlePrimaryAction}
                  className={`flex w-full items-center justify-center gap-2 rounded-xl px-6 py-4 font-black text-white shadow-lg transition disabled:cursor-not-allowed disabled:bg-gray-400 disabled:opacity-100 disabled:shadow-none ${
                    paymentMethod === 'payos'
                      ? 'bg-cyan-600 hover:bg-cyan-700 shadow-md shadow-cyan-600/20'
                      : 'bg-amber-500 hover:bg-amber-600 shadow-md shadow-amber-500/20'
                  }`}
                >
                  {submitting ? <Loader2 size={18} className="animate-spin" /> : walletNeedsTopUp || paymentMethod === 'payos' ? <QrCode size={18} /> : <Check size={18} />}
                  {walletNeedsTopUp
                    ? 'Top up wallet'
                    : paymentMethod === 'payos'
                      ? 'Pay now'
                      : 'Confirm & Activate'}
                  <ArrowRight size={18} />
                </button>
              </div>
            </div>
          ) : (
            /* Step 1: Package List */
            <div className="flex flex-col items-center justify-center py-2">
              <div className="flex justify-center items-stretch gap-6 flex-wrap sm:flex-nowrap w-full max-w-3xl">
                {packages.length > 0 ? (
                  [...packages]
                    .sort((a, b) => {
                      if (a.type === 'monthly' && b.type !== 'monthly') return -1;
                      if (a.type !== 'monthly' && b.type === 'monthly') return 1;
                      return Number(a.price || 0) - Number(b.price || 0);
                    })
                    .map((pkg) => {
                      const price = Number(pkg.price || 0);
                      const isMonthly = pkg.type === 'monthly';
                      return (
                        <div
                          key={pkg._id}
                          className={`relative flex flex-col justify-between rounded-[32px] p-6 sm:p-7 w-full max-w-[340px] transition-all hover:translate-y-[-2px] ${
                            isMonthly
                              ? 'border-2 border-amber-200/90 bg-[#fdfdfa] shadow-[0_12px_40px_rgba(245,158,11,0.08)] hover:shadow-[0_16px_45px_rgba(245,158,11,0.15)]'
                              : 'border-2 border-purple-200/90 bg-[#fefeff] shadow-[0_12px_40px_rgba(168,85,247,0.08)] hover:shadow-[0_16px_45px_rgba(168,85,247,0.15)]'
                          }`}
                        >
                          {/* Top Badge */}
                          {isMonthly ? (
                            <div className="absolute top-4 right-4">
                              <span className="bg-gradient-to-r from-amber-400 to-yellow-500 text-white font-black text-[10px] tracking-wider uppercase px-3 py-1 rounded-full shadow-sm">
                                POPULAR
                              </span>
                            </div>
                          ) : (
                            <div className="absolute top-4 right-4">
                              <span className="bg-gradient-to-r from-purple-500 to-indigo-500 text-white font-black text-[10px] tracking-wider uppercase px-3 py-1 rounded-full shadow-sm">
                                BEST VALUE
                              </span>
                            </div>
                          )}

                          <div>
                            {/* Circle Icon */}
                            {isMonthly ? (
                              <div className="w-16 h-16 rounded-full bg-blue-50/80 border-4 border-blue-200/70 flex items-center justify-center mx-auto mb-2.5 text-amber-500 shadow-sm">
                                <Crown size={28} className="text-amber-500 fill-amber-400" />
                              </div>
                            ) : (
                              <div className="w-16 h-16 rounded-full bg-purple-50/80 border-4 border-purple-200/70 flex items-center justify-center mx-auto mb-2.5 text-purple-600 shadow-sm">
                                <Sparkles size={28} className="text-purple-600 fill-purple-300" />
                              </div>
                            )}

                            {/* Sub-label */}
                            <div className="text-center mb-1">
                              {isMonthly ? (
                                <span className="text-[11px] font-black uppercase tracking-widest text-amber-500">
                                  MONTHLY
                                </span>
                              ) : (
                                <span className="inline-block bg-purple-100 text-purple-600 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider">
                                  YEARLY
                                </span>
                              )}
                            </div>

                            {/* Title */}
                            <h3 className="text-base sm:text-lg font-black text-gray-900 tracking-wide text-center uppercase">
                              {pkg.name}
                            </h3>

                            {/* Price Inset Box */}
                            <div
                              className={`rounded-2xl border py-4 px-4 my-4 text-center shadow-inner ${
                                isMonthly
                                  ? 'border-gray-100 bg-[#f9fafb]'
                                  : 'border-purple-100/70 bg-[#faf8ff]'
                              }`}
                            >
                              <div
                                className={`text-2xl sm:text-[26px] font-black tracking-tight ${
                                  isMonthly ? 'text-amber-500' : 'text-purple-600'
                                }`}
                              >
                                {price.toLocaleString('en-US')} VND
                              </div>
                              <div className="text-xs text-gray-400 font-semibold mt-0.5">
                                {isMonthly ? 'per month' : 'for 1 year'}
                              </div>
                            </div>

                            {/* Benefits */}
                            <ul className="space-y-3 text-xs text-gray-600 mb-6 flex-1 px-1">
                              {isMonthly ? (
                                <>
                                  <li className="flex items-start gap-2.5">
                                    <Check size={16} className="text-amber-400 shrink-0 mt-0.5 stroke-[2.5]" />
                                    <span>All Member benefits</span>
                                  </li>
                                  <li className="flex items-start gap-2.5">
                                    <Check size={16} className="text-amber-400 shrink-0 mt-0.5 stroke-[2.5]" />
                                    <span>Own a fixed parking slot under your name</span>
                                  </li>
                                  <li className="flex items-start gap-2.5">
                                    <Check size={16} className="text-amber-400 shrink-0 mt-0.5 stroke-[2.5]" />
                                    <span>Free 24/7 automatic check-in</span>
                                  </li>
                                  <li className="flex items-start gap-2.5">
                                    <Check size={16} className="text-amber-400 shrink-0 mt-0.5 stroke-[2.5]" />
                                    <span>No need to book before arrival</span>
                                  </li>
                                  <li className="flex items-start gap-2.5">
                                    <Check size={16} className="text-amber-400 shrink-0 mt-0.5 stroke-[2.5]" />
                                    <span>Monthly subscription with priority</span>
                                  </li>
                                </>
                              ) : (
                                <>
                                  <li className="flex items-start gap-2.5">
                                    <Check size={16} className="text-purple-500 shrink-0 mt-0.5 stroke-[2.5]" />
                                    <span>All Monthly VIP benefits</span>
                                  </li>
                                  <li className="flex items-start gap-2.5">
                                    <Check size={16} className="text-purple-600 shrink-0 mt-0.5 stroke-[2.5]" />
                                    <span className="text-purple-700 font-bold">Includes 12 free washes / maintenance services</span>
                                  </li>
                                  <li className="flex items-start gap-2.5">
                                    <Check size={16} className="text-purple-500 shrink-0 mt-0.5 stroke-[2.5]" />
                                    <span>Priority support</span>
                                  </li>
                                  <li className="flex items-start gap-2.5">
                                    <Check size={16} className="text-purple-500 shrink-0 mt-0.5 stroke-[2.5]" />
                                    <span>VIP yearly package</span>
                                  </li>
                                </>
                              )}

                              {Array.isArray(pkg.features) && pkg.features.map((feat, idx) => (
                                <li key={idx} className="flex items-start gap-2.5">
                                  <Check
                                    size={16}
                                    className={`shrink-0 mt-0.5 stroke-[2.5] ${
                                      isMonthly ? 'text-amber-400' : 'text-purple-500'
                                    }`}
                                  />
                                  <span>{feat}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Bottom Action Button */}
                          <button
                            type="button"
                            onClick={() => handleSelectPackage(pkg)}
                            className={`w-full rounded-2xl font-black py-3.5 px-4 shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-sm ${
                              isMonthly
                                ? 'bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-500 hover:to-yellow-600 text-gray-950 shadow-amber-500/25'
                                : 'bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white shadow-purple-500/25'
                            }`}
                          >
                            <span>Choose this package</span>
                            <ArrowRight size={16} />
                          </button>
                        </div>
                      );
                    })
                ) : (
                  <div className="py-12 text-center text-gray-400">
                    <p className="text-sm font-bold">No VIP packages are currently available.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
      <PolicyAcceptancePrompt
        open={policyPrompt.open}
        missingPolicies={policyPrompt.missingPolicies}
        onClose={() => setPolicyPrompt({ open: false, missingPolicies: [] })}
        onAccepted={() => {
          setPolicyPrompt({ open: false, missingPolicies: [] });
          window.setTimeout(() => handleConfirmSubscription(), 0);
        }}
      />
    </>
  );
}
