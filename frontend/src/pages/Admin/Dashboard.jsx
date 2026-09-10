import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, isValid } from 'date-fns';
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  DollarSign,
  Minus,
  ParkingCircle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Ticket,
  UserX,
  Users,
  Wrench,
} from 'lucide-react';
import { API_BASE, apiFetch } from '../../services/api';
import { getServices } from '../../services/extraServiceApi';

const EMPTY_STATS = {
  totalStaff: 0,
  activeUsers: 0,
  blockedUsers: 0,
  parkingLots: 0,
  pendingLots: 0,
  recentActions: [],
};

const EMPTY_SERVICE_COUNTS = { active: 0, inactive: 0, total: 0 };

const EMPTY_FINANCE_SUMMARY = {
  currentRecordedSources: 0,
  previousRecordedSources: 0,
  walletBookingCharges: 0,
  walletBookingRefunds: 0,
  walletNetBookingSpend: 0,
  packagePayments: 0,
  renewalValue: 0,
  violationRevenue: 0,
  membershipTransferFeeRevenue: 0,
  coverage: 'Unavailable',
  error: '',
};

const currencyFormatter = new Intl.NumberFormat('vi-VN');

const formatCurrency = (value = 0) => {
  const safeValue = Math.round(Number(value) || 0);
  return `${currencyFormatter.format(safeValue)} VND`;
};

const formatSignedCurrency = (value = 0) => {
  const safeValue = Math.round(Number(value) || 0);
  if (safeValue > 0) return `+${formatCurrency(safeValue)}`;
  if (safeValue < 0) return `-${formatCurrency(Math.abs(safeValue))}`;
  return formatCurrency(0);
};

const getServiceStatus = (service) => (service?.isActive ? 'active' : 'inactive');

const getServiceStatusLabel = (service) => (service?.isActive ? 'Active' : 'Inactive');

const statusStyle = {
  active: 'bg-green-500/10 text-green-300 border-green-500/20',
  inactive: 'bg-red-500/10 text-red-300 border-red-500/20',
};

const statusColor = {
  active: '#22c55e',
  inactive: '#ef4444',
};

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = () => setReduced(media.matches);
    handleChange();
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  return reduced;
}

function useCountUp(value, { duration = 650, formatter = (next) => next.toLocaleString('vi-VN') } = {}) {
  const reducedMotion = usePrefersReducedMotion();
  const [displayValue, setDisplayValue] = useState(() => formatter(Number(value) || 0));

  useEffect(() => {
    const target = Number(value) || 0;
    if (reducedMotion) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplayValue(formatter(target));
      return undefined;
    }

    let frameId;
    let startTime;

    const tick = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(formatter(target * eased));

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      } else {
        setDisplayValue(formatter(target));
      }
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [duration, formatter, reducedMotion, value]);

  return displayValue;
}

function getRevenueTrend(stats) {
  const current = Number(stats.currentRecordedSources) || 0;
  const previous = Number(stats.previousRecordedSources) || 0;
  const difference = current - previous;

  if (current === 0 && previous > 0) {
    return {
      tone: 'critical',
      label: 'Down 100% from last month',
      percentLabel: 'Down 100%',
      difference,
    };
  }

  if (current > 0 && previous === 0) {
    return {
      tone: 'success',
      label: 'Revenue recorded after no revenue last month',
      percentLabel: 'New revenue',
      difference,
    };
  }

  if (current === 0 && previous === 0) {
    return {
      tone: 'neutral',
      label: 'No revenue recorded in either month',
      percentLabel: 'No baseline',
      difference,
    };
  }

  const percent = ((current - previous) / previous) * 100;
  const roundedPercent = Math.round(percent * 10) / 10;

  return {
    tone: percent > 0 ? 'success' : percent < 0 ? 'critical' : 'neutral',
    label:
      percent > 0
        ? `Up ${currencyFormatter.format(Math.abs(roundedPercent))}% from last month`
        : percent < 0
          ? `Down ${currencyFormatter.format(Math.abs(roundedPercent))}% from last month`
          : 'Same as last month',
    percentLabel:
      percent > 0
        ? `Up ${currencyFormatter.format(Math.abs(roundedPercent))}%`
        : percent < 0
          ? `Down ${currencyFormatter.format(Math.abs(roundedPercent))}%`
          : 'Flat',
    difference,
  };
}

const startOfMonth = (date) =>
  new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);

const endOfPreviousMonth = (date) =>
  new Date(date.getFullYear(), date.getMonth(), 0, 23, 59, 59, 999);

const buildDateQuery = ({ startDate, endDate }) =>
  new URLSearchParams({
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  }).toString();

const fetchStatisticsBundle = async (period) => {
  const query = buildDateQuery(period);
  const [booking, subscriptions, violations, platformRevenue] = await Promise.all([
    apiFetch(`/statistics/admin/bookings?${query}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
    }),
    apiFetch(`/statistics/admin/subscriptions?${query}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
    }),
    apiFetch(`/revenue/violations/statistics?${query}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
    }),
    apiFetch(`/statistics/admin/platform-revenue?${query}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
    }),
  ]);

  return {
    booking: booking.ok && booking.data?.success ? booking.data.data : null,
    subscriptions: subscriptions.ok && subscriptions.data?.success ? subscriptions.data.data : null,
    violations: violations.ok && violations.data?.success ? violations.data.data : null,
    platformRevenue:
      platformRevenue.ok && platformRevenue.data?.success
        ? platformRevenue.data.data
        : null,
    failed: !booking.ok && !subscriptions.ok && !violations.ok && !platformRevenue.ok,
  };
};

const getRecordedSourcesValue = ({ booking, subscriptions, violations, platformRevenue }) => {
  const bookingMoney = booking?.money || {};
  const subscriptionSummary = subscriptions?.summary || {};
  const violationSummary = violations?.summary || {};
  const transferFeeSummary = platformRevenue?.membershipTransferFees || {};
  return (
    Number(bookingMoney.walletBookingCharges || 0) +
    Number(subscriptionSummary.grossAmount || 0) +
    Number(subscriptionSummary.renewalAmount || 0) +
    Number(violationSummary.totalAmount || 0) +
    Number(transferFeeSummary.revenue || 0)
  );
};

const buildFinanceSummary = (currentBundle, previousBundle) => {
  const bookingMoney = currentBundle.booking?.money || {};
  const subscriptionSummary = currentBundle.subscriptions?.summary || {};
  const violationSummary = currentBundle.violations?.summary || {};
  const transferFeeSummary = currentBundle.platformRevenue?.membershipTransferFees || {};

  return {
    currentRecordedSources: getRecordedSourcesValue(currentBundle),
    previousRecordedSources: getRecordedSourcesValue(previousBundle),
    walletBookingCharges: Number(bookingMoney.walletBookingCharges || 0),
    walletBookingRefunds: Number(bookingMoney.walletBookingRefunds || 0),
    walletNetBookingSpend: Number(bookingMoney.walletNetBookingSpend || 0),
    packagePayments: Number(subscriptionSummary.grossAmount || 0),
    renewalValue: Number(subscriptionSummary.renewalAmount || 0),
    violationRevenue: Number(violationSummary.totalAmount || 0),
    membershipTransferFeeRevenue: Number(transferFeeSummary.revenue || 0),
    coverage: bookingMoney.financialCoverage || 'Unavailable',
    error: currentBundle.failed ? 'Revenue sources could not be loaded.' : '',
  };
};

function getServiceCounts(services = []) {
  return services.reduce((acc, item) => {
    const key = getServiceStatus(item);
    acc[key] = (acc[key] || 0) + 1;
    acc.total += 1;
    return acc;
  }, { ...EMPTY_SERVICE_COUNTS });
}

function DashboardShell({ children }) {
  return (
    <div className="relative min-h-[calc(100vh-70px)] overflow-hidden bg-[#080808] px-4 py-5 text-white sm:px-6 lg:px-8">
      <style>{`
        @keyframes valo-dashboard-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes valo-donut-draw {
          from { stroke-dashoffset: var(--dash); }
          to { stroke-dashoffset: var(--offset); }
        }
        @media (prefers-reduced-motion: reduce) {
          .valo-enter, .valo-donut-segment {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}</style>
      <div className="pointer-events-none absolute right-[-18%] top-20 h-[460px] w-[460px] rounded-full bg-yellow-500/5 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:46px_46px]" />
      <div className="relative mx-auto flex w-full max-w-[1680px] flex-col gap-5">
        {children}
      </div>
    </div>
  );
}

function DashboardHeader({ loading, refreshing, onRefresh }) {
  return (
    <div className="valo-enter flex flex-col gap-4 motion-safe:animate-[valo-dashboard-in_420ms_ease-out_both] sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-yellow-500/25 bg-yellow-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-yellow-300">
          <Settings2 size={12} />
          Dashboard
        </div>
        <h1 className="mt-3 text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
          Admin Overview
        </h1>
        <p className="mt-1 text-sm font-medium text-blue-100/70">
          Manage the entire VALO Smart Parking system
        </p>
      </div>

      <button
        type="button"
        onClick={onRefresh}
        disabled={loading || refreshing}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-bold text-blue-100/75 transition hover:border-yellow-400/30 hover:bg-yellow-400/5 hover:text-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-400/50 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
      >
        <RefreshCw size={14} className={loading || refreshing ? 'animate-spin motion-reduce:animate-none' : ''} />
        Refresh
      </button>
    </div>
  );
}

function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-black tracking-tight text-white">{title}</h2>
        {subtitle && <p className="mt-1 text-sm font-medium text-blue-200/60">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function DashboardSection({ children, className = '', delay = 0 }) {
  return (
    <section
      className={`valo-enter border-t border-white/10 pt-5 motion-safe:animate-[valo-dashboard-in_520ms_ease-out_both] ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </section>
  );
}

function DashboardKpiItem({ icon, label, value, sub, tone = 'yellow', loading, delay = 0, formatter }) {
  const toneClass = {
    yellow: 'bg-yellow-500/10 text-yellow-300',
    blue: 'bg-blue-500/10 text-blue-300',
    purple: 'bg-purple-500/10 text-purple-300',
    green: 'bg-green-500/10 text-green-300',
  }[tone];
  const displayValue = useCountUp(value, { formatter });

  return (
    <div
      className="valo-enter group min-w-0 px-0 py-4 transition hover:bg-white/[0.018] motion-safe:animate-[valo-dashboard-in_480ms_ease-out_both] motion-reduce:transition-none sm:px-5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition group-hover:brightness-125 motion-reduce:transition-none ${toneClass}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-blue-200/55">{label}</p>
          {loading ? (
            <div className="mt-3 h-8 w-20 animate-pulse rounded bg-white/10" />
          ) : (
            <p className="mt-2 truncate font-mono text-3xl font-black leading-none text-white" title={String(displayValue)}>
              {displayValue}
            </p>
          )}
          <p className="mt-2 truncate text-sm font-semibold text-emerald-300" title={sub}>
            {sub}
          </p>
        </div>
      </div>
    </div>
  );
}

function DashboardKpiStrip({ metrics, loading }) {
  return (
    <section className="border-y border-white/10">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric, index) => {
          const dividerClass = [
            index > 0 ? 'border-t border-white/10' : '',
            index % 2 === 1 ? 'sm:border-l sm:border-white/10' : '',
            index > 1 ? 'sm:border-t sm:border-white/10' : 'sm:border-t-0',
            index > 0 ? 'xl:border-l xl:border-white/10' : '',
            'xl:border-t-0',
          ].join(' ');

          return (
            <div key={metric.label} className={dividerClass}>
              <DashboardKpiItem {...metric} loading={loading} delay={120 + index * 70} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DashboardHighlightItem({ icon, title, detail, tone = 'neutral' }) {
  const toneClass = {
    success: 'text-green-300 bg-green-500/10',
    warning: 'text-yellow-300 bg-yellow-500/10',
    critical: 'text-red-300 bg-red-500/10',
    neutral: 'text-blue-200 bg-blue-500/10',
  }[tone];

  return (
    <div className="min-w-0 px-0 py-3 sm:px-4">
      <div className="flex items-start gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-white" title={title}>{title}</p>
          {detail && <p className="mt-0.5 truncate text-xs font-medium text-blue-200/60" title={detail}>{detail}</p>}
        </div>
      </div>
    </div>
  );
}

function DashboardHighlights({ stats, finance, financeLoading, serviceCounts, servicesLoading, servicesError }) {
  const revenueTrend = getRevenueTrend(finance);
  const usersOk = (Number(stats.blockedUsers) || 0) === 0;
  const lots = Number(stats.parkingLots) || 0;
  const pendingLots = Number(stats.pendingLots) || 0;
  const inactiveServices = Number(serviceCounts.inactive) || 0;
  const serviceTitle = servicesLoading
    ? 'Loading services'
    : servicesError
      ? 'Service health unavailable'
      : inactiveServices > 0
        ? `${inactiveServices} inactive service${inactiveServices === 1 ? '' : 's'}`
        : 'Services active';
  const serviceDetail = servicesLoading
    ? 'Fetching configured booking services'
    : servicesError
      ? servicesError
      : `${serviceCounts.active} active of ${serviceCounts.total} configured services`;
  const revenueTitle = financeLoading
    ? 'Loading revenue sources'
    : finance.error
      ? 'Revenue unavailable'
      : revenueTrend.percentLabel;
  const revenueDetail = financeLoading
    ? 'Fetching analytics source data'
    : finance.error
      ? finance.error
      : revenueTrend.label;

  const highlights = [
    {
      icon: revenueTrend.tone === 'critical' ? <ArrowDownRight size={15} /> : revenueTrend.tone === 'success' ? <ArrowUpRight size={15} /> : <Minus size={15} />,
      title: revenueTitle,
      detail: revenueDetail,
      tone: finance.error ? 'warning' : revenueTrend.tone,
    },
    {
      icon: usersOk ? <CheckCircle2 size={15} /> : <UserX size={15} />,
      title: usersOk ? 'All users active' : `${stats.blockedUsers} blocked users`,
      detail: `${stats.activeUsers.toLocaleString('vi-VN')} active customer accounts`,
      tone: usersOk ? 'success' : 'warning',
    },
    {
      icon: <Wrench size={15} />,
      title: serviceTitle,
      detail: serviceDetail,
      tone: servicesError || inactiveServices > 0 ? 'warning' : 'success',
    },
    {
      icon: <ParkingCircle size={15} />,
      title: pendingLots > 0 ? `${pendingLots} lots pending` : `${lots} lot${lots === 1 ? '' : 's'} operational`,
      detail: `${serviceCounts.total} configured services tracked`,
      tone: pendingLots > 0 ? 'warning' : 'success',
    },
  ];

  return (
    <section className="valo-enter border-y border-white/10 motion-safe:animate-[valo-dashboard-in_520ms_ease-out_220ms_both]">
      <div className="mb-2 pt-4">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-yellow-300">Dashboard Highlights</p>
      </div>
      <div className="grid grid-cols-1 divide-y divide-white/10 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        {highlights.map((highlight) => (
          <DashboardHighlightItem key={highlight.title} {...highlight} />
        ))}
      </div>
    </section>
  );
}

function RevenueSummary({ finance, loading }) {
  const current = Number(finance.currentRecordedSources) || 0;
  const previous = Number(finance.previousRecordedSources) || 0;
  const trend = getRevenueTrend(finance);
  const toneClass = {
    success: 'text-green-300',
    critical: 'text-red-300',
    neutral: 'text-blue-200/70',
  }[trend.tone];
  const currentDisplay = useCountUp(current, { formatter: formatCurrency });

  return (
    <DashboardSection delay={300}>
      <SectionHeader title="Revenue Summary" subtitle="Recorded financial sources from analytics APIs" />
      {loading ? (
        <div className="space-y-4">
          <div className="h-10 w-48 animate-pulse rounded bg-white/10" />
          <div className="h-24 animate-pulse rounded bg-white/5" />
        </div>
      ) : finance.error ? (
        <div className="border-y border-dashed border-red-400/20 py-6 text-sm font-semibold text-red-200">
          {finance.error}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[minmax(0,1.35fr)_minmax(240px,0.65fr)]">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-blue-200/55">Recorded sales sources</p>
            <p className="mt-2 font-mono text-4xl font-black leading-none text-white sm:text-5xl">{currentDisplay}</p>
            <p className={`mt-4 flex items-center gap-2 text-sm font-bold ${toneClass}`}>
              {trend.tone === 'success' ? <ArrowUpRight size={16} /> : trend.tone === 'critical' ? <ArrowDownRight size={16} /> : <Minus size={16} />}
              {trend.label}
            </p>
            <p className="mt-3 max-w-lg text-xs font-medium leading-relaxed text-blue-200/45">
              Sources are displayed together for dashboard scanning only, not as a verified accounting revenue total.
            </p>
          </div>
          <dl className="space-y-3 border-t border-white/10 pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm font-semibold text-blue-200/60">Previous recorded sources</dt>
              <dd className="font-mono text-sm font-black text-white">{formatCurrency(previous)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm font-semibold text-blue-200/60">Difference</dt>
              <dd className={`font-mono text-sm font-black ${trend.difference < 0 ? 'text-red-300' : trend.difference > 0 ? 'text-green-300' : 'text-blue-100/80'}`}>
                {formatSignedCurrency(trend.difference)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm font-semibold text-blue-200/60">Coverage</dt>
              <dd className="text-right text-sm font-black capitalize text-yellow-200">{finance.coverage}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm font-semibold text-blue-200/60">Wallet booking</dt>
              <dd className="font-mono text-sm font-black text-white">{formatCurrency(finance.walletBookingCharges)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm font-semibold text-blue-200/60">Package payments</dt>
              <dd className="font-mono text-sm font-black text-white">{formatCurrency(finance.packagePayments)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm font-semibold text-blue-200/60">Renewal value</dt>
              <dd className="font-mono text-sm font-black text-white">{formatCurrency(finance.renewalValue)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm font-semibold text-blue-200/60">Violation revenue</dt>
              <dd className="font-mono text-sm font-black text-white">{formatCurrency(finance.violationRevenue)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm font-semibold text-blue-200/60">Membership transfer fees</dt>
              <dd className="font-mono text-sm font-black text-white">{formatCurrency(finance.membershipTransferFeeRevenue)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm font-semibold text-blue-200/60">Trend</dt>
              <dd className={`text-right text-sm font-black ${toneClass}`}>{trend.percentLabel}</dd>
            </div>
          </dl>
        </div>
      )}
    </DashboardSection>
  );
}

function ServiceHealthDonut({ counts }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const segments = [
    { key: 'active', value: counts.active, color: statusColor.active },
    { key: 'inactive', value: counts.inactive, color: statusColor.inactive },
  ].filter((segment) => segment.value > 0);
  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 120 120" className="-rotate-90">
          <circle cx="60" cy="60" r={radius} fill="transparent" stroke="rgba(255,255,255,0.08)" strokeWidth="12" />
          {segments.map((segment) => {
            const dash = (segment.value / counts.total) * circumference;
            const currentOffset = offset;
            offset += dash;
            return (
              <circle
                key={segment.key}
                className="valo-donut-segment"
                cx="60"
                cy="60"
                r={radius}
                fill="transparent"
                stroke={segment.color}
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-currentOffset}
                style={{
                  '--dash': dash,
                  '--offset': -currentOffset,
                  animation: 'valo-donut-draw 780ms ease-out both',
                }}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="font-mono text-2xl font-black text-white">{counts.total}</p>
          <p className="text-[11px] font-bold uppercase tracking-wide text-blue-200/55">Services</p>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {[
          ['Active', counts.active, 'active'],
          ['Inactive', counts.inactive, 'inactive'],
        ].map(([label, count, key]) => {
          const percent = counts.total > 0 ? Math.round((count / counts.total) * 100) : 0;
          return (
            <div key={key} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusColor[key] }} />
                <span className="font-semibold text-blue-100/75">{label}</span>
              </div>
              <span className="font-mono font-black text-white">{count} / {percent}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ServiceHealth({ counts, services = [], loading, error }) {
  return (
    <DashboardSection delay={360}>
      <SectionHeader title="Service Health" subtitle="Configured booking services" />
      {loading ? (
        <div className="space-y-4">
          <div className="h-32 w-32 animate-pulse rounded-full bg-white/10" />
          <div className="space-y-2">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-10 animate-pulse rounded bg-white/5" />
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="border-y border-dashed border-red-400/20 py-6 text-sm font-semibold text-red-200">
          {error}
        </div>
      ) : services.length > 0 ? (
        <>
          <ServiceHealthDonut counts={counts} />
          <div className="mt-5">
            {services.map((service) => {
              const key = getServiceStatus(service);
              const label = getServiceStatusLabel(service);
              return (
                <div key={service._id || service.name} className="flex items-center justify-between gap-3 border-b border-white/5 py-3 transition hover:bg-white/[0.025] last:border-0 motion-reduce:transition-none">
                  <div className="flex min-w-0 items-center gap-3">
                    <Wrench size={14} className="shrink-0 text-slate-500" />
                    <span className="truncate text-sm font-bold text-slate-200">{service.name}</span>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black ${statusStyle[key]}`}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="border-y border-dashed border-white/10 py-6 text-center text-sm font-medium text-slate-500">
          No services configured
        </div>
      )}
    </DashboardSection>
  );
}

function RecentAdminActivity({ actions = [], loading }) {
  const visibleActions = actions.slice(0, 5);

  return (
    <DashboardSection delay={430}>
      <SectionHeader title="Recent Admin Activity" subtitle="Latest recorded admin activity" />
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className="h-12 animate-pulse rounded bg-white/5" />
          ))}
        </div>
      ) : visibleActions.length > 0 ? (
        <div>
          {visibleActions.map((action, index) => {
            const actionDate = new Date(action.createdAt);
            const time = isValid(actionDate)
              ? formatDistanceToNow(actionDate, { addSuffix: true })
              : 'Recently';
            const isLast = index === visibleActions.length - 1;

            return (
              <div key={action._id || index} className="group grid grid-cols-[28px_minmax(0,1fr)] gap-3 py-3 transition hover:bg-white/[0.025] motion-reduce:transition-none">
                <div className="relative flex justify-center">
                  <span className="z-10 mt-1 flex h-4 w-4 items-center justify-center rounded-full border border-green-400/40 bg-[#080808]">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-300" />
                  </span>
                  {!isLast && <span className="absolute top-6 h-[calc(100%+10px)] w-px bg-white/10" />}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <p className="truncate text-sm font-black text-slate-100">{action.action}</p>
                    <span className="shrink-0 text-xs font-semibold text-blue-200/55">{time}</span>
                  </div>
                  <p className="mt-1 truncate text-sm font-medium text-blue-200/60">{action.target || 'System activity'}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="border-y border-dashed border-white/10 py-6 text-center text-sm font-medium text-slate-500">
          No recent actions
        </div>
      )}
    </DashboardSection>
  );
}

function QuickAction({ icon, label, desc, tone, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-12 w-full items-center gap-3 border-b border-white/5 py-3 text-left transition hover:bg-white/[0.025] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-yellow-400/60 last:border-0 motion-reduce:transition-none"
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition group-hover:scale-105 group-hover:brightness-125 motion-reduce:transition-none ${tone}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black text-white">{label}</span>
        <span className="mt-0.5 block text-xs font-medium text-blue-200/55">{desc}</span>
      </span>
      <ChevronRight size={15} className="shrink-0 text-slate-600 transition group-hover:translate-x-1 group-hover:text-yellow-300 motion-reduce:transition-none" />
    </button>
  );
}

function AdminQuickActions({ navigate }) {
  return (
    <DashboardSection delay={500}>
      <SectionHeader title="Quick Actions" subtitle="Common admin workflows" />
      <QuickAction
        icon={<Users size={16} className="text-yellow-300" />}
        label="Staff Accounts"
        desc="Manage parking staff"
        tone="bg-yellow-500/10"
        onClick={() => navigate('/admin/accounts')}
      />
      <QuickAction
        icon={<ParkingCircle size={16} className="text-purple-300" />}
        label="Parking Lots"
        desc="Manage facilities"
        tone="bg-purple-500/10"
        onClick={() => navigate('/admin/parking-lots')}
      />
      <QuickAction
        icon={<Ticket size={16} className="text-sky-300" />}
        label="Ticket Packages"
        desc="Manage ticket plans"
        tone="bg-sky-500/10"
        onClick={() => navigate('/admin/tickets')}
      />
      <QuickAction
        icon={<UserX size={16} className="text-red-300" />}
        label="User Access"
        desc="Review blocked accounts"
        tone="bg-red-500/10"
        onClick={() => navigate('/admin/accounts')}
      />
    </DashboardSection>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(EMPTY_STATS);
  const [finance, setFinance] = useState(EMPTY_FINANCE_SUMMARY);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [financeLoading, setFinanceLoading] = useState(true);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = useCallback(async ({ refresh = false } = {}) => {
    try {
      if (!refresh) {
        setLoading(true);
      }

      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_BASE}/admin/overview`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (data.success) {
        setStats({ ...EMPTY_STATS, ...data.data });
      }
    } catch (error) {
      console.error('Failed to fetch admin overview', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFinanceSummary = useCallback(async ({ refresh = false } = {}) => {
    try {
      if (!refresh) setFinanceLoading(true);

      const now = new Date();
      const currentPeriod = {
        startDate: startOfMonth(now),
        endDate: now,
      };
      const previousPeriod = {
        startDate: startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        endDate: endOfPreviousMonth(now),
      };
      const [currentBundle, previousBundle] = await Promise.all([
        fetchStatisticsBundle(currentPeriod),
        fetchStatisticsBundle(previousPeriod),
      ]);

      setFinance(buildFinanceSummary(currentBundle, previousBundle));
    } catch (error) {
      console.error('Failed to fetch dashboard revenue sources', error);
      setFinance({
        ...EMPTY_FINANCE_SUMMARY,
        error: error.message || 'Revenue sources could not be loaded.',
      });
    } finally {
      setFinanceLoading(false);
    }
  }, []);

  const fetchServices = useCallback(async ({ refresh = false } = {}) => {
    try {
      if (!refresh) setServicesLoading(true);
      setServicesError('');

      const res = await getServices(false);
      if (res.ok && res.data?.success) {
        setServices(Array.isArray(res.data.data) ? res.data.data : []);
      } else {
        setServices([]);
        setServicesError(res.data?.message || 'Failed to fetch service health');
      }
    } catch (error) {
      console.error('Failed to fetch services', error);
      setServices([]);
      setServicesError(error.message || 'Failed to fetch service health');
    } finally {
      setServicesLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStats();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchFinanceSummary();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchServices();
  }, [fetchFinanceSummary, fetchServices, fetchStats]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      fetchStats({ refresh: true }),
      fetchFinanceSummary({ refresh: true }),
      fetchServices({ refresh: true }),
    ]);
    setRefreshing(false);
  }, [fetchFinanceSummary, fetchServices, fetchStats]);

  const serviceCounts = useMemo(() => getServiceCounts(services), [services]);

  const metrics = useMemo(() => [
    {
      icon: <Users size={18} />,
      label: 'Total Staff',
      value: stats.totalStaff,
      formatter: (value) => Math.round(value).toLocaleString('vi-VN'),
      sub: 'Managed users',
      tone: 'yellow',
    },
    {
      icon: <ShieldCheck size={18} />,
      label: 'Active Users',
      value: stats.activeUsers,
      formatter: (value) => Math.round(value).toLocaleString('vi-VN'),
      sub: stats.blockedUsers > 0 ? `${stats.blockedUsers} blocked accounts` : 'All users are active',
      tone: 'blue',
    },
    {
      icon: <ParkingCircle size={18} />,
      label: 'Parking Lots',
      value: stats.parkingLots,
      formatter: (value) => Math.round(value).toLocaleString('vi-VN'),
      sub: stats.pendingLots > 0 ? `${stats.pendingLots} pending setup` : 'Fully operational',
      tone: 'purple',
    },
    {
      icon: <DollarSign size={18} />,
      label: 'Recorded Sources',
      value: finance.currentRecordedSources,
      formatter: formatCurrency,
      sub: finance.error ? 'Unavailable' : getRevenueTrend(finance).percentLabel,
      tone: 'green',
    },
  ], [finance, stats]);

  return (
    <DashboardShell>
      <DashboardHeader
        loading={loading || financeLoading || servicesLoading}
        refreshing={refreshing}
        onRefresh={handleRefresh}
      />
      <DashboardKpiStrip metrics={metrics} loading={loading || financeLoading} />
      <DashboardHighlights
        stats={stats}
        finance={finance}
        financeLoading={financeLoading}
        serviceCounts={serviceCounts}
        servicesLoading={servicesLoading}
        servicesError={servicesError}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(340px,5fr)] lg:items-start">
        <div className="flex flex-col gap-6">
          <RevenueSummary finance={finance} loading={financeLoading} />
          <RecentAdminActivity actions={stats.recentActions} loading={loading} />
        </div>

        <div className="flex flex-col gap-6">
          <ServiceHealth
            counts={serviceCounts}
            services={services}
            loading={servicesLoading}
            error={servicesError}
          />
          <AdminQuickActions navigate={navigate} />
        </div>
      </div>
    </DashboardShell>
  );
}
