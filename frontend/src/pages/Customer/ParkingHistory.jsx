import './BookingPage.css';
import './ParkingHistory.css';
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../services/api";
import {
  History,
  Car,
  MapPin,
  Clock,
  CreditCard,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  X,
  Camera,
  LogIn,
  LogOut
} from "lucide-react";
import CustomerPageHeader from "../../components/Customer/CustomerPageHeader";
import { formatLicensePlateDisplay } from "../../utils/licensePlate";
import { useLanguage } from "../../i18n/hooks/useLanguage";
import MembershipServiceSelectionModal from "../../components/membership/MembershipServiceSelectionModal";

function HistoryDropdown({ label, value, onChange, options }) {
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
              {({ selected }) => <><span>{option.label}</span>{selected && <Check size={16} aria-hidden="true" />}</>}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </Listbox>
    </div>
  );
}

const sessionTimestamp = (session) => new Date(session.checkInTime).getTime() || 0;
const normalizeSearch = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export default function ParkingHistory() {
  const { language, t } = useLanguage();
  const locale = language === 'vi' ? 'vi-VN' : 'en-GB';
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [serviceSession, setServiceSession] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const [query, setQuery] = useState('');
  const [dateRange, setDateRange] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(4);
  const copy = language === 'vi' ? {
    search: 'T\u00ecm bi\u1ec3n s\u1ed1, v\u1ecb tr\u00ed', dates: 'Ng\u00e0y v\u00e0o', allDates: 'M\u1ecdi th\u1eddi gian',
    today: 'H\u00f4m nay', week: '7 ng\u00e0y qua', month: '30 ng\u00e0y qua', sort: 'S\u1eafp x\u1ebfp',
    newest: 'M\u1edbi nh\u1ea5t', oldest: 'C\u0169 nh\u1ea5t', status: 'Tr\u1ea1ng th\u00e1i', allStatus: 'T\u1ea5t c\u1ea3 tr\u1ea1ng th\u00e1i',
    page: 'Trang', of: '/', results: 'k\u1ebft qu\u1ea3', prev: 'Tr\u01b0\u1edbc', next: 'Sau',
    pagination: 'Ph\u00e2n trang l\u1ecbch s\u1eed', noResults: 'Kh\u00f4ng t\u00ecm th\u1ea5y phi\u00ean \u0111\u1ed7 xe', reset: '\u0110\u1eb7t l\u1ea1i b\u1ed9 l\u1ecdc',
  } : {
    search: 'Search plate, slot', dates: 'Check-in date', allDates: 'All dates', today: 'Today', week: 'Past 7 days', month: 'Past 30 days',
    sort: 'Sort order', newest: 'Newest first', oldest: 'Oldest first', status: 'Status', allStatus: 'All statuses',
    page: 'Page', of: 'of', results: 'results', prev: 'Prev', next: 'Next', pagination: 'History pagination',
    noResults: 'No matching sessions', reset: 'Reset filters',
  };
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px) and (min-height: 850px)');
    const resize = () => { setPageSize(media.matches ? 5 : 4); setPage(1); };
    resize();
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  const statuses = [...new Set(sessions.map((session) => session.status).filter(Boolean))].sort();
  const latestSession = sessions.reduce((latest, session) =>
    !latest || sessionTimestamp(session) > sessionTimestamp(latest) ? session : latest, null);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const rangeStart = new Date(today);
  rangeStart.setDate(rangeStart.getDate() - (dateRange === 'week' ? 6 : dateRange === 'month' ? 29 : 0));
  const rangeEnd = new Date(today);
  rangeEnd.setDate(rangeEnd.getDate() + 1);
  const filteredSessions = sessions.filter((session) => {
    const matchesSearch = [session.licensePlate, session.parkingSlot].some((value) => normalizeSearch(value).includes(normalizeSearch(query)));
    const checkIn = new Date(session.checkInTime);
    return matchesSearch && (statuses.length < 2 || statusFilter === 'all' || session.status === statusFilter)
      && (dateRange === 'all' || (checkIn >= rangeStart && checkIn < rangeEnd));
  }).sort((a, b) => {
    const difference = sessionTimestamp(b) - sessionTimestamp(a) || String(b._id).localeCompare(String(a._id));
    return sortOrder === 'newest' ? difference : -difference;
  });
  const pageCount = Math.max(1, Math.ceil(filteredSessions.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  if (page > pageCount) setPage(pageCount);
  const visibleSessions = filteredSessions.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const resetFilters = () => { setQuery(''); setDateRange('all'); setSortOrder('newest'); setStatusFilter('all'); setPage(1); };
  const statusLabel = (status) => status === 'active' ? t('historyPage.active')
    : t(`myBookings.status.${String(status).toUpperCase()}`, { defaultValue: status });

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    const token = localStorage.getItem("accessToken");
    if (!token) {
      setError('historyPage.loginRequired');
      setLoading(false);
      return;
    }

    try {
      const { ok, data } = await apiFetch("/sessions/my-history", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (ok && data?.success) {
        setSessions(data.data);
        setNow(Date.now());
      } else {
        setError(data?.message || 'historyPage.loadFailed');
      }
    } catch {
      setError('historyPage.networkError');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      fetchHistory();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [fetchHistory]);

  const hasActiveSession = sessions.some((session) => session.status === 'active' && !session.checkOutTime);
  useEffect(() => {
    if (!hasActiveSession) return undefined;
    const timerId = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timerId);
  }, [hasActiveSession]);

  const getStatusBadge = (status) => {
    switch (status) {
      case "active":
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-[0_0_10px_rgba(59,130,246,0.2)]">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
            {t('historyPage.active')}
          </span>
        );
      case "completed":
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 size={12} /> {t('myBookings.status.COMPLETED')}
          </span>
        );
      case "cancelled":
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30">
            <AlertCircle size={12} /> {t('myBookings.status.CANCELLED')}
          </span>
        );
      default:
        return <span className="history-unknown-status">{statusLabel(status)}</span>;
    }
  };

  const calculateDuration = (checkIn, checkOut) => {
    if (!checkIn) return "—";
    const start = new Date(checkIn).getTime();
    const end = checkOut ? new Date(checkOut).getTime() : now;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";

    const totalMinutes = Math.floor((end - start) / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return t('servicesPage.minutes', { value: minutes });
    if (minutes === 0) return t('servicesPage.hours', { value: hours });
    return t('servicesPage.hoursMinutes', { hours, minutes });
  };

  const formatMoney = (value) => {
    if (value === undefined || value === null) return "—";
    return `${Number(value || 0).toLocaleString(locale)} ${t('common.currency')}`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return "—";
    const date = new Date(dateString);
    if (!Number.isFinite(date.getTime())) return "—";
    return date.toLocaleString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const renderSnapshotPanel = ({
    title,
    icon,
    time,
    imageUrl,
    emptyLabel,
  }) => (
    <div className="bg-[#101018] border border-gray-800/70 rounded-2xl p-5">
      <div className="flex items-center gap-2 text-sm font-black text-white mb-4 uppercase tracking-wide">
        {icon}
        <span>{title}</span>
      </div>

      <div className="mb-4">
        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2">
          {t('historyPage.time')}
        </p>
        <p className="text-lg font-bold text-gray-100">
          {time ? formatDate(time) : emptyLabel}
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-800 bg-[#07070a] min-h-[240px]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            className="w-full h-[260px] object-cover"
          />
        ) : (
          <div className="w-full h-[260px] flex flex-col items-center justify-center text-center px-6 text-gray-500">
            <Camera size={34} className="mb-3 text-gray-600" />
            <p className="font-semibold">{emptyLabel}</p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="history-page min-h-full px-4 py-6 sm:px-6 sm:py-8">
      {/* ── HEADER ── */}
      <CustomerPageHeader
        icon={History}
        title={t('historyPage.title')}
        description={t('historyPage.description')}
        className="mb-6"
      />

      {/* ── CONTENT ── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-yellow-500/30 border-t-yellow-500 rounded-full animate-spin"></div>
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-2xl text-center">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-red-400 font-medium">{t(error)}</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center opacity-60 px-4">
          <History size={64} className="text-gray-500 mb-4" />
          <h3 className="text-xl font-bold text-gray-300">{t('historyPage.emptyTitle')}</h3>
          <p className="text-gray-500 mt-2 text-sm">
            {t('historyPage.emptyDescription')}
          </p>
        </div>
      ) : (
        <>
          <div className="booking-toolbar">
            <label className="booking-search">
              <Search size={17} aria-hidden="true" />
              <input type="search" aria-label={copy.search} placeholder={copy.search} value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
            </label>
            {statuses.length > 1 && <HistoryDropdown label={copy.status} value={statusFilter}
              onChange={(value) => { setStatusFilter(value); setPage(1); }}
              options={[{ value: 'all', label: copy.allStatus }, ...statuses.map((status) => ({ value: status, label: statusLabel(status) }))]} />}
            <HistoryDropdown label={copy.dates} value={dateRange} onChange={(value) => { setDateRange(value); setPage(1); }}
              options={[{ value: 'all', label: copy.allDates }, { value: 'today', label: copy.today }, { value: 'week', label: copy.week }, { value: 'month', label: copy.month }]} />
            <HistoryDropdown label={copy.sort} value={sortOrder} onChange={(value) => { setSortOrder(value); setPage(1); }}
              options={[{ value: 'newest', label: copy.newest }, { value: 'oldest', label: copy.oldest }]} />
          </div>
          <div className="history-list">
            {visibleSessions.length === 0 && <div className="history-no-results">
              <p>{copy.noResults}</p>
              <button type="button" onClick={resetFilters}>{copy.reset}</button>
            </div>}
            {visibleSessions.map((session) => {
              const checkIn = session.checkInTime ? new Date(session.checkInTime) : null;
              const validCheckIn = checkIn && Number.isFinite(checkIn.getTime());
              return (
                <article key={session._id} className="history-record">
                  <div className="history-vehicle">
                    <Car className="history-vehicle-mark" size={52} strokeWidth={1.2} aria-hidden="true" />
                    <div className="history-plate">
                      <h3>{formatLicensePlateDisplay(session.licensePlate)}</h3>
                      {session._id === latestSession?._id && <span className="history-latest">{t('historyPage.latest')}</span>}
                      <span className="history-slot"><MapPin size={12} aria-hidden="true" />{t('historyPage.slot')} {session.parkingSlot || t('historyPage.unassigned')}</span>
                    </div>
                  </div>
                  <div className="history-time" aria-label={t('historyPage.checkIn')}>
                    <span className="history-label"><LogIn size={12} aria-hidden="true" />{t('historyPage.checkIn')}</span>
                    <span>{validCheckIn ? checkIn.toLocaleDateString(locale, { dateStyle: 'short' }) : '\u2014'}</span>
                    <span>{validCheckIn ? checkIn.toLocaleTimeString(locale, { timeStyle: 'short' }) : '\u2014'}</span>
                  </div>
                  <div className="history-cell"><span className="history-label"><Clock size={12} aria-hidden="true" />{t('historyPage.duration')}</span>
                    <span>{calculateDuration(session.checkInTime, session.checkOutTime)}</span></div>
                  <div className="history-cell"><span className="history-label"><CreditCard size={12} aria-hidden="true" />{t('historyPage.total')}</span>
                    <strong className="history-total">{formatMoney(session.totalPrice)}</strong></div>
                  <div className="history-status">{getStatusBadge(session.status)}</div>
                  <div className="history-extras">
                {session.canSelectServices === true && session.type === 'SUBSCRIPTION' && session.status === 'active' && (
                  <div className="pt-4 mt-2 border-t border-gray-800/50 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">
                      {t('membershipServiceModal.title')} · {t('membershipServiceModal.pending')}: {session.serviceSummary?.pending || 0} · {t('membershipServiceModal.inProgress')}: {session.serviceSummary?.inProgress || 0}
                    </span>
                    <button
                      type="button"
                      onClick={() => setServiceSession(session)}
                      className="min-h-11 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-sm font-bold text-yellow-400 hover:bg-yellow-500/20"
                    >
                      {t('membershipServiceModal.title')}
                    </button>
                  </div>
                )}

                {/* Footer / Image */}
                {session.entryImage_url && (
                  <div className="pt-4 mt-2 border-t border-gray-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <span className="text-[11px] md:text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                      <ImageIcon size={14} className="shrink-0" /> {t('historyPage.entrySnapshot')}
                    </span>
                    <a
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        setSelectedSession(session);
                      }}
                      className="text-[11px] md:text-xs font-bold text-yellow-500 hover:text-yellow-400 transition-colors w-fit border border-yellow-500/30 px-3 py-1.5 rounded-lg hover:bg-yellow-500/10"
                    >
                      {t('common.viewDetails')}
                    </a>
                  </div>
                )}

                  </div>
                </article>
              );
            })}
          </div>
          <nav aria-label={copy.pagination} className="booking-pagination history-pagination">
            <p role="status" className="booking-page-summary">{copy.page} {currentPage} {copy.of} {pageCount} &middot; {filteredSessions.length} {copy.results}</p>
            <div className="booking-page-links">
              <button type="button" aria-label={copy.prev} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14} />{copy.prev}</button>
              {Array.from({ length: pageCount }, (_, index) => index + 1).filter((number) => number === 1 || number === pageCount || Math.abs(number - currentPage) <= 1).map((number, index, numbers) => (
                <span key={number} className="inline-flex items-center gap-2">
                  {index > 0 && number - numbers[index - 1] > 1 && <span className="text-white/50">&hellip;</span>}
                  <button type="button" aria-label={`${copy.page} ${number}`} aria-current={number === currentPage ? 'page' : undefined} onClick={() => setPage(number)}>{number}</button>
                </span>
              ))}
              <button type="button" aria-label={copy.next} disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>{copy.next}<ChevronRight size={14} /></button>
            </div>
          </nav>
        </>
      )}

      {serviceSession && (
        <MembershipServiceSelectionModal
          key={serviceSession._id}
          session={serviceSession}
          onClose={() => setServiceSession(null)}
          onSaved={fetchHistory}
        />
      )}

      {selectedSession && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-6xl max-h-[90vh] overflow-y-auto bg-[#09090d] border border-yellow-500/20 rounded-3xl shadow-[0_25px_80px_rgba(0,0,0,0.55)]">
            <div className="flex items-start justify-between gap-4 p-6 md:p-7 border-b border-gray-800/70">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-yellow-500 mb-2">
                  {t('historyPage.sessionDetails')}
                </p>
                <h2 className="text-2xl md:text-3xl font-black text-white">
                  {formatLicensePlateDisplay(selectedSession.licensePlate)}
                </h2>
                <p className="text-sm text-gray-400 mt-2">
                  {t('historyPage.slot')}: {selectedSession.parkingSlot || t('historyPage.unassigned')} •{" "}
                  {selectedSession.totalPrice !== undefined && selectedSession.totalPrice !== null
                    ? formatMoney(selectedSession.totalPrice)
                    : t('historyPage.noCharge')}
                </p>
              </div>

              <button
                onClick={() => setSelectedSession(null)}
                aria-label={t('common.close')}
                className="shrink-0 w-11 h-11 rounded-xl border border-gray-800 text-gray-400 hover:text-white hover:border-gray-700 hover:bg-white/5 transition-colors flex items-center justify-center"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 md:p-7">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {renderSnapshotPanel({
                  title: t('historyPage.checkIn'),
                  icon: <LogIn size={18} className="text-emerald-400" />,
                  time: selectedSession.checkInTime,
                  imageUrl: selectedSession.entryImage_url,
                  emptyLabel: t('historyPage.noEntryImage'),
                })}

                {renderSnapshotPanel({
                  title: t('historyPage.checkOut'),
                  icon: <LogOut size={18} className="text-sky-400" />,
                  time: selectedSession.checkOutTime,
                  imageUrl: selectedSession.exitImage_url,
                  emptyLabel:
                    selectedSession.status === "active"
                      ? t('historyPage.notCheckedOut')
                      : t('historyPage.noExitImage'),
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
