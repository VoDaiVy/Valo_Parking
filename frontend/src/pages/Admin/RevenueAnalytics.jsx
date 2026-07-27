import { Fragment, useEffect, useState } from 'react';
import { Menu, Transition } from '@headlessui/react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Crown,
  Info,
  RefreshCw,
  RotateCcw,
  WalletCards,
} from 'lucide-react';
import {
  getAdminBookingStatistics,
  getAdminPlatformRevenueStatistics,
  getAdminSubscriptionStatistics,
} from '../../services/statisticsService';

const RANGE_OPTIONS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' },
];

const formatCurrency = (value) =>
  `${Number(value || 0).toLocaleString('vi-VN')} VND`;

const formatNumber = (value) => Number(value || 0).toLocaleString('vi-VN');

const formatAxisCurrency = (value) => {
  const number = Number(value || 0);
  if (Math.abs(number) >= 1_000_000) {
    return `${new Intl.NumberFormat('vi-VN', {
      maximumFractionDigits: 1,
    }).format(number / 1_000_000)}M`;
  }
  if (Math.abs(number) >= 1_000) {
    return `${new Intl.NumberFormat('vi-VN', {
      maximumFractionDigits: 0,
    }).format(number / 1_000)}K`;
  }
  return formatNumber(number);
};

const toDayKey = (date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const buildRevenueTimeline = (bookingTimeline, subscriptionTimeline, range) => {
  const pointsByPeriod = new Map();
  const ensurePoint = (period) => {
    const current = pointsByPeriod.get(period) || {
      period,
      bookingCharges: 0,
      bookingRefunds: 0,
      packageSales: 0,
      renewalSales: 0,
    };
    pointsByPeriod.set(period, current);
    return current;
  };

  for (const point of bookingTimeline?.points || []) {
    Object.assign(ensurePoint(point.period), point);
  }
  for (const point of subscriptionTimeline?.points || []) {
    Object.assign(ensurePoint(point.period), point);
  }

  if (range !== 'all') {
    const now = new Date();
    const days = range === '7d'
      ? 7
      : range === 'month'
        ? new Date().getDate() - 1
        : 30;
    for (let offset = days; offset >= 0; offset -= 1) {
      const date = new Date(now);
      date.setDate(now.getDate() - offset);
      ensurePoint(toDayKey(date));
    }
  }

  return [...pointsByPeriod.values()]
    .sort((left, right) => left.period.localeCompare(right.period))
    .map((point) => {
      const recordedSales =
        Number(point.bookingCharges || 0) +
        Number(point.packageSales || 0) +
        Number(point.renewalSales || 0);
      const refunds = Number(point.bookingRefunds || 0);
      return {
        ...point,
        recordedSales,
        refunds,
        netSales: recordedSales - refunds,
      };
    });
};

const statusTone = (status = '') => {
  const normalized = String(status).toUpperCase();
  if (normalized === 'COMPLETED') return { className: 'bg-emerald-400', label: 'Completed' };
  if (['PAID', 'ACTIVE', 'PAUSED'].includes(normalized)) return { className: 'bg-sky-400', label: 'Active' };
  if (normalized === 'CANCELLED') return { className: 'bg-rose-400', label: 'Cancelled' };
  if (normalized === 'EXPIRED') return { className: 'bg-slate-500', label: 'Expired' };
  return { className: 'bg-yellow-400', label: status || 'Unknown' };
};

export default function RevenueAnalytics() {
  const [range, setRange] = useState('30d');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(null);
  const [subscriptions, setSubscriptions] = useState(null);
  const [platformRevenue, setPlatformRevenue] = useState(null);
  const [error, setError] = useState('');
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      getAdminBookingStatistics(range),
      getAdminSubscriptionStatistics(range),
      getAdminPlatformRevenueStatistics(range),
    ]).then((results) => {
      if (!active) return;
      const [bookingResult, subscriptionResult, platformResult] = results;
      const bookingResponse =
        bookingResult.status === 'fulfilled' ? bookingResult.value : null;
      const subscriptionResponse =
        subscriptionResult.status === 'fulfilled' ? subscriptionResult.value : null;
      const platformResponse =
        platformResult.status === 'fulfilled' ? platformResult.value : null;

      setBooking(
        bookingResponse?.ok && bookingResponse.data?.success
          ? bookingResponse.data.data
          : null
      );
      setSubscriptions(
        subscriptionResponse?.ok && subscriptionResponse.data?.success
          ? subscriptionResponse.data.data
          : null
      );
      setPlatformRevenue(
        platformResponse?.ok && platformResponse.data?.success
          ? platformResponse.data.data
          : null
      );

      const statisticsUnavailable =
        bookingResponse?.status === 404 || subscriptionResponse?.status === 404;
      const allFailed =
        !bookingResponse?.ok &&
        !subscriptionResponse?.ok &&
        !platformResponse?.ok;
      setError(
        statisticsUnavailable
          ? 'Detailed booking and package analytics are currently disabled.'
          : allFailed
            ? 'Revenue data could not be loaded. Try again in a moment.'
            : ''
      );
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [range, refreshKey]);

  const handleRangeChange = (nextRange) => {
    if (nextRange === range) return;
    setLoading(true);
    setError('');
    setRange(nextRange);
  };

  const handleRefresh = () => {
    setLoading(true);
    setError('');
    setRefreshKey((value) => value + 1);
  };

  const bookingMoney = booking?.money || {};
  const subscriptionSummary = subscriptions?.summary || {};
  const transferFeeSummary = platformRevenue?.membershipTransferFees || {};
  const statusRows = booking?.byStatus || [];
  const packageRows = subscriptions?.byPackage || [];
  const revenueTimeline = buildRevenueTimeline(
    booking?.timeline,
    subscriptions?.timeline,
    range
  );

  const totalStatusCount = statusRows.reduce(
    (sum, row) => sum + Number(row.count || 0),
    0
  );
  const maxPackageAmount = Math.max(
    ...packageRows.map((row) => Number(row.amount || 0)),
    0
  );

  const financialMetrics = [
    {
      icon: WalletCards,
      label: 'Wallet booking payments',
      value: formatCurrency(bookingMoney.walletBookingCharges),
      note: `${formatNumber(bookingMoney.walletChargeCount)} recorded transactions`,
      tone: 'gold',
    },
    {
      icon: ArrowDownRight,
      label: 'Booking refunds',
      value: formatCurrency(bookingMoney.walletBookingRefunds),
      note: `${formatNumber(bookingMoney.walletRefundCount)} wallet refunds`,
      tone: 'rose',
    },
    {
      icon: CircleDollarSign,
      label: 'Net wallet booking spend',
      value: formatCurrency(bookingMoney.walletNetBookingSpend),
      note: 'Payments less booking refunds',
      tone: 'emerald',
    },
    {
      icon: Crown,
      label: 'Package payments',
      value: formatCurrency(subscriptionSummary.grossAmount),
      note: `${formatNumber(subscriptionSummary.sold)} packages in this period`,
      tone: 'purple',
    },
    {
      icon: CircleDollarSign,
      label: 'Membership transfer fees',
      value: formatCurrency(transferFeeSummary.revenue),
      note: `${formatNumber(transferFeeSummary.transactionCount)} completed fee transactions`,
      tone: 'emerald',
    },
  ];

  const sourceSummary = [
    {
      icon: ArrowUpRight,
      title: 'External payment-derived booking value',
      value: formatCurrency(bookingMoney.externalPaymentValue),
      text: 'Estimated from paid booking records.',
    },
    {
      icon: RotateCcw,
      title: 'Renewal value',
      value: formatCurrency(subscriptionSummary.renewalAmount),
      text: 'Successful renewals recorded by the new audit flow.',
    },
    {
      icon: BarChart3,
      title: 'Partial financial coverage',
      value: bookingMoney.financialCoverage || 'Unavailable',
      text: 'Wallet totals require a verified booking reference.',
      accent: 'amber',
    },
  ];

  const motionProps = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.38, ease: 'easeOut' },
      };

  return (
    <div className="relative min-h-[calc(100vh-70px)] overflow-auto bg-[#090909] px-4 py-6 text-slate-200 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute right-10 top-0 h-72 w-72 rounded-full bg-yellow-400/10 blur-[115px]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.03] [background-image:linear-gradient(rgba(255,255,255,.62)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.62)_1px,transparent_1px)] [background-size:48px_48px]" />

      <div className="relative mx-auto max-w-[1500px]">
        <motion.header
          {...motionProps}
          className="mb-7 flex flex-col justify-between gap-5 border-b border-white/[0.08] pb-7 xl:flex-row xl:items-end"
        >
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-yellow-400/20 bg-yellow-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-yellow-300">
              <BarChart3 size={13} />
              Analytics
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white lg:text-[42px]">
              Revenue Analytics
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              Booking cash flow, refunds and parking package performance with each source kept separate.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Menu as="div" className="relative z-40 inline-block text-left">
              <Menu.Button className="inline-flex h-11 w-full items-center justify-between gap-2 rounded-[12px] border border-white/[0.08] bg-[#111111]/80 px-3 text-sm text-white/75 transition hover:border-yellow-400/30 hover:bg-white/[0.03] hover:text-white focus:outline-none focus:border-yellow-400/50 focus:ring-1 focus:ring-yellow-400/25 sm:w-[170px]">
                <CalendarDays size={15} className="text-white/45" />
                <span className="font-semibold">
                  {RANGE_OPTIONS.find((option) => option.value === range)?.label}
                </span>
                <ChevronDown size={14} className="text-white/45" />
              </Menu.Button>
              <Transition
                as={Fragment}
                enter="transition ease-out duration-200"
                enterFrom="opacity-0 translate-y-1"
                enterTo="opacity-100 translate-y-0"
                leave="transition ease-in duration-150"
                leaveFrom="opacity-100 translate-y-0"
                leaveTo="opacity-0 translate-y-1"
              >
                <Menu.Items className="absolute right-0 mt-2 w-44 origin-top-right overflow-hidden rounded-xl border border-white/10 bg-[#151515] shadow-2xl shadow-black/60 backdrop-blur-xl focus:outline-none">
                  <div className="p-1.5">
                    {RANGE_OPTIONS.map((option) => (
                      <Menu.Item key={option.value}>
                        {({ active }) => (
                          <button
                            type="button"
                            onClick={() => handleRangeChange(option.value)}
                            className={`group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                              active ? 'bg-white/10 text-white' : 'text-white/70'
                            }`}
                          >
                            {range === option.value ? (
                              <Check size={14} className="text-yellow-300" />
                            ) : (
                              <span className="w-3.5" />
                            )}
                            {option.label}
                          </button>
                        )}
                      </Menu.Item>
                    ))}
                  </div>
                </Menu.Items>
              </Transition>
            </Menu>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[12px] border border-yellow-400/25 bg-yellow-400/[0.06] px-4 text-sm font-black text-yellow-200 transition hover:border-yellow-300/45 hover:bg-yellow-400/10 active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </motion.header>

        {error && (
          <div className="mb-5 flex flex-col gap-3 border-l-2 border-amber-400 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-100 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-300" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-amber-200 transition hover:text-white"
            >
              <RefreshCw size={13} />
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <RevenueSkeleton />
        ) : (
          <>
            <FinancialOverviewStrip metrics={financialMetrics} reduceMotion={reduceMotion} />
            <SourceCoverageNotice />

            <SalesTrendChart
              points={revenueTimeline}
              granularity={booking?.timeline?.granularity || 'day'}
              reduceMotion={reduceMotion}
            />

            <section className="mt-7 grid items-start gap-7 xl:grid-cols-12">
              <StatusDistributionSection
                statusRows={statusRows}
                totalStatusCount={totalStatusCount}
                reduceMotion={reduceMotion}
              />
              <PackageValueSection
                packageRows={packageRows}
                maxPackageAmount={maxPackageAmount}
                reduceMotion={reduceMotion}
              />
            </section>

            <SourceSummaryStrip items={sourceSummary} />
          </>
        )}
      </div>
    </div>
  );
}

function FinancialOverviewStrip({ metrics, reduceMotion }) {
  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      className="grid border-y border-white/[0.08] md:grid-cols-2 xl:grid-cols-5"
    >
      {metrics.map((metric, index) => {
        const Icon = metric.icon;
        return (
          <motion.div
            key={metric.label}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            transition={{ delay: index * 0.055 }}
            className="group flex gap-4 border-white/[0.08] px-2 py-5 transition hover:bg-white/[0.025] sm:px-5 [&:not(:last-child)]:border-b md:[&:not(:last-child)]:border-r xl:[&:not(:last-child)]:border-b-0"
          >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${
              metric.tone === 'rose'
                ? 'border-rose-400/20 bg-rose-400/10 text-rose-300'
                : metric.tone === 'emerald'
                  ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                  : metric.tone === 'purple'
                    ? 'border-violet-400/20 bg-violet-400/10 text-violet-300'
                    : 'border-yellow-400/20 bg-yellow-400/10 text-yellow-300'
            }`}>
              <Icon size={17} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.15em] text-slate-500">
                {metric.label}
              </p>
              <p className="mt-2 text-2xl font-black tabular-nums tracking-tight text-white">
                {metric.value}
              </p>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                {metric.note}
              </p>
            </div>
          </motion.div>
        );
      })}
    </motion.section>
  );
}

function SourceCoverageNotice() {
  return (
    <div className="mt-4 flex items-start gap-3 border-l-2 border-yellow-400/55 bg-yellow-400/[0.045] px-4 py-3">
      <Info size={18} className="mt-0.5 shrink-0 text-yellow-300" />
      <div>
        <p className="text-sm font-black text-slate-100">Financial sources are reported separately</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          Financial sources are reported separately and must not be interpreted as one accounting revenue total.
        </p>
      </div>
    </div>
  );
}

function SalesTrendChart({ points, granularity, reduceMotion }) {
  const width = 1000;
  const height = 340;
  const padding = { top: 24, right: 26, bottom: 42, left: 76 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maximumValue = Math.max(
    ...points.flatMap((point) => [point.recordedSales, point.refunds]),
    1
  );
  const xForIndex = (index) =>
    padding.left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yForValue = (value) =>
    padding.top + plotHeight - (Number(value || 0) / maximumValue) * plotHeight;
  const makePath = (field) =>
    points
      .map((point, index) => {
        const command = index === 0 ? 'M' : 'L';
        return `${command} ${xForIndex(index).toFixed(2)} ${yForValue(point[field]).toFixed(2)}`;
      })
      .join(' ');
  const labelIndexes = new Set(
    [0, Math.floor((points.length - 1) / 2), points.length - 1].filter(
      (index) => index >= 0
    )
  );
  const hasActivity = points.some(
    (point) => point.recordedSales > 0 || point.refunds > 0
  );
  const totalRecordedSales = points.reduce(
    (sum, point) => sum + point.recordedSales,
    0
  );
  const totalRefunds = points.reduce((sum, point) => sum + point.refunds, 0);

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      className="mt-6 overflow-hidden rounded-[16px] border border-white/[0.08] bg-[#111111]/90"
    >
      <div className="flex flex-col gap-4 border-b border-white/[0.08] px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-black text-white">Sales Trend</h2>
          <p className="mt-1 text-sm leading-5 text-slate-500">
            Recorded sales sources and refunds over the selected period.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold">
          <span className="flex items-center gap-2 text-slate-400">
            <span className="h-0.5 w-6 bg-yellow-400" />
            Recorded sales sources {formatCurrency(totalRecordedSales)}
          </span>
          <span className="flex items-center gap-2 text-slate-400">
            <span className="h-0.5 w-6 border-t border-dashed border-rose-400" />
            Refunds {formatCurrency(totalRefunds)}
          </span>
        </div>
      </div>

      {hasActivity ? (
        <div className="overflow-x-auto px-3 pb-4 pt-5 sm:px-5">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="min-w-[720px] w-full"
            role="img"
            aria-label="Line chart showing recorded sales sources and refunds over time"
          >
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = padding.top + plotHeight * ratio;
              const value = maximumValue * (1 - ratio);
              return (
                <g key={ratio}>
                  <line
                    x1={padding.left}
                    x2={width - padding.right}
                    y1={y}
                    y2={y}
                    stroke="rgba(255,255,255,0.07)"
                    strokeWidth="1"
                  />
                  <text
                    x={padding.left - 12}
                    y={y + 4}
                    textAnchor="end"
                    fill="rgba(148,163,184,0.78)"
                    fontSize="12"
                  >
                    {formatAxisCurrency(value)}
                  </text>
                </g>
              );
            })}

            <motion.path
              d={makePath('recordedSales')}
              fill="none"
              stroke="#FACC15"
              strokeWidth="3.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={reduceMotion ? false : { pathLength: 0 }}
              animate={reduceMotion ? undefined : { pathLength: 1 }}
              transition={{ duration: 0.75, ease: 'easeOut' }}
            />
            <motion.path
              d={makePath('refunds')}
              fill="none"
              stroke="#FB7185"
              strokeWidth="2.6"
              strokeDasharray="8 8"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={reduceMotion ? false : { pathLength: 0 }}
              animate={reduceMotion ? undefined : { pathLength: 1 }}
              transition={{ duration: 0.75, ease: 'easeOut', delay: 0.08 }}
            />

            {points.map((point, index) => (
              <g key={point.period}>
                {point.recordedSales > 0 && (
                  <circle
                    cx={xForIndex(index)}
                    cy={yForValue(point.recordedSales)}
                    r="4.2"
                    fill="#111111"
                    stroke="#FACC15"
                    strokeWidth="2.5"
                  >
                    <title>
                      {`${point.period}: recorded sales sources ${formatCurrency(point.recordedSales)}; refunds ${formatCurrency(point.refunds)}; net visualization value ${formatCurrency(point.netSales)}`}
                    </title>
                  </circle>
                )}
                {point.refunds > 0 && (
                  <circle
                    cx={xForIndex(index)}
                    cy={yForValue(point.refunds)}
                    r="3.8"
                    fill="#111111"
                    stroke="#FB7185"
                    strokeWidth="2.2"
                  >
                    <title>
                      {`${point.period}: refunds ${formatCurrency(point.refunds)}`}
                    </title>
                  </circle>
                )}
                {labelIndexes.has(index) && (
                  <text
                    x={xForIndex(index)}
                    y={height - 12}
                    textAnchor={
                      index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'
                    }
                    fill="rgba(148,163,184,0.82)"
                    fontSize="12"
                  >
                    {granularity === 'month'
                      ? point.period
                      : new Date(`${point.period}T00:00:00+07:00`).toLocaleDateString(
                        'vi-VN',
                        { day: '2-digit', month: '2-digit' }
                      )}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
      ) : (
        <div className="px-6 py-12">
          <EmptyState text="No recorded sales sources or refunds in this period." />
        </div>
      )}
    </motion.section>
  );
}

function StatusDistributionSection({ statusRows, totalStatusCount, reduceMotion }) {
  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      className="xl:col-span-7"
    >
      <div>
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            Status Distribution
          </p>
          <p className="text-xs font-semibold text-slate-500">
            {formatNumber(totalStatusCount)} status records
          </p>
        </div>

        {statusRows.length && totalStatusCount > 0 ? (
          <>
            <div className="flex h-3 overflow-hidden rounded-full bg-white/[0.05]">
              {statusRows.map((row) => {
                const ratio = Number(row.count || 0) / totalStatusCount;
                const width = Math.max(ratio * 100, row.count > 0 ? 1.5 : 0);
                const tone = statusTone(row.status);
                return (
                  <motion.div
                    key={row.status}
                    initial={reduceMotion ? false : { width: 0 }}
                    animate={reduceMotion ? undefined : { width: `${width}%` }}
                    transition={{ duration: 0.55, ease: 'easeOut' }}
                    className={tone.className}
                    style={reduceMotion ? { width: `${width}%` } : undefined}
                    title={`${row.status}: ${formatNumber(row.count)} bookings`}
                  />
                );
              })}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {statusRows.map((row) => {
                const tone = statusTone(row.status);
                const percent = totalStatusCount
                  ? (Number(row.count || 0) / totalStatusCount) * 100
                  : 0;
                return (
                  <div key={row.status} className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.className}`} />
                      <span className="truncate text-sm font-bold text-slate-300">{tone.label}</span>
                    </div>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">
                      {formatNumber(row.count)} · {percent.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <EmptyState text="No booking activity in this period." />
        )}
      </div>
    </motion.section>
  );
}

function PackageValueSection({ packageRows, maxPackageAmount, reduceMotion }) {
  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ delay: reduceMotion ? 0 : 0.06 }}
      className="xl:col-span-5"
    >
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            Value by Package
          </p>
          <p className="text-xs font-semibold text-slate-500">Ranked by package amount</p>
        </div>
        <div>
          {packageRows.length ? (
            packageRows.slice(0, 5).map((row, index) => {
              const amount = Number(row.amount || 0);
              const barWidth = maxPackageAmount > 0 ? (amount / maxPackageAmount) * 100 : 0;
              return (
                <motion.div
                  key={row.packageId || row.packageName || index}
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04 }}
                  className="group relative border-b border-white/[0.06] py-4"
                >
                  <div className="absolute inset-x-0 bottom-0 top-0 opacity-0 transition group-hover:opacity-100">
                    <div className="h-full bg-white/[0.025]" />
                  </div>
                  <div className="relative flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="text-xs font-black tabular-nums text-yellow-300/80">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-white">
                          {row.packageName || 'Archived package'}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatNumber(row.sold)} sold · {formatNumber(row.slots)} spaces
                        </p>
                      </div>
                    </div>
                    <p className="shrink-0 text-sm font-black tabular-nums text-yellow-300">
                      {formatCurrency(amount)}
                    </p>
                  </div>
                  <div className="relative mt-3 h-1 overflow-hidden rounded-full bg-white/[0.05]">
                    <motion.div
                      initial={reduceMotion ? false : { width: 0 }}
                      animate={reduceMotion ? undefined : { width: `${barWidth}%` }}
                      transition={{ duration: 0.45, ease: 'easeOut' }}
                      style={reduceMotion ? { width: `${barWidth}%` } : undefined}
                      className="h-full rounded-full bg-yellow-400/70"
                    />
                  </div>
                </motion.div>
              );
            })
          ) : (
            <EmptyState text="No package transactions in the selected period." />
          )}
        </div>
      </div>
    </motion.section>
  );
}

function SourceSummaryStrip({ items }) {
  return (
    <section className="mt-7 grid border-y border-white/[0.08] md:grid-cols-3">
      {items.map((item) => {
        const Icon = item.icon;
        const isAmber = item.accent === 'amber';
        return (
          <div
            key={item.title}
            className="flex items-start gap-3 border-white/[0.08] px-2 py-5 sm:px-5 [&:not(:last-child)]:border-b md:[&:not(:last-child)]:border-b-0 md:[&:not(:last-child)]:border-r"
          >
            <div className={`mt-0.5 ${isAmber ? 'text-amber-300' : 'text-yellow-300'}`}>
              <Icon size={17} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                {item.title}
              </p>
              <p className={`mt-2 text-lg font-black tabular-nums capitalize ${isAmber ? 'text-amber-200' : 'text-white'}`}>
                {item.value}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{item.text}</p>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function EmptyState({ text }) {
  return (
    <div className="border-y border-dashed border-white/[0.08] px-4 py-7 text-center text-xs font-semibold text-slate-500">
      {text}
    </div>
  );
}

function RevenueSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading revenue analytics">
      <div className="grid border-y border-white/[0.08] md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-32 animate-pulse border-white/[0.08] bg-white/[0.035] md:border-r" />
        ))}
      </div>
      <div className="h-16 animate-pulse border-l-2 border-yellow-400/20 bg-yellow-400/[0.035]" />
      <div className="h-[420px] animate-pulse rounded-[16px] border border-white/[0.08] bg-white/[0.035]" />
      <div className="grid items-start gap-7 xl:grid-cols-12">
        <div className="h-60 animate-pulse border-y border-white/[0.08] bg-white/[0.035] xl:col-span-7" />
        <div className="h-72 animate-pulse border-y border-white/[0.08] bg-white/[0.035] xl:col-span-5" />
      </div>
      <div className="h-28 animate-pulse border-y border-white/[0.08] bg-white/[0.035]" />
    </div>
  );
}
