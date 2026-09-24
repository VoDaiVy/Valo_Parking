import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, CalendarDays, CheckCircle2, Loader2, Mic, MicOff, Send, Sparkles, Volume2, VolumeX } from 'lucide-react';
import PolicyAcceptancePrompt from '../policies/PolicyAcceptancePrompt';
import { extractMissingPolicies, isPolicyAcceptanceRequired } from '../../utils/policyErrors';
import {
  completeAiBookingSession,
  createAiBookingSession,
  discardAiBookingSession,
  getLatestAiBookingSession,
  interpretAiBooking,
  updateAiBookingSession,
} from '../../services/aiBookingService';
import {
  cancelBooking, createBookingHold, createBulkBooking, extendBooking,
  getAvailableBookingSlots, getBookingCancellationQuote, getMyBookings,
  quoteBulkBooking, releaseBookingHold,
} from '../../services/bookingService';
import { getWalletInfo } from '../../services/walletService';
import { getMyParkingHistory } from '../../services/sessionService';
import { getLiveMapData } from '../../services/parkingFloorService';
import { addVehicle, deleteVehicle, updateVehicle } from '../../services/vehicleService';
import { checkAiAvailability, confirmAiBooking, confirmAiExistingAction, findAiActionBookings, isVipBookingRestriction, prepareAiBooking, prepareAiExistingAction } from '../../utils/aiBookingFlow';
import { createAiBookingVoiceSession, createAiBookingSpeaker } from '../../utils/aiBookingVoice';
import { bookingPreviewSummary, bookingSuccessSummary, routeAssistantActionReply, routeBookingReply, vipPlatePrompt } from '../../utils/aiBookingConversation';
import { localizeAiBookingMessage } from '../../utils/aiBookingMessages';
import { bookingStatusReply, detectDirectParkingLookup, parkingAvailabilityReply, parkingStatusReply, slotStatusReply } from '../../utils/aiParkingLookup';
import {
  aiBookingStepLabel,
  chooseNewestAiBookingSession,
  clearLocalAiBookingSession,
  createAiBookingSnapshot,
  getAiBookingOwnerKey,
  normalizeAiBookingSession,
  readLocalAiBookingSession,
  saveLocalAiBookingSession,
} from '../../utils/aiBookingSession';

const gateway = {
  cancelBooking, createBookingHold, createBulkBooking, extendBooking,
  getAvailableBookingSlots, getBookingCancellationQuote, getMyBookings,
  getWalletInfo, quoteBulkBooking, releaseBookingHold,
};
const money = (amount) => `${Number(amount || 0).toLocaleString('vi-VN')} VND`;
const dayText = (day) => day?.split('-').reverse().join('/') || '';
const nowInVietnam = () => {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const part = (name) => parts.find((item) => item.type === name)?.value || '';
  return {
    today: `${part('year')}-${part('month')}-${part('day')}`,
    currentTime: `${part('hour')}:${part('minute')}`,
  };
};
const vnParts = (value) => {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (name) => parts.find((item) => item.type === name)?.value || '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
};
const bookingStart = (booking) => booking.scheduledStart || booking.startTime;
const bookingEnd = (booking) => booking.scheduledEnd || booking.endTime;
const labelBooking = (booking) => {
  const time = vnParts(bookingStart(booking));
  return `${dayText(time.date)} · ${time.time} · ${booking.licensePlate} · ${booking.parkingSlot || booking.slotCode}`;
};
const vehicleSelectionPrompt = (draft, vehicles, fallback) => {
  const count = Number(draft.requestedVehicleCount || 0);
  const plates = [...new Set([
    ...(Array.isArray(draft.licensePlates) ? draft.licensePlates : []),
    ...(Array.isArray(draft.reservationItems) ? draft.reservationItems.map((item) => item?.licensePlate) : []),
  ].filter(Boolean))];
  if (count < 2 || plates.length >= count) return fallback;
  const registered = vehicles.filter((vehicle) => vehicle.status === 'approved')
    .map((vehicle) => vehicle.licensePlate).filter(Boolean);
  const choices = registered.length ? ` Xe đã đăng ký: ${registered.join(', ')}.` : '';
  if (!plates.length && draft.startDate && draft.startTime && draft.endTime) {
    return `Được ạ. Mình sẽ đặt ${count} chỗ ngày ${dayText(draft.startDate)}, từ ${draft.startTime} đến ${draft.endTime}. Bạn muốn dùng ${count} xe nào?${choices}`;
  }
  return `${fallback}${choices}`;
};
const phaseLabels = {
  IDLE: 'Sẵn sàng', LISTENING: 'Đang nghe...', PROCESSING: 'Đang xử lý...',
  WAITING_CONFIRMATION: 'CHỜ XÁC NHẬN', CONFIRMING: 'Đang kiểm tra lại...',
  BOOKING: 'Đang tạo booking...', SUCCESS: 'Đặt chỗ thành công', ERROR: 'Có lỗi, vui lòng thử lại',
};
const assistantIntentLabels = {
  CHECK_VEHICLE_PARKING_STATUS: 'Trạng thái xe', CHECK_VEHICLE_ENTRY_TIME: 'Giờ vào',
  CHECK_VEHICLE_EXIT_TIME: 'Giờ ra', CHECK_VEHICLE_LOCATION: 'Vị trí xe',
  CHECK_VEHICLE_DURATION: 'Thời gian đỗ', CHECK_PARKING_FEE: 'Phí đỗ',
  CHECK_BOOKING_STATUS: 'Trạng thái booking', CHECK_UPCOMING_BOOKING: 'Booking sắp tới',
  CHECK_PARKING_AVAILABILITY: 'Chỗ trống', CHECK_SLOT_STATUS: 'Trạng thái ô đỗ',
  CHECK_WALLET_BALANCE: 'Số dư ví', CHECK_PAYMENT_STATUS: 'Thanh toán',
  CHECK_TRANSACTION_HISTORY: 'Giao dịch', LIST_MY_VEHICLES: 'Xe của bạn',
  ADD_VEHICLE: 'Thêm xe', UPDATE_VEHICLE: 'Cập nhật xe', REMOVE_VEHICLE: 'Xóa xe',
  CHECK_SERVICES: 'Dịch vụ', BOOK_SERVICE: 'Đặt dịch vụ', CHECK_PARKING_POLICY: 'Chính sách',
  HELP: 'Trợ giúp',
};
const welcomeMessage = {
  role: 'assistant',
  text: 'Chào bạn! Mình có thể đặt chỗ hoặc kiểm tra vị trí xe, phí đỗ, booking, ví và chỗ trống.',
  content: 'Chào bạn! Mình có thể đặt chỗ hoặc kiểm tra vị trí xe, phí đỗ, booking, ví và chỗ trống.',
  speak: false,
  intent: 'UNKNOWN',
  state: 'IDLE',
  createdAt: new Date().toISOString(),
};
const newClientSessionId = () => globalThis.crypto?.randomUUID?.()
  || `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const isReadyAssistantAction = (action) => Boolean(action && (
  (action.type === 'ADD_VEHICLE' && action.licensePlate && action.brand && action.vehicleType)
  || (action.type === 'REMOVE_VEHICLE' && action.vehicleId)
  || (action.type === 'UPDATE_VEHICLE' && action.vehicleId && Object.keys(action.changes || {}).length)
));

export default function AiBookingPanel({ vehicles = [], onSwitchToManual, onVehiclesChanged }) {
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState({});
  const [intent, setIntent] = useState('UNKNOWN');
  const [messages, setMessages] = useState([{ ...welcomeMessage }]);
  const [preview, setPreview] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [availability, setAvailability] = useState(null);
  const [choices, setChoices] = useState([]);
  const [target, setTarget] = useState(null);
  const [actionQuote, setActionQuote] = useState(null);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [policyItems, setPolicyItems] = useState([]);
  const [manualSuggestion, setManualSuggestion] = useState(false);
  const [assistantInfo, setAssistantInfo] = useState(null);
  const [pendingAssistantAction, setPendingAssistantAction] = useState(null);
  const [phase, setPhase] = useState('IDLE');
  const [speaking, setSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [hasStarted, setHasStarted] = useState(false);
  const [resumeCandidate, setResumeCandidate] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionSaving, setSessionSaving] = useState('idle');
  const voiceSessionRef = useRef(null);
  const speakerRef = useRef(null);
  const draftRef = useRef({});
  const previewRef = useRef(null);
  const vehiclesRef = useRef(vehicles);
  const speechPendingRef = useRef(false);
  const speakingRef = useRef(false);
  const handlingInputRef = useRef(false);
  const voiceHandlersRef = useRef({});
  const phaseRef = useRef('IDLE');
  const intentRef = useRef('UNKNOWN');
  const confirmationPendingRef = useRef(false);
  const pendingAssistantActionRef = useRef(null);
  const voiceEnabledRef = useRef(true);
  const requestRef = useRef(0);
  const confirmationKeyRef = useRef(null);
  const busyRef = useRef(false);
  const conversationRef = useRef(null);
  const messagesRef = useRef([{ ...welcomeMessage }]);
  const sessionIdRef = useRef('');
  const clientSessionIdRef = useRef('');
  const hasStartedRef = useRef(false);
  const sessionQueueRef = useRef(Promise.resolve());
  const lastSnapshotRef = useRef(null);
  const snapshotSaverRef = useRef(null);
  const ownerKeyRef = useRef(getAiBookingOwnerKey());

  const setConversationPhase = (value) => { phaseRef.current = value; setPhase(value); };
  const updateDraft = (value) => {
    const next = typeof value === 'function' ? value(draftRef.current) : value;
    draftRef.current = next;
    setDraft(next);
  };
  const updatePreview = (value) => { previewRef.current = value; setPreview(value); };
  const replaceMessages = (value) => {
    messagesRef.current = value;
    setMessages(value);
  };
  const appendMessage = (message) => {
    const next = [...messagesRef.current, {
      ...message,
      content: message.content ?? message.text ?? '',
      createdAt: message.createdAt || new Date().toISOString(),
    }];
    messagesRef.current = next;
    setMessages(next);
  };
  const beginSession = () => {
    if (!clientSessionIdRef.current) clientSessionIdRef.current = newClientSessionId();
    if (!hasStartedRef.current) {
      hasStartedRef.current = true;
      setHasStarted(true);
    }
  };
  const buildSessionSnapshot = (status = 'ACTIVE') => createAiBookingSnapshot({
    clientSessionId: clientSessionIdRef.current,
    sessionId: sessionIdRef.current,
    messages: messagesRef.current,
    bookingDraft: draftRef.current,
    intent: intentRef.current,
    phase: phaseRef.current,
    preview: previewRef.current,
    status,
  });
  const saveSnapshot = (snapshot = buildSessionSnapshot()) => {
    lastSnapshotRef.current = snapshot;
    saveLocalAiBookingSession(ownerKeyRef.current, snapshot);
    setSessionSaving('saving');
    sessionQueueRef.current = sessionQueueRef.current.catch(() => null).then(async () => {
      const currentId = sessionIdRef.current;
      const response = currentId
        ? await updateAiBookingSession(currentId, snapshot)
        : await createAiBookingSession(snapshot);
      if (!response.ok || !response.data?.data) {
        setSessionSaving('offline');
        return null;
      }
      const saved = normalizeAiBookingSession(response.data.data);
      sessionIdRef.current = saved.sessionId;
      const localSnapshot = { ...snapshot, sessionId: saved.sessionId, updatedAt: saved.updatedAt || snapshot.updatedAt };
      if (lastSnapshotRef.current?.status !== 'COMPLETED') {
        lastSnapshotRef.current = localSnapshot;
        saveLocalAiBookingSession(ownerKeyRef.current, localSnapshot);
        setSessionSaving('saved');
      }
      return saved;
    });
    return sessionQueueRef.current;
  };
  useEffect(() => { snapshotSaverRef.current = saveSnapshot; });
  const resumeVoiceIfReady = () => {
    if (!busyRef.current && !handlingInputRef.current && !speechPendingRef.current && !speakingRef.current) {
      voiceSessionRef.current?.resume();
    }
  };

  useEffect(() => {
    speakerRef.current = createAiBookingSpeaker(window, {
      onStart: () => {
        speakingRef.current = true;
        setSpeaking(true);
        voiceSessionRef.current?.pause();
      },
      onEnd: () => {
        speakingRef.current = false; speechPendingRef.current = false;
        setSpeaking(false); resumeVoiceIfReady();
      },
      onError: () => {
        speakingRef.current = false; speechPendingRef.current = false;
        setSpeaking(false); resumeVoiceIfReady();
      },
    });
    voiceSessionRef.current = createAiBookingVoiceSession(window, {
      onTranscript: (text) => voiceHandlersRef.current.submitMessage?.(text),
      onError: (message) => {
        setVoiceActive(voiceSessionRef.current?.isActive() || false);
        voiceHandlersRef.current.reportError?.(message);
      },
      onListeningChange: (value) => {
        setListening(value);
        if (value && !busyRef.current && !speakingRef.current) setConversationPhase('LISTENING');
        else if (!value && phaseRef.current === 'LISTENING') {
          setConversationPhase(confirmationPendingRef.current ? 'WAITING_CONFIRMATION' : 'IDLE');
        }
      },
    });
    return () => {
      requestRef.current += 1;
      voiceSessionRef.current?.stop();
      speakerRef.current?.cancel();
    };
  }, []);

  useEffect(() => { vehiclesRef.current = vehicles; }, [vehicles]);

  useEffect(() => {
    let cancelled = false;
    const loadSession = async () => {
      const ownerKey = ownerKeyRef.current;
      if (!ownerKey) {
        if (!cancelled) setSessionLoading(false);
        return;
      }
      const local = readLocalAiBookingSession(ownerKey);
      const pendingTerminal = ['COMPLETED', 'CANCELLED'].includes(local?.status) ? local : null;
      if (pendingTerminal?.sessionId) {
        const synced = pendingTerminal.status === 'COMPLETED'
          ? await completeAiBookingSession(pendingTerminal.sessionId, pendingTerminal)
          : await discardAiBookingSession(pendingTerminal.sessionId);
        if (synced.ok || synced.status === 404) {
          clearLocalAiBookingSession();
        }
      }
      const response = await getLatestAiBookingSession();
      if (cancelled) return;
      let backend = response.ok ? normalizeAiBookingSession(response.data?.data) : null;
      const normalizedLocal = local && !pendingTerminal
        ? normalizeAiBookingSession(local) : null;
      if (response.ok && !backend && normalizedLocal && ['DRAFT', 'ACTIVE'].includes(normalizedLocal.status)) {
        let synced = normalizedLocal.sessionId
          ? await updateAiBookingSession(normalizedLocal.sessionId, normalizedLocal)
          : await createAiBookingSession(normalizedLocal);
        if (synced.status === 404) synced = await createAiBookingSession(normalizedLocal);
        if (synced.ok && synced.data?.data) {
          backend = normalizeAiBookingSession(synced.data.data);
          saveLocalAiBookingSession(ownerKey, {
            ...normalizedLocal,
            sessionId: backend.sessionId,
            updatedAt: backend.updatedAt || normalizedLocal.updatedAt,
          });
        }
      }
      const candidate = pendingTerminal ? null : chooseNewestAiBookingSession(backend, normalizedLocal);
      setResumeCandidate(candidate && !['COMPLETED', 'CANCELLED'].includes(candidate.status) ? candidate : null);
      setSessionLoading(false);
      if (!response.ok && normalizedLocal) setSessionSaving('offline');
    };
    loadSession();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hasStarted || !hasStartedRef.current) return;
    snapshotSaverRef.current?.(buildSessionSnapshot());
  }, [messages, draft, intent, phase, preview, hasStarted]);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [messages, busy, error]);

  const say = (text, { speak = true, responseIntent = intentRef.current } = {}) => {
    const localizedText = localizeAiBookingMessage(text);
    appendMessage({ role: 'assistant', text: localizedText, speak, intent: responseIntent, state: phaseRef.current });
    if (speak && voiceEnabledRef.current && speakerRef.current) {
      speechPendingRef.current = true;
      speakerRef.current.speak(localizedText);
    } else resumeVoiceIfReady();
  };
  const reportError = (message) => {
    const text = localizeAiBookingMessage(message || 'Đã xảy ra lỗi. Vui lòng thử lại.');
    setError(text);
    setConversationPhase('ERROR');
    say(text);
  };
  const cancelPreview = () => {
    updatePreview(null); setConflicts([]); setError('');
    confirmationPendingRef.current = false;
    confirmationKeyRef.current = null;
    setConversationPhase('IDLE');
    say('Đã hủy bản xem trước. Chưa có booking nào được tạo.');
  };
  const clearResult = () => {
    confirmationPendingRef.current = false;
    updatePreview(null); setConflicts([]); setAvailability(null); setChoices([]); setTarget(null);
    setActionQuote(null); setEdit(null); setSuccess(null); setError(''); setManualSuggestion(false);
    setAssistantInfo(null); setPendingAssistantAction(null); pendingAssistantActionRef.current = null;
    confirmationKeyRef.current = null;
  };
  const resetConversation = ({ keepMessages = false, keepLocal = false } = {}) => {
    requestRef.current += 1;
    clearResult();
    updateDraft({});
    intentRef.current = 'UNKNOWN';
    setIntent('UNKNOWN');
    updatePreview(null);
    setConversationPhase('IDLE');
    if (!keepMessages) replaceMessages([{ ...welcomeMessage, createdAt: new Date().toISOString() }]);
    sessionIdRef.current = '';
    clientSessionIdRef.current = '';
    hasStartedRef.current = false;
    setHasStarted(false);
    setResumeCandidate(null);
    setSessionSaving('idle');
    if (!keepLocal) clearLocalAiBookingSession();
  };
  const discardCurrentSession = async ({ keepMessages = false, candidateId = '' } = {}) => {
    setSessionSaving('saving');
    await sessionQueueRef.current.catch(() => null);
    const id = candidateId || sessionIdRef.current;
    const response = id ? await discardAiBookingSession(id) : { ok: true };
    const pendingDiscard = !response.ok && id
      ? { ...(lastSnapshotRef.current || buildSessionSnapshot()), sessionId: id, status: 'CANCELLED', updatedAt: new Date().toISOString() }
      : null;
    resetConversation({ keepMessages, keepLocal: Boolean(pendingDiscard) });
    if (pendingDiscard) saveLocalAiBookingSession(ownerKeyRef.current, pendingDiscard);
  };
  const handleNewBooking = async () => {
    setSessionLoading(true);
    await discardCurrentSession({ candidateId: resumeCandidate?.sessionId || '' });
    setSessionLoading(false);
  };
  const completeCurrentSession = () => {
    const completedSnapshot = buildSessionSnapshot('COMPLETED');
    lastSnapshotRef.current = completedSnapshot;
    saveLocalAiBookingSession(ownerKeyRef.current, completedSnapshot);
    hasStartedRef.current = false;
    setHasStarted(false);
    setResumeCandidate(null);
    sessionQueueRef.current = sessionQueueRef.current.catch(() => null).then(async () => {
      const id = sessionIdRef.current;
      if (!id) {
        setSessionSaving('offline');
        return null;
      }
      const response = await completeAiBookingSession(id, completedSnapshot);
      if (response.ok) {
        clearLocalAiBookingSession();
        setSessionSaving('saved');
        return response.data?.data;
      }
      setSessionSaving('offline');
      return null;
    });
  };
  const continueBooking = async () => {
    const restored = normalizeAiBookingSession(resumeCandidate);
    if (!restored || restored.status === 'EXPIRED') return;
    const restoredMessages = restored.messages?.length
      ? restored.messages : [{ ...welcomeMessage, createdAt: new Date().toISOString() }];
    replaceMessages(restoredMessages);
    updateDraft(restored.bookingDraft || {});
    intentRef.current = restored.intent || 'UNKNOWN';
    setIntent(intentRef.current);
    sessionIdRef.current = restored.sessionId || '';
    clientSessionIdRef.current = restored.clientSessionId || newClientSessionId();
    hasStartedRef.current = true;
    setHasStarted(true);
    setResumeCandidate(null);
    clearResult();
    const restoredAction = restored.bookingDraft?.assistantContext?.pendingAction;
    if (isReadyAssistantAction(restoredAction)) {
      const lastReply = [...restoredMessages].reverse().find((message) => message.role === 'assistant');
      pendingAssistantActionRef.current = restoredAction;
      setPendingAssistantAction(restoredAction);
      setAssistantInfo({
        intent: restoredAction.type,
        intents: [restoredAction.type],
        message: lastReply?.text || lastReply?.content || 'Hãy xác nhận để thực hiện thao tác.',
      });
      confirmationPendingRef.current = true;
      setConversationPhase('WAITING_CONFIRMATION');
      return;
    }
    const needsConfirmation = restored.currentStep === 'CONFIRM_BOOKING';
    setConversationPhase(needsConfirmation ? 'PROCESSING' : 'IDLE');
    if (!needsConfirmation || restored.intent !== 'CREATE_BOOKING') return;

    busyRef.current = true;
    setBusy(true);
    try {
      const checked = await prepareAiBooking(restored.bookingDraft || {}, gateway, vehiclesRef.current);
      if (checked.items) {
        updatePreview(checked);
        confirmationKeyRef.current = newClientSessionId();
        confirmationPendingRef.current = true;
        setConversationPhase('WAITING_CONFIRMATION');
      } else {
        setConflicts(checked.conflicts || []);
        setConversationPhase('IDLE');
        if (checked.vipPlateRequired) askForAnotherPlate(checked.vipPlateRequired);
        else if (checked.missing || checked.conflicts) say((checked.missing || checked.conflicts).join('\n'));
      }
    } catch (caught) {
      reportError(caught.message || 'Không thể kiểm tra lại chỗ. Dữ liệu hội thoại vẫn được giữ.');
    } finally {
      busyRef.current = false;
      setBusy(false);
      resumeVoiceIfReady();
    }
  };
  const askForAnotherPlate = (plate) => {
    const blocked = String(plate || draftRef.current.licensePlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    updatePreview(null); setConflicts([]); setError(''); confirmationPendingRef.current = false;
    confirmationKeyRef.current = null;
    updateDraft((current) => {
      const remaining = [...new Set((current.licensePlates || [])
        .map((value) => String(value).replace(/[^A-Z0-9]/gi, '').toUpperCase())
        .filter((value) => value && value !== blocked))];
      const reservationItems = Array.isArray(current.reservationItems)
        ? current.reservationItems.map((item) => (
          String(item?.licensePlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase() === blocked
            ? { ...item, vehicleId: '', licensePlate: '' } : item
        ))
        : current.reservationItems;
      return {
        ...current, vehicleId: '', licensePlate: remaining[0] || '', licensePlates: remaining,
        reservationItems, blockedVipPlate: blocked,
      };
    });
    setConversationPhase('IDLE');
    say(vipPlatePrompt(blocked));
  };

  const cancelAssistantAction = () => {
    pendingAssistantActionRef.current = null;
    setPendingAssistantAction(null);
    confirmationPendingRef.current = false;
    updateDraft((current) => ({
      ...current,
      assistantContext: { ...(current.assistantContext || {}), pendingAction: null },
    }));
    setConversationPhase('IDLE');
    say('Đã hủy thao tác. Chưa có dữ liệu nào được thay đổi.');
  };

  const vehicleActionError = (response, fallback) => {
    const validation = response?.data?.errors?.map((item) => item.msg).filter(Boolean).join(' ');
    if (validation) return validation;
    if (response?.data?.code === 'VEHICLE_LIMIT_REACHED') return 'Tài khoản đã đạt giới hạn số xe được đăng ký.';
    if (response?.data?.code === 'VEHICLE_ACTIVE_SESSION') return 'Xe đang ở trong bãi. Hãy cho xe ra bãi trước khi xóa.';
    if (response?.data?.code === 'VEHICLE_ACTIVE_BOOKING') return 'Xe có booking đang hoạt động hoặc sắp tới. Hãy hoàn tất hoặc hủy booking trước khi xóa.';
    const message = response?.data?.message || fallback;
    if (/already registered/i.test(message)) return 'Biển số này đã được đăng ký.';
    if (/not found/i.test(message)) return 'Không tìm thấy xe trong tài khoản.';
    return localizeAiBookingMessage(message);
  };

  const confirmAssistantAction = async () => {
    const action = pendingAssistantActionRef.current;
    if (!action || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setConversationPhase('CONFIRMING');
    voiceSessionRef.current?.pause();
    try {
      let response;
      if (action.type === 'ADD_VEHICLE') {
        response = await addVehicle({
          licensePlate: action.licensePlate,
          vehicleType: action.vehicleType,
          brand: action.brand,
          model: action.model || '', color: action.color || '', nickname: action.nickname || '',
        });
      } else if (action.type === 'UPDATE_VEHICLE') {
        response = await updateVehicle(action.vehicleId, action.changes || {});
      } else if (action.type === 'REMOVE_VEHICLE') {
        response = await deleteVehicle(action.vehicleId);
      } else throw new Error('Thao tác xe không hợp lệ.');
      if (!response.ok) throw new Error(vehicleActionError(response, 'Không thể cập nhật xe.'));
      pendingAssistantActionRef.current = null;
      setPendingAssistantAction(null);
      confirmationPendingRef.current = false;
      updateDraft((current) => ({
        ...current,
        assistantContext: { ...(current.assistantContext || {}), pendingAction: null },
      }));
      if (onVehiclesChanged) await onVehiclesChanged();
      setConversationPhase('IDLE');
      const verb = action.type === 'ADD_VEHICLE' ? 'Đã gửi xe để xét duyệt'
        : action.type === 'REMOVE_VEHICLE' ? 'Đã xóa xe' : 'Đã cập nhật xe';
      say(`${verb} ${action.licensePlate}.`);
    } catch (caught) {
      reportError(caught.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
      resumeVoiceIfReady();
    }
  };

  const findTargetBookings = async (nextIntent, nextDraft) => {
    const bookings = await findAiActionBookings(nextIntent, nextDraft, gateway);
    if (!bookings.length) {
      say('Mình không tìm thấy booking phù hợp trong tài khoản của bạn. Hãy kiểm tra ngày hoặc biển số.');
      return;
    }
    if (nextIntent === 'VIEW_BOOKING') {
      setChoices(bookings.slice(0, 10));
      say(`Bạn có ${bookings.length} booking phù hợp. Chọn một booking bên phải để xem chi tiết.`);
      return;
    }
    setChoices(bookings);
    say(bookings.length === 1 ? 'Mình đã tìm thấy booking. Hãy xem kỹ trước khi tiếp tục.' : 'Có nhiều booking phù hợp. Hãy chọn đúng booking cần thao tác.');
    if (bookings.length === 1) await selectTarget(bookings[0], nextIntent, nextDraft);
  };

  const selectTarget = async (booking, nextIntent = intent, nextDraft = draft) => {
    setTarget(booking);
    setError('');
    if (nextIntent === 'CANCEL_BOOKING') {
      setActionQuote(await prepareAiExistingAction(nextIntent, booking, gateway));
    }
    if (nextIntent === 'MODIFY_BOOKING') {
      const start = vnParts(bookingStart(booking));
      const end = vnParts(bookingEnd(booking));
      setEdit({
        startDate: booking.status === 'PAID' ? nextDraft.startDate || start.date : start.date,
        startTime: booking.status === 'PAID' ? nextDraft.startTime || start.time : start.time,
        endDate: nextDraft.endDate || end.date,
        endTime: nextDraft.endTime || end.time,
      });
    }
  };

  const submitMessage = async (spokenText) => {
    const text = String(spokenText ?? prompt).trim();
    if (!text || busyRef.current) return;
    beginSession();
    handlingInputRef.current = true;
    voiceSessionRef.current?.pause();
    speakerRef.current?.cancel();
    const route = pendingAssistantActionRef.current
      ? routeAssistantActionReply(text)
      : routeBookingReply(confirmationPendingRef.current ? 'WAITING_CONFIRMATION' : phaseRef.current, text);
    if (route !== 'interpret') {
      setPrompt('');
      appendMessage({ role: 'user', text });
      if (phaseRef.current === 'LISTENING') setConversationPhase(confirmationPendingRef.current ? 'WAITING_CONFIRMATION' : 'IDLE');
      if (route === 'confirm') {
        handlingInputRef.current = false;
        if (pendingAssistantActionRef.current) await confirmAssistantAction();
        else await confirmCreation();
      }
      else if (route === 'cancel') {
        if (pendingAssistantActionRef.current) cancelAssistantAction();
        else cancelPreview();
      }
      else if (route === 'cancel_draft') {
        await discardCurrentSession({ keepMessages: true });
        setConversationPhase('IDLE'); say('Đã dừng yêu cầu đặt chỗ này. Bạn có thể bắt đầu yêu cầu mới khi sẵn sàng.');
      }
      else if (route === 'no_preview') say('Chưa có bản xem trước để xác nhận. Bạn hãy cho mình biết ngày, giờ và xe muốn đặt.');
      else say('Hãy nói “Đặt”, “OK”, “Hủy”, hoặc thông tin muốn đổi.');
      handlingInputRef.current = false;
      resumeVoiceIfReady();
      return;
    }
    busyRef.current = true;
    handlingInputRef.current = false;
    const request = ++requestRef.current;
    setPrompt('');
    clearResult();
    setConversationPhase('PROCESSING');
    appendMessage({ role: 'user', text });
    setBusy(true);
    try {
      const directLookup = detectDirectParkingLookup(text);
      if (directLookup) {
        const response = directLookup.intent === 'CHECK_BOOKING_STATUS'
          ? await getMyBookings()
          : directLookup.intent === 'CHECK_VEHICLE_PARKING_STATUS'
            ? await getMyParkingHistory()
            : await getLiveMapData();
        const message = directLookup.intent === 'CHECK_BOOKING_STATUS'
          ? bookingStatusReply(response, directLookup.licensePlate)
          : directLookup.intent === 'CHECK_VEHICLE_PARKING_STATUS'
            ? parkingStatusReply(response, directLookup.licensePlate)
            : directLookup.intent === 'CHECK_SLOT_STATUS'
              ? slotStatusReply(response, directLookup.slotCode, directLookup.floorName)
              : parkingAvailabilityReply(response, directLookup.floorName);
        if (request !== requestRef.current) return;
        intentRef.current = directLookup.intent;
        setIntent(directLookup.intent);
        setAssistantInfo({ intent: directLookup.intent, intents: [directLookup.intent], message });
        setConversationPhase('IDLE');
        say(message);
        return;
      }
      const current = nowInVietnam();
      const result = await interpretAiBooking(
        text,
        { ...draftRef.current, __intent: intentRef.current },
        current.today,
        current.currentTime,
      );
      if (!result.ok) {
        if (result.status === 404 && /Route .* not found/i.test(result.data?.message || '')) {
          throw new Error('Backend đang chạy phiên bản cũ chưa có AI Booking. Vui lòng khởi động lại backend rồi thử lại.');
        }
        throw new Error(result.data?.message || 'AI chưa xử lý được yêu cầu.');
      }
      if (request !== requestRef.current) return;
      const nextIntent = result.data?.data?.intent || 'UNKNOWN';
      const nextDraft = { ...(result.data?.data?.draft || {}), blockedVipPlate: draftRef.current.blockedVipPlate || '' };
      const clarification = result.data?.data?.clarification;
      intentRef.current = nextIntent;
      setIntent(nextIntent); updateDraft(nextDraft);
      if (clarification) {
        setConversationPhase('IDLE');
        say(vehicleSelectionPrompt(nextDraft, vehiclesRef.current, clarification));
        setManualSuggestion(clarification.includes('Đặt chỗ thủ công'));
        return;
      }
      const assistantResult = result.data?.data?.assistantResult;
      if (assistantResult) {
        setAssistantInfo({
          intent: result.data?.data?.canonicalIntent || nextIntent,
          intents: result.data?.data?.intents || [nextIntent],
          message: assistantResult.message,
        });
        if (assistantResult.pendingAction) {
          pendingAssistantActionRef.current = assistantResult.pendingAction;
          setPendingAssistantAction(assistantResult.pendingAction);
          confirmationPendingRef.current = true;
          setConversationPhase('WAITING_CONFIRMATION');
          say(assistantResult.message);
          return;
        }
        say(assistantResult.message);
        if (nextIntent !== 'CREATE_BOOKING') {
          setConversationPhase('IDLE');
          return;
        }
      }
      if (nextIntent === 'CREATE_BOOKING') {
        const nextPreview = await prepareAiBooking(nextDraft, gateway, vehiclesRef.current);
        if (request !== requestRef.current) return;
        if (nextPreview.vipPlateRequired) askForAnotherPlate(nextPreview.vipPlateRequired);
        else if (nextPreview.missing) { setConversationPhase('IDLE'); say(nextPreview.missing.join(' ')); }
        else if (nextPreview.conflicts) { setConflicts(nextPreview.conflicts); setConversationPhase('IDLE'); say(nextPreview.conflicts.join('\n')); }
        else {
          updateDraft((current) => ({ ...current, vehicleId: nextPreview.items[0]?.vehicleId || '', licensePlate: nextPreview.items[0]?.licensePlate || current.licensePlate }));
          updatePreview(nextPreview); confirmationKeyRef.current = crypto.randomUUID();
          confirmationPendingRef.current = true;
          setConversationPhase('WAITING_CONFIRMATION');
          say(bookingPreviewSummary(nextPreview, nextDraft));
        }
      } else if (nextIntent === 'CHECK_AVAILABILITY') {
        const checked = await checkAiAvailability(nextDraft, gateway);
        if (request !== requestRef.current) return;
        setConversationPhase('IDLE');
        if (checked.missing) say(checked.missing.join(' '));
        else { setAvailability(checked.availability); say('Đây là số chỗ còn trống theo từng ngày.'); }
      } else if (['CANCEL_BOOKING', 'MODIFY_BOOKING', 'VIEW_BOOKING'].includes(nextIntent)) {
        await findTargetBookings(nextIntent, nextDraft);
        if (request !== requestRef.current) return;
        setConversationPhase('IDLE');
      } else { setConversationPhase('IDLE'); say('Mình hỗ trợ đặt chỗ, kiểm tra chỗ trống, xem, sửa hoặc hủy booking. Bạn muốn làm gì?'); }
    } catch (caught) {
      if (request !== requestRef.current) return;
      if (isVipBookingRestriction(caught.responseData || caught)) askForAnotherPlate(draftRef.current.licensePlate);
      else { reportError(caught.message); setPrompt((current) => current || text); }
    } finally {
      busyRef.current = false;
      setBusy(false);
      resumeVoiceIfReady();
    }
  };

  const refreshPreview = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const request = ++requestRef.current;
    voiceSessionRef.current?.pause();
    setBusy(true); setError(''); updatePreview(null); setConflicts([]);
    confirmationKeyRef.current = null;
    confirmationPendingRef.current = false;
    setConversationPhase('PROCESSING');
    try {
      const checked = await prepareAiBooking(draftRef.current, gateway, vehiclesRef.current);
      if (request !== requestRef.current) return;
      if (checked.vipPlateRequired) askForAnotherPlate(checked.vipPlateRequired);
      else if (checked.missing) { setConversationPhase('IDLE'); say(checked.missing.join(' ')); }
      else if (checked.conflicts) { setConflicts(checked.conflicts); setConversationPhase('IDLE'); say(checked.conflicts.join('\n')); }
      else {
        updateDraft((current) => ({ ...current, vehicleId: checked.items[0]?.vehicleId || '', licensePlate: checked.items[0]?.licensePlate || current.licensePlate }));
        updatePreview(checked); confirmationKeyRef.current = crypto.randomUUID();
        confirmationPendingRef.current = true;
        setConversationPhase('WAITING_CONFIRMATION');
        say(bookingPreviewSummary(checked, draftRef.current));
      }
    } catch (caught) {
      if (request === requestRef.current) {
        if (isVipBookingRestriction(caught.responseData || caught)) askForAnotherPlate(draftRef.current.licensePlate);
        else reportError(caught.message);
      }
    }
    finally { busyRef.current = false; setBusy(false); resumeVoiceIfReady(); }
  };

  const confirmCreation = async () => {
    const currentPreview = previewRef.current;
    if (!currentPreview || busyRef.current || !confirmationPendingRef.current) return;
    busyRef.current = true;
    voiceSessionRef.current?.pause();
    setBusy(true); setError(''); setConversationPhase('CONFIRMING');
    try {
      const bookingGateway = { ...gateway, createBulkBooking: (...args) => {
        setConversationPhase('BOOKING');
        return gateway.createBulkBooking(...args);
      } };
      const result = await confirmAiBooking(currentPreview, draftRef.current, bookingGateway, vehiclesRef.current, confirmationKeyRef.current);
      if (result.refreshed) {
        if (result.refreshed.vipPlateRequired) {
          askForAnotherPlate(result.refreshed.vipPlateRequired);
          return;
        }
        updatePreview(result.refreshed.items ? result.refreshed : null);
        setConflicts(result.refreshed.conflicts || []);
        confirmationKeyRef.current = result.refreshed.items ? crypto.randomUUID() : null;
        confirmationPendingRef.current = Boolean(result.refreshed.items);
        setConversationPhase(result.refreshed.items ? 'WAITING_CONFIRMATION' : 'IDLE');
        say(result.refreshed.items
          ? `Thông tin chỗ hoặc giá đã thay đổi. ${bookingPreviewSummary(result.refreshed, draftRef.current)} Hãy xác nhận lại nếu bạn đồng ý.`
          : result.refreshed.conflicts?.join('\n') || result.refreshed.missing?.join(' ') || 'Chỗ đã thay đổi. Vui lòng kiểm tra lại.');
      } else {
        setSuccess(result.success);
        updatePreview(null);
        confirmationKeyRef.current = null;
        confirmationPendingRef.current = false;
        setConversationPhase('SUCCESS');
        say(bookingSuccessSummary(currentPreview.items));
        completeCurrentSession();
      }
    } catch (caught) {
      if (isPolicyAcceptanceRequired(caught.responseData)) setPolicyItems(extractMissingPolicies(caught.responseData));
      if (isVipBookingRestriction(caught.responseData || caught)) askForAnotherPlate(currentPreview.items[0]?.licensePlate);
      else reportError(caught.message || 'Không thể tạo booking. Vui lòng thử lại.');
    } finally { busyRef.current = false; setBusy(false); resumeVoiceIfReady(); }
  };

  const confirmExistingAction = async () => {
    if (!target || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(''); setConversationPhase('CONFIRMING');
    try {
      const result = await confirmAiExistingAction(intent, target, edit, gateway);
      setSuccess(result);
      setTarget(null); setChoices([]); setActionQuote(null);
      setConversationPhase('SUCCESS');
      say(intent === 'CANCEL_BOOKING' ? 'Booking đã được hủy.' : 'Booking đã được cập nhật.');
      completeCurrentSession();
    } catch (caught) { reportError(caught.message); }
    finally { busyRef.current = false; setBusy(false); resumeVoiceIfReady(); }
  };

  const startVoice = () => {
    if (busyRef.current) return;
    speakerRef.current?.cancel();
    setError('');
    const session = voiceSessionRef.current;
    if (!session) { reportError('Trình duyệt này chưa hỗ trợ nhận giọng nói. Bạn có thể nhập bằng bàn phím.'); return; }
    session.start();
    setVoiceActive(session.isActive());
  };

  const changeDraft = (field, value) => {
    requestRef.current += 1;
    confirmationPendingRef.current = false;
    confirmationKeyRef.current = null;
    setConversationPhase('IDLE');
    updateDraft((current) => ({
      ...current,
      [field]: value,
      ...(field === 'startDate' && (!current.endDate || current.endDate === current.startDate) ? { endDate: value } : {}),
      ...(['startTime', 'endTime'].includes(field) ? { pendingStartTime: '', pendingEndTime: '' } : {}),
    }));
    updatePreview(null); setConflicts([]);
  };
  const changePlateInput = (value) => {
    const plates = [...new Set(String(value).split(/[,;]/)
      .map((plate) => plate.replace(/[^A-Z0-9]/gi, '').toUpperCase()).filter(Boolean))];
    changeDraft('licensePlate', plates[0] || '');
    updateDraft((current) => ({
      ...current, vehicleId: '', licensePlate: plates[0] || '',
      licensePlates: plates.length > 1 ? plates : [],
      requestedVehicleCount: plates.length > 1 ? plates.length : current.requestedVehicleCount,
      reservationItems: Array.isArray(current.reservationItems)
        ? current.reservationItems.map((item, index) => ({
          ...item, vehicleId: '', licensePlate: plates[index] || '',
        }))
        : current.reservationItems,
    }));
  };
  useEffect(() => {
    voiceHandlersRef.current = { submitMessage, reportError };
  });
  const fieldClass = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-semibold text-gray-800 outline-none focus:border-yellow-400';
  const currentVietnam = nowInVietnam();
  const resumeDraft = resumeCandidate?.bookingDraft || {};
  const resumeSummary = resumeCandidate?.summary || {};
  const resumeDate = resumeSummary.date || resumeDraft.startDate || resumeDraft.date || '';
  const resumeStartTime = resumeSummary.startTime || resumeDraft.startTime || '';
  const resumeEndTime = resumeSummary.endTime || resumeDraft.endTime || '';
  const resumePlates = resumeSummary.vehicles?.length
    ? resumeSummary.vehicles
    : [...new Set([
      resumeDraft.licensePlate,
      ...(Array.isArray(resumeDraft.licensePlates) ? resumeDraft.licensePlates : []),
      ...(Array.isArray(resumeDraft.reservationItems) ? resumeDraft.reservationItems : []).map((item) => item?.licensePlate),
    ].filter(Boolean))];
  const resumeVehicle = resumePlates.join(', ')
    || vehicles.find((vehicle) => vehicle._id === resumeDraft.vehicleId)?.licensePlate
    || resumeDraft.assistantContext?.licensePlate
    || 'Chưa chọn xe';
  const resumeExpired = resumeCandidate?.status === 'EXPIRED';
  const resumeIsBooking = ['CREATE_BOOKING', 'CHECK_AVAILABILITY', 'CANCEL_BOOKING', 'MODIFY_BOOKING', 'VIEW_BOOKING']
    .includes(resumeCandidate?.intent);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 pb-8">
      <section className="xl:col-span-5 rounded-3xl border border-gray-200 bg-white shadow-sm flex flex-col min-h-[560px] overflow-hidden">
        <div className="border-b border-gray-100 bg-gradient-to-r from-yellow-50 to-white px-5 py-4 flex items-center gap-3">
          <div className="rounded-2xl bg-yellow-400 p-2.5 text-gray-900"><Bot size={22} /></div>
          <div className="flex-1"><h2 className="font-black text-gray-900">Trợ lý đỗ xe VALO</h2><p className="text-xs text-gray-500">Đặt chỗ và tra cứu bằng tiếng Việt</p></div>
          <button type="button" onClick={() => {
            voiceEnabledRef.current = !voiceEnabledRef.current;
            setVoiceEnabled(voiceEnabledRef.current);
            if (!voiceEnabledRef.current) speakerRef.current?.cancel();
          }} className="rounded-xl border border-gray-200 p-2 text-gray-600" aria-label={voiceEnabled ? 'Tắt giọng đọc AI' : 'Bật giọng đọc AI'} title={voiceEnabled ? 'Tắt giọng đọc' : 'Bật giọng đọc'}>{voiceEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
        </div>
        <div role="status" aria-live="polite" className="border-b border-gray-100 px-5 py-2 text-xs font-bold text-gray-600">
          {speaking ? 'Đang nói... Micro sẽ tự nghe tiếp.' : busy ? phaseLabels[phase] : listening ? 'Đang nghe... Bạn có thể nói tiếp.' : voiceActive ? 'Micro đang bật...' : phaseLabels[phase]}
        </div>
        {sessionLoading && <div className="mx-5 mt-4 flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Đang kiểm tra phiên đặt chỗ...</div>}
        {!sessionLoading && resumeCandidate && (
          <div className="mx-5 mt-3 rounded-2xl border border-yellow-300 bg-gradient-to-br from-yellow-50 to-amber-50 p-3 shadow-sm">
            <div className="flex items-start gap-2.5">
              <div className="rounded-xl bg-yellow-400 p-2 text-gray-900"><Bot size={17} /></div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-black text-gray-900">{resumeExpired ? 'Phiên trò chuyện đã hết hạn' : resumeIsBooking ? 'Tiếp tục đặt chỗ' : 'Tiếp tục trò chuyện'}</h3>
                {resumeExpired ? (
                  <p className="mt-1 text-xs leading-5 text-amber-900">Phiên trước đã quá 30 phút. Hãy bắt đầu một lượt đặt chỗ mới.</p>
                ) : (
                  <div className="mt-1.5 space-y-1 text-xs text-gray-700">
                    {(resumeDate || resumeStartTime || resumeEndTime) && (
                      <p className="font-semibold">
                        {resumeDate && (resumeDate.includes('-') && !resumeDate.includes(',') ? dayText(resumeDate) : resumeDate)}
                        {resumeDate && (resumeStartTime || resumeEndTime) ? ' · ' : ''}
                        {(resumeStartTime || resumeEndTime) && `${resumeStartTime || '--:--'}–${resumeEndTime || '--:--'}`}
                      </p>
                    )}
                    <p className="truncate"><span className="font-semibold">Xe:</span> {resumeVehicle}</p>
                    {resumeIsBooking && <p><span className="font-semibold">Bước hiện tại:</span> {aiBookingStepLabel(resumeCandidate.currentStep)}</p>}
                    {resumeIsBooking && <div className="pt-0.5">
                      <div className="mb-1 flex justify-between text-[11px] font-bold text-gray-600"><span>Tiến trình</span><span>{resumeCandidate.completionPercent || 0}%</span></div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-yellow-400 transition-all" style={{ width: `${resumeCandidate.completionPercent || 0}%` }} /></div>
                    </div>}
                  </div>
                )}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {!resumeExpired && <button type="button" onClick={continueBooking} className="rounded-xl bg-gray-900 px-3.5 py-1.5 text-xs font-black text-white">Tiếp tục</button>}
                  <button type="button" onClick={handleNewBooking} className="rounded-xl border border-yellow-400 bg-white px-3.5 py-1.5 text-xs font-black text-yellow-900">Bắt đầu mới</button>
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={conversationRef} className="flex-1 max-h-[520px] overflow-y-auto px-5 py-5 space-y-3" aria-live="polite">
          {messages.map((message, index) => (
            <div key={message.id || `${message.role}-${index}`} className={`max-w-[90%] whitespace-pre-line rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === 'user' ? 'ml-auto bg-gray-900 text-white' : 'bg-yellow-50 border border-yellow-100 text-gray-800'}`}>{message.text ?? message.content}</div>
          ))}
          {busy && <div className="inline-flex items-center gap-2 rounded-2xl bg-gray-100 px-4 py-3 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Đang xử lý...</div>}
        </div>
        {error && <div role="alert" className="mx-5 mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
        {sessionSaving === 'offline' && hasStarted && <div className="mx-5 mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Hội thoại đang được lưu an toàn trên thiết bị và sẽ tự đồng bộ lại.</div>}
        {manualSuggestion && onSwitchToManual && <button type="button" onClick={onSwitchToManual} className="mx-5 mb-3 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-bold text-yellow-900">Chuyển sang Đặt chỗ thủ công</button>}
        <form className="border-t border-gray-100 p-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); submitMessage(); }}>
          <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Đặt chỗ hoặc hỏi về xe, ví, chỗ trống..." className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm outline-none focus:border-yellow-400" aria-label="Yêu cầu cho trợ lý đỗ xe AI" />
          <button type="button" disabled={busy && !voiceActive} onClick={() => {
            if (voiceActive) { voiceSessionRef.current?.stop(); speakerRef.current?.cancel(); setVoiceActive(false); setConversationPhase(confirmationPendingRef.current ? 'WAITING_CONFIRMATION' : 'IDLE'); }
            else startVoice();
          }} className={`rounded-xl p-3 disabled:opacity-50 ${voiceActive ? 'bg-rose-100 text-rose-600' : 'bg-gray-100 text-gray-700'}`} aria-label={voiceActive ? 'Dừng hội thoại bằng giọng nói' : 'Bắt đầu hội thoại bằng giọng nói'} title={voiceActive ? 'Micro đang bật, bấm để dừng' : 'Bật micro hội thoại'}>{voiceActive ? <MicOff size={19} /> : <Mic size={19} />}</button>
          <button type="submit" disabled={!prompt.trim() || busy} className="rounded-xl bg-yellow-400 p-3 text-gray-900 disabled:opacity-50" aria-label="Gửi yêu cầu"><Send size={19} /></button>
        </form>
      </section>

      <section className="xl:col-span-7 rounded-3xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm min-h-[560px]">
        <div className="mb-5 flex items-center gap-3"><Sparkles size={21} className="text-yellow-500" /><div><h2 className="text-lg font-black text-gray-900">{assistantInfo ? 'Thông tin từ VALO' : intent === 'CHECK_AVAILABILITY' ? 'Chỗ còn trống' : intent === 'VIEW_BOOKING' ? 'Booking của bạn' : intent === 'CANCEL_BOOKING' ? 'Xác nhận hủy' : intent === 'MODIFY_BOOKING' ? 'Sửa booking' : 'Xem trước booking'}</h2><p className="text-xs text-gray-500">Mọi thay đổi chỉ được thực hiện sau khi bạn xác nhận.</p></div></div>
        {preview?.items && <div className="mb-4 inline-flex rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-black text-amber-800">CHỜ XÁC NHẬN · Chưa tạo booking</div>}

        {success && <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800"><div className="flex items-center gap-2 font-black"><CheckCircle2 size={20} /> Thao tác thành công</div><Link to="/customer/booking" className="mt-2 inline-block text-sm font-bold underline">Xem My Bookings</Link></div>}

        {assistantInfo && <div className="mb-5 rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm leading-6 text-gray-800 whitespace-pre-line"><div className="mb-2 text-xs font-black uppercase tracking-wide text-yellow-800">{assistantInfo.intents.map((item) => assistantIntentLabels[item] || item).join(' · ')}</div>{assistantInfo.message}{pendingAssistantAction && <div className="mt-4 flex gap-3"><button type="button" disabled={busy} onClick={confirmAssistantAction} className="rounded-xl bg-gray-900 px-4 py-2.5 font-black text-white">Xác nhận</button><button type="button" disabled={busy} onClick={cancelAssistantAction} className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 font-bold">Hủy</button></div>}</div>}

        {intent === 'CREATE_BOOKING' && (draft.startDate || draft.startTime || draft.licensePlate) && !success && (
          <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs font-bold text-gray-500">Từ ngày<input type="date" min={currentVietnam.today} disabled={busy} value={draft.startDate || ''} onChange={(event) => changeDraft('startDate', event.target.value)} className={fieldClass} /></label>
            <label className="text-xs font-bold text-gray-500">Đến ngày<input type="date" min={draft.startDate || currentVietnam.today} disabled={busy} value={draft.endDate || draft.startDate || ''} onChange={(event) => changeDraft('endDate', event.target.value)} className={fieldClass} /></label>
            <label className="text-xs font-bold text-gray-500">Giờ vào<input type="time" min={draft.startDate === currentVietnam.today ? currentVietnam.currentTime : undefined} disabled={busy} value={draft.startTime || ''} onChange={(event) => changeDraft('startTime', event.target.value)} className={fieldClass} /></label>
            <label className="text-xs font-bold text-gray-500">Giờ ra<input type="time" disabled={busy} value={draft.endTime || ''} onChange={(event) => changeDraft('endTime', event.target.value)} className={fieldClass} /></label>
            <label className="text-xs font-bold text-gray-500">Xe<select disabled={busy} value={draft.vehicleId || ''} onChange={(event) => { const vehicle = vehicles.find((item) => item._id === event.target.value); changeDraft('vehicleId', vehicle?._id || ''); updateDraft((current) => ({ ...current, vehicleId: vehicle?._id || '', licensePlate: vehicle?.licensePlate || '', licensePlates: [], requestedVehicleCount: vehicle ? 1 : 0 })); }} className={fieldClass}><option value="">Chọn xe hoặc nhập biển số</option>{vehicles.filter((item) => item.status === 'approved' && (!draft.vehicleType || item.vehicleType === draft.vehicleType)).map((vehicle) => <option key={vehicle._id} value={vehicle._id}>{vehicle.licensePlate}</option>)}</select></label>
            <label className="text-xs font-bold text-gray-500">Biển số (ngăn cách bằng dấu phẩy nếu nhiều xe)<input disabled={busy} value={(draft.licensePlates?.length > 1 ? draft.licensePlates.join(', ') : draft.licensePlate) || ''} onChange={(event) => changePlateInput(event.target.value)} className={fieldClass} placeholder="43A12345, 43B20404" /></label>
            <label className="text-xs font-bold text-gray-500">Tầng (không bắt buộc)<input disabled={busy} value={draft.floorName || ''} onChange={(event) => changeDraft('floorName', event.target.value)} className={fieldClass} placeholder="Floor 2" /></label>
            <label className="text-xs font-bold text-gray-500">Ô đỗ (không bắt buộc)<input disabled={busy} value={draft.slotCode || ''} onChange={(event) => changeDraft('slotCode', event.target.value)} className={fieldClass} placeholder="A-015" /></label>
            <button type="button" onClick={refreshPreview} disabled={busy} className="sm:col-span-2 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 font-black text-yellow-900 disabled:opacity-50">Kiểm tra lại chỗ và giá</button>
          </div>
        )}

        {conflicts.length > 0 && <div role="alert" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><div className="mb-2 font-black">Chưa thể đặt chỗ</div>{conflicts.map((conflict, index) => <p key={index} className="mb-1">{conflict}</p>)}</div>}

        {preview?.items && <div className="space-y-3">
          {preview.items.map((item, index) => { const start = vnParts(item.startTime); const end = vnParts(item.endTime); return <div key={item.clientItemId} className="rounded-2xl border border-gray-200 bg-gray-50 p-4 flex flex-wrap items-center justify-between gap-2"><div><div className="font-black text-gray-900">{dayText(item.date)} · {start.time}–{end.time}</div><div className="text-sm text-gray-500">{item.licensePlate} · {item.floorName} · {item.slotCode}</div></div><strong className="text-yellow-700">{money(preview.quotes?.[index]?.totalAmount)}</strong></div>; })}
          <div className="rounded-2xl bg-gray-900 p-5 text-white flex justify-between items-center"><span>Tổng tạm tính · {preview.durationMinutes} phút/ngày</span><strong className="text-xl text-yellow-300">{money(preview.total)}</strong></div>
          {preview.walletBalance < preview.total && <p className="text-sm text-rose-600">Ví còn {money(preview.walletBalance)}. <Link to="/customer/wallet" className="font-bold underline">Nạp thêm</Link> trước khi xác nhận.</p>}
          <div className="flex gap-3"><button type="button" onClick={confirmCreation} disabled={busy || preview.walletBalance < preview.total} className="flex-1 rounded-xl bg-yellow-400 px-4 py-3 font-black text-gray-900 disabled:opacity-50">Xác nhận đặt chỗ</button><button type="button" onClick={cancelPreview} disabled={busy} className="rounded-xl border border-gray-200 px-4 py-3 font-bold text-gray-600 disabled:opacity-50">Hủy</button></div>
        </div>}

        {availability && <div className="space-y-3">{availability.map((day) => <div key={day.date} className="rounded-2xl border border-gray-200 p-4"><strong>{dayText(day.date)}: {day.count} chỗ trống</strong><p className="text-sm text-gray-500">{day.suggestions.map((slot) => `${slot.floorName} · ${slot.slotCode}`).join(', ') || 'Hãy thử giờ hoặc tầng khác.'}</p></div>)}</div>}

        {choices.length > 0 && <div className="space-y-2 mb-5">{choices.map((booking) => <button key={booking._id} type="button" onClick={() => selectTarget(booking).catch((caught) => setError(caught.message))} className={`block w-full rounded-xl border p-4 text-left text-sm font-bold ${target?._id === booking._id ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 hover:border-yellow-300'}`}>{labelBooking(booking)} <span className="ml-2 text-gray-400">{booking.status}</span></button>)}</div>}

        {target && intent === 'VIEW_BOOKING' && <div className="rounded-2xl bg-gray-50 p-5 text-sm"><p className="font-black">{labelBooking(target)}</p><p>Trạng thái: {target.status}</p><p>Giá đã trả: {money(target.prepaidAmount)}</p></div>}
        {target && intent === 'CANCEL_BOOKING' && actionQuote && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5"><p className="font-black text-gray-900">{labelBooking(target)}</p><p className="mt-2 text-sm text-gray-700">Số tiền hoàn dự kiến: {money(actionQuote.refundAmount)}</p><div className="mt-4 flex gap-3"><button type="button" disabled={busy} onClick={confirmExistingAction} className="rounded-xl bg-rose-600 px-4 py-3 font-black text-white">Xác nhận hủy booking</button><button type="button" onClick={() => setTarget(null)} className="rounded-xl border border-gray-200 bg-white px-4 py-3 font-bold">Giữ booking</button></div></div>}
        {target && intent === 'MODIFY_BOOKING' && edit && <div className="rounded-2xl bg-gray-50 p-5 space-y-3"><p className="font-black">{labelBooking(target)}</p><div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold">Ngày vào<input type="date" value={edit.startDate} disabled={target.status !== 'PAID'} onChange={(event) => setEdit((current) => ({ ...current, startDate: event.target.value }))} className={`${fieldClass} disabled:opacity-50`} /></label><label className="text-xs font-bold">Giờ vào<input type="time" value={edit.startTime} disabled={target.status !== 'PAID'} onChange={(event) => setEdit((current) => ({ ...current, startTime: event.target.value }))} className={`${fieldClass} disabled:opacity-50`} /></label><label className="text-xs font-bold">Ngày ra<input type="date" value={edit.endDate} onChange={(event) => setEdit((current) => ({ ...current, endDate: event.target.value }))} className={fieldClass} /></label><label className="text-xs font-bold">Giờ ra<input type="time" value={edit.endTime} onChange={(event) => setEdit((current) => ({ ...current, endTime: event.target.value }))} className={fieldClass} /></label></div><p className="text-xs text-gray-500">{target.status === 'PAID' ? 'Hệ thống sẽ kiểm tra chỗ và tính phí chênh lệch khi xác nhận.' : 'Xe đã vào bãi: chỉ có thể đổi giờ ra. Hệ thống sẽ tính phí chênh lệch khi xác nhận.'}</p><div className="flex gap-3"><button type="button" disabled={busy} onClick={confirmExistingAction} className="rounded-xl bg-yellow-400 px-4 py-3 font-black">Xác nhận sửa booking</button><button type="button" onClick={() => setTarget(null)} className="rounded-xl border border-gray-200 bg-white px-4 py-3 font-bold">Hủy</button></div></div>}

        {!preview && !availability && !choices.length && !success && !conflicts.length && !assistantInfo && <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 text-center text-gray-400"><CalendarDays size={32} className="mb-3" /><p className="text-sm">Kết quả hoặc bản xem trước sẽ xuất hiện ở đây.</p></div>}
      </section>
      <PolicyAcceptancePrompt open={policyItems.length > 0} missingPolicies={policyItems} onClose={() => setPolicyItems([])} onAccepted={() => { setPolicyItems([]); say('Đã chấp nhận chính sách. Vui lòng xác nhận booking lại.'); }} />
    </div>
  );
}
