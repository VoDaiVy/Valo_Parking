import { Fragment, useEffect, useMemo, useState } from 'react';
import { Menu, Listbox, Transition } from '@headlessui/react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AlertCircle,
  ArrowDownRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Crown,
  RefreshCw,
  Repeat,
  WalletCards,
  Wrench,
} from 'lucide-react';
import { getAdminPlatformRevenueByMode } from '../../services/statisticsService';

/* ── Constants ────────────────────────────────────────────────────────── */

const MODE_OPTIONS = [
  { value: '7d', label: '7 Days' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const QUARTERS = ['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)'];

const SOURCE_COLORS = {
  bookingRevenue: '#3B82F6', // blue-500
  serviceRevenue: '#A855F7', // purple-500
  packageRevenue: '#FACC15', // yellow-400
  membershipTransferFees: '#10B981', // emerald-500
};
const SOURCE_LABELS = {
  bookingRevenue: 'Booking',
  serviceRevenue: 'Service',
  packageRevenue: 'Package',
  membershipTransferFees: 'Transfer Fees',
};

/* ── Utilities ────────────────────────────────────────────────────────── */

const safe = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const formatCurrency = (value) =>
  `${safe(value).toLocaleString('vi-VN')} VND`;

const formatNumber = (value) => safe(value).toLocaleString('vi-VN');

const formatAxisCurrency = (value) => {
  const number = safe(value);
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

const pct = (value, total) => {
  const t = safe(total);
  if (t === 0) return 0;
  return (safe(value) / t) * 100;
};

const formatPeriodLabel = (label, granularity) => {
  if (!label) return '';
  if (granularity === 'month') {
    const [y, m] = label.split('-');
    return `${MONTHS[Number(m) - 1]?.slice(0, 3) || m} ${y}`;
  }
  try {
    return new Date(`${label}T00:00:00+07:00`).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return label;
  }
};

const getCurrentVietnamDate = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
  return { year: v.year, month: v.month };
};

const statusTone = (status = '') => {
  const normalized = String(status).toUpperCase();
  if (normalized === 'COMPLETED') return { color: '#34D399', label: 'Completed' }; // emerald-400
  if (['PAID', 'ACTIVE', 'PAUSED'].includes(normalized)) return { color: '#3B82F6', label: 'Active' }; // blue-500
  if (normalized === 'CANCELLED') return { color: '#FB7185', label: 'Cancelled' }; // rose-400
  if (normalized === 'EXPIRED') return { color: '#64748B', label: 'Expired' }; // slate-500
  if (normalized === 'PENDING') return { color: '#FBBF24', label: 'Pending' }; // amber-400
  return { color: '#94A3B8', label: status || 'Unknown' }; // slate-400
};

/* ── UI Components ────────────────────────────────────────────────────── */

function CustomSelect({ value, options, onChange }) {
  const selected = options.find((o) => o.value === value) || options[0];
  return (
    <Listbox value={value} onChange={onChange}>
      <div className="relative z-30 inline-block">
        <Listbox.Button className="inline-flex h-10 w-full min-w-[100px] items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 text-sm font-semibold text-white/80 transition hover:border-yellow-400/40 hover:text-white focus:outline-none">
          <span className="block truncate">{selected?.label}</span>
          <ChevronDown size={14} className="text-white/40" aria-hidden="true" />
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="absolute right-0 mt-1 max-h-60 w-auto min-w-full overflow-auto rounded-lg border border-white/10 bg-[#121212] py-1 text-sm shadow-xl shadow-black/80 ring-1 ring-black ring-opacity-5 focus:outline-none">
            {options.map((option, idx) => (
              <Listbox.Option
                key={idx}
                className={({ active }) =>
                  `relative cursor-pointer select-none py-2 pl-3 pr-8 transition-colors ${
                    active ? 'bg-white/10 text-white' : 'text-white/70'
                  }`
                }
                value={option.value}
              >
                {({ selected }) => (
                  <span className={`block whitespace-nowrap ${selected ? 'font-bold text-yellow-400' : 'font-medium'}`}>
                    {option.label}
                  </span>
                )}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}

/* ── Main Component ───────────────────────────────────────────────────── */

export default function RevenueAnalytics() {
  const { year: vnYear, month: vnMonth } = getCurrentVietnamDate();
  const [mode, setMode] = useState('7d');
  const [selectedYear, setSelectedYear] = useState(vnYear);
  const [selectedMonth, setSelectedMonth] = useState(vnMonth);
  const [selectedQuarter, setSelectedQuarter] = useState(Math.ceil(vnMonth / 3));
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const reduceMotion = useReducedMotion();

  const availableYears = data?.availableYears || [vnYear];

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    const params = { mode };
    if (mode !== '7d') params.year = String(selectedYear);
    if (mode === 'month') params.month = String(selectedMonth);
    if (mode === 'quarter') params.quarter = String(selectedQuarter);

    getAdminPlatformRevenueByMode(params).then((result) => {
      if (!active) return;
      if (result?.ok && result.data?.success) {
        setData(result.data.data);
        setError('');
      } else {
        setData(null);
        setError('Revenue data could not be loaded. Try again in a moment.');
      }
      setLoading(false);
    });

    return () => { active = false; };
  }, [mode, selectedYear, selectedMonth, selectedQuarter, refreshKey]);

  const summary = data?.summary || {};
  const trend = data?.trend || [];
  const traffic = data?.traffic || [];
  const trafficSummary = data?.trafficSummary || {};
  const statusDistribution = data?.statusDistribution || {};
  const packageBreakdown = data?.packageBreakdown || [];
  const granularity = data?.period?.granularity || 'day';

  return (
    <div className="relative min-h-[calc(100vh-70px)] overflow-auto bg-[#090909] px-4 py-5 text-slate-200 lg:px-8">
      <div className="pointer-events-none absolute right-10 top-0 h-[300px] w-[300px] rounded-full bg-yellow-400/5 blur-[120px]" />
      <div className="pointer-events-none absolute left-20 top-60 h-64 w-64 rounded-full bg-blue-500/5 blur-[120px]" />
      
      <div className="relative mx-auto max-w-[1400px]">
        {/* Header */}
        <header className="mb-5 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-yellow-400/20 bg-yellow-400/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-yellow-300">
              <BarChart3 size={11} strokeWidth={2.5} />
              Analytics
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
              Revenue Analytics
            </h1>
            <p className="mt-1 text-[13px] text-slate-400">
              Platform revenue, vehicle traffic and booking insights.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <ModeMenu mode={mode} onChange={(m) => m !== mode && setMode(m)} />
            {mode !== '7d' && (
              <SecondarySelector
                mode={mode}
                year={selectedYear}
                month={selectedMonth}
                quarter={selectedQuarter}
                availableYears={availableYears}
                onYearChange={setSelectedYear}
                onMonthChange={setSelectedMonth}
                onQuarterChange={setSelectedQuarter}
              />
            )}
            <button
              type="button"
              onClick={() => setRefreshKey(v => v + 1)}
              disabled={loading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-yellow-400/25 bg-yellow-400/10 px-4 text-sm font-bold text-yellow-300 transition hover:bg-yellow-400/20 disabled:opacity-50"
            >
              <RefreshCw size={14} strokeWidth={2.5} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-5 flex flex-col gap-3 rounded-lg border-l-2 border-amber-400 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-100 sm:flex-row sm:items-center">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-300" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <RevenueSkeleton />
        ) : data ? (
          <div className="flex flex-col gap-6 pb-8">
            {/* KPI Strip */}
            <KPIStrip summary={summary} reduceMotion={reduceMotion} />

            <div className="border-t border-white/[0.04] my-2" />

            {/* Revenue Trend */}
            <RevenueTrendChart
              trend={trend}
              granularity={granularity}
              reduceMotion={reduceMotion}
            />

            <div className="border-t border-white/[0.04] my-2" />

            {/* Row: Revenue by Source + Vehicle Traffic */}
            <section className="grid items-start gap-8 lg:grid-cols-12 xl:gap-0">
              <div className="lg:col-span-5 xl:border-r xl:border-white/[0.04] xl:pr-10 h-full">
                <RevenueBySourceSection summary={summary} reduceMotion={reduceMotion} />
              </div>
              <div className="lg:col-span-7 xl:pl-10">
                <VehicleTrafficSection
                  traffic={traffic}
                  trafficSummary={trafficSummary}
                  granularity={granularity}
                  reduceMotion={reduceMotion}
                />
              </div>
            </section>

            <div className="border-t border-white/[0.04] my-2" />

            {/* Row: Status Distribution + Value by Package */}
            <section className="grid items-start gap-8 lg:grid-cols-12 xl:gap-0">
              <div className="lg:col-span-5 xl:border-r xl:border-white/[0.04] xl:pr-10 h-full">
                <StatusDistributionSection
                  statusDistribution={statusDistribution}
                  reduceMotion={reduceMotion}
                />
              </div>
              <div className="lg:col-span-7 xl:pl-10">
                <PackageValueSection
                  packageBreakdown={packageBreakdown}
                  reduceMotion={reduceMotion}
                />
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Mode Menu ────────────────────────────────────────────────────────── */

function ModeMenu({ mode, onChange }) {
  return (
    <Menu as="div" className="relative z-40 inline-block text-left">
      <Menu.Button className="inline-flex h-10 w-full min-w-[120px] items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 text-sm font-semibold text-white/80 transition hover:border-yellow-400/40 hover:text-white">
        <CalendarDays size={14} className="text-white/40" />
        <span>{MODE_OPTIONS.find((o) => o.value === mode)?.label}</span>
        <ChevronDown size={14} className="text-white/40" />
      </Menu.Button>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-150"
        enterFrom="opacity-0 translate-y-1"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease-in duration-100"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 translate-y-1"
      >
        <Menu.Items className="absolute right-0 mt-1 w-40 origin-top-right overflow-hidden rounded-lg border border-white/10 bg-[#121212] py-1 shadow-xl shadow-black/80 ring-1 ring-black ring-opacity-5 focus:outline-none">
          {MODE_OPTIONS.map((option) => (
            <Menu.Item key={option.value}>
              {({ active }) => (
                <button
                  type="button"
                  onClick={() => onChange(option.value)}
                  className={`group flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    active ? 'bg-white/10 text-white' : 'text-white/70'
                  }`}
                >
                  {mode === option.value ? (
                    <Check size={14} className="text-yellow-400" />
                  ) : (
                    <span className="w-3.5" />
                  )}
                  <span className="font-medium">{option.label}</span>
                </button>
              )}
            </Menu.Item>
          ))}
        </Menu.Items>
      </Transition>
    </Menu>
  );
}

/* ── Secondary Selectors ──────────────────────────────────────────────── */

function SecondarySelector({
  mode, year, month, quarter, availableYears,
  onYearChange, onMonthChange, onQuarterChange,
}) {
  const yearOpts = availableYears.map(y => ({ label: String(y), value: y }));
  const monthOpts = MONTHS.map((m, i) => ({ label: m, value: i + 1 }));
  const quarterOpts = QUARTERS.map((q, i) => ({ label: q, value: i + 1 }));

  return (
    <div className="flex items-center gap-2">
      <CustomSelect value={year} options={yearOpts} onChange={onYearChange} />
      {mode === 'month' && (
        <CustomSelect value={month} options={monthOpts} onChange={onMonthChange} />
      )}
      {mode === 'quarter' && (
        <CustomSelect value={quarter} options={quarterOpts} onChange={onQuarterChange} />
      )}
    </div>
  );
}

/* ── 6 KPI Cards ──────────────────────────────────────────────────────── */

function KPIStrip({ summary, reduceMotion }) {
  const metrics = [
    { icon: CircleDollarSign, label: 'Total Revenue', value: formatCurrency(summary.totalRevenue), colorClass: 'text-yellow-400' },
    { icon: WalletCards, label: 'Booking Revenue', value: formatCurrency(summary.bookingRevenue), colorClass: 'text-blue-400' },
    { icon: Wrench, label: 'Service Revenue', value: formatCurrency(summary.serviceRevenue), colorClass: 'text-purple-400' },
    { icon: Crown, label: 'Package Revenue', value: formatCurrency(summary.packageRevenue), colorClass: 'text-yellow-400' },
    { icon: Repeat, label: 'Transfer Fees', value: formatCurrency(summary.membershipTransferFees), colorClass: 'text-emerald-400' },
    { icon: ArrowDownRight, label: 'Refunds', value: formatCurrency(summary.refunds), colorClass: 'text-rose-400' },
  ];

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      className="grid grid-cols-2 gap-y-4 md:grid-cols-3 xl:grid-cols-6"
    >
      {metrics.map((metric, index) => (
        <div key={metric.label} className="flex items-center gap-3 border-r border-white/[0.04] px-2 last:border-0">
          <div className={`flex shrink-0 items-center justify-center ${metric.colorClass}`}>
            <metric.icon size={16} strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">
              {metric.label}
            </p>
            <p className="mt-0.5 truncate text-[18px] font-black leading-tight tracking-tight text-white">
              {metric.value}
            </p>
          </div>
        </div>
      ))}
    </motion.section>
  );
}

/* ── Revenue Trend Chart ──────────────────────────────────────────────── */

function RevenueTrendChart({ trend, granularity, reduceMotion }) {
  const [viewMode, setViewMode] = useState('total'); // 'total' | 'bySource'
  const [hoveredIndex, setHoveredIndex] = useState(null);

  const width = 1200;
  const height = 300; // COMPACT HEIGHT
  const padding = { top: 16, right: 16, bottom: 24, left: 60 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const sourceKeys = useMemo(() =>
    viewMode === 'total'
      ? ['totalRevenue']
      : ['bookingRevenue', 'serviceRevenue', 'packageRevenue', 'membershipTransferFees'],
    [viewMode]
  );

  const maxValue = useMemo(() => {
    let max = 1;
    for (const point of trend) {
      for (const key of sourceKeys) {
        const v = safe(point[key]);
        if (v > max) max = v;
      }
    }
    return max * 1.1;
  }, [trend, sourceKeys]);

  const xForIndex = (index) =>
    padding.left + (trend.length <= 1 ? plotWidth / 2 : (index / (trend.length - 1)) * plotWidth);
  const yForValue = (value) =>
    padding.top + plotHeight - (safe(value) / maxValue) * plotHeight;

  const makePath = (field) =>
    trend.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xForIndex(index).toFixed(2)} ${yForValue(point[field]).toFixed(2)}`).join(' ');

  const makeAreaPath = (field) => {
    if (trend.length === 0) return '';
    return `${makePath(field)} L ${xForIndex(trend.length - 1).toFixed(2)} ${yForValue(0).toFixed(2)} L ${xForIndex(0).toFixed(2)} ${yForValue(0).toFixed(2)} Z`;
  };

  const hasActivity = trend.some((p) => sourceKeys.some((k) => safe(p[k]) > 0));

  const labelCount = Math.min(trend.length, granularity === 'month' ? 12 : 7);
  const labelIndexes = useMemo(() => {
    if (trend.length <= labelCount) return new Set(trend.map((_, i) => i));
    const step = (trend.length - 1) / (labelCount - 1);
    const set = new Set();
    for (let i = 0; i < labelCount; i++) set.add(Math.round(i * step));
    return set;
  }, [trend.length, labelCount]);

  const bandWidth = trend.length > 1 ? plotWidth / (trend.length - 1) : plotWidth;
  const lineColors = viewMode === 'total' ? { totalRevenue: '#FACC15' } : SOURCE_COLORS;

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      className="mt-1"
    >
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-[18px] font-bold text-white">Revenue Trend</h2>
          <p className="mt-1 text-[12px] text-slate-400">
            {viewMode === 'total' ? 'Total realized platform revenue' : 'Revenue broken down by source'} over the selected period.
          </p>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden flex-wrap gap-x-4 text-[11px] font-semibold sm:flex">
            {sourceKeys.map((key) => (
              <span key={key} className="flex items-center gap-1.5 text-slate-400">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: lineColors[key] || '#FACC15' }} />
                {SOURCE_LABELS[key] || 'Total'}
              </span>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
            <button onClick={() => setViewMode('total')} className={`rounded-md px-3 py-1 text-xs font-bold transition ${viewMode === 'total' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'}`}>
              Total
            </button>
            <button onClick={() => setViewMode('bySource')} className={`rounded-md px-3 py-1 text-xs font-bold transition ${viewMode === 'bySource' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'}`}>
              By Source
            </button>
          </div>
        </div>
      </div>

      {hasActivity ? (
        <div className="relative w-full overflow-x-auto">
          <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[700px] w-full" role="img" aria-label="Revenue trend chart">
            <defs>
              {sourceKeys.map((key) => (
                <linearGradient key={`grad-${key}`} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColors[key] || '#FACC15'} stopOpacity={viewMode === 'total' ? '0.15' : '0.08'} />
                  <stop offset="100%" stopColor={lineColors[key] || '#FACC15'} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>

            {[0, 0.333, 0.666, 1].map((ratio) => {
              const y = padding.top + plotHeight * ratio;
              const value = maxValue * (1 - ratio);
              return (
                <g key={ratio}>
                  <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="4 4" />
                  <text x={padding.left - 10} y={y + 4} textAnchor="end" fill="rgba(148,163,184,0.5)" fontSize="10" fontWeight="600">{formatAxisCurrency(value)}</text>
                </g>
              );
            })}

            {sourceKeys.map((key, i) => (
              <path key={`area-${key}`} d={makeAreaPath(key)} fill={`url(#grad-${key})`} />
            ))}
            {sourceKeys.map((key, i) => (
              <path key={`line-${key}`} d={makePath(key)} fill="none" stroke={lineColors[key] || '#FACC15'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            ))}

            {trend.map((point, index) => {
              const isHovered = hoveredIndex === index;
              return (
                <g key={point.period} onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex(null)}>
                  <rect x={xForIndex(index) - bandWidth / 2} y={padding.top} width={bandWidth} height={plotHeight} fill="transparent" cursor="crosshair" />
                  {isHovered && <line x1={xForIndex(index)} x2={xForIndex(index)} y1={padding.top} y2={padding.top + plotHeight} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />}
                  {sourceKeys.map((key) => safe(point[key]) > 0 ? (
                    <circle key={`dot-${key}`} cx={xForIndex(index)} cy={yForValue(point[key])} r={isHovered ? '4' : '0'} fill="#111111" stroke={lineColors[key] || '#FACC15'} strokeWidth="2" className="pointer-events-none" />
                  ) : null)}
                  {labelIndexes.has(index) && (
                    <text x={xForIndex(index)} y={height - 4} textAnchor={index === 0 ? 'start' : index === trend.length - 1 ? 'end' : 'middle'} fill={isHovered ? 'rgba(255,255,255,0.8)' : 'rgba(148,163,184,0.6)'} fontSize="10" fontWeight="600" className="pointer-events-none">
                      {formatPeriodLabel(point.period, granularity)}
                    </text>
                  )}
                </g>
              );
            })}

            {hoveredIndex !== null && trend[hoveredIndex] && (
              <g className="pointer-events-none">
                <foreignObject x={xForIndex(hoveredIndex) < width / 2 ? xForIndex(hoveredIndex) + 12 : xForIndex(hoveredIndex) - 192} y={padding.top} width="180" height="150">
                  <div className="rounded-xl border border-white/10 bg-[#121212]/95 px-3 py-2.5 shadow-[0_8px_30px_rgb(0,0,0,0.8)] backdrop-blur-md">
                    <p className="mb-2 text-[11px] font-bold text-white">{formatPeriodLabel(trend[hoveredIndex].period, granularity)}</p>
                    <div className="space-y-1.5">
                      {sourceKeys.map((key) => (
                        <div key={key} className="flex items-center justify-between text-[10px]">
                          <span className="flex items-center gap-1.5 text-slate-400">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: lineColors[key] || '#FACC15' }} />
                            {SOURCE_LABELS[key] || 'Total'}
                          </span>
                          <span className="font-bold tabular-nums text-white">{formatCurrency(trend[hoveredIndex][key])}</span>
                        </div>
                      ))}
                    </div>
                    {viewMode === 'bySource' && (
                      <div className="mt-2 flex items-center justify-between border-t border-white/[0.06] pt-2 text-[10px]">
                        <span className="font-bold text-slate-400">Total</span>
                        <span className="font-black tabular-nums text-yellow-400">{formatCurrency(trend[hoveredIndex].totalRevenue)}</span>
                      </div>
                    )}
                  </div>
                </foreignObject>
              </g>
            )}
          </svg>
        </div>
      ) : (
        <div className="py-10">
          <EmptyState text="No revenue recorded in this period." />
        </div>
      )}
    </motion.section>
  );
}

/* ── Revenue by Source ─────────────────────────────────────────────────── */

function RevenueBySourceSection({ summary, reduceMotion }) {
  const total = safe(summary.sourceCompositionTotal);
  const sources = [
    { key: 'bookingRevenue', label: 'Booking Revenue', color: SOURCE_COLORS.bookingRevenue },
    { key: 'serviceRevenue', label: 'Service Revenue', color: SOURCE_COLORS.serviceRevenue },
    { key: 'packageRevenue', label: 'Package Revenue', color: SOURCE_COLORS.packageRevenue },
    { key: 'membershipTransferFees', label: 'Transfer Fees', color: SOURCE_COLORS.membershipTransferFees },
  ];

  return (
    <motion.section initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}>
      <div className="mb-5">
        <h3 className="text-[16px] font-bold text-white">Revenue by Source</h3>
        <p className="mt-0.5 text-[12px] text-slate-400">Composition total: <span className="font-semibold text-white">{formatCurrency(total)}</span></p>
      </div>
      <div className="space-y-4">
        {sources.map((source) => {
          const value = safe(summary[source.key]);
          const percentage = pct(value, total);
          return (
            <div key={source.key}>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 font-bold text-slate-200">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: source.color }} />
                  {source.label}
                </span>
                <span className="tabular-nums font-semibold text-slate-400">
                  <span className="mr-2 text-white">{formatCurrency(value)}</span>{percentage.toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.04]">
                <div className="h-full rounded-full" style={{ width: `${Math.max(percentage, value > 0 ? 1 : 0)}%`, backgroundColor: source.color, boxShadow: `0 0 8px ${source.color}40` }} />
              </div>
            </div>
          );
        })}
      </div>
    </motion.section>
  );
}

/* ── Vehicle Traffic ──────────────────────────────────────────────────── */

function VehicleTrafficSection({ traffic, trafficSummary, granularity, reduceMotion }) {
  const maxTraffic = Math.max(...traffic.flatMap((p) => [safe(p.entries), safe(p.exits)]), 1);
  const width = 800;
  const height = 160; // COMPACT HEIGHT
  const pad = { top: 12, right: 12, bottom: 20, left: 36 };
  const pw = width - pad.left - pad.right;
  const ph = height - pad.top - pad.bottom;

  const xFor = (i) => pad.left + (traffic.length <= 1 ? pw / 2 : (i / (traffic.length - 1)) * pw);
  const yFor = (v) => pad.top + ph - (safe(v) / maxTraffic) * ph;
  const makeLine = (field) => traffic.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p[field]).toFixed(1)}`).join(' ');
  const makeArea = (field) => traffic.length === 0 ? '' : `${makeLine(field)} L ${xFor(traffic.length - 1).toFixed(1)} ${yFor(0).toFixed(1)} L ${xFor(0).toFixed(1)} ${yFor(0).toFixed(1)} Z`;

  const hasTraffic = traffic.some((p) => safe(p.entries) > 0 || safe(p.exits) > 0);

  return (
    <motion.section initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}>
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h3 className="text-[16px] font-bold text-white">Vehicle Traffic</h3>
          <p className="mt-0.5 text-[12px] text-slate-400">Vehicles entering and exiting.</p>
        </div>
        <div className="flex gap-4 text-[10px] font-bold text-slate-400">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Entries</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-400" /> Exits</span>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <div>
          <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Entries</p>
          <p className="text-xl font-black tabular-nums text-white">{formatNumber(trafficSummary.totalEntries)}</p>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Exits</p>
          <p className="text-xl font-black tabular-nums text-white">{formatNumber(trafficSummary.totalExits)}</p>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Parked</p>
          <div className="flex items-baseline gap-1.5">
            <p className="text-xl font-black tabular-nums text-white">{formatNumber(trafficSummary.currentlyParked)}</p>
            <p className="text-[9px] font-bold text-sky-400">Active</p>
          </div>
        </div>
      </div>

      {hasTraffic ? (
        <div className="w-full overflow-x-auto">
          <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[400px] w-full" role="img" aria-label="Vehicle traffic chart">
            <defs>
              <linearGradient id="grad-entries" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34D399" stopOpacity="0.15" /><stop offset="100%" stopColor="#34D399" stopOpacity="0" /></linearGradient>
              <linearGradient id="grad-exits" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FB7185" stopOpacity="0.15" /><stop offset="100%" stopColor="#FB7185" stopOpacity="0" /></linearGradient>
            </defs>
            {[0, 0.5, 1].map((r) => (
              <g key={r}>
                <line x1={pad.left} x2={width - pad.right} y1={pad.top + ph * r} y2={pad.top + ph * r} stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="4 4" />
                <text x={pad.left - 8} y={pad.top + ph * r + 3} textAnchor="end" fill="rgba(148,163,184,0.5)" fontSize="9" fontWeight="600">{formatNumber(maxTraffic * (1 - r))}</text>
              </g>
            ))}
            <path d={makeArea('entries')} fill="url(#grad-entries)" />
            <path d={makeArea('exits')} fill="url(#grad-exits)" />
            <path d={makeLine('entries')} fill="none" stroke="#34D399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d={makeLine('exits')} fill="none" stroke="#FB7185" strokeWidth="2" strokeDasharray="5 3" strokeLinecap="round" strokeLinejoin="round" />
            {traffic.map((p, i) => {
              if (traffic.length <= 7 || i === 0 || i === traffic.length - 1 || i === Math.floor(traffic.length / 2)) {
                return <text key={p.period} x={xFor(i)} y={height - 2} textAnchor={i === 0 ? 'start' : i === traffic.length - 1 ? 'end' : 'middle'} fill="rgba(148,163,184,0.6)" fontSize="9" fontWeight="600">{formatPeriodLabel(p.period, granularity)}</text>;
              }
              return null;
            })}
          </svg>
        </div>
      ) : (
        <div className="py-6">
          <EmptyState text="No vehicle activity." />
        </div>
      )}
    </motion.section>
  );
}

/* ── Status Distribution ──────────────────────────────────────────────── */

function StatusDistributionSection({ statusDistribution, reduceMotion }) {
  const statusRows = statusDistribution?.byStatus || [];
  const totalBookings = safe(statusDistribution?.totalBookings);
  const size = 130; // COMPACT
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  let currentOffset = 0;

  return (
    <motion.section initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}>
      <div className="mb-5">
        <h3 className="text-[16px] font-bold text-white">Status Distribution</h3>
        <p className="mt-0.5 text-[12px] text-slate-400">Booking status in the selected period.</p>
      </div>
      {statusRows.length > 0 && totalBookings > 0 ? (
        <div className="flex flex-row items-center gap-8">
          <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
              <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={strokeWidth} />
              {statusRows.map((row) => {
                const ratio = safe(row.count) / totalBookings;
                if (ratio === 0) return null;
                const dashArray = `${ratio * circumference} ${circumference}`;
                const dashOffset = -currentOffset;
                currentOffset += ratio * circumference;
                return (
                  <circle key={row.status} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={statusTone(row.status).color} strokeWidth={strokeWidth} strokeDasharray={dashArray} strokeDashoffset={dashOffset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
                );
              })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
              <span className="text-xl font-black leading-none text-white">{formatNumber(totalBookings)}</span>
              <span className="mt-0.5 text-[8px] font-bold uppercase tracking-wider text-slate-500">Bookings</span>
            </div>
          </div>
          <div className="flex-1 space-y-2.5">
            {statusRows.map((row) => {
              const tone = statusTone(row.status);
              const percent = pct(row.count, totalBookings);
              return (
                <div key={row.status} className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tone.color }} />
                    <span className="font-bold text-slate-200">{tone.label}</span>
                  </div>
                  <span className="font-semibold tabular-nums text-slate-400">
                    <span className="mr-2 text-white">{formatNumber(row.count)}</span>{percent.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState text="No booking activity." />
      )}
    </motion.section>
  );
}

/* ── Package Value ────────────────────────────────────────────────────── */

function PackageValueSection({ packageBreakdown, reduceMotion }) {
  const maxAmount = Math.max(...packageBreakdown.map((p) => safe(p.totalAmount)), 0);

  return (
    <motion.section initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}>
      <div className="mb-5">
        <h3 className="text-[16px] font-bold text-white">Value by Package</h3>
        <p className="mt-0.5 text-[12px] text-slate-400">Revenue generated by packages.</p>
      </div>
      <div>
        {packageBreakdown.length ? (
          <div className="space-y-1">
            {packageBreakdown.slice(0, 5).map((row, index) => {
              const amount = safe(row.totalAmount);
              const barWidth = maxAmount > 0 ? (amount / maxAmount) * 100 : 0;
              return (
                <div key={row.packageId || row.packageName || index} className="group flex items-center justify-between gap-3 rounded-lg py-2 transition hover:bg-white/[0.02]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-black text-yellow-400/80 bg-yellow-400/10">
                      {String(index + 1).padStart(2, '0')}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-white">
                        {row.packageName || 'Archived package'}
                        {!row.isActive && row.packageName !== 'Archived package' && <span className="ml-1.5 text-[9px] font-medium text-slate-500">(archived)</span>}
                      </p>
                      <p className="text-[10px] font-medium text-slate-500">
                        {formatNumber(row.purchaseCount)} purchases · {formatNumber(row.renewalCount)} renewals
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-black tabular-nums text-yellow-400">{formatCurrency(amount)}</p>
                    <div className="mt-1 h-0.5 w-20 overflow-hidden rounded-full bg-white/[0.04]">
                      <div className="h-full rounded-full bg-yellow-400/80" style={{ width: `${barWidth}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState text="No package transactions." />
        )}
      </div>
    </motion.section>
  );
}

/* ── Shared Components ────────────────────────────────────────────────── */

function EmptyState({ text }) {
  return <div className="rounded-xl border border-dashed border-white/[0.06] px-4 py-6 text-center text-xs font-semibold text-slate-500">{text}</div>;
}

function RevenueSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading...">
      <div className="h-12 w-full animate-pulse rounded bg-white/[0.02]" />
      <div className="border-t border-white/[0.04]" />
      <div className="h-[300px] w-full animate-pulse rounded bg-white/[0.02]" />
      <div className="border-t border-white/[0.04]" />
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="h-40 w-full animate-pulse rounded bg-white/[0.02]" />
        <div className="h-40 w-full animate-pulse rounded bg-white/[0.02]" />
      </div>
    </div>
  );
}
