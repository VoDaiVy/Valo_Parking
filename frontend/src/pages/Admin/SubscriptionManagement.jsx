import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Crown,
  Filter,
  Globe2,
  Car,
  ParkingCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  TimerReset,
  UserCheck,
  UserRound,
  X,
} from 'lucide-react';
import { apiFetch } from '../../services/api';
import { useLanguage } from '../../i18n/hooks/useLanguage';
import './vipMemberships.css';
import { vipDaysUntil } from './vipMembershipDates.js';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import AdminSelect from '../../components/Admin/AdminSelect';
import '../Staff/components/staffManagement.css';
import '../Staff/components/staffSubscriptionsPagination.css';
import { getPaginationPages } from '../Staff/sessionPagination.js';
import { useLocation, useSearchParams } from 'react-router-dom';
import SubscriptionDeepLink from './SubscriptionDeepLink.jsx';
import { createSubscriptionLookup, includeLinkedSubscription } from './subscriptionDeepLink.js';
import {
  getOperationalValue,
  getOperationalViewState,
  getResponseAvailability,
} from '../../utils/staffOperationalAvailability';

const formatCurrency = (value = 0, language = 'vi') => `${new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US').format(Number(value) || 0)} VND`;

const formatDate = (value, fallback = 'Not available', language = 'en') => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(date);
};

const daysUntil = (value) => {
  if (!value) return null;
  const end = new Date(value);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - today.getTime()) / 86400000);
};

const titleCase = (value = '') => {
  if (!value) return 'Unknown';
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
};

const getDisplayUser = (subscription, t) => {
  const currentOwners = subscription.currentOwners || [];
  if (subscription.currentOwner) return subscription.currentOwner;
  if (currentOwners.length > 1) {
    return {
      username: t ? t('subscriptionUi.currentOwners', { count: currentOwners.length }) : `${currentOwners.length} Current Owners`,
      email: t ? t('subscriptionUi.ownershipDiffers') : 'Ownership differs by parking slot',
      vehicles: Array.from(
        new Set(currentOwners.flatMap((owner) => owner.vehicles || [])),
      ),
    };
  }
  return subscription.user;
};

const getStatusClass = (status) => {
  switch (status) {
    case 'active':
      return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300';
    case 'pending':
      return 'border-amber-400/25 bg-amber-400/10 text-amber-300';
    case 'expired':
      return 'border-slate-400/20 bg-slate-400/10 text-slate-300';
    case 'cancelled':
    case 'failed':
      return 'border-rose-400/25 bg-rose-400/10 text-rose-300';
    default:
      return 'border-slate-400/20 bg-slate-400/10 text-slate-300';
  }
};

const getPackageClass = (type) => {
  switch (type) {
    case 'monthly':
      return 'border-yellow-400/25 bg-yellow-400/10 text-yellow-300';
    case 'yearly':
      return 'border-purple-400/25 bg-purple-400/10 text-purple-300';
    default:
      return 'border-cyan-400/25 bg-cyan-400/10 text-cyan-300';
  }
};

const getStoredRole = () => {
  try {
    return JSON.parse(sessionStorage.getItem('valo_user') || '{}')?.role || '';
  } catch {
    return '';
  }
};

function SummaryItem({ icon: Icon, label, value, support, tone = 'text-yellow-300', isAdmin }) {
  if (isAdmin) return <div className="vip-metric">
    <Icon size={18} className={`shrink-0 ${tone}`} aria-hidden="true" />
    <div className="min-w-0 flex-1"><p className="text-xs font-bold text-blue-200/55">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-2"><p className="font-mono text-2xl font-black leading-none text-white">{value}</p><span className="truncate text-xs text-emerald-300" title={support}>{support}</span></div>
    </div>
  </div>;
  return (
    <div className="g3-summary-item flex min-w-0 items-center gap-4 px-5 py-4 md:border-l md:border-white/10 md:first:border-l-0">
      <div className={`g3-summary-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-white/[0.03] ${tone}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="g3-metric-label text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
        <p className="g3-metric-value admin-type-kpi mt-1 font-mono text-xl font-black text-white">{value}</p>
        <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">{support}</p>
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3, 4].map((item) => (
        <div key={item} className="h-20 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04] motion-reduce:animate-none" />
      ))}
    </div>
  );
}

function StatusBadge({ status }) {
  const { t } = useLanguage();
  return (
    <span className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-black ${getStatusClass(status)}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === 'active' ? 'bg-emerald-300' : status === 'pending' ? 'bg-amber-300' : status === 'expired' ? 'bg-slate-400' : 'bg-rose-300'}`} />
      {t(`subscriptionStatus.${status}`, { defaultValue: titleCase(status) })}
    </span>
  );
}

function SlotBadge({ slot }) {
  const { t } = useLanguage();
  if (!slot) {
    return <span className="text-xs font-semibold italic text-slate-500">{t('subscriptionUi.notAssigned', { defaultValue: 'Not assigned' })}</span>;
  }

  return (
    <span className="g3-slot-badge inline-flex items-center gap-2 rounded-xl border border-yellow-400/20 bg-yellow-400/10 px-3 py-2 text-xs font-black text-yellow-300 transition group-hover:border-yellow-300/35">
      <ParkingCircle size={14} />
      <span className="text-slate-300">{slot.floorId?.name || t('subscriptionUi.floor', { defaultValue: 'Floor' })}</span>
      <span className="text-yellow-300">{slot.slotCode}</span>
    </span>
  );
}

function MembershipRow({ sub, index, cardRef, isAdmin, onOpen }) {
  const { t, language } = useLanguage();
  const remaining = isAdmin ? vipDaysUntil(sub.expireAt) : daysUntil(sub.expireAt);
  const packageType = sub.ticketPackage?.type || '';
  const displayUser = getDisplayUser(sub, t);
  const vehicles = displayUser?.vehicles || [];
  const vehicleText = vehicles.length ? t('subscriptionUi.vehicleCount', { count: vehicles.length }) : t('subscriptionUi.noVehicleShort');

  if (isAdmin) return <tr ref={cardRef} data-package-type={packageType} className="admin-vip-row" onClick={() => onOpen(sub)}>
    <td><button type="button" className="vip-open flex w-full items-center gap-3 text-left" onClick={(event) => { event.stopPropagation(); onOpen(sub); }} aria-label={t('subscriptionUi.viewVehicles', { name: displayUser?.username || t('subscriptionUi.unknownUser') })}>
      <span className="min-w-0"><span className="block truncate text-white" title={displayUser?.username}>{displayUser?.username || t('subscriptionUi.unknownUser')}</span><span className="vip-secondary block truncate" title={displayUser?.email}>{displayUser?.email || t('subscriptionUi.noEmailShort')}</span></span>
    </button></td>
    <td><p className="truncate text-white" title={sub.ticketPackage?.name}>{sub.ticketPackage?.name || t('subscriptionUi.unknownPackage')}</p>{packageType && <span className={`vip-type inline-flex rounded-full border px-2 py-0.5 ${getPackageClass(packageType)}`}>{t(`adminPages.ticketUi.types.${packageType}`, { defaultValue: titleCase(packageType) })}</span>}</td>
    <td><div className="flex flex-wrap gap-1">{sub.slots?.length ? sub.slots.map((slot) => <SlotBadge key={`${slot.floorId?._id || slot.floorId}-${slot.slotCode}`} slot={slot} />) : <SlotBadge />}</div></td>
    <td><p className="text-[#e8d5ad]">{formatCurrency(sub.amount, language)}</p>{sub.paymentStatus && <p className="vip-secondary">{t(`walletPage.statuses.${sub.paymentStatus}`, { defaultValue: titleCase(sub.paymentStatus) })}</p>}</td>
    <td><p>{formatDate(sub.validFrom, t('subscriptionUi.unavailable'), language)} - {formatDate(sub.expireAt, t('subscriptionUi.unavailable'), language)}</p>{remaining !== null && remaining >= 0 && <p className="vip-secondary">{remaining === 0 ? t('subscriptionUi.expiresToday') : t('subscriptionUi.daysLeft', { count: remaining })}</p>}</td>
    <td><StatusBadge status={sub.status} /></td>
    <td className="vip-vehicles"><div className="vip-vehicle-list">{vehicles.length ? vehicles.map((plate, index) => <span key={`${plate}-${index}`}>{plate}</span>) : <span>{vehicleText}</span>}</div></td>
  </tr>;

  return (
    <article
      ref={cardRef}
      className="g3-membership-row group relative overflow-hidden rounded-2xl border border-white/10 bg-[#10141d]/80 transition duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-[#141a25] motion-reduce:transform-none motion-reduce:transition-none"
      style={{ animationDelay: `${index * 35}ms` }}
    >
      <div className="g3-membership-edge absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-yellow-300 to-amber-500 opacity-0 transition group-hover:opacity-80" />
      <div className="g3-membership-grid grid gap-4 px-4 py-4 md:grid-cols-[minmax(220px,1.35fr)_minmax(145px,0.9fr)_minmax(150px,1fr)_minmax(130px,0.8fr)_minmax(150px,0.9fr)_110px] md:items-center md:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300">
              <UserRound size={17} />
            </div>
            <div className="min-w-0">
      <h3 className="truncate text-sm font-black text-white sm:text-base">{displayUser?.username || t('subscriptionUi.unknownUser')}</h3>
              <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">{displayUser?.email || t('subscriptionUi.noEmailShort')}</p>
            </div>
          </div>
          <button type="button" onClick={() => onOpen(sub)} className="mt-2 inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300" aria-label={t('subscriptionUi.viewVehicles', { name: displayUser?.username || t('subscriptionUi.unknownUser') })}>
            <Car size={14} />
            {vehicleText}<ChevronRight size={13} />
          </button>
        </div>

        <div className="flex items-start justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">{t('subscriptionUi.package')}</span>
          <div className="text-right md:text-left">
            <p className="font-black text-slate-100">{sub.ticketPackage?.name || t('subscriptionUi.unknownPackage')}</p>
            {packageType && (
              <span className={`g3-package-badge mt-2 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${getPackageClass(packageType)}`}>
                {t(`adminPages.ticketUi.types.${packageType}`, { defaultValue: titleCase(packageType) })}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">{t('subscriptionUi.vipSlot')}</span>
          <div className="flex flex-wrap justify-end gap-1.5 md:justify-start">
            {sub.slots && sub.slots.length > 0 ? sub.slots.map((slot) => (
              <SlotBadge key={`${slot.floorId?._id || slot.floorId}-${slot.slotCode}`} slot={slot} />
            )) : (
              <SlotBadge />
            )}
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">{t('subscriptionUi.amount')}</span>
          <div className="text-right md:text-left">
            <p className="g3-membership-amount font-mono text-sm font-black text-white">{formatCurrency(sub.amount, language)}</p>
            {sub.paymentStatus && <p className="mt-1 text-xs font-semibold text-slate-500">{t(`walletPage.statuses.${sub.paymentStatus}`, { defaultValue: titleCase(sub.paymentStatus) })}</p>}
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">{t('subscriptionUi.period')}</span>
          <div className="text-right text-xs font-semibold text-slate-400 md:text-left">
            <p>{formatDate(sub.validFrom, t('subscriptionUi.unavailable'), language)}</p>
            <p className="mt-1 text-slate-500">{t('subscriptionUi.to')} {formatDate(sub.expireAt, t('subscriptionUi.unavailable'), language)}</p>
            {remaining !== null && remaining >= 0 && (
              <p className={`mt-1 ${remaining <= 30 ? 'text-amber-300' : 'text-slate-500'}`}>
                {remaining === 0 ? t('subscriptionUi.expiresToday') : t('subscriptionUi.daysLeft', { count: remaining })}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">{t('subscriptionUi.status')}</span>
          <StatusBadge status={sub.status} />
        </div>
      </div>
    </article>
  );
}

function TransferReviewSection({ transfers, onReview }) {
  const { t, language } = useLanguage();
  const pendingTransfers = transfers.filter((item) => item.status === 'PENDING_ADMIN');

  if (!pendingTransfers.length) return null;

  return (
    <section className="mb-6 border-y border-amber-400/20 py-4">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-black text-white">{t('subscriptionUi.transferReviews')}</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">{t('subscriptionUi.reviewHint')}</p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-black text-amber-300">
          <TimerReset size={14} /> {pendingTransfers.length} {t('subscriptionUi.pending')}
        </span>
      </div>

      <div className="divide-y divide-white/10">
        {pendingTransfers.map((transfer) => (
          <div key={transfer._id} className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <span className={`mb-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${transfer.mode === 'PUBLIC' ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-300' : 'border-violet-400/20 bg-violet-400/10 text-violet-300'}`}>
                {transfer.mode === 'PUBLIC' ? <Globe2 size={12} /> : <UserCheck size={12} />}
                {transfer.mode === 'PUBLIC' ? t('subscriptionUi.publicListing') : t('subscriptionUi.directTransfer')}
              </span>
              <p className="truncate text-sm font-black text-slate-100">
                {transfer.entitlementId?.slotCode || t('subscriptionUi.parkingSpace')} · {transfer.fromUserId?.email || t('subscriptionUi.sender')} → {transfer.mode === 'PUBLIC' ? t('subscriptionUi.marketplace') : (transfer.toUserId?.email || t('subscriptionUi.recipient'))}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {t('subscriptionUi.price')} {formatCurrency(transfer.askingPrice, language)} · {t('subscriptionUi.fee')} {formatCurrency(transfer.transferFee, language)}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onReview(transfer._id, false)}
                className="h-10 rounded-xl border border-rose-500/25 px-4 text-xs font-black text-rose-300 transition hover:bg-rose-500/10 focus:outline-none focus:ring-2 focus:ring-rose-300/50"
              >
                {t('subscriptionUi.reject')}
              </button>
              <button
                type="button"
                onClick={() => onReview(transfer._id, true)}
                className="h-10 rounded-xl bg-emerald-400 px-4 text-xs font-black text-slate-950 transition hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-200/70"
              >
                {transfer.mode === 'PUBLIC' ? t('subscriptionUi.approveList') : t('subscriptionUi.approveLock')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function SubscriptionManagement() {
  const { t, language } = useLanguage();
  const isAdmin = useMemo(() => getStoredRole() === 'admin', []);
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const linkedId = isAdmin && location.pathname === '/admin/subscriptions' ? searchParams.get('subscriptionId') : null;
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState('');
  const [transferError, setTransferError] = useState('');
  const [transferLoading, setTransferLoading] = useState(isAdmin);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [packageFilter, setPackageFilter] = useState('all');
  const [transfers, setTransfers] = useState([]);
  const cardRef = useRef(null);
  const requestGeneration = useRef(0);
  const [linkedState, setLinkedState] = useState({ status: 'loading' });
  const linkedKey = linkedId ? `${location.key}:${linkedId}` : null;
  const lookup = useMemo(() => createSubscriptionLookup(() => apiFetch('/subscriptions/all', {
    cache: 'no-store', headers: { Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}` },
  }), (result) => {
    setLinkedState({ ...result, key: linkedKey });
    if (result.status !== 'loading') {
      setSubscriptions(result.subscriptions || []);
      setSubscriptionError(result.status === 'error' ? t('subscriptionUi.fetchError') : result.status === 'unavailable' ? t('subscriptionUi.subscriptionUnavailable') : '');
    }
  }), [linkedKey, setLinkedState, setSubscriptions, setSubscriptionError, t]);
  const currentLinkedState = linkedState.key === linkedKey ? linkedState : { status: 'loading' };
  const verifiedLinkedId = linkedId && currentLinkedState.status === 'ready' && !loading
    ? currentLinkedState.subscription._id : null;
  const subscriptionState = getOperationalViewState({
    loading,
    error: subscriptionError,
  });
  const transferState = getOperationalViewState({
    loading: isAdmin && transferLoading,
    error: isAdmin ? transferError : '',
  });

  const fetchSubscriptions = useCallback(async () => {
    const generation = ++requestGeneration.current;
    try {
      setLoading(true);
      setSubscriptionError('');
      setTransferError('');
      setTransferLoading(isAdmin);
      const token = localStorage.getItem('accessToken');

      const subscriptionRequest = linkedId ? lookup.load(linkedId) : apiFetch('/subscriptions/all', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const transferRequest = isAdmin
        ? apiFetch('/admin/membership-entitlement-transfers', {
            headers: { Authorization: `Bearer ${token}` },
          })
        : Promise.resolve(null);
      const [res, transferRes] = await Promise.all([
        subscriptionRequest,
        transferRequest,
      ]);
      if (isAdmin && generation !== requestGeneration.current) return;

      const subscriptionResponse = linkedId ? null : getResponseAvailability(
        res,
        t('subscriptionUi.fetchError')
      );
      if (linkedId) {
        // The shared list request was already verified and published by lookup.
      } else if (subscriptionResponse.isAvailable) {
        setSubscriptions(subscriptionResponse.data || []);
      } else {
        setSubscriptions([]);
        setSubscriptionError(subscriptionResponse.error);
      }

      if (isAdmin) {
        const transferResponse = getResponseAvailability(
          transferRes,
          t('subscriptionUi.transferUnavailable')
        );
        if (transferResponse.isAvailable) {
          setTransfers(transferResponse.data || []);
        } else {
          setTransfers([]);
          setTransferError(transferResponse.error);
        }
      } else {
        setTransfers([]);
      }
    } catch (err) {
      if (isAdmin && generation !== requestGeneration.current) return;
      console.error(err);
      setSubscriptions([]);
      setSubscriptionError(t('subscriptionUi.genericFetchError'));
      if (isAdmin) {
        setTransfers([]);
        setTransferError(t('subscriptionUi.transferUnavailable'));
      }
    } finally {
      if (!isAdmin || generation === requestGeneration.current) {
        setLoading(false);
        setTransferLoading(false);
      }
    }
  }, [isAdmin, linkedId, lookup, t]);

  const reviewTransfer = async (transferId, approved) => {
    const token = localStorage.getItem('accessToken');
    const rejectionReason = approved
      ? ''
      : window.prompt(t('subscriptionUi.rejectReason'))?.trim();
    if (!approved && !rejectionReason) return;
    const response = await apiFetch(
      `/admin/membership-entitlement-transfers/${transferId}/${approved ? 'approve' : 'reject'}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: approved ? undefined : JSON.stringify({ reason: rejectionReason }),
      }
    );
    if (!response.ok || !response.data?.success) {
      setTransferError(response.data?.message || t('subscriptionUi.reviewError'));
      return;
    }
    await fetchSubscriptions();
  };

  useEffect(() => {
    const timerId = window.setTimeout(fetchSubscriptions, 0);
    return () => {
      window.clearTimeout(timerId);
      if (isAdmin) { requestGeneration.current += 1; lookup.cancel(); }
    };
  }, [fetchSubscriptions, isAdmin, lookup]);

  const statusOptions = useMemo(() => {
    const actualStatuses = subscriptions.map((sub) => sub.status).filter(Boolean);
    return Array.from(new Set(['active', 'pending', 'expired', 'cancelled', 'failed', ...actualStatuses]));
  }, [subscriptions]);

  const packageOptions = useMemo(() => {
    const actualPackages = subscriptions
      .map((sub) => sub.ticketPackage?.type)
      .filter(Boolean);
    return Array.from(new Set(actualPackages));
  }, [subscriptions]);

  const filteredSubscriptions = useMemo(() => {
    const searchLower = searchTerm.trim().toLowerCase();
    return subscriptions.filter((sub) => {
      const matchesStatus = statusFilter === 'all' || sub.status === statusFilter;
      const matchesPackage = packageFilter === 'all' || sub.ticketPackage?.type === packageFilter;
      const searchableUsers = [
        sub.user,
        ...(sub.currentOwners || []),
      ].filter(Boolean);
      const matchesSearch = !searchLower || [
        ...searchableUsers.flatMap((user) => [
          user.username,
          user.email,
          ...(user.vehicles || []),
        ]),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(searchLower));

      return matchesStatus && matchesPackage && matchesSearch;
    });
  }, [subscriptions, searchTerm, statusFilter, packageFilter]);
  const visibleSubscriptions = useMemo(() => includeLinkedSubscription(filteredSubscriptions, subscriptions, verifiedLinkedId), [filteredSubscriptions, subscriptions, verifiedLinkedId]);

  const pendingTransfers = transfers.filter((item) => item.status === 'PENDING_ADMIN');

  const summary = useMemo(() => {
    const active = subscriptions.filter((sub) => sub.status === 'active').length;
    const expiringSoon = subscriptions.filter((sub) => {
      const remaining = isAdmin ? vipDaysUntil(sub.expireAt) : daysUntil(sub.expireAt);
      return sub.status === 'active' && remaining !== null && remaining >= 0 && remaining <= 30;
    }).length;

    return {
      total: subscriptions.length,
      active,
      expiringSoon,
      pendingTransfers: pendingTransfers.length,
    };
  }, [subscriptions, pendingTransfers.length, isAdmin]);

  const [staffPage, setStaffPage] = useState(1);
  const staffRowsRef = useRef(null);
  const staffTotalPages = Math.max(1, Math.ceil(filteredSubscriptions.length / 6));
  const staffCurrentPage = Math.min(staffPage, staffTotalPages);
  const staffVisibleSubscriptions = filteredSubscriptions.slice((staffCurrentPage - 1) * 6, staffCurrentPage * 6);
  useEffect(() => {
    if (isAdmin || staffPage <= staffTotalPages) return;
    const timer = setTimeout(() => setStaffPage(staffTotalPages), 0);
    return () => clearTimeout(timer);
  }, [isAdmin, staffPage, staffTotalPages]);
  useEffect(() => {
    if (!isAdmin && staffRowsRef.current) staffRowsRef.current.scrollTop = 0;
  }, [isAdmin, staffCurrentPage, searchTerm, statusFilter, packageFilter]);

  const [adminPage, setAdminPage] = useState(null);
  const [detailMembership, setDetailMembership] = useState(null);
  const adminTotalPages = Math.max(1, Math.ceil(visibleSubscriptions.length / 10));
  const linkedIndex = verifiedLinkedId ? visibleSubscriptions.findIndex((sub) => sub._id === verifiedLinkedId) : -1;
  const adminCurrentPage = Math.min(adminPage ?? (linkedIndex >= 0 ? Math.floor(linkedIndex / 10) + 1 : 1), adminTotalPages);
  const adminVisibleSubscriptions = visibleSubscriptions.slice((adminCurrentPage - 1) * 10, adminCurrentPage * 10);
  const adminRowsRef = useRef(null);
  useEffect(() => {
    if (!isAdmin) return undefined;
    const timer = setTimeout(() => setAdminPage(null), 0);
    return () => clearTimeout(timer);
  }, [isAdmin, linkedKey]);
  useEffect(() => {
    if (isAdmin && adminRowsRef.current) adminRowsRef.current.scrollTop = 0;
  }, [isAdmin, adminCurrentPage, searchTerm, statusFilter, packageFilter]);

  const hasFilters = searchTerm || statusFilter !== 'all' || packageFilter !== 'all';

  return (
    <div className={`g3-management-page g3-vip-page ${isAdmin ? 'admin-vip-memberships' : ''} relative min-h-[calc(100vh-70px)] overflow-auto bg-[#050505] px-4 py-6 text-white sm:px-6 md:px-8`}>
      <div className="g3-vip-ambient pointer-events-none absolute right-0 top-0 h-80 w-80 rounded-full bg-yellow-400/[0.06] blur-3xl" />
      {isAdmin ? <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:46px_46px]" /> : <div className="g3-vip-grid pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:46px_46px]" />}
      <div className="g3-management-content g3-vip-main relative mx-auto max-w-[1400px]">
        {linkedId && <SubscriptionDeepLink key={linkedKey} state={currentLinkedState} loading={loading} cardRef={cardRef}/>}
        <header className="g3-header mb-6 flex flex-col justify-between gap-4 border-b border-white/10 pb-5 md:flex-row md:items-end">
          <div>
            {isAdmin ? <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-3xl font-black tracking-tight text-white">{t('subscriptionUiExtra.title', { defaultValue: 'VIP Memberships' })}</h1>
              <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-[10px] font-black text-yellow-300"><Crown size={12} /> {t('subscriptionUiExtra.badge', { defaultValue: 'VIP Subscriptions' })}</div>
            </div> : <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">{t('subscriptionUiExtra.title', { defaultValue: 'VIP Memberships' })}</h1>}
            <p className="g3-subtitle mt-2 text-sm font-medium text-slate-400">{t('subscriptionUiExtra.subtitle', { defaultValue: 'View and manage customer subscriptions and VIP parking slots.' })}</p>
          </div>

          <button
            type="button"
            onClick={fetchSubscriptions}
            disabled={loading || transferLoading}
            className="g3-action g3-header-action inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm font-black text-white transition hover:border-yellow-300/30 hover:bg-yellow-300/10 hover:text-yellow-100 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-yellow-300/50"
          >
            <RefreshCw className={`h-4 w-4 ${loading || transferLoading ? 'animate-spin' : ''}`} />
            {t('subscriptionUi.retry')}
          </button>
        </header>

        <section className={`g3-metrics-strip g3-vip-metrics mb-5 grid overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] sm:grid-cols-2 ${isAdmin ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
          <SummaryItem
            isAdmin={isAdmin}
            icon={Crown}
            label={t('subscriptionUi.totalVip')}
            value={getOperationalValue(subscriptionState, summary.total.toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US'))}
            support={subscriptionState.isAvailable ? t('subscriptionUi.loaded') : t('subscriptionUi.unavailable')}
          />
          <SummaryItem
            isAdmin={isAdmin}
            icon={ShieldCheck}
            label={t('subscriptionUi.active')}
            value={getOperationalValue(subscriptionState, summary.active.toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US'))}
            support={subscriptionState.isAvailable ? t('subscriptionUi.activeStatus') : t('subscriptionUi.unavailable')}
            tone="text-emerald-300"
          />
          <SummaryItem
            isAdmin={isAdmin}
            icon={Clock3}
            label={t('subscriptionUi.expiringSoon')}
            value={getOperationalValue(subscriptionState, summary.expiringSoon.toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US'))}
            support={subscriptionState.isAvailable ? t('subscriptionUi.within30') : t('subscriptionUi.unavailable')}
            tone="text-amber-300"
          />
          {isAdmin && (
            <SummaryItem
            isAdmin={isAdmin}
              icon={TimerReset}
              label={t('subscriptionUi.transfers')}
              value={getOperationalValue(transferState, summary.pendingTransfers.toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US'))}
              support={transferState.isAvailable ? t('subscriptionUi.pendingReview') : t('subscriptionUi.unavailable')}
              tone="text-purple-300"
            />
          )}
        </section>

        <section className="g3-toolbar mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="g3-search relative flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder={t('subscriptionUi.search')}
              className="h-12 w-full rounded-xl border border-white/10 bg-black/70 pl-11 pr-11 text-sm font-semibold text-white outline-none transition placeholder:text-slate-600 focus:border-[#ffd555]/60 focus:ring-2 focus:ring-[#ffd555]/10"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); if (!isAdmin) setStaffPage(1); else setAdminPage(1); }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => { setSearchTerm(''); if (!isAdmin) setStaffPage(1); else setAdminPage(1); }}
                aria-label={t('subscriptionUi.clearSearch')}
                className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-yellow-300/50"
              >
                <X size={15} />
              </button>
            )}
          </div>

          <AdminSelect
            value={statusFilter}
            onChange={(value) => { setStatusFilter(value); if (!isAdmin) setStaffPage(1); else setAdminPage(1); }}
            options={[
              { value: 'all', label: t('subscriptionUi.allStatuses') },
              ...statusOptions.map((status) => ({ value: status, label: t(`subscriptionStatus.${status}`, { defaultValue: titleCase(status) }) })),
            ]}
            icon={Filter}
            className="lg:w-52"
            ariaLabel={t('subscriptionUi.filterStatus')}
          />

          {packageOptions.length > 0 && (
            <AdminSelect
              value={packageFilter}
              onChange={(value) => { setPackageFilter(value); if (!isAdmin) setStaffPage(1); else setAdminPage(1); }}
              options={[
                { value: 'all', label: t('subscriptionUi.allPackages') },
                ...packageOptions.map((type) => ({ value: type, label: t(`adminPages.ticketUi.types.${type}`, { defaultValue: titleCase(type) }) })),
              ]}
              icon={Crown}
              className="lg:w-52"
              align="right"
              ariaLabel={t('subscriptionUi.filterPackage')}
            />
          )}
        </section>

        {subscriptionError && (
          <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle size={17} />
              <span className="font-semibold">{subscriptionError}</span>
            </div>
            <button
              type="button"
              onClick={fetchSubscriptions}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-300/20 px-3 py-2 text-xs font-black text-red-100 transition hover:bg-red-400/10 focus:outline-none focus:ring-2 focus:ring-red-300/50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              {t('subscriptionUi.retry')}
            </button>
          </div>
        )}

        {isAdmin && transferLoading && (
          <section className="mb-6 border-y border-white/10 py-5 text-sm font-semibold text-slate-400">
            {t('subscriptionUi.loadingTransfers')}
          </section>
        )}
        {isAdmin && !transferLoading && transferError && (
          <section className="mb-6 flex items-start gap-3 border-y border-red-500/25 py-4 text-sm text-red-300" role="alert">
            <AlertCircle size={17} className="mt-0.5 shrink-0" />
            <div>
              <h2 className="font-black text-red-200">{t('subscriptionUi.transferUnavailable')}</h2>
              <p className="mt-1 font-medium text-red-300/75">{transferError}</p>
            </div>
          </section>
        )}
        {isAdmin && transferState.isAvailable && (
          <TransferReviewSection transfers={transfers} onReview={reviewTransfer} />
        )}

        <section className="g3-membership-list">
          {!isAdmin && <div className="g3-membership-columns hidden px-5 pb-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:grid md:grid-cols-[minmax(220px,1.35fr)_minmax(145px,0.9fr)_minmax(150px,1fr)_minmax(130px,0.8fr)_minmax(150px,0.9fr)_110px]">
            <span>{t('subscriptionUi.customer')}</span>
            <span>{t('subscriptionUi.package')}</span>
            <span>{t('subscriptionUi.vipSlot')}</span>
            <span>{t('subscriptionUi.amount')}</span>
            <span>{t('subscriptionUi.period')}</span>
            <span>{t('subscriptionUi.status')}</span>
          </div>}

          <div className={isAdmin ? 'admin-vip-scroll' : 'staff-membership-scroll'} ref={isAdmin ? adminRowsRef : staffRowsRef} tabIndex={isAdmin ? 0 : undefined} role={isAdmin ? 'region' : undefined} aria-label={isAdmin ? t('subscriptionUi.membershipList') : undefined}>
          {loading ? (
            <LoadingRows />
          ) : subscriptionError ? (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-6 py-10 text-center" role="alert">
              <AlertCircle size={28} className="mx-auto text-red-400" />
              <h2 className="mt-3 text-lg font-black text-red-200">{t('subscriptionUi.subscriptionUnavailable')}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm font-medium text-red-300/70">{subscriptionError}</p>
            </div>
          ) : visibleSubscriptions.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-10 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-yellow-400/20 bg-yellow-400/10 text-yellow-300">
                <Crown size={22} />
              </div>
              <h2 className="text-lg font-black text-white">{t('subscriptionUi.noMemberships')}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm font-medium text-slate-400">
                {hasFilters ? t('subscriptionUi.adjustFilters') : t('subscriptionUi.noSubscriptions')}
              </p>
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setStatusFilter('all');
                    setPackageFilter('all');
                    if (!isAdmin) setStaffPage(1); else setAdminPage(1);
                  }}
                  className="g3-action mt-5 inline-flex h-10 items-center justify-center rounded-xl border border-yellow-300/20 px-4 text-sm font-black text-yellow-200 transition hover:bg-yellow-300/10 focus:outline-none focus:ring-2 focus:ring-yellow-300/50"
                >
                  {t('subscriptionUi.clearFilters')}
                </button>
              )}
            </div>
          ) : (
            isAdmin ? <table className="admin-vip-table">
              <thead><tr>{[t('subscriptionUi.customer'), t('subscriptionUi.package'), t('subscriptionUi.vipSlot'), t('subscriptionUi.amount'), t('subscriptionUi.period'), t('subscriptionUi.status'), t('subscriptionUi.customerVehicles')].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody>{adminVisibleSubscriptions.map((sub, index) => <MembershipRow key={sub._id} sub={sub} index={index} isAdmin onOpen={setDetailMembership} cardRef={sub._id === verifiedLinkedId ? cardRef : undefined} />)}</tbody>
            </table> : <div className="g3-membership-rows space-y-2">
              {(isAdmin ? visibleSubscriptions : staffVisibleSubscriptions).map((sub, index) => (
                <MembershipRow key={sub._id} sub={sub} index={index} onOpen={setDetailMembership} cardRef={sub._id === verifiedLinkedId ? cardRef : undefined} />
              ))}
            </div>
          )}
          </div>
        </section>
        {isAdmin && <nav className="admin-vip-pagination flex items-center justify-between border-t border-white/[0.05] bg-[#080808] flex-shrink-0" aria-label={t('subscriptionPagination.pages')}>
          <span className="text-xs text-white/30">{loading || subscriptionError ? t('subscriptionUi.subscriptionUnavailable') : t('subscriptionPagination.pageSummary', { current: adminCurrentPage, total: adminTotalPages, count: visibleSubscriptions.length })}</span>
          <div className="flex items-center gap-1">
            <button type="button" aria-label={t('subscriptionPagination.previousPage')} className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 hover:text-white hover:bg-white/6 disabled:opacity-25 disabled:cursor-not-allowed transition-all" disabled={loading || Boolean(subscriptionError) || adminCurrentPage === 1} onClick={() => setAdminPage(adminCurrentPage - 1)}>&larr; {t('subscriptionPagination.previous')}</button>
            {getPaginationPages(adminCurrentPage, adminTotalPages).map((page) => typeof page === 'number' ? <button key={page} type="button" className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all ${page === adminCurrentPage ? 'bg-[#ffd555] text-black shadow-[0_0_12px_rgba(255,213,85,0.4)]' : 'text-white/40 hover:text-white hover:bg-white/6'}`} aria-current={page === adminCurrentPage ? 'page' : undefined} disabled={loading || Boolean(subscriptionError)} onClick={() => setAdminPage(page)}>{page}</button> : <span key={page} aria-hidden="true">...</span>)}
            <button type="button" aria-label={t('subscriptionPagination.nextPage')} className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 hover:text-white hover:bg-white/6 disabled:opacity-25 disabled:cursor-not-allowed transition-all" disabled={loading || Boolean(subscriptionError) || adminCurrentPage === adminTotalPages} onClick={() => setAdminPage(adminCurrentPage + 1)}>{t('subscriptionPagination.next')} &rarr;</button>
          </div>
        </nav>}
        {detailMembership && <Dialog open onClose={() => setDetailMembership(null)} className="relative z-[80]">
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" aria-hidden="true" />
          <div className="fixed inset-0 overflow-y-auto p-4 sm:p-8">
            <div className="flex min-h-full items-center justify-center">
              <DialogPanel className="w-full max-w-2xl overflow-hidden rounded-3xl border border-emerald-300/20 bg-[#0d1418] text-white shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-gradient-to-br from-emerald-400/10 to-transparent p-6">
                  <div><p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-300"><Crown size={15} /> {t('subscriptionUiExtra.badge', { defaultValue: 'VIP Subscriptions' })}</p><DialogTitle className="text-2xl font-bold">{detailMembership.ticketPackage?.name || t('subscriptionUi.unknownPackage')}</DialogTitle><div className="mt-3"><StatusBadge status={detailMembership.status} /></div></div>
                  <button type="button" autoFocus onClick={() => setDetailMembership(null)} className="rounded-xl border border-white/10 p-2.5 text-slate-400 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300" aria-label={t('subscriptionUi.close')}><X size={20} /></button>
                </div>
                <div className="space-y-6 p-6">
                  <div className="flex items-center gap-3"><span className="rounded-xl bg-white/5 p-3 text-slate-400"><UserRound size={22} /></span><div className="min-w-0"><p className="break-words font-bold">{getDisplayUser(detailMembership, t)?.username || t('subscriptionUi.unknownUser')}</p><p className="break-all text-sm text-slate-400">{getDisplayUser(detailMembership, t)?.email || t('subscriptionUi.noEmail')}</p></div></div>
                  <section className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.04] p-4" aria-label={t('subscriptionUi.customerVehicles')}>
                    <h3 className="flex items-center gap-2 font-bold text-emerald-200"><Car size={19} /> {t('subscriptionUi.registeredPlates')} <span className="ml-auto rounded-full bg-emerald-300/10 px-2.5 py-0.5 text-sm">{getDisplayUser(detailMembership, t)?.vehicles?.length || 0}</span></h3>
                    <p className="mt-2 text-xs leading-relaxed text-slate-400">{t('subscriptionUi.customerVehicles')}</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">{(getDisplayUser(detailMembership, t)?.vehicles || []).map((plate, index) => <div key={`${plate}-${index}`} className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#101c21] p-3"><Car size={20} className="shrink-0 text-emerald-300" /><span className="break-all font-mono text-lg font-bold tracking-wider">{plate}</span></div>)}</div>
                    {!getDisplayUser(detailMembership, t)?.vehicles?.length && <p className="py-4 text-sm text-slate-400">{t('subscriptionUi.noVehicle')}</p>}
                    {detailMembership.currentOwners?.length > 1 && <div className="mt-3 space-y-2 border-t border-white/10 pt-3">{detailMembership.currentOwners.map((owner, index) => <p key={owner._id || index} className="break-words text-xs text-slate-400">{owner.username || owner.email || t('subscriptionUi.unknownCustomer')}: {owner.vehicles?.join(', ') || t('subscriptionUi.noVehicleShort')}</p>)}</div>}
                  </section>
                  <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                    {[
                      [t('subscriptionUi.package'), t(`adminPages.ticketUi.types.${detailMembership.ticketPackage?.type}`, { defaultValue: titleCase(detailMembership.ticketPackage?.type) })],
                      [t('subscriptionUi.vipSlot'), detailMembership.slots?.map((slot) => `${slot.floorId?.name || t('subscriptionUi.floor')} ${slot.slotCode}`).join(', ') || t('subscriptionUi.notAssigned')],
                      [t('subscriptionUi.amount'), formatCurrency(detailMembership.amount, language)],
                      [t('walletPage.status'), t(`walletPage.statuses.${detailMembership.paymentStatus}`, { defaultValue: titleCase(detailMembership.paymentStatus) })],
                      [t('subscriptionDetails.validFrom'), formatDate(detailMembership.validFrom, t('subscriptionUi.unavailable'), language)],
                      [t('subscriptionDetails.expiresAt'), formatDate(detailMembership.expireAt, t('subscriptionUi.unavailable'), language)],
                    ].map(([label, value]) => <div key={label} className="rounded-xl border border-white/5 bg-white/[0.02] p-3"><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1.5 break-words font-semibold">{value}</dd></div>)}
                  </dl>
                </div>
              </DialogPanel>
            </div>
          </div>
        </Dialog>}
        {!isAdmin && <nav className="staff-membership-pagination g3-pagination" aria-label={t('subscriptionPagination.pages')}>
          <span>{loading || subscriptionError ? t('subscriptionUi.subscriptionUnavailable') : t('subscriptionPagination.pageSummary', { current: staffCurrentPage, total: staffTotalPages, count: filteredSubscriptions.length })}</span>
          <div className="staff-membership-page-controls">
            <button type="button" data-nav="prev" aria-label={t('subscriptionPagination.previousPage')} disabled={loading || Boolean(subscriptionError) || staffCurrentPage === 1} onClick={() => setStaffPage(staffCurrentPage - 1)}><ChevronLeft size={15} aria-hidden="true" />{t('subscriptionPagination.previous')}</button>
            {!loading && !subscriptionError && getPaginationPages(staffCurrentPage, staffTotalPages).map(page => typeof page === 'number'
              ? <button type="button" key={page} aria-current={page === staffCurrentPage ? 'page' : undefined} onClick={() => setStaffPage(page)}>{page}</button>
              : <span key={page} aria-hidden="true">...</span>)}
            <button type="button" data-nav="next" aria-label={t('subscriptionPagination.nextPage')} disabled={loading || Boolean(subscriptionError) || staffCurrentPage === staffTotalPages} onClick={() => setStaffPage(staffCurrentPage + 1)}>{t('subscriptionPagination.next')}<ChevronRight size={15} aria-hidden="true" /></button>
          </div>
        </nav>}
      </div>
    </div>
  );
}
