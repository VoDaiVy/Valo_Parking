import { Check } from 'lucide-react';
import { adminFilters } from '../utils/adminPresentation';

export function NotificationFilterBar({ filter, onFilter, unreadCount, marking, disabled, onMarkAllRead }) {
  return <div className="valo-ai-notification-toolbar">
    <div className="valo-ai-filters" aria-label="Notification filters">
      {adminFilters.map(([key, label]) => <button type="button" key={key} aria-pressed={filter === key} className={filter === key ? 'active' : ''} onClick={() => onFilter(key)}>{label}</button>)}
    </div>
    <button type="button" className="valo-ai-mark-all-read" disabled={!unreadCount || marking || disabled} aria-busy={marking} onClick={onMarkAllRead}><Check size={12} aria-hidden="true"/>{marking ? 'Marking…' : 'Mark as read'}</button>
  </div>;
}

export function NotificationSummary({ item, text }) {
  const values = [item.evidence?.licensePlate, item.evidence?.username, item.evidence?.slot].filter(value => typeof value === 'string' && value.length);
  if (!values.length) return <>{text}</>;
  const pattern = new RegExp(`(${[...new Set(values)].sort((a, b) => b.length - a.length).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return <>{String(text || '').split(pattern).map((part, index) => values.includes(part) ? <b key={index}>{part}</b> : part)}</>;
}
