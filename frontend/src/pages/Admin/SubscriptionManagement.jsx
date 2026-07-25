import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Crown,
  Filter,
  Globe2,
  Mail,
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

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black ${getStatusClass(status)}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status === 'active' ? 'bg-emerald-300' : status === 'pending' ? 'bg-amber-300' : status === 'expired' ? 'bg-slate-400' : 'bg-rose-300'}`} />
      {titleCase(status)}
    </span>
  );
}

function SlotBadge({ slot }) {
  if (!slot) {
    return <span className="text-xs font-semibold italic text-slate-500">Not assigned</span>;
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-xl border border-yellow-400/20 bg-yellow-400/10 px-3 py-2 text-xs font-black text-yellow-300 transition group-hover:border-yellow-300/35">
      <ParkingCircle size={14} />
      <span className="text-slate-300">{slot.floorId?.name || 'Floor'}</span>
      <span className="text-yellow-300">{slot.slotCode}</span>
    </span>
  );
}

function MembershipRow({ sub, index }) {
  const remaining = daysUntil(sub.expireAt);
  const packageType = sub.ticketPackage?.type || '';
  const vehicles = sub.user?.vehicles || [];
  const vehicleText = vehicles.length ? `${vehicles.length} vehicle${vehicles.length > 1 ? 's' : ''} on file` : 'No vehicle on file';

  return (
    <article
      className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#10141d]/80 transition duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-[#141a25] motion-reduce:transform-none motion-reduce:transition-none"
      style={{ animationDelay: `${index * 35}ms` }}
    >
      <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-yellow-300 to-amber-500 opacity-0 transition group-hover:opacity-80" />
      <div className="grid gap-4 px-4 py-4 md:grid-cols-[minmax(220px,1.35fr)_minmax(145px,0.9fr)_minmax(150px,1fr)_minmax(130px,0.8fr)_minmax(150px,0.9fr)_110px] md:items-center md:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300">
              <UserRound size={17} />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-black text-white sm:text-base">{sub.user?.username || 'Unknown User'}</h3>
              <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">{sub.user?.email || 'No email'}</p>
            </div>
          </div>
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500" title={vehicles.join(', ')}>
            <Mail size={12} />
            {vehicleText}
          </p>
        </div>

        <div className="flex items-start justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">Package</span>
          <div className="text-right md:text-left">
            <p className="font-black text-slate-100">{sub.ticketPackage?.name || 'Unknown Package'}</p>
            {packageType && (
              <span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${getPackageClass(packageType)}`}>
                {packageType}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">VIP Slot</span>
          <div className="flex flex-wrap justify-end gap-1.5 md:justify-start">
            {sub.slots && sub.slots.length > 0 ? sub.slots.map((slot) => (
              <SlotBadge key={`${slot.floorId?._id || slot.floorId}-${slot.slotCode}`} slot={slot} />
            )) : (
              <SlotBadge />
            )}
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">Amount</span>
          <div className="text-right md:text-left">
            <p className="font-mono text-sm font-black text-white">{formatCurrency(sub.amount)}</p>
            {sub.paymentStatus && <p className="mt-1 text-xs font-semibold text-slate-500">{titleCase(sub.paymentStatus)}</p>}
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">Period</span>
          <div className="text-right text-xs font-semibold text-slate-400 md:text-left">
            <p>{formatDate(sub.validFrom)}</p>
            <p className="mt-1 text-slate-500">to {formatDate(sub.expireAt)}</p>
            {remaining !== null && remaining >= 0 && (
              <p className={`mt-1 ${remaining <= 30 ? 'text-amber-300' : 'text-slate-500'}`}>
                {remaining === 0 ? 'Expires today' : `${remaining} days left`}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 md:block">
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:hidden">Status</span>
          <StatusBadge status={sub.status} />
        </div>
      </div>
    </article>
  );
}

function TransferReviewSection({ transfers, onReview }) {
  const pendingTransfers = transfers.filter((item) => item.status === 'PENDING_ADMIN');

  if (!pendingTransfers.length) {
    return (
      <section className="mb-6 flex flex-col gap-3 border-y border-white/10 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-black text-white">Transfer reviews</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">No membership transfers require review.</p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-300">
          <CheckCircle2 size={14} /> 0 pending
        </span>
      </section>
    );
  }

  return (
    <section className="mb-6 border-y border-amber-400/20 py-4">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-black text-white">Transfer reviews</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Review direct transfers and public marketplace listings.</p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-black text-amber-300">
          <TimerReset size={14} /> {pendingTransfers.length} pending
        </span>
      </div>

      <div className="divide-y divide-white/10">
        {pendingTransfers.map((transfer) => (
          <div key={transfer._id} className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <span className={`mb-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${transfer.mode === 'PUBLIC' ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-300' : 'border-violet-400/20 bg-violet-400/10 text-violet-300'}`}>
                {transfer.mode === 'PUBLIC' ? <Globe2 size={12} /> : <UserCheck size={12} />}
                {transfer.mode === 'PUBLIC' ? 'Public listing' : 'Direct transfer'}
              </span>
              <p className="truncate text-sm font-black text-slate-100">
                {transfer.entitlementId?.slotCode || 'Parking space'} · {transfer.fromUserId?.email || 'Sender'} → {transfer.mode === 'PUBLIC' ? 'Marketplace' : (transfer.toUserId?.email || 'Recipient')}
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
                Reject
              </button>
              <button
                type="button"
                onClick={() => onReview(transfer._id, true)}
                className="h-10 rounded-xl bg-emerald-400 px-4 text-xs font-black text-slate-950 transition hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-200/70"
              >
                {transfer.mode === 'PUBLIC' ? 'Approve & list 7d' : 'Approve & lock 24h'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function SubscriptionManagement() {
  const isAdmin = useMemo(() => getStoredRole() === 'admin', []);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState('');
  const [transferError, setTransferError] = useState('');
  const [transferLoading, setTransferLoading] = useState(isAdmin);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [packageFilter, setPackageFilter] = useState('all');
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
        'Failed to fetch subscriptions'
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
          'Membership transfer reviews are unavailable.'
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
      console.error(err);
      setSubscriptions([]);
      setSubscriptionError('An error occurred while fetching subscriptions');
      if (isAdmin) {
        setTransfers([]);
        setTransferError('Membership transfer reviews are unavailable.');
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
      : window.prompt('Rejection reason:')?.trim();
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
      setTransferError(response.data?.message || 'Unable to review transfer.');
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
      const matchesSearch = !searchLower || [
        sub.user?.username,
        sub.user?.email,
        ...(sub.user?.vehicles || []),
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
      <div className="relative mx-auto max-w-[1400px]">
        <header className="mb-6 flex flex-col justify-between gap-4 border-b border-white/10 pb-5 md:flex-row md:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-yellow-500/25 bg-yellow-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-yellow-300">
              <Crown size={12} /> VIP Subscriptions
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">VIP Memberships</h1>
            <p className="mt-2 text-sm font-medium text-slate-400">View and manage customer subscriptions and VIP parking slots.</p>
          </div>

          <button
            type="button"
            onClick={fetchSubscriptions}
            disabled={loading || transferLoading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm font-black text-white transition hover:border-yellow-300/30 hover:bg-yellow-300/10 hover:text-yellow-100 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-yellow-300/50"
          >
            <RefreshCw className={`h-4 w-4 ${loading || transferLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </header>

        <section className={`mb-5 grid overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] sm:grid-cols-2 ${isAdmin ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
          <SummaryItem
            icon={Crown}
            label="Total VIP"
            value={getOperationalValue(subscriptionState, summary.total.toLocaleString('vi-VN'))}
            support={subscriptionState.isAvailable ? 'Loaded memberships' : 'Data unavailable'}
          />
          <SummaryItem
            icon={ShieldCheck}
            label="Active"
            value={getOperationalValue(subscriptionState, summary.active.toLocaleString('vi-VN'))}
            support={subscriptionState.isAvailable ? 'Current active status' : 'Data unavailable'}
            tone="text-emerald-300"
          />
          <SummaryItem
            icon={Clock3}
            label="Expiring Soon"
            value={getOperationalValue(subscriptionState, summary.expiringSoon.toLocaleString('vi-VN'))}
            support={subscriptionState.isAvailable ? 'Within 30 days' : 'Data unavailable'}
            tone="text-amber-300"
          />
          {isAdmin && (
            <SummaryItem
              icon={TimerReset}
              label="Transfers"
              value={getOperationalValue(transferState, summary.pendingTransfers.toLocaleString('vi-VN'))}
              support={transferState.isAvailable ? 'Pending admin review' : 'Data unavailable'}
              tone="text-purple-300"
            />
          )}
        </section>

        <section className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search by customer name, email, or vehicle..."
              className="h-12 w-full rounded-xl border border-white/10 bg-black/70 pl-11 pr-11 text-sm font-semibold text-white outline-none transition placeholder:text-slate-600 focus:border-[#ffd555]/60 focus:ring-2 focus:ring-[#ffd555]/10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                aria-label="Clear membership search"
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
              { value: 'all', label: 'All Statuses' },
              ...statusOptions.map((status) => ({ value: status, label: titleCase(status) })),
            ]}
            icon={Filter}
            className="lg:w-52"
            ariaLabel="Filter subscriptions by status"
          />

          {packageOptions.length > 0 && (
            <AdminSelect
              value={packageFilter}
              onChange={setPackageFilter}
              options={[
                { value: 'all', label: 'All packages' },
                ...packageOptions.map((type) => ({ value: type, label: titleCase(type) })),
              ]}
              icon={Crown}
              className="lg:w-52"
              align="right"
              ariaLabel="Filter subscriptions by package"
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
              Retry
            </button>
          </div>
        )}

        {isAdmin && transferLoading && (
          <section className="mb-6 border-y border-white/10 py-5 text-sm font-semibold text-slate-400">
            Loading membership transfer reviews...
          </section>
        )}
        {isAdmin && !transferLoading && transferError && (
          <section className="mb-6 flex items-start gap-3 border-y border-red-500/25 py-4 text-sm text-red-300" role="alert">
            <AlertCircle size={17} className="mt-0.5 shrink-0" />
            <div>
              <h2 className="font-black text-red-200">Transfer reviews unavailable</h2>
              <p className="mt-1 font-medium text-red-300/75">{transferError}</p>
            </div>
          </section>
        )}
        {isAdmin && transferState.isAvailable && (
          <TransferReviewSection transfers={transfers} onReview={reviewTransfer} />
        )}

        <section>
          <div className="hidden px-5 pb-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 md:grid md:grid-cols-[minmax(220px,1.35fr)_minmax(145px,0.9fr)_minmax(150px,1fr)_minmax(130px,0.8fr)_minmax(150px,0.9fr)_110px]">
            <span>Customer</span>
            <span>Package</span>
            <span>VIP Slot</span>
            <span>Amount</span>
            <span>Period</span>
            <span>Status</span>
          </div>

          {loading ? (
            <LoadingRows />
          ) : subscriptionError ? (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-6 py-10 text-center" role="alert">
              <AlertCircle size={28} className="mx-auto text-red-400" />
              <h2 className="mt-3 text-lg font-black text-red-200">Subscription data unavailable</h2>
              <p className="mx-auto mt-2 max-w-md text-sm font-medium text-red-300/70">{subscriptionError}</p>
            </div>
          ) : filteredSubscriptions.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-10 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-yellow-400/20 bg-yellow-400/10 text-yellow-300">
                <Crown size={22} />
              </div>
              <h2 className="text-lg font-black text-white">No VIP memberships found</h2>
              <p className="mx-auto mt-2 max-w-md text-sm font-medium text-slate-400">
                {hasFilters ? 'Adjust the search or filters to see more memberships.' : 'No subscriptions are available from the current response.'}
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
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredSubscriptions.map((sub, index) => (
                <MembershipRow key={sub._id} sub={sub} index={index} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
