import { useEffect, useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, Loader2, AlertCircle, Save, CheckCircle2, RotateCcw, Clock3 } from 'lucide-react';
import AdminSelect from '../../components/Admin/AdminSelect';

const currencyFormatter = new Intl.NumberFormat('vi-VN');

const formatCurrency = (value = 0) => `${currencyFormatter.format(Number(value) || 0)} VND`;

const serializeConfig = (timeBlocks, caps) => JSON.stringify({ timeBlocks, caps });

const formatHour = (hour) => {
  const value = Number(hour) || 0;
  return value === 24 ? '24:00' : `${value.toString().padStart(2, '0')}:00`;
};

const startHourOptions = Array.from({ length: 24 }).map((_, index) => ({
  value: index,
  label: formatHour(index),
}));

const endHourOptions = Array.from({ length: 25 }).map((_, index) => ({
  value: index,
  label: index === 24 ? '24:00' : formatHour(index),
}));

const numberNoSpinnerClass =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

const getDuration = (startHour, endHour) => {
  const start = Number(startHour);
  const end = Number(endHour);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return 0;
  return start < end ? end - start : (24 - start) + end;
};

const getRowError = (block) => {
  if (block.startHour < 0 || block.startHour > 23 || block.endHour < 0 || block.endHour > 24) {
    return 'Hours must be between 0 and 24.';
  }
  if (block.price === '' || block.price < 0) {
    return 'Price must be a valid number and cannot be negative.';
  }
  if (block.startHour === block.endHour) {
    return 'Start and end time cannot be identical.';
  }
  return '';
};

const getScheduleStatus = (timeBlocks) => {
  if (!timeBlocks.length) {
    return {
      tone: 'warning',
      label: 'Schedule coverage incomplete.',
      detail: 'No time blocks configured.',
    };
  }

  const hours = new Array(24).fill(false);
  for (const block of timeBlocks) {
    const start = Number(block.startHour);
    const end = Number(block.endHour);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) continue;

    const markHour = (hour) => {
      if (hours[hour]) {
        throw new Error(`Overlap detected at ${formatHour(hour)}`);
      }
      hours[hour] = true;
    };

    try {
      if (start < end) {
        for (let hour = start; hour < end; hour++) markHour(hour);
      } else {
        for (let hour = start; hour < 24; hour++) markHour(hour);
        for (let hour = 0; hour < end; hour++) markHour(hour);
      }
    } catch (error) {
      return {
        tone: 'danger',
        label: 'Schedule coverage incomplete.',
        detail: error.message,
      };
    }
  }

  const missingHour = hours.findIndex((covered) => !covered);
  if (missingHour !== -1) {
    return {
      tone: 'warning',
      label: 'Schedule coverage incomplete.',
      detail: `Gap detected around ${formatHour(missingHour)}`,
    };
  }

  return {
    tone: 'success',
    label: 'Full 24-hour schedule covered.',
    detail: 'No gaps or overlaps detected.',
  };
};

const getTimelineSegments = (timeBlocks) => {
  const colors = ['bg-yellow-400/85', 'bg-yellow-300/70', 'bg-yellow-200/60', 'bg-amber-400/70', 'bg-orange-300/65'];
  return timeBlocks.flatMap((block, index) => {
    const start = Number(block.startHour);
    const end = Number(block.endHour);
    const price = Number(block.price) || 0;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return [];

    const base = {
      id: `${index}-${start}-${end}`,
      label: `${formatHour(start)}-${formatHour(end)}`,
      price,
      color: colors[index % colors.length],
      sourceIndex: index,
    };

    if (start < end) {
      return [{ ...base, left: (start / 24) * 100, width: ((end - start) / 24) * 100 }];
    }

    return [
      { ...base, id: `${base.id}-late`, left: (start / 24) * 100, width: ((24 - start) / 24) * 100 },
      { ...base, id: `${base.id}-early`, left: 0, width: (end / 24) * 100 },
    ];
  });
};

function PricingHeader({ status }) {
  return (
    <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-yellow-300">
          <Edit2 size={12} /> Pricing
        </div>
        <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Pricing Management</h1>
        <p className="mt-1 text-sm font-medium text-blue-100/65">Configure time blocks and price caps for parking sessions.</p>
      </div>
      <div className={`group inline-flex h-9 w-fit items-center gap-2 rounded-full border px-3 text-xs font-black transition hover:shadow-[0_0_22px_rgba(34,197,94,0.14)] ${
        status.tone === 'success'
          ? 'border-green-500/20 bg-green-500/10 text-green-300'
          : status.tone === 'danger'
            ? 'border-red-500/20 bg-red-500/10 text-red-300'
            : 'border-yellow-500/20 bg-yellow-500/10 text-yellow-300'
      }`}>
        {status.tone === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
        {status.label}
      </div>
    </div>
  );
}

function PricingScheduleTimeline({ timeBlocks, status }) {
  const segments = getTimelineSegments(timeBlocks);

  return (
    <section className="relative mb-8 border-y border-white/10 py-6">
      <style>{`
        @keyframes pricing-sweep {
          0% { transform: translateX(-120%); opacity: 0; }
          20% { opacity: 0.8; }
          100% { transform: translateX(220%); opacity: 0; }
        }
        @keyframes pricing-segment-in {
          from { transform: scaleX(0.35); opacity: 0; }
          to { transform: scaleX(1); opacity: 1; }
        }
        @keyframes pricing-save-in {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pricing-success-pulse {
          0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.18); }
          100% { box-shadow: 0 0 0 14px rgba(34,197,94,0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .pricing-sweep, .pricing-segment, .pricing-save-bar, .pricing-success-pulse {
            animation: none !important;
            transform: none !important;
          }
        }
      `}</style>
      <div className="pointer-events-none absolute right-0 top-0 h-40 w-72 rounded-full bg-yellow-500/5 blur-3xl" />
      <div className="relative">
        <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-white">24-Hour Pricing Schedule</h2>
            <p className="text-sm font-medium text-blue-100/60">Read-only timeline generated from current time blocks.</p>
          </div>
          <span className="text-xs font-bold uppercase tracking-wide text-blue-100/50">00:00 - 24:00</span>
        </div>

        <div className="mb-2 grid grid-cols-5 text-xs font-bold text-blue-100/50">
          <span>00:00</span>
          <span className="text-center">06:00</span>
          <span className="text-center">12:00</span>
          <span className="text-center">18:00</span>
          <span className="text-right">24:00</span>
        </div>
        <div className="relative h-14 overflow-hidden rounded-xl border border-white/10 bg-white/[0.035]">
          <div className="pricing-sweep pointer-events-none absolute inset-y-0 left-0 z-20 w-1/3 bg-gradient-to-r from-transparent via-yellow-200/25 to-transparent blur-sm motion-safe:animate-[pricing-sweep_900ms_ease-out_250ms_both]" />
          <div className="absolute inset-y-0 left-1/4 w-px bg-white/10" />
          <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
          <div className="absolute inset-y-0 left-3/4 w-px bg-white/10" />
          {segments.map((segment) => (
            <div
              key={segment.id}
              className={`pricing-segment absolute top-2 flex h-10 min-w-2 origin-left items-center justify-center overflow-hidden rounded-lg px-2 text-[11px] font-black text-[#090909] transition hover:brightness-125 motion-safe:animate-[pricing-segment-in_520ms_ease-out_both] ${segment.color}`}
              style={{ left: `${segment.left}%`, width: `${segment.width}%`, animationDelay: `${segment.sourceIndex * 80}ms` }}
              title={`Block ${segment.sourceIndex + 1}: ${segment.label}, ${formatCurrency(segment.price)}`}
            >
              {segment.width > 10 ? formatCurrency(segment.price) : ''}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-blue-100/60">
          {timeBlocks.map((block, index) => (
            <span key={`${block.startHour}-${block.endHour}-${index}`}>
              {String(index + 1).padStart(2, '0')} · {formatHour(block.startHour)}-{formatHour(block.endHour)} · {formatCurrency(block.price)}
            </span>
          ))}
        </div>
        {status.tone !== 'success' && (
          <p className="mt-3 text-sm font-semibold text-yellow-300">{status.detail}</p>
        )}
      </div>
    </section>
  );
}

function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-xl font-black text-white">{title}</h2>
        {subtitle && <p className="mt-1 text-sm font-medium text-blue-100/60">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function TimeBlockRow({ block, index, onChange, onRemove }) {
  const rowError = getRowError(block);
  const duration = getDuration(block.startHour, block.endHour);
  const inputClass = 'w-full bg-[#171717] border border-white/10 rounded-xl px-3 py-2.5 text-sm font-bold text-white outline-none transition duration-200 focus:-translate-y-0.5 focus:border-gold focus:ring-1 focus:ring-gold/50 focus:shadow-[0_10px_24px_rgba(245,197,66,0.08)] motion-reduce:transition-none motion-reduce:transform-none';

  return (
    <div className="group relative grid gap-3 border-t border-white/10 py-4 pl-3 transition duration-200 hover:bg-white/[0.02] lg:grid-cols-[56px_minmax(120px,1fr)_minmax(120px,1fr)_96px_minmax(150px,1fr)_48px] lg:items-center">
      <span className="absolute left-0 top-4 h-[calc(100%-32px)] w-0.5 origin-top scale-y-0 rounded-full bg-gold transition duration-200 group-hover:scale-y-100 motion-reduce:transition-none" />
      <div className="flex items-center justify-between lg:block">
        <span className="font-mono text-sm font-black text-blue-100/50">{String(index + 1).padStart(2, '0')}</span>
        <button
          onClick={() => onRemove(index)}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-blue-100/45 transition duration-200 hover:bg-red-950/70 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-400/50 lg:hidden [&_svg]:transition [&_svg]:duration-200 hover:[&_svg]:-rotate-6 motion-reduce:transition-none"
          title={`Delete time block ${index + 1}`}
          aria-label={`Delete time block ${index + 1}`}
        >
          <Trash2 size={17} />
        </button>
      </div>

      <label>
        <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-blue-100/55 lg:hidden">START TIME</span>
        <AdminSelect
          value={Number(block.startHour)}
          onChange={(nextValue) => onChange(index, 'startHour', nextValue)}
          options={startHourOptions}
          icon={Clock3}
          className="w-full"
          visibleItems={7}
          ariaLabel={`Select start time for block ${index + 1}`}
        />
      </label>

      <label>
        <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-blue-100/55 lg:hidden">END TIME</span>
        <AdminSelect
          value={Number(block.endHour)}
          onChange={(nextValue) => onChange(index, 'endHour', nextValue)}
          options={endHourOptions}
          icon={Clock3}
          className="w-full"
          align="right"
          visibleItems={7}
          ariaLabel={`Select end time for block ${index + 1}`}
        />
      </label>

      <div>
        <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-blue-100/55 lg:hidden">DURATION</span>
        <p className="font-mono text-sm font-black text-white">{duration > 0 ? `${duration}h` : '-'}</p>
      </div>

      <label>
        <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-blue-100/55 lg:hidden">RATE (VND)</span>
        <div className="relative">
          <input
            type="number"
            min="0"
            step="1000"
            value={block.price}
            onChange={(e) => onChange(index, 'price', e.target.value)}
            className={`${inputClass} ${numberNoSpinnerClass} pr-14 font-mono`}
            placeholder="0"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-black text-blue-100/60">VND</span>
        </div>
      </label>

      <button
        onClick={() => onRemove(index)}
        className="hidden h-10 w-10 items-center justify-center rounded-xl text-blue-100/45 transition duration-200 hover:bg-red-950/70 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-400/50 lg:flex [&_svg]:transition [&_svg]:duration-200 hover:[&_svg]:-rotate-6 motion-reduce:transition-none"
        title={`Delete time block ${index + 1}`}
        aria-label={`Delete time block ${index + 1}`}
      >
        <Trash2 size={17} />
      </button>

      {rowError && (
        <p className="text-sm font-semibold text-red-300 lg:col-span-6">{rowError}</p>
      )}
    </div>
  );
}

function TimeBlockEditor({ timeBlocks, onAdd, onChange, onRemove }) {
  return (
    <section className="mb-8">
      <SectionHeader
        title="Time Blocks"
        subtitle="Set the hourly pricing schedule for a full parking day."
        action={(
          <button onClick={onAdd} className="group inline-flex items-center gap-2 rounded-xl border border-yellow-500/30 px-3 py-2 text-sm font-black text-yellow-300 transition duration-200 hover:bg-yellow-500/10 active:scale-[0.98] motion-reduce:transition-none motion-reduce:transform-none">
            <Plus size={16} className="transition duration-200 group-hover:rotate-90 motion-reduce:transition-none motion-reduce:transform-none" /> Add time block
          </button>
        )}
      />

      <div className="hidden border-y border-white/10 py-3 text-[10px] font-black uppercase tracking-widest text-blue-100/55 lg:grid lg:grid-cols-[56px_minmax(120px,1fr)_minmax(120px,1fr)_96px_minmax(150px,1fr)_48px]">
        <span>#</span>
        <span>START TIME</span>
        <span>END TIME</span>
        <span>DURATION</span>
        <span>RATE (VND)</span>
        <span>ACTION</span>
      </div>

      {timeBlocks.map((block, index) => (
        <TimeBlockRow key={index} block={block} index={index} onChange={onChange} onRemove={onRemove} />
      ))}

      {timeBlocks.length === 0 && (
        <div className="border-y border-dashed border-white/10 py-10 text-center text-sm font-medium text-blue-100/50">
          <AlertCircle size={24} className="mx-auto mb-2 opacity-50" />
          No time blocks configured. Add a time block to set pricing schedules.
        </div>
      )}
    </section>
  );
}

function PriceCapsSection({ caps, setCaps }) {
  const inputClass = `w-full bg-[#171717] border border-white/10 rounded-xl pl-4 pr-14 py-3 text-sm font-bold text-white outline-none transition duration-200 focus:-translate-y-0.5 focus:border-gold focus:ring-1 focus:ring-gold/50 focus:shadow-[0_10px_24px_rgba(245,197,66,0.08)] font-mono motion-reduce:transition-none motion-reduce:transform-none ${numberNoSpinnerClass}`;

  return (
    <section className="mb-8 border-t border-white/10 pt-6">
      <SectionHeader title="Price Caps" subtitle="Maximum charge limits for long parking sessions." />
      <div className="grid gap-6 md:grid-cols-2 md:divide-x md:divide-white/10">
        <div className="md:pr-6">
          <label className="block text-[10px] font-black uppercase tracking-widest text-blue-100/55">12-HOUR MAXIMUM</label>
          <div className="relative mt-2">
            <input
              type="number"
              min="0"
              step="1000"
              value={caps.cap12h}
              onChange={(e) => setCaps({ ...caps, cap12h: e.target.value === '' ? '' : Number(e.target.value) })}
              className={inputClass}
            />
            <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs font-black text-blue-100/60">VND</span>
          </div>
          <p className="mt-2 text-sm font-medium text-blue-100/60">Maximum charge for a continuous 12-hour stay.</p>
        </div>

        <div className="md:pl-6">
          <label className="block text-[10px] font-black uppercase tracking-widest text-blue-100/55">24-HOUR MAXIMUM</label>
          <div className="relative mt-2">
            <input
              type="number"
              min="0"
              step="1000"
              value={caps.cap24h}
              onChange={(e) => setCaps({ ...caps, cap24h: e.target.value === '' ? '' : Number(e.target.value) })}
              className={inputClass}
            />
            <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs font-black text-blue-100/60">VND</span>
          </div>
          <p className="mt-2 text-sm font-medium text-blue-100/60">Maximum charge for a continuous 24-hour stay.</p>
        </div>
      </div>
    </section>
  );
}

function PricingSummary({ timeBlocks, caps, status }) {
  const prices = timeBlocks.map((block) => Number(block.price)).filter((price) => Number.isFinite(price));
  const lowest = prices.length ? Math.min(...prices) : 0;
  const highest = prices.length ? Math.max(...prices) : 0;

  return (
    <section className="mb-24 border-t border-white/10 pt-5">
      <h2 className="mb-3 text-lg font-black text-white">Pricing Summary</h2>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-blue-100/65">
        <span>{timeBlocks.length} time blocks</span>
        <span>Lowest rate: <strong className="font-mono text-white">{formatCurrency(lowest)}</strong></span>
        <span>Highest rate: <strong className="font-mono text-white">{formatCurrency(highest)}</strong></span>
        <span>12h cap: <strong className="font-mono text-white">{formatCurrency(caps.cap12h)}</strong></span>
        <span>24h cap: <strong className="font-mono text-white">{formatCurrency(caps.cap24h)}</strong></span>
        <span className={status.tone === 'success' ? 'text-green-300' : status.tone === 'danger' ? 'text-red-300' : 'text-yellow-300'}>{status.label}</span>
      </div>
    </section>
  );
}

function PricingSaveBar({ saving, onSave, onReset, error, success, hasUnsavedChanges }) {
  if (!hasUnsavedChanges && !error && !success && !saving) return null;

  return (
    <div className="pricing-save-bar sticky bottom-0 z-20 -mx-6 border-t border-white/10 bg-[#080808]/90 px-6 py-4 backdrop-blur motion-safe:animate-[pricing-save-in_260ms_ease-out_both] md:-mx-8 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-sm font-semibold">
          {error ? <span className="text-red-300">{error}</span> : success ? <span className="pricing-success-pulse rounded-full text-green-300 motion-safe:animate-[pricing-success-pulse_900ms_ease-out_1]">{success}</span> : <span className="text-yellow-200">You have unsaved changes</span>}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onReset}
            disabled={saving || !hasUnsavedChanges}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-yellow-500/30 px-5 text-sm font-black text-yellow-200 transition hover:bg-yellow-500/10 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none"
          >
            <RotateCcw size={16} /> Reset Changes
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="group inline-flex h-12 min-w-[190px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-yellow-300 via-gold to-yellow-500 px-7 font-black text-[#0B0E17] shadow-lg shadow-gold/20 transition hover:-translate-y-0.5 hover:brightness-105 disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none motion-reduce:transition-none motion-reduce:transform-none"
          >
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} className="transition group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:transform-none" />}
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PricingManagement() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [timeBlocks, setTimeBlocks] = useState([]);
  const [caps, setCaps] = useState({ cap12h: 100000, cap24h: 180000 });
  const [baselineConfig, setBaselineConfig] = useState('');

  const fetchConfig = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError('');
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/admin/pricing-config`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` }
      });
      const data = await res.json();
      if (data.success && data.data) {
        const nextBlocks = data.data.timeBlocks || [];
        const nextCaps = {
          cap12h: data.data.cap12h || 100000,
          cap24h: data.data.cap24h || 180000
        };
        setConfig(data.data);
        setTimeBlocks(nextBlocks);
        setCaps(nextCaps);
        setBaselineConfig(serializeConfig(nextBlocks, nextCaps));
      }
    } catch (err) {
      console.error(err);
      setError('Failed to load pricing config');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchConfig();
  }, []);

  const handleAddTimeBlock = () => {
    setSuccess('');
    setTimeBlocks([...timeBlocks, { startHour: 0, endHour: 0, price: 0 }]);
  };

  const handleRemoveTimeBlock = (index) => {
    setSuccess('');
    const newBlocks = [...timeBlocks];
    newBlocks.splice(index, 1);
    setTimeBlocks(newBlocks);
  };

  const handleTimeBlockChange = (index, field, value) => {
    setSuccess('');
    const newBlocks = [...timeBlocks];
    newBlocks[index][field] = value === '' ? '' : Number(value);
    setTimeBlocks(newBlocks);
  };

  const handleCapsChange = (nextCaps) => {
    setSuccess('');
    setCaps(nextCaps);
  };

  const handleResetChanges = () => {
    if (!baselineConfig) return;
    const parsed = JSON.parse(baselineConfig);
    setTimeBlocks(parsed.timeBlocks);
    setCaps(parsed.caps);
    setError('');
    setSuccess('');
  };

  const handleSave = async () => {
    // Validate
    if (timeBlocks.length === 0) {
      setError('Must have at least one time block.');
      return;
    }
    for (let i = 0; i < timeBlocks.length; i++) {
      const b = timeBlocks[i];
      if (b.startHour < 0 || b.startHour > 23 || b.endHour < 0 || b.endHour > 24) {
        setError('Hours must be between 0 and 24.');
        return;
      }
      if (b.price === '' || b.price < 0) {
        setError('Price must be a valid number and cannot be negative.');
        return;
      }
      if (b.startHour === b.endHour) {
        setError('A time block cannot have the same start and end time.');
        return;
      }
    }

    // Validate coverage of 24 hours (no gaps, no overlaps)
    const hours = new Array(24).fill(false);
    for (let i = 0; i < timeBlocks.length; i++) {
      const b = timeBlocks[i];
      const start = b.startHour;
      const end = b.endHour;

      const markHour = (h) => {
        if (hours[h]) {
          throw new Error(`Overlap detected at hour ${h}:00`);
        }
        hours[h] = true;
      };

      try {
        if (start < end) {
          for (let h = start; h < end; h++) markHour(h);
        } else {
          for (let h = start; h < 24; h++) markHour(h);
          for (let h = 0; h < end; h++) markHour(h);
        }
      } catch (e) {
        setError(e.message);
        return;
      }
    }

    const missingHour = hours.findIndex(h => !h);
    if (missingHour !== -1) {
      setError(`Gap detected in schedule. Time block missing for hour ${missingHour}:00`);
      return;
    }

    if (caps.cap12h === '' || caps.cap12h < 0 || caps.cap24h === '' || caps.cap24h < 0) {
      setError('Price caps must be valid positive numbers.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      setSuccess('');
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/admin/pricing-config`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('accessToken')}` 
        },
        body: JSON.stringify({
          timeBlocks,
          ...caps
        })
      });
      const data = await res.json();
      if (data.success) {
        setSuccess('Pricing configuration updated successfully!');
        await fetchConfig({ silent: true });
      } else {
        setError(data.message || 'Failed to update configuration.');
      }
    } catch (err) {
      console.error(err);
      setError('Network error while saving config.');
    } finally {
      setSaving(false);
    }
  };

  const scheduleStatus = useMemo(() => getScheduleStatus(timeBlocks), [timeBlocks]);
  const hasUnsavedChanges = useMemo(
    () => Boolean(baselineConfig) && serializeConfig(timeBlocks, caps) !== baselineConfig,
    [baselineConfig, caps, timeBlocks]
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full min-h-[calc(100vh-70px)] bg-[#080808]">
        <Loader2 className="animate-spin text-gold w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-70px)] overflow-auto bg-[#080808] px-6 py-7 md:px-8">
      <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:46px_46px]" />
      <div className="mx-auto max-w-7xl">
        <PricingHeader status={scheduleStatus} config={config} />

        <PricingScheduleTimeline timeBlocks={timeBlocks} status={scheduleStatus} />

        <TimeBlockEditor
          timeBlocks={timeBlocks}
          onAdd={handleAddTimeBlock}
          onChange={handleTimeBlockChange}
          onRemove={handleRemoveTimeBlock}
        />

        <PriceCapsSection caps={caps} setCaps={handleCapsChange} />

        <PricingSummary timeBlocks={timeBlocks} caps={caps} status={scheduleStatus} />
      </div>

      <PricingSaveBar
        saving={saving}
        onSave={handleSave}
        onReset={handleResetChanges}
        error={error}
        success={success}
        hasUnsavedChanges={hasUnsavedChanges}
      />
    </div>
  );
}
