import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Clock3, ArrowDown, ArrowUp, ChartNoAxesColumnIncreasing, List, ShieldPlus, Eye, ChevronDown, Plus, SquarePen, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import AdminSelect from '../../components/Admin/AdminSelect';
import { formatCurrency, formatHour, getDuration, getRowError, getTimelineSegments, startHourOptions, endHourOptions, numberNoSpinnerClass } from './pricingDisplay';

function getMetrics(blocks) {
  const prices = blocks.filter((block) => block.price !== '' && Number.isFinite(Number(block.price)) && Number(block.price) >= 0).map((block) => Number(block.price));
  return { count: blocks.length, low: prices.length ? formatCurrency(Math.min(...prices)) : '—', high: prices.length ? formatCurrency(Math.max(...prices)) : '—' };
}

function Coverage({ status }) {
  return <span className={`pricing-coverage pricing-coverage-${status.tone}`}>
    {status.tone === 'success' ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertCircle size={15} aria-hidden="true" />}
    {status.tone === 'success' ? 'Configuration is valid' : status.label}
  </span>;
}

function SectionTitle({ icon: Icon, title, description }) {
  return <div className="pricing-section-title">
    <span className="pricing-section-icon"><Icon size={20} aria-hidden="true" /></span>
    <div><h2>{title}</h2><p>{description}</p></div>
  </div>;
}

export function PricingHeader({ status }) {
  return <header className="pricing-header">
    <div>
      <h1>Pricing Management</h1><p className="pricing-subtitle">Manage time blocks and calendar pricing policies.</p>
    </div><Coverage status={status} />
  </header>;
}

export function PricingOverview({ timeBlocks }) {
  const metrics = getMetrics(timeBlocks);
  const cards = [
    { label: 'Time blocks', value: metrics.count, note: 'Blocks configured for 24 hours', icon: Clock3 },
    { label: 'Lowest block fee', value: metrics.low, note: 'Lowest configured fee per block', icon: ArrowDown },
    { label: 'Highest block fee', value: metrics.high, note: 'Highest configured fee per block', icon: ArrowUp },
  ];
  return <dl className="pricing-metrics">{cards.map(({ label, value, note, icon: Icon }) =>
    <div className="pricing-metric" key={label}>
      <span className="pricing-metric-icon"><Icon size={18} strokeWidth={1.7} aria-hidden="true" /></span>
      <div className="pricing-metric-copy"><dt>{label}</dt><dd>{value}</dd><p>{note}</p></div>
    </div>)}
  </dl>;
}

export function PricingSchedule({ timeBlocks, onSelect }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [focusedSegment, setFocusedSegment] = useState(null);
  const anchorRef = useRef(null);
  const tooltipRef = useRef(null);
  const scheduleRef = useRef(null);
  const segments = getTimelineSegments(timeBlocks).filter((segment) => segment.width > 0);
  const focused = segments.find((segment) => segment.id === focusedSegment);
  const describe = (segment) => `Block ${String(segment.sourceIndex + 1).padStart(2, '0')}: ${segment.label}, ${formatCurrency(segment.price)} per block`;
  const showTooltip = (event, id) => {
    anchorRef.current = event.currentTarget;
    setFocusedSegment(id);
  };
  const leaveTooltip = () => {
    if (document.activeElement !== anchorRef.current) setFocusedSegment(null);
  };

  useLayoutEffect(() => {
    if (!focused) return;
    const positionTooltip = () => {
      const anchor = anchorRef.current;
      const tooltip = tooltipRef.current;
      if (!anchor || !tooltip) return;
      const rect = anchor.getBoundingClientRect();
      const { width, height } = tooltip.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, viewportWidth - width - 12));
      // Prefer above the segment, and never extend into the following editor.
      const scheduleBottom = scheduleRef.current.getBoundingClientRect().bottom;
      const top = Math.min(Math.max(8, rect.top - height - 8), viewportHeight - height - 8, scheduleBottom - height);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      tooltip.style.visibility = rect.bottom <= 0 || rect.top >= viewportHeight ? 'hidden' : 'visible';
    };
    positionTooltip();
    window.addEventListener('resize', positionTooltip);
    window.addEventListener('scroll', positionTooltip, true);
    const observer = new ResizeObserver(positionTooltip);
    observer.observe(tooltipRef.current);
    observer.observe(scheduleRef.current);
    return () => {
      window.removeEventListener('resize', positionTooltip);
      window.removeEventListener('scroll', positionTooltip, true);
      observer.disconnect();
    };
  }, [focused]);

  return <section ref={scheduleRef} className="pricing-schedule">
    <div className="pricing-panel-header">
      <SectionTitle icon={ChartNoAxesColumnIncreasing} title="24-Hour Pricing Schedule" description="Pricing schedule generated from the time blocks below." />
      <button type="button" className="pricing-details-button" aria-expanded={detailsOpen} aria-controls="pricing-schedule-details" onClick={() => setDetailsOpen(!detailsOpen)}><Eye size={14} aria-hidden="true" />{detailsOpen ? 'Hide details' : 'View details'}</button>
    </div>
    <div className="pricing-axis" aria-hidden="true">{[0, 6, 12, 18, 24].map((hour) => <span key={hour} style={{ left: `${hour / 24 * 100}%` }}>{formatHour(hour)}</span>)}</div>
    <div className="pricing-timeline" onMouseLeave={leaveTooltip}>
      {segments.map((segment) => <button type="button" key={segment.id} className={`pricing-segment ${segment.color}`} style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
        aria-label={`Edit ${describe(segment)}`} aria-describedby={focusedSegment === segment.id ? 'pricing-timeline-tooltip' : undefined}
        onFocus={(event) => showTooltip(event, segment.id)} onBlur={() => setFocusedSegment(null)} onMouseEnter={(event) => showTooltip(event, segment.id)} onMouseLeave={leaveTooltip}
        onKeyDown={(event) => { if (event.key === 'Escape') setFocusedSegment(null); }} onClick={() => onSelect(segment.sourceIndex)}>
        <span className={segment.width > 15 ? 'pricing-segment-value' : 'pricing-segment-number'}>{segment.width > 15 ? formatCurrency(segment.price) : String(segment.sourceIndex + 1).padStart(2, '0')}</span>
      </button>)}
    </div>
    {focused && <div ref={tooltipRef} className="pricing-timeline-tooltip" role="tooltip" id="pricing-timeline-tooltip">
      <strong>Block {String(focused.sourceIndex + 1).padStart(2, '0')}</strong>
      <span>{focused.label}</span><span>{formatCurrency(focused.price)} per block</span>
    </div>}
    <ul className="pricing-legend">{timeBlocks.map((block, index) => <li key={index}>
      <button type="button" onClick={() => onSelect(index)} aria-label={`Edit block ${index + 1}`}><span aria-hidden="true" className={`pricing-dot pricing-tone-${index % 5}`} />{String(index + 1).padStart(2, '0')}: {formatHour(block.startHour)}–{formatHour(block.endHour)} · {formatCurrency(block.price)}</button>
    </li>)}</ul>
    <div id="pricing-schedule-details" hidden={!detailsOpen} className="pricing-schedule-details">
      <p>Base schedule · Vietnam time (UTC+7). A flat fee applies to each billable block touched.</p>
      <dl>{timeBlocks.map((block, index) => <div key={index}><dt>Block {String(index + 1).padStart(2, '0')}</dt><dd>{formatHour(block.startHour)}–{formatHour(block.endHour)} · {getDuration(block.startHour, block.endHour)}h{block.startHour > block.endHour ? ' · Overnight' : ''} · {formatCurrency(block.price)} per block</dd></div>)}</dl>
    </div>
  </section>;
}

export function TimeBlockEditor({ timeBlocks, selectedBlock, onAdd, onChange, onRemove }) {
  return <section className="pricing-editor">
    <div className="pricing-panel-header"><SectionTitle icon={List} title="Time blocks" description="Set the pricing schedule for a full parking day." />
      <button type="button" onClick={onAdd} className="pricing-button pricing-primary"><Plus size={16} aria-hidden="true" />Add time block</button>
    </div>
    <div className="pricing-row-head" aria-hidden="true"><span>#</span><span>Start time</span><span>End time</span><span>Duration</span><span>Block fee (VND)</span><span>Action</span></div>
    {timeBlocks.map((block, index) => {
      const error = getRowError(block);
      const duration = getDuration(block.startHour, block.endHour);
      return <div id={`pricing-block-${index}`} tabIndex={-1} aria-label={`Time block ${index + 1}`} key={index} className={`pricing-row ${selectedBlock === index ? 'pricing-row-selected' : ''}`}>
        <span className="pricing-row-number">{String(index + 1).padStart(2, '0')}</span>
        {['startHour', 'endHour'].map((field) => <div className="pricing-time-cell" key={field}><span className="pricing-mobile-label">{field === 'startHour' ? 'Start time' : 'End time'}</span>
          <AdminSelect value={Number(block[field])} onChange={(value) => onChange(index, field, value)} options={field === 'startHour' ? startHourOptions : endHourOptions} icon={Clock3} className="w-full" buttonClassName="pricing-time-button" menuClassName="pricing-time-menu" visibleItems={7} ariaLabel={`${field === 'startHour' ? 'Start' : 'End'} time for block ${index + 1}`} />
        </div>)}
        <div className="pricing-duration"><span className="pricing-mobile-label">Duration</span><strong>{duration > 0 ? `${duration}h` : '—'}</strong>{block.startHour > block.endHour && <small>Overnight</small>}</div>
        <label><span className="pricing-mobile-label">Block fee (VND)</span><div className="pricing-currency-field"><input id={`pricing-fee-${index}`} type="number" min="0" step="1000" value={block.price} onChange={(event) => onChange(index, 'price', event.target.value)} aria-label={`Block fee in VND for block ${index + 1}`} aria-invalid={Boolean(error)} aria-describedby={error ? `pricing-row-error-${index}` : undefined} /><span>VND</span></div></label>
        <div className="pricing-row-actions"><button type="button" className="pricing-edit" onClick={() => document.getElementById(`pricing-fee-${index}`)?.focus()} aria-label={`Edit fee for time block ${index + 1}`} title={`Edit fee for time block ${index + 1}`}><SquarePen size={16} aria-hidden="true" /></button><button type="button" className="pricing-delete" onClick={() => onRemove(index)} aria-label={`Delete time block ${index + 1}`} title={`Delete time block ${index + 1}`}><Trash2 size={16} aria-hidden="true" /></button></div>
        {error && <p id={`pricing-row-error-${index}`} className="pricing-row-error pricing-error">{error}</p>}
      </div>;
    })}
    {!timeBlocks.length && <p className="pricing-empty">No time blocks configured. Add a time block to build the schedule.</p>}
  </section>;
}

export function AdditionalPricingRules({ config }) {
  return <details className="pricing-panel pricing-additional"><summary><SectionTitle icon={ShieldPlus} title="Additional Pricing Rules" description="Day/Night overrides and price caps (if any)." /><ChevronDown size={17} aria-hidden="true" /></summary>
    <div className="pricing-additional-content"><p>Saved settings · Read only</p><dl>
      <div><dt>Up to 12 hours</dt><dd>{formatCurrency(config.cap12h ?? 100000)} cap</dd></div><div><dt>Up to 24 hours</dt><dd>{formatCurrency(config.cap24h ?? 180000)} cap</dd></div>
      {['day', 'night'].map((key) => { const rule = config.dayNightPricing?.[key]; return <div key={key}><dt>{key === 'day' ? 'Day' : 'Night'} override</dt><dd>{rule?.isActive ? `${formatHour(rule.startHour)}–${formatHour((rule.startHour + 12) % 24)} · ${formatCurrency(rule.price)} per block` : 'Disabled'}</dd></div>; })}
    </dl><p>Active overrides replace base blocks in their 12-hour windows. Calendar adjustments apply before caps.</p></div>
  </details>;
}

export function PricingSummary({ timeBlocks, status }) {
  const metrics = getMetrics(timeBlocks);
  return <div className="pricing-summary"><div className="pricing-summary-values"><Clock3 size={15} aria-hidden="true" /><strong>Pricing Summary:</strong><span>{metrics.count} time blocks</span><span>Lowest fee: <b>{metrics.low}</b></span><span>Highest fee: <b>{metrics.high}</b></span></div>
    <div role="status"><Coverage status={status} />{status.tone !== 'success' && <p className="pricing-error">{status.detail}</p>}</div>
  </div>;
}

const weekDays = [
  ['Sun', 0], ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6],
];

function PolicyAdjustmentInput({ value, onChange }) {
  const id = useId();
  const [emptyDirection, setEmptyDirection] = useState('increase');
  const direction = Number(value) === 0 ? emptyDirection : Number(value) < 0 ? 'decrease' : 'increase';
  const magnitude = value === '' ? '' : Math.abs(Number(value));
  const limit = direction === 'decrease' ? 100 : 500;
  const invalid = value === '' || !Number.isFinite(Number(value)) || magnitude > limit;

  return <div className="pricing-policy-adjustment">
    <label htmlFor={`${id}-percentage`}>Price adjustment</label>
    <div className="pricing-policy-adjustment-controls">
      <select aria-label="Price adjustment direction" value={direction} onChange={(event) => {
        const next = event.target.value;
        setEmptyDirection(next);
        onChange(value === '' ? '' : (next === 'decrease' ? -1 : 1) * magnitude);
      }}>
        <option value="increase">Increase</option>
        <option value="decrease">Decrease</option>
      </select>
      <div className="pricing-policy-percent">
        <input id={`${id}-percentage`} aria-label="Adjustment percentage" aria-invalid={invalid}
          aria-describedby={`${id}-help`} type="number" min="0" max={limit} step="any"
          value={magnitude} onChange={(event) => {
            setEmptyDirection(direction);
            onChange(event.target.value === '' ? '' : (direction === 'decrease' ? -1 : 1) * Math.abs(Number(event.target.value)));
          }} className={numberNoSpinnerClass} />
        <span aria-hidden="true">%</span>
      </div>
    </div>
    <p id={`${id}-help`} className={invalid ? 'pricing-error' : 'pricing-policy-help'}>
      {direction === 'decrease' ? 'Maximum decrease: 100%' : 'Maximum increase: 500%'}
    </p>
  </div>;
}

export function PricePolicyEditor({ policies, onAdd, onChange, onRemove }) {
  const toggleValue = (index, field, value) => {
    const current = policies[index][field] || [];
    onChange(index, field, current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]);
  };

  return <section className="pricing-policies" aria-label="Calendar policies">
    <div className="pricing-panel-header">
      <div>
        <h2>Calendar Policies</h2>
        <p className="pricing-policy-description">Highest priority wins; ties favor date range, then month, then weekday.</p>
      </div>
      <button type="button" onClick={onAdd} className="pricing-button pricing-primary">
        <Plus size={16} aria-hidden="true" />Add policy
      </button>
    </div>
    <div className="pricing-policy-list">
      {policies.map((policy, index) => <article key={policy._id || index} className="pricing-policy-card" aria-label={`Policy ${index + 1}`}>
        <header className="pricing-policy-header">
          <label className="pricing-policy-name">
            <span>Policy name</span>
            <input value={policy.name} onChange={(event) => onChange(index, 'name', event.target.value)} placeholder="e.g. Holiday pricing" />
          </label>
          <div className="pricing-policy-actions">
            <button type="button" aria-pressed={policy.isActive} aria-label={`Toggle policy ${policy.name || index + 1}`}
              onClick={() => onChange(index, 'isActive', !policy.isActive)}
              className={`pricing-policy-status ${policy.isActive ? 'is-active' : ''}`}>
              <span aria-hidden="true" />{policy.isActive ? 'Active' : 'Inactive'}
            </button>
            <button type="button" className="pricing-policy-delete" aria-label={`Delete policy ${policy.name || index + 1}`}
              onClick={() => onRemove(index)}><Trash2 size={17} aria-hidden="true" /></button>
          </div>
        </header>
        <div className="pricing-policy-fields">
          <label>Applies by
            <select value={policy.scope} onChange={(event) => onChange(index, 'scope', event.target.value)}>
              <option value="weekday">Day of week</option>
              <option value="month">Month</option>
              <option value="date_range">Holiday / date range</option>
            </select>
          </label>
          <PolicyAdjustmentInput value={policy.adjustmentPercent} onChange={(value) => onChange(index, 'adjustmentPercent', value)} />
          <label className="pricing-policy-priority">Priority
            <input type="number" min="0" max="10000" value={policy.priority} className={numberNoSpinnerClass}
              onChange={(event) => onChange(index, 'priority', event.target.value === '' ? '' : Number(event.target.value))} />
          </label>
        </div>
        {policy.scope === 'weekday' && <fieldset className="pricing-policy-scope">
          <legend>Weekdays</legend>
          <div className="pricing-policy-choices">{weekDays.map(([label, value]) => <button key={value} type="button"
            aria-pressed={Boolean(policy.daysOfWeek?.includes(value))} onClick={() => toggleValue(index, 'daysOfWeek', value)}>{label}</button>)}</div>
        </fieldset>}
        {policy.scope === 'month' && <fieldset className="pricing-policy-scope">
          <legend>Months</legend>
          <div className="pricing-policy-choices">{Array.from({ length: 12 }, (_, month) => month + 1).map((month) => <button key={month} type="button"
            aria-pressed={Boolean(policy.months?.includes(month))} onClick={() => toggleValue(index, 'months', month)}>Month {month}</button>)}</div>
        </fieldset>}
        {policy.scope === 'date_range' && <div className="pricing-policy-dates">
          <label>From date<input type="date" value={policy.startDate || ''} onChange={(event) => onChange(index, 'startDate', event.target.value)} /></label>
          <label>To date<input type="date" value={policy.endDate || ''} onChange={(event) => onChange(index, 'endDate', event.target.value)} /></label>
        </div>}
        <footer className="pricing-policy-footer">
          {policy.adjustmentPercent === '' ? 'Enter a percentage adjustment.' : `${Number(policy.adjustmentPercent) < 0 ? 'Decrease' : 'Increase'} the applicable base fee by ${Math.abs(Number(policy.adjustmentPercent)) || 0}%.`}
        </footer>
      </article>)}
      {policies.length === 0 && <p className="pricing-policy-empty">No calendar policies. The base price applies every day.</p>}
    </div>
  </section>;
}
