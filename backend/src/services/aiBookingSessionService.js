const AiBookingSession = require('../models/AiBookingSession');
const BookingOrder = require('../models/BookingOrder');

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
    language: ['en', 'vi'].includes(message?.language) ? message.language : '',
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
  if (['BOOKING', 'CONFIRMING', 'WAITING_PAYMENT'].includes(phase)) {
    return { currentStep: 'PAYMENT', completionPercent: 95 };
  }
  if (phase === 'WAITING_CONFIRMATION') {
    return { currentStep: 'CONFIRM_BOOKING', completionPercent: 90 };
  }
  return { currentStep: 'SELECT_SLOT', completionPercent: 70 };
};

const buildSummary = (bookingDraft = {}, preview = null, currentStep = 'COLLECT_DATE', paymentStatus = 'UNPAID') => {
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
    paymentStatus,
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
    { userId, deletedAt: null, status: { $in: ACTIVE_STATUSES }, expiresAt: { $lte: now } },
    { $set: { status: 'EXPIRED' } }
  );
};

const sessionLanguageFilter = (language) => language === 'vi'
  ? { 'bookingDraft.__language': 'vi' }
  : { 'bookingDraft.__language': { $ne: 'vi' } };

const conversationTitle = (messages = []) => String(messages.find((message) => message.role === 'user')?.content || '')
  .replace(/\s+/g, ' ').trim().slice(0, 80);

const historyItem = (session) => ({
  sessionId: String(session._id),
  title: session.title || conversationTitle(session.messages) || (session.bookingDraft?.__language === 'vi' ? 'Cuộc trò chuyện mới' : 'New chat'),
  language: session.bookingDraft?.__language === 'vi' ? 'vi' : 'en',
  status: session.status, createdAt: session.createdAt, updatedAt: session.updatedAt,
});

const listSessions = async (userId, { language, search = '', page = 1 } = {}) => {
  const filter = { userId, deletedAt: null, ...(language ? sessionLanguageFilter(language) : {}) };
  const term = String(search).trim().slice(0, 100);
  if (term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ title: { $regex: escaped, $options: 'i' } }, { 'messages.content': { $regex: escaped, $options: 'i' } }];
  }
  const pageNumber = Math.max(1, Math.min(10000, Number.parseInt(page, 10) || 1));
  const rows = await AiBookingSession.find(filter).sort({ updatedAt: -1, _id: -1 })
    .skip((pageNumber - 1) * 30).limit(31).select('title status bookingDraft.__language messages createdAt updatedAt').lean();
  return { items: rows.slice(0, 30).map(historyItem), hasMore: rows.length > 30, page: pageNumber };
};

const renameSession = async (userId, sessionId, title) => {
  const cleaned = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '';
  if (!cleaned || cleaned.length > 100) throw Object.assign(new Error('Tên cuộc trò chuyện phải có từ 1 đến 100 ký tự.'), { statusCode: 400 });
  return AiBookingSession.findOneAndUpdate({ _id: sessionId, userId, deletedAt: null }, { $set: { title: cleaned } }, { new: true, runValidators: true });
};

const deleteSession = async (userId, sessionId) => AiBookingSession.findOneAndUpdate(
  { _id: sessionId, userId, deletedAt: null }, { $set: { deletedAt: new Date() } }, { new: true }
);

const getLatestSession = async (userId, language) => {
  await expireStaleSessions(userId);
  const latest = await AiBookingSession.findOne({ userId, deletedAt: null, ...(language ? sessionLanguageFilter(language) : {}) }).sort({ updatedAt: -1 });
  return [...ACTIVE_STATUSES, 'EXPIRED', 'COMPLETED'].includes(latest?.status) ? latest : null;
};

const getSession = async (userId, sessionId) => {
  await expireStaleSessions(userId);
  return AiBookingSession.findOne({ _id: sessionId, userId, deletedAt: null });
};

const createSession = async (userId, payload = {}) => {
  await expireStaleSessions(userId);
  const clientSessionId = String(payload.clientSessionId || '').trim().slice(0, 100);
  if (clientSessionId) {
    const existing = await AiBookingSession.findOne({ userId, clientSessionId });
    if (existing?.deletedAt) throw Object.assign(new Error('Cuộc trò chuyện đã bị xóa.'), { statusCode: 410 });
    if (existing) return existing;
  }
  const snapshot = normalizeSnapshot(payload);
  try {
    return await AiBookingSession.create({
        userId,
        ...(clientSessionId ? { clientSessionId } : {}),
        status: snapshot.messages.some((message) => message.role === 'user') ? 'ACTIVE' : 'DRAFT',
        ...snapshot,
        title: conversationTitle(snapshot.messages),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
  } catch (error) {
    if (error.code === 11000 && clientSessionId) {
      const existing = await AiBookingSession.findOne({ userId, clientSessionId, deletedAt: null });
      if (existing) return existing;
    }
    throw error;
  }
};

const updateSession = async (userId, sessionId, payload = {}) => {
  await expireStaleSessions(userId);
  const current = await AiBookingSession.findOne({ _id: sessionId, userId, deletedAt: null });
  if (!current) return { notFound: true };
  if (!ACTIVE_STATUSES.includes(current.status)) return { inactive: true, session: current };
  const snapshot = normalizeSnapshot(payload);
  if (!current.title) current.title = conversationTitle(snapshot.messages);
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
  const session = await AiBookingSession.findOne({ _id: sessionId, userId, deletedAt: null });
  if (!session) return { notFound: true };
  if (!ACTIVE_STATUSES.includes(session.status)) return { inactive: true, session };
  session.messages = [...session.messages, ...incoming].slice(-100);
  if (!session.title) session.title = conversationTitle(session.messages);
  session.status = session.messages.some((message) => message.role === 'user') ? 'ACTIVE' : 'DRAFT';
  session.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await session.save();
  return { session };
};

const completeSession = async (userId, sessionId, payload = {}) => {
  const session = await AiBookingSession.findOne({ _id: sessionId, userId, deletedAt: null });
  if (!session) return { notFound: true };
  if (session.status === 'COMPLETED') return { session };
  if (!ACTIVE_STATUSES.includes(session.status) || session.expiresAt <= new Date()) {
    return { inactive: true, session };
  }
  let paymentStatus = 'UNKNOWN';
  if ((payload.intent || session.intent) === 'CREATE_BOOKING') {
    const key = payload.bookingDraft?.__confirmationKey;
    const order = key && await BookingOrder.findOne({ userId, idempotencyKey: key, status: 'paid' });
    if (!order) {
      const error = new Error('Chưa tìm thấy đơn booking đã thanh toán để hoàn tất phiên.');
      error.statusCode = 409;
      throw error;
    }
    paymentStatus = 'PAID';
  }
  const snapshot = normalizeSnapshot(payload, 'COMPLETED');
  Object.assign(session, snapshot, {
    status: 'COMPLETED', currentStep: 'COMPLETED', completionPercent: 100,
    phase: 'SUCCESS', completedAt: session.completedAt || new Date(),
  });
  session.summary = buildSummary(session.bookingDraft, session.preview, 'COMPLETED', paymentStatus);
  await session.save();
  return { session };
};

const discardSession = async (userId, sessionId) => {
  const session = await AiBookingSession.findOne({ _id: sessionId, userId, deletedAt: null });
  if (!session) return { notFound: true };
  if (session.status === 'COMPLETED') return { inactive: true, session };
  session.status = 'CANCELLED';
  session.cancelledAt = session.cancelledAt || new Date();
  await session.save();
  return { session };
};

module.exports = {
  listSessions, renameSession, deleteSession, conversationTitle, historyItem,
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
