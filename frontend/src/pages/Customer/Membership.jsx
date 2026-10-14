import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, Sparkles, Check, Loader2, ArrowRight, AlertCircle, ChevronDown, QrCode, Wallet } from 'lucide-react';
import {
  getTicketPackages,
  createSubscriptionPayment,
  verifySubscriptionPayment,
  paySubscriptionWithWallet,
  getMembershipStatus,
} from '../../services/subscriptionService';
import { getCurrentPricing } from '../../services/pricingService';
import { getWalletInfo } from '../../services/walletService';
import { getMyVehicles } from '../../services/vehicleService';
import { apiFetch } from '../../services/api';
import { notifyAuthChange } from '../../services/authStorage';
import ParkingMapViewer from '../../components/ParkingMapViewer';
import PolicyAcceptancePrompt from '../../components/policies/PolicyAcceptancePrompt';
import { extractMissingPolicies, isPolicyAcceptanceRequired } from '../../utils/policyErrors';
import toast, { Toaster } from 'react-hot-toast';

const CustomFloorPicker = ({ floors, value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const selectedFloor = floors.find((floor) => floor._id === value);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const selectFloor = (floorId) => {
    onChange(floorId);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-12 w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 text-left text-sm font-semibold text-gray-800 outline-none transition hover:border-gold/50 focus:border-gold focus:ring-1 focus:ring-gold"
      >
        <span className="min-w-0 truncate">{selectedFloor?.name || 'Select floor'}</span>
        <ChevronDown
          size={15}
          className={`ml-3 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-56 overflow-y-auto rounded-2xl border border-gray-100 bg-white py-2 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="mb-2 border-b border-gray-100 px-4 pb-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Select floor
            </span>
          </div>

          {floors.map((floor) => {
            const isActive = floor._id === value;
            return (
              <button
                key={floor._id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => selectFloor(floor._id)}
                className={`mx-2 flex w-[calc(100%_-_1rem)] items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${
                  isActive
                    ? 'bg-gold/10 font-bold text-gold'
                    : 'font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <span className="min-w-0 truncate">{floor.name}</span>
                {isActive && <span className="ml-3 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default function Membership() {
  const navigate = useNavigate();
  const [packages, setPackages] = useState([]);
  const [packagePriceMap, setPackagePriceMap] = useState(() => new Map());
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(null);

  const [selectedPackage, setSelectedPackage] = useState(null);
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [selectedSlots, setSelectedSlots] = useState([]); // [{ floorId, slotCode }]
  const [floors, setFloors] = useState([]);
  const [currentFloorId, setCurrentFloorId] = useState(null);
  const [dbSlots, setDbSlots] = useState([]);
  
  const [verifying, setVerifying] = useState(false);
  const [success, setSuccess] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('payos');
  const [membership, setMembership] = useState(null);
  const [policyPrompt, setPolicyPrompt] = useState({
    open: false,
    missingPolicies: [],
  });

  const subscriptionPackages = packages
    .filter(pkg => ['monthly', 'yearly'].includes(pkg.type))
    .sort((a, b) => {
      const typeOrder = { monthly: 0, yearly: 1 };
      return (typeOrder[a.type] ?? 2) - (typeOrder[b.type] ?? 2) || (a.price || 0) - (b.price || 0);
    });

  const isVipActive = Boolean(membership?.isVip ?? user?.membership?.isVip);
  const approvedVehicleCount = vehicles.filter(
    (vehicle) => !vehicle.status || vehicle.status === 'approved'
  ).length;
  const availablePurchaseSlots = Math.max(
    0,
    Math.min(3, approvedVehicleCount) - (membership?.reservedSlots?.length || 0)
  );

  const syncCurrentUserProfile = async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    const { ok, data } = await apiFetch('/profile', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (ok && data?.success) {
      const cached = JSON.parse(sessionStorage.getItem('valo_user') || 'null');
      const updatedUser = {
        ...(cached || {}),
        ...data.data,
        avatar: data.data.profile?.avatar || cached?.avatar || cached?.profile?.avatar || '',
      };
      sessionStorage.setItem('valo_user', JSON.stringify(updatedUser));
      setUser(data.data);
      notifyAuthChange();
    }
  };

  // Check URL for PayOS return
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const orderCode = urlParams.get('orderCode');
    const cancel = urlParams.get('cancel');

    if (orderCode) {
      if (cancel === 'true') {
        toast.error('Payment transaction was cancelled.');
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        const verifyingTimerId = window.setTimeout(() => setVerifying(true), 0);
        let attempts = 0;
        
        const intervalId = setInterval(async () => {
          try {
            attempts++;
            const res = await verifySubscriptionPayment(orderCode);
            
            if (res.ok && res.data?.success) {
              clearInterval(intervalId);
              await syncCurrentUserProfile();
              setVerifying(false);
              window.location.replace('/profile?membershipPayment=success');
            } else if (attempts >= 100) { // Timeout after 5 minutes (3s * 100)
              clearInterval(intervalId);
              setVerifying(false);
              toast.error('Payment verification timed out. Please contact support if you have paid.');
              window.history.replaceState({}, document.title, window.location.pathname);
            } else if (res.data?.message !== 'Payment not completed.') {
              // If it's a hard error (not just pending), stop polling
              clearInterval(intervalId);
              setVerifying(false);
              toast.error(res.data?.message || 'The transaction failed');
              window.history.replaceState({}, document.title, window.location.pathname);
            }
          } catch (err) {
            console.error("Polling error:", err);
          }
        }, 3000);

        return () => {
          window.clearTimeout(verifyingTimerId);
          clearInterval(intervalId);
        };
      }
    }
    return undefined;
  }, []);

  useEffect(() => {
    const fetchDbSlots = async () => {
      if (!currentFloorId) {
        setDbSlots([]);
        return;
      }
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/parking-floors/${currentFloorId}/slots`);
        const data = await res.json();
        if (data.success) {
          setDbSlots(data.data);
        }
      } catch (err) {
        console.error("Failed to fetch slots", err);
      }
    };
    fetchDbSlots();
  }, [currentFloorId]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [pkgRes, pricingRes, vRes, floorRes, profileRes, walletRes, membershipRes] = await Promise.all([
          getTicketPackages(),
          getCurrentPricing(),
          getMyVehicles(),
          fetch(`${import.meta.env.VITE_API_BASE_URL}/parking-floors`).then(r => r.json()),
          fetch(`${import.meta.env.VITE_API_BASE_URL}/profile`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` }
          }).then(r => r.json()),
          getWalletInfo(),
          getMembershipStatus(),
        ]);
        
        if (pkgRes.ok && pkgRes.data?.data) {
          const pkgs = pkgRes.data.data;
          setPackages(pkgs);
        }
        if (pricingRes.ok && pricingRes.data?.data?.packages) {
          setPackagePriceMap(new Map(pricingRes.data.data.packages.map((pkg) => [
            String(pkg._id),
            { adjustedPrice: Number(pkg.adjustedPrice), priceLabel: pkg.priceLabel },
          ])));
        } else {
          setPackagePriceMap(new Map());
        }
        if (vRes.ok) {
          setVehicles(vRes.data?.data || []);
        }
        if (floorRes.success) {
          setFloors(floorRes.data || []);
          if (floorRes.data && floorRes.data.length > 0) {
            setCurrentFloorId(floorRes.data[0]._id);
          }
        }
        if (profileRes && profileRes.success) {
          setUser(profileRes.data);
        }
        if (walletRes.ok && walletRes.data?.success) {
          setWalletBalance(walletRes.data.data.balance || 0);
        }
        if (membershipRes.ok && membershipRes.data?.success) {
          setMembership(membershipRes.data.data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleBuyPackage = (pkg) => {
    if (!pkg) return;
    setSelectedPackage(pkg);
    setSelectedSlots([]);
    setShowSlotModal(true);
  };

  const getEffectivePackagePrice = (pkg) => {
    const dynamicPrice = packagePriceMap.get(String(pkg?._id))?.adjustedPrice;
    return Number.isFinite(dynamicPrice) ? dynamicPrice : Number(pkg?.price || 0);
  };

  const cardShellClass = "group relative z-10 flex min-h-[430px] w-full flex-col overflow-hidden rounded-3xl bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.08)] transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_22px_46px_rgba(15,23,42,0.14)] md:p-6";

  const visibleCardsCount = subscriptionPackages.length === 0 ? 2 : subscriptionPackages.length + 1;
  const getDesktopGridBalanceClass = (cardIndex) => {
    if (visibleCardsCount === 2) return ''; // Left-align if only 2 cards (Member + Empty State or 1 Package)
    
    const lastRowCount = visibleCardsCount % 3;
    const lastRowStartIndex = visibleCardsCount - lastRowCount;

    if (lastRowCount === 1 && cardIndex === lastRowStartIndex) return 'lg:col-start-2';
    // Remove the awkward col-start-3 gap for 2 items in the last row
    return '';
  };

  const getPackagePresentation = (pkg, index) => {
    const isYearly = pkg.type === 'yearly';
    const isMonthly = pkg.type === 'monthly';
    const isPopular = isMonthly && index === subscriptionPackages.findIndex(item => item.type === 'monthly');

    if (isYearly) {
      return {
        Icon: Sparkles,
        title: pkg.name || 'Yearly VIP',
        subtitle: 'for 1 year',
        badge: 'Yearly',
        border: 'border border-purple-100/80 hover:border-purple-200',
        glow: 'from-purple-500/20 via-fuchsia-400/10 to-transparent',
        softWash: 'from-purple-50/90 via-white to-fuchsia-50/70',
        iconBox: 'bg-purple-50 text-purple-600 ring-purple-100',
        priceBox: 'bg-gradient-to-br from-purple-50 to-white border-purple-100',
        priceText: 'text-purple-600',
        checkText: 'text-purple-500',
        button: 'bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-fuchsia-600 shadow-lg shadow-purple-500/20',
        popular: false,
        features: [
          'All Monthly VIP benefits',
          'Includes 12 free washes / maintenance services',
          'Priority support',
        ],
      };
    }

    return {
      Icon: Crown,
      title: pkg.name || 'Monthly VIP',
      subtitle: 'per month',
      badge: 'Monthly',
      border: isPopular ? 'border-2 border-gold/80 hover:border-gold' : 'border border-gold/25 hover:border-gold/50',
      glow: 'from-gold/25 via-yellow-300/10 to-transparent',
      softWash: 'from-yellow-50/80 via-white to-amber-50/70',
      iconBox: 'bg-gold/10 text-gold ring-gold/20',
      priceBox: 'bg-gradient-to-br from-gold/10 to-white border-gold/20',
      priceText: 'text-gold',
      checkText: 'text-gold',
      button: 'bg-gradient-to-r from-yellow-500 to-gold hover:from-amber-500 hover:to-yellow-400 shadow-lg shadow-gold/20',
      popular: isPopular,
      features: [
        'All Member benefits',
        'Own a fixed parking slot under your name',
        'Free 24/7 automatic check-in',
        'No need to book before arrival',
      ],
    };
  };

  const getPackageButton = () => {
    if (availablePurchaseSlots <= 0) {
      return { disabled: true, label: 'No available entitlement capacity' };
    }

    return {
      disabled: false,
      label: isVipActive ? 'Add another space' : 'Upgrade now',
    };
  };

  const handleSelectSlot = (floorId, slotData) => {
    const existingIndex = selectedSlots.findIndex(s => s.floorId === floorId && s.slotCode === slotData.slotNumber);
    if (existingIndex >= 0) {
      // Remove
      setSelectedSlots(prev => prev.filter((_, i) => i !== existingIndex));
    } else {
      // Add
      const maxSlots = availablePurchaseSlots;
      if (approvedVehicleCount === 0) {
        toast.error("You need to add a vehicle before buying a VIP pass.");
        return;
      }
      if (selectedSlots.length >= maxSlots) {
        toast.error(`You can select at most ${maxSlots} parking slots (matching your number of vehicles).`);
        return;
      }
      setSelectedSlots(prev => [...prev, { floorId, slotCode: slotData.slotNumber }]);
    }
  };

  const handleConfirmSlots = async () => {
    if (selectedSlots.length === 0) {
      toast.error("Please select at least one parking slot to reserve.");
      return;
    }

    const effectivePackagePrice = selectedPackage ? getEffectivePackagePrice(selectedPackage) : 0;
    const totalPrice = effectivePackagePrice * Math.max(1, selectedSlots.length);

    if (paymentMethod === 'wallet' && selectedPackage && walletBalance < totalPrice) {
      toast.error("Số dư ví không đủ. Hệ thống sẽ chuyển hướng bạn đến trang Nạp Tiền.");
      setTimeout(() => {
        setShowSlotModal(false);
        navigate('/wallet');
      }, 1500);
      return;
    }
    
    try {
      setShowSlotModal(false);
      setVerifying(true); // Show the processing state

      if (paymentMethod === 'wallet') {
        const res = await paySubscriptionWithWallet(selectedPackage._id, selectedSlots, effectivePackagePrice);
        if (res.ok && res.data?.success) {
          await syncCurrentUserProfile();
          setSuccess(true);
        } else if (isPolicyAcceptanceRequired(res.data)) {
          setPolicyPrompt({
            open: true,
            missingPolicies: extractMissingPolicies(res.data),
          });
        } else {
          toast.error(res.data?.message || "Error while paying with Valo Wallet");
        }
        setVerifying(false);
      } else {
        const res = await createSubscriptionPayment(selectedPackage._id, selectedSlots, effectivePackagePrice);
        if (res.ok && res.data?.data?.checkoutUrl) {
          // Redirect directly to the PayOS page
          window.location.href = res.data.data.checkoutUrl;
        } else if (isPolicyAcceptanceRequired(res.data)) {
          setPolicyPrompt({
            open: true,
            missingPolicies: extractMissingPolicies(res.data),
          });
          setVerifying(false);
        } else {
          toast.error(res.data?.message || "Error creating PayOS transaction");
          setVerifying(false);
        }
      }
    } catch {
      toast.error("Network error");
      setVerifying(false);
    }
  };

  if (verifying) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <Loader2 className="w-12 h-12 animate-spin text-gold mb-4" />
        <p className="text-gray-500 font-medium">Processing transaction, please wait...</p>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <Toaster position="top-right" />
      {/* Header Banner */}
      <div className="bg-[#181C23] text-white pt-28 pb-20 px-6 rounded-b-[32px] text-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gold via-[#181C23] to-[#181C23]"></div>
        <div className="relative z-10 max-w-4xl mx-auto">
          <div className="flex justify-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400">
              <span className="font-bold text-xs">★</span>
            </div>
            <div className="w-7 h-7 rounded-full bg-gold/20 flex items-center justify-center text-gold">
              <Crown size={14} />
            </div>
            <div className="w-7 h-7 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400">
              <Sparkles size={14} />
            </div>
          </div>
          <h1 className="text-3xl md:text-4xl font-black mb-2 tracking-tight">Unlock <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-gold">Premium</span></h1>
          <p className="text-gray-400 text-sm md:text-base">Choose the right plan and upgrade your experience</p>
        </div>
      </div>

      {/* Cards */}
      <div className="mx-auto -mt-10 max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:gap-6">
          
          {/* Member Card */}
          <div className={`${cardShellClass} ${getDesktopGridBalanceClass(0)} border border-gray-100 hover:border-gray-200`}>
            <div className="absolute inset-0 bg-gradient-to-br from-gray-50/90 via-white to-slate-50/80"></div>
            <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gray-200/60 blur-3xl motion-safe:animate-pulse"></div>
            <div className="absolute -bottom-14 -left-14 h-32 w-32 rounded-full bg-slate-100/80 blur-3xl opacity-70 motion-safe:animate-pulse"></div>
            <div className="relative mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[20px] bg-gray-100 text-gray-500 ring-8 ring-gray-50 transition duration-300 group-hover:rotate-3 group-hover:scale-105">
              <span className="font-black text-lg">M</span>
            </div>
            <h3 className="relative text-center font-black text-gray-900 tracking-widest text-xs mb-4">MEMBER</h3>
            <div className="relative text-center py-3.5 rounded-2xl bg-white/80 border border-gray-100 mb-5 shadow-inner backdrop-blur">
              <div className="text-xl font-black text-gray-900">Default</div>
            </div>
            <ul className="relative space-y-3 mb-5 flex-1">
              <li className="flex gap-2.5 text-gray-600 text-xs">
                <Check size={15} className="text-gray-400 shrink-0" />
                <span>Book parking by hour or day</span>
              </li>
              <li className="flex gap-2.5 text-gray-600 text-xs">
                <Check size={15} className="text-gray-400 shrink-0" />
                <span>Use add-on services (paid)</span>
              </li>
              <li className="flex gap-2.5 text-gray-400 text-xs">
                <div className="w-3.5 h-3.5 rounded-full border border-gray-300 shrink-0 mt-0.5"></div>
                <span>Dedicated fixed parking slot</span>
              </li>
              <li className="flex gap-2.5 text-gray-400 text-xs">
                <div className="w-3.5 h-3.5 rounded-full border border-gray-300 shrink-0 mt-0.5"></div>
                <span>Free check-in / No reservation required</span>
              </li>
            </ul>
            <button disabled className="relative w-full py-3 rounded-2xl font-bold text-gray-500 bg-gray-100 text-sm">
              In use
            </button>
          </div>

          {subscriptionPackages.map((pkg, index) => {
            const presentation = getPackagePresentation(pkg, index);
            const buttonState = getPackageButton(pkg);
            const Icon = presentation.Icon;
            const dynamicEntry = packagePriceMap.get(String(pkg._id));
            const effectivePrice = getEffectivePackagePrice(pkg);
            const hasAdjustedPrice = Number.isFinite(dynamicEntry?.adjustedPrice)
              && effectivePrice !== Number(pkg.price);

            return (
              <div
                key={pkg._id}
                className={`${cardShellClass} ${getDesktopGridBalanceClass(index + 1)} ${
                  presentation.border
                } ${presentation.popular ? 'z-20' : 'z-10'}`}
              >
                {presentation.popular && (
                  <div className="absolute top-3 right-3 z-20 bg-gold text-white text-[9px] font-black tracking-widest py-1 px-3 rounded-full uppercase shadow-lg shadow-gold/20">
                    Popular
                  </div>
                )}
                <div className={`absolute inset-0 bg-gradient-to-br ${presentation.softWash}`}></div>
                <div className={`absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-to-br ${presentation.glow} blur-3xl motion-safe:animate-pulse`}></div>
                <div className={`absolute -bottom-14 -left-14 h-32 w-32 rounded-full bg-gradient-to-tr ${presentation.glow} blur-3xl opacity-70 motion-safe:animate-pulse`}></div>
                <div className={`relative w-12 h-12 rounded-[20px] flex items-center justify-center mx-auto mb-3 ring-8 transition duration-300 group-hover:rotate-3 group-hover:scale-105 ${presentation.iconBox}`}>
                  <Icon size={20} />
                </div>
                <div className="relative text-center mb-4">
                  <span className={`inline-flex px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${presentation.iconBox}`}>
                    {presentation.badge}
                  </span>
                  <h3 className="font-black text-gray-900 tracking-widest text-xs mt-2.5 uppercase">{presentation.title}</h3>
                </div>
                <div className={`relative text-center py-4 rounded-2xl border mb-5 shadow-inner ${presentation.priceBox}`}>
                  {hasAdjustedPrice && (
                    <div className={`mb-2 inline-flex rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${
                      effectivePrice < Number(pkg.price)
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-orange-200 bg-orange-50 text-orange-700'
                    }`}>
                      {dynamicEntry.priceLabel || (effectivePrice < Number(pkg.price) ? 'Giá ưu đãi' : 'Giá cao điểm')}
                    </div>
                  )}
                  {hasAdjustedPrice && (
                    <div className="text-xs font-bold text-gray-400 line-through">
                      {(pkg.price || 0).toLocaleString('vi-VN')} VND
                    </div>
                  )}
                  <div className={`text-xl font-black ${presentation.priceText}`}>
                    {effectivePrice.toLocaleString('vi-VN')} VND
                  </div>
                  <div className="text-xs font-medium text-gray-500 mt-1">{presentation.subtitle}</div>
                </div>
                <ul className="relative space-y-3 mb-5 flex-1">
                  {presentation.features.map((feature, featureIndex) => (
                    <li
                      key={feature}
                      className={`flex gap-2.5 text-xs ${
                        pkg.type === 'yearly' && featureIndex === 1 ? 'text-purple-600 font-bold' : 'text-gray-600'
                      }`}
                    >
                      <Check size={15} className={`${presentation.checkText} shrink-0`} />
                      <span>{feature}</span>
                    </li>
                  ))}
                  {pkg.description && (
                    <li className="flex gap-2.5 text-gray-500 text-xs">
                      <Check size={15} className={`${presentation.checkText} shrink-0`} />
                      <span>{pkg.description}</span>
                    </li>
                  )}
                </ul>
                {buttonState.disabled ? (
                  <button disabled className="relative w-full py-3 rounded-2xl font-bold text-gray-500 bg-gray-100 text-sm">
                    {buttonState.label}
                  </button>
                ) : (
                  <button
                    onClick={() => handleBuyPackage(pkg)}
                    className={`relative w-full py-3 rounded-2xl font-bold text-white text-sm transition duration-300 hover:-translate-y-0.5 active:translate-y-0 ${presentation.button}`}
                  >
                    {buttonState.label}
                  </button>
                )}
              </div>
            );
          })}

          {!loading && subscriptionPackages.length === 0 && (
            <div className={`${cardShellClass} min-h-[300px] justify-center border border-gray-100 text-center text-gray-500`}>
              <Crown size={32} className="mx-auto mb-3 text-gray-300" />
              <h3 className="font-black text-gray-900 mb-2">No VIP packages available</h3>
              <p className="text-sm">Please check back after admin activates a monthly or yearly package.</p>
            </div>
          )}

        </div>
      </div>

      {/* Select Slot Modal */}
      {showSlotModal && (
        <div className="fixed inset-0 bg-[#181C23]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black text-gray-900">Choose Fixed Parking Slots</h3>
                <p className="text-gray-500 mt-1">
                You currently have <span className="font-bold text-gray-900">{approvedVehicleCount}</span> approved vehicles.
                You can add up to <span className="font-bold text-gray-900">{availablePurchaseSlots}</span> parking slots.
                {approvedVehicleCount > 1 && (
                  <span className="block mt-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-md">
                    Tip: You can select fewer slots than vehicles to share slots among your vehicles.
                  </span>
                )}
              </p>
              </div>
              <button 
                onClick={() => setShowSlotModal(false)}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition"
              >
                ✕
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 bg-gray-50 flex flex-col md:flex-row gap-6">
              <div className="flex-1 rounded-2xl overflow-hidden border border-gray-200 shadow-sm relative min-h-[400px]">
                <ParkingMapViewer
                  floors={floors}
                  currentFloorId={currentFloorId}
                  dbSlots={dbSlots}
                  onFloorSelect={setCurrentFloorId}
                  onSelectSlot={(slotData) => handleSelectSlot(currentFloorId, { slotNumber: slotData.name || slotData.id })}
                  selectedSlotId={selectedSlots.map(s => `${s.floorId}:${s.slotCode}`)}
                  is2DMode={true}
                  hideUI={true}
                  theme="dark"
                  staticFit={true}
                />
              </div>
              
              <div className="w-full md:w-80 bg-white rounded-2xl border border-gray-200 p-6 shadow-sm flex flex-col">
                <div className="mb-6">
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-3">Parking floor</label>
                  <CustomFloorPicker
                    floors={floors}
                    value={currentFloorId || ''}
                    onChange={setCurrentFloorId}
                  />
                </div>
                
                <div className="mb-6 flex-1">
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-3">
                    Payment method
                  </label>
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <button 
                      onClick={() => setPaymentMethod('payos')}
                      className={`relative p-2.5 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-1.5 overflow-hidden ${
                        paymentMethod === 'payos' 
                        ? 'border-cyan-500 bg-cyan-500/10 shadow-[0_0_10px_rgba(6,182,212,0.2)]' 
                        : 'border-gray-800 bg-[#181c23] hover:border-gray-700 hover:bg-[#1f242d]'
                      }`}
                    >
                      {paymentMethod === 'payos' && (
                        <div className="absolute top-1.5 right-1.5">
                          <Check size={14} className="text-cyan-500" />
                        </div>
                      )}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${paymentMethod === 'payos' ? 'bg-cyan-500/20 text-cyan-500' : 'bg-gray-800 text-gray-400'}`}>
                        <QrCode size={16} />
                      </div>
                      <div className="text-center">
                        <div className={`font-black text-xs mb-0.5 ${paymentMethod === 'payos' ? 'text-cyan-400' : 'text-gray-300'}`}>PayOS</div>
                        <div className="text-[9px] text-gray-500 font-medium">QR code / Bank transfer</div>
                      </div>
                    </button>
                    
                    <button 
                      onClick={() => setPaymentMethod('wallet')}
                      className={`relative p-2.5 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-1.5 overflow-hidden ${
                        paymentMethod === 'wallet' 
                        ? 'border-gold bg-gold/10 shadow-[0_0_10px_rgba(251,191,36,0.15)]' 
                        : 'border-gray-800 bg-[#181c23] hover:border-gray-700 hover:bg-[#1f242d]'
                      }`}
                    >
                      {paymentMethod === 'wallet' && (
                        <div className="absolute top-1.5 right-1.5">
                          <Check size={14} className="text-gold" />
                        </div>
                      )}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${paymentMethod === 'wallet' ? 'bg-gold/20 text-gold' : 'bg-gray-800 text-gray-400'}`}>
                        <Wallet size={16} />
                      </div>
                      <div className="text-center">
                        <div className={`font-black text-xs mb-0.5 ${paymentMethod === 'wallet' ? 'text-gold' : 'text-gray-300'}`}>Wallet Valo</div>
                        <div className="text-[9px] text-gray-500 font-medium">Balance: {walletBalance.toLocaleString('vi-VN')} VND</div>
                      </div>
                    </button>
                  </div>
                  
                  {paymentMethod === 'wallet' && selectedPackage && walletBalance < (getEffectivePackagePrice(selectedPackage) * Math.max(1, selectedSlots.length)) && (
                    <div className="bg-rose-50 text-rose-600 text-xs p-3 rounded-xl border border-rose-100 flex gap-2 mt-4 font-medium items-start">
                      <AlertCircle className="shrink-0 w-4 h-4" />
                      <p>Insufficient balance. Please top up or use PayOS.</p>
                    </div>
                  )}

                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-3 mt-4">
                    Selected ({selectedSlots.length} / {availablePurchaseSlots})
                  </label>
                  <div className="space-y-2">
                    {selectedSlots.map(s => (
                      <div key={`${s.floorId}-${s.slotCode}`} className="flex items-center justify-between p-3 rounded-xl bg-gold/10 border border-gold/20 text-gold font-bold">
                        <span>Slot: {s.slotCode}</span>
                        <Check size={18} />
                      </div>
                    ))}
                    {selectedSlots.length === 0 && (
                      <div className="text-center py-8 text-gray-400 text-sm">
                        Click the map to choose a parking slot.
                      </div>
                    )}
                  </div>
                </div>
                
                <button
                  disabled={selectedSlots.length === 0 || verifying || (paymentMethod === 'wallet' && walletBalance < (getEffectivePackagePrice(selectedPackage) * Math.max(1, selectedSlots.length)))}
                  onClick={handleConfirmSlots}
                  className="w-full bg-gray-900 hover:bg-black text-white font-bold py-3.5 px-8 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  {verifying ? (
                    <span className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Processing...
                    </span>
                  ) : (
                    <>
                      Pay now {selectedPackage && selectedSlots.length > 0 ? `(${(getEffectivePackagePrice(selectedPackage) * selectedSlots.length).toLocaleString('vi-VN')} VND)` : ''} <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {success && (
        <div className="fixed inset-0 bg-[#181C23]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-8 shadow-2xl text-center animate-in fade-in zoom-in-95">
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center text-green-500 mx-auto mb-6">
              <Crown size={40} />
            </div>
            <h3 className="text-2xl font-black text-gray-900 mb-2">Welcome, VIP!</h3>
            <p className="text-gray-500 mb-8">Transaction successful. Your benefits are active and your slot has been reserved.</p>
            
            <button 
              onClick={() => window.location.href = '/'}
              className="w-full py-4 rounded-xl font-bold text-white bg-gray-900 hover:bg-black transition"
            >
              Back to home
            </button>
          </div>
        </div>
      )}

      <PolicyAcceptancePrompt
        open={policyPrompt.open}
        missingPolicies={policyPrompt.missingPolicies}
        onClose={() => setPolicyPrompt({ open: false, missingPolicies: [] })}
        onAccepted={() => {
          setPolicyPrompt({ open: false, missingPolicies: [] });
          handleConfirmSlots();
        }}
      />
    </div>
  );
}
