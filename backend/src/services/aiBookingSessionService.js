const AiBookingSession = require('../models/AiBookingSession');

const SESSION_TTL_MS = 30 * 60 * 1000;
const ACTIVE_STATUSES = ['DRAFT', 'ACTIVE'];
const ALLOWED_STEPS = new Set([
  'COLLECT_DATE', 'COLLECT_TIME', 'SELECT_VEHICLE', 'SELECT_SLOT',
  'SELECT_SERVICE', 'CONFIRM_BOOKING', 'PAYMENT', 'COMPLETED',
]);

const cleanObject = (value, depth = 0) => {
  if (depth > 8 || value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => cleanObject(item, depth + 1));
  if (typeof value !== 'object') {
    return typeof value === 'string' ? value.slice(0, 4000) : value;
  }
  return Object.entries(value).reduce((result, [key, entry]) => {
    if (!key.startsWith('$') && !key.includes('.')) result[key] = cleanObject(entry, depth + 1);
    return result;
  }, {});
};

const normalizeMessages = (messages) => (Array.isArray(messages) ? messages : [])
  .slice(-100)
  .map((message) => ({
    role: message?.role === 'user' ? 'user' : 'assistant',
    content: String(message?.content ?? message?.text ?? '').trim().slice(0, 4000),
    intent: String(message?.intent || '').slice(0, 100),
    state: String(message?.state || '').slice(0, 100),
    createdAt: message?.createdAt && !Number.isNaN(Date.parse(message.createdAt))
      ? new Date(message.createdAt) : new Date(),
  }))
  .filter((message) => message.content);

const draftItems = (draft = {}) => (Array.isArray(draft.reservationItems) ? draft.reservationItems : []);
const uniquePlates = (draft = {}) => [...new Set([
  draft.licensePlate,
  ...(Array.isArray(draft.licensePlates) ? draft.licensePlates : []),
  ...draftItems(draft).map((item) => item?.licensePlate),
].map((plate) => String(plate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase()).filter(Boolean))];

const deriveSessionProgress = ({ bookingDraft = {}, phase = 'IDLE', status } = {}) => {
  if (status === 'COMPLETED' || phase === 'SUCCESS') {
    return { currentStep: 'COMPLETED', completionPercent: 100 };
  }
  const items = draftItems(bookingDraft);
  const hasDate = Boolean(bookingDraft.startDate || bookingDraft.date)
    || (items.length > 0 && items.every((item) => item?.date || item?.startDate));
  if (!hasDate) return { currentStep: 'COLLECT_DATE', completionPercent: 10 };

  const hasTime = Boolean(bookingDraft.startTime && bookingDraft.endTime)
    || (items.length > 0 && items.every((item) => item?.startTime && item?.endTime));
  if (!hasTime) return { currentStep: 'COLLECT_TIME', completionPercent: 30 };

  const requested = Math.max(1, Number(bookingDraft.requestedVehicleCount || 1));
  if (uniquePlates(bookingDraft).length < requested) {
    return { currentStep: 'SELECT_VEHICLE', completionPercent: 50 };
  }
  if (phase === 'BOOKING' || phase === 'CONFIRMING') {
    return { currentStep: 'PAYMENT', completionPercent: 95 };
  }
  if (phase === 'WAITING_CONFIRMATION') {
    return { currentStep: 'CONFIRM_BOOKING', completionPercent: 90 };
  }
  return { currentStep: 'SELECT_SLOT', completionPercent: 70 };
};

const buildSummary = (bookingDraft = {}, preview = null, currentStep = 'COLLECT_DATE') => {
  const items = draftItems(bookingDraft);
  const first = items[0] || {};
  const dates = [...new Set(items.map((item) => item?.date || item?.startDate).filter(Boolean))];
  const date = bookingDraft.startDate || bookingDraft.date || first.date || first.startDate || '';
  const startTime = bookingDraft.startTime || first.startTime || '';
  const endTime = bookingDraft.endTime || first.endTime || '';
  const previewItems = Array.isArray(preview?.items) ? preview.items : [];
  return {
    date: dates.length > 1 ? dates.join(', ') : date,
    startTime,
    endTime,
    time: startTime && endTime ? `${startTime} - ${endTime}` : '',
    vehicles: uniquePlates(bookingDraft),
    slot: previewItems.length
      ? previewItems.map((item) => [item.floorName, item.slotCode].filter(Boolean).join(' · ')).filter(Boolean)
      : [bookingDraft.floorName, bookingDraft.slotCode].filter(Boolean).join(' · '),
    services: Array.isArray(bookingDraft.serviceIds) ? bookingDraft.serviceIds : [],
    currentStep,
    paymentStatus: 'UNPAID',
  };
};

const normalizeSnapshot = (payload = {}, status) => {
  const bookingDraft = cleanObject(payload.bookingDraft || payload.draft || {});
  const preview = payload.preview ? cleanObject(payload.preview) : null;
  const phase = String(payload.phase || 'IDLE').slice(0, 100);
  const progress = deriveSessionProgress({ bookingDraft, phase, status });
  const requestedStep = String(payload.currentStep || '');
  const currentStep = ALLOWED_STEPS.has(requestedStep) ? requestedStep : progress.currentStep;
  const completionPercent = currentStep === requestedStep && Number.isFinite(Number(payload.completionPercent))
    ? Math.max(0, Math.min(100, Number(payload.completionPercent)))
    : progress.completionPercent;
  const persistedDraft = {
    ...bookingDraft,
    currentStep,
    completionPercent,
    status: status === 'COMPLETED' ? 'COMPLETED' : 'DRAFT',
  };
  return {
    bookingDraft: persistedDraft,
    preview,
    messages: normalizeMessages(payload.messages),
    intent: String(payload.intent || 'UNKNOWN').slice(0, 100),
    phase,
    currentStep,
    completionPercent,
    summary: buildSummary(persistedDraft, preview, currentStep),
  };
};

const expireStaleSessions = async (userId, now = new Date()) => {
  await AiBookingSession.updateMany(
    { userId, status: { $in: ACTIVE_STATUSES }, expiresAt: { $lte: now } },
    { $set: { status: 'EXPIRED' } }
  );
};

const getLatestSession = async (userId) => {
  await expireStaleSessions(userId);
  const latest = await AiBookingSession.findOne({ userId }).sort({ updatedAt: -1 });
  return [...ACTIVE_STATUSES, 'EXPIRED'].includes(latest?.status) ? latest : null;
};

const getSession = async (userId, sessionId) => {
  await expireStaleSessions(userId);
  return AiBookingSession.findOne({ _id: sessionId, userId });
};

const createSession = async (userId, payload = {}) => {
  await expireStaleSessions(userId);
  const clientSessionId = String(payload.clientSessionId || '').trim().slice(0, 100);
  if (clientSessionId) {
    const existing = await AiBookingSession.findOne({ userId, clientSessionId });
    if (existing) return existing;
  }
  await AiBookingSession.updateMany(
    { userId, status: { $in: ACTIVE_STATUSES } },
    { $set: { status: 'CANCELLED', cancelledAt: new Date() } }
  );
  const snapshot = normalizeSnapshot(payload);
  return AiBookingSession.create({
    userId,
    ...(clientSessionId ? { clientSessionId } : {}),
    status: snapshot.messages.some((message) => message.role === 'user') ? 'ACTIVE' : 'DRAFT',
    ...snapshot,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
};

const updateSession = async (userId, sessionId, payload = {}) => {
  await expireStaleSessions(userId);
  const current = await AiBookingSession.findOne({ _id: sessionId, userId });
  if (!current) return { notFound: true };
  if (!ACTIVE_STATUSES.includes(current.status)) return { inactive: true, session: current };
  const snapshot = normalizeSnapshot(payload);
  Object.assign(current, snapshot, {
    status: snapshot.messages.some((message) => message.role === 'user') ? 'ACTIVE' : 'DRAFT',
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  await current.save();
  return { session: current };
};

const appendMessages = async (userId, sessionId, payload = {}) => {
  await expireStaleSessions(userId);
  const incoming = normalizeMessages(payload.messages || [payload.userMessage, payload.assistantMessage].filter(Boolean));
  const session = await AiBookingSession.findOne({ _id: sessionId, userId });
  if (!session) return { notFound: true };
  if (!ACTIVE_STATUSES.includes(session.status)) return { inactive: true, session };
  session.messages = [...session.messages, ...incoming].slice(-100);
  session.status = session.messages.some((message) => message.role === 'user') ? 'ACTIVE' : 'DRAFT';
  session.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await session.save();
  return { session };
};

const completeSession = async (userId, sessionId, payload = {}) => {
  const session = await AiBookingSession.findOne({ _id: sessionId, userId });
  if (!session) return { notFound: true };
  if (session.status === 'CANCELLED') return { inactive: true, session };
  const snapshot = normalizeSnapshot(payload, 'COMPLETED');
  Object.assign(session, snapshot, {
    status: 'COMPLETED', currentStep: 'COMPLETED', completionPercent: 100,
    phase: 'SUCCESS', completedAt: session.completedAt || new Date(),
  });
  session.summary = buildSummary(session.bookingDraft, session.preview, 'COMPLETED');
  await session.save();
  return { session };
};

const discardSession = async (userId, sessionId) => {
  const session = await AiBookingSession.findOne({ _id: sessionId, userId });
  if (!session) return { notFound: true };
  if (session.status === 'COMPLETED') return { inactive: true, session };
  session.status = 'CANCELLED';
  session.cancelledAt = session.cancelledAt || new Date();
  await session.save();
  return { session };
};

module.exports = {
  SESSION_TTL_MS,
  appendMessages,
  buildSummary,
  completeSession,
  createSession,
  deriveSessionProgress,
  discardSession,
  expireStaleSessions,
  getLatestSession,
  getSession,
  normalizeSnapshot,
  updateSession,
};
