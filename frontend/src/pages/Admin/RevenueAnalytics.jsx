import { Fragment, useEffect, useState } from 'react';
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
import { inspectRevenueResponse } from './revenueAnalyticsData';
import './revenueAnalytics.css';
import { getAdminPlatformRevenueByMode } from '../../services/statisticsService';

/* ── Constants ────────────────────────────────────────────────────────── */

const MODE_OPTIONS = [
  { value: '7d', label: '7 Days' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Months in Year' },
  { value: 'years', label: 'By Year' },
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
  if (typeof v !== 'number' && (typeof v !== 'string' || !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const formatCurrency = (value) => safe(value) === null ? 'Unavailable' : `${safe(value).toLocaleString('vi-VN')} VND`;
const formatNumber = (value) => safe(value) === null ? 'Unavailable' : safe(value).toLocaleString('vi-VN');

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
  if (granularity === 'year') return label;
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
  if (['PAID', 'ACTIVE', 'PAUSED'].includes(normalized)) return { color: '#3B82F6', label: {PAID: 'Paid', ACTIVE: 'Active', PAUSED: 'Paused'}[normalized] }; // blue-500
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
          <Listbox.Options className="ra-select-options absolute right-0 mt-1 max-h-60 w-auto min-w-full overflow-auto rounded-lg border border-white/10 bg-[#121212] py-1 text-sm shadow-xl shadow-black/80 ring-1 ring-black ring-opacity-5 focus:outline-none">
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
  const [updatedAt, setUpdatedAt] = useState(null);
  const reduceMotion = useReducedMotion();

  const availableYears = data?.availableYears || [vnYear];

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    const params = { mode };
    if (mode !== '7d' && mode !== 'years') params.year = String(selectedYear);
    if (mode === 'month') params.month = String(selectedMonth);
    if (mode === 'quarter') params.quarter = String(selectedQuarter);

    getAdminPlatformRevenueByMode(params).then((result) => {
      if (!active) return;
      if (result?.ok && result.data?.success) {
        setData(result.data.data);
        setUpdatedAt(new Date());
        setError('');
      } else {
        setData(null);
        setError('Revenue data could not be loaded. Try again in a moment.');
      }
      setLoading(false);
    });

    return () => { active = false; };
  }, [mode, selectedYear, selectedMonth, selectedQuarter, refreshKey]);

  const report = inspectRevenueResponse(data);
  const summary = report.summary;
  const trend = report.trend;
  const traffic = data?.traffic ?? null;
  const trafficSummary = data?.trafficSummary || {};
  const statusDistribution = data?.statusDistribution ?? null;
  const packageBreakdown = report.packages;
  const granularity = data?.period?.granularity || 'day';
  const trafficGranularity = data?.trafficGranularity || granularity;

  return (
    <div className="admin-revenue-analytics relative min-h-[calc(100vh-70px)] overflow-auto bg-[#090909] px-4 py-5 text-slate-200 lg:px-8">
      <div className="pointer-events-none absolute right-10 top-0 h-[300px] w-[300px] rounded-full bg-yellow-400/5 blur-[120px]" />
      <div className="pointer-events-none absolute left-20 top-60 h-64 w-64 rounded-full bg-blue-500/5 blur-[120px]" />
      
      <div className="ra-workspace relative mx-auto max-w-[1400px]">
        {/* Header */}
        <header className="ra-header mb-5 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-yellow-400/20 bg-yellow-400/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-yellow-300">
              <BarChart3 size={11} strokeWidth={2.5} />
              VALO / ADMIN ANALYTICS
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
              Revenue Analytics
            </h1>
            <p className="mt-1 text-[13px] text-slate-400">
              Track platform revenue, payment sources, and operational performance.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <ModeMenu mode={mode} onChange={(m) => m !== mode && setMode(m)} />
            {mode !== '7d' && mode !== 'years' && (
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

        <div className="ra-update"><span>{loading ? 'Updating...' : updatedAt ? `Last updated: ${updatedAt.toLocaleString('en-GB', {timeZone: 'Asia/Ho_Chi_Minh'})} ICT` : 'Not updated'}</span><span>All amounts are in VND</span></div>
        {error && (
          <div className="mb-5 flex flex-col gap-3 rounded-lg border-l-2 border-amber-400 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-100 sm:flex-row sm:items-center">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-300" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <RevenueSkeleton />
        ) : data ? (
          <div className="ra-content">
            <KPIStrip summary={summary} reduceMotion={reduceMotion} />
            <details className="ra-basis"><summary>Reporting basis &amp; data coverage - Legacy renewal totals may be incomplete</summary><p>Booking and service revenue use completed bookings, net of recorded refunds. Refunds follow the booking completion period, not the refund transaction date. Packages include paid purchases and supported renewals; legacy renewal coverage is incomplete and purchases use record creation dates. Transfer fees include completed wallet fee records. Walk-in parking and violation income are outside this report. Prior-period data and transaction records are unavailable.</p></details>
            {report.issues.length > 0 && <div className="ra-integrity" role="status">{report.issues.map((issue) => <p key={issue}>{issue}</p>)}</div>}
            <div className="ra-row ra-primary">
              <RevenueTrendChart trend={trend} granularity={granularity} reduceMotion={reduceMotion} />
              <RevenueBySourceSection summary={summary} reduceMotion={reduceMotion} />
            </div>
            <div className="ra-row ra-secondary">
              <PackageValueSection packageBreakdown={packageBreakdown} reduceMotion={reduceMotion} />
              <VehicleTrafficSection traffic={traffic} trafficSummary={trafficSummary} granularity={trafficGranularity} reduceMotion={reduceMotion} />
            </div>
            <div className="ra-row ra-bottom">
              <StatusDistributionSection statusDistribution={statusDistribution} reduceMotion={reduceMotion} />
              <RecentRevenueTransactions />
            </div>
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
      className="ra-kpis grid grid-cols-2 gap-y-4 md:grid-cols-3 xl:grid-cols-6"
    >
      {metrics.map((metric) => (
        <div key={metric.label} className="flex items-center gap-3 border-r border-white/[0.04] px-2 last:border-0">
          <div className={`flex shrink-0 items-center justify-center ${metric.colorClass}`}>
            <metric.icon size={16} strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">
              {metric.label}
            </p>
            <p className="admin-type-kpi admin-type-kpi-compact mt-0.5 text-[18px] font-black leading-tight tracking-tight text-white">
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
  const [viewMode, setViewMode] = useState('total');
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const points = trend || [];
  const keys = viewMode === 'total' ? ['totalRevenue'] : Object.keys(SOURCE_COLORS);
  const width = 720; const height = 310;
  const pad = {left: 64, right: 16, top: 20, bottom: 36};
  const plotWidth = width - pad.left - pad.right; const plotHeight = height - pad.top - pad.bottom;
  const band = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.min(64, band * .7);
  const max = Math.max(1, ...points.map((point) => keys.reduce((sum, key) => sum + safe(point[key]), 0))) * 1.1;
  const x = (i) => pad.left + band * (i + .5);
  const y = (value) => pad.top + plotHeight * (1 - value / max);
  const active = hoveredIndex !== null ? points[hoveredIndex] : null;
  const tooltipKeys = viewMode === 'total' ? ['totalRevenue'] : [...Object.keys(SOURCE_COLORS), 'refunds', 'totalRevenue'];
  const tooltipDate = active && /^\d{4}-\d{2}-\d{2}$/.test(active.period) ? new Date(`${active.period}T00:00:00Z`).toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric', timeZone:'UTC'}) : active?.period;
  const hasActivity = points.some((point) => keys.some((key) => safe(point[key]) > 0));
  return <section className="ra-trend">
    <div className="ra-section-heading"><div><h2><BarChart3 size={20} />Revenue Trend</h2><p>Total revenue over the selected period.</p></div>
      <div className="ra-switch" aria-label="Revenue chart view">
        <button type="button" aria-pressed={viewMode === 'total'} onClick={() => { setViewMode('total'); setHoveredIndex(null); }}>Total</button>
        <button type="button" aria-pressed={viewMode === 'bySource'} onClick={() => { setViewMode('bySource'); setHoveredIndex(null); }}>By Source</button>
      </div>
    </div>
    {trend === null ? <EmptyState text="Revenue trend unavailable: the reporting data is missing or does not reconcile." /> : hasActivity ? <div className="ra-chart-scroll">
      <svg className="ra-revenue-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={granularity === 'year' ? 'Annual revenue bar chart' : 'Revenue bar chart'}>
        <defs>{keys.map((key) => <linearGradient key={key} id={`ra-revenue-${key}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={key === 'totalRevenue' ? '#FFE894' : SOURCE_COLORS[key]} stopOpacity="1" />
          <stop offset="15%" stopColor={key === 'totalRevenue' ? '#F5C84C' : SOURCE_COLORS[key]} stopOpacity=".95" />
          <stop offset="100%" stopColor={key === 'totalRevenue' ? '#B88622' : SOURCE_COLORS[key]} stopOpacity=".18" />
        </linearGradient>)}</defs>
        {[0, .333, .666, 1].map((ratio) => <g key={ratio}>
          <line x1={pad.left} x2={width-pad.right} y1={pad.top+plotHeight*ratio} y2={pad.top+plotHeight*ratio} stroke="#24313A" strokeWidth="1" />
          <text x={pad.left-10} y={pad.top+plotHeight*ratio+4} textAnchor="end" fill="#9AADC0" fontSize="12">{formatAxisCurrency(max*(1-ratio))}</text>
        </g>)}
        {points.map((point,i) => <g key={point.period} className={hoveredIndex === i ? 'ra-trend-active' : undefined}>
          {keys.map((key,j) => {
            const amount = safe(point[key]);
            const base = keys.slice(0,j).reduce((sum, source) => sum + safe(point[source]), 0);
            const top = y(base + amount);
            return amount > 0 ? <g key={key}>
              <rect data-series={key} data-amount={amount} x={x(i)-barWidth/2} y={top} width={barWidth} height={y(base)-top} rx={viewMode === 'total' ? 3 : 0} fill={`url(#ra-revenue-${key})`} opacity={hoveredIndex===null || hoveredIndex===i ? 1 : .55}><title>{`${point.period} - ${SOURCE_LABELS[key] || 'Total'}: ${formatCurrency(amount)}`}</title></rect>
              <line x1={x(i)-barWidth/2+2} x2={x(i)+barWidth/2-2} y1={top+1} y2={top+1} stroke={key==='totalRevenue' ? '#FFF0B0' : SOURCE_COLORS[key]} opacity=".7" />
            </g> : null;
          })}
          {(points.length<=8 || i===0 || i===points.length-1 || i%Math.ceil(points.length/6)===0) && <text x={x(i)} y={height-10} fill="#9AADC0" textAnchor="middle" fontSize="12">{formatPeriodLabel(point.period,granularity)}</text>}
          <rect x={x(i)-band/2} y={pad.top} width={band} height={plotHeight} fill="transparent" tabIndex={0} role="img" aria-label={`${point.period}: ${formatCurrency(point.totalRevenue)}`} onMouseEnter={() => setHoveredIndex(i)} onMouseLeave={() => setHoveredIndex(null)} onFocus={() => setHoveredIndex(i)} onBlur={() => setHoveredIndex(null)} onKeyDown={(event) => {if(event.key==='Escape') setHoveredIndex(null);}} />
        </g>)}
        {active && <foreignObject x={Math.min(width-300,Math.max(pad.left,x(hoveredIndex)-140))} y={pad.top} width="285" height={viewMode === 'total' ? 100 : 245} pointerEvents="none"><div className="ra-tooltip" role="tooltip"><strong>{tooltipDate}</strong>{tooltipKeys.map((key) => <div key={key}><span>{SOURCE_LABELS[key] || (key==='refunds' ? 'Refunds (already deducted)' : 'Total Revenue')}</span><b>{formatCurrency(active[key])}</b></div>)}</div></foreignObject>}
      </svg>
    </div> : <EmptyState text="No revenue recorded in this period." />}
    {viewMode === 'bySource' && <div className="ra-chart-legend ra-trend-legend" aria-label="Revenue sources">{Object.keys(SOURCE_COLORS).map((key) => <span key={key}><i style={{background:SOURCE_COLORS[key]}} />{SOURCE_LABELS[key]}</span>)}</div>}
    <span className="sr-only">{reduceMotion ? 'Reduced motion enabled.' : ''}</span>
  </section>;
}

/* ── Revenue by Source ─────────────────────────────────────────────────── */

function RevenueBySourceSection({ summary }) {
  const total = safe(summary.sourceCompositionTotal);
  const sources = Object.keys(SOURCE_COLORS);
  const valid = total !== null && sources.every((key) => safe(summary[key]) !== null);

  return <section className="ra-sources"><div className="ra-section-heading"><div><h2><BarChart3 size={20} />Revenue by Source</h2><p>Same selected period; refunds already deducted from booking/service.</p></div></div>
    {valid && total > 0 ? <div className="ra-donut-layout"><div className="ra-donut">
      <svg viewBox="0 0 200 200" role="img" aria-label="Revenue composition"><circle cx="100" cy="100" r="78" fill="none" stroke="#16212A" strokeWidth="26" />
        {sources.map((key,index) => {const length=Number(summary[key])/total*100; const start=sources.slice(0,index).reduce((sum,item)=>sum+Number(summary[item])/total*100,0); return length>0 ? <circle key={key} cx="100" cy="100" r="78" fill="none" stroke={SOURCE_COLORS[key]} strokeWidth="26" pathLength="100" strokeDasharray={`${length} ${100-length}`} strokeDashoffset={-start} transform="rotate(-90 100 100)"><title>{`${SOURCE_LABELS[key]}: ${formatCurrency(summary[key])}`}</title></circle> : null;})}
      </svg><div><strong>{formatNumber(total)}</strong><span>VND</span><small>Total Revenue</small></div>
    </div><div className="ra-source-legend">{sources.map((key) => <div key={key}><span><i style={{background:SOURCE_COLORS[key]}} />{SOURCE_LABELS[key]}</span><span>{pct(summary[key],total).toFixed(1)}%</span><b>{formatCurrency(summary[key])}</b></div>)}</div></div> : <EmptyState text={valid ? 'No revenue recorded in this period.' : 'Revenue composition unavailable.'} />}
  </section>;
}

/* ── Vehicle Traffic ──────────────────────────────────────────────────── */

function VehicleTrafficSection({ traffic, trafficSummary, granularity }) {
  const [activePeriod, setActivePeriod] = useState(null);
  const valid = Array.isArray(traffic) && traffic.every((point) => point.period && ['entries','exits'].every((key) => safe(point[key]) !== null && Number.isInteger(Number(point[key]))));
  const points = valid ? traffic : [];
  const maxTraffic = Math.max(...points.flatMap((point) => [safe(point.entries),safe(point.exits)]),1);
  const width=640; const height=230; const pad={left:36,right:12,top:14,bottom:32};
  const band=(width-pad.left-pad.right)/Math.max(points.length,1); const bar=Math.min(22,band*.3);
  const y=(value)=>pad.top+(height-pad.top-pad.bottom)*(1-value/maxTraffic);
  const hasTraffic=points.some((point)=>point.entries>0 || point.exits>0);
  const activeIndex = points.findIndex((point) => point.period === activePeriod);
  const activePoint = points[activeIndex];
  return <section className="ra-traffic"><div className="ra-section-heading"><div><h2><WalletCards size={20} />Vehicle Traffic</h2><p>Entry/exit events, not unique vehicles. Parked is the current snapshot.</p></div></div>
    <div className="ra-traffic-summary"><span>Entries <b>{formatNumber(trafficSummary.totalEntries)}</b></span><span>Exits <b>{formatNumber(trafficSummary.totalExits)}</b></span><span>Parked now <b>{formatNumber(trafficSummary.currentlyParked)}</b></span></div>
    {valid && hasTraffic ? <div className="ra-chart-scroll"><svg viewBox={`0 0 ${width} ${height}`} className="ra-traffic-chart" role="img" aria-label="Vehicle traffic chart">
      <defs>{[['entries','#34D399'],['exits','#FB7185']].map(([key,color])=><linearGradient key={key} id={`ra-traffic-${key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} /><stop offset="100%" stopColor={color} stopOpacity=".25" /></linearGradient>)}</defs>
      {[0,.5,1].map((ratio)=><g key={ratio}><line x1={pad.left} x2={width-pad.right} y1={y(maxTraffic*ratio)} y2={y(maxTraffic*ratio)} stroke="#24313A" /><text x={pad.left-6} y={y(maxTraffic*ratio)+4} fill="#9AADC0" textAnchor="end" fontSize="11">{formatNumber(Math.round(maxTraffic*ratio))}</text></g>)}
      {points.map((point, i) => {
        const center = pad.left + band * (i + .5);
        return <g key={point.period}>
          {['entries', 'exits'].map((key, j) => <rect key={key} data-series={key} data-count={point[key]} x={center + (j === 0 ? -bar - 1 : 1)} y={y(point[key])} width={bar} height={y(0) - y(point[key])} rx="2" fill={`url(#ra-traffic-${key})`} opacity={activePoint && activeIndex !== i ? .45 : 1} />)}
          {(points.length <= 7 || i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 5) === 0) && <text x={center} y={height - 8} textAnchor="middle" fill="#9AADC0" fontSize="11">{formatPeriodLabel(point.period, granularity)}</text>}
          <path d={`M ${center-band/2} ${pad.top} h ${band} v ${height-pad.top-pad.bottom} h ${-band} Z`} fill="transparent" tabIndex={0} role="img" aria-label={`${point.period}: Entries: ${formatNumber(point.entries)}, Exits: ${formatNumber(point.exits)}`} onPointerEnter={() => setActivePeriod(point.period)} onPointerLeave={() => setActivePeriod(null)} onFocus={() => setActivePeriod(point.period)} onBlur={() => setActivePeriod(null)} onKeyDown={(event) => { if (event.key === 'Escape') setActivePeriod(null); }} />
        </g>;
      })}
      {activePoint && <foreignObject x={Math.min(width - 222, Math.max(pad.left, pad.left + band * (activeIndex + .5) - 105))} y={pad.top + 4} width="210" height="130" pointerEvents="none"><div className="ra-tooltip ra-traffic-tooltip" role="tooltip"><strong>{activePoint.period}</strong><div><span>Entries</span><b style={{color:'#34D399'}}>{formatNumber(activePoint.entries)}</b></div><div><span>Exits</span><b style={{color:'#FB7185'}}>{formatNumber(activePoint.exits)}</b></div></div></foreignObject>}
    </svg></div> : <EmptyState text={valid ? 'No vehicle activity.' : 'Vehicle traffic unavailable.'} />}
    <div className="ra-chart-legend"><span><i style={{background:'#34D399'}} />Entries</span><span><i style={{background:'#FB7185'}} />Exits</span></div>
  </section>;
}

/* ── Status Distribution ──────────────────────────────────────────────── */

function StatusDistributionSection({ statusDistribution, reduceMotion }) {
  const statusRows = statusDistribution?.byStatus || [];
  const valid = statusDistribution && safe(statusDistribution.totalBookings) !== null && Array.isArray(statusDistribution.byStatus) && statusRows.every((row)=>safe(row.count)!==null) && statusRows.reduce((sum,row)=>sum+Number(row.count),0)===Number(statusDistribution.totalBookings);
  const totalBookings = safe(statusDistribution?.totalBookings);
  const size = 130; // COMPACT
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;


  return (
    <motion.section initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}>
      <div className="mb-5">
        <h3 className="text-[16px] font-bold text-white">Status Distribution</h3>
        <p className="mt-0.5 text-[12px] text-slate-400">Current status of bookings scheduled to start in the selected period.</p>
      </div>
      {valid && statusRows.length > 0 && totalBookings > 0 ? (
        <div className="flex flex-row items-center gap-8">
          <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
              <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={strokeWidth} />
              {statusRows.map((row, index) => {
                const ratio = safe(row.count) / totalBookings;
                if (ratio === 0) return null;
                const dashArray = `${ratio * circumference} ${circumference}`;
                const dashOffset = -statusRows.slice(0, index).reduce((sum, item) => sum + Number(item.count) / totalBookings * circumference, 0);
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
        <EmptyState text={valid ? "No booking activity." : "Booking status distribution unavailable."} />
      )}
    </motion.section>
  );
}

/* ── Package Value ────────────────────────────────────────────────────── */

function PackageValueSection({ packageBreakdown }) {
  const rows = packageBreakdown ? [...packageBreakdown].sort((a,b)=>Number(b.totalAmount)-Number(a.totalAmount)) : null;
  const total = rows?.reduce((sum,row)=>sum+Number(row.totalAmount),0) || 0;
  return <section className="ra-packages"><div className="ra-section-heading"><div><h2><Crown size={20} />Value by Package</h2><p>Paid purchases and supported renewals in the selected period.</p></div></div>
    {rows?.length ? <div className="ra-table-scroll"><table><thead><tr>{['#','Package Name','Type','Purchases','Renewals','Revenue','Share'].map((label)=><th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row,index)=>{const share=total>0?Number(row.totalAmount)/total*100:0; return <tr key={row.packageId || `${row.packageName}-${index}`}><td>{index+1}</td><td><strong>{row.packageName || 'Archived package'}</strong>{!row.isActive && <small>Archived</small>}</td><td>{row.packageType || 'Unavailable'}</td><td>{formatNumber(row.purchaseCount)}</td><td>{formatNumber(row.renewalCount)}</td><td>{formatCurrency(row.totalAmount)}</td><td><span>{share.toFixed(1)}%</span><div className="ra-share-track"><i style={{width:`${share}%`}} /></div></td></tr>;})}</tbody></table></div> : <EmptyState text={rows ? 'No package transactions.' : 'Package breakdown unavailable: reporting attribution is missing or does not reconcile.'} />}
  </section>;
}

function RecentRevenueTransactions() {
  return <section className="ra-transactions"><div className="ra-section-heading"><div><h2><WalletCards size={20} />Recent Revenue Transactions</h2><p>Individual payment records are not provided by the current reporting API.</p></div></div><div className="ra-table-scroll"><table><thead><tr>{['Date & Time','Type','Reference','Description','Amount','Status','Payment Method'].map((label)=><th key={label}>{label}</th>)}</tr></thead><tbody><tr><td colSpan={7}>Unavailable - no transaction records returned. Aggregate totals cannot be converted into individual payments.</td></tr></tbody></table></div></section>;
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
