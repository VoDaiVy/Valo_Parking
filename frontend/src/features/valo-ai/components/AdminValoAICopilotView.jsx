import { useEffect, useRef } from 'react';
import { Bell, Check, Send, X, Trash2, AlertTriangle, MessageSquare, ChevronLeft, ExternalLink, Info, Loader2, ShieldCheck, Car, Crown, CalendarDays, CreditCard, MapPin, UserPlus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import ValoAIMascot from './ValoAIMascot';
import AIMessageMarkdown from './AIMessageMarkdown';
import { notificationClickTarget } from '../utils/notificationTarget';
import { adminNotification, adminActions, adminDate, adminValue, adminSourceLabel, readableLabel } from '../utils/adminPresentation';
import '../styles/ValoAICopilot.css';

const iconFor = (type) => ({ NEW_SESSION: Car, NEW_SUBSCRIPTION: Crown, NEW_BOOKING: CalendarDays, BOOKING_CANCELLED: CalendarDays, REFUND_COMPLETED: CreditCard, FLOOR_FULL: MapPin, OCCUPANCY_HIGH: MapPin, NEW_USER_REGISTERED: UserPlus })[type] || Bell;
const relativeTime = (value) => value && Number.isFinite(new Date(value).getTime()) ? formatDistanceToNow(new Date(value), { addSuffix: true }) : 'Time unavailable';
function Values({ values }) {
  return <dl className="admin-ai-values">{Object.entries(values || {}).map(([key, value]) => <div key={key}><dt>{readableLabel(key)}</dt><dd>{typeof value === 'string' && /(?:Time|At|Date)$/.test(key) && Number.isFinite(Date.parse(value)) ? adminDate(value) : adminValue(value)}</dd></div>)}</dl>;
}
function Draft({ draft, busy, decide }) {
  return <section className="valo-ai-draft" aria-label="Proposed change">
    <div className="valo-ai-draft-header"><strong>Proposed change</strong><span className="valo-ai-draft-badge badge-pending">Awaiting approval</span></div>
    <h4>{readableLabel(draft.type.toLowerCase())}</h4>
    {draft.reason && <p><b>Reason:</b> {draft.reason}</p>}
    {draft.current && <details><summary>Current values</summary><Values values={draft.current}/></details>}
    <details open><summary>Proposed values</summary><Values values={draft.payload}/></details>
    {draft.type === 'CREATE_SERVICE' && <p><Info size={16}/> Add service images on the Services page after approval.</p>}
    {!!draft.evidence?.length && <p>{draft.evidence.length} data sources support this proposal.</p>}
    <div className="valo-ai-draft-actions"><button type="button" disabled={busy} onClick={() => decide(draft, false)}>Reject</button><button type="button" disabled={busy} onClick={() => decide(draft, true)}>{busy ? 'Processing…' : 'Approve and apply'}</button></div>
  </section>;
}
function Evidence({ item }) {
  const evidence = item.evidence || {};
  const operational = Object.fromEntries(Object.entries(evidence).filter(([key, value]) => !/id$|^source$|^baseline$/i.test(key) && ['string', 'number', 'boolean'].includes(typeof value) && !(typeof value === 'string' && /^[a-f\d]{24}$/i.test(value))));
  return <><h4>Operational evidence</h4>{Object.keys(operational).length ? <Values values={operational}/> : <p>Open the linked record for operational details.</p>}
    <details className="admin-ai-technical"><summary>Technical details</summary><pre>{JSON.stringify({ notificationType: item.notificationType, entityType: item.entityType, entityId: item.entityId, evidence, sourceModules: item.sourceModules }, null, 2)}</pre></details></>;
}
export default function AdminValoAICopilotView(props) {
  const { position, open, setOpen, tab, setTab, messages, busy, noticeBusy, input, setInput, submit, decide, notifications, unreadCount, notificationError, filter, setFilter, selected, setSelected, preview, openNotice, onNotificationClick, refresh, dismissNotice, onPointerDown, onPointerMove, onPointerUp, onTriggerClick, bottomRef, suggestions, filters, dragging, notificationLoading, hasMore, loadMore } = props;
  const panel = useRef(null);
  const trigger = useRef(null);
  const composer = useRef(null);
  useEffect(() => { if (open) panel.current?.querySelector('button')?.focus(); }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const selectedView = selected ? adminNotification(selected) : null;
  const width = Math.min(464, window.innerWidth - 16);
  const height = Math.min(740, window.innerHeight - 24);
  const left = Math.max(8, Math.min(position.x + 46 - width / 2, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(position.y - height - 12, window.innerHeight - height - 8));
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const elements = [...panel.current.querySelectorAll('button:not(:disabled), input, summary, a[href]')].filter((node) => node.getClientRects().length);
      const first = elements[0]; const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  return <>
    <div className="valo-ai-anchor admin-ai-anchor" style={{ left: position.x, top: position.y }}>
      {preview && !open && <button className="valo-ai-preview" type="button" onClick={() => openNotice(preview.id)}><Bell size={18}/><span>New operational notification<small>View details</small></span></button>}
      <button ref={trigger} type="button" aria-label="Open VALO AI" aria-expanded={open} aria-controls="admin-valo-ai" className={`valo-ai-trigger ${dragging ? 'is-dragging' : ''}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onClick={onTriggerClick}>
        <ValoAIMascot size={82}/>{unreadCount > 0 && <span className="valo-ai-badge">{unreadCount}</span>}<span className="valo-ai-label">VALO AI</span>
      </button>
    </div>
    <aside ref={panel} id="admin-valo-ai" role="dialog" aria-label="VALO AI Admin assistant" aria-hidden={!open} inert={!open} lang="en" onKeyDown={onKeyDown} className={`valo-ai-panel admin-ai-panel ${open ? 'is-open' : ''}`} style={{ left, top, width, height }}>
      <header className="valo-ai-header"><ValoAIMascot size={40}/><div><h2>VALO AI</h2><p>Admin operations assistant</p></div><button type="button" onClick={close} aria-label="Close VALO AI"><X size={20}/></button></header>
      <nav className="valo-ai-tabs" aria-label="Assistant sections"><button type="button" aria-pressed={tab === 'chat'} className={tab === 'chat' ? 'active' : ''} onClick={() => { setTab('chat'); composer.current?.focus(); }}><MessageSquare size={17}/>Chat</button><button type="button" aria-pressed={tab === 'notifications'} className={tab === 'notifications' ? 'active' : ''} onClick={() => { setTab('notifications'); refresh(); }}><Bell size={17}/>Notifications{unreadCount > 0 && <b>{unreadCount}</b>}</button></nav>
      {tab === 'chat' ? <>
        <div className="valo-ai-conversation" aria-busy={busy}>
          {!messages.length && <div className="admin-ai-welcome"><ShieldCheck size={24}/><h3>How can I help?</h3><p>Explore live VALO data, investigate operational signals, and review proposed changes before applying them.</p></div>}
          {messages.map((row, index) => <div key={index} className={`valo-ai-message-row ${row.role === 'user' ? 'is-user' : 'is-ai'}`}><div className="valo-ai-message-stack"><div className="valo-ai-message-bubble">{row.role === 'user' ? <p>{row.message}</p> : <AIMessageMarkdown text={row.message}/>}
            {!!row.evidence?.length && <details className="valo-ai-evidence"><summary>Data sources</summary><ul>{row.evidence.map((entry, i) => <li key={i}>{adminSourceLabel(entry)}<small>Updated {adminDate(entry.timestamp)}</small></li>)}</ul></details>}
            {row.draft && <Draft draft={row.draft} busy={noticeBusy} decide={decide}/>}</div><time>{adminDate(row.at, true)}</time></div></div>)}
          {busy && <p className="admin-ai-progress" role="status"><Loader2 size={18} className="admin-ai-spin"/>Checking VALO data…</p>}<div ref={bottomRef}/>
        </div>
        <div className="valo-ai-suggestions">{suggestions.map((text) => <button type="button" key={text} disabled={busy} onClick={() => submit(text)}>{text}</button>)}</div>
        <form className="valo-ai-compose" onSubmit={(event) => { event.preventDefault(); submit(); }}><input ref={composer} aria-label="Question for VALO AI" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about VALO operations…"/><button type="submit" disabled={busy || !input.trim()} aria-label="Send question"><Send size={20}/></button></form>
      </> : <div className="valo-ai-notification-view" aria-busy={notificationLoading}>
        <div className="valo-ai-filters" aria-label="Notification filters">{filters.map(([key, label]) => <button type="button" aria-pressed={filter === key} className={filter === key ? 'active' : ''} key={key} onClick={() => { setFilter(key); setSelected(null); }}>{label}</button>)}</div>
        {notificationError && <div className="valo-ai-notification-error" role="alert"><AlertTriangle size={18}/><p>{notificationError}</p><button type="button" onClick={() => refresh()}>Retry</button></div>}
        {selectedView ? <article className="valo-ai-notification-detail"><button type="button" onClick={() => setSelected(null)}><ChevronLeft size={16}/>Back to notifications</button><h3>{selectedView.title}</h3><p>{selectedView.summary}</p><small>{readableLabel((selected.severity || 'INFO').toLowerCase())} · {adminDate(selected.detectedAt)}</small><Evidence item={selected}/>{adminActions(selected.notificationType).map((action) => <p key={action}>{action}</p>)}
          {selected.status === 'RESOLVED' && <p><Check size={16}/>Resolved by {selected.resolvedBy?.username || 'Admin'} · {adminDate(selected.resolvedAt)}</p>}{selected.status === 'CLEARED' && <p>The signal has returned to normal.</p>}
          {notificationClickTarget(selected, 'admin') && <button type="button" className="admin-ai-open-record" onClick={() => onNotificationClick(selected)}><ExternalLink size={16}/>Open record</button>}
        </article> : <>
          {notifications.map((item) => { const view = adminNotification(item); const Icon = iconFor(item.notificationType); return <article key={item._id} className={`valo-ai-notification severity-${(item.severity || 'INFO').toLowerCase()} ${item.isRead ? 'is-read' : 'is-unread'}`}>
            <div className="admin-ai-notice-content"><button type="button" className="admin-ai-notice-primary" onClick={() => onNotificationClick(item)}><span className="admin-ai-notice-meta"><Icon size={18}/>{readableLabel((item.severity || 'INFO').toLowerCase())}{!item.isRead && <b>Unread</b>}</span><strong>{view.title}</strong><p>{view.summary}</p><time title={adminDate(item.detectedAt)}>{relativeTime(item.detectedAt)}</time><span className="admin-ai-status">{readableLabel((item.status || 'OPEN').toLowerCase())}</span></button><button type="button" className="admin-ai-details-button" onClick={() => openNotice(item._id)}>View details</button></div><button type="button" aria-label={`Dismiss ${view.title}`} onClick={() => dismissNotice(item._id)}><Trash2 size={18}/></button>
          </article>; })}
          {notificationLoading && <p role="status" className="admin-ai-progress"><Loader2 size={18} className="admin-ai-spin"/>Loading notifications…</p>}
          {!notificationLoading && !notificationError && !notifications.length && <div className="valo-ai-empty"><Bell size={28}/><h3>You’re all caught up</h3><p>No notifications match this filter.</p></div>}
          {hasMore && <button type="button" className="admin-ai-load-more" disabled={notificationLoading} onClick={loadMore}>Load more notifications</button>}
        </>}
      </div>}
      <footer>Live data. Proposed changes require your approval.</footer>
    </aside>
  </>;
}
