import { useState, useEffect, useMemo } from 'react';
import { format, addDays, subDays, startOfDay, differenceInMinutes } from 'date-fns';
import {
  ChevronLeft, ChevronRight, Clock, MapPin, User, CheckCircle,
  Search, Filter, Loader2, Car, CreditCard, LayoutGrid,
  ArrowRight, ShieldCheck, Activity, XCircle, BarChart3,
  CircleDollarSign, Ban, BadgeCheck, TrendingUp, RefreshCw, AlertTriangle
} from 'lucide-react';
import { getAllFloors } from '../../services/parkingFloorService';
import { getAllBookings } from '../../services/bookingService';
import { getAdminBookingStatistics } from '../../services/statisticsService';
import {
  getOperationalValue,
  getOperationalViewState,
  getResponseAvailability,
} from '../../utils/staffOperationalAvailability';
import { Toaster } from 'react-hot-toast';
import StaffDropdown from './components/StaffDropdown.jsx';
import { STAFF_THEME } from './components/staffTheme.js';

const STATISTICS_RANGES = [
  { value: 'daily', label: 'Daily' },
  { value: 'all', label: 'All time' },
];

const STAT_CARD_TONES = {
  emerald: {
    icon: 'border-emerald-400/25 bg-emerald-500/15 text-emerald-300',
    glow: 'bg-emerald-500/10',
    value: 'text-emerald-300',
  },
  red: {
    icon: 'border-red-400/25 bg-red-500/15 text-red-300',
    glow: 'bg-red-500/10',
    value: 'text-red-300',
  },
  sky: {
    icon: 'border-sky-400/25 bg-sky-500/15 text-sky-300',
    glow: 'bg-sky-500/10',
    value: 'text-sky-300',
  },
  gold: {
    icon: 'border-amber-400/25 bg-amber-500/15 text-amber-300',
    glow: 'bg-amber-500/10',
    value: 'text-amber-300',
  },
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const formatStatisticsPeriod = (period, range) => {
  if (!period?.endDate) return '';
  if (range === 'daily' && period.startDate) {
    return `Booking History for ${format(
      new Date(period.startDate),
      'dd/MM/yyyy'
    )}`;
  }
  const end = format(new Date(period.endDate), 'dd/MM/yyyy HH:mm');
  if (!period.startDate) return `All records through ${end}`;
  return `${format(new Date(period.startDate), 'dd/MM/yyyy HH:mm')} – ${end}`;
};

const formatStatisticsAvailability = (availability) => {
  if (!availability?.earliestBookingAt || !availability?.latestBookingAt) return '';
  return `${format(new Date(availability.earliestBookingAt), 'dd/MM/yyyy')} – ${format(
    new Date(availability.latestBookingAt),
    'dd/MM/yyyy'
  )}`;
};

const BookingStatCard = ({ icon, label, value, note, tone = 'emerald' }) => {
  const colors = STAT_CARD_TONES[tone];
  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#121214]/90 p-4 shadow-xl transition hover:-translate-y-0.5 hover:border-white/15">
      <div className={`pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full blur-3xl ${colors.glow}`} />
      <div className="relative flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${colors.icon}`}>
          {icon}
        </div>
        <p className={`min-w-0 flex-1 text-[22px] font-black leading-none tracking-tight tabular-nums ${colors.value}`}>
          {value}
        </p>
        <Activity size={13} className="shrink-0 text-white/15 transition group-hover:text-emerald-400/60" />
      </div>
      <p className="relative mt-2 text-[9px] font-black uppercase leading-4 tracking-[0.16em] text-white/45">
        {label}
      </p>
      <p className="relative mt-2 text-[10px] font-medium leading-4 text-white/35">{note}</p>
    </div>
  );
};

const safeFormat = (date, fmt) => {
  if (!date) return 'N/A';
  const d = new Date(date);
  return isNaN(d.getTime()) ? 'Invalid' : format(d, fmt);
};

const parseDatePickerValue = (value) => {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  const parsedDate = new Date(year, month - 1, day);
  return isNaN(parsedDate.getTime()) ? null : startOfDay(parsedDate);
};

// --- Helper Functions ---
const getBookingGroup = (status) => {
  if (['ACTIVE', 'PAUSED'].includes(status)) return 'ACTIVE';
  if (['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(status)) return 'HISTORY';
  return 'UPCOMING';
};

const getStatusStyle = (status) => {
  switch (status) {
    case 'ACTIVE': return { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', glow: 'shadow-[0_0_15px_rgba(16,185,129,0.2)]' };
    case 'OVERDUE': return { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/35', glow: 'shadow-[0_0_15px_rgba(239,68,68,0.25)]' };
    case 'PAID': return { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30', glow: 'shadow-[0_0_15px_rgba(59,130,246,0.2)]' };
    case 'PENDING': return { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30', glow: 'shadow-[0_0_15px_rgba(245,158,11,0.2)]' };
    case 'COMPLETED': return { bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/30', glow: '' };
    case 'CANCELLED':
    case 'EXPIRED': return { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30', glow: 'shadow-[0_0_15px_rgba(239,68,68,0.2)]' };
    default: return { bg: 'bg-white/5', text: 'text-white/50', border: 'border-white/10', glow: '' };
  }
};

const isBookingOverdue = (booking, now) => {
  if (booking?.status !== 'ACTIVE' || !booking?.scheduledEnd) return false;
  const endDate = new Date(booking.scheduledEnd);
  return !isNaN(endDate.getTime()) && now.getTime() > endDate.getTime();
};

const getBookingDisplayStatus = (booking, now) =>
  isBookingOverdue(booking, now) ? 'OVERDUE' : booking?.status || 'UNKNOWN';

const getExceededMinutes = (end, now) => {
  const endDate = new Date(end);
  if (isNaN(endDate.getTime())) return 0;
  return Math.max(1, Math.floor((now.getTime() - endDate.getTime()) / 60000));
};

const formatExceededDuration = (minutes) => {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

const LicensePlate = ({ plate, size = 'sm' }) => (
  <div className={`inline-flex items-center justify-center border border-white/20 rounded-md bg-black/80 font-mono font-bold uppercase tracking-widest text-white shadow-inner ${size === 'sm' ? 'px-2 py-0.5 text-sm' : 'px-4 py-1.5 text-2xl'}`}>
    {plate || 'UNKNOWN'}
  </div>
);

const ProgressBar = ({ start, end, now }) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const hasValidSchedule =
    !isNaN(startDate.getTime()) &&
    !isNaN(endDate.getTime()) &&
    endDate.getTime() > startDate.getTime();
  const isOverdue = hasValidSchedule && now.getTime() > endDate.getTime();
  const total = endDate.getTime() - startDate.getTime();
  const elapsed = now.getTime() - startDate.getTime();
  const progress = !hasValidSchedule || now < startDate
    ? 0
    : isOverdue
      ? 100
      : Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
  const exceededDuration = isOverdue
    ? formatExceededDuration(getExceededMinutes(end, now))
    : '';

  return (
    <div className="w-full mt-4">
      <div className={`flex justify-between text-[10px] mb-2 font-bold uppercase tracking-widest ${isOverdue ? 'text-red-400' : 'text-emerald-400/80'}`}>
        <span className="flex items-center gap-1">
          {isOverdue
            ? <AlertTriangle size={10} />
            : <Activity size={10} className="animate-pulse" />}
          {isOverdue ? 'Overdue' : 'Duration Progress'}
        </span>
        <span>{progress}%</span>
      </div>
      {isOverdue && (
        <p className="mb-2 text-[10px] font-bold text-red-300/90">
          Exceeded by {exceededDuration}
        </p>
      )}
      <div className="h-1.5 w-full bg-[#0b0e14] rounded-full overflow-hidden border border-white/5 shadow-inner">
        <div
          className={`h-full rounded-full transition-all duration-1000 relative ${
            isOverdue
              ? 'bg-gradient-to-r from-orange-600 to-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]'
              : 'bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.8)]'
          }`}
          style={{ width: `${progress}%` }}
        >
          <div className="absolute top-0 right-0 bottom-0 left-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.4)_50%,transparent_100%)] animate-[shimmer_2s_infinite]" style={{ backgroundSize: '200% 100%' }} />
        </div>
      </div>
    </div>
  );
};

export default function BookingManagement() {
  const [currentDate, setCurrentDate] = useState(startOfDay(new Date()));
  const [floors, setFloors] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState('');

  const [selectedFloor, setSelectedFloor] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [statisticsRange, setStatisticsRange] = useState('daily');
  const [statistics, setStatistics] = useState(null);
  const [statisticsLoading, setStatisticsLoading] = useState(true);
  const [statisticsError, setStatisticsError] = useState('');
  const [statisticsRefreshKey, setStatisticsRefreshKey] = useState(0);
  const [statisticsUpdatedAt, setStatisticsUpdatedAt] = useState(null);
  const [clockNow, setClockNow] = useState(() => new Date());
  const bookingState = getOperationalViewState({ loading, error: dataError });
  const selectedDateKey = format(currentDate, 'yyyy-MM-dd');
  const statisticsDateFilter =
    statisticsRange === 'daily' ? selectedDateKey : '';
  const statisticsFloorFilter =
    statisticsRange === 'daily' && selectedFloor !== 'all'
      ? selectedFloor
      : '';

  useEffect(() => {
    document.body.classList.add("bg-[#080808]");
    return () => document.body.classList.remove("bg-[#080808]");
  }, []);

  useEffect(() => {
    const liveClock = setInterval(() => setClockNow(new Date()), 30000);
    return () => clearInterval(liveClock);
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setDataError('');
      setSelectedBooking(null);
      try {
        const [floorsRes, bookingsRes] = await Promise.all([
          getAllFloors(),
          getAllBookings({ date: format(currentDate, 'yyyy-MM-dd') })
        ]);
        const floorsState = getResponseAvailability(floorsRes, 'Unable to load parking floors.');
        const bookingsState = getResponseAvailability(bookingsRes, 'Unable to load bookings.');
        if (!floorsState.isAvailable || !bookingsState.isAvailable) {
          setFloors([]);
          setBookings([]);
          setDataError(
            [
              !floorsState.isAvailable ? floorsState.error : '',
              !bookingsState.isAvailable ? bookingsState.error : '',
            ].filter(Boolean).join(' '),
          );
          return;
        }
        setFloors(floorsState.data || floorsRes.data.floors || []);
        setBookings(bookingsState.data || []);
        setSelectedBooking(null);
      } catch (error) {
        setFloors([]);
        setBookings([]);
        setDataError(error?.message || 'Failed to load booking data.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [currentDate]);

  useEffect(() => {
    let activeRequest = true;
    let latestRequestId = 0;

    const fetchStatistics = async () => {
      const requestId = ++latestRequestId;
      setStatisticsLoading(true);
      setStatisticsError('');

      const response = await getAdminBookingStatistics(
        statisticsRange,
        {
          ...(statisticsDateFilter ? { date: statisticsDateFilter } : {}),
          ...(statisticsFloorFilter ? { floorId: statisticsFloorFilter } : {}),
        }
      );
      if (!activeRequest || requestId !== latestRequestId) return;

      if (
        response.ok &&
        response.data?.success &&
        response.data.data?.completed &&
        response.data.data?.cancelled
      ) {
        setStatistics(response.data.data);
        setStatisticsUpdatedAt(new Date());
      } else {
        setStatistics(null);
        setStatisticsError(
          response.data?.message || 'Booking statistics could not be loaded.'
        );
      }
      setStatisticsLoading(false);
    };

    const initialFetch = setTimeout(fetchStatistics, 0);
    const liveInterval = setInterval(fetchStatistics, 30000);
    return () => {
      activeRequest = false;
      clearTimeout(initialFetch);
      clearInterval(liveInterval);
    };
  }, [
    statisticsRange,
    statisticsDateFilter,
    statisticsFloorFilter,
    statisticsRefreshKey,
  ]);

  // Filter bookings
  const filteredBookings = useMemo(() => {
    return bookings.filter(b => {
      if (selectedFloor !== 'all' && (b.floorId?._id || b.floorId) !== selectedFloor) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return b.licensePlate?.toLowerCase().includes(q) ||
          b.userId?.fullName?.toLowerCase().includes(q) ||
          String(b.parkingSlot).toLowerCase().includes(q);
      }
      return true;
    });
  }, [bookings, selectedFloor, searchQuery]);

  // Group bookings
  const { upcoming, active, history } = useMemo(() => {
    const groups = { upcoming: [], active: [], history: [] };
    filteredBookings.forEach(b => {
      const group = getBookingGroup(b.status, b.scheduledStart);
      if (group === 'UPCOMING') groups.upcoming.push(b);
      else if (group === 'ACTIVE') groups.active.push(b);
      else groups.history.push(b);
    });

    // Sort logic
    groups.upcoming.sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart));
    groups.active.sort((a, b) => new Date(b.scheduledStart) - new Date(a.scheduledStart)); // Newest first
    groups.history.sort((a, b) => new Date(b.scheduledEnd) - new Date(a.scheduledEnd)); // Newest finished first

    return groups;
  }, [filteredBookings]);

  const currentBooking = bookingState.isAvailable
    ? selectedBooking || active[0] || upcoming[0] || history[0]
    : null;
  const currentBookingDisplayStatus = currentBooking
    ? getBookingDisplayStatus(currentBooking, clockNow)
    : null;
  const completedStatistics = statistics?.completed || {};
  const cancelledStatistics = statistics?.cancelled || {};
  const statisticsPeriodLabel = formatStatisticsPeriod(
    statistics?.period,
    statisticsRange
  );
  const statisticsAvailabilityLabel = formatStatisticsAvailability(
    statistics?.availability
  );

  const renderBookingCard = (booking, groupType) => {
    const isSelected = currentBooking?._id === booking._id;
    const displayStatus = getBookingDisplayStatus(booking, clockNow);
    const s = getStatusStyle(displayStatus);

    return (
      <div
        key={booking._id}
        onClick={() => setSelectedBooking(booking)}
        className={`group relative overflow-hidden rounded-2xl border p-3.5 cursor-pointer transition-all duration-300 ${isSelected
            ? 'bg-gradient-to-br from-white/10 to-transparent border-white/20 shadow-[0_5px_20px_rgba(0,0,0,0.3)] scale-[1.01]'
            : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05] hover:border-white/15'
          }`}
      >
        {isSelected && (
          <div className={`absolute top-0 right-0 w-24 h-24 ${s.bg} rounded-full mix-blend-overlay blur-3xl opacity-40`} />
        )}

        <div className="flex justify-between items-center gap-3 mb-2 relative z-10">
          <div className="flex items-center gap-2">
            <LicensePlate plate={booking.licensePlate} />
            <p className="text-xs font-semibold text-white/80 line-clamp-1">{booking.userId?.fullName || 'Guest'}</p>
          </div>
          <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${s.bg} ${s.text} ${s.border} ${s.glow}`}>
            {displayStatus}
          </span>
        </div>

        <div className="flex items-center justify-between text-[11px] relative z-10 mt-3 text-white/60">
          <div className="flex items-center gap-1.5">
            <MapPin size={12} className="text-amber-400" />
            <span className="font-medium">{booking.floorId?.name || 'Floor'} - {booking.parkingSlot}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock size={12} className="text-sky-400" />
            <span className="font-medium">{safeFormat(booking.scheduledStart, 'HH:mm')} - {safeFormat(booking.scheduledEnd, 'HH:mm')}</span>
          </div>
        </div>

        {groupType === 'ACTIVE' && (
          <ProgressBar
            start={booking.scheduledStart}
            end={booking.scheduledEnd}
            now={clockNow}
          />
        )}
      </div>
    );
  };

  return (
    <div className={`${STAFF_THEME.page} relative flex min-h-[calc(100vh-70px)] flex-col overflow-hidden p-4 font-sans md:p-8`}
      style={{ backgroundImage: `linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`, backgroundSize: '40px 40px' }}>

      <div className="pointer-events-none absolute left-[20%] top-0 h-[600px] w-[600px] rounded-full bg-[#ffd555]/[0.035] blur-[120px]" />

      <Toaster position="top-right" toastOptions={{ className: 'bg-[#18181b] text-white border border-white/10 shadow-2xl' }} />

        {/* --- HEADER --- */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6 mb-8 shrink-0 relative z-10">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <h1 className={STAFF_THEME.title}>Booking Management</h1>
          </div>
          <p className="text-white/50 text-sm max-w-xl font-medium">Monitor all reservations, active parking sessions, and historical data in real-time.</p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex bg-[#121214] border border-white/10 rounded-2xl p-1.5 shadow-lg">
            <div className="flex flex-col items-center px-5 py-1">
              <span className="text-[9px] uppercase font-bold text-white/40 tracking-widest mb-0.5">Active</span>
              <span className="text-emerald-400 font-black text-xl leading-none drop-shadow-[0_0_8px_rgba(16,185,129,0.4)]">{getOperationalValue(bookingState, active.length)}</span>
            </div>
            <div className="w-px bg-white/10 my-1" />
            <div className="flex flex-col items-center px-5 py-1">
              <span className="text-[9px] uppercase font-bold text-white/40 tracking-widest mb-0.5">Upcoming</span>
              <span className="text-amber-400 font-black text-xl leading-none drop-shadow-[0_0_8px_rgba(245,158,11,0.4)]">{getOperationalValue(bookingState, upcoming.length)}</span>
            </div>
            <div className="w-px bg-white/10 my-1" />
            <div className="flex flex-col items-center px-5 py-1">
              <span className="text-[9px] uppercase font-bold text-white/40 tracking-widest mb-0.5">Total</span>
              <span className="text-white font-black text-xl leading-none">{getOperationalValue(bookingState, filteredBookings.length)}</span>
            </div>
          </div>

          <div className="flex items-center bg-[#121214] rounded-2xl border border-white/10 p-1.5 shadow-lg relative overflow-hidden">
            <button
              onClick={() => setCurrentDate(subDays(currentDate, 1))}
              className="p-2.5 hover:bg-white/10 rounded-xl transition-all text-white/50 hover:text-white"
            >
              <ChevronLeft size={18} />
            </button>
            <label
              className="relative flex min-w-[140px] cursor-pointer flex-col items-center justify-center px-4"
              title="Choose booking date"
            >
              <span className="mb-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-[#d7b94a]">{format(currentDate, 'EEEE')}</span>
              <span className="text-lg font-bold leading-none text-white">{format(currentDate, 'MMM dd, yyyy')}</span>
              <input
                type="date"
                aria-label="Choose booking date"
                value={selectedDateKey}
                onChange={(event) => {
                  const selectedDate = parseDatePickerValue(event.target.value);
                  if (selectedDate) setCurrentDate(selectedDate);
                }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
            <button
              onClick={() => setCurrentDate(addDays(currentDate, 1))}
              className="p-2.5 hover:bg-white/10 rounded-xl transition-all text-white/50 hover:text-white"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* --- BOOKING PERFORMANCE --- */}
      <section className="relative z-10 mb-5 shrink-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111111] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.28)] md:p-5">
        <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-[#ffd555]/[0.05] blur-[90px]" />
        <div className="relative flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#ffd555]/25 bg-[#ffd555]/15 text-[#ffd555]">
                <BarChart3 size={16} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-extrabold tracking-tight text-white">
                    Booking Performance
                  </h2>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-widest ${statisticsError ? 'border-red-400/20 bg-red-500/10 text-red-300' : statisticsLoading ? 'border-amber-400/20 bg-amber-500/10 text-amber-300' : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${statisticsError ? 'bg-red-400' : statisticsLoading ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400 animate-pulse'}`} />
                    {statisticsError ? 'Data unavailable' : statisticsLoading ? 'Updating' : 'Live'}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] font-medium text-white/40">
                  Completed booking outcomes and realized revenue only.
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] font-medium text-white/35">
              <span>
                {statisticsLoading
                  ? 'Updating selected period…'
                  : statisticsPeriodLabel || 'No period available'}
              </span>
              {statisticsUpdatedAt && (
                <span className="inline-flex items-center gap-1.5 text-emerald-400/65">
                  <Activity size={11} />
                  Synced {format(statisticsUpdatedAt, 'HH:mm:ss')}
                </span>
              )}
              {statisticsAvailabilityLabel && (
                <span>Data available {statisticsAvailabilityLabel}</span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {STATISTICS_RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={statisticsRange === option.value}
                onClick={() => setStatisticsRange(option.value)}
                className={`rounded-xl border px-3 py-1.5 text-[10px] font-bold transition ${
                  statisticsRange === option.value
                    ? 'border-[#ffd555]/35 bg-[#ffd555]/15 text-[#ffd555] shadow-[0_0_16px_rgba(255,213,85,0.08)]'
                    : 'border-white/[0.08] bg-white/[0.03] text-white/40 hover:border-white/15 hover:text-white/70'
                }`}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setStatisticsRefreshKey((value) => value + 1)}
              disabled={statisticsLoading}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-white/40 transition hover:border-[#ffd555]/25 hover:text-[#ffd555] disabled:cursor-wait disabled:opacity-50"
              title="Refresh booking statistics"
            >
              <RefreshCw size={14} className={statisticsLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {statisticsError && (
          <div className="relative mt-4 flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-2.5 text-[11px] font-medium text-red-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
            <span>{statisticsError}</span>
          </div>
        )}

        <div className={`relative mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 ${statisticsLoading ? 'opacity-60' : ''}`}>
          <BookingStatCard
            icon={<CircleDollarSign size={17} />}
            label="Completed Gross Revenue"
            value={statistics ? formatCurrency(completedStatistics.grossRevenue) : '—'}
            note={
              statistics
                ? `${formatCurrency(completedStatistics.prepaidRevenue)} base + ${formatCurrency(completedStatistics.additionalRevenue)} additional`
                : 'Base payments plus additional charges before refunds'
            }
            tone="emerald"
          />
          <BookingStatCard
            icon={<Ban size={17} />}
            label="Cancelled Bookings"
            value={statistics ? cancelledStatistics.count || 0 : '—'}
            note="Excluded from all completed revenue totals"
            tone="red"
          />
          <BookingStatCard
            icon={<BadgeCheck size={17} />}
            label="Completed Bookings"
            value={statistics ? completedStatistics.count || 0 : '—'}
            note="Completed bookings shown in the selected day's History"
            tone="sky"
          />
          <BookingStatCard
            icon={<TrendingUp size={17} />}
            label="Actual Completed Revenue"
            value={statistics ? formatCurrency(completedStatistics.actualRevenue) : '—'}
            note={
              statistics
                ? `${formatCurrency(completedStatistics.refundPaid)} refunded from Completed bookings`
                : 'Completed gross revenue less paid refunds'
            }
            tone="gold"
          />
        </div>
      </section>

      {/* --- CONTROLS --- */}
      <div className="flex flex-wrap gap-4 items-center mb-6 shrink-0 relative z-10">
        <div className="relative w-full md:w-[350px] group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 transition-colors group-focus-within:text-[#ffd555]" size={18} />
          <input
            type="text"
            placeholder="Search plate, name, slot..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full rounded-full border border-white/[0.08] bg-[#111] py-3.5 pl-12 pr-4 text-sm font-medium text-white shadow-inner outline-none transition-all placeholder:text-white/30 focus:border-[#ffd555]/50 focus:ring-1 focus:ring-[#ffd555]/30"
          />
        </div>

        <StaffDropdown
          value={selectedFloor}
          onChange={setSelectedFloor}
          options={[
            ['all', 'All Floors'],
            ...floors.map((floor) => [floor._id, floor.name]),
          ]}
          ariaLabel="Filter bookings by floor"
          icon={Filter}
          align="right"
          className="min-w-[200px]"
          buttonClassName="h-12 rounded-2xl bg-[#121214]/80 px-4 backdrop-blur-md"
          menuClassName="w-full min-w-[200px]"
        />
      </div>

      {/* --- MAIN CONTENT SPLIT VIEW --- */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-8 relative z-10">

        {/* LEFT PANEL: Booking List */}
        <div className="w-full lg:w-[420px] xl:w-[480px] shrink-0 flex flex-col gap-8 overflow-y-auto custom-scrollbar pr-4 pb-6">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center text-white/30 gap-4">
              <Loader2 className="animate-spin text-emerald-500" size={32} />
              <span className="font-medium tracking-wide">Syncing bookings...</span>
            </div>
          ) : dataError ? (
            <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-red-500/30 rounded-[32px] bg-red-500/[0.05] text-red-200 text-center px-6" role="alert">
              <AlertTriangle size={40} className="mb-4 text-red-400" />
              <p className="font-medium">Booking data unavailable</p>
              <p className="mt-2 text-sm text-red-200/70">{dataError}</p>
            </div>
          ) : filteredBookings.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-[32px] bg-white/[0.02] text-white/40">
              <Car size={48} className="mb-4 opacity-30 text-white/50" />
              <p className="font-medium">No bookings found for this day.</p>
            </div>
          ) : (
            <>
              {/* Active Section */}
              {active.length > 0 && (
                <section className="space-y-4">
                  <div className="sticky top-0 z-20 border-b border-white/5 bg-[#080808]/90 py-3 backdrop-blur-md">
                    <h2 className="text-xs font-bold tracking-[0.2em] uppercase text-emerald-400 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                      Currently Parked ({active.length})
                    </h2>
                  </div>
                  <div className="flex flex-col gap-4">
                    {active.map(b => renderBookingCard(b, 'ACTIVE'))}
                  </div>
                </section>
              )}

              {/* Upcoming Section */}
              {upcoming.length > 0 && (
                <section className="space-y-4">
                  <div className="sticky top-0 z-20 mt-4 border-b border-white/5 bg-[#080808]/90 py-3 backdrop-blur-md">
                    <h2 className="text-xs font-bold tracking-[0.2em] uppercase text-amber-400 flex items-center gap-2">
                      <Clock size={14} />
                      Arriving Soon ({upcoming.length})
                    </h2>
                  </div>
                  <div className="flex flex-col gap-4">
                    {upcoming.map(b => renderBookingCard(b, 'UPCOMING'))}
                  </div>
                </section>
              )}

              {/* History Section */}
              {history.length > 0 && (
                <section className="space-y-4">
                  <div className="sticky top-0 z-20 mt-4 border-b border-white/5 bg-[#080808]/90 py-3 backdrop-blur-md">
                    <h2 className="text-xs font-bold tracking-[0.2em] uppercase text-white/50 flex items-center gap-2">
                      <CheckCircle size={14} />
                      History ({history.length})
                    </h2>
                  </div>
                  <div className="flex flex-col gap-4">
                    {history.map(b => renderBookingCard(b, 'HISTORY'))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* RIGHT PANEL: Details View */}
        <div className="flex-1 bg-[#121214]/60 backdrop-blur-2xl border border-white/10 rounded-[40px] shadow-2xl overflow-hidden hidden md:flex flex-col relative">
          {!currentBooking ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/30 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white/5 to-transparent">
              <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-white/10 bg-[#080808] shadow-inner shadow-white/5">
                <LayoutGrid size={32} className="text-white/40" />
              </div>
              <p className="text-lg font-medium tracking-wide">Select a booking to view details</p>
            </div>
          ) : (
            <div className="h-full flex flex-col">
              {/* Hero Header */}
              <div className="relative shrink-0 bg-gradient-to-b from-[#18181b] to-[#121214] border-b border-white/5 p-10 overflow-hidden">
                <div className="absolute -right-20 -top-20 w-80 h-80 bg-emerald-500 rounded-full mix-blend-overlay blur-[100px] opacity-10" />
                <div className="absolute left-0 bottom-0 w-64 h-64 bg-blue-500 rounded-full mix-blend-overlay blur-[80px] opacity-10" />

                <div className="relative z-10 flex flex-col gap-8">

                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/40 mb-3 flex items-center gap-2">
                        <ShieldCheck size={14} className="text-emerald-400" /> Booking Reference
                      </p>
                      <div className="flex items-end gap-5">
                        <LicensePlate plate={currentBooking.licensePlate} size="lg" />
                        <div className="mb-1">
                          <p className="text-xs font-semibold text-white/50 mb-1">Internal Ref ID</p>
                          <p className="text-sm font-mono text-white bg-black/40 px-3 py-1 rounded-lg border border-white/10">
                            {currentBooking._id?.toUpperCase() || 'N/A'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold uppercase tracking-[0.2em] border shadow-lg backdrop-blur-md
                        ${getStatusStyle(currentBookingDisplayStatus).bg}
                        ${getStatusStyle(currentBookingDisplayStatus).text}
                        ${getStatusStyle(currentBookingDisplayStatus).border}
                      `}>
                        {currentBooking.status === 'CANCELLED' && <XCircle size={14} />}
                        {currentBooking.status === 'COMPLETED' && <CheckCircle size={14} />}
                        {currentBookingDisplayStatus === 'ACTIVE' && <Activity size={14} className="animate-pulse" />}
                        {currentBookingDisplayStatus === 'OVERDUE' && <AlertTriangle size={14} />}
                        {currentBookingDisplayStatus}
                      </span>
                    </div>
                  </div>

                </div>
              </div>

              {/* Scrollable Details */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-10">
                <div className="max-w-4xl mx-auto space-y-8">

                  {/* Timeline Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hidden md:flex items-center justify-center w-10 h-10 rounded-full bg-[#121214] border border-white/10 text-white/40">
                      <ArrowRight size={18} />
                    </div>

                    <div className="group rounded-[32px] bg-gradient-to-br from-[#18181b] to-[#121214] border border-white/5 p-8 hover:border-white/10 transition-all shadow-xl">
                      <p className="text-xs font-bold uppercase tracking-[0.3em] text-white/40 mb-6 flex items-center gap-2">
                        <Clock size={14} className="text-sky-400" /> Start Schedule
                      </p>
                      <div className="flex items-baseline gap-3">
                        <p className="text-5xl font-extrabold text-white tracking-tight">{safeFormat(currentBooking.scheduledStart, 'HH:mm')}</p>
                        <p className="text-sm font-medium text-white/50">{safeFormat(currentBooking.scheduledStart, 'MMM dd, yyyy')}</p>
                      </div>
                    </div>

                    <div className="group rounded-[32px] bg-gradient-to-br from-[#18181b] to-[#121214] border border-white/5 p-8 hover:border-white/10 transition-all shadow-xl">
                      <p className="text-xs font-bold uppercase tracking-[0.3em] text-white/40 mb-6 flex items-center gap-2">
                        <Clock size={14} className="text-amber-400" /> End Schedule
                      </p>
                      <div className="flex items-baseline gap-3">
                        <p className="text-5xl font-extrabold text-white tracking-tight">{safeFormat(currentBooking.scheduledEnd, 'HH:mm')}</p>
                        <p className="text-sm font-medium text-white/50">{safeFormat(currentBooking.scheduledEnd, 'MMM dd, yyyy')}</p>
                      </div>
                    </div>
                  </div>

                  {/* Info Grid */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {/* Customer */}
                    <div className="overflow-hidden rounded-2xl border border-white/5 bg-[#0b0b0b] p-6 transition-colors hover:bg-white/[0.02]">
                      <div className="flex items-center gap-4 mb-5">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center border border-indigo-500/30 text-indigo-400 shrink-0">
                          <User size={20} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 mb-1">Customer</p>
                          <p className="text-lg font-bold text-white truncate" title={currentBooking.userId?.fullName}>{currentBooking.userId?.fullName || 'Guest User'}</p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-white/5 pb-3">
                          <p className="text-xs font-medium text-white/40 shrink-0">Email</p>
                          <p className="text-xs font-semibold text-white truncate max-w-[60%] text-right" title={currentBooking.userId?.email}>{currentBooking.userId?.email || 'N/A'}</p>
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <p className="text-xs font-medium text-white/40 shrink-0">Phone</p>
                          <p className="text-xs font-semibold text-white truncate">{currentBooking.userId?.phone || 'N/A'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Location */}
                    <div className="overflow-hidden rounded-2xl border border-white/5 bg-[#0b0b0b] p-6 transition-colors hover:bg-white/[0.02]">
                      <div className="flex items-center gap-4 mb-5">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center border border-emerald-500/30 text-emerald-400 shrink-0">
                          <MapPin size={20} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 mb-1">Location</p>
                          <p className="text-lg font-bold text-white truncate" title={currentBooking.floorId?.name}>{currentBooking.floorId?.name || 'Unknown Floor'}</p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-white/5 pb-3">
                          <p className="text-xs font-medium text-white/40 shrink-0">Allocated Slot</p>
                          <p className="text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-md border border-emerald-400/20">
                            {currentBooking.parkingSlot || '—'}
                          </p>
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <p className="text-xs font-medium text-white/40 shrink-0">Floor Level</p>
                          <p className="text-xs font-semibold text-white">{currentBooking.floorId?.floorNumber || '—'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Payment */}
                    <div className="overflow-hidden rounded-2xl border border-white/5 bg-[#0b0b0b] p-6 transition-colors hover:bg-white/[0.02]">
                      <div className="flex items-center gap-4 mb-5">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center border border-amber-500/30 text-amber-400 shrink-0">
                          <CreditCard size={20} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 mb-1">Actual Revenue</p>
                          <p className="text-lg font-bold text-white truncate">
                            {formatCurrency(
                              currentBooking.financialSummary?.actualRevenue ??
                              currentBooking.prepaidAmount
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-white/5 pb-3">
                          <p className="text-xs font-medium text-white/40 shrink-0">Base Payment</p>
                          <p className="text-xs font-semibold text-white">
                            {formatCurrency(
                              currentBooking.financialSummary?.prepaidCollected ??
                              currentBooking.prepaidAmount
                            )}
                          </p>
                        </div>
                        <div className="flex items-center justify-between border-b border-white/5 pb-3">
                          <p className="text-xs font-medium text-white/40 shrink-0">Additional Charges</p>
                          <p className="text-xs font-semibold text-amber-300">
                            {formatCurrency(currentBooking.financialSummary?.additionalCollected)}
                          </p>
                        </div>
                        <div className="flex items-center justify-between border-b border-white/5 pb-3">
                          <p className="text-xs font-medium text-white/40 shrink-0">Refund Paid</p>
                          <p className="text-xs font-semibold text-red-300">
                            {formatCurrency(currentBooking.financialSummary?.refundPaid)}
                          </p>
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <p className="text-xs font-medium text-white/40 shrink-0">Method</p>
                          <p className="text-xs font-semibold text-white capitalize truncate">
                            {currentBooking.paymentMethod || 'Wallet'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Summary */}
                    <div className="overflow-hidden rounded-2xl border border-white/5 bg-[#0b0b0b] p-6 transition-colors hover:bg-white/[0.02]">
                      <div className="flex items-center gap-4 mb-5">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500/20 to-blue-500/20 flex items-center justify-center border border-sky-500/30 text-sky-400 shrink-0">
                          <Activity size={20} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 mb-1">Summary</p>
                          <p className="text-lg font-bold text-white truncate">
                            {currentBooking.durationHours || Math.max(1, Math.round(differenceInMinutes(new Date(currentBooking.scheduledEnd), new Date(currentBooking.scheduledStart)) / 60))} Hours Total
                          </p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-white/5 pb-3">
                          <p className="text-xs font-medium text-white/40 shrink-0">Created At</p>
                          <p className="text-xs font-semibold text-white/80 truncate text-right">{safeFormat(currentBooking.createdAt, 'MMM dd, yyyy HH:mm')}</p>
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <p className="text-xs font-medium text-white/40 shrink-0">Last Updated</p>
                          <p className="text-xs font-semibold text-white/80 truncate text-right">{safeFormat(currentBooking.updatedAt, 'MMM dd, yyyy HH:mm')}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
