import { Link } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { Bell, Check, Send, X, Trash2, AlertTriangle, Paperclip, Loader2, Car, CalendarDays, CreditCard, MapPin, UserPlus, ShieldAlert } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import ValoAIMascot from './ValoAIMascot';
import ValoAILauncher from './ValoAILauncher';
import { AdminDraft, AdminChatAnswer } from './AdminChatContent';
import { notificationClickTarget } from '../utils/notificationTarget';
import { adminNotification, adminDate } from '../utils/adminPresentation';
import { NotificationFilterBar, NotificationSummary } from './NotificationCenterControls';
import '../styles/ValoAICopilot.css';

const iconFor = (type) => ({ FLOOR_FULL: MapPin, NEW_BOOKING: CalendarDays, REFUND_COMPLETED: CreditCard, NEW_USER_REGISTERED: UserPlus, NEW_SESSION: Car, VEHICLE_PENDING_VERIFICATION: ShieldAlert })[type] || Bell;
const relativeTime = (value) => value && Number.isFinite(new Date(value).getTime()) ? formatDistanceToNow(new Date(value), { addSuffix: true }) : 'Time unavailable';
// Only destinations with an existing exact-record selection contract are clickable.
function exactNotificationTarget(item) {
  const target = notificationClickTarget(item, 'admin');
  if (!target) return null;
  const [path, query] = target.split('?');
  const params = new URLSearchParams(query);
  const keys = { '/admin/sessions': 'sessionId', '/admin/subscriptions': 'subscriptionId', '/admin/accounts': 'userId', '/admin/parking-lots': params.has('slotId') ? 'slotId' : params.has('bookingId') ? 'bookingId' : 'floorId' };
  const key = keys[path];
  const id = key && params.get(key);
  if (!/^[a-f\d]{24}$/i.test(id || '') || params.getAll(key).length !== 1) return null;
  if (item.entityId && String(item.entityId).toLowerCase() !== id.toLowerCase()) return null;
  if (key === 'slotId' && !/^[a-f\d]{24}$/i.test(params.get('floorId') || '')) return null;
  return target;
}
function popupStyle(position) {
  const width = Math.min(400, window.innerWidth - 16);
  const height = Math.min(650, Math.floor(window.innerHeight * (window.innerWidth < 640 ? 0.9 : 0.78)));
  const left = Math.max(8, Math.min(position.x + 46 - width / 2, window.innerWidth - width - 8));
  const above = position.y - height - 14;
  const below = position.y + 114;
  const top = above >= 8 ? above : below + height <= window.innerHeight - 8 ? below : Math.max(8, window.innerHeight - height - 8);
  const originX = Math.max(0, Math.min(width, position.x + 46 - left));
  const originY = Math.max(0, Math.min(height, position.y + 50 - top));
  return { left, top, width, height, transformOrigin: `${originX}px ${originY}px` };
}
export default function AdminValoAICopilotView(props) {
  const { position, open, setOpen, tab, setTab, messages, busy, noticeBusy, input, setInput, submit, decide, notifications, unreadCount, notificationError, filter, setFilter, setSelected, preview, onNotificationClick, refresh, dismissNotice, onPointerDown, onPointerMove, onPointerUp, onTriggerClick, bottomRef, suggestions, dragging, notificationLoading, hasMore, loadMore, markRead, readingIds } = props;
  const panel = useRef(null);
  const trigger = useRef(null);
  const composer = useRef(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector('button')?.focus();
    const outside = (event) => {
      if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape); };
  }, [open, setOpen]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const onKeyDown = (event) => {
    if (event.key === 'Tab') {
      const elements = [...panel.current.querySelectorAll('button:not(:disabled), input, summary, a[href]')].filter((node) => node.getClientRects().length);
      const first = elements[0]; const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  return <>
    <ValoAILauncher {...props} triggerRef={trigger} controls="admin-valo-ai">
      {preview && !open && <button className="valo-ai-preview" type="button" onClick={() => { setOpen(true); setTab('notifications'); setSelected(null); refresh(); }}><AlertTriangle size={17}/><span>New operational notification<small>Show notifications</small></span></button>}
    </ValoAILauncher>
    <aside ref={panel} id="admin-valo-ai" role="dialog" aria-label="VALO AI Admin assistant" aria-hidden={!open} inert={!open} lang="en" onKeyDown={onKeyDown} className={`valo-ai-panel admin-ai-panel ${open ? 'is-open' : ''}`} style={popupStyle(position)}>
      <header className="valo-ai-header"><span className="valo-ai-header-avatar" aria-hidden="true"><ValoAIMascot size={42}/></span><div><h2>VALO AI</h2><p>AI assistant for administrators</p></div><button type="button" onClick={close} aria-label="Close VALO AI"><X size={19}/></button></header>
      <nav className="valo-ai-tabs" aria-label="Assistant sections"><button type="button" aria-pressed={tab === 'chat'} className={tab === 'chat' ? 'active' : ''} onClick={() => { setTab('chat'); composer.current?.focus(); }}>Chat</button><button type="button" aria-pressed={tab === 'notifications'} className={tab === 'notifications' ? 'active' : ''} onClick={() => { setTab('notifications'); refresh(); }}><Bell size={15}/>Notifications{unreadCount > 0 && <b>{unreadCount}</b>}</button></nav>
      {tab === 'chat' ? <>
        <div className="valo-ai-conversation" aria-busy={busy}>
          {!messages.length && <div className="valo-ai-welcome"><span aria-hidden="true"><ValoAIMascot size={31}/></span><div><strong>Hello, Admin! 👋</strong><p>I can check VALO data, analyze it, and prepare drafts for your approval.</p></div></div>}
          {messages.map((row, index) => <div key={index} className={`valo-ai-message-row ${row.role === 'user' ? 'is-user' : 'is-ai'}`}>{row.role !== 'user' && <span className="valo-ai-message-avatar" aria-hidden="true"><ValoAIMascot size={30}/></span>}<div className="valo-ai-message-stack"><div className="valo-ai-message-bubble">{row.role === 'user' ? <p>{row.message}</p> : <AdminChatAnswer row={row} onNavigate={() => setOpen(false)}/>}
            {row.draft && <AdminDraft draft={row.draft} busy={noticeBusy} decide={decide}/>}</div><time>{adminDate(row.at, true)}</time></div></div>)}
          {busy && <div className="valo-ai-message-row is-ai" role="status" aria-label="Checking VALO data"><span className="valo-ai-message-avatar" aria-hidden="true"><ValoAIMascot size={30}/></span><div className="valo-ai-thinking" aria-hidden="true"><i/><i/><i/></div></div>}<div ref={bottomRef}/>
        </div>
        {<div className="valo-ai-suggestions">{suggestions.map((text) => <button type="button" key={text} disabled={busy} onClick={() => submit(text)}>{text}</button>)}</div>}
        <form className="valo-ai-compose" onSubmit={(event) => { event.preventDefault(); submit(); }}><Paperclip size={17} aria-hidden="true"/><input ref={composer} aria-label="Question for VALO AI" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Enter a question for VALO AI..."/><button type="submit" disabled={busy || !input.trim()} aria-label="Send question"><Send size={19}/></button></form>
      </> : <div className="valo-ai-notification-view" aria-busy={notificationLoading}>
        <NotificationFilterBar filter={filter} onFilter={key => { setFilter(key); setSelected(null); }} unreadCount={unreadCount} marking={props.markingAllRead} disabled={readingIds.length > 0} onMarkAllRead={props.markAllRead}/>
        {notificationError && <div className="valo-ai-notification-error" role="alert"><AlertTriangle size={18}/><p>{notificationError}</p><button type="button" onClick={() => refresh()}>Retry</button></div>}
        <>
          {notifications.map((item) => {
            const view = adminNotification(item);
            const Icon = iconFor(item.notificationType);
            const target = exactNotificationTarget(item);
            const severity = String(item.severity || 'INFO').toUpperCase();
            const status = String(item.status || 'OPEN').toUpperCase();
            return <article key={item._id} className={`valo-ai-notification severity-${severity.toLowerCase()} ${target ? 'has-target' : ''} ${item.isRead ? 'is-read' : 'is-unread'}`}>
              {target && <Link className="admin-ai-notice-target" to={target} aria-label={`Go to ${view.title}`} onClick={(event) => { event.preventDefault(); onNotificationClick(item); }}/>}
              <div className="valo-ai-notice-content">
                <div className="valo-ai-notice-open">
                <small className={severity === 'CRITICAL' ? 'critical' : ''}><Icon size={12}/>{severity}{!item.isRead && <span aria-label="Unread">{String.fromCharCode(9679)}</span>}</small>
                <strong>{view.title}</strong>
                <p><NotificationSummary item={item} text={view.summary}/></p>
                <time title={adminDate(item.detectedAt)}>{relativeTime(item.detectedAt)}</time>
                {status === 'RESOLVED' && <em>Resolved by {item.resolvedBy?.username || 'Admin'}</em>}
                {status === 'CLEARED' && <em>The signal has returned to normal.</em>}
                </div>
                {!item.isRead && <div className="valo-ai-notice-actions"><button type="button" className="valo-ai-mark-read" aria-label="Mark as read" title="Mark as read" disabled={props.markingAllRead || readingIds.includes(item._id)} onClick={(event) => { event.stopPropagation(); markRead(item._id); }}><Check size={12} aria-hidden="true"/><span className="sr-only">{readingIds.includes(item._id) ? 'Marking...' : 'Mark as read'}</span></button></div>}
              </div>
              <button type="button" aria-label={`Delete ${view.title}`} onClick={(event) => { event.stopPropagation(); dismissNotice(item._id); }}><Trash2 size={13}/></button>
            </article>;
          })}
          {notificationLoading && <p role="status" className="admin-ai-progress"><Loader2 size={18} className="admin-ai-spin"/>Loading notifications…</p>}
          {!notificationLoading && !notificationError && !notifications.length && <p className="valo-ai-empty">No notifications match this filter.</p>}
          {hasMore && <button type="button" className="admin-ai-load-more" disabled={notificationLoading} onClick={loadMore}>Load more notifications</button>}
        </>
      </div>}
      <footer>VALO AI can prepare actions; changes are applied only after your confirmation.</footer>
    </aside>
  </>;
}
