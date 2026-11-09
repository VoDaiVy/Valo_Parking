import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SocketContext from '../../../contexts/SocketProvider';
import ValoAICopilotView from './ValoAICopilotView';
import { sendAIMessage, getAINotifications, getAINotification, markAINotificationRead, dismissAINotification, approveAIDraft, rejectAIDraft } from '../services/aiCopilotService';
import { notificationClickTarget } from '../utils/notificationTarget';
import AdminValoAICopilotView from './AdminValoAICopilotView';
import { adminSuggestions as englishSuggestions } from '../utils/adminPresentation';
import useMascotPosition from '../hooks/useMascotPosition';
import { applyNotificationRead, markAllUnreadNotifications } from '../utils/notificationReadState';

const getRole = () => { try { return JSON.parse(sessionStorage.getItem('valo_user') || '{}').role || 'admin'; } catch { return 'admin'; } };

const adminSuggestions = ['Check operational risks', 'Suggest pricing adjustments', 'Show today parking sessions', 'Show today vehicle approvals'];
const staffSuggestions = ['Which vehicles are currently parked?', 'Find recent bookings', 'Show available parking spaces'];

export default function ValoAICopilot({ contentRef }) {
  const userRole = getRole();
  const suggestions = userRole === 'admin' ? englishSuggestions : userRole === 'staff' ? staffSuggestions : adminSuggestions;
  const navigate = useNavigate();
  const socket = useContext(SocketContext);
  const { position, setPosition, mascotRef, visible, clampPosition, persistPosition } = useMascotPosition(contentRef);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('chat');
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const decisionInFlight = useRef(false);
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationError, setNotificationError] = useState('');
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const notificationPage = useRef(1);
  const notificationRequest = useRef(0);
  const detailRequest = useRef(0);
  const readRequests = useRef(new Set());
  const [readingIds, setReadingIds] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const bulkReadInFlight = useRef(false);
  const [filter, setFilter] = useState('all');
  const currentFilter = useRef(filter);
  currentFilter.current = filter;
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const drag = useRef(null);
  const dragged = useRef(false);
  const previewTimer = useRef(null);
  const seenNotificationIds = useRef(null);
  const bottomRef = useRef(null);

  const refresh = useCallback(async (nextFilter = filter, page = 1, append = false) => {
    if (bulkReadInFlight.current) return;
    const generation = ++notificationRequest.current;
    setNotificationLoading(true);
    try {
      const response = await getAINotifications(nextFilter, page);
      if (generation !== notificationRequest.current || bulkReadInFlight.current) return;
      if (!response.ok) throw new Error('Unable to load notifications. Please try again.');
      const data = response.data.data;
      const rows = data.notifications || [];
      setNotifications(previous => append ? [...previous, ...rows.filter(row => !previous.some(old => old._id === row._id))] : rows);
      notificationPage.current = page;
      setHasMore(page * 20 < data.total);
      setUnreadCount(data.unreadCount || 0);
      setNotificationError('');
      if (!seenNotificationIds.current) seenNotificationIds.current = new Set(rows.map(row => String(row._id)));
    } catch {
      if (generation === notificationRequest.current) setNotificationError('Unable to load notifications. Please try again.');
    } finally {
      if (generation === notificationRequest.current) setNotificationLoading(false);
    }
  }, [filter]);
  useEffect(() => {
    const timer = setTimeout(() => refresh(), 0);
    return () => { clearTimeout(timer); notificationRequest.current += 1; };
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(async () => {
      const generation = notificationRequest.current;
      const response = await getAINotifications('all');
      if (generation !== notificationRequest.current || readRequests.current.size || bulkReadInFlight.current) return;
      if (!response.ok) return;
      const rows = response.data.data.notifications || [];
      setUnreadCount(response.data.data.unreadCount || 0);
      if (!seenNotificationIds.current) { seenNotificationIds.current = new Set(rows.map((item) => String(item._id))); return; }
      const latest = rows.find((item) => !seenNotificationIds.current.has(String(item._id)) && ['WARNING', 'CRITICAL'].includes(item.severity));
      rows.forEach((item) => seenNotificationIds.current.add(String(item._id)));
      if (latest) { setPreview({ id: latest._id, title: latest.title, severity: latest.severity }); clearTimeout(previewTimer.current); previewTimer.current = setTimeout(() => setPreview(null), 8000); }
    }, 60000);
    return () => clearInterval(timer);
  }, [userRole]);
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
    if (dragged.current) { const next = clampPosition({ x: drag.current.position.x + dx, y: drag.current.position.y + dy }); drag.current.latest = next; setPosition(next); setDragging(true); }
  };
  const onPointerUp = () => {
    if (drag.current && dragged.current) setPosition(persistPosition(drag.current.latest || position));
    drag.current = null;
    setDragging(false);
    if (dragged.current) setTimeout(() => { dragged.current = false; }, 0);
  };
  const markRead = async (id) => {
    if (bulkReadInFlight.current || readRequests.current.has(id)) return false;
    readRequests.current.add(id); setReadingIds([...readRequests.current]);
    try {
      const response = await markAINotificationRead(id);
      if (!response.ok) { setNotificationError('Unable to mark this notification as read. Please try again.'); return false; }
      notificationRequest.current += 1;
      setNotifications(rows => filter === 'unread' ? rows.filter(row => row._id !== id) : rows.map(row => row._id === id ? { ...row, isRead: true } : row));
      setSelected(row => row?._id === id ? { ...row, isRead: true } : row);
      if (notifications.some(row => row._id === id && !row.isRead) || (selected?._id === id && !selected.isRead)) setUnreadCount(count => Math.max(0, count - 1));
      setNotificationError('');
      await refresh();
      return true;
    } catch {
      setNotificationError('Unable to mark this notification as read. Please try again.');
      return false;
    } finally {
      readRequests.current.delete(id); setReadingIds([...readRequests.current]);
    }
  };
  const markAllRead = async () => {
    if (bulkReadInFlight.current || readRequests.current.size || !unreadCount) return;
    bulkReadInFlight.current = true;
    setMarkingAllRead(true);
    notificationRequest.current += 1;
    setNotificationError('');
    let error = '';
    try {
      const result = await markAllUnreadNotifications({ getNotifications: getAINotifications, markRead: markAINotificationRead, onRead: id => {
        setNotifications(rows => applyNotificationRead(rows, id, currentFilter.current));
        setSelected(row => row?._id === id ? { ...row, isRead: true } : row);
        setUnreadCount(count => Math.max(0, count - 1));
      } });
      if (result.failedIds.length) error = 'Some notifications could not be marked as read. Please try again.';
    } catch (failure) { error = failure.message || 'Unable to mark notifications as read. Please try again.'; }
    finally {
      bulkReadInFlight.current = false;
      setMarkingAllRead(false);
      await refresh(currentFilter.current);
      if (error) setNotificationError(error);
    }
  };
  const openNotice = async (id) => {
    setOpen(true); setTab('notifications'); setPreview(null);
    const generation = ++detailRequest.current;
    if (userRole === 'admin') { setSelected(null); setNotificationLoading(true); setNotificationError(''); }
    const response = await getAINotification(id);
    if (userRole === 'admin') {
      if (generation !== detailRequest.current) return;
      setNotificationLoading(false);
      if (!response.ok) { setNotificationError('Unable to open this notification. It may be unavailable. Please try again.'); return; }
    }
    if (response.ok) { setSelected(response.data.data); await markRead(id); if (userRole !== 'admin' || generation === detailRequest.current) refresh(); }
  };
  const onNotificationClick = async (item) => {
    const target = notificationClickTarget(item, userRole);
    if (!target) return openNotice(item._id);
    const generation = ++detailRequest.current;
    setPreview(null);
    try { await markRead(item._id); }
    catch (error) { console.error('[VALO AI Notification] mark read:', error); }
    if (userRole === 'admin' && generation !== detailRequest.current) return;
    refresh();
    setOpen(false);
    navigate(target);
  };
  const submit = async (value = input) => {
    const message = value.trim(); if (!message || busy || noticeBusy || decisionInFlight.current) return;
    setInput(''); setMessages((rows) => [...rows, { role: 'user', message, at: Date.now() }]); setBusy(true); setOpen(true); setTab('chat');
    const response = await sendAIMessage(message, conversationId);
    if (response.ok) { setConversationId(response.data.data.conversationId); setMessages((rows) => {
      const data = response.data.data;
      if (userRole === 'admin' && data.draft && rows.some(row => row.draft?.id === data.draft.id)) return [...rows, { role: 'ai', message: 'An identical proposal is already awaiting approval above.', at: Date.now() }];
      return [...rows, { role: 'ai', ...data, at: Date.now() }];
    }); }
    else setMessages(rows => [...rows, { role: 'ai', type: 'error', message: response.status === 400 ? 'Enter a question between 1 and 2,000 characters.' : 'Unable to connect to VALO AI. Please try again.', at: Date.now() }]);
    setBusy(false);
  };
  const decide = async (draft, approve) => {
    if (busy || noticeBusy || decisionInFlight.current) return false;
    decisionInFlight.current = true; setNoticeBusy(true);
    try {
      const response = approve ? await approveAIDraft(draft.id) : await rejectAIDraft(draft.id);
      const state = response.data?.data?.status || response.data?.draftStatus;
      if (response.ok || (userRole === 'admin' && ['EXECUTED', 'REJECTED'].includes(state))) setMessages(rows => rows.map(row => {
        if (row.draft?.id === draft.id) return { ...row, draft: userRole === 'admin' ? { ...row.draft, status: state || (approve ? 'EXECUTED' : 'REJECTED') } : null };
        // Keep proposal snapshots intact; earlier account reads are no longer current.
        const applied = state === 'EXECUTED' || (response.ok && approve);
        const accountChange = ['CHANGE_USER_ROLE', 'UPDATE_USER_STATUS', 'UPDATE_USER_PROFILE'].includes(draft.type);
        if (userRole === 'admin' && applied && accountChange && !row.draft && (row.accountResult || row.links?.some(link => link.url?.startsWith('/admin/accounts?')))) return { ...row, accountStale: true };
        return row;
      }));
      const resultMessage = response.ok
        ? (approve ? (response.data?.data?.alreadyApplied ? 'This proposal was already applied.' : draft.type === 'SEND_NOTIFICATION' ? 'The notification was sent.' : 'The proposed change was applied.') : 'The proposal was rejected.')
        : 'Unable to process the proposal. Please try again.';
      setMessages(rows => [...rows, { role: 'ai', type: response.ok ? 'analysis' : 'error', message: resultMessage, at: Date.now() }]);
      if (response.ok || state === 'EXECUTED') {
        if ((approve || state === 'EXECUTED') && userRole === 'admin') window.dispatchEvent(new CustomEvent('valo:admin-data-changed', { detail: { type: draft.type } }));
        refresh();
      }
      return response.ok;
    } finally { decisionInFlight.current = false; setNoticeBusy(false); }
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
    else if (userRole === 'admin') setNotificationError('Unable to dismiss this notification. Please try again.');
  };

  const CopilotView = userRole === 'admin' ? AdminValoAICopilotView : ValoAICopilotView;
  return <CopilotView
    mascotRef={mascotRef} mascotVisible={visible}
    position={position} open={open} setOpen={setOpen} tab={tab} setTab={setTab}
    messages={messages} busy={busy} noticeBusy={noticeBusy} input={input} setInput={setInput}
    submit={submit} decide={decide} notifications={notifications} unreadCount={unreadCount} notificationError={notificationError}
    filter={filter} setFilter={(value) => { if (userRole === 'admin') detailRequest.current += 1; setFilter(value); }} selected={selected} setSelected={setSelected}
    preview={preview} openNotice={openNotice} onNotificationClick={onNotificationClick} refresh={refresh} dismissNotice={dismissNotice}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
    onTriggerClick={onTriggerClick} bottomRef={bottomRef} suggestions={suggestions}
    markRead={markRead} readingIds={readingIds}
    markAllRead={markAllRead} markingAllRead={markingAllRead}
    notificationLoading={notificationLoading} hasMore={hasMore} loadMore={() => refresh(filter, notificationPage.current + 1, true)}
    dragging={dragging} userRole={userRole}
  />;
}

