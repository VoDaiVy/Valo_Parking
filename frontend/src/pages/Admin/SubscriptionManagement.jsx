import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Car,
  CheckCircle2,
  Clock3,
  Crown,
  Filter,
  Globe2,
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
import AdminSelect from '../../components/Admin/AdminSelect';
import { useLanguage } from '../../i18n/hooks/useLanguage';
import {
  getOperationalValue,
  getOperationalViewState,
  getResponseAvailability,
} from '../../utils/staffOperationalAvailability';

const currencyFormatter = new Intl.NumberFormat('vi-VN');
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const formatCurrency = (value = 0) => `${currencyFormatter.format(Number(value) || 0)} VND`;

const formatDate = (value) => {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return dateFormatter.format(date);
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

const getDisplayUser = (subscription) => {
  const currentOwners = subscription.currentOwners || [];
  if (subscription.currentOwner) return subscription.currentOwner;
  if (currentOwners.length > 1) {
    return {
      username: `${currentOwners.length} Current Owners`,
      email: 'Ownership differs by parking slot',
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

function SummaryItem({ icon: Icon, label, value, support, tone = 'text-yellow-300' }) {
  return (
    <div className="flex min-w-0 items-center gap-4 px-5 py-4 md:border-l md:border-white/10 md:first:border-l-0">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-white/[0.03] ${tone}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
        <p className="mt-1 font-mono text-xl font-black text-white">{value}</p>
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

function StatusBadge({ status, t }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black ${getStatusClass(status)}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status === 'active' ? 'bg-emerald-300' : status === 'pending' ? 'bg-amber-300' : status === 'expired' ? 'bg-slate-400' : 'bg-rose-300'}`} />
      {t ? t(`subscriptionStatus.${status}`, { defaultValue: titleCase(status) }) : titleCase(status)}
    </span>
  );
}

function SlotBadge({ slot, t }) {
  if (!slot) {
    return <span className="text-xs font-semibold italic text-slate-500">{t('subscriptionUi.notAssigned')}</span>;
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-xl border border-yellow-400/20 bg-yellow-400/10 px-3 py-2 text-xs font-black text-yellow-300 transition group-hover:border-yellow-300/35">
      <ParkingCircle size={14} />
      <span className="text-slate-300">{slot.floorId?.name || t('subscriptionUi.floor')}</span>
      <span className="text-yellow-300">{slot.slotCode}</span>
    </span>
  );
}

function MembershipRow({ sub, index, onCustomerClick, t }) {
  const remaining = daysUntil(sub.expireAt);
  const packageType = sub.ticketPackage?.type || '';
  const displayUser = getDisplayUser(sub);
  const vehicles = displayUser?.vehicles || [];
  const vehicleText = vehicles.length ? t('subscriptionUi.vehicleCount', { count: vehicles.length }) : t('subscriptionUi.noVehicleShort');

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={t('subscriptionUi.viewVehicles', { name: displayUser?.username || displayUser?.email || t('subscriptionUi.customer') })}
      onClick={() => onCustomerClick?.({ user: displayUser, vehicles })}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onCustomerClick?.({ user: displayUser, vehicles });
        }
      }}
      className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-[#10141d]/80 transition duration-200 hover:-translate-y-0.5 hover:border-yellow-300/35 hover:bg-[#141a25] focus:outline-none focus:ring-2 focus:ring-yellow-300/60 motion-reduce:transform-none motion-reduce:transition-none"
      style={{ animationDelay: `${index * 35}ms` }}
    >
      <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-yellow-300 to-amber-500 opacity-0 transition group-hover:opacity-80" />
      <div className="grid gap-4 px-4 py-4 md:grid-cols-[minmax(220px,1.35fr)_minmax(145px,0.9fr)_minmax(150px,1fr)_minmax(130px,0.8fr)_minmax(150px,0.9fr)_110px] md:items-center md:px-5">
        <div className="min-w-0">
          <button type="button" onClick={() => onCustomerClick?.({ user: displayUser, vehicles })} className="flex w-full items-center gap-3 text-left focus:outline-none focus:ring-2 focus:ring-yellow-300/50">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300">
              <UserRound size={17} />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-black text-white sm:text-base">{displayUser?.username || t('subscriptionUi.unknownUser')}</h3>
              <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">{displayUser?.email || t('subscriptionUi.noEmailShort')}</p>
            </div>
          </button>
          <button type="button" onClick={() => onCustomerClick?.({ user: displayUser, vehicles })} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-300/50" title={t('subscriptionUi.customerVehicles')}>
            <Car size={12} />
            {vehicleText}
          </button>
        </div>

        <div className="flex items-start justify-between gap-3 md:block">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">{t('subscriptionUi.package')}</span>
          <div className="text-right md:text-left">
            <p className="font-black text-slate-100">{sub.ticketPackage?.name || t('subscriptionUi.unknownPackage')}</p>
            {packageType && (
              <span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${getPackageClass(packageType)}`}>
                {packageType}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">{t('subscriptionUi.vipSlot')}</span>
          <div className="flex flex-wrap justify-end gap-1.5 md:justify-start">
            {sub.slots && sub.slots.length > 0 ? sub.slots.map((slot) => (
              <SlotBadge key={`${slot.floorId?._id || slot.floorId}-${slot.slotCode}`} slot={slot} t={t} />
            )) : (
              <SlotBadge t={t} />
            )}
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">{t('subscriptionUi.amount')}</span>
          <div className="text-right md:text-left">
            <p className="font-mono text-sm font-black text-white">{formatCurrency(sub.amount)}</p>
            {sub.paymentStatus && <p className="mt-1 text-xs font-semibold text-slate-500">{titleCase(sub.paymentStatus)}</p>}
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">{t('subscriptionUi.period')}</span>
          <div className="text-right text-xs font-semibold text-slate-400 md:text-left">
            <p>{formatDate(sub.validFrom)}</p>
            <p className="mt-1 text-slate-500">{t('subscriptionUi.to')} {formatDate(sub.expireAt)}</p>
            {remaining !== null && remaining >= 0 && (
              <p className={`mt-1 ${remaining <= 30 ? 'text-amber-300' : 'text-slate-500'}`}>
                {remaining === 0 ? t('subscriptionUi.expiresToday') : t('subscriptionUi.daysLeft', { count: remaining })}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">{t('subscriptionUi.status')}</span>
          <StatusBadge status={sub.status} t={t} />
        </div>
      </div>
    </article>
  );
}

function CustomerVehiclesModal({ customer, onClose, t }) {
  if (!customer) return null;
  const user = customer.user || {};
  const vehicles = customer.vehicles || [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="customer-vehicles-title" className="w-full max-w-md rounded-2xl border border-white/15 bg-[#11151d] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-yellow-300">{t('subscriptionUi.customerVehicles')}</p><h2 id="customer-vehicles-title" className="mt-2 text-2xl font-black text-white">{user.username || t('subscriptionUi.unknownCustomer')}</h2><p className="mt-1 text-sm text-slate-400">{user.email || t('subscriptionUi.noEmail')}</p></div>
          <button type="button" onClick={onClose} aria-label={t('subscriptionUi.close')} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"><X size={18} /></button>
        </div>
        <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{t('subscriptionUi.registeredPlates')}</p>
          {vehicles.length ? <div className="mt-3 space-y-2">{vehicles.map((plate) => <div key={plate} className="flex items-center gap-3 rounded-xl border border-yellow-400/15 bg-yellow-400/[0.06] px-4 py-3"><Car size={17} className="text-yellow-300" /><span className="font-mono text-base font-black tracking-wider text-white">{plate}</span></div>)}</div> : <p className="mt-3 text-sm text-slate-400">{t('subscriptionUi.noVehicle')}</p>}
        </div>
        <button type="button" onClick={onClose} className="mt-5 w-full rounded-xl bg-yellow-400 px-4 py-3 text-sm font-black text-black hover:bg-yellow-300">{t('subscriptionUi.close')}</button>
      </section>
    </div>
  );
}

function TransferReviewSection({ transfers, onReview, t }) {
  const pendingTransfers = transfers.filter((item) => item.status === 'PENDING_ADMIN');

  if (!pendingTransfers.length) {
    return (
      <section className="mb-6 flex flex-col gap-3 border-y border-white/10 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-black text-white">{t('subscriptionUi.transferReviews')}</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">{t('subscriptionUi.noTransfers')}</p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-300">
          <CheckCircle2 size={14} /> 0 {t('subscriptionUi.pending')}
        </span>
      </section>
    );
  }

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
                Price {formatCurrency(transfer.askingPrice)} · Fee {formatCurrency(transfer.transferFee)}
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
  const { t } = useLanguage();
  const isAdmin = useMemo(() => getStoredRole() === 'admin', []);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState('');
  const [transferError, setTransferError] = useState('');
  const [transferLoading, setTransferLoading] = useState(isAdmin);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [packageFilter, setPackageFilter] = useState('all');
  const [selectedCustomerVehicles, setSelectedCustomerVehicles] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const subscriptionState = getOperationalViewState({
    loading,
    error: subscriptionError,
  });
  const transferState = getOperationalViewState({
    loading: isAdmin && transferLoading,
    error: isAdmin ? transferError : '',
  });

  const fetchSubscriptions = async () => {
    try {
      setLoading(true);
      setSubscriptionError('');
      setTransferError('');
      setTransferLoading(isAdmin);
      const token = localStorage.getItem('accessToken');

      const subscriptionRequest = apiFetch('/subscriptions/all', {
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

      const subscriptionResponse = getResponseAvailability(
        res,
        t('subscriptionUi.fetchError')
      );
      if (subscriptionResponse.isAvailable) {
        setSubscriptions(subscriptionResponse.data || []);
      } else {
        setSubscriptions([]);
        setSubscriptionError(subscriptionResponse.error);
      }

      if (isAdmin) {
        const transferResponse = getResponseAvailability(
          transferRes,
          t('subscriptionUi.transferFetchError')
        );
        if (transferResponse.isAvailable) {
          setTransfers(transferResponse.data || []);
        } else {
          setTransfers([]);
          setTransferError(transferResponse.error || t('subscriptionUi.transferFetchError'));
        }
      } else {
        setTransfers([]);
      }
    } catch (err) {
      console.error(err);
      setSubscriptions([]);
      setSubscriptionError(t('subscriptionUi.genericFetchError'));
      if (isAdmin) {
        setTransfers([]);
        setTransferError(t('subscriptionUi.transferFetchError'));
      }
    } finally {
      setLoading(false);
      setTransferLoading(false);
    }
  };

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
    return () => window.clearTimeout(timerId);
  }, []);

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

  const pendingTransfers = transfers.filter((item) => item.status === 'PENDING_ADMIN');

  const summary = useMemo(() => {
    const active = subscriptions.filter((sub) => sub.status === 'active').length;
    const expiringSoon = subscriptions.filter((sub) => {
      const remaining = daysUntil(sub.expireAt);
      return sub.status === 'active' && remaining !== null && remaining >= 0 && remaining <= 30;
    }).length;

    return {
      total: subscriptions.length,
      active,
      expiringSoon,
      pendingTransfers: pendingTransfers.length,
    };
  }, [subscriptions, pendingTransfers.length]);

  const hasFilters = searchTerm || statusFilter !== 'all' || packageFilter !== 'all';

  return (
    <div className="relative min-h-[calc(100vh-70px)] overflow-auto bg-[#050505] px-4 py-6 text-white sm:px-6 md:px-8">
      <div className="pointer-events-none absolute right-0 top-0 h-80 w-80 rounded-full bg-yellow-400/[0.06] blur-3xl" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:46px_46px]" />
      <div className="relative mx-auto max-w-[1400px]">
        <header className="mb-6 flex flex-col justify-between gap-4 border-b border-white/10 pb-5 md:flex-row md:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-yellow-500/25 bg-yellow-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-yellow-300">
              <Crown size={12} /> {t('adminPages.subscriptions.title')}
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">{t('adminPages.subscriptions.title')}</h1>
            <p className="mt-2 text-sm font-medium text-slate-400">{t('adminPages.subscriptions.subtitle')}</p>
          </div>

          <button
            type="button"
            onClick={fetchSubscriptions}
            disabled={loading || transferLoading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm font-black text-white transition hover:border-yellow-300/30 hover:bg-yellow-300/10 hover:text-yellow-100 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-yellow-300/50"
          >
            <RefreshCw className={`h-4 w-4 ${loading || transferLoading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </button>
        </header>

        <section className={`mb-5 grid overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] sm:grid-cols-2 ${isAdmin ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
          <SummaryItem
            icon={Crown}
            label={t('subscriptionUi.totalVip')}
            value={getOperationalValue(subscriptionState, summary.total.toLocaleString('vi-VN'))}
            support={subscriptionState.isAvailable ? t('subscriptionUi.loaded') : t('subscriptionUi.unavailable')}
          />
          <SummaryItem
            icon={ShieldCheck}
            label={t('subscriptionUi.active')}
            value={getOperationalValue(subscriptionState, summary.active.toLocaleString('vi-VN'))}
            support={subscriptionState.isAvailable ? t('subscriptionUi.activeStatus') : t('subscriptionUi.unavailable')}
            tone="text-emerald-300"
          />
          <SummaryItem
            icon={Clock3}
            label={t('subscriptionUi.expiringSoon')}
            value={getOperationalValue(subscriptionState, summary.expiringSoon.toLocaleString('vi-VN'))}
            support={subscriptionState.isAvailable ? t('subscriptionUi.within30') : t('subscriptionUi.unavailable')}
            tone="text-amber-300"
          />
          {isAdmin && (
            <SummaryItem
              icon={TimerReset}
              label={t('subscriptionUi.transfers')}
              value={getOperationalValue(transferState, summary.pendingTransfers.toLocaleString('vi-VN'))}
              support={transferState.isAvailable ? t('subscriptionUi.pendingReview') : t('subscriptionUi.unavailable')}
              tone="text-purple-300"
            />
          )}
        </section>

        <section className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder={t('subscriptionUi.search')}
              className="h-12 w-full rounded-xl border border-white/10 bg-black/70 pl-11 pr-11 text-sm font-semibold text-white outline-none transition placeholder:text-slate-600 focus:border-[#ffd555]/60 focus:ring-2 focus:ring-[#ffd555]/10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                aria-label={t('subscriptionUi.clearSearch')}
                className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-yellow-300/50"
              >
                <X size={15} />
              </button>
            )}
          </div>

          <AdminSelect
            value={statusFilter}
            onChange={setStatusFilter}
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
              onChange={setPackageFilter}
              options={[
                { value: 'all', label: t('subscriptionUi.allPackages') },
                ...packageOptions.map((type) => ({ value: type, label: titleCase(type) })),
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
          <TransferReviewSection transfers={transfers} onReview={reviewTransfer} t={t} />
        )}

        <section>
          <div className="hidden px-5 pb-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:grid md:grid-cols-[minmax(220px,1.35fr)_minmax(145px,0.9fr)_minmax(150px,1fr)_minmax(130px,0.8fr)_minmax(150px,0.9fr)_110px]">
            <span>{t('subscriptionUi.customer')}</span>
            <span>{t('subscriptionUi.package')}</span>
            <span>{t('subscriptionUi.vipSlot')}</span>
            <span>{t('subscriptionUi.amount')}</span>
            <span>{t('subscriptionUi.period')}</span>
            <span>{t('subscriptionUi.status')}</span>
          </div>

          {loading ? (
            <LoadingRows />
          ) : subscriptionError ? (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-6 py-10 text-center" role="alert">
              <AlertCircle size={28} className="mx-auto text-red-400" />
              <h2 className="mt-3 text-lg font-black text-red-200">{t('subscriptionUi.subscriptionUnavailable')}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm font-medium text-red-300/70">{subscriptionError}</p>
            </div>
          ) : filteredSubscriptions.length === 0 ? (
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
                  }}
                  className="mt-5 inline-flex h-10 items-center justify-center rounded-xl border border-yellow-300/20 px-4 text-sm font-black text-yellow-200 transition hover:bg-yellow-300/10 focus:outline-none focus:ring-2 focus:ring-yellow-300/50"
                >
                  {t('subscriptionUi.clearFilters')}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredSubscriptions.map((sub, index) => (
                <MembershipRow key={sub._id} sub={sub} index={index} onCustomerClick={setSelectedCustomerVehicles} t={t} />
              ))}
            </div>
          )}
        </section>
      </div>
      <CustomerVehiclesModal customer={selectedCustomerVehicles} onClose={() => setSelectedCustomerVehicles(null)} t={t} />
    </div>
  );
}
