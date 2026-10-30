import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Bot, CalendarDays, CheckCircle2, Loader2, MapPin, Mic, MicOff, RefreshCw, Send, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import ParkingMapViewer from '../ParkingMapViewer';
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
  cancelBooking, createBookingHold, createBulkBooking, modifyAiBookingTime,
  getAvailableBookingSlots, getBookingCancellationQuote, getMyBookings, getPricingConfig,
  quoteBookingTimeModification, quoteBulkBooking, releaseBookingHold,
} from '../../services/bookingService';
import { createTopUpUrl, getTopUpStatus, getWalletInfo } from '../../services/walletService';
import { getMyParkingHistory } from '../../services/sessionService';
import { getLiveMapData } from '../../services/parkingFloorService';
import { getServices } from '../../services/extraServiceApi';
import { addVehicle, deleteVehicle, updateVehicle } from '../../services/vehicleService';
import { checkAiAvailability, confirmAiBooking, confirmAiExistingAction, findAiActionBookings, isVipBookingRestriction, prepareAiBooking, prepareAiExistingAction } from '../../utils/aiBookingFlow';
import {
  createAiBookingVoiceSession,
  createAiBookingSpeaker,
  createConciseAiBookingSpeech,
  resolveKnownVehiclePlateTranscript,
} from '../../utils/aiBookingVoice';
import { applyBookingDraftField, applyMapSlotSelectionToDraft, applySingleVehicleSelectionToDraft, applySlotSuggestionToDraft, bookingPreviewSummary, bookingSuccessSummary, resolveContextualVehicleReply, routeAssistantActionReply, routeBookingReply, vipPlatePrompt, isVipInquiry } from '../../utils/aiBookingConversation';
import VipPackageModal from './VipPackageModal';
import { localizeAiBookingMessage } from '../../utils/aiBookingMessages';
import { clearPendingBookingPayment, readPendingBookingPayment, writePendingBookingPayment } from '../../utils/pendingBookingPayment';
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
  cancelBooking, createBookingHold, createBulkBooking, extendBooking: modifyAiBookingTime,
  getAvailableBookingSlots, getBookingCancellationQuote, getMyBookings,
  getWalletInfo, quoteBookingTimeModification, quoteBulkBooking, releaseBookingHold,
};
const money = (amount) => `${Number(amount || 0).toLocaleString('en-US')} VND`;
const durationText = (minutes) => {
  const value = Number(minutes || 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  const days = Math.floor(value / 1440);
  const hours = Math.floor((value % 1440) / 60);
  const rest = Math.round(value % 60);
  return [days ? `${days} day${days === 1 ? '' : 's'}` : '', hours ? `${hours} hour${hours === 1 ? '' : 's'}` : '', rest ? `${rest} minute${rest === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ');
};
const dayText = (day) => day?.split('-').reverse().join('/') || '';
const compactLicensePlate = (value) => String(value || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
const locationLabel = (value) => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
  .replace(/\b(?:floor|tang)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const sameLocationLabel = (left, right) => locationLabel(left) === locationLabel(right);
const requestsUnsupportedBookingEdit = (value) => {
  const text = String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  return /\b(?:doi|chuyen|sua|change|move|switch)\s+(?:sang\s+)?(?:o|slot|tang|floor|xe|vehicle|bien|license|dich vu|service|voucher)\b/.test(text);
};
const bookingTargetsOverlap = (left = {}, right = {}) => {
  const leftStart = new Date(`${left.startDate}T${left.startTime}:00+07:00`);
  const leftEnd = new Date(`${left.endDate || left.startDate}T${left.endTime}:00+07:00`);
  const rightStart = new Date(`${right.startDate}T${right.startTime}:00+07:00`);
  const rightEnd = new Date(`${right.endDate || right.startDate}T${right.endTime}:00+07:00`);
  if ([leftStart, leftEnd, rightStart, rightEnd].some((value) => Number.isNaN(value.getTime()))) return true;
  return leftStart < rightEnd && leftEnd > rightStart;
};
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
const vehicleSelectionPrompt = (draft, vehicles, fallback, language = 'vi') => {
  const count = Number(draft.requestedVehicleCount || 0);
  const plates = [...new Set([
    ...(Array.isArray(draft.licensePlates) ? draft.licensePlates : []),
    ...(Array.isArray(draft.reservationItems) ? draft.reservationItems.map((item) => item?.licensePlate) : []),
  ].filter(Boolean))];
  if (count < 2 || plates.length >= count) return fallback;
  const registered = vehicles.filter((vehicle) => vehicle.status === 'approved')
    .map((vehicle) => vehicle.licensePlate).filter(Boolean);
  if (language === 'en') {
    const choices = registered.length ? ` Registered vehicles: ${registered.join(', ')}.` : '';
    if (!plates.length && draft.startDate && draft.startTime && draft.endTime) {
      return `Okay. I will reserve ${count} spaces on ${dayText(draft.startDate)}, from ${draft.startTime} to ${draft.endTime}. Which ${count} vehicles would you like to use?${choices}`;
    }
    return `${fallback}${choices}`;
  }
  const choices = registered.length ? ` Xe đã đăng ký: ${registered.join(', ')}.` : '';
  if (!plates.length && draft.startDate && draft.startTime && draft.endTime) {
    return `Được ạ. Mình sẽ đặt ${count} chỗ ngày ${dayText(draft.startDate)}, từ ${draft.startTime} đến ${draft.endTime}. Bạn muốn dùng ${count} xe nào?${choices}`;
  }
  return `${fallback}${choices}`;
};
const englishPhaseLabels = {
  IDLE: 'Ready', LISTENING: 'Listening...', PROCESSING: 'Processing...',
  WAITING_CONFIRMATION: 'WAITING FOR CONFIRMATION', CONFIRMING: 'Checking again...',
  WAITING_PAYMENT: 'WAITING FOR PAYMENT', BOOKING: 'Creating booking...',
  SUCCESS: 'Booking completed', ERROR: 'Something went wrong. Please try again',
};
const englishAssistantIntentLabels = {
  CHECK_VEHICLE_PARKING_STATUS: 'Vehicle status', CHECK_VEHICLE_ENTRY_TIME: 'Entry time',
  CHECK_VEHICLE_EXIT_TIME: 'Exit time', CHECK_VEHICLE_LOCATION: 'Vehicle location',
  CHECK_VEHICLE_DURATION: 'Parking duration', CHECK_PARKING_FEE: 'Parking fee',
  CHECK_BOOKING_STATUS: 'Booking status', CHECK_UPCOMING_BOOKING: 'Upcoming booking',
  CHECK_PARKING_AVAILABILITY: 'Availability', CHECK_SLOT_STATUS: 'Slot status',
  CHECK_WALLET_BALANCE: 'Wallet balance', CHECK_PAYMENT_STATUS: 'Payment',
  CHECK_TRANSACTION_HISTORY: 'Transactions', LIST_MY_VEHICLES: 'Your vehicles',
  ADD_VEHICLE: 'Add vehicle', UPDATE_VEHICLE: 'Update vehicle', REMOVE_VEHICLE: 'Remove vehicle',
  CHECK_SERVICES: 'Services', BOOK_SERVICE: 'Book service', CHECK_VOUCHERS: 'Vouchers', USE_VOUCHER: 'Apply voucher',
  CHECK_PARKING_POLICY: 'Policies', CHECK_TICKET_PACKAGES: 'VIP packages', HELP: 'Help',
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
const englishWelcomeMessage = {
  ...welcomeMessage,
  text: 'Hello! I can book a parking space or check your vehicle location, parking fee, bookings, wallet, and availability.',
  content: 'Hello! I can book a parking space or check your vehicle location, parking fee, bookings, wallet, and availability.',
};
const newClientSessionId = () => globalThis.crypto?.randomUUID?.()
  || `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const toVietnamBookingIso = (date, time) => {
  if (!date || !time) return '';
  const value = new Date(`${date}T${time}:00+07:00`);
  return Number.isNaN(value.getTime()) ? '' : value.toISOString();
};
const isReadyAssistantAction = (action) => Boolean(action && (
  (action.type === 'ADD_VEHICLE' && action.licensePlate && action.brand && action.vehicleType)
  || (action.type === 'REMOVE_VEHICLE' && action.vehicleId)
  || (action.type === 'UPDATE_VEHICLE' && action.vehicleId && Object.keys(action.changes || {}).length)
));
const withoutPendingSlotSuggestion = (value = {}) => {
  const next = { ...value };
  delete next.pendingSlotSuggestion;
  return next;
};

export default function AiBookingPanel({
  vehicles = [], onSwitchToManual, onVehiclesChanged,
  mapFloors = [], mapFloorId = null, onMapFloorSelect,
  mapActiveSessions = [], mapDbSlots = [], mapActiveHolds = [],
}) {
  const [prompt, setPrompt] = useState('');
  const [language, setLanguage] = useState('en');
  const [draft, setDraft] = useState({});
  const [intent, setIntent] = useState('UNKNOWN');
  const [messages, setMessages] = useState([{ ...englishWelcomeMessage }]);
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
  const [topUpData, setTopUpData] = useState(() => readPendingBookingPayment('quick'));
  const [showTopUpModal, setShowTopUpModal] = useState(() => Boolean(readPendingBookingPayment('quick')));
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [topUpSuccess, setTopUpSuccess] = useState(false);
  const [mapAvailableSlots, setMapAvailableSlots] = useState(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState('');
  const [mapTargetIndex, setMapTargetIndex] = useState(0);
  const [showVipModal, setShowVipModal] = useState(false);
  const [services, setServices] = useState([]);
  const servicesRef = useRef([]);
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
  const messagesRef = useRef([{ ...englishWelcomeMessage }]);
  const sessionIdRef = useRef('');
  const clientSessionIdRef = useRef('');
  const hasStartedRef = useRef(false);
  const sessionQueueRef = useRef(Promise.resolve());
  const lastSnapshotRef = useRef(null);
  const snapshotSaverRef = useRef(null);
  const ownerKeyRef = useRef(getAiBookingOwnerKey());
  const confirmCreationRef = useRef(null);
  const mapRequestRef = useRef(0);
  const languageRef = useRef('en');

  const requestedVehicleTotal = Math.max(
    Number(draft.requestedVehicleCount || 0),
    Array.isArray(draft.licensePlates) ? draft.licensePlates.length : 0,
    Array.isArray(draft.reservationItems) ? draft.reservationItems.length : 0,
  );
  const mapSelectionTargetCount = Math.max(1, Math.min(5, requestedVehicleTotal || 1));
  const activeMapTargetIndex = Math.min(mapTargetIndex, mapSelectionTargetCount - 1);
  const draftItems = Array.isArray(draft.reservationItems) ? draft.reservationItems : [];
  const draftPlates = Array.isArray(draft.licensePlates) && draft.licensePlates.length
    ? draft.licensePlates : (draft.licensePlate ? [draft.licensePlate] : []);
  const mapSelectionTargets = Array.from({ length: mapSelectionTargetCount }, (_, index) => ({
    index,
    licensePlate: draftItems[index]?.licensePlate || draftPlates[index] || '',
    floorName: draftItems[index]?.floorName || (mapSelectionTargetCount === 1 ? draft.floorName : ''),
    slotCode: draftItems[index]?.slotCode || (mapSelectionTargetCount === 1 ? draft.slotCode : ''),
    startDate: draftItems[index]?.startDate || draft.startDate,
    endDate: draftItems[index]?.endDate || draft.endDate || draft.startDate,
    startTime: draftItems[index]?.startTime || draft.startTime,
    endTime: draftItems[index]?.endTime || draft.endTime,
  }));
  const activeMapTarget = mapSelectionTargets[activeMapTargetIndex];
  const previewMapItem = preview?.items?.[activeMapTargetIndex] || preview?.items?.[0] || null;
  const mapStartTime = String(previewMapItem?.startTime
    || toVietnamBookingIso(activeMapTarget?.startDate, activeMapTarget?.startTime) || '');
  const mapEndTime = String(previewMapItem?.endTime
    || toVietnamBookingIso(activeMapTarget?.endDate || activeMapTarget?.startDate, activeMapTarget?.endTime) || '');
  const previewSelectedMapSlots = (preview?.items || []).map((item) => `${item.floorId}:${item.slotCode}`);
  const draftSelectedMapSlots = !previewSelectedMapSlots.length && Array.isArray(mapAvailableSlots)
    ? mapSelectionTargets.map((target) => mapAvailableSlots.find((slot) => (
      String(slot.slotCode || '').toUpperCase() === String(target.slotCode || '').toUpperCase()
      && (!target.floorName || sameLocationLabel(slot.floorName, target.floorName))
    ))).filter(Boolean).map((slot) => `${slot.floorId}:${slot.slotCode}`)
    : [];
  const selectedMapSlots = previewSelectedMapSlots.length
    ? previewSelectedMapSlots
    : draftSelectedMapSlots;
  const targetVehicle = vehicles.find((vehicle) => String(vehicle.licensePlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
    === String(activeMapTarget?.licensePlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase());
  const mapVehicleType = draft.vehicleType || targetVehicle?.vehicleType || targetVehicle?.type || 'car';

  const refreshMapAvailability = useCallback(async ({ silent = false } = {}) => {
    if (!mapStartTime || !mapEndTime || new Date(mapEndTime) <= new Date(mapStartTime)) {
      mapRequestRef.current += 1;
      setMapAvailableSlots(null);
      setMapError('');
      setMapLoading(false);
      return;
    }
    const request = ++mapRequestRef.current;
    if (!silent) setMapLoading(true);
    try {
      const response = await getAvailableBookingSlots({
        startTime: mapStartTime,
        endTime: mapEndTime,
        bookingSource: 'AI_QUICK',
      });
      if (request !== mapRequestRef.current) return;
      if (!response.ok) {
        setMapError(localizeAiBookingMessage(
          response.data?.message || 'Unable to load the availability map.',
          'en',
        ));
        return;
      }
      setMapAvailableSlots(response.data?.data?.slots || []);
      setMapError('');
    } catch {
      if (request === mapRequestRef.current) setMapError('Unable to update the live parking map.');
    } finally {
      if (request === mapRequestRef.current && !silent) setMapLoading(false);
    }
  }, [mapEndTime, mapStartTime]);

  useEffect(() => {
    const selectedFloorId = previewMapItem?.floorId;
    if (selectedFloorId && onMapFloorSelect) onMapFloorSelect(selectedFloorId);
  }, [onMapFloorSelect, previewMapItem?.floorId]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => refreshMapAvailability(), 0);
    const refreshSilently = () => refreshMapAvailability({ silent: true });
    const intervalId = window.setInterval(refreshSilently, 15000);
    window.addEventListener('focus', refreshSilently);
    return () => {
      mapRequestRef.current += 1;
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshSilently);
    };
  }, [refreshMapAvailability]);

  const setConversationPhase = (value) => { phaseRef.current = value; setPhase(value); };
  const expectsLicensePlateInput = (nextDraft = draftRef.current) => {
    const plates = Array.isArray(nextDraft?.licensePlates) ? nextDraft.licensePlates : [];
    return intentRef.current === 'CREATE_BOOKING'
      && (!nextDraft?.licensePlate
        || Number(nextDraft?.requestedVehicleCount || 0) > plates.length
        || Boolean(nextDraft?.pendingLicensePlate));
  };
  const updateLanguage = (value) => {
    const next = value === 'en' ? 'en' : 'vi';
    languageRef.current = next;
    setLanguage(next);
    if (draftRef.current?.__language !== next || draftRef.current?.__languageLocked !== true) {
      const nextDraft = { ...draftRef.current, __language: next, __languageLocked: true };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
    }
    voiceSessionRef.current?.setLanguage(next);
    voiceSessionRef.current?.setExpectLicensePlate(expectsLicensePlateInput());
    if (!hasStartedRef.current && messagesRef.current.length === 1
      && messagesRef.current[0]?.role === 'assistant') {
      const welcome = next === 'en' ? englishWelcomeMessage : welcomeMessage;
      replaceMessages([{ ...welcome, createdAt: new Date().toISOString() }]);
    }
  };
  const updateDraft = (value) => {
    const next = typeof value === 'function' ? value(draftRef.current) : value;
    draftRef.current = next;
    setDraft(next);
    voiceSessionRef.current?.setExpectLicensePlate(expectsLicensePlateInput(next));
  };
  const updatePreview = (value) => { previewRef.current = value; setPreview(value); };
  const rememberSlotSuggestion = (result) => {
    const suggestion = result?.suggestions?.[0] || null;
    updateDraft((current) => {
      const rest = withoutPendingSlotSuggestion(current);
      return suggestion ? { ...rest, pendingSlotSuggestion: suggestion } : rest;
    });
  };
  const rememberBookingConflict = (result) => {
    const conflict = result?.bookingConflicts?.[0] || null;
    updateDraft((current) => {
      const assistantContext = { ...(current.assistantContext || {}) };
      if (conflict) assistantContext.lastBookingConflict = conflict;
      else delete assistantContext.lastBookingConflict;
      return { ...current, assistantContext };
    });
  };
  const selectMapSlot = (slot, floorId) => {
    if (busyRef.current || !slot?.id) return;
    const selected = Array.isArray(mapAvailableSlots)
      ? mapAvailableSlots.find((item) => String(item.floorId) === String(floorId)
        && String(item.slotCode || '').toUpperCase() === String(slot.id).toUpperCase())
      : null;
    const floor = mapFloors.find((item) => String(item._id) === String(floorId));
    const floorName = selected?.floorName || floor?.name || '';
    const duplicatesAnotherVehicle = mapSelectionTargetCount > 1 && mapSelectionTargets.some((target) => (
      target.index !== activeMapTargetIndex
      && String(target.slotCode || '').toUpperCase() === String(slot.id).toUpperCase()
      && sameLocationLabel(target.floorName, floorName)
      && bookingTargetsOverlap(activeMapTarget, target)
    ));
    if (duplicatesAnotherVehicle) {
      setConflicts([`Space ${String(slot.id).toUpperCase()} is already selected for another vehicle. Please choose a different space.`]);
      return;
    }
    requestRef.current += 1;
    confirmationPendingRef.current = false;
    confirmationKeyRef.current = null;
    setConversationPhase('IDLE');
    updateDraft((current) => applyMapSlotSelectionToDraft(current, {
      floorName,
      slotCode: slot.id,
      sourceIndex: mapSelectionTargetCount > 1 ? activeMapTargetIndex : undefined,
    }));
    updatePreview(null);
    setConflicts([]);
    setAvailability(null);
    onMapFloorSelect?.(floorId);
  };
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
  const speakAssistantText = (text) => {
    const fullText = String(text || '').trim();
    if (!fullText || !voiceEnabledRef.current || !speakerRef.current) {
      resumeVoiceIfReady();
      return;
    }
    speechPendingRef.current = true;
    speakerRef.current.speak(
      createConciseAiBookingSpeech(fullText, languageRef.current),
      languageRef.current,
    );
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
      onTranscript: (text) => {
        const existingPlates = Array.isArray(draftRef.current?.licensePlates)
          ? draftRef.current.licensePlates : [];
        const normalized = expectsLicensePlateInput()
          ? resolveKnownVehiclePlateTranscript(text, vehiclesRef.current, existingPlates)
          : text;
        voiceHandlersRef.current.submitMessage?.(normalized);
      },
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
    voiceSessionRef.current?.setLanguage(languageRef.current);
    voiceSessionRef.current?.setExpectLicensePlate(expectsLicensePlateInput());
    return () => {
      requestRef.current += 1;
      voiceSessionRef.current?.stop();
      speakerRef.current?.cancel();
    };
  }, []);

  useEffect(() => { vehiclesRef.current = vehicles; }, [vehicles]);

  useEffect(() => {
    voiceSessionRef.current?.setContextPhrases([
      ...vehicles.map((vehicle) => vehicle.licensePlate),
      ...services.map((service) => service.name),
      ...mapFloors.map((floor) => floor.name),
    ]);
  }, [mapFloors, services, vehicles]);

  useEffect(() => {
    let mounted = true;
    getServices(true)
      .then((res) => {
        if (mounted && res.ok && Array.isArray(res.data?.data)) {
          setServices(res.data.data);
          servicesRef.current = res.data.data;
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

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
    const localizedText = localizeAiBookingMessage(text, languageRef.current);
    appendMessage({ role: 'assistant', text: localizedText, speak, intent: responseIntent, state: phaseRef.current });
    if (speak) speakAssistantText(localizedText);
    else resumeVoiceIfReady();
  };
  const reportError = (message) => {
    const text = localizeAiBookingMessage(message || 'Đã xảy ra lỗi. Vui lòng thử lại.', languageRef.current);
    setError(text);
    setConversationPhase('ERROR');
    say(text);
  };
  const cancelPreview = () => {
    updatePreview(null); setConflicts([]); setError('');
    updateDraft((current) => withoutPendingSlotSuggestion(current));
    confirmationPendingRef.current = false;
    confirmationKeyRef.current = null;
    setConversationPhase('IDLE');
    say('Đã hủy bản xem trước. Chưa có booking nào được tạo.');
  };
  const cancelExistingSelection = () => {
    setTarget(null); setActionQuote(null); setEdit(null);
    confirmationPendingRef.current = false;
    confirmationKeyRef.current = null;
    setConversationPhase('IDLE');
    say('Đã dừng thao tác. Booking hiện tại chưa bị thay đổi.');
  };
  const clearResult = () => {
    confirmationPendingRef.current = false;
    updateDraft((current) => withoutPendingSlotSuggestion(current));
    updatePreview(null); setConflicts([]); setAvailability(null); setChoices([]); setTarget(null);
    setActionQuote(null); setEdit(null); setSuccess(null); setError(''); setManualSuggestion(false);
    setAssistantInfo(null); setPendingAssistantAction(null); pendingAssistantActionRef.current = null;
    confirmationKeyRef.current = null;
  };
  const resetConversation = ({ keepMessages = false, keepLocal = false } = {}) => {
    requestRef.current += 1;
    clearResult();
    updateDraft({});
    updateLanguage('en');
    intentRef.current = 'UNKNOWN';
    setIntent('UNKNOWN');
    updatePreview(null);
    setConversationPhase('IDLE');
    if (!keepMessages) replaceMessages([{ ...englishWelcomeMessage, createdAt: new Date().toISOString() }]);
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
    const restoredLanguage = restored.bookingDraft?.__languageLocked === true
      && restored.bookingDraft?.__language === 'vi' ? 'vi' : 'en';
    const restoredMessages = restored.messages?.length
      ? restored.messages.map((message) => (
        restoredLanguage === 'en' && message.role === 'assistant'
          ? { ...message, text: localizeAiBookingMessage(message.text ?? message.content, 'en'), content: localizeAiBookingMessage(message.content ?? message.text, 'en') }
          : message
      ))
      : [{ ...englishWelcomeMessage, createdAt: new Date().toISOString() }];
    replaceMessages(restoredMessages);
    updateDraft(restored.bookingDraft || {});
    updateLanguage(restoredLanguage);
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
        message: lastReply?.text || lastReply?.content || (languageRef.current === 'vi'
          ? 'Hãy xác nhận để thực hiện thao tác.'
          : 'Please confirm to continue with this action.'),
      });
      confirmationPendingRef.current = true;
      setConversationPhase('WAITING_CONFIRMATION');
      return;
    }
    const needsConfirmation = ['CONFIRM_BOOKING', 'PAYMENT'].includes(restored.currentStep);
    setConversationPhase(needsConfirmation ? 'PROCESSING' : 'IDLE');
    if (!needsConfirmation || restored.intent !== 'CREATE_BOOKING') return;

    busyRef.current = true;
    setBusy(true);
    try {
      const checked = await prepareAiBooking(restored.bookingDraft || {}, gateway, vehiclesRef.current);
      if (checked.items) {
        rememberSlotSuggestion(null);
        updatePreview(checked);
        confirmationKeyRef.current = newClientSessionId();
        confirmationPendingRef.current = true;
        setConversationPhase('WAITING_CONFIRMATION');
      } else {
        rememberSlotSuggestion(checked);
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
    say(vipPlatePrompt(blocked, languageRef.current));
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
      const verb = languageRef.current === 'vi'
        ? (action.type === 'ADD_VEHICLE' ? 'Đã gửi xe để xét duyệt'
          : action.type === 'REMOVE_VEHICLE' ? 'Đã xóa xe' : 'Đã cập nhật xe')
        : (action.type === 'ADD_VEHICLE' ? 'Submitted vehicle for approval'
          : action.type === 'REMOVE_VEHICLE' ? 'Removed vehicle' : 'Updated vehicle');
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
      say(languageRef.current === 'vi'
        ? 'Mình không tìm thấy booking phù hợp trong tài khoản của bạn. Hãy kiểm tra ngày hoặc biển số.'
        : 'I could not find a matching booking in your account. Please check the date or license plate.');
      return;
    }
    if (nextIntent === 'VIEW_BOOKING') {
      setChoices(bookings.slice(0, 10));
      say(languageRef.current === 'vi'
        ? `Bạn có ${bookings.length} booking phù hợp. Chọn một booking bên phải để xem chi tiết.`
        : `You have ${bookings.length} matching bookings. Select one on the right to view its details.`);
      return;
    }
    setChoices(bookings);
    say(languageRef.current === 'vi'
      ? (bookings.length === 1 ? 'Mình đã tìm thấy booking. Hãy xem kỹ trước khi tiếp tục.' : 'Có nhiều booking phù hợp. Hãy chọn đúng booking cần thao tác.')
      : (bookings.length === 1 ? 'I found the booking. Please review it before continuing.' : 'I found multiple matching bookings. Please select the correct one.'));
    if (bookings.length === 1) await selectTarget(bookings[0], nextIntent, nextDraft);
  };

  const selectTarget = async (booking, nextIntent = intent, nextDraft = draft) => {
    setTarget(booking);
    setError('');
    setActionQuote(null);
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
    if (['CANCEL_BOOKING', 'MODIFY_BOOKING'].includes(nextIntent)) {
      confirmationPendingRef.current = true;
      setConversationPhase('WAITING_CONFIRMATION');
    }
  };

  const submitMessage = async (spokenText) => {
    const displayedText = String(spokenText ?? prompt).trim();
    if (!displayedText || busyRef.current) return;
    const text = resolveContextualVehicleReply(
      displayedText, vehiclesRef.current, draftRef.current, languageRef.current,
    );
    beginSession();
    handlingInputRef.current = true;
    voiceSessionRef.current?.pause();
    speakerRef.current?.cancel();
    const route = pendingAssistantActionRef.current
      ? routeAssistantActionReply(text)
      : routeBookingReply(
        confirmationPendingRef.current ? 'WAITING_CONFIRMATION' : phaseRef.current,
        text,
        { hasSlotSuggestion: Boolean(draftRef.current.pendingSlotSuggestion) },
      );
    if (route !== 'interpret') {
      setPrompt('');
      appendMessage({ role: 'user', text: displayedText });
      if (phaseRef.current === 'LISTENING') setConversationPhase(confirmationPendingRef.current ? 'WAITING_CONFIRMATION' : 'IDLE');
      if (route === 'confirm') {
        handlingInputRef.current = false;
        if (pendingAssistantActionRef.current) await confirmAssistantAction();
        else if (target && ['CANCEL_BOOKING', 'MODIFY_BOOKING'].includes(intentRef.current)) await confirmExistingAction();
        else await confirmCreation();
      }
      else if (route === 'accept_suggestion') {
        const suggestion = draftRef.current.pendingSlotSuggestion;
        updateDraft((current) => applySlotSuggestionToDraft(current, suggestion));
        handlingInputRef.current = false;
        say(languageRef.current === 'en'
          ? `Okay, I will check suggested slot ${suggestion?.slotCode}.`
          : `Được, mình sẽ kiểm tra ô gợi ý ${suggestion?.slotCode}.`);
        await refreshPreview();
      }
      else if (route === 'top_up') {
        handlingInputRef.current = false;
        const currentPreview = previewRef.current;
        const shortfall = Math.max(Number(currentPreview?.total || 0) - Number(currentPreview?.walletBalance || 0), 0);
        if (shortfall > 0) await startTopUpForShortfall(shortfall);
        else say('Số dư ví hiện đã đủ cho booking này. Hãy nói “Đặt” hoặc “Đồng ý” để xác nhận.');
      }
      else if (route === 'view_vip_packages') {
        handlingInputRef.current = false;
        setShowVipModal(true);
        say(languageRef.current === 'en'
          ? 'I have opened the VIP packages window for you to review benefits and rates. You can also say “Confirm” anytime to proceed with this booking.'
          : 'Mình đã mở bảng Gói VIP để bạn xem đúng quyền lợi, điều kiện và giá của từng gói. Bạn vẫn có thể nói “Đặt” để tiếp tục booking hiện tại.');
      }
      else if (route === 'pricing_info') {
        handlingInputRef.current = false;
        const response = await getPricingConfig();
        const config = response.ok ? response.data?.data : null;
        if (!config) {
          say(languageRef.current === 'en'
            ? 'I cannot load the current parking rates right now. Please try again shortly or enter a schedule to receive an exact quote.'
            : 'Mình chưa tải được bảng giá đang áp dụng. Bạn hãy thử lại sau hoặc nhập ngày giờ để hệ thống báo giá chính xác.');
        } else {
          const blocks = (config.timeBlocks || []).map((block) => (
            languageRef.current === 'en'
              ? `${String(block.startHour).padStart(2, '0')}:00–${String(block.endHour).padStart(2, '0')}: ${money(block.price)}/hour`
              : `${String(block.startHour).padStart(2, '0')}:00–${String(block.endHour).padStart(2, '0')}: ${money(block.price)}/giờ`
          ));
          const caps = languageRef.current === 'en' ? [
            Number(config.cap12h) > 0 ? `12 hours: maximum ${money(config.cap12h)}` : '',
            Number(config.cap24h) > 0 ? `24 hours: maximum ${money(config.cap24h)}` : '',
          ].filter(Boolean) : [
            Number(config.cap12h) > 0 ? `12 giờ: tối đa ${money(config.cap12h)}` : '',
            Number(config.cap24h) > 0 ? `24 giờ: tối đa ${money(config.cap24h)}` : '',
          ].filter(Boolean);
          const hasAdjustments = (config.pricePolicies || []).some((policy) => policy?.isActive)
            || config.dayNightPricing?.day?.isActive || config.dayNightPricing?.night?.isActive;
          const adjustmentNote = hasAdjustments
            ? '\nMức điều chỉnh theo ngày/khung giờ sẽ được áp dụng tự động trong báo giá.' : '';
          say(languageRef.current === 'en'
            ? `Current hourly rates:\n${blocks.join('\n')}${caps.length ? `\nCaps: ${caps.join('; ')}` : ''}${hasAdjustments ? '\nActive date/time adjustments are applied automatically to your quote.' : ''}`
            : `Bảng giá hiện đang áp dụng:\n${blocks.join('\n')}${caps.length ? `\n${caps.join('; ')}` : ''}${adjustmentNote}`);
        }
      }
      else if (route === 'service_info') {
        handlingInputRef.current = false;
        let list = servicesRef.current;
        if (!list || !list.length) {
          try {
            const res = await getServices(true);
            if (res.ok && Array.isArray(res.data?.data)) {
              list = res.data.data;
              setServices(list);
              servicesRef.current = list;
            }
          } catch {
            list = [];
          }
        }
        if (list && list.length > 0) {
          const serviceLines = list.map((s) => `• ${s.name}: ${money(s.price)} (${s.timeCost || 30} ${languageRef.current === 'en' ? 'minutes' : 'phút'})`).join('\n');
          const replyText = languageRef.current === 'en'
            ? `VALO offers the following vehicle care services:\n${serviceLines}\n\nYou can click on any service below or type its name (e.g. “Car wash”) to add it to your booking.`
            : `VALO hiện có các dịch vụ chăm sóc xe sau:\n${serviceLines}\n\nBạn có thể nhấn trực tiếp vào các nút dịch vụ bên dưới hoặc nói/nhắn tên dịch vụ (ví dụ: “Rửa xe”) để thêm vào đơn đặt chỗ.`;

          appendMessage({
            role: 'assistant',
            text: replyText,
            services: list,
          });
          speakAssistantText(replyText);
        } else {
          say(languageRef.current === 'en'
            ? 'I cannot load the currently available services. Please try again shortly.'
            : 'Mình chưa tải được danh sách dịch vụ đang hoạt động. Bạn hãy thử lại sau ít phút.');
        }
      }
      else if (route === 'peak_times_info') {
        handlingInputRef.current = false;
        say(languageRef.current === 'en'
          ? 'Parking demand changes with live and forecast data. Please check the 24-hour occupancy forecast below the parking map for the selected date.'
          : 'Mật độ bãi thay đổi theo dữ liệu thực tế và ngày bạn chọn. Bạn hãy xem biểu đồ dự báo mật độ 24 giờ bên dưới bản đồ để biết khung giờ dự kiến đông nhất.');
      }
      else if (route === 'help') {
        handlingInputRef.current = false;
        say(languageRef.current === 'en'
          ? 'I can create, edit or cancel a booking; check spaces, vehicle location and parking fees; and show your vehicles, wallet, transactions, extra services, policies and VIP packages. What would you like help with?'
          : 'Mình có thể đặt, sửa hoặc hủy booking; kiểm tra chỗ trống, vị trí xe và phí đỗ; xem xe, ví, giao dịch, dịch vụ, chính sách và các gói VIP. Bạn muốn hỗ trợ nội dung nào?');
      }
      else if (route === 'greeting') {
        handlingInputRef.current = false;
        say(languageRef.current === 'en'
          ? 'Hello! I can help with parking bookings, spaces, vehicles, fees, services and VIP packages. What would you like to do?'
          : 'Chào bạn! Mình có thể hỗ trợ booking, chỗ trống, xe, phí đỗ, dịch vụ và các gói VIP. Bạn muốn làm gì?');
      }
      else if (route === 'thanks') {
        handlingInputRef.current = false;
        const stillWaiting = confirmationPendingRef.current;
        say(languageRef.current === 'en'
          ? `You are welcome.${stillWaiting ? ' Your current booking is still waiting for confirmation.' : ' Let me know if you need anything else about VALO Parking.'}`
          : `Không có gì.${stillWaiting ? ' Booking hiện tại vẫn đang chờ bạn xác nhận.' : ' Bạn cứ nói nếu cần hỗ trợ thêm về bãi đỗ VALO.'}`);
      }
      else if (route === 'out_of_scope') {
        handlingInputRef.current = false;
        say(languageRef.current === 'en'
          ? 'I only support VALO Parking topics: bookings, available spaces, vehicles, wallet and payments, parking fees, extra services, policies and VIP packages. Which of these can I help you with?'
          : 'Mình chỉ hỗ trợ các vấn đề về bãi đỗ VALO: booking, chỗ trống, xe, ví và thanh toán, phí đỗ, dịch vụ, chính sách và các gói VIP. Bạn muốn mình hỗ trợ mục nào?');
      }
      else if (route === 'cancel') {
        if (pendingAssistantActionRef.current) cancelAssistantAction();
        else if (target && ['CANCEL_BOOKING', 'MODIFY_BOOKING'].includes(intentRef.current)) cancelExistingSelection();
        else cancelPreview();
      }
      else if (route === 'cancel_draft') {
        await discardCurrentSession({ keepMessages: true });
        setConversationPhase('IDLE'); say('Đã dừng yêu cầu đặt chỗ này. Bạn có thể bắt đầu yêu cầu mới khi sẵn sàng.');
      }
      else if (route === 'no_preview') say('Chưa có bản xem trước để xác nhận. Bạn hãy cho mình biết ngày, giờ và xe muốn đặt.');
      else say(languageRef.current === 'en'
        ? 'I am not sure whether you want to confirm, cancel or change this booking. Please tell me the action or the information to change.'
        : 'Mình chưa rõ bạn muốn xác nhận, hủy hay thay đổi booking này. Hãy nói hành động hoặc thông tin bạn muốn đổi.');
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
    appendMessage({ role: 'user', text: displayedText });
    setBusy(true);
    try {
      const directLookup = detectDirectParkingLookup(text);
      const lastBookingConflict = draftRef.current.assistantContext?.lastBookingConflict;
      const lookupPlate = compactLicensePlate(directLookup?.licensePlate);
      const conflictPlate = compactLicensePlate(lastBookingConflict?.licensePlate);
      const needsConflictAwareLookup = directLookup?.intent === 'CHECK_BOOKING_STATUS'
        && lastBookingConflict && (!lookupPlate || lookupPlate === conflictPlate);
      if (directLookup && !needsConflictAwareLookup) {
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
        const localizedMessage = localizeAiBookingMessage(message, languageRef.current);
        intentRef.current = directLookup.intent;
        setIntent(directLookup.intent);
        setAssistantInfo({ intent: directLookup.intent, intents: [directLookup.intent], message: localizedMessage });
        setConversationPhase('IDLE');
        say(localizedMessage);
        return;
      }
      const current = nowInVietnam();
      const result = await interpretAiBooking(
        text,
        {
          ...draftRef.current,
          __intent: intentRef.current,
          __language: languageRef.current,
          __languageLocked: true,
        },
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
      const nextDraft = {
        ...(result.data?.data?.draft || {}),
        __language: languageRef.current,
        __languageLocked: true,
        blockedVipPlate: draftRef.current.blockedVipPlate || '',
      };
      if (nextIntent === 'MODIFY_BOOKING' && requestsUnsupportedBookingEdit(text)) {
        setConversationPhase('IDLE');
        setManualSuggestion(Boolean(onSwitchToManual));
        say(languageRef.current === 'en'
          ? 'The AI assistant can safely change only the booking time. To change the vehicle, parking floor, space, services or voucher, please use the regular booking screen so the system can revalidate the full booking.'
          : 'Trợ lý AI hiện chỉ có thể đổi thời gian booking một cách an toàn. Để đổi xe, tầng, ô đỗ, dịch vụ hoặc voucher, bạn hãy dùng màn hình booking thường để hệ thống kiểm tra lại toàn bộ booking.');
        return;
      }
      const clarification = result.data?.data?.clarification;
      intentRef.current = nextIntent;
      setIntent(nextIntent); updateDraft(nextDraft);
      if (clarification) {
        setConversationPhase('IDLE');
        say(vehicleSelectionPrompt(nextDraft, vehiclesRef.current, clarification, languageRef.current));
        setManualSuggestion(clarification.includes('Đặt chỗ thủ công'));
        return;
      }
      const assistantResult = result.data?.data?.assistantResult;
      let localizedAssistantMessage = '';
      let attachedServices;
      if (assistantResult) {
        localizedAssistantMessage = localizeAiBookingMessage(assistantResult.message, languageRef.current);
        setAssistantInfo({
          intent: result.data?.data?.canonicalIntent || nextIntent,
          intents: result.data?.data?.intents || [nextIntent],
          message: localizedAssistantMessage,
        });
        if (assistantResult.showVipModal || isVipInquiry(text)) {
          setShowVipModal(true);
        }
        if (assistantResult.pendingAction) {
          pendingAssistantActionRef.current = assistantResult.pendingAction;
          setPendingAssistantAction(assistantResult.pendingAction);
          confirmationPendingRef.current = true;
          setConversationPhase('WAITING_CONFIRMATION');
          say(localizedAssistantMessage);
          return;
        }
        const isServiceRelated = ['CHECK_SERVICES', 'BOOK_SERVICE'].includes(result.data?.data?.canonicalIntent)
          || /dịch vụ/i.test(localizedAssistantMessage);
        attachedServices = isServiceRelated && servicesRef.current?.length ? servicesRef.current : undefined;
        if (nextIntent !== 'CREATE_BOOKING') {
          appendMessage({ role: 'assistant', text: localizedAssistantMessage, services: attachedServices });
          speakAssistantText(localizedAssistantMessage);
          setConversationPhase('IDLE');
          return;
        }
      }
      if (nextIntent === 'CREATE_BOOKING') {
        const nextPreview = await prepareAiBooking(nextDraft, gateway, vehiclesRef.current);
        if (request !== requestRef.current) return;
        if (nextPreview.vipPlateRequired) askForAnotherPlate(nextPreview.vipPlateRequired);
        else if (nextPreview.missing) {
          setConversationPhase('IDLE');
          if (assistantResult) {
            appendMessage({ role: 'assistant', text: localizedAssistantMessage, services: attachedServices });
            speakAssistantText(localizedAssistantMessage);
          } else {
            say(nextPreview.missing.join(' '));
          }
        }
        else if (nextPreview.conflicts) {
          rememberSlotSuggestion(nextPreview);
          rememberBookingConflict(nextPreview);
          setConflicts(nextPreview.conflicts);
          setConversationPhase('IDLE');
          say(nextPreview.conflicts.join('\n'));
        }
        else {
          updateDraft((current) => {
            const rest = withoutPendingSlotSuggestion(current);
            const assistantContext = { ...(rest.assistantContext || {}) };
            delete assistantContext.lastBookingConflict;
            return { ...rest, assistantContext, vehicleId: nextPreview.items[0]?.vehicleId || '', licensePlate: nextPreview.items[0]?.licensePlate || current.licensePlate };
          });
          updatePreview(nextPreview);
          confirmationKeyRef.current = crypto.randomUUID();
          confirmationPendingRef.current = true;
          setConversationPhase('WAITING_CONFIRMATION');
          const summaryText = bookingPreviewSummary(nextPreview, nextDraft, languageRef.current);
          appendMessage({
            role: 'assistant',
            text: summaryText,
            services: attachedServices,
          });
          speakAssistantText(summaryText);
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
      } else {
        setConversationPhase('IDLE');
        say(languageRef.current === 'en'
          ? 'I could not match that request to a VALO Parking function. I can help with bookings, available spaces, vehicles, wallet and payments, parking fees, extra services, policies and VIP packages.'
          : 'Mình chưa xác định được yêu cầu đó trong các chức năng của bãi đỗ VALO. Mình có thể hỗ trợ booking, chỗ trống, xe, ví và thanh toán, phí đỗ, dịch vụ, chính sách và các gói VIP.');
      }
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
      else if (checked.conflicts) { rememberSlotSuggestion(checked); rememberBookingConflict(checked); setConflicts(checked.conflicts); setConversationPhase('IDLE'); say(checked.conflicts.join('\n')); }
      else {
        updateDraft((current) => {
          const rest = withoutPendingSlotSuggestion(current);
          const assistantContext = { ...(rest.assistantContext || {}) };
          delete assistantContext.lastBookingConflict;
          return { ...rest, assistantContext, vehicleId: checked.items[0]?.vehicleId || '', licensePlate: checked.items[0]?.licensePlate || current.licensePlate };
        });
        updatePreview(checked); confirmationKeyRef.current = crypto.randomUUID();
        confirmationPendingRef.current = true;
        setConversationPhase('WAITING_CONFIRMATION');
        say(bookingPreviewSummary(checked, draftRef.current, languageRef.current));
      }
    } catch (caught) {
      if (request === requestRef.current) {
        if (isVipBookingRestriction(caught.responseData || caught)) askForAnotherPlate(draftRef.current.licensePlate);
        else reportError(caught.message);
      }
    }
    finally { busyRef.current = false; setBusy(false); resumeVoiceIfReady(); }
  };

  const toggleDraftService = async (service) => {
    if (busyRef.current) return;
    const serviceId = String(service._id);
    const currentIds = Array.isArray(draftRef.current.serviceIds) ? draftRef.current.serviceIds : [];
    const currentNames = Array.isArray(draftRef.current.serviceNames) ? draftRef.current.serviceNames : [];
    const isSelected = currentIds.includes(serviceId);
    const nextIds = isSelected ? currentIds.filter((id) => id !== serviceId) : [...currentIds, serviceId];
    const nextNames = isSelected ? currentNames.filter((name) => name !== service.name) : [...currentNames, service.name];

    const nextDraft = {
      ...draftRef.current,
      serviceIds: nextIds,
      serviceNames: nextNames,
    };
    draftRef.current = nextDraft;
    setDraft(nextDraft);

    const hasBookingTiming = Boolean(
      (nextDraft.startDate || nextDraft.reservationItems?.[0]?.startDate)
      && (nextDraft.startTime || nextDraft.reservationItems?.[0]?.startTime)
      && (nextDraft.endTime || nextDraft.reservationItems?.[0]?.endTime)
      && (nextDraft.licensePlate || nextDraft.licensePlates?.length || nextDraft.reservationItems?.[0]?.licensePlate)
    );

    if (previewRef.current || hasBookingTiming) {
      await refreshPreview();
    } else {
      const actionText = isSelected
        ? (languageRef.current === 'en'
            ? `Removed ${service.name} from your selection.`
            : `Đã bỏ chọn dịch vụ ${service.name}.`)
        : (languageRef.current === 'en'
            ? `Selected ${service.name} (+${money(service.price)}). Please provide your date, time and vehicle to complete booking.`
            : `Đã chọn dịch vụ ${service.name} (+${money(service.price)}). Bạn hãy cung cấp ngày, giờ và xe để hoàn tất đặt chỗ.`);
      say(actionText);
    }
  };

  const startTopUpForShortfall = async (shortfall) => {
    let amountToTopUp = Math.ceil(Number(shortfall));
    if (amountToTopUp > 0 && amountToTopUp < 2000) amountToTopUp = 2000;
    if (!Number.isFinite(amountToTopUp) || amountToTopUp <= 0) {
      reportError('Không thể xác định số tiền cần thanh toán thêm.');
      return;
    }

    voiceSessionRef.current?.pause();
    setTopUpLoading(true);
    setError('');
    setConversationPhase('PROCESSING');
    try {
      const response = await createTopUpUrl(amountToTopUp, { purpose: 'booking_shortfall' });
      if (response.ok && response.data?.data) {
        setTopUpData(response.data.data);
        writePendingBookingPayment('quick', response.data.data);
        setTopUpSuccess(false);
        setShowTopUpModal(true);
        setConversationPhase('WAITING_PAYMENT');
        return;
      }
      if (isPolicyAcceptanceRequired(response.data)) {
        setPolicyItems(extractMissingPolicies(response.data));
        setConversationPhase('WAITING_CONFIRMATION');
        return;
      }
      const paymentError = String(response.data?.message || '');
      if (response.data?.code === 'PAYOS_CHANNEL_UNAVAILABLE'
        || /HTTP\s*200|code:\s*215|không có gói nào đang hoạt động|khong co goi nao dang hoat dong/i.test(paymentError)) {
        setError('');
        setConversationPhase('WAITING_CONFIRMATION');
        say(languageRef.current === 'en'
          ? 'The PayOS payment channel is not active, so I cannot create a top-up QR right now. Your booking preview is still preserved and no booking has been created. Please try again after the payment channel is enabled.'
          : 'Kênh thanh toán PayOS hiện chưa hoạt động nên mình chưa thể tạo mã QR nạp tiền. Bản xem trước booking vẫn được giữ nguyên và chưa tạo booking. Bạn hãy thử lại sau khi kênh thanh toán được kích hoạt.');
        return;
      }
      reportError(paymentError || 'Không thể tạo mã QR thanh toán.');
    } catch {
      reportError('Lỗi mạng khi tạo mã QR thanh toán.');
    } finally {
      setTopUpLoading(false);
    }
  };

  const cancelPendingTopUp = async () => {
    const orderCode = topUpData?.orderCode;
    setTopUpLoading(true);
    try {
      if (orderCode) {
        const response = await getTopUpStatus(orderCode, true);
        if (!response.ok) setError(response.data?.message || 'Không thể hủy giao dịch đang chờ.');
      }
    } catch {
      setError('Lỗi mạng khi hủy giao dịch đang chờ.');
    } finally {
      setShowTopUpModal(false);
      setTopUpData(null);
      clearPendingBookingPayment('quick');
      setTopUpSuccess(false);
      setTopUpLoading(false);
      setConversationPhase('WAITING_CONFIRMATION');
      resumeVoiceIfReady();
    }
  };

  const confirmCreation = async ({ skipWalletCheck = false } = {}) => {
    const currentPreview = previewRef.current;
    if (!currentPreview || busyRef.current || !confirmationPendingRef.current) return;
    const shortfall = Math.max(Number(currentPreview.total || 0) - Number(currentPreview.walletBalance || 0), 0);
    if (!skipWalletCheck && shortfall > 0) {
      await startTopUpForShortfall(shortfall);
      return;
    }
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
        rememberSlotSuggestion(result.refreshed);
        confirmationKeyRef.current = result.refreshed.items ? crypto.randomUUID() : null;
        confirmationPendingRef.current = Boolean(result.refreshed.items);
        setConversationPhase(result.refreshed.items ? 'WAITING_CONFIRMATION' : 'IDLE');
        say(result.refreshed.items
          ? `Thông tin chỗ hoặc giá đã thay đổi. ${bookingPreviewSummary(result.refreshed, draftRef.current, languageRef.current)} Hãy xác nhận lại nếu bạn đồng ý.`
          : result.refreshed.conflicts?.join('\n') || result.refreshed.missing?.join(' ') || 'Chỗ đã thay đổi. Vui lòng kiểm tra lại.');
      } else {
        setSuccess(result.success);
        updatePreview(null);
        confirmationKeyRef.current = null;
        confirmationPendingRef.current = false;
        setConversationPhase('SUCCESS');
        say(bookingSuccessSummary(currentPreview.items, languageRef.current));
        completeCurrentSession();
      }
    } catch (caught) {
      if (isPolicyAcceptanceRequired(caught.responseData)) setPolicyItems(extractMissingPolicies(caught.responseData));
      if (isVipBookingRestriction(caught.responseData || caught)) askForAnotherPlate(currentPreview.items[0]?.licensePlate);
      else reportError(caught.message || 'Không thể tạo booking. Vui lòng thử lại.');
    } finally { busyRef.current = false; setBusy(false); resumeVoiceIfReady(); }
  };
  useEffect(() => { confirmCreationRef.current = confirmCreation; });

  useEffect(() => {
    if (!showTopUpModal || !topUpData?.orderCode) return undefined;
    let cancelled = false;
    let polling = false;

    const checkPayment = async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await getTopUpStatus(topUpData.orderCode);
        const status = String(response.data?.data?.status || '').toUpperCase();
        if (['COMPLETED', 'SUCCESS', 'PAID'].includes(status)) {
          setTopUpSuccess(true);
          if (previewRef.current && confirmationPendingRef.current) {
            await confirmCreationRef.current?.({ skipWalletCheck: true });
          } else {
            setConversationPhase('IDLE');
            setAssistantInfo({
              intent: 'WALLET_BALANCE',
              intents: ['WALLET_BALANCE'],
              message: 'Tiền đã được cộng vào ví. Hãy tiếp tục yêu cầu đang lưu để hệ thống kiểm tra lại chỗ và giá trước khi đặt.',
            });
          }
          if (!cancelled) {
            setShowTopUpModal(false);
            setTopUpData(null);
            setTopUpSuccess(false);
            clearPendingBookingPayment('quick');
          }
        } else if (['CANCELLED', 'CANCELED', 'FAILED'].includes(status)) {
          setShowTopUpModal(false);
          setTopUpData(null);
          setTopUpSuccess(false);
          clearPendingBookingPayment('quick');
          voiceHandlersRef.current.reportError?.('Thanh toán đã bị hủy hoặc không thành công.');
        }
      } catch (caught) {
        console.error('AI booking payment polling error:', caught);
      } finally {
        polling = false;
      }
    };

    const intervalId = window.setInterval(checkPayment, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [showTopUpModal, topUpData?.orderCode]);

  const confirmExistingAction = async () => {
    if (!target || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(''); setConversationPhase('CONFIRMING');
    try {
      const editKey = intent === 'MODIFY_BOOKING' ? JSON.stringify(edit || {}) : '';
      if (intent === 'MODIFY_BOOKING' && actionQuote?.editKey !== editKey) {
        const quote = await prepareAiExistingAction(intent, target, gateway, edit);
        setActionQuote({ ...quote, editKey });
        confirmationPendingRef.current = true;
        setConversationPhase('WAITING_CONFIRMATION');
        say(languageRef.current === 'vi'
          ? `Chi phí sau khi sửa là ${money(quote.newPrice)}. ${quote.extraAmount > 0
            ? `Cần thanh toán thêm ${money(quote.extraAmount)}.`
            : quote.refundAmount > 0 ? `Dự kiến hoàn ${money(quote.refundAmount)}.` : 'Không phát sinh chênh lệch.'} Hãy xác nhận lại nếu bạn đồng ý.`
          : `The updated booking total is ${money(quote.newPrice)}. ${quote.extraAmount > 0
            ? `An additional payment of ${money(quote.extraAmount)} is required.`
            : quote.refundAmount > 0 ? `The estimated refund is ${money(quote.refundAmount)}.` : 'There is no price difference.'} Please confirm again if you agree.`);
        return;
      }
      const result = await confirmAiExistingAction(intent, target, edit, gateway, actionQuote);
      setSuccess(result);
      setTarget(null); setChoices([]); setActionQuote(null);
      confirmationPendingRef.current = false;
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
    session.setExpectLicensePlate(expectsLicensePlateInput());
    session.start();
    setVoiceActive(session.isActive());
  };

  const handleVoiceControl = () => {
    const session = voiceSessionRef.current;
    if (speakingRef.current) {
      speechPendingRef.current = false;
      speakerRef.current?.cancel();
      setError('');
      if (!session) {
        reportError('This browser does not support speech recognition. You can type your request instead.');
        return;
      }
      session.setLanguage(languageRef.current);
      session.setExpectLicensePlate(expectsLicensePlateInput());
      if (session.isActive()) session.resume();
      else session.start();
      setVoiceActive(session.isActive());
      return;
    }
    if (session?.isActive()) {
      session.stop();
      setVoiceActive(false);
      setConversationPhase(confirmationPendingRef.current ? 'WAITING_CONFIRMATION' : 'IDLE');
      return;
    }
    startVoice();
  };

  const changeDraft = (field, value) => {
    requestRef.current += 1;
    confirmationPendingRef.current = false;
    confirmationKeyRef.current = null;
    setConversationPhase('IDLE');
    const sourceIndex = mapSelectionTargetCount > 1
      && ['startDate', 'endDate', 'startTime', 'endTime', 'floorName', 'slotCode'].includes(field)
      ? activeMapTargetIndex : undefined;
    updateDraft((current) => applyBookingDraftField(current, field, value, { sourceIndex }));
    updatePreview(null); setConflicts([]);
  };
  const changePlateInput = (value) => {
    const plates = [...new Set(String(value).split(/[,;]/)
      .map((plate) => plate.replace(/[^A-Z0-9]/gi, '').toUpperCase()).filter(Boolean))];
    requestRef.current += 1;
    confirmationPendingRef.current = false;
    confirmationKeyRef.current = null;
    setConversationPhase('IDLE');
    updateDraft((current) => ({
      ...current, vehicleId: '', licensePlate: plates[0] || '',
      licensePlates: plates.length > 1 ? plates : [],
      requestedVehicleCount: plates.length,
      blockedVipPlate: plates.includes(current.blockedVipPlate) ? current.blockedVipPlate : '',
      reservationItems: plates.length > 1 || (Array.isArray(current.reservationItems) && current.reservationItems.length)
        ? plates.map((plate, index) => ({
          ...(current.reservationItems?.[index] || {}), vehicleId: '', licensePlate: plate,
        }))
        : [],
    }));
    updatePreview(null); setConflicts([]); setAvailability(null);
    setMapTargetIndex((current) => Math.min(current, Math.max(plates.length - 1, 0)));
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
    || 'No vehicle selected';
  const resumeExpired = resumeCandidate?.status === 'EXPIRED';
  const resumeIsBooking = ['CREATE_BOOKING', 'CHECK_AVAILABILITY', 'CANCEL_BOOKING', 'MODIFY_BOOKING', 'VIEW_BOOKING']
    .includes(resumeCandidate?.intent);
  const mapFloorAvailableCount = Array.isArray(mapAvailableSlots)
    ? mapAvailableSlots.filter((slot) => {
      if (mapFloorId && String(slot.floorId) !== String(mapFloorId)) return false;
      if (slot.isDedicatedToCurrentUser) return true;
      const type = String(slot.slotType || '').toLowerCase();
      return type === 'slot' || (mapVehicleType === 'electric_car' && type === 'slot-ev');
    }).length
    : null;
  const mapRangeStart = mapStartTime ? vnParts(mapStartTime) : null;
  const mapRangeEnd = mapEndTime ? vnParts(mapEndTime) : null;
  const selectedPhaseLabels = englishPhaseLabels;
  const selectedAssistantIntentLabels = englishAssistantIntentLabels;
  const serviceVehicleCount = Math.max(
    Number(preview?.items?.length || 0),
    Number(draft.requestedVehicleCount || 0),
    Array.isArray(draft.reservationItems) ? draft.reservationItems.length : 0,
    Array.isArray(draft.licensePlates) ? draft.licensePlates.length : 0,
    draft.licensePlate || draft.vehicleId ? 1 : 0,
    1,
  );
  const serviceUnitTotal = (draft.serviceIds || []).reduce((sum, id) => {
    const service = services.find((item) => String(item._id) === String(id));
    return sum + Number(service?.price || 0);
  }, 0);
  const conversationUi = {
    title: 'VALO Parking Assistant', subtitle: 'Book and search by voice or text',
    speaking: 'Speaking a short reply... Press the microphone to interrupt.',
    listening: 'Listening... You can continue speaking.', microphone: 'Microphone is on...',
    processing: 'Processing...', placeholder: 'Book a space or ask about vehicles, wallet, or availability...',
    inputLabel: 'Request for the AI parking assistant', stopVoice: 'Stop voice conversation',
    startVoice: 'Start voice conversation', stopTitle: 'Microphone is on; click to stop',
    startTitle: 'Start voice microphone', interruptVoice: 'Interrupt and speak',
    interruptTitle: 'Stop the AI voice and start listening', send: 'Send request', confirm: 'Confirm', cancel: 'Cancel',
    insufficient: 'Insufficient Balance', topUpPrefix: 'You need to top up', topUpSuffix: 'to complete this checkout.',
    noQr: 'No QR data', scanQr: 'Scan with your banking app or e-wallet to pay.', alternatively: 'Alternatively,',
    checkout: 'click here to checkout', received: 'Payment received! Processing checkout...',
    waitingPayment: 'Waiting for your payment...', cancelling: 'Cancelling...',
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 pb-8">
      <section className="xl:col-span-5 rounded-3xl border border-gray-200 bg-white shadow-sm flex flex-col min-h-[560px] overflow-hidden">
        <div className="border-b border-gray-100 bg-gradient-to-r from-yellow-50 to-white px-5 py-4 flex items-center gap-3">
          <div className="rounded-2xl bg-yellow-400 p-2.5 text-gray-900"><Bot size={22} /></div>
          <div className="flex-1"><h2 className="font-black text-gray-900">{conversationUi.title}</h2><p className="text-xs text-gray-500">{conversationUi.subtitle}</p></div>
          <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1" aria-label="Voice recognition language">
            <button type="button" onClick={() => updateLanguage('vi')} className={`rounded-lg px-2 py-1 text-[11px] font-black transition ${language === 'vi' ? 'bg-yellow-400 text-gray-900' : 'text-gray-500 hover:bg-gray-50'}`} aria-pressed={language === 'vi'} title="Use Vietnamese for chat and speech">VI</button>
            <button type="button" onClick={() => updateLanguage('en')} className={`rounded-lg px-2 py-1 text-[11px] font-black transition ${language === 'en' ? 'bg-yellow-400 text-gray-900' : 'text-gray-500 hover:bg-gray-50'}`} aria-pressed={language === 'en'} title="Use English for chat and speech">EN</button>
          </div>
          <button type="button" onClick={() => {
            voiceEnabledRef.current = !voiceEnabledRef.current;
            setVoiceEnabled(voiceEnabledRef.current);
            if (!voiceEnabledRef.current) speakerRef.current?.cancel();
          }} className="rounded-xl border border-gray-200 p-2 text-gray-600" aria-label={voiceEnabled ? 'Turn off AI voice' : 'Turn on AI voice'} title={voiceEnabled ? 'Turn off AI voice' : 'Turn on AI voice'}>{voiceEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
        </div>
        <div role="status" aria-live="polite" className="border-b border-gray-100 px-5 py-2 text-xs font-bold text-gray-600">
          {speaking ? conversationUi.speaking : busy ? selectedPhaseLabels[phase] : listening ? conversationUi.listening : voiceActive ? conversationUi.microphone : selectedPhaseLabels[phase]}
        </div>
        {sessionLoading && <div className="mx-5 mt-4 flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Checking saved booking session...</div>}
        {!sessionLoading && resumeCandidate && (
          <div className="mx-5 mt-3 rounded-2xl border border-yellow-300 bg-gradient-to-br from-yellow-50 to-amber-50 p-3 shadow-sm">
            <div className="flex items-start gap-2.5">
              <div className="rounded-xl bg-yellow-400 p-2 text-gray-900"><Bot size={17} /></div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-black text-gray-900">{resumeExpired ? 'Conversation expired' : resumeIsBooking ? 'Continue booking' : 'Continue conversation'}</h3>
                {resumeExpired ? (
                  <p className="mt-1 text-xs leading-5 text-amber-900">The previous session is over 30 minutes old. Start a new booking.</p>
                ) : (
                  <div className="mt-1.5 space-y-1 text-xs text-gray-700">
                    {(resumeDate || resumeStartTime || resumeEndTime) && (
                      <p className="font-semibold">
                        {resumeDate && (resumeDate.includes('-') && !resumeDate.includes(',') ? dayText(resumeDate) : resumeDate)}
                        {resumeDate && (resumeStartTime || resumeEndTime) ? ' · ' : ''}
                        {(resumeStartTime || resumeEndTime) && `${resumeStartTime || '--:--'}–${resumeEndTime || '--:--'}`}
                      </p>
                    )}
                    <p className="truncate"><span className="font-semibold">Vehicle:</span> {resumeVehicle}</p>
                    {resumeIsBooking && <p><span className="font-semibold">Current step:</span> {aiBookingStepLabel(resumeCandidate.currentStep)}</p>}
                    {resumeIsBooking && <div className="pt-0.5">
                      <div className="mb-1 flex justify-between text-[11px] font-bold text-gray-600"><span>Progress</span><span>{resumeCandidate.completionPercent || 0}%</span></div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-yellow-400 transition-all" style={{ width: `${resumeCandidate.completionPercent || 0}%` }} /></div>
                    </div>}
                  </div>
                )}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {!resumeExpired && <button type="button" onClick={continueBooking} className="rounded-xl bg-gray-900 px-3.5 py-1.5 text-xs font-black text-white">Continue</button>}
                  <button type="button" onClick={handleNewBooking} className="rounded-xl border border-yellow-400 bg-white px-3.5 py-1.5 text-xs font-black text-yellow-900">Start new</button>
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={conversationRef} className="flex-1 max-h-[520px] overflow-y-auto scrollbar-hidden px-5 py-5 space-y-3" aria-live="polite">
          {messages.map((message, index) => (
            <div key={message.id || `${message.role}-${index}`} className={`max-w-[90%] whitespace-pre-line rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === 'user' ? 'ml-auto bg-gray-900 text-white' : 'bg-yellow-50 border border-yellow-100 text-gray-800'}`}>
              <div>{message.text ?? message.content}</div>
              {message.services && Array.isArray(message.services) && message.services.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-amber-200/60 flex flex-wrap gap-2">
                  {message.services.map((service) => {
                    const isSelected = Array.isArray(draft.serviceIds) && draft.serviceIds.includes(service._id);
                    return (
                      <button
                        key={service._id}
                        type="button"
                        disabled={busy}
                        onClick={() => toggleDraftService(service)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-sm ${
                          isSelected
                            ? 'bg-amber-500 text-white shadow-amber-200 ring-2 ring-amber-400'
                            : 'bg-white border border-amber-300 text-amber-900 hover:bg-amber-100/60'
                        }`}
                      >
                        {isSelected ? <CheckCircle2 size={13} strokeWidth={3} /> : <Sparkles size={13} className="text-amber-500" />}
                        <span>{service.name}</span>
                        <span className={`text-[11px] font-black ${isSelected ? 'text-amber-100' : 'text-amber-700'}`}>
                          ({money(service.price)})
                        </span>
                        <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded ${isSelected ? 'bg-amber-600 text-white font-black' : 'bg-amber-100 text-amber-800'}`}>
                          {isSelected ? 'Selected' : '+ Add'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="inline-flex items-center gap-2 rounded-2xl bg-gray-100 px-4 py-3 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> {conversationUi.processing}</div>}
        </div>
        {error && <div role="alert" className="mx-5 mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
        {sessionSaving === 'offline' && hasStarted && <div className="mx-5 mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">This conversation is safely stored on this device and will sync automatically.</div>}
        {manualSuggestion && onSwitchToManual && <button type="button" onClick={onSwitchToManual} className="mx-5 mb-3 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-bold text-yellow-900">Switch to manual booking</button>}
        <form className="border-t border-gray-100 p-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); submitMessage(); }}>
          <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={conversationUi.placeholder} className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm outline-none focus:border-yellow-400" aria-label={conversationUi.inputLabel} />
          <button type="button" disabled={busy && !voiceActive && !speaking} onClick={handleVoiceControl} className={`rounded-xl p-3 disabled:opacity-50 ${speaking ? 'bg-yellow-400 text-gray-900 ring-2 ring-yellow-200' : voiceActive ? 'bg-rose-100 text-rose-600' : 'bg-gray-100 text-gray-700'}`} aria-label={speaking ? conversationUi.interruptVoice : voiceActive ? conversationUi.stopVoice : conversationUi.startVoice} title={speaking ? conversationUi.interruptTitle : voiceActive ? conversationUi.stopTitle : conversationUi.startTitle}>{speaking ? <Mic size={19} /> : voiceActive ? <MicOff size={19} /> : <Mic size={19} />}</button>
          <button type="submit" disabled={!prompt.trim() || busy} className="rounded-xl bg-yellow-400 p-3 text-gray-900 disabled:opacity-50" aria-label={conversationUi.send}><Send size={19} /></button>
        </form>
      </section>

      <section className="xl:col-span-7 rounded-3xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm min-h-[560px]">
        <div className="mb-5 flex items-center gap-3"><Sparkles size={21} className="text-yellow-500" /><div><h2 className="text-lg font-black text-gray-900">{assistantInfo ? 'Information from VALO' : intent === 'CHECK_AVAILABILITY' ? 'Available spaces' : intent === 'VIEW_BOOKING' ? 'Your booking' : intent === 'CANCEL_BOOKING' ? 'Confirm cancellation' : intent === 'MODIFY_BOOKING' ? 'Edit booking' : 'Booking preview'}</h2><p className="text-xs text-gray-500">Changes are applied only after you confirm.</p></div></div>
        {preview?.items && <div className="mb-4 flex flex-wrap items-center gap-2"><div className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-black text-amber-800">WAITING FOR CONFIRMATION · Booking not created</div><span className="text-xs font-semibold text-gray-500">The space will be rechecked and held when you confirm.</span></div>}

        {success && <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800"><div className="flex items-center gap-2 font-black"><CheckCircle2 size={20} /> Action completed</div><Link to="/customer/booking" className="mt-2 inline-block text-sm font-bold underline">View My Bookings</Link></div>}

        {assistantInfo && <div className="mb-5 rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm leading-6 text-gray-800 whitespace-pre-line"><div className="mb-2 text-xs font-black uppercase tracking-wide text-yellow-800">{assistantInfo.intents.map((item) => selectedAssistantIntentLabels[item] || item).join(' · ')}</div>{localizeAiBookingMessage(assistantInfo.message, 'en')}{pendingAssistantAction && <div className="mt-4 flex gap-3"><button type="button" disabled={busy} onClick={confirmAssistantAction} className="rounded-xl bg-gray-900 px-4 py-2.5 font-black text-white">{conversationUi.confirm}</button><button type="button" disabled={busy} onClick={cancelAssistantAction} className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 font-bold">{conversationUi.cancel}</button></div>}</div>}

        {intent === 'CREATE_BOOKING' && (draft.startDate || draft.startTime || draft.licensePlate) && !success && (
          <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {mapSelectionTargetCount > 1 && <div className="sm:col-span-2 flex flex-wrap gap-2 rounded-xl border border-cyan-100 bg-cyan-50 p-3"><span className="w-full text-xs font-black text-cyan-900">Editing each vehicle separately:</span>{mapSelectionTargets.map((item) => <button key={item.index} type="button" onClick={() => setMapTargetIndex(item.index)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${activeMapTargetIndex === item.index ? 'bg-cyan-600 text-white' : 'border border-cyan-200 bg-white text-cyan-800'}`}>{item.licensePlate || `Vehicle ${item.index + 1}`}</button>)}</div>}
            <label className="text-xs font-bold text-gray-500">Start date<input type="date" min={currentVietnam.today} disabled={busy} value={(mapSelectionTargetCount > 1 ? activeMapTarget?.startDate : draft.startDate) || ''} onChange={(event) => changeDraft('startDate', event.target.value)} className={fieldClass} /></label>
            <label className="text-xs font-bold text-gray-500">End date<input type="date" min={(mapSelectionTargetCount > 1 ? activeMapTarget?.startDate : draft.startDate) || currentVietnam.today} disabled={busy} value={(mapSelectionTargetCount > 1 ? activeMapTarget?.endDate : (draft.endDate || draft.startDate)) || ''} onChange={(event) => changeDraft('endDate', event.target.value)} className={fieldClass} /></label>
            <label className="text-xs font-bold text-gray-500">Arrival time<input type="time" min={(mapSelectionTargetCount > 1 ? activeMapTarget?.startDate : draft.startDate) === currentVietnam.today ? currentVietnam.currentTime : undefined} disabled={busy} value={(mapSelectionTargetCount > 1 ? activeMapTarget?.startTime : draft.startTime) || ''} onChange={(event) => changeDraft('startTime', event.target.value)} className={fieldClass} /></label>
            <label className="text-xs font-bold text-gray-500">Departure time<input type="time" disabled={busy} value={(mapSelectionTargetCount > 1 ? activeMapTarget?.endTime : draft.endTime) || ''} onChange={(event) => changeDraft('endTime', event.target.value)} className={fieldClass} /></label>
            <label className="text-xs font-bold text-gray-500">Vehicle<select disabled={busy || mapSelectionTargetCount > 1} value={mapSelectionTargetCount > 1 ? '' : (draft.vehicleId || '')} onChange={(event) => { const vehicle = vehicles.find((item) => item._id === event.target.value); requestRef.current += 1; confirmationPendingRef.current = false; confirmationKeyRef.current = null; setConversationPhase('IDLE'); updateDraft((current) => applySingleVehicleSelectionToDraft(current, vehicle)); updatePreview(null); setConflicts([]); setMapTargetIndex(0); }} className={fieldClass}><option value="">{mapSelectionTargetCount > 1 ? 'Edit the list in the license plate field' : 'Select a vehicle or enter a license plate'}</option>{vehicles.filter((item) => item.status === 'approved' && (!draft.vehicleType || item.vehicleType === draft.vehicleType)).map((vehicle) => <option key={vehicle._id} value={vehicle._id}>{vehicle.licensePlate}</option>)}</select></label>
            <label className="text-xs font-bold text-gray-500">License plates (comma-separated for multiple vehicles)<input disabled={busy} value={(draft.licensePlates?.length > 1 ? draft.licensePlates.join(', ') : draft.licensePlate) || ''} onChange={(event) => changePlateInput(event.target.value)} className={fieldClass} placeholder="43A12345, 43B20404" /></label>
            <label className="text-xs font-bold text-gray-500">Floor (optional)<input disabled={busy} value={(mapSelectionTargetCount > 1 ? activeMapTarget?.floorName : draft.floorName) || ''} onChange={(event) => changeDraft('floorName', event.target.value)} className={fieldClass} placeholder="Floor 2" /></label>
            <label className="text-xs font-bold text-gray-500">Parking space (optional)<input disabled={busy} value={(mapSelectionTargetCount > 1 ? activeMapTarget?.slotCode : draft.slotCode) || ''} onChange={(event) => changeDraft('slotCode', event.target.value)} className={fieldClass} placeholder="A-015" /></label>
            <button type="button" onClick={refreshPreview} disabled={busy} className="sm:col-span-2 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 font-black text-yellow-900 disabled:opacity-50">Check availability and price again</button>
          </div>
        )}

        {/* Extra services selector in right panel */}
        {services.length > 0 && !success && (intent === 'CREATE_BOOKING' || preview?.items || draft.startDate || draft.licensePlate) && (
          <div className="mb-5 rounded-2xl border border-gray-200 bg-gray-50/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Sparkles size={16} className="text-yellow-500" />
                <span className="text-xs font-black uppercase tracking-wider text-gray-900">
                  Extra services
                </span>
              </div>
              <span className="text-xs font-black text-yellow-700">
                {money(serviceUnitTotal * serviceVehicleCount)}
              </span>
            </div>
            <p className="text-[11px] text-gray-500 mb-2.5">
              {serviceVehicleCount > 1
                ? `Selected services apply to each vehicle (${serviceVehicleCount} vehicles); the displayed total includes every vehicle.`
                : 'Add vehicle-care services to be performed during the parking period.'}
            </p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-hidden pr-1">
              {services.map((service) => {
                const isSelected = Array.isArray(draft.serviceIds) && draft.serviceIds.includes(service._id);
                return (
                  <button
                    key={service._id}
                    type="button"
                    disabled={busy}
                    onClick={() => toggleDraftService(service)}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition flex items-center justify-between ${
                      isSelected
                        ? 'bg-amber-50/80 border-amber-400 shadow-sm'
                        : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-amber-500 border-amber-500 text-white' : 'border-gray-300 bg-white'
                      }`}>
                        {isSelected && <CheckCircle2 size={12} strokeWidth={3} />}
                      </div>
                      <div>
                        <div className="font-bold text-xs text-gray-900 leading-tight">{service.name}</div>
                        <div className="text-[10px] text-gray-400 leading-tight">
                          {service.timeCost || 30} minutes {service.description ? `· ${service.description}` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs font-black text-gray-900">{money(service.price)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {conflicts.length > 0 && <div role="alert" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><div className="mb-2 font-black">Unable to book</div>{conflicts.map((conflict, index) => <p key={index} className="mb-1">{localizeAiBookingMessage(conflict, 'en')}</p>)}</div>}

        {preview?.items && <div className="space-y-3">
          {preview.suggestVipPackage && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
              <div className="flex items-start gap-2.5">
                <Sparkles size={20} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-black text-amber-900">Long-stay option: Review VIP packages</div>
                  <div className="text-xs text-amber-800 mt-0.5">
                    This booking is longer than 7 days. Review the current VIP package rates, benefits, and conditions.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowVipModal(true)}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-white hover:bg-amber-600 transition shadow-sm active:scale-[0.98]"
              >
                View VIP Packages
              </button>
            </div>
          )}
          {preview.items.map((item, index) => {
            const start = vnParts(item.startTime);
            const end = vnParts(item.endTime);
            return (
              <div key={item.clientItemId} className="rounded-2xl border border-gray-200 bg-gray-50 p-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-black text-gray-900">{dayText(start.date)} {start.time} → {dayText(end.date)} {end.time}</div>
                  <div className="text-sm text-gray-500">{item.licensePlate} · Continuous reservation · {item.floorName} · {item.slotCode}</div>
                  {Array.isArray(draft.serviceNames) && draft.serviceNames.length > 0 && (
                    <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800 border border-amber-200">
                      <Sparkles size={12} className="text-amber-600" />
                      Services: {draft.serviceNames.join(', ')}
                    </div>
                  )}
                  {index === 0 && draft.voucherName && (
                    <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800">
                      Voucher: {draft.voucherName}
                    </div>
                  )}
                </div>
                <strong className="text-yellow-700">{money(preview.quotes?.[index]?.totalAmount)}</strong>
              </div>
            );
          })}
          <div className="rounded-2xl bg-gray-900 p-5 text-white flex justify-between items-center">
            <div>
              <span>Continuous reservation{preview.durationMinutes ? ` · ${durationText(preview.durationMinutes)}` : ''}</span>
              {Array.isArray(draft.serviceNames) && draft.serviceNames.length > 0 && (
                <div className="text-xs text-yellow-300/80 font-normal mt-0.5">
                  Includes services: {draft.serviceNames.join(', ')}
                </div>
              )}
            </div>
            <strong className="text-xl text-yellow-300">{money(preview.total)}</strong>
          </div>
          {preview.walletBalance < preview.total && <p className="text-sm text-rose-600">Your wallet balance is {money(preview.walletBalance)}. You can scan a QR code to pay the remaining {money(preview.total - preview.walletBalance)} when you confirm.</p>}
          <div className="flex gap-3"><button type="button" onClick={() => confirmCreation()} disabled={busy || topUpLoading} className="flex-1 rounded-xl bg-yellow-400 px-4 py-3 font-black text-gray-900 disabled:opacity-50">{preview.walletBalance < preview.total ? 'Confirm & pay by QR' : 'Confirm booking'}</button><button type="button" onClick={cancelPreview} disabled={busy || topUpLoading} className="rounded-xl border border-gray-200 px-4 py-3 font-bold text-gray-600 disabled:opacity-50">Cancel</button></div>
        </div>}

        {availability && <div className="space-y-3">{availability.map((day) => <div key={`${day.date}-${day.endDate}`} className="rounded-2xl border border-gray-200 p-4"><strong>{dayText(day.date)} → {dayText(day.endDate)}: {day.count} continuous spaces available</strong><p className="text-sm text-gray-500">{day.suggestions.map((slot) => `${slot.floorName} · ${slot.slotCode}`).join(', ') || 'Try another time or floor.'}</p></div>)}</div>}

        {choices.length > 0 && <div className="space-y-2 mb-5">{choices.map((booking) => <button key={booking._id} type="button" onClick={() => selectTarget(booking).catch((caught) => setError(caught.message))} className={`block w-full rounded-xl border p-4 text-left text-sm font-bold ${target?._id === booking._id ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 hover:border-yellow-300'}`}>{labelBooking(booking)} <span className="ml-2 text-gray-400">{booking.status}</span></button>)}</div>}

        {target && intent === 'VIEW_BOOKING' && <div className="rounded-2xl bg-gray-50 p-5 text-sm"><p className="font-black">{labelBooking(target)}</p><p>Status: {target.status}</p><p>Amount paid: {money(target.prepaidAmount)}</p></div>}
        {target && intent === 'CANCEL_BOOKING' && actionQuote && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5"><p className="font-black text-gray-900">{labelBooking(target)}</p><p className="mt-2 text-sm text-gray-700">Estimated refund: {money(actionQuote.refundAmount)}</p><div className="mt-4 flex gap-3"><button type="button" disabled={busy} onClick={confirmExistingAction} className="rounded-xl bg-rose-600 px-4 py-3 font-black text-white">Confirm cancellation</button><button type="button" onClick={cancelExistingSelection} className="rounded-xl border border-gray-200 bg-white px-4 py-3 font-bold">Keep booking</button></div></div>}
        {target && intent === 'MODIFY_BOOKING' && edit && <div className="rounded-2xl bg-gray-50 p-5 space-y-3"><p className="font-black">{labelBooking(target)}</p><div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold">Arrival date<input type="date" value={edit.startDate} disabled={target.status !== 'PAID'} onChange={(event) => { setEdit((current) => ({ ...current, startDate: event.target.value })); setActionQuote(null); }} className={`${fieldClass} disabled:opacity-50`} /></label><label className="text-xs font-bold">Arrival time<input type="time" value={edit.startTime} disabled={target.status !== 'PAID'} onChange={(event) => { setEdit((current) => ({ ...current, startTime: event.target.value })); setActionQuote(null); }} className={`${fieldClass} disabled:opacity-50`} /></label><label className="text-xs font-bold">Departure date<input type="date" value={edit.endDate} onChange={(event) => { setEdit((current) => ({ ...current, endDate: event.target.value })); setActionQuote(null); }} className={fieldClass} /></label><label className="text-xs font-bold">Departure time<input type="time" value={edit.endTime} onChange={(event) => { setEdit((current) => ({ ...current, endTime: event.target.value })); setActionQuote(null); }} className={fieldClass} /></label></div><p className="text-xs text-gray-500">{target.status === 'PAID' ? 'The system will check availability and show the price difference before applying the change.' : 'The vehicle has entered the parking lot, so only the departure time can be changed. The price difference will be shown before the change is applied.'}</p>{actionQuote?.editKey && <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900"><div className="flex justify-between"><span>New total</span><strong>{money(actionQuote.newPrice)}</strong></div><div className="mt-1 flex justify-between"><span>{actionQuote.extraAmount > 0 ? 'Additional payment' : 'Refund'}</span><strong>{money(actionQuote.extraAmount || actionQuote.refundAmount || 0)}</strong></div></div>}<div className="flex gap-3"><button type="button" disabled={busy} onClick={confirmExistingAction} className="rounded-xl bg-yellow-400 px-4 py-3 font-black">{actionQuote?.editKey ? 'Confirm changes' : 'Check price difference'}</button><button type="button" onClick={cancelExistingSelection} className="rounded-xl border border-gray-200 bg-white px-4 py-3 font-bold">Cancel</button></div></div>}

        {!preview && !availability && !choices.length && !success && !conflicts.length && !assistantInfo && <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 text-center text-gray-400"><CalendarDays size={32} className="mb-3" /><p className="text-sm">Results or a booking preview will appear here.</p></div>}
      </section>

      <section className="xl:col-span-12 rounded-3xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-3 pt-2">
          <div>
            <div className="flex items-center gap-2">
              <MapPin size={20} className="text-cyan-500" />
              <h2 className="text-lg font-black text-gray-900">Live parking map</h2>
            </div>
            <p className="mt-1 text-sm font-medium text-gray-500">
              {mapRangeStart && mapRangeEnd
                ? `Availability from ${dayText(mapRangeStart.date)} ${mapRangeStart.time} to ${dayText(mapRangeEnd.date)} ${mapRangeEnd.time}. Select an available space; your selection is highlighted in blue.`
                : 'Enter the booking dates and times to see availability. Current parking occupancy continues to update live.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {mapFloorAvailableCount !== null && (
              <div className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-600">
                {mapFloorAvailableCount} spaces available on this floor
              </div>
            )}
            <button type="button" onClick={() => refreshMapAvailability()} disabled={mapLoading || !mapStartTime || !mapEndTime} className="rounded-xl border border-gray-200 bg-white p-2.5 text-gray-600 transition hover:border-cyan-300 hover:text-cyan-600 disabled:opacity-40" aria-label="Refresh parking map">
              <RefreshCw size={17} className={mapLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {mapSelectionTargetCount > 1 && (
          <div className="mx-2 mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-cyan-100 bg-cyan-50 p-3">
            <span className="mr-1 text-xs font-black text-cyan-900">Selecting a space for:</span>
            {mapSelectionTargets.map((target) => (
              <button key={target.index} type="button" onClick={() => setMapTargetIndex(target.index)} className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${activeMapTargetIndex === target.index ? 'bg-cyan-600 text-white' : 'border border-cyan-200 bg-white text-cyan-800'}`}>
                {target.licensePlate || `Vehicle ${target.index + 1}`}{target.slotCode ? ` · ${target.slotCode}` : ''}
              </button>
            ))}
          </div>
        )}

        {mapError && <div role="alert" className="mx-2 mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800">{mapError}</div>}

        <div className="relative h-[500px] w-full overflow-hidden rounded-2xl border border-[#0b0e16] bg-[#0b0e16] shadow-inner">
          {mapFloors.length > 0 && (
            <div className="absolute left-0 right-0 top-4 z-30 flex flex-wrap justify-center gap-2 px-4">
              {mapFloors.map((floor) => (
                <button key={floor._id} type="button" onClick={() => onMapFloorSelect?.(floor._id)} className={`rounded-full px-6 py-1.5 text-xs font-bold shadow-sm transition-all ${mapFloorId === floor._id ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' : 'border border-white/10 bg-[#181c23]/80 text-gray-400 backdrop-blur hover:bg-[#1f242d]/80 hover:text-white'}`}>
                  {floor.name}
                </button>
              ))}
            </div>
          )}

          {mapLoading && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0b0e16]/70 text-center backdrop-blur-sm">
              <Loader2 size={36} className="mb-3 animate-spin text-cyan-400" />
              <p className="font-black text-white">Updating availability...</p>
            </div>
          )}

          {mapFloors.length ? (
            <ParkingMapViewer
              floors={mapFloors}
              currentFloorId={mapFloorId}
              onFloorSelect={onMapFloorSelect}
              activeSessions={mapActiveSessions}
              dbSlots={mapDbSlots}
              activeHolds={mapActiveHolds}
              availableSlots={mapAvailableSlots}
              selectedSlotId={selectedMapSlots}
              onSelectSlot={selectMapSlot}
              vehicleType={mapVehicleType}
              allowScheduledAvailabilityOverride
              is2DMode
              hideUI
              staticFit
              readOnly={busy}
              theme="dark"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center text-gray-400">
              <MapPin size={36} className="mb-3 text-cyan-500" />
              <p className="font-bold text-white">No parking map available</p>
            </div>
          )}

          <div className="pointer-events-none absolute bottom-4 left-0 right-0 z-30 flex justify-center px-4">
            <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-4 rounded-full border border-white/10 bg-[#181c23]/80 px-5 py-2.5 shadow-lg backdrop-blur">
              <span className="hidden text-[10px] font-black uppercase tracking-widest text-cyan-400 sm:block">Legend</span>
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-gray-300"><i className="h-3.5 w-3.5 rounded-sm border border-gray-300 bg-white" />Available</span>
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-gray-300"><i className="h-3.5 w-3.5 rounded-sm border border-rose-600 bg-rose-200" />Occupied</span>
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-gray-300"><i className="h-3.5 w-3.5 rounded-sm border border-cyan-400 bg-cyan-500" />Selected</span>
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-yellow-500"><i className="h-3.5 w-3.5 rounded-sm border border-yellow-500 bg-yellow-100" />VIP</span>
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-orange-500"><i className="h-3.5 w-3.5 rounded-sm border border-orange-500 bg-orange-100" />Held/booked</span>
            </div>
          </div>
        </div>
      </section>

      {showTopUpModal && topUpData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-md">
          <div className="flex w-full max-w-sm flex-col items-center rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-2xl">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-rose-500 shadow-sm">
              <AlertCircle size={32} />
            </div>
            <h2 className="mb-1 text-2xl font-black text-gray-900">{conversationUi.insufficient}</h2>
            <p className="mb-6 text-sm font-medium text-gray-500">
              {conversationUi.topUpPrefix} <span className="font-bold text-gray-900">{money(topUpData.amount)}</span> {conversationUi.topUpSuffix}
            </p>

            <div className="mb-4 rounded-2xl border border-gray-100 bg-gray-50 p-4 shadow-inner">
              {topUpData.qrCode ? (
                <QRCodeSVG value={String(topUpData.qrCode)} size={200} />
              ) : (
                <div className="flex h-[200px] w-[200px] items-center justify-center text-sm font-medium text-gray-400">{conversationUi.noQr}</div>
              )}
            </div>

            <p className="mb-6 text-xs font-medium text-gray-500">
              {conversationUi.scanQr}<br />
              {topUpData.checkoutUrl && <>{conversationUi.alternatively} <a href={topUpData.checkoutUrl} target="_blank" rel="noreferrer" className="font-bold text-blue-500 hover:underline">{conversationUi.checkout}</a>.</>}
            </p>

            <div className="mb-6 flex items-center justify-center gap-2 text-sm font-black text-yellow-600">
              <Loader2 size={16} className="animate-spin" />
              {topUpSuccess ? conversationUi.received : conversationUi.waitingPayment}
            </div>

            <button type="button" disabled={topUpSuccess || topUpLoading} onClick={cancelPendingTopUp} className="w-full rounded-2xl bg-gray-100 py-3.5 font-bold text-gray-700 transition hover:bg-gray-200 disabled:opacity-50">
              {topUpLoading ? conversationUi.cancelling : conversationUi.cancel}
            </button>
          </div>
        </div>
      )}

      <VipPackageModal
        isOpen={showVipModal}
        onClose={() => setShowVipModal(false)}
        onSubscribed={(vipInfo) => {
          const currentLanguage = languageRef.current;
          requestRef.current += 1;
          setShowVipModal(false);
          completeCurrentSession();
          clearResult();
          clearPendingBookingPayment('quick');
          updateDraft({ __language: currentLanguage, __languageLocked: true });
          intentRef.current = 'UNKNOWN';
          setIntent('UNKNOWN');
          setConversationPhase('IDLE');
          say(currentLanguage === 'vi'
            ? `Chúc mừng bạn đã đăng ký thành công ${vipInfo.package?.name}! Ô ${vipInfo.slotCode} tại ${vipInfo.floorName} đã là ô VIP riêng của bạn. Bản booking theo giờ đang chờ đã được đóng; bạn có thể dùng trực tiếp ô VIP mà không cần đặt lại.`
            : `${vipInfo.package?.name} has been activated successfully. Space ${vipInfo.slotCode} on ${vipInfo.floorName} is now your dedicated VIP space. The pending hourly-booking draft has been closed; you can use the VIP space directly without booking it again.`);
          if (onVehiclesChanged) onVehiclesChanged();
        }}
      />

      <PolicyAcceptancePrompt open={policyItems.length > 0} missingPolicies={policyItems} onClose={() => setPolicyItems([])} onAccepted={() => { setPolicyItems([]); say(languageRef.current === 'vi' ? 'Đã chấp nhận chính sách. Vui lòng xác nhận booking lại.' : 'The policies have been accepted. Please confirm the booking again.'); }} />
    </div>
  );
}
