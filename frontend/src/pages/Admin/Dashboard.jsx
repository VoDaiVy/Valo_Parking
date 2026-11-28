import AnimatedNumber from '../../components/AnimatedNumber';
import { useCountUp } from '../../components/numberAnimation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, isValid } from 'date-fns';
import { vi as viLocale } from 'date-fns/locale';
import {
  Wallet,
  RotateCw,
  ChartNoAxesCombined,
  Activity,
  AlertTriangle,
  Car,
  CheckCircle2,
  ChevronRight,
  DollarSign,
  ParkingCircle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Ticket,
  UserX,
  Users,
} from 'lucide-react';
import { API_BASE, apiFetch } from '../../services/api';
import { getAllSessions } from '../../services/sessionService.js';
import { sessionMetrics } from '../Staff/sessionMetrics.js';
import { useTranslation } from 'react-i18next';

const EMPTY_STATS = {
  totalStaff: 0,
  activeUsers: 0,
  blockedUsers: 0,
  parkingLots: 0,
  pendingLots: 0,
  recentActions: [],
};


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

function getRevenueTrend(stats, t = (key, options) => options?.defaultValue || key) {
  const current = Number(stats.currentRecordedSources) || 0;
  const previous = Number(stats.previousRecordedSources) || 0;
  const difference = current - previous;

  if (current === 0 && previous > 0) {
    return {
      tone: 'critical',
      label: t('adminDashboardExtra.trendDownFull', { defaultValue: 'Down 100% from last month' }),
      percentLabel: t('adminDashboardExtra.trendDownFullShort', { defaultValue: 'Down 100%' }),
      difference,
    };
  }

  if (current > 0 && previous === 0) {
    return {
      tone: 'success',
      label: t('adminDashboardExtra.trendNewRevenue', { defaultValue: 'Revenue recorded after no revenue last month' }),
      percentLabel: t('adminDashboardExtra.trendNewRevenueShort', { defaultValue: 'New revenue' }),
      difference,
    };
  }

  if (current === 0 && previous === 0) {
    return {
      tone: 'neutral',
      label: t('adminDashboardExtra.trendNoRevenue', { defaultValue: 'No revenue recorded in either month' }),
      percentLabel: t('adminDashboardExtra.trendNoBaseline', { defaultValue: 'No baseline' }),
      difference,
    };
  }

  const percent = ((current - previous) / previous) * 100;
  const roundedPercent = Math.round(percent * 10) / 10;

  return {
    tone: percent > 0 ? 'success' : percent < 0 ? 'critical' : 'neutral',
    label:
      percent > 0
        ? t('adminDashboardExtra.trendUp', { defaultValue: 'Up {{percent}}% from last month', percent: currencyFormatter.format(Math.abs(roundedPercent)) })
        : percent < 0
          ? t('adminDashboardExtra.trendDown', { defaultValue: 'Down {{percent}}% from last month', percent: currencyFormatter.format(Math.abs(roundedPercent)) })
          : t('adminDashboardExtra.trendSame', { defaultValue: 'Same as last month' }),
    percentLabel:
      percent > 0
        ? t('adminDashboardExtra.trendUpShort', { defaultValue: 'Up {{percent}}%', percent: currencyFormatter.format(Math.abs(roundedPercent)) })
        : percent < 0
          ? t('adminDashboardExtra.trendDownShort', { defaultValue: 'Down {{percent}}%', percent: currencyFormatter.format(Math.abs(roundedPercent)) })
          : t('adminDashboardExtra.trendFlat', { defaultValue: 'Flat' }),
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
    sourceAvailability: {
      current: Boolean(currentBundle.booking && currentBundle.subscriptions && currentBundle.violations && currentBundle.platformRevenue),
      previous: Boolean(previousBundle.booking && previousBundle.subscriptions && previousBundle.violations && previousBundle.platformRevenue),
      wallet: Boolean(currentBundle.booking?.money),
      packages: Boolean(currentBundle.subscriptions?.summary),
    },
    error: currentBundle.failed ? 'Revenue sources could not be loaded.' : '',
  };
};

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
  const { t } = useTranslation();
  return (
    <div style={{ '--admin-type-page': '28px' }} className="valo-enter flex flex-col gap-3 motion-safe:animate-[valo-dashboard-in_420ms_ease-out_both] sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-white">
            {t('adminDashboard.title')}
          </h1>
          <div className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-yellow-500/25 bg-yellow-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-yellow-300">
            <Settings2 size={12} />
            {t('adminDashboard.badge')}
          </div>
        </div>
        <p className="mt-1 text-sm font-medium text-blue-100/70">
          {t('adminDashboard.subtitle')}
        </p>
      </div>

      <button
        type="button"
        onClick={onRefresh}
        disabled={loading || refreshing}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-bold text-blue-100/75 transition hover:border-yellow-400/30 hover:bg-yellow-400/5 hover:text-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-400/50 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
      >
        <RefreshCw size={14} className={loading || refreshing ? 'animate-spin motion-reduce:animate-none' : ''} />
        {t('adminDashboard.refresh')}
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
      className="valo-enter group min-w-0 px-0 py-3 transition hover:bg-white/[0.018] motion-safe:animate-[valo-dashboard-in_480ms_ease-out_both] motion-reduce:transition-none sm:px-4"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start gap-2.5">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition group-hover:brightness-125 motion-reduce:transition-none ${toneClass}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-blue-200/55">{label}</p>
          {loading ? (
            <div className="mt-1 h-6 w-20 animate-pulse rounded bg-white/10" />
          ) : (
            <p className="admin-type-kpi-compact mt-1 truncate font-mono text-2xl font-black leading-none text-white" title={String(displayValue)}>
              {displayValue}
            </p>
          )}
          <p className="mt-1 truncate text-xs font-semibold text-emerald-300" title={sub}>
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

function RevenueSummary({ finance, loading }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentDisplay = useCountUp(finance.currentRecordedSources, { formatter: formatCurrency });
  const availability = finance.sourceAvailability || {};
  const partial = String(finance.coverage).toLowerCase() === 'partial' || !availability.current;
  const sources = [
    { label: t('adminDashboardExtra.walletBooking'), value: finance.walletBookingCharges, available: availability.wallet, Icon: Wallet },
    { label: t('adminDashboardExtra.packagePayments'), value: finance.packagePayments, available: availability.packages, Icon: Ticket },
    { label: t('adminDashboardExtra.renewals'), value: finance.renewalValue, available: availability.packages, Icon: RotateCw },
  ];

  return (
    <section aria-label="Revenue Summary" className="min-w-0 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
      <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-white"><ChartNoAxesCombined size={19} className="shrink-0 text-[#e8d5ad]" aria-hidden="true" />{t('adminDashboard.revenueSummary')}</h2>
        </div>
        <button type="button" onClick={() => navigate('/admin/revenue')} className="inline-flex items-center gap-1 py-1 text-xs font-semibold text-[#e8d5ad] transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e8d5ad]/60">
          {t('adminDashboardExtra.viewRevenue')} <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
      {loading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading revenue summary">
          <div className="h-10 w-48 max-w-full animate-pulse rounded bg-white/10" />
          <div className="h-20 animate-pulse rounded bg-white/5" />
        </div>
      ) : finance.error ? (
        <div role="alert" className="py-4 text-sm font-semibold text-red-200">
          {finance.error}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-200/55">{t('adminDashboardExtra.revenue')}</p>
                {partial && <span title={t('adminDashboardExtra.partialDataHint')} className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">{t('adminDashboardExtra.partialData')}</span>}
              </div>
              <p className="mt-2 break-words text-3xl font-black leading-tight tracking-tight text-[#e8d5ad] [overflow-wrap:anywhere]">{currentDisplay}</p>
            </div>
            <dl className="min-w-0 sm:pl-4">
              <div>
                <dt className="text-xs font-semibold text-blue-200/55">{t('adminDashboardExtra.previousPeriod')}</dt>
                <dd className="mt-1 break-words text-sm font-bold text-white [overflow-wrap:anywhere]">{availability.previous ? formatCurrency(finance.previousRecordedSources) : 'N/A'}</dd>
              </div>
            </dl>
          </div>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {sources.map(({ label, value, available, Icon }) => (
              <div key={label} className="min-w-0">
                <dt className="flex items-center gap-2 text-xs font-medium text-blue-200/55"><Icon size={14} className="shrink-0 text-[#e8d5ad]/65" aria-hidden="true" />{label}</dt>
                <dd className="mt-1 break-words text-sm font-bold text-white [overflow-wrap:anywhere]">{available ? formatCurrency(value) : 'N/A'}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}

function RecentAdminActivity({ actions = [], loading }) {
  const { t, i18n } = useTranslation();
  const visibleActions = actions.slice(0, 5);

  return (
    <DashboardSection delay={430}>
      <SectionHeader title={t('adminDashboard.recentActivity')} subtitle={t('adminDashboard.recentActivitySubtitle')} />
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className="h-12 animate-pulse rounded bg-white/5" />
          ))}
        </div>
      ) : visibleActions.length > 0 ? (
        <div>
          {visibleActions.map((action, index) => {
            const actionLabels = {
              'Updated User Privileges/Details': t('adminDashboardExtra.activityUpdatedUser', { defaultValue: 'Updated user privileges/details' }),
              'Blocked User Account': t('adminDashboardExtra.activityBlockedUser', { defaultValue: 'Blocked user account' }),
              'Created Ticket Package': t('adminDashboardExtra.activityCreatedPackage', { defaultValue: 'Created ticket package' }),
            };
            const actionDate = new Date(action.createdAt);
            const time = isValid(actionDate)
              ? formatDistanceToNow(actionDate, { addSuffix: true, locale: i18n.resolvedLanguage === 'vi' ? viLocale : undefined })
              : t('adminDashboard.recently');
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
                    <p className="truncate text-sm font-black text-slate-100">{actionLabels[action.action] || action.action}</p>
                    <span className="shrink-0 text-xs font-semibold text-blue-200/55">{time}</span>
                  </div>
                  <p className="mt-1 truncate text-sm font-medium text-blue-200/60">{action.target || t('adminDashboard.systemActivity')}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="border-y border-dashed border-white/10 py-6 text-center text-sm font-medium text-slate-500">
          {t('adminDashboard.noRecentActions')}
        </div>
      )}
    </DashboardSection>
  );
}

function ParkingOperation({ operation, loading }) {
  const { t } = useTranslation();
  const metrics = [
    { label: t('adminDashboardExtra.currentlyParked'), value: operation.metrics?.parked, Icon: Car, tone: 'text-cyan-300', note: t('adminDashboardExtra.activeSessions') },
    { label: t('adminDashboardExtra.completedToday'), value: operation.metrics?.completedToday, Icon: CheckCircle2, tone: 'text-emerald-300', note: t('adminDashboardExtra.completedCheckouts') },
    { label: t('adminDashboardExtra.needsAttention'), value: operation.metrics?.needsAttention, Icon: AlertTriangle, tone: 'text-amber-300', note: t('adminDashboardExtra.attentionSessions') },
  ];
  return (
    <section aria-label="Parking Operation" className="min-w-0 flex flex-col gap-5">
      <div className="min-h-12">
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-white"><Activity size={19} className="shrink-0 text-[#e8d5ad]" aria-hidden="true" />{t('adminDashboardExtra.parkingOperation')}</h2>
        <p className="mt-1 text-xs text-blue-200/55">{t('adminDashboardExtra.liveSessions')}</p>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-white/10 py-1" aria-busy={loading}>
        {metrics.map(({ label, value, Icon, tone, note }, index) => (
          <div key={label} className={`min-w-0 ${index === 0 ? 'pr-2' : 'px-2 sm:px-3'}`} title={note}>
            <Icon size={21} className={tone} aria-hidden="true" />
            <dt className="mt-4 min-h-10 text-xs font-semibold leading-5 text-blue-200/60">{label}</dt>
            <dd className={`mt-2 break-words font-bold tracking-tight ${tone} ${value == null && !loading && !operation.error ? 'text-xs' : 'text-4xl'}`}>
              {loading ? <span className="block h-9 w-12 animate-pulse rounded bg-white/10" aria-label={t('common.loading')} /> : operation.error ? '\u2014' : value == null ? t('adminDashboard.unavailable') : <AnimatedNumber value={value.toLocaleString('vi-VN')} />}
            </dd>
          </div>
        ))}
      </dl>
      <div className="text-xs leading-relaxed text-blue-200/50" aria-live="polite">
        {loading ? t('adminDashboardExtra.fetchingSessions') : operation.error ? <p role="alert" className="text-red-300">{operation.error} {t('adminDashboardExtra.refreshToRetry')}</p>
          : operation.metrics?.total === 0 ? t('adminDashboardExtra.noSessions')
            : operation.metrics?.needsAttention == null ? t('adminDashboardExtra.attentionUnavailable')
              : null}
      </div>
    </section>
  );
}

function QuickAction({ icon, label, desc, tone, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-12 w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-white/[0.025] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-yellow-400/60 motion-reduce:transition-none"
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
  const { t } = useTranslation();
  return (
    <DashboardSection delay={500}>
      <SectionHeader title={t('adminDashboard.quickActions')} subtitle={t('adminDashboard.quickActionsSubtitle')} />
      <div className="grid grid-cols-1 divide-y divide-white/10">
        <QuickAction
          icon={<Users size={16} className="text-yellow-300" />}
          label={t('adminDashboard.staffAccounts')}
          desc={t('adminDashboard.manageParkingStaff')}
          tone="bg-yellow-500/10"
          onClick={() => navigate('/admin/accounts')}
        />
        <QuickAction
          icon={<ParkingCircle size={16} className="text-purple-300" />}
          label={t('nav.parkingLots')}
          desc={t('adminDashboard.manageFacilities')}
          tone="bg-purple-500/10"
          onClick={() => navigate('/admin/parking-lots')}
        />
        <QuickAction
          icon={<Ticket size={16} className="text-sky-300" />}
          label={t('nav.ticketPackages')}
          desc={t('adminDashboard.ticketPlans')}
          tone="bg-sky-500/10"
          onClick={() => navigate('/admin/tickets')}
        />
        <QuickAction
          icon={<UserX size={16} className="text-red-300" />}
          label={t('adminDashboard.userAccess')}
          desc={t('adminDashboard.reviewBlocked')}
          tone="bg-red-500/10"
          onClick={() => navigate('/admin/accounts')}
        />
      </div>
    </DashboardSection>
  );
}

export default function AdminDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [stats, setStats] = useState(EMPTY_STATS);
  const [finance, setFinance] = useState(EMPTY_FINANCE_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [financeLoading, setFinanceLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [operation, setOperation] = useState({ metrics: null, error: '' });
  const [operationLoading, setOperationLoading] = useState(true);
  const fetchOperation = useCallback(async () => {
    setOperationLoading(true);
    try {
      const response = await getAllSessions({ cache: 'no-store' });
      if (!response.ok || !response.data?.success || !Array.isArray(response.data.data)) {
        throw new Error(t('adminDashboardExtra.parkingLoadError', { defaultValue: 'Parking sessions could not be loaded.' }));
      }
      setOperation({ metrics: sessionMetrics(response.data.data), error: '' });
    } catch {
      setOperation({ metrics: null, error: t('adminDashboardExtra.parkingLoadError', { defaultValue: 'Parking sessions could not be loaded.' }) });
    } finally {
      setOperationLoading(false);
    }
  }, [t]);

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

  useEffect(() => {
    // These callbacks start the initial asynchronous dashboard synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStats();
    fetchFinanceSummary();
    fetchOperation();
  }, [fetchFinanceSummary, fetchStats, fetchOperation]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      fetchStats({ refresh: true }),
      fetchFinanceSummary({ refresh: true }),
      fetchOperation(),
    ]);
    setRefreshing(false);
  }, [fetchFinanceSummary, fetchStats, fetchOperation]);


  const metrics = useMemo(() => [
    {
      icon: <Users size={18} />,
      label: t('adminDashboard.totalStaff'),
      value: stats.totalStaff,
      formatter: (value) => Math.round(value).toLocaleString('vi-VN'),
      sub: t('adminDashboard.managedUsers'),
      tone: 'yellow',
    },
    {
      icon: <ShieldCheck size={18} />,
      label: t('adminDashboard.activeUsers'),
      value: stats.activeUsers,
      formatter: (value) => Math.round(value).toLocaleString('vi-VN'),
      sub: stats.blockedUsers > 0 ? t('adminDashboard.blockedUsers', { count: stats.blockedUsers }) : t('adminDashboard.allUsersActive'),
      tone: 'blue',
    },
    {
      icon: <ParkingCircle size={18} />,
      label: t('adminDashboard.parkingLots'),
      value: stats.parkingLots,
      formatter: (value) => Math.round(value).toLocaleString('vi-VN'),
      sub: stats.pendingLots > 0 ? t('adminDashboard.lotsPending', { count: stats.pendingLots }) : t('adminDashboard.fullyOperational'),
      tone: 'purple',
    },
    {
      icon: <DollarSign size={18} />,
      label: t('adminDashboard.recordedSources'),
      value: finance.currentRecordedSources,
      formatter: formatCurrency,
      sub: finance.error ? t('adminDashboard.unavailable') : getRevenueTrend(finance, t).percentLabel,
      tone: 'green',
    },
  ], [finance, stats, t]);

  return (
    <DashboardShell>
      <DashboardHeader
        loading={loading || financeLoading || operationLoading}
        refreshing={refreshing}
        onRefresh={handleRefresh}
      />
      <DashboardKpiStrip metrics={metrics} loading={loading || financeLoading} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-stretch">
        <RevenueSummary finance={finance} loading={financeLoading} />
        <ParkingOperation operation={operation} loading={operationLoading} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(340px,5fr)]">
        <div className="min-w-0">
          <RecentAdminActivity actions={stats.recentActions} loading={loading} />
        </div>
        <div className="min-w-0">
          <AdminQuickActions navigate={navigate} />
        </div>
      </div>
    </DashboardShell>
  );
}
