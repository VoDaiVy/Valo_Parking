export const AI_BOOKING_STORAGE_KEY = 'valo_ai_booking_session';
export const AI_BOOKING_SESSION_TTL_MS = 30 * 60 * 1000;

export const getAiBookingOwnerKey = (storage = globalThis.sessionStorage) => {
  try {
    const user = JSON.parse(storage?.getItem('valo_user') || 'null');
    return String(user?.id || user?._id || user?.email || '');
  } catch {
    return '';
  }
};

const platesFromDraft = (draft = {}) => [...new Set([
  draft.licensePlate,
  ...(Array.isArray(draft.licensePlates) ? draft.licensePlates : []),
  ...(Array.isArray(draft.reservationItems)
    ? draft.reservationItems.map((item) => item?.licensePlate) : []),
].map((plate) => String(plate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase()).filter(Boolean))];

export const deriveAiBookingProgress = ({ bookingDraft = {}, phase = 'IDLE', status = 'ACTIVE' } = {}) => {
  if (status === 'COMPLETED' || phase === 'SUCCESS') return { currentStep: 'COMPLETED', completionPercent: 100 };
  const items = Array.isArray(bookingDraft.reservationItems) ? bookingDraft.reservationItems : [];
  const hasDate = Boolean(bookingDraft.startDate || bookingDraft.date)
    || (items.length > 0 && items.every((item) => item?.date || item?.startDate));
  if (!hasDate) return { currentStep: 'COLLECT_DATE', completionPercent: 10 };
  const hasTime = Boolean(bookingDraft.startTime && bookingDraft.endTime)
    || (items.length > 0 && items.every((item) => item?.startTime && item?.endTime));
  if (!hasTime) return { currentStep: 'COLLECT_TIME', completionPercent: 30 };
  const count = Math.max(1, Number(bookingDraft.requestedVehicleCount || 1));
  if (platesFromDraft(bookingDraft).length < count) return { currentStep: 'SELECT_VEHICLE', completionPercent: 50 };
  if (phase === 'BOOKING' || phase === 'CONFIRMING') return { currentStep: 'PAYMENT', completionPercent: 95 };
  if (phase === 'WAITING_CONFIRMATION') return { currentStep: 'CONFIRM_BOOKING', completionPercent: 90 };
  return { currentStep: 'SELECT_SLOT', completionPercent: 70 };
};

export const aiBookingStepLabel = (step) => ({
  COLLECT_DATE: 'Chọn ngày',
  COLLECT_TIME: 'Chọn giờ',
  SELECT_VEHICLE: 'Chọn xe',
  SELECT_SLOT: 'Kiểm tra vị trí đỗ',
  SELECT_SERVICE: 'Chọn dịch vụ',
  CONFIRM_BOOKING: 'Xác nhận đặt chỗ',
  PAYMENT: 'Hoàn tất thanh toán',
  COMPLETED: 'Đã hoàn tất',
}[step] || 'Tiếp tục đặt chỗ');

export const sanitizeAiBookingPreview = (preview) => {
  if (!preview?.items) return null;
  return {
    items: preview.items.map((item) => ({
      clientItemId: item.clientItemId,
      date: item.date,
      startTime: item.startTime,
      endTime: item.endTime,
      vehicleId: item.vehicleId || '',
      licensePlate: item.licensePlate || '',
      floorId: item.floorId || '',
      floorName: item.floorName || '',
      slotCode: item.slotCode || '',
      vehicleType: item.vehicleType || '',
    })),
    quotes: Array.isArray(preview.quotes)
      ? preview.quotes.map((quote) => ({ totalAmount: Number(quote?.totalAmount || 0) })) : [],
    total: Number(preview.total || 0),
    durationMinutes: preview.durationMinutes ?? null,
  };
};

export const createAiBookingSnapshot = ({
  clientSessionId,
  sessionId,
  messages = [],
  bookingDraft = {},
  intent = 'UNKNOWN',
  phase = 'IDLE',
  preview = null,
  status = 'ACTIVE',
  updatedAt = new Date().toISOString(),
} = {}) => {
  const progress = deriveAiBookingProgress({ bookingDraft, phase, status });
  const persistedDraft = {
    ...bookingDraft,
    currentStep: progress.currentStep,
    completionPercent: progress.completionPercent,
    status: status === 'COMPLETED' ? 'COMPLETED' : 'DRAFT',
  };
  return {
    clientSessionId,
    sessionId: sessionId || '',
    status,
    messages: messages.slice(-100).map((message) => ({
      id: message.id || '',
      role: message.role === 'user' ? 'user' : 'assistant',
      content: String(message.content ?? message.text ?? '').slice(0, 4000),
      intent: message.intent || '',
      state: message.state || '',
      createdAt: message.createdAt || updatedAt,
    })).filter((message) => message.content),
    bookingDraft: persistedDraft,
    intent,
    phase,
    preview: sanitizeAiBookingPreview(preview),
    ...progress,
    updatedAt,
  };
};

export const saveLocalAiBookingSession = (ownerKey, snapshot, storage = globalThis.localStorage) => {
  if (!ownerKey || !snapshot) return false;
  try {
    storage?.setItem(AI_BOOKING_STORAGE_KEY, JSON.stringify({ ...snapshot, ownerKey }));
    return true;
  } catch {
    return false;
  }
};

export const readLocalAiBookingSession = (ownerKey, storage = globalThis.localStorage, now = Date.now()) => {
  if (!ownerKey) return null;
  try {
    const value = JSON.parse(storage?.getItem(AI_BOOKING_STORAGE_KEY) || 'null');
    if (!value || value.ownerKey !== ownerKey) return null;
    const age = now - Date.parse(value.updatedAt || 0);
    if (!['COMPLETED', 'CANCELLED'].includes(value.status)
      && (!Number.isFinite(age) || age >= AI_BOOKING_SESSION_TTL_MS)) {
      return { ...value, status: 'EXPIRED', currentStep: value.currentStep || 'COLLECT_DATE' };
    }
    return value;
  } catch {
    return null;
  }
};

export const clearLocalAiBookingSession = (storage = globalThis.localStorage) => {
  try { storage?.removeItem(AI_BOOKING_STORAGE_KEY); } catch { /* storage may be unavailable */ }
};

export const normalizeAiBookingSession = (session) => {
  if (!session) return null;
  const bookingDraft = session.bookingDraft || session.draft || {};
  const progress = deriveAiBookingProgress({ bookingDraft, phase: session.phase, status: session.status });
  return {
    ...session,
    sessionId: String(session.sessionId || session._id || ''),
    bookingDraft,
    messages: (session.messages || []).map((message) => ({
      id: message.id || message._id || '',
      role: message.role,
      text: message.text ?? message.content ?? '',
      content: message.content ?? message.text ?? '',
      intent: message.intent || '',
      state: message.state || '',
      createdAt: message.createdAt,
      speak: false,
    })),
    currentStep: session.currentStep || progress.currentStep,
    completionPercent: Number.isFinite(Number(session.completionPercent))
      ? Number(session.completionPercent) : progress.completionPercent,
  };
};

export const chooseNewestAiBookingSession = (backendSession, localSession) => {
  if (!backendSession) return localSession || null;
  if (!localSession) return backendSession;
  if (localSession.status === 'COMPLETED' && localSession.sessionId === backendSession.sessionId) return localSession;
  const backendTime = Date.parse(backendSession.updatedAt || 0) || 0;
  const localTime = Date.parse(localSession.updatedAt || 0) || 0;
  return localTime > backendTime ? localSession : backendSession;
};
