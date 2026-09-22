import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SocketContext from '../../../contexts/SocketProvider';
import ValoAICopilotView from './ValoAICopilotView';
import { sendAIMessage, getAINotifications, getAINotification, markAINotificationRead, dismissAINotification, approveAIDraft, rejectAIDraft } from '../services/aiCopilotService';
import { notificationTarget } from '../utils/notificationTarget';

const STORAGE_KEY = 'valo-ai-position-v1';
const WIDGET_WIDTH = 92;
const WIDGET_HEIGHT = 100;
const clamp = (x, y) => ({ x: Math.max(0, Math.min(x, window.innerWidth - WIDGET_WIDTH)), y: Math.max(0, Math.min(y, window.innerHeight - WIDGET_HEIGHT)) });
const getRole = () => { try { return JSON.parse(sessionStorage.getItem('valo_user') || '{}').role || 'admin'; } catch { return 'admin'; } };

const adminSuggestions = ['Có rủi ro nào không?', 'Gợi ý điều chỉnh giá', 'Xem lượt xe hôm nay', 'Hôm nay đã duyệt bao nhiêu xe?'];
const staffSuggestions = ['Xe nào đang đỗ trong bãi?', 'Tìm booking gần đây', 'Các vị trí còn trống'];
const filters = [['all', 'Tất cả'], ['unread', 'Chưa đọc'], ['warning', 'Cảnh báo'], ['critical', 'Nghiêm trọng']];

export default function ValoAICopilot() {
  const userRole = getRole();
  const suggestions = userRole === 'staff' ? staffSuggestions : adminSuggestions;
  const navigate = useNavigate();
  const socket = useContext(SocketContext);
  const [position, setPosition] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) return clamp(saved.x, saved.y); } catch { /* invalid saved position */ }
    return clamp(window.innerWidth - WIDGET_WIDTH - 24, window.innerHeight - WIDGET_HEIGHT - 24);
  });
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('chat');
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationError, setNotificationError] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const drag = useRef(null);
  const dragged = useRef(false);
  const previewTimer = useRef(null);
  const seenNotificationIds = useRef(null);
  const bottomRef = useRef(null);

  const refresh = useCallback(async (nextFilter = filter) => {
    const response = await getAINotifications(nextFilter);
    if (response.ok) { setNotifications(response.data.data.notifications || []); setUnreadCount(response.data.data.unreadCount || 0); setNotificationError(''); }
    else setNotificationError(response.data?.message || 'Không thể tải thông báo VALO AI.');
  }, [filter]);
  useEffect(() => { const onResize = () => setPosition((p) => clamp(p.x, p.y)); window.addEventListener('resize', onResize); return () => window.removeEventListener('resize', onResize); }, []);
  useEffect(() => {
    let active = true;
    getAINotifications(filter).then((response) => { if (active && response.ok) { setNotifications(response.data.data.notifications || []); setUnreadCount(response.data.data.unreadCount || 0); setNotificationError(''); if (filter === 'all' && !seenNotificationIds.current) seenNotificationIds.current = new Set((response.data.data.notifications || []).map((item) => String(item._id))); } else if (active) setNotificationError(response.data?.message || 'Không thể tải thông báo VALO AI.'); });
    return () => { active = false; };
  }, [filter]);
  useEffect(() => {
    const timer = setInterval(async () => {
      const response = await getAINotifications('all');
      if (!response.ok) return;
      const rows = response.data.data.notifications || [];
      setUnreadCount(response.data.data.unreadCount || 0);
      if (!seenNotificationIds.current) { seenNotificationIds.current = new Set(rows.map((item) => String(item._id))); return; }
      const latest = rows.find((item) => !seenNotificationIds.current.has(String(item._id)) && ['WARNING', 'CRITICAL'].includes(item.severity));
      rows.forEach((item) => seenNotificationIds.current.add(String(item._id)));
      if (latest) { setPreview({ id: latest._id, title: latest.title, severity: latest.severity }); clearTimeout(previewTimer.current); previewTimer.current = setTimeout(() => setPreview(null), 8000); }
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!socket) return undefined;
    const onNotice = (event) => {
      refresh();
      seenNotificationIds.current?.add(String(event.id));
      if (!['WARNING', 'CRITICAL'].includes(event.severity)) return;
      setPreview(event);
      clearTimeout(previewTimer.current);
      previewTimer.current = setTimeout(() => setPreview(null), 8000);
    };
    socket.on('ai:notification', onNotice);
    return () => { socket.off('ai:notification', onNotice); clearTimeout(previewTimer.current); };
  }, [socket, refresh]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);

  const onPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, position };
    dragged.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event) => {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) dragged.current = true;
    if (dragged.current) { const next = clamp(drag.current.position.x + dx, drag.current.position.y + dy); drag.current.latest = next; setPosition(next); setDragging(true); }
  };
  const onPointerUp = () => {
    if (drag.current && dragged.current) localStorage.setItem(STORAGE_KEY, JSON.stringify(drag.current.latest || position));
    drag.current = null;
    setDragging(false);
    if (dragged.current) setTimeout(() => { dragged.current = false; }, 0);
  };
  const openNotice = async (id) => {
    setOpen(true); setTab('notifications'); setPreview(null);
    const response = await getAINotification(id);
    if (response.ok) { setSelected(response.data.data); await markAINotificationRead(id); refresh(); }
  };
  const onNotificationClick = async (item) => {
    let rawRoute = item.targetRoute;
    if (rawRoute === '/admin/bookings' && item.entityType === 'booking' && item.entityId) {
      rawRoute = `/admin/parking-lots?bookingId=${item.entityId}`;
    }
    let target = notificationTarget(rawRoute);
    if (target && userRole === 'staff') {
      target = target.replace(/^\/admin\//, '/staff/');
    }
    if (!target) return openNotice(item._id);
    setPreview(null);
    try { await markAINotificationRead(item._id); }
    catch (error) { console.error('[VALO AI Notification] mark read:', error); }
    refresh();
    setOpen(false);
    navigate(target);
  };
  const submit = async (value = input) => {
    const message = value.trim(); if (!message || busy) return;
    setInput(''); setMessages((rows) => [...rows, { role: 'user', message, at: Date.now() }]); setBusy(true); setOpen(true); setTab('chat');
    const response = await sendAIMessage(message, conversationId);
    if (response.ok) { setConversationId(response.data.data.conversationId); setMessages((rows) => [...rows, { role: 'ai', ...response.data.data, at: Date.now() }]); }
    else setMessages((rows) => [...rows, { role: 'ai', type: 'error', message: response.data?.message || 'Không thể kết nối VALO AI.', at: Date.now() }]);
    setBusy(false);
  };
  const decide = async (draft, approve) => {
    if (noticeBusy) return false; setNoticeBusy(true);
    const response = approve ? await approveAIDraft(draft.id) : await rejectAIDraft(draft.id);
    if (response.ok) setMessages((rows) => rows.map((row) => row.draft?.id === draft.id ? { ...row, draft: null } : row));
    setMessages((rows) => [...rows, { role: 'ai', type: response.ok ? 'analysis' : 'error', message: response.ok ? (approve ? (draft.type === 'SEND_NOTIFICATION' ? 'Đã gửi thông báo.' : 'Đã áp dụng bản nháp.') : 'Đã từ chối bản nháp.') : response.data?.message || 'Không xử lý được bản nháp.', at: Date.now() }]);
    if (response.ok) refresh(); setNoticeBusy(false);
    return response.ok;
  };

  const onTriggerClick = () => {
    if (!dragged.current) setOpen((prev) => !prev);
    dragged.current = false;
  };
  const dismissNotice = async (id) => {
    const response = await dismissAINotification(id);
    if (response.ok) {
      if (selected?._id === id) setSelected(null);
      refresh();
    }
  };

  return <ValoAICopilotView
    position={position} open={open} setOpen={setOpen} tab={tab} setTab={setTab}
    messages={messages} busy={busy} noticeBusy={noticeBusy} input={input} setInput={setInput}
    submit={submit} decide={decide} notifications={notifications} unreadCount={unreadCount} notificationError={notificationError}
    filter={filter} setFilter={setFilter} selected={selected} setSelected={setSelected}
    preview={preview} openNotice={openNotice} onNotificationClick={onNotificationClick} refresh={refresh} dismissNotice={dismissNotice}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
    onTriggerClick={onTriggerClick} bottomRef={bottomRef} suggestions={suggestions} filters={filters}
    dragging={dragging} userRole={userRole}
  />;
}

