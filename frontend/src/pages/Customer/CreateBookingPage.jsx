import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Loader2,
  Lock,
  MapPin,
  Plus,
  Sparkles,
  Trash2,
  Wallet,
} from 'lucide-react';
import ParkingMapViewer from '../../components/ParkingMapViewer';

import PolicyAcceptancePrompt from '../../components/policies/PolicyAcceptancePrompt';
import { extractMissingPolicies, isPolicyAcceptanceRequired } from '../../utils/policyErrors';
import { getPolicyAcceptanceStatus } from '../../services/policyService';
import { getServices } from '../../services/extraServiceApi';
import { isValidLicensePlate } from '../../utils/licensePlate';
import { getMyVehicles } from '../../services/vehicleService';
import { getWalletInfo } from '../../services/walletService';
import { apiFetch } from '../../services/api';
import {
  createBulkBooking,
  createBookingHold,
  getAvailableBookingSlots,
  quoteBulkBooking,
  releaseBookingHold,
  getActiveHolds,
} from '../../services/bookingService';
import { QRCodeSVG } from 'qrcode.react';
import { createTopUpUrl, getTopUpStatus } from '../../services/walletService';
import { calculateBookingPrice } from '../../utils/bookingPricing';
import {
  filterUnexpiredBookingCart,
  readBookingCart,
  reconcileBookingCart,
  writeBookingCart,
} from '../../utils/bookingCartStorage';
import { findRequestedService } from '../../utils/bookingNavigation';

const formatMoney = (value = 0) => `${Number(value || 0).toLocaleString('vi-VN')} VND`;

const toDateTimeLocal = (date) => {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const getLocalDateString = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split('T')[0];
};

const getLocalTimeString = () => {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

const getMinEndTimeStr = (startStr) => {
  let [h, m] = startStr.split(':').map(Number);
  m += 30;
  if (m >= 60) {
    h += 1;
    m -= 60;
  }
  if (h >= 24) return '24:00';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const getInitialTimeRange = () => {
  const start = new Date();
  
  // Round up to the next 15-minute block (example: 9:07 -> 9:15)
  const minutes = start.getMinutes();
  const remainder = minutes % 15;
  const addMinutes = remainder === 0 ? 0 : 15 - remainder;
  
  start.setMinutes(minutes + addMinutes);
  start.setSeconds(0, 0);

  // Default checkout is 30 minutes after check-in
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + 30);

  return {
    startTime: toDateTimeLocal(start),
    endTime: toDateTimeLocal(end),
  };
};

const formatDateTime = (value) =>
  new Date(value).toLocaleString('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

const createClientItemId = () => (
  window.crypto?.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(16).slice(2)}`
);

const toItemErrorMap = (itemErrors = []) =>
  itemErrors.reduce((acc, itemError) => {
    if (itemError.clientItemId) {
      acc[itemError.clientItemId] = itemError;
    }
    return acc;
  }, {});

const TIME_OPTIONS = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}

const parseLocalDate = (value) => {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatVietnamesePlate = (plate) => {
  if (!plate) return null;
  const clean = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let province, series, numbers;
  if (clean.length === 9) {
    if (/^\d{2}[A-Z]\d\d{5}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 4); numbers = clean.slice(4); }
    else if (/^\d{2}[A-Z]{2}\d{5}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 4); numbers = clean.slice(4); }
  } else if (clean.length === 8) {
    if (/^\d{2}[A-Z]\d{5}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 3); numbers = clean.slice(3); }
    else if (/^\d{2}[A-Z]\d\d{4}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 4); numbers = clean.slice(4); }
    else if (/^\d{2}[A-Z]{2}\d{4}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 4); numbers = clean.slice(4); }
  } else if (clean.length === 7) {
    if (/^\d{2}[A-Z]\d{4}$/.test(clean)) { province = clean.slice(0, 2); series = clean.slice(2, 3); numbers = clean.slice(3); }
  }
  if (province && series && numbers) {
    let formattedNumbers = numbers;
    if (numbers.length === 5) { formattedNumbers = `${numbers.slice(0, 3)}.${numbers.slice(3)}`; }
    const isMotorbike = /\d/.test(series);
    if (isMotorbike) return `${province}-${series} ${formattedNumbers}`;
    else return `${province}${series} - ${formattedNumbers}`;
  }
  return null;
};

const formatLocalDateValue = (date) => {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const formatDateButtonLabel = (value) => {
  const date = parseLocalDate(value);
  return date
    ? date.toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : 'Select date';
};

const isSameCalendarDay = (left, right) =>
  Boolean(
    left &&
    right &&
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate(),
  );

const CustomDatePicker = ({ value, minDate, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedDate = parseLocalDate(value);
  const minimumDate = parseLocalDate(minDate);
  const [viewDate, setViewDate] = useState(() => selectedDate || new Date());
  const dropdownRef = useRef(null);

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

  const calendarDays = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const gridStart = new Date(year, month, 1 - firstWeekday);

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return date;
    });
  }, [viewDate]);

  const previousMonthEnd = new Date(
    viewDate.getFullYear(),
    viewDate.getMonth(),
    0,
  );
  const previousDisabled = Boolean(
    minimumDate && previousMonthEnd < minimumDate,
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const changeMonth = (offset) => {
    setViewDate(
      (current) => new Date(current.getFullYear(), current.getMonth() + offset, 1),
    );
  };

  const selectDate = (date) => {
    if (minimumDate && date < minimumDate) return;
    onChange(formatLocalDateValue(date));
    setIsOpen(false);
  };

  const toggleCalendar = () => {
    if (!isOpen && selectedDate) {
      setViewDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    }
    setIsOpen((current) => !current);
  };

  return (
    <div className="relative h-full flex-1" ref={dropdownRef}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={toggleCalendar}
        className="flex h-full w-full items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 text-left text-sm font-semibold text-gray-800 outline-none transition hover:border-gold/50 focus:border-gold focus:ring-1 focus:ring-gold"
      >
        <Calendar size={15} className="shrink-0 text-gray-400" />
        <span className="min-w-0 flex-1 truncate">{formatDateButtonLabel(value)}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Choose date"
          className="absolute left-0 top-full z-[60] mt-2 w-[292px] rounded-3xl border border-gray-100 bg-white p-4 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                Select date
              </div>
              <div className="mt-0.5 text-base font-black text-gray-900">
                {viewDate.toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric',
                })}
              </div>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                aria-label="Previous month"
                disabled={previousDisabled}
                onClick={() => changeMonth(-1)}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft size={17} />
              </button>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => changeMonth(1)}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>

          <div className="mb-1 grid grid-cols-7">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((weekday) => (
              <div
                key={weekday}
                className="py-1 text-center text-[10px] font-black uppercase tracking-wider text-gray-400"
              >
                {weekday}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-1">
            {calendarDays.map((date) => {
              const isOutsideMonth = date.getMonth() !== viewDate.getMonth();
              const isDisabled = Boolean(minimumDate && date < minimumDate);
              const isSelected = isSameCalendarDay(date, selectedDate);
              const isToday = isSameCalendarDay(date, today);

              return (
                <button
                  key={formatLocalDateValue(date)}
                  type="button"
                  disabled={isDisabled}
                  aria-label={date.toLocaleDateString('vi-VN')}
                  aria-pressed={isSelected}
                  onClick={() => selectDate(date)}
                  className={`mx-auto flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold transition ${
                    isSelected
                      ? 'bg-gold text-black shadow-md shadow-gold/25'
                      : isDisabled
                        ? 'cursor-not-allowed text-gray-200'
                        : isOutsideMonth
                          ? 'text-gray-300 hover:bg-gray-50 hover:text-gray-500'
                          : 'text-gray-700 hover:bg-gold/10 hover:text-gold'
                  } ${isToday && !isSelected ? 'ring-1 ring-inset ring-gold/50 text-gold' : ''}`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
            <span className="text-[10px] font-semibold text-gray-400">
              {minimumDate ? `From ${formatDateButtonLabel(minDate)}` : ''}
            </span>
            <button
              type="button"
              disabled={Boolean(minimumDate && today < minimumDate)}
              onClick={() => selectDate(today)}
              className="rounded-xl px-3 py-2 text-xs font-black text-gold transition hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-30"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const CustomTimePicker = ({ value, onChange, options, minTime }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll to the current time position when opening the dropdown
  useEffect(() => {
    if (isOpen && dropdownRef.current) {
      const activeEl = dropdownRef.current.querySelector('.active-time');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
    }
  }, [isOpen]);

  return (
    <div className="relative h-full" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-[100px] h-full rounded-xl bg-gray-50 border border-gray-200 px-3 text-sm font-semibold text-gray-800 outline-none focus:border-gold focus:ring-1 focus:ring-gold hover:border-gold/50 transition flex items-center justify-between"
      >
        <div className="flex items-center gap-1.5">
          <Clock size={14} className="text-gray-400" />
          <span>{value}</span>
        </div>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-36 max-h-64 overflow-y-auto bg-white border border-gray-100 rounded-2xl shadow-2xl z-50 py-2 time-scrollbar animate-in fade-in zoom-in-95 duration-100">
          <div className="px-3 pb-2 mb-2 border-b border-gray-100">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Select Time</span>
          </div>
          {options.map((time) => {
            const isActive = value === time;
            const isDisabled = minTime && time < minTime;
            return (
              <div
                key={time}
                onClick={() => {
                  if (isDisabled) return;
                  onChange(time);
                  setIsOpen(false);
                }}
                className={`mx-2 px-3 py-2.5 rounded-xl text-sm font-medium transition flex items-center justify-between ${
                  isDisabled
                    ? 'text-gray-300 bg-gray-50/50 cursor-not-allowed'
                    : isActive 
                      ? 'bg-gold/10 text-gold font-bold active-time cursor-pointer' 
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 cursor-pointer'
                }`}
              >
                {time}
                {isActive && <div className="w-1.5 h-1.5 rounded-full bg-gold"></div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const getVehicleOptionLabel = (vehicle) =>
  `${vehicle.licensePlate} - ${vehicle.brand || 'Vehicle'} ${vehicle.model || ''}`.trim();

const CustomVehiclePicker = ({ value, vehicles, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const selectedVehicle = vehicles.find((vehicle) => vehicle._id === value);
  const selectedLabel = selectedVehicle
    ? getVehicleOptionLabel(selectedVehicle)
    : 'Manual plate';

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

  const selectOption = (nextValue) => {
    onChange(nextValue);
    setIsOpen(false);
  };

  return (
    <div className="relative mt-1" ref={dropdownRef}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-11 w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 text-left text-sm font-semibold text-gray-800 outline-none transition hover:border-gold/50 focus:border-gold focus:ring-1 focus:ring-gold"
      >
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <ChevronDown
          size={15}
          className={`ml-3 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="time-scrollbar absolute left-0 right-0 top-full z-50 mt-2 max-h-64 overflow-y-auto rounded-2xl border border-gray-100 bg-white py-2 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="mb-2 border-b border-gray-100 px-4 pb-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Select vehicle
            </span>
          </div>

          {vehicles.map((vehicle) => {
            const isActive = value === vehicle._id;
            return (
              <button
                key={vehicle._id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => selectOption(vehicle._id)}
                className={`mx-2 flex w-[calc(100%_-_1rem)] items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${
                  isActive
                    ? 'bg-gold/10 font-bold text-gold'
                    : 'font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <span className="min-w-0 truncate">{getVehicleOptionLabel(vehicle)}</span>
                {isActive && <span className="ml-3 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />}
              </button>
            );
          })}

          <button
            type="button"
            role="option"
            aria-selected={value === ''}
            onClick={() => selectOption('')}
            className={`mx-2 flex w-[calc(100%_-_1rem)] items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${
              value === ''
                ? 'bg-gold/10 font-bold text-gold'
                : 'font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <span>Manual plate</span>
            {value === '' && <span className="ml-3 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />}
          </button>
        </div>
      )}
    </div>
  );
};

export default function CreateBookingPage() {
  const location = useLocation();
  const requestedServiceId = useMemo(
    () => new URLSearchParams(location.search).get('serviceId') || '',
    [location.search],
  );
  const handledRequestedServiceId = useRef('');
  const [initialRange] = useState(() => getInitialTimeRange());
  const [startDate, setStartDate] = useState(() => initialRange.startTime.split('T')[0]);
  const [startTimeStr, setStartTimeStr] = useState(() => initialRange.startTime.split('T')[1]);
  const [endDate, setEndDate] = useState(() => initialRange.endTime.split('T')[0]);
  const [endTimeStr, setEndTimeStr] = useState(() => initialRange.endTime.split('T')[1]);

  const startTime = `${startDate}T${startTimeStr}`;
  const endTime = `${endDate}T${endTimeStr}`;

  const [vehicles, setVehicles] = useState([]);
  const [vehicleId, setVehicleId] = useState('');
  const [manualPlate, setManualPlate] = useState('');
  const [profile, setProfile] = useState(null);
  const [services, setServices] = useState([]);
  const [selectedServices, setSelectedServices] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [slots, setSlots] = useState([]);
  const [selectedSlotKey, setSelectedSlotKey] = useState('');
  const [cartItems, setCartItems] = useState(() => readBookingCart());
  const [cartQuote, setCartQuote] = useState(null);
  const [cartItemErrors, setCartItemErrors] = useState({});
  const [editingClientItemId, setEditingClientItemId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkingSlots, setCheckingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // New states for Booking flow
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topUpData, setTopUpData] = useState(null); // { qrCode, checkoutUrl, amount }
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [topUpSuccess, setTopUpSuccess] = useState(false);

  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [bookingInfo, setBookingInfo] = useState(null);
  const [successRedirectCountdown, setSuccessRedirectCountdown] = useState(4);

  const [showGlobalPolicyModal, setShowGlobalPolicyModal] = useState(false);
  const [missingPolicies, setMissingPolicies] = useState([]);
  const [pendingPolicyAction, setPendingPolicyAction] = useState(null);

  // Map state
  const [floors, setFloors] = useState([]);
  const [pricingConfig, setPricingConfig] = useState(null);
  const [currentFloorId, setCurrentFloorId] = useState(null);
  const [dbSlots, setDbSlots] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [activeHolds, setActiveHolds] = useState([]);

  const fetchDbSlots = useCallback(async () => {
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
  }, [currentFloorId]);

  useEffect(() => {
    fetchDbSlots();
  }, [fetchDbSlots]);

  const fetchActiveHoldsData = async () => {
    try {
      const res = await getActiveHolds();
      if (res.ok && res.data?.data) {
        const nextActiveHolds = res.data.data;
        setActiveHolds(nextActiveHolds);
        setCartItems((current) => {
          const reconciled = reconcileBookingCart(current, nextActiveHolds);
          return reconciled.length === current.length ? current : reconciled;
        });
      }
    } catch (err) {
      console.error('Failed to fetch active holds', err);
    }
  };

  useEffect(() => {
    writeBookingCart(cartItems);
  }, [cartItems]);

  useEffect(() => {
    if (cartItems.length === 0) return undefined;

    const nextExpiry = Math.min(
      ...cartItems.map((item) => new Date(item.holdExpiresAt).getTime()),
    );
    const delay = Math.max(0, nextExpiry - Date.now());
    const timerId = window.setTimeout(() => {
      setCartItems((current) => filterUnexpiredBookingCart(current));
    }, delay + 50);

    return () => window.clearTimeout(timerId);
  }, [cartItems]);

  const fetchActiveSessions = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const res = await apiFetch('/sessions/active-status', {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (res.ok && res.data?.success) {
        setActiveSessions(res.data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch active parking sessions', err);
    }
  };

  useEffect(() => {
    fetchActiveSessions();
    fetchActiveHoldsData();
    const intervalId = setInterval(() => {
      fetchActiveSessions();
      fetchActiveHoldsData();
      fetchDbSlots();
    }, 30000); // 30s
    return () => clearInterval(intervalId);
  }, [fetchDbSlots]);

  const handleManualPlateChange = (event) => {
    const raw = event.target.value.toUpperCase();
    const clean = raw.replace(/[^A-Z0-9]/g, '');
    const formatted = formatVietnamesePlate(clean);
    setManualPlate(formatted || raw);
  };

  const handleStartChange = (newDate, newTime) => {
    setStartDate(newDate);
    setStartTimeStr(newTime);
    
    if (newDate && newTime) {
      const newStartObj = new Date(`${newDate}T${newTime}`);
      const currentEndObj = new Date(`${endDate}T${endTimeStr}`);
      
      const minEndObj = new Date(newStartObj);
      minEndObj.setMinutes(minEndObj.getMinutes() + 30);
      
      // If the current end time is earlier than the minimum end time (30 minutes later), adjust automatically
      if (currentEndObj < minEndObj) {
        const minEndStr = toDateTimeLocal(minEndObj);
        setEndDate(minEndStr.split('T')[0]);
        setEndTimeStr(minEndStr.split('T')[1]);
      }
    }
  };

  const handleEndChange = (newDate, newTime) => {
    if (newDate && newTime) {
      const startObj = new Date(`${startDate}T${startTimeStr}`);
      const newEndObj = new Date(`${newDate}T${newTime}`);
      
      const minEndObj = new Date(startObj);
      minEndObj.setMinutes(minEndObj.getMinutes() + 30);
      
      if (newEndObj < minEndObj) {
        const minEndStr = toDateTimeLocal(minEndObj);
        setEndDate(minEndStr.split('T')[0]);
        setEndTimeStr(minEndStr.split('T')[1]);
        return;
      }
    }
    setEndDate(newDate);
    setEndTimeStr(newTime);
  };

  const durationHours = useMemo(() => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diff = end.getTime() - start.getTime();
    if (!Number.isFinite(diff) || diff <= 0) return 0;
    return Math.ceil(diff / 3600000);
  }, [startTime, endTime]);

  const todayDateStr = getLocalDateString();
  const currentTimeStr = getLocalTimeString();

  const startMinTime = startDate === todayDateStr 
    ? currentTimeStr 
    : (startDate < todayDateStr ? '24:00' : null);

  const endMinTime = endDate === startDate 
    ? getMinEndTimeStr(startTimeStr) 
    : (endDate < startDate ? '24:00' : (endDate === todayDateStr ? currentTimeStr : (endDate < todayDateStr ? '24:00' : null)));

  const serviceTotal = useMemo(
    () =>
      services
        .filter((service) => selectedServices.includes(service._id))
        .reduce((total, service) => total + Number(service.price || 0), 0),
    [services, selectedServices]
  );

  const selectedSlot = slots.find((slot) => `${slot.floorId}:${slot.slotCode}` === selectedSlotKey);
  const selectedVehicle = vehicles.find((vehicle) => vehicle._id === vehicleId);
  const activeMembershipType = useMemo(() => {
    const membership = profile?.membership;
    if (!membership?.isVip || !membership?.expireAt) return null;
    const expireAt = new Date(membership.expireAt);
    if (Number.isNaN(expireAt.getTime()) || expireAt <= new Date()) return null;
    return ['monthly', 'yearly'].includes(membership.packageType) ? membership.packageType : null;
  }, [profile?.membership]);
  const selectedDbSlot = selectedSlot
    ? dbSlots.find((slot) => slot.slotNumber === selectedSlot.slotCode)
    : null;
  const selectedSlotReservedFor = selectedDbSlot?.reservedFor?._id || selectedDbSlot?.reservedFor || null;
  const rawManualPlateForCheck = manualPlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const currentLicensePlate = vehicleId ? selectedVehicle?.licensePlate : rawManualPlateForCheck;
  const isRegisteredPlate = vehicles.some(
    v => v.licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase() === currentLicensePlate
  );

  const selectedSlotIsOwnVipSlot = Boolean(
    activeMembershipType &&
    isRegisteredPlate &&
    selectedSlot &&
    selectedSlotReservedFor &&
    String(selectedSlotReservedFor) === String(profile?.id)
  );

  const selectedRegisteredVehicleBlockedByVip = Boolean(
    activeMembershipType &&
    isRegisteredPlate &&
    selectedSlot &&
    selectedDbSlot &&
    !selectedSlotIsOwnVipSlot
  );
  const pricePreview = useMemo(
    () => calculateBookingPrice(startTime, endTime, { 
      waiveOpeningFee: selectedSlotIsOwnVipSlot,
      config: pricingConfig
    }),
    [endTime, selectedSlotIsOwnVipSlot, startTime, pricingConfig]
  );
  const parkingTotal = selectedSlotIsOwnVipSlot ? 0 : pricePreview.totalAmount;
  const grandTotal = parkingTotal + serviceTotal;
  const walletBalance = Number(wallet?.balance || 0);
  const walletShortfall = Math.max(grandTotal - walletBalance, 0);
  const hasEnoughWallet = walletShortfall <= 0;
  const cartApiItems = useMemo(
    () => cartItems.map((item) => ({
      clientItemId: item.clientItemId,
      vehicleId: item.vehicleId || undefined,
      licensePlate: item.vehicleId ? undefined : item.licensePlate,
      floorId: item.floorId,
      slotCode: item.slotCode,
      startTime: item.startTime,
      endTime: item.endTime,
      serviceIds: item.serviceIds,
    })),
    [cartItems]
  );
  const cartGrandTotal = Number(
    cartQuote?.grandTotal ?? cartItems.reduce((total, item) => total + Number(item.totalAmount || 0), 0)
  );
  const cartWalletShortfall = Math.max(cartGrandTotal - walletBalance, 0);
  const hasActiveCheckoutHold = false;

  const loadData = () => {
    return Promise.all([
      getWalletInfo().then(res => res.ok ? res.data?.data : null).catch(() => null),
      getMyVehicles().then(res => res.ok ? res.data?.data : []).catch(() => []),
      apiFetch('/profile', {
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
      }).then(res => res.ok ? res.data?.data : null).catch(() => null),
      getServices().then(res => res.ok ? res.data?.data : []).catch(() => []),
      fetch(`${import.meta.env.VITE_API_BASE_URL}/parking-floors`).then(res => res.json().catch(() => ({}))),
      fetch(`${import.meta.env.VITE_API_BASE_URL}/pricing-config`).then(res => res.json().catch(() => ({}))),
    ]).then(([walletData, vehiclesData, profileData, servicesData, floorsData, pricingData]) => {
      if (walletData) setWallet(walletData);
      if (profileData) setProfile(profileData);
      if (vehiclesData) {
        setVehicles(vehiclesData);
        if (vehiclesData.length > 0) setVehicleId(vehiclesData[0]._id);
      }
      if (servicesData) setServices(servicesData);
      if (floorsData && floorsData.success) {
        const fls = floorsData.data || [];
        setFloors(fls);
        if (fls.length > 0) setCurrentFloorId(fls[0]._id);
      }
      if (pricingData && pricingData.success) {
        setPricingConfig(pricingData.data);
      }
    }).finally(() => {
      setLoading(false);
    });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      loadData();
      fetchActiveSessions();
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (
      loading ||
      !requestedServiceId ||
      handledRequestedServiceId.current === requestedServiceId
    ) {
      return;
    }

    handledRequestedServiceId.current = requestedServiceId;
    const requestedService = findRequestedService(services, requestedServiceId);
    const timer = window.setTimeout(() => {
      if (!requestedService) {
        setSuccess('');
        setError('The selected service is no longer available. Please choose another active service.');
        return;
      }

      setSelectedServices((current) =>
        current.includes(requestedService._id)
          ? current
          : [...current, requestedService._id]
      );
      setError('');
      setSuccess(`${requestedService.name} was added to your booking.`);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loading, requestedServiceId, services]);

  useEffect(() => {
    const refreshLiveMap = () => {
      fetchActiveSessions();
    };

    const intervalId = setInterval(refreshLiveMap, 15000);
    window.addEventListener('focus', refreshLiveMap);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', refreshLiveMap);
    };
  }, []);

  const latestActions = useRef({ loadData, handleCreateBooking: null });
  useEffect(() => {
    latestActions.current.loadData = loadData;
  });

  useEffect(() => {
    if (!showTopUpModal || !topUpData?.orderCode) return undefined;

    const intervalId = setInterval(async () => {
      try {
        const statusRes = await getTopUpStatus(topUpData.orderCode);
        const txStatus = String(statusRes.data?.data?.status || "").toUpperCase();

        if (["COMPLETED", "SUCCESS", "PAID"].includes(txStatus)) {
          clearInterval(intervalId);
          setTopUpSuccess(true);
          await latestActions.current.loadData(true);
          if (latestActions.current.handleCreateBooking) {
            await latestActions.current.handleCreateBooking();
          }
          setShowTopUpModal(false);
          setTopUpData(null);
          setTopUpSuccess(false);
        } else if (["CANCELLED", "CANCELED", "FAILED"].includes(txStatus)) {
          clearInterval(intervalId);
          setShowTopUpModal(false);
          setTopUpData(null);
          setTopUpSuccess(false);
          setError("Payment was cancelled or failed.");
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 3000);

    return () => clearInterval(intervalId);
  }, [showTopUpModal, topUpData?.orderCode]);

  useEffect(() => {
    if (!showSuccessModal || !bookingInfo) return undefined;

    const resetTimer = setTimeout(() => {
      setSuccessRedirectCountdown(4);
    }, 0);

    const countdownTimer = setInterval(() => {
      setSuccessRedirectCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownTimer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const redirectTimer = setTimeout(() => {
      setShowSuccessModal(false);
      setBookingInfo(null);
      window.location.href = '/customer/booking';
    }, 4000);

    return () => {
      clearTimeout(resetTimer);
      clearInterval(countdownTimer);
      clearTimeout(redirectTimer);
    };
  }, [showSuccessModal, bookingInfo]);

  const handleFindSlots = async () => {
    setCheckingSlots(true);
    setError('');
    setSuccess('');
    setSlots([]);

    try {
      const res = await getAvailableBookingSlots({
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
      });

      if (!res.ok) {
        if (isPolicyAcceptanceRequired(res.data)) {
          setMissingPolicies(extractMissingPolicies(res.data));
          setPendingPolicyAction(() => handleFindSlots);
          setShowGlobalPolicyModal(true);
        }
        setError(res.data?.message || 'Could not check available slots.');
        setSelectedSlotKey('');
        return;
      }

      const nextSlots = res.data?.data?.slots || [];
      setSlots(nextSlots);
      
      // Preserve selection if it's still available in the new time range
      if (selectedSlotKey) {
        const [fId, sCode] = selectedSlotKey.split(':');
        const stillAvailable = nextSlots.some(s => s.floorId === fId && s.slotCode === sCode);
        if (!stillAvailable) {
          setSelectedSlotKey('');
        }
      }
    } catch (err) {
      console.error('Error finding slots:', err);
      setError(`Network error while checking slots: ${err.message}`);
      setSelectedSlotKey('');
    } finally {
      setCheckingSlots(false);
    }
  };


  const handleAddOrUpdateCartItem = async () => {
    setError('');
    setSuccess('');

    const startObj = new Date(startTime);
    const endObj = new Date(endTime);
    const now = new Date();

    if (startObj < now) {
      setError('Start time cannot be in the past.');
      return;
    }

    if ((endObj.getTime() - startObj.getTime()) / 60000 < 30) {
      setError('Minimum booking duration is 30 minutes.');
      return;
    }

    if (!selectedSlot) {
      setError('Please select an available slot first.');
      return;
    }

    const rawManualPlate = manualPlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const formattedManualPlate = formatVietnamesePlate(rawManualPlate) || manualPlate.trim().toUpperCase();

    if (!vehicleId) {
      if (!rawManualPlate) {
        setError('Please select a vehicle or enter a license plate.');
        return;
      }
      if (!isValidLicensePlate(rawManualPlate)) {
        setError('Invalid Vietnamese license plate format. Please check again.');
        return;
      }
    }

    if (selectedRegisteredVehicleBlockedByVip) {
      setError('This vehicle is already covered by your active VIP membership. Please use your assigned VIP slot instead of booking another slot.');
      return;
    }

    if (!editingClientItemId && cartItems.length >= 5) {
      setError('You can add up to 5 vehicles in one checkout.');
      return;
    }

    const hasOverlap = (startA, endA, startB, endB) => startA < endB && endA > startB;

    const isDuplicate = cartItems.some((item) => {
      if (editingClientItemId === item.clientItemId) return false;
      const itemStart = new Date(item.startTime);
      const itemEnd = new Date(item.endTime);
      
      if (hasOverlap(startObj, endObj, itemStart, itemEnd)) {
        const itemPlateClean = item.licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        const isSameVehicle = (vehicleId && item.vehicleId === vehicleId) || 
                              (!vehicleId && rawManualPlate === itemPlateClean);
        if (isSameVehicle) {
          setError(`This vehicle is already in the booking list for an overlapping time.`);
          return true;
        }
        
        if (item.slotCode === selectedSlot.slotCode && item.floorId === selectedSlot.floorId) {
          setError(`Slot ${selectedSlot.slotCode} is already in the booking list for an overlapping time.`);
          return true;
        }
      }
      return false;
    });

    if (isDuplicate) return;

    setSubmitting(true);
    try {
      if (editingClientItemId) {
        const oldItem = cartItems.find(i => i.clientItemId === editingClientItemId);
        if (oldItem && oldItem.holdId) {
          await releaseBookingHold(oldItem.holdId).catch(() => {});
        }
      }

      const holdRes = await createBookingHold({
        floorId: selectedSlot.floorId,
        slotCode: selectedSlot.slotCode,
        licensePlate: vehicleId ? selectedVehicle?.licensePlate : rawManualPlate,
        startTime: startObj.toISOString(),
        endTime: endObj.toISOString(),
      });

      if (!holdRes.ok) {
        setError(holdRes.data?.message || 'Không thể giữ chỗ cho ô đỗ này. Có thể ai đó đã nhanh tay hơn!');
        return;
      }

    const nextItem = {
      clientItemId: editingClientItemId || createClientItemId(),
      vehicleId: vehicleId || '',
      licensePlate: vehicleId ? selectedVehicle?.licensePlate : rawManualPlate,
      vehicleLabel: vehicleId
        ? `${selectedVehicle?.licensePlate || 'Vehicle'} - ${selectedVehicle?.brand || 'Vehicle'} ${selectedVehicle?.model || ''}`.trim()
        : formattedManualPlate,
      floorId: selectedSlot.floorId,
      floorName: selectedSlot.floorName,
      slotCode: selectedSlot.slotCode,
      startTime: startObj.toISOString(),
      endTime: endObj.toISOString(),
      serviceIds: selectedServices,
      serviceNames: services
        .filter((service) => selectedServices.includes(service._id))
        .map((service) => service.name),
      parkingAmount: parkingTotal,
      serviceAmount: serviceTotal,
      totalAmount: grandTotal,
      pricingDetails: pricePreview,
      holdId: holdRes.data?.data?._id,
      holdExpiresAt: holdRes.data?.data?.expiresAt,
    };

    setCartItems((current) => {
      if (editingClientItemId) {
        return current.map((item) => item.clientItemId === editingClientItemId ? nextItem : item);
      }
      return [...current, nextItem];
    });

    setCartItemErrors({});
    setEditingClientItemId(null);
    setSuccess(editingClientItemId ? 'Booking item updated.' : 'Booking item added to the list.');
    fetchActiveHoldsData();

    setSelectedServices([]);
    handleFindSlots();
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditCartItem = (item) => {
    const localStart = toDateTimeLocal(new Date(item.startTime));
    const localEnd = toDateTimeLocal(new Date(item.endTime));

    setEditingClientItemId(item.clientItemId);
    setStartDate(localStart.split('T')[0]);
    setStartTimeStr(localStart.split('T')[1]);
    setEndDate(localEnd.split('T')[0]);
    setEndTimeStr(localEnd.split('T')[1]);
    setVehicleId(item.vehicleId || '');
    setManualPlate(item.vehicleId ? '' : item.licensePlate);
    setSelectedServices(item.serviceIds || []);
    setSelectedSlotKey(`${item.floorId}:${item.slotCode}`);
    setSuccess('');
    setError('');
  };

  const handleRemoveCartItem = async (clientItemId) => {
    const itemToRemove = cartItems.find(i => i.clientItemId === clientItemId);
    if (itemToRemove && itemToRemove.holdId) {
      await releaseBookingHold(itemToRemove.holdId).catch(() => {});
      handleFindSlots();
      fetchActiveHoldsData();
    }
    setCartItems((current) => current.filter((item) => item.clientItemId !== clientItemId));
    setCartItemErrors((current) => {
      const next = { ...current };
      delete next[clientItemId];
      return next;
    });
    if (editingClientItemId === clientItemId) {
      setEditingClientItemId(null);
    }
  };

  const startTopUpForShortfall = async (shortfall) => {
    const amountToTopUp = Math.ceil(Number(shortfall));
    if (!Number.isFinite(amountToTopUp) || amountToTopUp <= 0) {
      setError('Could not determine the remaining amount required for this booking.');
      return;
    }

    setTopUpLoading(true);
    try {
      const topUpRes = await createTopUpUrl(amountToTopUp, {
        purpose: 'booking_shortfall',
      });
      if (topUpRes.ok) {
        setTopUpData(topUpRes.data?.data);
        setShowTopUpModal(true);
      } else {
        setError('Insufficient balance and failed to generate top-up QR.');
      }
    } catch {
      setError('Insufficient balance. Network error while generating top-up QR.');
    } finally {
      setTopUpLoading(false);
    }
  };

  const cancelPendingBookingTopUp = async () => {
    const orderCode = topUpData?.orderCode;
    setTopUpLoading(true);

    try {
      if (orderCode) {
        const cancelRes = await getTopUpStatus(orderCode, true);
        if (!cancelRes.ok) {
          setError(cancelRes.data?.message || 'Could not cancel the pending top-up.');
        }
      }
    } catch {
      setError('Network error while cancelling the pending top-up.');
    } finally {
      setShowTopUpModal(false);
      setTopUpData(null);
      setTopUpSuccess(false);
      setTopUpLoading(false);
    }
  };


  useEffect(() => {
    const startObj = new Date(startTime);
    const endObj = new Date(endTime);
    const now = new Date();
    
    if (startObj < now) return;
    if ((endObj - startObj) / 60000 < 30) return;
    
    const timer = setTimeout(() => {
      handleFindSlots();
    }, 0);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime, endTime]);

  useEffect(() => {
    if (cartItems.length === 0) {
      const timer = setTimeout(() => {
        setCartQuote(null);
        setCartItemErrors({});
      }, 0);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(async () => {
      try {
        const res = await quoteBulkBooking({ items: cartApiItems });
        const data = res.data?.data || {};
        if (data.items || data.grandTotal !== undefined) {
          setCartQuote({
            grandTotal: data.grandTotal,
            walletBalance: data.walletBalance,
            shortfall: data.shortfall,
            items: data.items,
          });
        }
        setCartItemErrors(res.ok ? {} : toItemErrorMap(data.itemErrors || []));
      } catch (err) {
        console.error('Bulk quote failed', err);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [cartApiItems, cartItems.length]);


  const toggleService = (serviceId) => {
    setSelectedServices((current) =>
      current.includes(serviceId)
        ? current.filter((id) => id !== serviceId)
        : [...current, serviceId]
    );
  };

  const handleBookingClick = () => {
    if (Object.keys(cartItemErrors).length > 0) {
      setError('Fix highlighted booking items before checkout.');
      return;
    }
    executeCheckoutCart();
  };

  const executeCheckoutCart = async () => {
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      if (cartItems.length === 0) {
        setError('Add at least one vehicle to the booking list before checkout.');
        return;
      }

      if (Object.keys(cartItemErrors).length > 0) {
        setError('Fix highlighted booking items before checkout.');
        return;
      }

      const walletRes = await getWalletInfo();
      const latestWallet = walletRes.ok ? walletRes.data?.data : wallet;
      if (latestWallet) setWallet(latestWallet);

      const latestBalance = Number(latestWallet?.balance || 0);
      const latestShortfall = Math.max(cartGrandTotal - latestBalance, 0);
      if (latestShortfall > 0) {
        await startTopUpForShortfall(latestShortfall);
        return;
      }

      const checkoutItems = cartApiItems.map((item) => ({
        ...item,
        holdId: cartItems.find(c => c.clientItemId === item.clientItemId)?.holdId,
      }));

      const res = await createBulkBooking({
        idempotencyKey: createClientItemId(),
        items: checkoutItems,
      });

      if (!res.ok) {
        const errorMessage = res.data?.message || '';
        const itemErrors = res.data?.data?.itemErrors || [];
        
        if (isPolicyAcceptanceRequired(res.data)) {
          setMissingPolicies(extractMissingPolicies(res.data));
          setPendingPolicyAction(() => executeCheckoutCart);
          setShowGlobalPolicyModal(true);
        }

        if (itemErrors.length > 0) {
          setCartItemErrors(toItemErrorMap(itemErrors));
          setError(errorMessage || 'One or more booking items need attention.');
          return;
        }

        if (res.data?.code === 'INSUFFICIENT_WALLET_BALANCE' || errorMessage.toLowerCase().includes('insufficient')) {
          const shortfall = Math.max(Number(res.data?.data?.shortfall || 0), 0);
          await startTopUpForShortfall(shortfall);
          return;
        }

        setError(errorMessage || 'Could not create booking.');
        return;
      }

      setBookingInfo(res.data?.data);
      setShowSuccessModal(true);

      setSuccess(`Booking order created. Wallet charged ${formatMoney(res.data?.data?.grandTotal || cartGrandTotal)}.`);
      setCartItems([]);
      setCartQuote(null);
      setCartItemErrors({});
      setSelectedServices([]);
      setSelectedSlotKey('');
      await loadData(true);
    } catch {
      setError('Network error while creating booking order.');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    latestActions.current.handleCreateBooking = executeCheckoutCart;
  });

  const successBookingCards = bookingInfo?.bookings || (
    bookingInfo?._id
      ? [{
          bookingId: bookingInfo._id,
          qrCode: bookingInfo.qrCode || null,
          slotCode: bookingInfo.slotCode,
          licensePlate: bookingInfo.licensePlate,
          startTime: bookingInfo.startTime,
          endTime: bookingInfo.endTime,
          totalAmount: bookingInfo.finalAmount,
        }]
      : []
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] pt-24 pb-12">
        <Loader2 className="w-8 h-8 animate-spin text-gold" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-charcoal pt-24 pb-6 px-6 md:px-8 flex flex-col">
      <style dangerouslySetInnerHTML={{ __html: `
        .time-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .time-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .time-scrollbar::-webkit-scrollbar-thumb {
          background-color: #e5e7eb;
          border-radius: 20px;
        }
        .time-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: #d1d5db;
        }
      `}} />
      <div className="max-w-[1400px] mx-auto w-full flex-1 flex flex-col">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-4">
          <div>
            <h1 className="text-3xl lg:text-4xl font-black text-gray-900 tracking-tight">Book Parking</h1>
            <p className="text-gray-500 font-medium mt-1">Reserve your spot and check live availability.</p>
          </div>
          <div className="bg-white px-5 py-3 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
            <div>
              <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5 mb-0.5">
                <Wallet size={12} /> Wallet Balance
              </div>
              <div className="text-xl font-black text-gray-900">
                {wallet ? formatMoney(wallet.balance) : '0 VND'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => { window.location.href = '/customer/wallet'; }}
              className="w-10 h-10 rounded-xl bg-gold/10 text-gold flex items-center justify-center hover:bg-gold hover:text-white transition shadow-sm"
            >
              +
            </button>
          </div>
        </div>

        {(error || success) && (
          <div className={`mb-6 rounded-2xl border px-4 py-3 flex items-start gap-3 ${error
              ? 'bg-rose-50 border-rose-200 text-rose-600'
              : 'bg-emerald-50 border-emerald-200 text-emerald-600'
            }`}>
            {error ? <AlertCircle size={18} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
            <span className="text-sm font-semibold">{error || success}</span>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 flex-1 lg:min-h-0">
          <section className="xl:col-span-4 flex flex-col gap-4 xl:overflow-y-auto time-scrollbar xl:pr-2 pb-4 h-full">
            <div className="rounded-3xl bg-white border border-gray-200 p-4 shadow-sm shrink-0">
              <h2 className="text-lg font-black mb-3 text-gray-900">Booking Details</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-4">
                <div className="block">
                  <span className="text-[11px] text-gray-400 uppercase tracking-widest font-bold mb-1.5 block">Start time</span>
                  <div className="flex gap-2 h-11">
                    <CustomDatePicker
                      value={startDate}
                      minDate={todayDateStr}
                      onChange={(nextDate) => handleStartChange(nextDate, startTimeStr)}
                    />
                    <CustomTimePicker
                      value={startTimeStr}
                      onChange={(val) => handleStartChange(startDate, val)}
                      options={TIME_OPTIONS}
                      minTime={startMinTime}
                    />
                  </div>
                </div>
                <div className="block">
                  <span className="text-[11px] text-gray-400 uppercase tracking-widest font-bold mb-1.5 block">End time</span>
                  <div className="flex gap-2 h-11">
                    <CustomDatePicker
                      value={endDate}
                      minDate={startDate}
                      onChange={(nextDate) => handleEndChange(nextDate, endTimeStr)}
                    />
                    <CustomTimePicker
                      value={endTimeStr}
                      onChange={(val) => handleEndChange(endDate, val)}
                      options={TIME_OPTIONS}
                      minTime={endMinTime}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <span className="text-[11px] text-gray-400 uppercase tracking-widest font-bold">Vehicle</span>
                {vehicles.length > 0 ? (
                  <CustomVehiclePicker
                    value={vehicleId}
                    vehicles={vehicles}
                    onChange={setVehicleId}
                  />
                ) : (
                  <input
                    value={manualPlate}
                    onChange={handleManualPlateChange}
                    placeholder="License plate"
                    className="mt-1 w-full rounded-xl bg-gray-50 border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-800 outline-none focus:border-gold focus:ring-1 focus:ring-gold transition uppercase font-mono tracking-wider"
                  />
                )}

                {vehicleId === '' && vehicles.length > 0 && (
                  <input
                    value={manualPlate}
                    onChange={handleManualPlateChange}
                    placeholder="License plate"
                    className="mt-2 w-full rounded-xl bg-gray-50 border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-800 outline-none focus:border-gold focus:ring-1 focus:ring-gold transition uppercase font-mono tracking-wider"
                  />
                )}

                {activeMembershipType && isRegisteredPlate && selectedSlot && (
                  <div className={`mt-3 rounded-xl border px-3 py-2.5 text-xs font-semibold ${
                    selectedSlotIsOwnVipSlot
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}>
                    {selectedSlotIsOwnVipSlot
                      ? 'This is your assigned VIP slot, so this registered vehicle can use it while your membership is active.'
                      : 'This registered vehicle is covered by an active VIP membership. Please use your assigned VIP slot instead of booking another slot.'}
                  </div>
                )}
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] text-gray-400 uppercase tracking-widest font-bold">Extra services</span>
                  <span className="text-xs font-black text-gray-900">{formatMoney(serviceTotal)}</span>
                </div>
                <div className="space-y-1.5 max-h-32 overflow-auto pr-1 time-scrollbar">
                  {services.length === 0 ? (
                    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-400 font-medium">
                      No active services.
                    </div>
                  ) : (
                    services.map((service) => (
                      <button
                        key={service._id}
                        type="button"
                        onClick={() => toggleService(service._id)}
                        className={`w-full rounded-xl border px-3 py-2 text-left transition flex items-center justify-between ${
                          selectedServices.includes(service._id)
                            ? 'bg-gold/10 border-gold shadow-sm'
                            : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                            selectedServices.includes(service._id) ? 'bg-gold border-gold text-white' : 'border-gray-300 bg-white'
                          }`}>
                            {selectedServices.includes(service._id) && <Check size={12} strokeWidth={4} />}
                          </div>
                          <div>
                            <div className="font-bold text-[13px] text-gray-900 leading-tight">{service.name}</div>
                            <div className="text-[10px] font-medium text-gray-400 leading-tight">{service.timeCost || 30} mins</div>
                          </div>
                        </div>
                        <div className="text-[13px] font-black text-gray-900">{formatMoney(service.price)}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50 p-3 space-y-2 shadow-inner">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 font-medium flex items-center gap-2"><Clock size={15} /> Duration</span>
                  <span className="font-bold text-gray-900">{pricePreview.durationMinutes || 0} mins ({pricePreview.paidHours || 0} billable h)</span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 font-medium flex items-center gap-2"><CreditCard size={15} /> Parking</span>
                  <span className="font-bold text-gray-900 text-right">
                    {formatMoney(parkingTotal)}
                    {pricePreview.capApplied && (
                      <span className="block text-[10px] text-emerald-600">Cap {pricePreview.capHours}h applied</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 font-medium flex items-center gap-2"><Sparkles size={15} /> Services</span>
                  <span className="font-bold text-gray-900">{formatMoney(serviceTotal)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 font-medium flex items-center gap-2"><Wallet size={15} /> Wallet balance</span>
                  <span className={`font-bold ${hasEnoughWallet ? 'text-emerald-600' : 'text-rose-600'}`}>{formatMoney(walletBalance)}</span>
                </div>
                <div className="pt-3 border-t border-gray-200 flex items-center justify-between">
                  <span className="font-black text-gray-900">Wallet charge</span>
                  <span className="text-xl font-black text-gold">{formatMoney(grandTotal)}</span>
                </div>
                {!hasEnoughWallet && (
                  <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600">
                    Top up {formatMoney(walletShortfall)} before this slot can be held.
                  </div>
                )}
                {selectedSlot && hasEnoughWallet && (
                  <div className="rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-2 text-xs font-bold flex items-center gap-2 text-cyan-700">
                    <Lock size={14} />
                    This slot will be locked when you review checkout.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-1 shrink-0">
              <button
                type="button"
                onClick={handleAddOrUpdateCartItem}
                disabled={submitting || topUpLoading || !selectedSlot || durationHours <= 0 || checkingSlots}
                className="w-full rounded-2xl bg-gradient-to-r from-gold to-yellow-500 hover:from-yellow-500 hover:to-gold disabled:opacity-50 text-black px-4 py-4 font-black transition flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(212,175,55,0.4)] hover:shadow-[0_8px_25px_rgba(212,175,55,0.5)] active:scale-[0.98]"
              >
                <Plus size={18} />
                {editingClientItemId ? 'Update Booking Item' : 'Add to Booking List'}
              </button>
            </div>

            <div className="rounded-3xl bg-white border border-gray-200 p-4 shadow-sm shrink-0">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-lg font-black text-gray-900">Booking List</h2>
                  <p className="text-xs text-gray-500 font-medium">Checkout one or many vehicles together.</p>
                </div>
                <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-black text-gray-700">
                  {cartItems.length}/5
                </div>
              </div>

              {cartItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
                  <p className="text-sm font-bold text-gray-500">No vehicles added yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {cartItems.map((item, index) => {
                    const itemError = cartItemErrors[item.clientItemId];
                    const quotedItem = cartQuote?.items?.find((quoteItem) => quoteItem.clientItemId === item.clientItemId);
                    const itemTotal = quotedItem?.totalAmount ?? item.totalAmount;

                    return (
                      <div
                        key={item.clientItemId}
                        className={`rounded-2xl border p-3 ${
                          itemError ? 'border-rose-200 bg-rose-50' : 'border-gray-200 bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[11px] font-black text-gray-400 uppercase tracking-widest">
                              Vehicle {index + 1}
                            </div>
                            <div className="font-black text-gray-900 truncate">{item.vehicleLabel}</div>
                            <div className="text-xs font-semibold text-gray-500 mt-1">
                              Slot {item.slotCode} {item.floorName ? `- ${item.floorName}` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleEditCartItem(item)}
                              className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-black transition"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveCartItem(item.clientItemId)}
                              className="w-8 h-8 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-semibold text-gray-500">
                          <div>{formatDateTime(item.startTime)}</div>
                          <div>{formatDateTime(item.endTime)}</div>
                        </div>

                        {item.serviceNames.length > 0 && (
                          <div className="mt-2 text-xs font-semibold text-gray-500">
                            Services: {item.serviceNames.join(', ')}
                          </div>
                        )}

                        <div className="mt-3 flex items-center justify-between">
                          <span className={`text-xs font-black ${itemError ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {itemError ? itemError.message : 'Ready'}
                          </span>
                          <span className="text-sm font-black text-gray-900">{formatMoney(itemTotal)}</span>
                        </div>
                      </div>
                    );
                  })}

                  {hasActiveCheckoutHold && (
                    <div className="hidden"></div>
                  )}

                  <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 font-semibold">Wallet balance</span>
                      <span className="font-black text-gray-900">{formatMoney(walletBalance)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 font-semibold">Cart total</span>
                      <span className="font-black text-gold text-lg">{formatMoney(cartGrandTotal)}</span>
                    </div>
                    {cartWalletShortfall > 0 && (
                      <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600">
                        Top up {formatMoney(cartWalletShortfall)} before checkout. No bookings will be created until the full cart is covered.
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleBookingClick}
                    disabled={submitting || topUpLoading  || cartItems.length === 0}
                    className="w-full rounded-2xl bg-gray-900 hover:bg-black disabled:opacity-50 text-white px-4 py-4 font-black transition flex items-center justify-center gap-2 shadow-sm active:scale-[0.98]"
                  >
                    {(submitting || topUpLoading ) ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                    {cartWalletShortfall > 0 ? `Top Up ${formatMoney(cartWalletShortfall)}` : hasActiveCheckoutHold ? `Pay ${formatMoney(cartGrandTotal)}` : 'Booking'}
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="xl:col-span-8 rounded-3xl bg-white border border-gray-200 p-3 shadow-sm flex flex-col h-[500px] xl:h-[calc(100vh-140px)]">
            <div className="flex items-center justify-between gap-4 mb-3 px-2 pt-2">
              <div>
                <h2 className="text-lg font-black text-gray-900">Available Slots Map</h2>
                <p className="text-sm font-medium text-gray-500">
                  Select an available slot on the map. Occupied slots are shown live in red.
                </p>
              </div>
              <div className="text-sm text-emerald-600 font-bold px-3 py-1 bg-emerald-50 rounded-full border border-emerald-100">{slots.length} slot(s) available</div>
            </div>

            <div className="flex-1 w-full relative rounded-2xl overflow-hidden border border-[#0b0e16] bg-[#0b0e16] shadow-inner">
              {/* Floor Selection */}
              {floors.length > 0 && !checkingSlots && (
                <div className="absolute top-4 left-0 right-0 flex justify-center flex-wrap gap-2 z-30 px-4">
                  {floors.map(f => (
                    <button
                      key={f._id}
                      type="button"
                      onClick={() => setCurrentFloorId(f._id)}
                      className={`px-6 py-1.5 rounded-full font-bold text-xs transition-all shadow-sm ${
                        currentFloorId === f._id
                          ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20'
                          : 'bg-[#181c23]/80 border border-white/10 text-gray-400 hover:text-white hover:bg-[#1f242d]/80 backdrop-blur'
                      }`}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              )}

              {checkingSlots && (
                <div className="absolute inset-0 z-20 bg-[#0b0e16]/80 backdrop-blur-sm flex flex-col items-center justify-center text-center p-8">
                  <Loader2 size={40} className="text-cyan-400 animate-spin mb-4" />
                  <p className="font-black text-white">Finding available slots...</p>
                </div>
              )}

              {slots.length === 0 && !checkingSlots && (
                <div className="absolute inset-0 z-10 bg-[#0b0e16]/80 backdrop-blur-md flex flex-col items-center justify-center text-center p-8">
                  <div className="w-16 h-16 bg-[#181c23] shadow-xl shadow-black/50 border border-white/10 rounded-full flex items-center justify-center mb-4">
                    <MapPin className="w-8 h-8 text-cyan-500" />
                  </div>
                  <p className="font-black text-white text-xl">Select a valid time range</p>
                  <p className="text-sm font-medium text-gray-400 mt-2 max-w-xs mx-auto">Please adjust your start and end time to view available parking spaces.</p>
                </div>
              )}

              <ParkingMapViewer
                floors={floors}
                currentFloorId={currentFloorId}
                onFloorSelect={setCurrentFloorId}
                activeSessions={activeSessions}
                dbSlots={dbSlots}
                activeHolds={activeHolds}
                availableSlots={slots}
                selectedSlotId={
                  cartItems.length > 0 
                    ? [...cartItems.map(item => `${item.floorId}:${item.slotCode}`), selectedSlotKey].filter(Boolean)
                    : (selectedSlotKey || null)
                }
                onSelectSlot={(slot, floorId) => setSelectedSlotKey(`${floorId}:${slot.id}`)}
                is2DMode={true}
                hideUI={true}
                theme="dark"
              />

              {/* Legend Overlay */}
              {!checkingSlots && slots.length > 0 && (
                <div className="absolute bottom-4 left-0 right-0 flex justify-center z-30 pointer-events-none px-4">
                  <div className="bg-[#181c23]/80 backdrop-blur border border-white/10 px-5 py-2.5 rounded-full flex items-center gap-4 shadow-lg pointer-events-auto">
                    <p className="text-cyan-400 font-black text-[10px] uppercase tracking-widest pr-2 hidden sm:block">Status Legend</p>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3.5 h-3.5 rounded-sm bg-white border border-gray-300"></div>
                      <span className="text-[10px] text-gray-300 font-bold tracking-wide">Available</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3.5 h-3.5 rounded-sm bg-rose-200 border border-rose-600"></div>
                      <span className="text-[10px] text-gray-300 font-bold tracking-wide">Occupied</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3.5 h-3.5 rounded-sm bg-cyan-500 border border-cyan-400"></div>
                      <span className="text-[10px] text-gray-300 font-bold tracking-wide">Selected</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3.5 h-3.5 rounded-sm bg-yellow-100 border border-yellow-500"></div>
                      <span className="text-[10px] text-yellow-500 font-bold tracking-wide">VIP Pass</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3.5 h-3.5 rounded-sm bg-red-200 border border-red-500" style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.2), rgba(239, 68, 68, 0.2) 4px, rgba(127, 29, 29, 0.3) 4px, rgba(127, 29, 29, 0.3) 8px)' }}></div>
                      <span className="text-[10px] text-gray-300 font-bold tracking-wide">Maintenance</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3.5 h-3.5 rounded-sm bg-orange-100 border border-orange-500"></div>
                      <span className="text-[10px] text-orange-500 font-bold tracking-wide">Hold/Booked</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* SUCCESS MODAL */}
      {showSuccessModal && bookingInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-md">
          <div className="relative bg-white border border-emerald-100 rounded-[32px] p-7 max-w-3xl w-full max-h-[90vh] flex flex-col items-center text-center shadow-[0_30px_90px_rgba(16,185,129,0.18)] overflow-y-auto">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-emerald-300 via-teal-300 to-cyan-300" />
            <div className="absolute -top-16 -right-10 w-36 h-36 rounded-full bg-emerald-100/70 blur-2xl" />
            <div className="absolute -bottom-14 -left-8 w-28 h-28 rounded-full bg-cyan-100/70 blur-2xl" />

            <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-emerald-100 to-teal-50 flex items-center justify-center text-emerald-500 mb-4 shadow-sm border border-emerald-200/70">
              <CheckCircle2 size={30} />
            </div>
            <div className="relative inline-flex items-center rounded-full bg-emerald-50 border border-emerald-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-emerald-600 mb-3">
              Sweet Success
            </div>
            <h2 className="text-[32px] leading-none font-black text-gray-900 mb-2">Booking Confirmed</h2>
            <p className="text-gray-500 font-medium text-sm mb-5 max-w-[260px]">
              Everything is ready. Each vehicle has its own QR for check-in.
            </p>

            <div className="w-full bg-[#f8fafc] border border-gray-100 rounded-[24px] p-4 text-left space-y-3 mb-5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 font-semibold">Order total</span>
                <span className="font-black text-gray-900 text-lg">{formatMoney(bookingInfo.grandTotal || bookingInfo.finalAmount || 0)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 font-semibold">Bookings</span>
                <span className="font-black text-gray-900">{successBookingCards.length}</span>
              </div>
            </div>

            <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              {successBookingCards.map((booking, index) => (
                <div key={booking.bookingId || booking._id || index} className="bg-white border border-gray-100 p-4 rounded-[24px] text-left shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Booking {index + 1}</div>
                      <div className="font-black text-gray-900">{booking.licensePlate || 'Vehicle'}</div>
                    </div>
                    <div className="font-black text-gold">{booking.slotCode}</div>
                  </div>
                  <div className="flex justify-center bg-gray-50 border border-gray-100 rounded-2xl p-3 mb-3">
                    {booking.qrCode ? (
                      <QRCodeSVG value={String(booking.qrCode)} size={140} />
                    ) : (
                      <div className="flex min-h-36 items-center justify-center px-4 text-center text-xs font-bold text-amber-600">
                        QR check-in is temporarily unavailable. Open My Bookings to reload it.
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between gap-3">
                      <span className="text-gray-500 font-semibold">From</span>
                      <span className="font-bold text-gray-900 text-right">{formatDateTime(booking.startTime)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-gray-500 font-semibold">Until</span>
                      <span className="font-bold text-gray-900 text-right">{formatDateTime(booking.endTime)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="w-full bg-gradient-to-r from-emerald-50 to-cyan-50 border border-emerald-100 text-emerald-700 font-bold py-3.5 px-4 rounded-[22px] text-sm leading-relaxed">
              Your booking was successful. Automatically redirecting to My Bookings in{" "}
              <span className="inline-flex min-w-8 justify-center rounded-full bg-white/80 px-2 py-0.5 text-emerald-600 shadow-sm">
                {successRedirectCountdown}s
              </span>
            </div>

            <p className="mt-3 text-[11px] text-gray-400 font-medium">
              Booking status will sync automatically when the kiosk updates.
            </p>
          </div>
        </div>
      )}

      {/* TOP UP MODAL */}
      {showTopUpModal && topUpData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-md">
          <div className="bg-white border border-gray-100 rounded-3xl p-8 max-w-sm w-full flex flex-col items-center text-center shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-rose-50 flex items-center justify-center text-rose-500 mb-4 shadow-sm">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-2xl font-black text-gray-900 mb-1">Insufficient Balance</h2>
            <p className="text-gray-500 font-medium text-sm mb-6">
              You need to top up <span className="font-bold text-gray-900">{formatMoney(topUpData.amount)}</span> to complete this checkout.
            </p>

            <div className="bg-gray-50 border border-gray-100 p-4 rounded-2xl mb-4 shadow-inner">
              {topUpData.qrCode ? (
                <QRCodeSVG value={topUpData.qrCode} size={200} />
              ) : (
                <div className="w-[200px] h-[200px] flex items-center justify-center text-gray-400 font-medium text-sm">
                  No QR data
                </div>
              )}
            </div>

            <p className="text-xs text-gray-500 font-medium mb-6">
              Scan with your banking app or e-wallet to pay.<br />
              Alternatively, <a href={topUpData.checkoutUrl} target="_blank" rel="noreferrer" className="text-blue-500 font-bold hover:underline">click here to checkout</a>.
            </p>

            <div className="flex items-center justify-center gap-2 mb-6 text-sm text-gold font-black">
              <Loader2 size={16} className="animate-spin" />
              {topUpSuccess ? "Payment received! Processing checkout..." : "Waiting for your payment..."}
            </div>

            <div className="flex gap-3 w-full">
              <button
                disabled={topUpSuccess || topUpLoading}
                onClick={cancelPendingBookingTopUp}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3.5 rounded-2xl transition disabled:opacity-50 active:scale-[0.98]"
              >
                {topUpLoading ? 'Cancelling...' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}




      <PolicyAcceptancePrompt
        open={showGlobalPolicyModal}
        missingPolicies={missingPolicies}
        onClose={() => setShowGlobalPolicyModal(false)}
        onAccepted={() => {
          setShowGlobalPolicyModal(false);
          if (pendingPolicyAction) {
            pendingPolicyAction();
          }
        }}
      />
    </div>
  );
}
