import { useState } from 'react';
import { Bell, Check, Send, X, Trash2, AlertTriangle, Paperclip, MapPin, CalendarDays, CreditCard, UserPlus, Car, ShieldAlert } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import ValoAIMascot from './ValoAIMascot';
import ValoAILauncher from './ValoAILauncher';
import AIMessageMarkdown from './AIMessageMarkdown';
import StaffCustomerCards from './StaffCustomerCards';
import { AdminDraft } from './AdminChatContent';
import { notificationClickTarget } from '../utils/notificationTarget';
import { NotificationFilterBar, NotificationSummary } from './NotificationCenterControls';
import { adminDate, adminNotification, adminActions } from '../utils/adminPresentation';
import '../styles/ValoAICopilot.css';

const fieldLabels = {
  firstName: 'First name', lastName: 'Last name', phone: 'Phone', name: 'Name', type: 'Type', price: 'Price', description: 'Description', maxSlots: 'Maximum spaces', timeCost: 'Duration (minutes)',
  cap12h: '12-hour cap', cap24h: '24-hour cap', timeBlocks: 'Time blocks', isActive: 'Active', status: 'Status', title: 'Title',
  category: 'Category', summary: 'Summary', content: 'Content', effectiveDate: 'Effective date', role: 'Role', username: 'Recipient', email: 'Email', expectedRecipientRole: 'Recipient role'
};
const time = value => adminDate(value, true);
const pretty = (value, key) => {
  if (key === 'status' && typeof value === 'boolean') return value ? 'Active' : 'Disabled';
  const labels = { pending: 'Pending approval', approved: 'Approved', archived: 'Archived', guest: 'Guest', customer: 'Customer', staff: 'Staff', admin: 'Admin' };
  if (['status', 'role'].includes(key) && typeof value === 'string') return labels[value] || value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' ? `${item.startHour}:00-${item.endHour}:00: ${Number(item.price).toLocaleString('en-GB')} VND` : String(item)).join(' / ');
  if (typeof value === 'number') return value.toLocaleString('en-GB');
  return String(value ?? 'Not available');
};
const typeLabel = { MODIFY_PRICING: 'Modify pricing', CREATE_TICKET_PACKAGE: 'Create ticket package', UPDATE_TICKET_PACKAGE: 'Update ticket package', UPDATE_USER_STATUS: 'Change account status', SEND_NOTIFICATION: 'Send notification', CHANGE_USER_ROLE: 'Change account role', APPROVE_VEHICLE: 'Approve vehicle', CREATE_POLICY_DRAFT: 'Create policy draft', ARCHIVE_POLICY: 'Archive policy', CREATE_SERVICE: 'Create service', UPDATE_SERVICE: 'Update service', ARCHIVE_SERVICE: 'Archive service' };
function DraftCard({ draft, busy, onDecide, userRole }) {
  const [settled, setSettled] = useState(null); // 'approved' | 'rejected' | null
  const isSendNotification = draft.type === 'SEND_NOTIFICATION';
  const handleDecide = async (approve) => {
    if (settled) return;
    const succeeded = await onDecide(draft, approve);
    if (succeeded) setSettled(approve ? 'approved' : 'rejected');
  };
  return <div className={`valo-ai-draft ${settled ? `is-${settled}` : ''}`}>
    <div className="valo-ai-draft-header">
      <strong>{userRole === 'staff' ? 'CHANGE REQUIRING CONFIRMATION' : 'Proposed change'}</strong>
      <span className={`valo-ai-draft-badge ${settled === 'approved' ? 'badge-approved' : settled === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
        {settled === 'approved' ? (isSendNotification ? 'Sent' : 'Applied') : settled === 'rejected' ? 'Rejected' : (userRole === 'staff' ? 'Confirmation required' : 'Pending approval')}
      </span>
    </div>
    <p className="valo-ai-draft-type"><b>Type:</b> {typeLabel[draft.type] || draft.type}</p>
    {draft.reason && <p className="valo-ai-draft-reason"><b>Reason:</b> {draft.reason}</p>}
    {isSendNotification ? <dl>
      <div><dt>Recipient</dt><dd>{draft.current?.username || '—'}</dd></div>
      <div><dt>Role</dt><dd>{pretty(draft.current?.role, 'role')}</dd></div>
      <div><dt>Title</dt><dd>{draft.payload?.title}</dd></div>
      <div><dt>Content</dt><dd>{draft.payload?.content}</dd></div>
    </dl> : <>
      {draft.current && <details><summary>Current values</summary><dl>{Object.entries(draft.current).filter(([key]) => key in fieldLabels).map(([key, value]) => <div key={key}><dt>{fieldLabels[key]}</dt><dd>{pretty(value, key)}</dd></div>)}</dl></details>}
      {draft.payload && Object.keys(draft.payload).length > 0 && <details open><summary>Proposed change</summary><dl>{Object.entries(draft.payload).map(([key, value]) => <div key={key}><dt>{fieldLabels[key] || key}</dt><dd>{pretty(value, key)}</dd></div>)}</dl></details>}
      {draft.type === 'CREATE_SERVICE' && <p className="valo-ai-draft-warning"><AlertTriangle size={14}/> VALO AI cannot upload images. Add images on the Services page after approval.</p>}
    </>}
    {!settled && <div className="valo-ai-draft-actions">
      <button type="button" disabled={busy} onClick={() => handleDecide(false)}>Reject</button>
      <button type="button" disabled={busy} onClick={() => handleDecide(true)}>{isSendNotification ? 'Approve & send' : userRole === 'staff' ? 'Confirm & apply' : 'Approve & apply'}</button>
    </div>}
  </div>;
}

function Message({ row, busy, onDecide, userRole, onNavigate }) {
  const user = row.role === 'user';
  const customerResult = row.accountResult || (() => { const latest = row.evidence?.at(-1); const entry = ['search_users', 'get_user_detail'].includes(latest?.tool) ? latest : null; return entry ? entry.data?.items ? entry.data : { items: [entry.data], total: 1 } : null; })();
  return <div className={`valo-ai-message-row ${user ? 'is-user' : 'is-ai'}`}>
    {!user && <span className="valo-ai-message-avatar"><ValoAIMascot size={30}/></span>}
    <div className="valo-ai-message-stack">
      <div className="valo-ai-message-bubble">{user ? <p>{row.message}</p> : customerResult && !row.draft && row.type !== 'error' ? <StaffCustomerCards result={customerResult} onNavigate={onNavigate}/> : <AIMessageMarkdown text={String(row.message || '').split('\n').filter(line => !/^\s*\*{0,2}(?:sources?|timestamp|updated at|verification time|tool)\*{0,2}\s*[:\-]/i.test(line)).join('\n')}/>}
        {row.draft && (['UPDATE_USER_STATUS', 'UPDATE_USER_PROFILE'].includes(row.draft.type) ? <AdminDraft draft={row.draft} busy={busy} decide={onDecide}/> : <DraftCard draft={row.draft} busy={busy} onDecide={onDecide} userRole={userRole}/>)}
      </div>
      <time>{row.at ? time(row.at) : ''}</time>
    </div>
  </div>;
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

const noticeIcon = (type) => type === 'FLOOR_FULL' ? <MapPin size={15}/> : type === 'NEW_BOOKING' ? <CalendarDays size={15}/> : type === 'REFUND_COMPLETED' ? <CreditCard size={15}/> : type === 'NEW_USER_REGISTERED' ? <UserPlus size={15}/> : type === 'NEW_SESSION' ? <Car size={15}/> : type === 'VEHICLE_PENDING_VERIFICATION' ? <ShieldAlert size={15}/> : <Bell size={15}/>;
const noticeTime = (value) => value ? formatDistanceToNow(new Date(value), { addSuffix: true }) : '';

export default function ValoAICopilotView({ mascotRef, mascotVisible, position, open, setOpen, tab, setTab, messages, busy, noticeBusy, input, setInput, submit, decide, notifications, unreadCount, notificationError, filter, setFilter, selected, setSelected, preview, openNotice, onNotificationClick, refresh, dismissNotice, onPointerDown, onPointerMove, onPointerUp, onTriggerClick, bottomRef, suggestions, dragging, markRead, readingIds = [], markAllRead, markingAllRead, notificationLoading, userRole = 'admin' }) {

  return <>
    <ValoAILauncher position={position} mascotRef={mascotRef} mascotVisible={mascotVisible} open={open} busy={busy} preview={preview} dragging={dragging} unreadCount={unreadCount} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onTriggerClick={onTriggerClick}>
      {preview && !open && <button type="button" className="valo-ai-preview" onClick={() => openNotice(preview.id)}><AlertTriangle size={17}/><span>New operational notification<small>View details →</small></span></button>}
    </ValoAILauncher>
    <aside aria-label="VALO AI" aria-hidden={!open} inert={!open} className={`valo-ai-panel ${open ? 'is-open' : ''}`} style={popupStyle(position)}>
      <header className="valo-ai-header"><span className="valo-ai-header-avatar"><ValoAIMascot size={42}/></span><div><h2>VALO AI</h2><p>AI assistant for {userRole === 'staff' ? 'staff' : 'administrators'}</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Close VALO AI"><X size={19}/></button></header>
      <nav className="valo-ai-tabs" aria-label="VALO AI tabs"><button type="button" className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>Chat</button><button type="button" className={tab === 'notifications' ? 'active' : ''} onClick={() => { setTab('notifications'); refresh(); }}><Bell size={15}/> Notifications {unreadCount > 0 && <b>{unreadCount}</b>}</button></nav>
      {tab === 'chat' ? <>
        <div className="valo-ai-conversation">
          {!messages.length && <div className="valo-ai-welcome"><ValoAIMascot size={31}/><div><strong>Hello {userRole === 'staff' ? 'Staff' : 'Admin'}! 👋</strong><p>{userRole === 'staff' ? 'I can help you look up parking sessions, bookings, customers, and parking availability.' : 'I can check VALO data, analyze it, and prepare drafts for approval.'}</p></div></div>}
          {messages.map((row, index) => <Message key={index} row={row} busy={noticeBusy} onDecide={decide} userRole={userRole} onNavigate={() => setOpen(false)}/>)}
          {busy && <div className="valo-ai-message-row is-ai"><span className="valo-ai-message-avatar"><ValoAIMascot size={30}/></span><div className="valo-ai-thinking" aria-label="VALO AI is checking data"><i/><i/><i/></div></div>}
          <div ref={bottomRef}/>
        </div>
        {!messages.length && <div className="valo-ai-suggestions">{suggestions.map((text) => <button type="button" key={text} onClick={() => submit(text)}>{text}</button>)}</div>}
        <form className="valo-ai-compose" onSubmit={(event) => { event.preventDefault(); submit(); }}><Paperclip size={17} aria-hidden="true"/><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Enter a question for VALO AI..."/><button type="submit" disabled={busy} aria-label="Send question"><Send size={19}/></button></form>
      </> : <div className="valo-ai-notification-view" aria-busy={notificationLoading}>
        <NotificationFilterBar filter={filter} onFilter={key => { setFilter(key); setSelected(null); }} unreadCount={unreadCount} marking={markingAllRead} disabled={readingIds.length > 0} onMarkAllRead={markAllRead}/>
        {notificationError && <p className="valo-ai-notification-error" role="alert">{notificationError}</p>}
        {selected ? <article className="valo-ai-notification-detail"><button type="button" onClick={() => setSelected(null)}>Back to notifications</button><h3>{adminNotification(selected).title}</h3><p><NotificationSummary item={selected} text={adminNotification(selected).summary}/></p><small>{selected.severity} &middot; {adminDate(selected.detectedAt)}</small><h4>Evidence</h4><pre>{JSON.stringify(selected.evidence, null, 2)}</pre>{adminActions(selected.notificationType).map((action, i) => <p key={i}>&bull; {action}</p>)}{selected.status === 'RESOLVED' && <p className="resolved"><Check size={12}/> Resolved by {selected.resolvedBy?.username || 'Admin'} at {adminDate(selected.resolvedAt)}</p>}{selected.status === 'CLEARED' && <p>The signal has returned to normal.</p>}</article>
          : notifications.length ? notifications.map(storedItem => { const item = adminNotification(storedItem); return <article key={item._id} className={`valo-ai-notification severity-${String(item.severity || 'INFO').toLowerCase()} ${item.isRead ? 'is-read' : 'is-unread'} ${notificationClickTarget(item, userRole) ? 'has-target' : ''}`}>
            <div className="valo-ai-notice-content">
              <button type="button" className="valo-ai-notice-open" onClick={() => onNotificationClick(storedItem)}>
                <small className={item.severity === 'CRITICAL' ? 'critical' : ''}>{noticeIcon(item.notificationType)} {item.severity} {!item.isRead && <span aria-label="Unread">{String.fromCharCode(9679)}</span>}</small>
                <strong>{item.title}</strong><p><NotificationSummary item={item} text={item.summary}/></p><time title={adminDate(item.detectedAt)}>{noticeTime(item.detectedAt)}</time>
                {item.status === 'RESOLVED' && <em>Resolved by {item.resolvedBy?.username || 'Admin'}</em>}{item.status === 'CLEARED' && <em>The signal has returned to normal.</em>}
              </button>
              {!item.isRead && <div className="valo-ai-notice-actions"><button type="button" className="valo-ai-mark-read" aria-label="Mark as read" title="Mark as read" disabled={markingAllRead || readingIds.includes(item._id)} onClick={() => markRead(item._id)}><Check size={12} aria-hidden="true"/><span className="sr-only">{readingIds.includes(item._id) ? 'Marking...' : 'Mark as read'}</span></button></div>}
            </div>
            <button type="button" aria-label="Dismiss notification" onClick={() => dismissNotice(item._id)}><Trash2 size={13}/></button>
          </article>; }) : !notificationLoading && !notificationError && <p className="valo-ai-empty">No notifications match this filter.</p>}
        {notificationLoading && <p role="status" className="valo-ai-progress">Loading notifications...</p>}
      </div>}
      <footer>{userRole === 'staff' ? 'VALO AI can prepare actions; changes are applied only after your confirmation.' : 'VALO AI reads and analyzes data. Changes require your confirmation.'}</footer>
    </aside>
  </>;
}
