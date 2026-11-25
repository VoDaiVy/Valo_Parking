import './BookingPage.css';
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import { useLanguage } from '../../i18n/hooks/useLanguage';
import TelegramReceiptModal from '../../components/TelegramReceiptModal';
import TelegramReceiptButton from '../../components/TelegramReceiptButton';
import BookingFeedbackModal from '../../components/Customer/BookingFeedbackModal';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Edit3,
  Loader2,
  QrCode,
  RotateCcw,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  TimerReset,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import {
  cancelBooking,
  extendBooking,
  getBookingCancellationQuote,
  getBookingQr,
  getMyBookings,
  updateBookingVehicle,
} from '../../services/bookingService';
import { getMyVehicles } from '../../services/vehicleService';
import { getAllFloors } from '../../services/parkingFloorService';
import { useSocket } from '../../hooks/useSocket';
import CustomerPageHeader from '../../components/Customer/CustomerPageHeader';
import { formatLicensePlateDisplay } from '../../utils/licensePlate';
import { buildFloorLookup, getBookingFloorLabel } from '../../utils/bookingFloor';

const moneyWithLocale = (value = 0, locale) => `${Number(value || 0).toLocaleString(locale)} VND`;

function BookingDropdown({ label, value, onChange, options }) {
  return (
    <div className="booking-dropdown">
      <Listbox value={value} onChange={onChange}>
        <ListboxButton aria-label={label} className="booking-dropdown-button">
          <span>{options.find((option) => option.value === value)?.label}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </ListboxButton>
        <ListboxOptions anchor="bottom start" className="booking-dropdown-menu">
          {options.map((option) => (
            <ListboxOption key={option.value} value={option.value} className="booking-dropdown-option">
              {({ selected }) => (
                <><span>{option.label}</span>{selected && <Check size={16} aria-hidden="true" />}</>
              )}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </Listbox>
    </div>
  );
}

const formatBookingPeriod = (startValue, endValue, locale) => {
  const start = new Date(startValue);
  const end = new Date(endValue);
  const date = (value) => value.toLocaleDateString(locale, { dateStyle: 'short' });
  const time = (value) => value.toLocaleTimeString(locale, { timeStyle: 'short' });
  const sameDay = start.getFullYear() === end.getFullYear()
    && start.getMonth() === end.getMonth() && start.getDate() === end.getDate();
  return {
    dates: sameDay ? date(start) : `${date(start)} \u2013 ${date(end)}`,
    times: `${time(start)} \u2013 ${time(end)}`,
  };
};

const getBookingStatus = (booking) => String(booking?.status || '').toUpperCase();
const getBookingStart = (booking) => booking.scheduledStart || booking.startTime;
const getBookingEnd = (booking) => booking.scheduledEnd || booking.endTime;
const getBookingSlot = (booking) => booking.parkingSlot || booking.slotCode || '--';
const getBookingPaidAmount = (booking) => {
  const candidates = [
    booking?.prepaidAmount,
    booking?.paymentBreakdownSnapshot?.totalAmount,
    booking?.finalAmount,
    booking?.totalAmount,
  ];
  const amount = candidates.find((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  return Number(amount || 0);
};

const statusClass = (status) => {
  const normalizedStatus = String(status || '').toUpperCase();
  if (normalizedStatus === 'PAID') return 'bg-[#f5d76d]/10 text-[#f7d76b] border border-[#f5d76d]/30';
  if (normalizedStatus === 'ACTIVE') return 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30';
  if (normalizedStatus === 'PAUSED') return 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/30';
  if (normalizedStatus === 'COMPLETED') return 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30';
  if (normalizedStatus === 'CANCELLED') return 'bg-rose-500/10 text-rose-300 border border-rose-500/30';
  return 'bg-amber-500/10 text-amber-300 border border-amber-500/30';
};

const addMinutesLocalInput = (dateValue, minutes) => {
  const date = new Date(dateValue);
  date.setMinutes(date.getMinutes() + minutes);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const getBookingTiming = (booking) => {
  const now = new Date();
  const status = getBookingStatus(booking);
  const start = new Date(getBookingStart(booking));
  const end = new Date(getBookingEnd(booking));
  const minutesToStart = Math.ceil((start.getTime() - now.getTime()) / 60000);
  const minutesToEnd = Math.ceil((end.getTime() - now.getTime()) / 60000);

  return {
    canEditBeforeCheckIn: status === 'PAID' && now < start,
    canExtend: ['PAID', 'ACTIVE', 'PAUSED'].includes(status),
    canComplete: false, // Customers cannot complete/check-out remotely. Must use Kiosk.
    isNearExpiry: status === 'ACTIVE' && minutesToEnd > 0 && minutesToEnd <= 30,
    minutesToStart,
    minutesToEnd,
  };
};

export default function BookingPage() {
  const { language, t } = useLanguage();
  const locale = language === 'vi' ? 'vi-VN' : 'en-GB';
  const formatMoney = (value) => moneyWithLocale(value, locale);
  const [searchParams, setSearchParams] = useSearchParams();
  const feedbackLocation = useLocation();
  const [feedbackBooking, setFeedbackBooking] = useState(null);
  const linkedBookingId = searchParams.get('bookingId');
  const socket = useSocket();
  const [bookings, setBookings] = useState([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [page, setPage] = useState(1);
  const copy = language === 'vi' ? {
    search: 'Tìm biển số, vị trí, mã đặt chỗ', status: 'Trạng thái', allStatus: 'Tất cả trạng thái',
    dates: 'Ngày bắt đầu', allDates: 'Mọi thời gian', today: 'Hôm nay', week: '7 ngày qua', month: '30 ngày qua',
    sort: 'Sắp xếp', newest: 'Mới nhất', oldest: 'Cũ nhất', results: 'kết quả',
    noResults: 'Không tìm thấy đặt chỗ', noResultsHint: 'Thử từ khóa khác hoặc thay đổi bộ lọc.',
    reset: 'Đặt lại bộ lọc', pagination: 'Phân trang đặt chỗ', previous: 'Trang trước', next: 'Trang sau', page: 'Trang',
  } : {
    search: 'Search plate, slot, booking ID', status: 'Status', allStatus: 'All statuses',
    dates: 'Start date', allDates: 'All dates', today: 'Today', week: 'Past 7 days', month: 'Past 30 days',
    sort: 'Sort order', newest: 'Newest first', oldest: 'Oldest first', results: 'results',
    noResults: 'No matching bookings', noResultsHint: 'Try another search or adjust your filters.',
    reset: 'Reset filters', pagination: 'Booking pagination', previous: 'Previous page', next: 'Next page', page: 'Page',
  };
  const paginationCopy = language === 'vi'
    ? { of: '/', prev: 'Tr\u01b0\u1edbc', next: 'Sau' }
    : { of: 'of', prev: 'Prev', next: 'Next' };
  const resetFilters = () => {
    setQuery(''); setStatusFilter('all'); setDateRange('all'); setSortOrder('newest'); setPage(1);
  };
  const normalizedQuery = query.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rangeStart = new Date(today);
  rangeStart.setDate(rangeStart.getDate() - (dateRange === 'week' ? 6 : dateRange === 'month' ? 29 : 0));
  const rangeEnd = new Date(today);
  rangeEnd.setDate(rangeEnd.getDate() + 1);
  const filteredBookings = bookings.filter((booking) => {
    const matchesSearch = [booking.licensePlate, getBookingSlot(booking), booking._id].some((value) =>
      String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').includes(normalizedQuery));
    const start = new Date(getBookingStart(booking));
    return matchesSearch && (statusFilter === 'all' || getBookingStatus(booking) === statusFilter)
      && (dateRange === 'all' || (start >= rangeStart && start < rangeEnd));
  }).sort((a, b) => {
    const timestamp = (booking) => new Date(booking.createdAt || getBookingStart(booking)).getTime() || 0;
    const difference = timestamp(b) - timestamp(a) || String(b._id).localeCompare(String(a._id));
    return sortOrder === 'newest' ? difference : -difference;
  });
  const pageCount = Math.max(1, Math.ceil(filteredBookings.length / 10));
  const currentPage = Math.min(page, pageCount);
  const visibleBookings = filteredBookings.slice((currentPage - 1) * 10, currentPage * 10);
  if (page > pageCount) setPage(pageCount);
  const [floorsById, setFloorsById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [dialog, setDialog] = useState(null); // { type: 'plate' | 'extend', booking: obj }
  const [vehicles, setVehicles] = useState([]);
  const [vehicleInput, setVehicleInput] = useState('');
  const [manualPlateInput, setManualPlateInput] = useState('');
  const [extendEndTime, setExtendEndTime] = useState('');
  const [qrDialog, setQrDialog] = useState(null);
  const [telegramBookingId, setTelegramBookingId] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(null);
  const [cancelQuoteLoading, setCancelQuoteLoading] = useState('');
  const lastEventRef = useRef(null);

  const activeFeedbackBooking = linkedBookingId ? bookings.find((item) => item._id === linkedBookingId) : feedbackBooking;

  const closeFeedback = () => {
    setFeedbackBooking(null);
    if (linkedBookingId) { const next = new URLSearchParams(searchParams); next.delete('bookingId'); setSearchParams(next, { replace: true }); }
  };

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');

    try {
      const [bookingRes, vehicleRes, floorRes] = await Promise.all([
        getMyBookings(),
        getMyVehicles(),
        getAllFloors(),
      ]);
      if (bookingRes.ok) setBookings(bookingRes.data?.data || []);
      if (vehicleRes.ok) setVehicles(vehicleRes.data?.data || []);
      if (floorRes.ok) setFloorsById(buildFloorLookup(floorRes.data?.data || []));
    } catch {
      setError(t('myBookings.couldNotLoadData'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      loadData();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, []);

  useEffect(() => {
    if (!socket) return undefined;

    const handleBookingChanged = (payload) => {
      lastEventRef.current = payload;
      setSuccess(t('myBookings.bookingStatusUpdatedAutomatically'));
      loadData(true);
    };

    socket.on('booking:changed', handleBookingChanged);
    return () => {
      socket.off('booking:changed', handleBookingChanged);
    };
  }, [socket, t]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadData(true);
      }
    }, 15000);

    const handleFocus = () => loadData(true);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  useEffect(() => {
    if (!success) return undefined;
    const timer = setTimeout(() => setSuccess(''), 2500);
    return () => clearTimeout(timer);
  }, [success]);

  const runBookingAction = async (actionKey, action) => {
    setActionLoading(actionKey);
    setError('');
    setSuccess('');

    try {
      const res = await action();
      if (!res.ok) {
        setError(res.data?.message || t('myBookings.bookingActionFailed'));
        return null;
      }

      await loadData(true);
      return res;
    } catch {
      setError(t('myBookings.networkErrorWhileUpdatingBooking'));
      return null;
    } finally {
      setActionLoading('');
    }
  };

  const openPlateDialog = (booking) => {
    setDialog({ type: 'plate', booking });
    const approvedVehicles = vehicles.filter(v => v.status === 'approved');
    const match = approvedVehicles.find(v => v.licensePlate === booking.licensePlate);
    setVehicleInput(match ? match._id : (approvedVehicles.length > 0 ? approvedVehicles[0]._id : ''));
    setError('');
  };

  const openExtendDialog = (booking, minutes = 60) => {
    setDialog({ type: 'extend', booking });
    setExtendEndTime(addMinutesLocalInput(getBookingEnd(booking), minutes));
    setError('');
  };

  const submitPlateChange = async () => {
    if (!dialog?.booking || !vehicleInput) {
      setError(t('myBookings.pleaseSelectAVehicle'));
      return;
    }

    if (vehicleInput === 'manual' && !manualPlateInput.trim()) {
      setError(t('myBookings.pleaseEnterALicensePlate'));
      return;
    }

    const payload = vehicleInput === 'manual'
      ? { licensePlate: manualPlateInput.trim() }
      : { vehicleId: vehicleInput };

    const res = await runBookingAction(`plate-${dialog.booking._id}`, () =>
      updateBookingVehicle(dialog.booking._id, payload)
    );

    if (res) {
      setDialog(null);
      setSuccess(t('myBookings.vehicleUpdatedSuccessfully'));
    }
  };

  const submitExtension = async () => {
    if (!dialog?.booking || !extendEndTime) {
      setError(t('myBookings.newEndTimeIsRequired'));
      return;
    }

    const res = await runBookingAction(`extend-${dialog.booking._id}`, () =>
      extendBooking(dialog.booking._id, {
        newStart: new Date(getBookingStart(dialog.booking)).toISOString(),
        newEnd: new Date(extendEndTime).toISOString(),
      })
    );

    if (res) {
      setDialog(null);
      const extra = res.data?.data?.extraAmount || 0;
      setSuccess(extra > 0 ? `Booking extended. Wallet charged ${formatMoney(extra)}.` : t('myBookings.bookingExtended'));
    }
  };

  const handleCancel = async (booking) => {
    setError('');
    setCancelQuoteLoading(booking._id);
    try {
      const response = await getBookingCancellationQuote(booking._id);
      if (!response.ok) {
        setError(response.data?.message || t('myBookings.couldNotCalculateTheCancellationRefund'));
        return;
      }
      setCancelDialog({
        booking,
        quote: response.data?.data || null,
      });
    } catch {
      setError(t('myBookings.networkErrorWhileCalculatingTheCancellation'));
    } finally {
      setCancelQuoteLoading('');
    }
  };

  const confirmCancel = async () => {
    if (!cancelDialog) return;

    const booking = cancelDialog.booking;
    const res = await runBookingAction(`cancel-${booking._id}`, () => cancelBooking(booking._id));
    if (res) {
      setCancelDialog(null);
      setSuccess(`Booking cancelled. Refunded ${formatMoney(res.data?.data?.refundAmount || 0)}.`);
    }
  };

  const openQrDialog = async (booking) => {
    setQrLoading(true);
    setError('');
    try {
      const response = await getBookingQr(booking._id);
      if (!response.ok || !response.data?.data?.payload) {
        setError(response.data?.message || t('myBookings.thisBookingQrIsNoLonger'));
        return;
      }
      setQrDialog({
        booking,
        payload: response.data.data.payload,
      });
    } catch {
      setError(t('myBookings.networkErrorWhileLoadingTheBooking'));
    } finally {
      setQrLoading(false);
    }
  };

  const approvedVehicles = vehicles.filter(v => v.status === 'approved');

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center bg-[#050505] text-white p-6 md:p-8">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
      </div>
    );
  }

  return (
    <div className="booking-page min-h-full bg-[#050505] text-white">
      <div className="booking-content w-full min-w-0 px-4 py-6 sm:px-6 sm:py-8">
      <CustomerPageHeader
        icon={CalendarClock}
        title={t('customer.myBookingsTitle')}
        description={t('customer.myBookingsDescription')}
        className="mb-6"
        action={
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-300 flex items-center gap-2">
              <Wifi size={12} />
              {t('myBookings.liveSync')}
            </div>
            <button
              type="button"
              onClick={() => loadData()}
              aria-label={t('common.refresh')}
              title={t('common.refresh')}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-white/70 hover:text-white hover:bg-white/5 transition"
            >
              <RefreshCw size={18} aria-hidden="true" />
            </button>
          </div>
        }
      />

      {(error || success) && (
        <div className={`mb-6 rounded-2xl border px-4 py-3 flex items-start gap-3 ${error
            ? 'bg-rose-500/10 border-rose-500/25 text-rose-200'
            : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
          }`}>
          {error ? <AlertCircle size={18} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
          <span className="text-sm font-medium">{error || success}</span>
        </div>
      )}

      <div className="booking-browser">
        <div className="booking-toolbar">
          <label className="booking-search">
            <Search size={17} aria-hidden="true" />
            <input type="search" aria-label={copy.search} placeholder={copy.search} value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
          </label>
          <BookingDropdown label={copy.status} value={statusFilter} onChange={(value) => { setStatusFilter(value); setPage(1); }}
            options={[{ value: 'all', label: copy.allStatus }, ...[...new Set(['PAID', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'EXPIRED', ...bookings.map(getBookingStatus)])].filter(Boolean).map((status) => ({
              value: status, label: t(`myBookings.status.${status}`, { defaultValue: status.charAt(0) + status.slice(1).toLowerCase() }),
            }))]} />
          <BookingDropdown label={copy.dates} value={dateRange} onChange={(value) => { setDateRange(value); setPage(1); }}
            options={[{ value: 'all', label: copy.allDates }, { value: 'today', label: copy.today }, { value: 'week', label: copy.week }, { value: 'month', label: copy.month }]} />
          <BookingDropdown label={copy.sort} value={sortOrder} onChange={(value) => { setSortOrder(value); setPage(1); }}
            options={[{ value: 'newest', label: copy.newest }, { value: 'oldest', label: copy.oldest }]} />
        </div>

        <div className="booking-list" tabIndex={0} aria-label={t('customer.myBookingsTitle')}>
        {bookings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center text-white/40 flex flex-col items-center">
            <CalendarClock size={48} className="mb-4 text-white/20" />
            <p className="text-lg font-bold text-white/60 mb-2">{t('customer.noBookings')}</p>
            <p className="text-sm max-w-sm">{t('customer.noBookingsHint')}</p>
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className="py-12 text-center">
            <p className="font-semibold">{copy.noResults}</p>
            <p className="mt-2 text-sm text-white/65">{copy.noResultsHint}</p>
            <button type="button" onClick={resetFilters} className="mt-4 min-h-11 rounded-xl border border-yellow-400/30 px-4 text-sm text-yellow-200">{copy.reset}</button>
          </div>
        ) : (
          <div className="booking-rows">
            {visibleBookings.map((booking) => {
              const timing = getBookingTiming(booking);
              const period = formatBookingPeriod(getBookingStart(booking), getBookingEnd(booking), locale);
              const isBusy = actionLoading.endsWith(booking._id);
              const isCancelQuoteBusy = cancelQuoteLoading === booking._id;

              return (
                <div key={booking._id} className={`booking-record rounded-2xl border border-[#f4c95d]/15 bg-[#0d1112] transition hover:border-[#f4c95d]/25 ${
                  timing.isNearExpiry ? 'border-amber-400/40' : 'border-[#f4c95d]/15'
                }`}>
                  <div className="booking-slot" aria-label={t('myBookings.slot')}>{getBookingSlot(booking)}</div>
                  <div className="booking-vehicle">
                    <span className="booking-plate">{formatLicensePlateDisplay(booking.licensePlate)}</span>
                    <span className="booking-floor">{getBookingFloorLabel(booking, floorsById)}</span>
                  </div>
                  <div className="booking-time" aria-label={t('myBookings.time')}>
                    <span>{period.dates}</span>
                    <span>{period.times}</span>
                  </div>
                  <div className="booking-amount">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#8ea9a2]">{t('myBookings.paid')}</span>
                    <span className="font-bold text-[#f7d76b]">{formatMoney(getBookingPaidAmount(booking))}</span>
                  </div>
                  <div className="booking-status">
                    <span className={`px-2.5 py-1 rounded-full border text-xs font-bold uppercase ${statusClass(booking.status)}`}>
                      {t(`myBookings.status.${getBookingStatus(booking)}`, { defaultValue: booking.status })}
                    </span>
                  </div>
                  <div className="booking-notes">
                        {timing.isNearExpiry && (
                          <span className="px-2.5 py-1 rounded-full border border-amber-400/30 bg-amber-400/10 text-xs font-bold uppercase text-amber-200">
                            {timing.minutesToEnd} {t('myBookings.minLeft')}
                          </span>
                        )}
                        {getBookingStatus(booking) === 'PAID' && timing.minutesToStart <= 15 && timing.minutesToStart >= -15 && (
                          <span className="px-2.5 py-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 text-xs font-bold uppercase text-cyan-200">
                            {t('myBookings.arrivalWindow')}
                          </span>
                        )}
                    {booking.services?.length > 0 && (
                      <div className="mt-3 text-xs text-yellow-400/70 font-medium">
                        {t('myBookings.services')} {booking.services.map((service) => service.serviceName).join(', ')}
                      </div>
                    )}
                    {booking.refundAmount > 0 && (
                      <div className="mt-1 text-xs text-emerald-400/80 font-medium">
                        {t('myBookings.refunded')} {formatMoney(booking.refundAmount)}
                      </div>
                    )}
                    {getBookingStatus(booking) === 'EXPIRED' && (
                      <div className="mt-2 text-xs text-amber-300/80 font-medium">
                        {t('myBookings.thisBookingExpiredAfterThe15')}
                      </div>
                    )}
                  </div>

                  <div className="booking-actions min-w-0">
                    <div className="booking-action-buttons">
                      {(booking.canSubmitFeedback || booking.feedbackSummary) && <button type="button" onClick={() => setFeedbackBooking(booking)} className="rounded-xl border border-yellow-300/30 bg-yellow-300/10 px-3 py-2 text-xs font-bold text-yellow-200">{booking.feedbackSummary ? `View feedback · ${booking.feedbackSummary.rating}/5 ★` : t('myBookings.rateYourExperience')}</button>}
                      {['PAID', 'ACTIVE', 'PAUSED'].includes(getBookingStatus(booking)) && (
                        <button
                          type="button"
                          disabled={qrLoading}
                          onClick={() => openQrDialog(booking)}
                          className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-400/20 transition flex items-center gap-2 disabled:opacity-50"
                        >
                          {qrLoading ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}
                          {t('myBookings.showQr')}
                        </button>
                      )}
                      {timing.canExtend && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => openExtendDialog(booking, timing.isNearExpiry ? 30 : 60)}
                          className="rounded-xl border border-[#f4c95d]/20 bg-[#f4c95d]/5 px-3 py-2 text-xs font-bold text-[#f1d77b] hover:bg-[#f4c95d]/10 transition flex items-center gap-2 disabled:opacity-50"
                        >
                          <TimerReset size={14} />
                          {t('myBookings.extend')}
                        </button>
                      )}
                      {timing.canEditBeforeCheckIn && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => openPlateDialog(booking)}
                          className="rounded-xl border border-[#dfe9e5]/10 bg-[#111915] px-3 py-2 text-xs font-bold text-[#dfe9e5] hover:border-[#dfe9e5]/20 hover:bg-[#18221f] transition flex items-center gap-2 disabled:opacity-50"
                        >
                          <Edit3 size={14} />
                          {t('myBookings.changePlate')}
                        </button>
                      )}
                      {timing.canEditBeforeCheckIn && (
                        <button
                          type="button"
                          disabled={isBusy || Boolean(cancelQuoteLoading)}
                          onClick={() => handleCancel(booking)}
                          className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs font-bold text-rose-200 hover:bg-rose-400/20 transition flex items-center gap-2 disabled:opacity-50"
                        >
                          {isCancelQuoteBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          {t('common.cancel')}
                        </button>
                      )}
                      {!timing.canExtend && !timing.canEditBeforeCheckIn && (
                        <button
                          type="button"
                          onClick={() => { window.location.href = '/booking'; }}
                          className="rounded-xl border border-[#dfe9e5]/10 bg-[#111915] px-3 py-2 text-xs font-bold text-[#dfe9e5] hover:border-[#dfe9e5]/20 hover:bg-[#18221f] transition flex items-center gap-2"
                        >
                          <RotateCcw size={14} />
                          {t('myBookings.bookAgain')}
                        </button>
                      )}
                      {isBusy && <Loader2 size={16} className="animate-spin text-white/40 mt-2" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {filteredBookings.length > 0 && (
        <nav aria-label={copy.pagination} className="booking-pagination">
          <p role="status" className="booking-page-summary">{copy.page} {currentPage} {paginationCopy.of} {pageCount} &middot; {filteredBookings.length} {copy.results}</p>
          <div className="booking-page-links">
          <button type="button" aria-label={copy.previous} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14} />{paginationCopy.prev}</button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).filter((number) => number === 1 || number === pageCount || Math.abs(number - currentPage) <= 1).map((number, index, numbers) => (
            <span key={number} className="inline-flex items-center gap-2">
              {index > 0 && number - numbers[index - 1] > 1 && <span className="text-white/50">…</span>}
              <button type="button" aria-label={`${copy.page} ${number}`} aria-current={number === currentPage ? 'page' : undefined} onClick={() => setPage(number)}>{number}</button>
            </span>
          ))}
          <button type="button" aria-label={copy.next} disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>{paginationCopy.next}<ChevronRight size={14} /></button>
          </div>
        </nav>
      )}
      </div>

      {linkedBookingId && !activeFeedbackBooking && <p role="alert" className="mt-4 text-rose-300">{t('myBookings.theLinkedBookingIsUnavailable')}</p>}
      {activeFeedbackBooking && <BookingFeedbackModal key={activeFeedbackBooking._id} booking={activeFeedbackBooking} refreshKey={feedbackLocation.key} onClose={closeFeedback} onSubmitted={() => loadData(true)} />}
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#121212] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h3 className="text-xl font-black text-white">
                  {dialog.type === 'plate' ? t('customer.changePlate') : t('customer.extendParking')}
                </h3>
                <p className="text-sm text-white/45 mt-1">
                  {t('myBookings.slot')} {getBookingSlot(dialog.booking)} - {getBookingFloorLabel(dialog.booking, floorsById)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/50 hover:text-white hover:bg-white/5 transition"
              >
                {t('common.close')}
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 flex items-start gap-3 text-rose-400">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span className="text-sm font-medium">{error}</span>
              </div>
            )}

            {dialog.type === 'plate' ? (
              <div className="space-y-4">
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-white/35">{t('customer.selectVehicle')}</span>
                  <select
                    value={vehicleInput}
                    onChange={(event) => setVehicleInput(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-[#1e1e1e] px-4 py-3 text-sm font-bold text-white outline-none focus:border-yellow-400"
                  >
                    <option value="" disabled>{t('myBookings.chooseARegisteredVehicle')}</option>
                    <option value="manual">{t('booking.manualPlate')}</option>
                    {approvedVehicles.map(v => (
                      <option key={v._id} value={v._id}>
                        {formatLicensePlateDisplay(v.licensePlate)} ({v.type})
                      </option>
                    ))}
                  </select>
                </label>
                {vehicleInput === 'manual' && (
                  <label className="block">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-white/35">{t('customer.enterPlate')}</span>
                    <input
                      type="text"
                      placeholder="e.g. 51G12345"
                      value={manualPlateInput}
                      onChange={(event) => setManualPlateInput(event.target.value.toUpperCase())}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white outline-none focus:border-yellow-400"
                    />
                  </label>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-white/35">{t('myBookings.newEndTime')}</span>
                  <input
                    type="datetime-local"
                    value={extendEndTime}
                    min={addMinutesLocalInput(getBookingEnd(dialog.booking), 30)}
                    onChange={(event) => setExtendEndTime(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white outline-none focus:border-yellow-400"
                  />
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[30, 60, 120].map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => setExtendEndTime(addMinutesLocalInput(getBookingEnd(dialog.booking), minutes))}
                      className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/60 hover:text-white hover:bg-white/5 transition flex items-center justify-center gap-1"
                    >
                      <Clock size={13} />
                      +{minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="flex-1 rounded-2xl border border-white/10 px-4 py-3 text-sm font-bold text-white/60 hover:text-white hover:bg-white/5 transition"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={Boolean(actionLoading)}
                onClick={dialog.type === 'plate' ? submitPlateChange : submitExtension}
                className="flex-1 rounded-2xl bg-yellow-400 px-4 py-3 text-sm font-black text-black hover:bg-yellow-300 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {actionLoading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl border border-rose-400/25 bg-[#121212] p-6 shadow-2xl">
            <div className="mb-5 flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-rose-400/25 bg-rose-400/10 text-rose-200">
                <Trash2 size={22} />
              </div>
              <div>
                <h3 className="text-xl font-black text-white">{t('customer.cancelBooking')}</h3>
                <p className="mt-1 text-sm leading-6 text-white/45">
                  {t('myBookings.slot')} {getBookingSlot(cancelDialog.booking)} - {formatLicensePlateDisplay(cancelDialog.booking.licensePlate)}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="font-semibold text-white/50">{t('myBookings.policyRefund')}</span>
                <span className="font-black text-yellow-300">
                  {formatMoney(cancelDialog.quote?.refundAmount || 0)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-4 text-xs">
                <span className="font-semibold text-white/35">{t('myBookings.paidAmount')}</span>
                <span className="font-bold text-white/55">{formatMoney(getBookingPaidAmount(cancelDialog.booking))}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-white/40">
                {t('myBookings.appliedPolicy')} {cancelDialog.quote?.refundBreakdown?.appliedRefundPercent ?? 0}{t('myBookings.refundForTheCurrentCancellationWindow')}
              </p>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                disabled={Boolean(actionLoading)}
                onClick={() => setCancelDialog(null)}
                className="flex-1 rounded-2xl border border-white/10 px-4 py-3 text-sm font-bold text-white/60 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
              >
                {t('myBookings.keepBooking')}
              </button>
              <button
                type="button"
                disabled={Boolean(actionLoading)}
                onClick={confirmCancel}
                className="flex-1 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm font-black text-rose-100 transition hover:bg-rose-400/20 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {actionLoading ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                {t('myBookings.confirmCancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {telegramBookingId && <TelegramReceiptModal key={telegramBookingId} open onClose={() => setTelegramBookingId(null)} bookingId={telegramBookingId} />}

      {qrDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#121212] p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-black text-white">{t('customer.bookingQr')}</h3>
                <p className="mt-1 text-sm text-white/45">
                  {getBookingSlot(qrDialog.booking)} · {formatLicensePlateDisplay(qrDialog.booking.licensePlate)}
                </p>
              </div>
              <button
                type="button"
                aria-label={t('myBookings.closeBookingQr')}
                onClick={() => setQrDialog(null)}
                className="rounded-xl border border-white/10 p-2 text-white/50 hover:bg-white/5 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="rounded-2xl bg-white p-5">
              <QRCodeSVG
                value={qrDialog.payload}
                size={256}
                level="M"
                className="h-auto w-full"
              />
            </div>
            {['PAID', 'ACTIVE', 'PAUSED'].includes(getBookingStatus(qrDialog.booking)) && <TelegramReceiptButton bookingId={qrDialog.booking._id} refreshKey={telegramBookingId} onClick={() => { setTelegramBookingId(qrDialog.booking._id); setQrDialog(null); }} className="mt-4 min-h-11 w-full rounded-xl border border-sky-400/30 bg-sky-400/10 px-4 text-sm font-bold text-sky-200 hover:bg-sky-400/20" />}
            <p className="mt-4 text-center text-xs leading-5 text-white/45">
              {t('myBookings.presentThisCodeToTheKiosk')}
            </p>
            <p className="mt-2 break-all text-center font-mono text-[10px] text-white/25">
              {t('myBookings.ref')} {qrDialog.booking._id}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
