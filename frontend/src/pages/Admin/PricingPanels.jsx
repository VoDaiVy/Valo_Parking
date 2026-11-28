import AnimatedNumber from '../../components/AnimatedNumber';
import { createPortal } from 'react-dom';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3, ArrowDown, ArrowUp, ChartNoAxesColumnIncreasing, List, ShieldPlus, Eye, ChevronDown, Plus, SquarePen, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import AdminSelect from '../../components/Admin/AdminSelect';
import { formatCurrency, formatHour, getDuration, getRowError, getTimelineSegments, formatSchedulePrice, formatScheduleHour, getTimelineWarning, startHourOptions, endHourOptions, numberNoSpinnerClass } from './pricingDisplay';

function getMetrics(blocks) {
  const prices = blocks.filter((block) => block.price !== '' && Number.isFinite(Number(block.price)) && Number(block.price) >= 0).map((block) => Number(block.price));
  return { count: blocks.length, low: prices.length ? formatCurrency(Math.min(...prices)) : '—', high: prices.length ? formatCurrency(Math.max(...prices)) : '—' };
}

function Coverage({ status }) {
  const { t } = useTranslation();
  const statusLabel = status.tone === 'success'
    ? t('pricingUi.configurationValid', { defaultValue: 'Configuration is valid' })
    : t('pricingUi.scheduleCoverageIncomplete', { defaultValue: status.label });
  return <span className={`pricing-coverage pricing-coverage-${status.tone}`}>
    {status.tone === 'success' ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertCircle size={15} aria-hidden="true" />}
    {statusLabel}
  </span>;
}

function SectionTitle({ icon: Icon, title, description }) {
  return <div className="pricing-section-title">
    <span className="pricing-section-icon"><Icon size={20} aria-hidden="true" /></span>
    <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
  </div>;
}

export function PricingHeader({ status }) {
  const { t } = useTranslation();
  return <header className="pricing-header">
    <div>
      <div className="pricing-title-line"><h1>{t('pricingUi.title', { defaultValue: 'Pricing Management' })}</h1><span className="pricing-manager-badge"><ChartNoAxesColumnIncreasing size={13} aria-hidden="true" />{t('pricingUi.manager', { defaultValue: 'Pricing Manager' })}</span></div><p className="pricing-subtitle">{t('pricingUi.subtitle', { defaultValue: 'Manage time blocks and calendar pricing policies.' })}</p>
    </div>{status.tone !== 'success' && <Coverage status={status} />}
  </header>;
}

export function PricingOverview({ timeBlocks }) {
  const { t } = useTranslation();
  const metrics = getMetrics(timeBlocks);
  const cards = [
    { label: t('pricingUi.timeBlocks', { defaultValue: 'Time blocks' }), value: metrics.count, note: t('pricingUi.blocksConfigured', { defaultValue: 'Blocks configured for 24 hours' }), icon: Clock3 },
    { label: t('pricingUi.lowest', { defaultValue: 'Lowest block fee' }), value: metrics.low, note: t('pricingUi.lowestNote', { defaultValue: 'Lowest configured fee per block' }), icon: ArrowDown },
    { label: t('pricingUi.highest', { defaultValue: 'Highest block fee' }), value: metrics.high, note: t('pricingUi.highestNote', { defaultValue: 'Highest configured fee per block' }), icon: ArrowUp },
  ];
  return <dl className="pricing-metrics">{cards.map(({ label, value, note, icon: Icon }) =>
    <div className="pricing-metric" key={label}>
      <span className="pricing-metric-icon"><Icon size={18} strokeWidth={1.7} aria-hidden="true" /></span>
      <div className="pricing-metric-copy"><dt>{label}</dt><dd><AnimatedNumber value={value} /></dd><p>{note}</p></div>
    </div>)}
  </dl>;
}

export function PricingSchedule({ timeBlocks, onSelect }) {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [focusedSegment, setFocusedSegment] = useState(null);
  const anchorRef = useRef(null);
  const tooltipRef = useRef(null);
  const scheduleRef = useRef(null);
  const warning = getTimelineWarning(timeBlocks);
  const segments = warning.startsWith('Overlapping') || warning.startsWith('Invalid time') ? [] : getTimelineSegments(timeBlocks).filter((segment) => segment.width > 0);
  const tooltipId = useId();
  const focused = segments.find((segment) => segment.id === focusedSegment);
  const displayHour = (hour) => {
    const value = formatScheduleHour(hour);
    return value === 'Invalid time' ? t('pricingUi.invalidTime') : value;
  };
  const displayPrice = (price, withUnit) => {
    const value = formatSchedulePrice(price, withUnit);
    return value === 'Invalid price' ? t('pricingUi.invalidPrice') : value;
  };
  const describe = (segment) => `${t('pricingUi.block', { defaultValue: 'Block {{number}}', number: String(segment.sourceIndex + 1).padStart(2, '0') })}: ${segment.label}, ${t('pricingUi.perBlockPrice', { defaultValue: '{{price}} per block', price: displayPrice(segment.price) })}`;
  const warningText = warning === 'No time blocks configured.'
    ? t('pricingUi.noTimeBlocks', { defaultValue: warning })
    : warning === 'Invalid time boundaries. Review the time blocks below.'
      ? t('pricingUi.invalidTimeBoundaries', { defaultValue: warning })
      : warning === 'Invalid or missing block fee. Review the time blocks below.'
        ? t('pricingUi.invalidBlockFee', { defaultValue: warning })
        : warning === 'Overlapping time blocks. Review the time blocks below.'
          ? t('pricingUi.overlappingBlocks', { defaultValue: warning })
          : warning === 'Schedule coverage incomplete. Unconfigured intervals remain empty.'
            ? t('pricingUi.unconfiguredIntervals', { defaultValue: warning })
            : warning;
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
      <SectionTitle icon={ChartNoAxesColumnIncreasing} title={t('pricingUi.scheduleTitle', { defaultValue: '24-Hour Pricing Schedule' })} />
      <button type="button" className="pricing-details-button" aria-expanded={detailsOpen} aria-controls="pricing-schedule-details" onClick={() => setDetailsOpen(!detailsOpen)}><Eye size={14} aria-hidden="true" />{detailsOpen ? t('pricingUi.hideDetails', { defaultValue: 'Hide details' }) : t('pricingUi.viewDetails', { defaultValue: 'View details' })}</button>
    </div>
    {warning && <p className="pricing-schedule-warning" role="status">{warningText}</p>}
    <div className="pricing-axis" aria-hidden="true">{[0, 6, 12, 18, 24].map((hour) => <span key={hour} style={{ left: `${hour / 24 * 100}%` }}>{formatScheduleHour(hour)}</span>)}</div>
    <div className="pricing-timeline" onMouseLeave={leaveTooltip}>
      {segments.map((segment) => <button type="button" key={segment.id} className={`pricing-segment ${segment.color}`} style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
        aria-label={t('pricingUi.editScheduleBlock', { defaultValue: 'Edit {{description}}', description: describe(segment) })} aria-describedby={focusedSegment === segment.id ? tooltipId : undefined}
        onFocus={(event) => showTooltip(event, segment.id)} onBlur={() => setFocusedSegment(null)} onMouseEnter={(event) => showTooltip(event, segment.id)} onMouseLeave={leaveTooltip}
        onKeyDown={(event) => { if (event.key === 'Escape') setFocusedSegment(null); }} onClick={(event) => { showTooltip(event, segment.id); onSelect(segment.sourceIndex); }}>
        <span aria-hidden="true" className="pricing-segment-value">{displayPrice(segment.price, false)}</span>
      </button>)}
    </div>
    {focused && createPortal(<div ref={tooltipRef} className="pricing-timeline-tooltip" role="tooltip" id={tooltipId}>
      <strong>{t('pricingUi.block', { defaultValue: 'Block {{number}}', number: String(focused.sourceIndex + 1).padStart(2, '0') })}</strong>
      <span>{focused.label}</span><span>{t('pricingUi.perBlockPrice', { defaultValue: '{{price}} per block', price: displayPrice(focused.price) })}</span>
    </div>, document.body)}
    <ul className="pricing-legend">{timeBlocks.map((block, index) => <li key={index}>
      <button type="button" onClick={() => onSelect(index)} aria-label={t('pricingUi.editBlock', { number: index + 1 })}><span aria-hidden="true" className={`pricing-dot pricing-tone-${index % 5}`} /><span>B{String(index + 1).padStart(2, '0')} &middot; {displayHour(block.startHour)}–{displayHour(block.endHour)} · {displayPrice(block.price)}</span></button>
    </li>)}</ul>
    <div id="pricing-schedule-details" hidden={!detailsOpen} className="pricing-schedule-details">
      <p>{t('pricingUi.scheduleExplanation')}</p>
      <dl>{timeBlocks.map((block, index) => <div key={index}><dt>{t('pricingUi.block', { number: String(index + 1).padStart(2, '0') })}</dt><dd>{displayHour(block.startHour)}–{displayHour(block.endHour)} · {t('pricingUi.durationHours', { hours: getDuration(block.startHour, block.endHour) })}{block.startHour > block.endHour ? ` · ${t('pricingUi.overnight')}` : ''} · {t('pricingUi.perBlockPrice', { price: displayPrice(block.price) })}</dd></div>)}</dl>
    </div>
  </section>;
}

export function TimeBlockEditor({ timeBlocks, selectedBlock, onAdd, onChange, onRemove }) {
  const { t } = useTranslation();
  return <section className="pricing-editor">
    <div className="pricing-panel-header"><SectionTitle icon={List} title={t('pricingUi.hourlyBlocks', { defaultValue: 'Time blocks' })} description={t('pricingUi.editorSubtitle', { defaultValue: 'Set the pricing schedule for a full parking day.' })} />
      <button type="button" onClick={onAdd} className="pricing-button pricing-primary"><Plus size={16} aria-hidden="true" />{t('pricingUi.addBlock', { defaultValue: 'Add time block' })}</button>
    </div>
    <div className="pricing-row-head" aria-hidden="true"><span>#</span><span>{t('pricingUi.startTime', { defaultValue: 'Start time' })}</span><span>{t('pricingUi.endTime', { defaultValue: 'End time' })}</span><span>{t('pricingUi.duration', { defaultValue: 'Duration' })}</span><span>{t('pricingUi.blockFee', { defaultValue: 'Block fee (VND)' })}</span><span>{t('pricingUi.action', { defaultValue: 'Action' })}</span></div>
    {timeBlocks.map((block, index) => {
      const error = getRowError(block);
      const errorText = error === 'Hours must be between 0 and 24.'
        ? t('pricingUi.validationHours', { defaultValue: error })
        : error === 'Price must be a valid number and cannot be negative.'
          ? t('pricingUi.validationPrice', { defaultValue: error })
          : error === 'Start and end time cannot be identical.'
            ? t('pricingUi.startEndIdentical', { defaultValue: error })
            : error;
      const duration = getDuration(block.startHour, block.endHour);
      return <div id={`pricing-block-${index}`} tabIndex={-1} aria-label={t('pricingUi.timeBlockLabel', { number: index + 1 })} key={index} className={`pricing-row ${selectedBlock === index ? 'pricing-row-selected' : ''}`}>
        <span className="pricing-row-number">{String(index + 1).padStart(2, '0')}</span>
        {['startHour', 'endHour'].map((field) => <div className="pricing-time-cell" key={field}><span className="pricing-mobile-label">{field === 'startHour' ? t('pricingUi.startTime', { defaultValue: 'Start time' }) : t('pricingUi.endTime', { defaultValue: 'End time' })}</span>
          <AdminSelect value={Number(block[field])} onChange={(value) => onChange(index, field, value)} options={field === 'startHour' ? startHourOptions : endHourOptions} icon={Clock3} className="w-full" buttonClassName="pricing-time-button" menuClassName="pricing-time-menu" visibleItems={7} ariaLabel={t(field === 'startHour' ? 'pricingUi.startTimeForBlock' : 'pricingUi.endTimeForBlock', { number: index + 1 })} />
        </div>)}
        <div className="pricing-duration"><span className="pricing-mobile-label">{t('pricingUi.duration', { defaultValue: 'Duration' })}</span><strong>{duration > 0 ? t('pricingUi.durationHours', { hours: duration }) : '—'}</strong>{block.startHour > block.endHour && <small>{t('pricingUi.overnight', { defaultValue: 'Overnight' })}</small>}</div>
        <label><span className="pricing-mobile-label">{t('pricingUi.blockFee', { defaultValue: 'Block fee (VND)' })}</span><div className="pricing-currency-field"><input id={`pricing-fee-${index}`} type="number" min="0" step="1000" value={block.price} onChange={(event) => onChange(index, 'price', event.target.value)} aria-label={t('pricingUi.blockFeeForBlock', { number: index + 1 })} aria-invalid={Boolean(error)} aria-describedby={error ? `pricing-row-error-${index}` : undefined} /><span>VND</span></div></label>
        <div className="pricing-row-actions"><button type="button" className="pricing-edit" onClick={() => document.getElementById(`pricing-fee-${index}`)?.focus()} aria-label={t('pricingUi.editFee', { defaultValue: 'Edit fee for time block {{number}}', number: index + 1 })} title={t('pricingUi.editFee', { defaultValue: 'Edit fee for time block {{number}}', number: index + 1 })}><SquarePen size={16} aria-hidden="true" /></button><button type="button" className="pricing-delete" onClick={() => onRemove(index)} aria-label={t('pricingUi.deleteBlock', { defaultValue: 'Delete time block {{number}}', number: index + 1 })} title={t('pricingUi.deleteBlock', { defaultValue: 'Delete time block {{number}}', number: index + 1 })}><Trash2 size={16} aria-hidden="true" /></button></div>
        {errorText && <p id={`pricing-row-error-${index}`} className="pricing-row-error pricing-error">{errorText}</p>}
      </div>;
    })}
    {!timeBlocks.length && <p className="pricing-empty">{t('pricingUi.emptyBlocks', { defaultValue: 'No time blocks configured. Add a time block to build the schedule.' })}</p>}
  </section>;
}

export function AdditionalPricingRules({ config }) {
  const { t } = useTranslation();
  return <details className="pricing-panel pricing-additional"><summary><SectionTitle icon={ShieldPlus} title={t('pricingUi.additionalRules', { defaultValue: 'Additional Pricing Rules' })} description={t('pricingUi.additionalRulesDescription', { defaultValue: 'Day/night overrides and price caps (if any).' })} /><ChevronDown size={17} aria-hidden="true" /></summary>
    <div className="pricing-additional-content"><p>{t('pricingUi.savedReadOnly', { defaultValue: 'Saved settings · Read only' })}</p><dl>
      <div><dt>{t('pricingUi.upToHours', { defaultValue: 'Up to {{hours}} hours', hours: 12 })}</dt><dd>{t('pricingUi.cappedAt', { price: formatCurrency(config.cap12h ?? 100000) })}</dd></div><div><dt>{t('pricingUi.upToHours', { defaultValue: 'Up to {{hours}} hours', hours: 24 })}</dt><dd>{t('pricingUi.cappedAt', { price: formatCurrency(config.cap24h ?? 180000) })}</dd></div>
      {['day', 'night'].map((key) => { const rule = config.dayNightPricing?.[key]; return <div key={key}><dt>{t(key === 'day' ? 'pricingUi.dayOverride' : 'pricingUi.nightOverride')}</dt><dd>{rule?.isActive ? `${formatHour(rule.startHour)}–${formatHour((rule.startHour + 12) % 24)} · ${t('pricingUi.perBlockPrice', { price: formatCurrency(rule.price) })}` : t('pricingUi.disabled', { defaultValue: 'Disabled' })}</dd></div>; })}
    </dl><p>{t('pricingUi.activeOverridesNote', { defaultValue: 'Active overrides replace base blocks in their 12-hour windows. Calendar adjustments apply before caps.' })}</p></div>
  </details>;
}

export function PricingSummary({ timeBlocks, status }) {
  const { t } = useTranslation();
  const metrics = getMetrics(timeBlocks);
  return <div className="pricing-summary"><div className="pricing-summary-values"><Clock3 size={15} aria-hidden="true" /><strong>{t('pricingUi.pricingSummary', { defaultValue: 'Pricing Summary' })}:</strong><span>{t('pricingUi.timeBlocksCount', { defaultValue: '{{count}} time blocks', count: metrics.count })}</span><span>{t('pricingUi.lowestFee', { defaultValue: 'Lowest fee' })}: <b>{metrics.low}</b></span><span>{t('pricingUi.highestFee', { defaultValue: 'Highest fee' })}: <b>{metrics.high}</b></span></div>
    <div role="status"><Coverage status={status} />{status.tone !== 'success' && <p className="pricing-error">{t(status.detailKey, { hour: status.hour })}</p>}</div>
  </div>;
}

const weekDays = [
  ['sun', 0], ['mon', 1], ['tue', 2], ['wed', 3], ['thu', 4], ['fri', 5], ['sat', 6],
];

function PolicyAdjustmentInput({ value, onChange }) {
  const { t } = useTranslation();
  const id = useId();
  const [emptyDirection, setEmptyDirection] = useState('increase');
  const direction = Number(value) === 0 ? emptyDirection : Number(value) < 0 ? 'decrease' : 'increase';
  const magnitude = value === '' ? '' : Math.abs(Number(value));
  const limit = direction === 'decrease' ? 100 : 500;
  const invalid = value === '' || !Number.isFinite(Number(value)) || magnitude > limit;

  return <div className="pricing-policy-adjustment">
    <label htmlFor={`${id}-percentage`}>{t('pricingUi.priceAdjustment', { defaultValue: 'Price adjustment' })}</label>
    <div className="pricing-policy-adjustment-controls">
      <AdminSelect ariaLabel={t('pricingUi.priceAdjustmentDirection', { defaultValue: 'Price adjustment direction' })} value={direction}
        options={[{ value: 'increase', label: t('pricingUi.increase', { defaultValue: 'Increase' }) }, { value: 'decrease', label: t('pricingUi.decrease', { defaultValue: 'Decrease' }) }]}
        icon={null} className="w-full" buttonClassName="pricing-adjustment-button"
        menuAnchor={{ to: 'bottom start', gap: 6, padding: 12 }} menuClassName="pricing-adjustment-menu"
        onChange={(next) => {
          setEmptyDirection(next);
          onChange(value === '' ? '' : (next === 'decrease' ? -1 : 1) * magnitude);
        }} />
      <div className="pricing-policy-percent">
        <input id={`${id}-percentage`} aria-label={t('pricingUi.adjustmentPercentage', { defaultValue: 'Adjustment percentage' })} aria-invalid={invalid}
          aria-describedby={`${id}-help`} type="number" min="0" max={limit} step="any"
          value={magnitude} onChange={(event) => {
            setEmptyDirection(direction);
            onChange(event.target.value === '' ? '' : (direction === 'decrease' ? -1 : 1) * Math.abs(Number(event.target.value)));
          }} className={numberNoSpinnerClass} />
        <span aria-hidden="true">%</span>
      </div>
    </div>
    <p id={`${id}-help`} className={invalid ? 'pricing-error' : 'pricing-policy-help'}>
      {direction === 'decrease' ? t('pricingUi.maximumDecrease', { defaultValue: 'Maximum decrease: 100%' }) : t('pricingUi.maximumIncrease', { defaultValue: 'Maximum increase: 500%' })}
    </p>
  </div>;
}

export function PricePolicyEditor({ policies, onAdd, onChange, onRemove }) {
  const { t } = useTranslation();
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
    if (policy.scope === 'date_range') return `${t('pricingUi.dateRange')}: ${policy.startDate || t('pricingUi.notSet', { defaultValue: 'Not set' })} - ${policy.endDate || t('pricingUi.notSet', { defaultValue: 'Not set' })}`;
    if (policy.scope === 'month') return `${t('pricingUi.months', { defaultValue: 'Months' })}: ${policy.months?.length ? policy.months.join(', ') : t('pricingUi.notSet', { defaultValue: 'Not set' })}`;
    return `${t('pricingUi.weekdays', { defaultValue: 'Weekdays' })}: ${policy.daysOfWeek?.length ? weekDays.filter(([, value]) => policy.daysOfWeek.includes(value)).map(([label]) => t(`pricingDays.${label}`, { defaultValue: label })).join(', ') : t('pricingUi.notSet', { defaultValue: 'Not set' })}`;
  };
  const toggleValue = (index, field, value) => {
    const current = policies[index][field] || [];
    onChange(index, field, current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]);
  };

  return <section className="pricing-policies" aria-label={t('pricingUi.calendarPoliciesLabel', { defaultValue: 'Calendar policies' })}>
    <div className="pricing-panel-header">
      <button type="button" onClick={() => { onAdd(); setSelectedIndex(policies.length); setListPage(Math.floor(policies.length / pageSize) + 1); }} className="pricing-button pricing-primary">
        <Plus size={16} aria-hidden="true" />{t('pricingUi.addPolicy', { defaultValue: 'Add policy' })}
      </button>
    </div>
    <div className="calendar-workspace">
      <aside className="calendar-policy-list" aria-label={t('pricingUi.policyList', { defaultValue: 'Policy List' })}>
        <div className="calendar-list-heading"><h3>{t('pricingUi.policyList', { defaultValue: 'Policy List' })}</h3><span>{t('pricingUi.policiesCount', { defaultValue: '{{count}} policies', count: policies.length })}</span></div>
        <div className="calendar-list-body" role="region" aria-label={t('pricingUi.calendarPolicyRecords', { defaultValue: 'Calendar policy records' })} tabIndex={0}>
          {policies.slice(pageStart, pageStart + pageSize).map((item, offset) => {
            const rowIndex = pageStart + offset;
            return <button key={item._id || rowIndex} type="button" className={`calendar-policy-row ${index === rowIndex ? 'is-selected' : ''}`}
              aria-label={t('pricingUi.editPolicy', { defaultValue: 'Edit policy {{name}}', name: item.name || rowIndex + 1 })} aria-pressed={index === rowIndex} aria-controls={editorId}
              onClick={() => setSelectedIndex(rowIndex)}>
              <span className="calendar-row-copy"><span className="calendar-row-name">{item.name || t('pricingUi.untitledPolicy', { defaultValue: 'Untitled policy' })}</span><span className="calendar-row-period">{describeScope(item)}</span></span>
              <span className="calendar-row-meta"><span className="pricing-policy-summary-adjustment">{item.adjustmentPercent === '' || !Number.isFinite(Number(item.adjustmentPercent)) ? t('pricingUi.notSet', { defaultValue: 'Not set' }) : `${Number(item.adjustmentPercent) > 0 ? '+' : ''}${Number(item.adjustmentPercent)}%`}</span><span className={`pricing-policy-summary-status ${item.isActive ? 'is-active' : ''}`}>{item.isActive ? t('pricingUi.active', { defaultValue: 'Active' }) : t('pricingUi.inactive', { defaultValue: 'Inactive' })}</span></span>
            </button>;
          })}
          {!policies.length && <p className="pricing-policy-empty">{t('pricingUi.noCalendarPolicies', { defaultValue: 'No calendar policies. Add a policy to get started.' })}</p>}
        </div>
        <footer className="calendar-list-pagination">
          <p aria-live="polite">{t('pricingUi.policyPageRange', { start: policies.length ? pageStart + 1 : 0, end: Math.min(pageStart + pageSize, policies.length), total: policies.length })}</p>
          <nav aria-label={t('pricingUi.policyPagination')}>
            <button type="button" aria-label={t('pricingUi.previousPage')} disabled={currentPage === 1} onClick={() => setListPage(currentPage - 1)}>&larr; {t('pricingUi.previousPage')}</button>
            {pageNumbers.map((number) => <button type="button" key={number} aria-label={t('pricingUi.policyPage', { number })} aria-current={number === currentPage ? 'page' : undefined} disabled={!policies.length} onClick={() => setListPage(number)}>{number}</button>)}
            <button type="button" aria-label={t('pricingUi.nextPage')} disabled={currentPage === totalPages} onClick={() => setListPage(currentPage + 1)}>{t('pricingUi.nextPage')} &rarr;</button>
          </nav>
        </footer>
      </aside>
      <div className="calendar-detail" id={editorId}>
      {policy ? <div className="pricing-policy-editor" role="region" aria-label={t('pricingUi.editPolicy', { defaultValue: 'Edit policy {{name}}', name: policy.name || t('pricingUi.newPolicy', { defaultValue: 'New policy' }) })}>
        <header className="pricing-policy-header">
          <label className="pricing-policy-name">
            <span>{t('pricingUi.policyName', { defaultValue: 'Policy name' })}</span>
            <input value={policy.name} onChange={(event) => onChange(index, 'name', event.target.value)} placeholder={t('pricingUi.holidayPlaceholder', { defaultValue: 'e.g. Holiday pricing' })} />
          </label>
          <div className="pricing-policy-actions">
            <button type="button" aria-pressed={policy.isActive} aria-label={t('pricingUi.togglePolicy', { defaultValue: 'Toggle policy {{name}}', name: policy.name || index + 1 })}
              onClick={() => onChange(index, 'isActive', !policy.isActive)}
              className={`pricing-policy-status ${policy.isActive ? 'is-active' : ''}`}>
              <span aria-hidden="true" />{policy.isActive ? t('pricingUi.active', { defaultValue: 'Active' }) : t('pricingUi.inactive', { defaultValue: 'Inactive' })}
            </button>
            <button type="button" className="pricing-policy-delete" aria-label={t('pricingUi.deletePolicy', { defaultValue: 'Delete policy {{name}}', name: policy.name || index + 1 })}
              onClick={() => { onRemove(index); setSelectedIndex(null); }}><Trash2 size={17} aria-hidden="true" /></button>
          </div>
        </header>
        <div className="calendar-editor-body" role="region" aria-label={t('pricingUi.policyFields', { defaultValue: 'Policy editable fields' })} tabIndex={0}>
        <div className="pricing-policy-fields">
          <div className="pricing-policy-scope-select">
            <span>{t('pricingUi.appliesBy', { defaultValue: 'Applies by' })}</span>
            <AdminSelect value={policy.scope} onChange={(value) => onChange(index, 'scope', value)}
              options={[{ value: 'weekday', label: t('pricingUi.dayOfWeek', { defaultValue: 'Day of week' }) }, { value: 'month', label: t('pricingUi.months', { defaultValue: 'Month' }) }, { value: 'date_range', label: t('pricingUi.holidayDateRange', { defaultValue: 'Holiday / date range' }) }]}
              ariaLabel={t('pricingUi.appliesBy', { defaultValue: 'Applies by' })} icon={null} className="w-full" buttonClassName="pricing-adjustment-button"
              menuAnchor={{ to: 'bottom start', gap: 6, padding: 12 }} menuClassName="pricing-adjustment-menu" />
          </div>
          <PolicyAdjustmentInput key={policy._id || index} value={policy.adjustmentPercent} onChange={(value) => onChange(index, 'adjustmentPercent', value)} />
          <label className="pricing-policy-priority">{t('pricingUi.priority', { defaultValue: 'Priority' })}
            <input type="number" min="0" max="10000" value={policy.priority} className={numberNoSpinnerClass}
              onChange={(event) => onChange(index, 'priority', event.target.value === '' ? '' : Number(event.target.value))} />
          </label>
        </div>
        {policy.scope === 'weekday' && <fieldset className="pricing-policy-scope">
          <legend>{t('pricingUi.weekdays', { defaultValue: 'Weekdays' })}</legend>
          <div className="pricing-policy-choices">{weekDays.map(([label, value]) => <button key={value} type="button"
            aria-pressed={Boolean(policy.daysOfWeek?.includes(value))} onClick={() => toggleValue(index, 'daysOfWeek', value)}>{t(`pricingDays.${label}`, { defaultValue: label })}</button>)}</div>
        </fieldset>}
        {policy.scope === 'month' && <fieldset className="pricing-policy-scope">
          <legend>{t('pricingUi.months', { defaultValue: 'Months' })}</legend>
          <div className="pricing-policy-choices">{Array.from({ length: 12 }, (_, month) => month + 1).map((month) => <button key={month} type="button"
            aria-pressed={Boolean(policy.months?.includes(month))} onClick={() => toggleValue(index, 'months', month)}>{t('pricingUi.monthNumber', { defaultValue: 'Month {{month}}', month })}</button>)}</div>
        </fieldset>}
        {policy.scope === 'date_range' && <div className="pricing-policy-dates">
          <label>{t('pricingUi.fromDate', { defaultValue: 'From date' })}<input type="date" value={policy.startDate || ''} onChange={(event) => onChange(index, 'startDate', event.target.value)} /></label>
          <label>{t('pricingUi.toDate', { defaultValue: 'To date' })}<input type="date" value={policy.endDate || ''} onChange={(event) => onChange(index, 'endDate', event.target.value)} /></label>
        </div>}
        <footer className="pricing-policy-footer">
          {policy.adjustmentPercent === '' ? t('pricingUi.enterAdjustment', { defaultValue: 'Enter a percentage adjustment.' }) : Number(policy.adjustmentPercent) < 0 ? t('pricingUi.decreaseBase', { defaultValue: 'Decrease the applicable base fee by {{percent}}%.', percent: Math.abs(Number(policy.adjustmentPercent)) || 0 }) : t('pricingUi.increaseBase', { defaultValue: 'Increase the applicable base fee by {{percent}}%.', percent: Math.abs(Number(policy.adjustmentPercent)) || 0 })}
        </footer>
        </div>
      </div> : <div className="calendar-empty"><List size={28} aria-hidden="true" /><h3>{t('pricingUi.noPolicySelected', { defaultValue: 'No Policy Selected' })}</h3><p>{t('pricingUi.selectPolicy', { defaultValue: 'Select a policy or use Add policy to create one.' })}</p></div>}
      </div>
    </div>
  </section>;
}
