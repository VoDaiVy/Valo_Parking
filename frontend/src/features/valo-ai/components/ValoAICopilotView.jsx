import { useState } from 'react';
import { Bell, Check, Send, X, Trash2, AlertTriangle, Paperclip, MapPin, CalendarDays, CreditCard } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';
import ValoAIMascot from './ValoAIMascot';
import AIMessageMarkdown from './AIMessageMarkdown';
import { sourceLabel, sourceUpdatedAt } from '../utils/aiSourceLabels';
import { notificationTarget } from '../utils/notificationTarget';
import '../styles/ValoAICopilot.css';

const fieldLabels = {
  name: 'Tên gói', type: 'Loại', price: 'Giá', description: 'Mô tả', maxSlots: 'Số chỗ tối đa',
  cap12h: 'Trần 12 giờ', cap24h: 'Trần 24 giờ', timeBlocks: 'Khung giờ', isActive: 'Đang hoạt động',
  status: 'Trạng thái', title: 'Tiêu đề', category: 'Phân loại', summary: 'Tóm tắt', content: 'Nội dung', effectiveDate: 'Ngày hiệu lực', role: 'Vai trò', username: 'Người nhận', email: 'Email', expectedRecipientRole: 'Vai trò người nhận'
};
const time = (value) => new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const dateTime = (value) => new Date(value).toLocaleString('vi-VN');
const pretty = (value, key) => {
  if (key === 'status' && typeof value === 'boolean') return value ? 'Đang hoạt động' : 'Bị khóa';
  if (key === 'status' && typeof value === 'string') {
    if (value === 'pending') return 'Chờ duyệt';
    if (value === 'approved') return 'Đã duyệt';
    if (value === 'archived') return 'Đã lưu trữ';
    return value;
  }
  if (key === 'role' && typeof value === 'string') {
    if (value === 'guest') return 'Khách vãng lai';
    if (value === 'customer') return 'Khách hàng';
    if (value === 'staff') return 'Nhân viên';
    if (value === 'admin') return 'Quản trị viên';
    return value;
  }
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (Array.isArray(value)) return value.map((item) => typeof item === 'object' ? `${item.startHour}:00–${item.endHour}:00: ${Number(item.price).toLocaleString('vi-VN')} đ` : String(item)).join(' · ');
  if (typeof value === 'number') return value.toLocaleString('vi-VN');
  return String(value ?? '—');
};
const typeLabel = { MODIFY_PRICING: 'Điều chỉnh bảng giá', CREATE_TICKET_PACKAGE: 'Tạo gói vé mới', UPDATE_TICKET_PACKAGE: 'Cập nhật gói vé', UPDATE_USER_STATUS: 'Đề xuất thay đổi tài khoản', SEND_NOTIFICATION: 'Gửi thông báo', CHANGE_USER_ROLE: 'Đề xuất thay đổi vai trò', APPROVE_VEHICLE: 'Đề xuất duyệt phương tiện', CREATE_POLICY_DRAFT: 'Đề xuất tạo bản nháp chính sách', ARCHIVE_POLICY: 'Đề xuất lưu trữ chính sách' };
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
      <strong>{userRole === 'staff' ? 'THAY ĐỔI CẦN XÁC NHẬN' : 'ĐỀ XUẤT THAY ĐỔI'}</strong>
      <span className={`valo-ai-draft-badge ${settled === 'approved' ? 'badge-approved' : settled === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
        {settled === 'approved' ? (isSendNotification ? 'Đã gửi' : 'Đã áp dụng') : settled === 'rejected' ? 'Đã từ chối' : (userRole === 'staff' ? 'Cần xác nhận' : 'Chờ duyệt')}
      </span>
    </div>
    <p className="valo-ai-draft-type"><b>Loại:</b> {typeLabel[draft.type] || draft.type}</p>
    {draft.reason && <p className="valo-ai-draft-reason"><b>Lý do:</b> {draft.reason}</p>}
    {isSendNotification ? <dl>
      <div><dt>Người nhận</dt><dd>{draft.current?.username || '—'}</dd></div>
      <div><dt>Vai trò</dt><dd>{pretty(draft.current?.role, 'role')}</dd></div>
      <div><dt>Tiêu đề</dt><dd>{draft.payload?.title}</dd></div>
      <div><dt>Nội dung</dt><dd>{draft.payload?.content}</dd></div>
    </dl> : <>
      {draft.current && <details><summary>Giá trị hiện tại</summary><dl>{Object.entries(draft.current).filter(([key]) => key in fieldLabels).map(([key, value]) => <div key={key}><dt>{fieldLabels[key]}</dt><dd>{pretty(value, key)}</dd></div>)}</dl></details>}
      {draft.payload && Object.keys(draft.payload).length > 0 && <details open><summary>Đề xuất thay đổi</summary><dl>{Object.entries(draft.payload).map(([key, value]) => <div key={key}><dt>{fieldLabels[key] || key}</dt><dd>{pretty(value, key)}</dd></div>)}</dl></details>}
    </>}
    {draft.evidence?.length > 0 && <p className="valo-ai-draft-evidence-hint">📊 Dựa trên {draft.evidence.length} nguồn dữ liệu</p>}
    {!settled && <div className="valo-ai-draft-actions">
      <button type="button" disabled={busy} onClick={() => handleDecide(false)}>Từ chối</button>
      <button type="button" disabled={busy} onClick={() => handleDecide(true)}>{isSendNotification ? 'Duyệt & gửi' : userRole === 'staff' ? 'Xác nhận & áp dụng' : 'Duyệt & áp dụng'}</button>
    </div>}
  </div>;
}

function Message({ row, busy, onDecide, userRole }) {
  const user = row.role === 'user';
  const sources = row.evidence?.map((entry) => ({ label: sourceLabel(entry), updatedAt: sourceUpdatedAt(entry.timestamp) })) || [];
  return <div className={`valo-ai-message-row ${user ? 'is-user' : 'is-ai'}`}>
    {!user && <span className="valo-ai-message-avatar"><ValoAIMascot size={30}/></span>}
    <div className="valo-ai-message-stack">
      <div className="valo-ai-message-bubble">{user ? <p>{row.message}</p> : <AIMessageMarkdown text={row.message}/>}
        {sources.length > 0 && <details className="valo-ai-evidence"><summary>Xem dữ liệu nguồn</summary>{sources.length > 1 && <strong>Nguồn dữ liệu</strong>}<ul>{sources.map((entry, i) => <li key={i}>{entry.label}{entry.updatedAt && <small>{entry.updatedAt}</small>}</li>)}</ul></details>}
        {row.draft && <DraftCard draft={row.draft} busy={busy} onDecide={onDecide} userRole={userRole}/>}
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

const noticeIcon = (type) => type === 'FLOOR_FULL' ? <MapPin size={15}/> : type === 'NEW_BOOKING' ? <CalendarDays size={15}/> : type === 'REFUND_COMPLETED' ? <CreditCard size={15}/> : <Bell size={15}/>;
const noticeTime = (value) => value ? formatDistanceToNow(new Date(value), { addSuffix: true, locale: vi }) : '';

export default function ValoAICopilotView({ position, open, setOpen, tab, setTab, messages, busy, noticeBusy, input, setInput, submit, decide, notifications, unreadCount, notificationError, filter, setFilter, selected, setSelected, preview, openNotice, onNotificationClick, refresh, dismissNotice, onPointerDown, onPointerMove, onPointerUp, onTriggerClick, bottomRef, suggestions, filters, dragging, userRole = 'admin' }) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const onMascotMove = (event) => {
    onPointerMove(event);
    if (dragging) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setTilt({ x: ((event.clientY - rect.top) / rect.height - 0.5) * -12, y: ((event.clientX - rect.left) / rect.width - 0.5) * 12 });
  };
  return <>
    <div className="valo-ai-anchor" style={{ left: position.x, top: position.y }}>
      {preview && !open && <button type="button" className="valo-ai-preview" onClick={() => openNotice(preview.id)}><AlertTriangle size={17}/><span>{preview.title?.slice(0, 60)}<small>Xem chi tiết →</small></span></button>}
      <button type="button" aria-label="Mở VALO AI" className={`valo-ai-trigger ${dragging ? 'is-dragging' : ''} ${busy ? 'is-thinking' : ''} ${preview ? 'has-notification' : ''} ${open ? 'is-open' : ''}`} onPointerDown={onPointerDown} onPointerMove={onMascotMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={() => setTilt({ x: 0, y: 0 })} onClick={onTriggerClick}>
        <span className="valo-ai-platform"/><span className="valo-ai-car" style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}><ValoAIMascot size={82}/></span>
        {unreadCount > 0 && <span key={unreadCount} className="valo-ai-badge">{unreadCount}</span>}
        <span className="valo-ai-label">VALO AI</span>
      </button>
    </div>
    <aside aria-label="VALO AI" aria-hidden={!open} inert={!open} className={`valo-ai-panel ${open ? 'is-open' : ''}`} style={popupStyle(position)}>
      <header className="valo-ai-header"><span className="valo-ai-header-avatar"><ValoAIMascot size={42}/></span><div><h2>VALO AI</h2><p>Trợ lý AI cho {userRole === 'staff' ? 'nhân viên' : 'quản trị viên'}</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Đóng VALO AI"><X size={19}/></button></header>
      <nav className="valo-ai-tabs" aria-label="VALO AI tabs"><button type="button" className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>Trò chuyện</button><button type="button" className={tab === 'notifications' ? 'active' : ''} onClick={() => { setTab('notifications'); refresh(); }}><Bell size={15}/> Thông báo {unreadCount > 0 && <b>{unreadCount}</b>}</button></nav>
      {tab === 'chat' ? <>
        <div className="valo-ai-conversation">
          {!messages.length && <div className="valo-ai-welcome"><ValoAIMascot size={31}/><div><strong>Xin chào {userRole === 'staff' ? 'Staff' : 'Admin'}! 👋</strong><p>{userRole === 'staff' ? 'Tôi có thể hỗ trợ bạn tra cứu phiên đỗ xe, booking, khách hàng và tình trạng bãi đỗ.' : 'Tôi có thể kiểm tra dữ liệu VALO, phân tích và chuẩn bị bản nháp để bạn duyệt.'}</p></div></div>}
          {messages.map((row, index) => <Message key={index} row={row} busy={noticeBusy} onDecide={decide} userRole={userRole}/>)}
          {busy && <div className="valo-ai-message-row is-ai"><span className="valo-ai-message-avatar"><ValoAIMascot size={30}/></span><div className="valo-ai-thinking" aria-label="VALO AI đang kiểm tra dữ liệu"><i/><i/><i/></div></div>}
          <div ref={bottomRef}/>
        </div>
        <div className="valo-ai-suggestions">{suggestions.map((text) => <button type="button" key={text} onClick={() => submit(text)}>{text}</button>)}</div>
        <form className="valo-ai-compose" onSubmit={(event) => { event.preventDefault(); submit(); }}><Paperclip size={17} aria-hidden="true"/><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Nhập câu hỏi cho VALO AI..."/><button type="submit" disabled={busy} aria-label="Gửi câu hỏi"><Send size={19}/></button></form>
      </> : <div className="valo-ai-notification-view">
        <div className="valo-ai-filters">{filters.map(([key, label]) => <button type="button" className={filter === key ? 'active' : ''} key={key} onClick={() => { setFilter(key); setSelected(null); refresh(key); }}>{label}</button>)}</div>
        {notificationError && <p className="valo-ai-notification-error" role="alert">{notificationError}</p>}
        {selected ? <article className="valo-ai-notification-detail"><button type="button" onClick={() => setSelected(null)}>← Danh sách</button><h3>{selected.title}</h3><p>{selected.summary}</p><small>{selected.severity} · {dateTime(selected.detectedAt)}</small><h4>Bằng chứng</h4><pre>{JSON.stringify(selected.evidence, null, 2)}</pre>{selected.recommendedActions?.map((action, i) => <p key={i}>• {action}</p>)}{selected.status === 'RESOLVED' && <p className="resolved"><Check size={15}/> Đã được {selected.resolvedBy?.username || 'Admin'} xử lý lúc {dateTime(selected.resolvedAt)}</p>}{selected.status === 'CLEARED' && <p>Tín hiệu đã trở về mức thông thường.</p>}</article>
          : notifications.length ? notifications.map((item) => <article key={item._id} className={`valo-ai-notification ${item.isRead ? 'is-read' : 'is-unread'} ${notificationTarget(item.targetRoute) ? 'has-target' : ''}`}><button type="button" onClick={() => onNotificationClick(item)}><small className={item.severity === 'CRITICAL' ? 'critical' : ''}>{noticeIcon(item.notificationType)} {item.severity} {!item.isRead && '●'}</small><strong>{item.title}</strong><p>{item.summary}</p><time title={dateTime(item.detectedAt)}>{noticeTime(item.detectedAt)}</time>{item.status === 'RESOLVED' && <em>Đã xử lý bởi {item.resolvedBy?.username || 'Admin'}</em>}{item.status === 'CLEARED' && <em>Tín hiệu đã trở về mức thông thường</em>}</button><button type="button" aria-label="Bỏ qua cảnh báo" onClick={() => dismissNotice(item._id)}><Trash2 size={16}/></button></article>) : <p className="valo-ai-empty">Hiện chưa có vấn đề đáng chú ý.</p>}
      </div>}
      <footer>{userRole === 'staff' ? 'VALO AI có thể chuẩn bị thao tác; mọi thay đổi chỉ được áp dụng sau khi bạn xác nhận.' : 'VALO AI chỉ đọc và phân tích dữ liệu. Mọi thay đổi đều cần bạn xác nhận.'}</footer>
    </aside>
  </>;
}
