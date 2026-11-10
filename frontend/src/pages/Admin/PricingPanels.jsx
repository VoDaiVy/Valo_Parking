import { createPortal } from 'react-dom';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Clock3, ArrowDown, ArrowUp, ChartNoAxesColumnIncreasing, List, ShieldPlus, Eye, ChevronDown, Plus, SquarePen, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import AdminSelect from '../../components/Admin/AdminSelect';
import { formatCurrency, formatHour, getDuration, getRowError, getTimelineSegments, formatSchedulePrice, formatScheduleHour, getTimelineWarning, startHourOptions, endHourOptions, numberNoSpinnerClass } from './pricingDisplay';

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
    <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
  </div>;
}

export function PricingHeader({ status }) {
  return <header className="pricing-header">
    <div>
      <div className="pricing-title-line"><h1>Pricing Management</h1><span className="pricing-manager-badge"><ChartNoAxesColumnIncreasing size={13} aria-hidden="true" />Pricing Manager</span></div><p className="pricing-subtitle">Manage time blocks and calendar pricing policies.</p>
    </div>{status.tone !== 'success' && <Coverage status={status} />}
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
  const warning = getTimelineWarning(timeBlocks);
  const segments = warning.startsWith('Overlapping') || warning.startsWith('Invalid time') ? [] : getTimelineSegments(timeBlocks).filter((segment) => segment.width > 0);
  const tooltipId = useId();
  const focused = segments.find((segment) => segment.id === focusedSegment);
  const describe = (segment) => `Block ${String(segment.sourceIndex + 1).padStart(2, '0')}: ${segment.label}, ${formatSchedulePrice(segment.price)} per block`;
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
      const preferredTop = rect.top >= height + 8 ? rect.top - height - 8 : rect.bottom + 8;
      const top = Math.max(8, Math.min(preferredTop, viewportHeight - height - 8));
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

  useLayoutEffect(() => {
    const schedule = scheduleRef.current;
    const measure = () => {
      schedule.querySelectorAll('.pricing-segment-value').forEach((label) => {
        const textWidth = label.getBoundingClientRect().width;
        label.style.visibility = textWidth <= label.parentElement.clientWidth ? 'visible' : 'hidden';
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(schedule);
    schedule.querySelectorAll('.pricing-segment-value').forEach((label) => observer.observe(label));
    let active = true;
    document.fonts?.ready.then(() => { if (active) measure(); });
    return () => { active = false; observer.disconnect(); };
  }, [timeBlocks]);

  return <section ref={scheduleRef} className="pricing-schedule">
    <div className="pricing-panel-header">
      <SectionTitle icon={ChartNoAxesColumnIncreasing} title="24-Hour Pricing Schedule" />
      <button type="button" className="pricing-details-button" aria-expanded={detailsOpen} aria-controls="pricing-schedule-details" onClick={() => setDetailsOpen(!detailsOpen)}><Eye size={14} aria-hidden="true" />{detailsOpen ? 'Hide details' : 'View details'}</button>
    </div>
    {warning && <p className="pricing-schedule-warning" role="status">{warning}</p>}
    <div className="pricing-axis" aria-hidden="true">{[0, 6, 12, 18, 24].map((hour) => <span key={hour} style={{ left: `${hour / 24 * 100}%` }}>{formatScheduleHour(hour)}</span>)}</div>
    <div className="pricing-timeline" onMouseLeave={leaveTooltip}>
      {segments.map((segment) => <button type="button" key={segment.id} className={`pricing-segment ${segment.color}`} style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
        aria-label={`Edit ${describe(segment)}`} aria-describedby={focusedSegment === segment.id ? tooltipId : undefined}
        onFocus={(event) => showTooltip(event, segment.id)} onBlur={() => setFocusedSegment(null)} onMouseEnter={(event) => showTooltip(event, segment.id)} onMouseLeave={leaveTooltip}
        onKeyDown={(event) => { if (event.key === 'Escape') setFocusedSegment(null); }} onClick={(event) => { showTooltip(event, segment.id); onSelect(segment.sourceIndex); }}>
        <span aria-hidden="true" className="pricing-segment-value">{formatSchedulePrice(segment.price, false)}</span>
      </button>)}
    </div>
    {focused && createPortal(<div ref={tooltipRef} className="pricing-timeline-tooltip" role="tooltip" id={tooltipId}>
      <strong>Block {String(focused.sourceIndex + 1).padStart(2, '0')}</strong>
      <span>{focused.label}</span><span>{formatSchedulePrice(focused.price)} per block</span>
    </div>, document.body)}
    <ul className="pricing-legend">{timeBlocks.map((block, index) => <li key={index}>
      <button type="button" onClick={() => onSelect(index)} aria-label={`Edit block ${index + 1}`}><span aria-hidden="true" className={`pricing-dot pricing-tone-${index % 5}`} /><span>B{String(index + 1).padStart(2, '0')} &middot; {formatScheduleHour(block.startHour)}–{formatScheduleHour(block.endHour)} · {formatSchedulePrice(block.price)}</span></button>
    </li>)}</ul>
    <div id="pricing-schedule-details" hidden={!detailsOpen} className="pricing-schedule-details">
      <p>Base schedule · Vietnam time (UTC+7). A flat fee applies to each billable block touched.</p>
      <dl>{timeBlocks.map((block, index) => <div key={index}><dt>Block {String(index + 1).padStart(2, '0')}</dt><dd>{formatScheduleHour(block.startHour)}–{formatScheduleHour(block.endHour)} · {getDuration(block.startHour, block.endHour)}h{block.startHour > block.endHour ? ' · Overnight' : ''} · {formatSchedulePrice(block.price)} per block</dd></div>)}</dl>
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
      <AdminSelect ariaLabel="Price adjustment direction" value={direction}
        options={[{ value: 'increase', label: 'Increase' }, { value: 'decrease', label: 'Decrease' }]}
        icon={null} className="w-full" buttonClassName="pricing-adjustment-button"
        menuAnchor={{ to: 'bottom start', gap: 6, padding: 12 }} menuClassName="pricing-adjustment-menu"
        onChange={(next) => {
          setEmptyDirection(next);
          onChange(value === '' ? '' : (next === 'decrease' ? -1 : 1) * magnitude);
        }} />
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
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [listPage, setListPage] = useState(1);
  const editorId = useId();
  const index = selectedIndex === null ? -1 : Math.min(selectedIndex, policies.length - 1);
  const policy = policies[index];
  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(policies.length / pageSize));
  const currentPage = Math.min(listPage, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const firstPage = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const pageNumbers = Array.from({ length: Math.min(5, totalPages) }, (_, n) => firstPage + n);
  const describeScope = (policy) => {
    if (policy.scope === 'date_range') return `Date range: ${policy.startDate || 'Not set'} - ${policy.endDate || 'Not set'}`;
    if (policy.scope === 'month') return `Months: ${policy.months?.length ? policy.months.join(', ') : 'None selected'}`;
    return `Weekdays: ${policy.daysOfWeek?.length ? weekDays.filter(([, value]) => policy.daysOfWeek.includes(value)).map(([label]) => label).join(', ') : 'None selected'}`;
  };
  const toggleValue = (index, field, value) => {
    const current = policies[index][field] || [];
    onChange(index, field, current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]);
  };

  return <section className="pricing-policies" aria-label="Calendar policies">
    <div className="pricing-panel-header">
      <button type="button" onClick={() => { onAdd(); setSelectedIndex(policies.length); setListPage(Math.floor(policies.length / pageSize) + 1); }} className="pricing-button pricing-primary">
        <Plus size={16} aria-hidden="true" />Add policy
      </button>
    </div>
    <div className="calendar-workspace">
      <aside className="calendar-policy-list" aria-label="Policy List">
        <div className="calendar-list-heading"><h3>Policy List</h3><span>{policies.length} policies</span></div>
        <div className="calendar-list-body" role="region" aria-label="Calendar policy records" tabIndex={0}>
          {policies.slice(pageStart, pageStart + pageSize).map((item, offset) => {
            const rowIndex = pageStart + offset;
            return <button key={item._id || rowIndex} type="button" className={`calendar-policy-row ${index === rowIndex ? 'is-selected' : ''}`}
              aria-label={`Edit policy ${item.name || rowIndex + 1}`} aria-pressed={index === rowIndex} aria-controls={editorId}
              onClick={() => setSelectedIndex(rowIndex)}>
              <span className="calendar-row-copy"><span className="calendar-row-name">{item.name || 'Untitled policy'}</span><span className="calendar-row-period">{describeScope(item)}</span></span>
              <span className="calendar-row-meta"><span className="pricing-policy-summary-adjustment">{item.adjustmentPercent === '' || !Number.isFinite(Number(item.adjustmentPercent)) ? 'Not set' : `${Number(item.adjustmentPercent) > 0 ? '+' : ''}${Number(item.adjustmentPercent)}%`}</span><span className={`pricing-policy-summary-status ${item.isActive ? 'is-active' : ''}`}>{item.isActive ? 'Active' : 'Inactive'}</span></span>
            </button>;
          })}
          {!policies.length && <p className="pricing-policy-empty">No calendar policies. Add a policy to get started.</p>}
        </div>
        <footer className="calendar-list-pagination">
          <p aria-live="polite">{policies.length ? pageStart + 1 : 0}&ndash;{Math.min(pageStart + pageSize, policies.length)} of {policies.length}</p>
          <nav aria-label="Calendar policy pagination">
            <button type="button" aria-label="Previous calendar policy page" disabled={currentPage === 1} onClick={() => setListPage(currentPage - 1)}>&larr; Prev</button>
            {pageNumbers.map((number) => <button type="button" key={number} aria-label={`Calendar policy page ${number}`} aria-current={number === currentPage ? 'page' : undefined} disabled={!policies.length} onClick={() => setListPage(number)}>{number}</button>)}
            <button type="button" aria-label="Next calendar policy page" disabled={currentPage === totalPages} onClick={() => setListPage(currentPage + 1)}>Next &rarr;</button>
          </nav>
        </footer>
      </aside>
      <div className="calendar-detail" id={editorId}>
      {policy ? <div className="pricing-policy-editor" role="region" aria-label={`Edit policy ${policy.name || 'New policy'}`}>
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
              onClick={() => { onRemove(index); setSelectedIndex(null); }}><Trash2 size={17} aria-hidden="true" /></button>
          </div>
        </header>
        <div className="calendar-editor-body" role="region" aria-label="Policy editable fields" tabIndex={0}>
        <div className="pricing-policy-fields">
          <div className="pricing-policy-scope-select">
            <span>Applies by</span>
            <AdminSelect value={policy.scope} onChange={(value) => onChange(index, 'scope', value)}
              options={[{ value: 'weekday', label: 'Day of week' }, { value: 'month', label: 'Month' }, { value: 'date_range', label: 'Holiday / date range' }]}
              ariaLabel="Applies by" icon={null} className="w-full" buttonClassName="pricing-adjustment-button"
              menuAnchor={{ to: 'bottom start', gap: 6, padding: 12 }} menuClassName="pricing-adjustment-menu" />
          </div>
          <PolicyAdjustmentInput key={policy._id || index} value={policy.adjustmentPercent} onChange={(value) => onChange(index, 'adjustmentPercent', value)} />
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
        </div>
      </div> : <div className="calendar-empty"><List size={28} aria-hidden="true" /><h3>No Policy Selected</h3><p>Select a policy or use Add policy to create one.</p></div>}
      </div>
    </div>
  </section>;
}
