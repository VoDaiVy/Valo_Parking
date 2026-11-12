const { validateBookingInput } = require('../services/aiBookingInputValidation');
const { interpretBookingMessage, normalizeInterpretation } = require('../services/aiBookingInterpreter');
const { detectBookingLanguage, detectRequestedConversationLanguage } = require('../services/aiBookingLanguage');
const { localizeBookingReply } = require('../services/aiBookingLocalization');
const mongoose = require('mongoose');
const aiBookingSessionService = require('../services/aiBookingSessionService');
const { transcribeBookingAudio, speechFailureResponse } = require('../services/aiBookingSpeech');
const {
  QUERY_INTENTS,
  executeAssistantRequest,
  parseAssistantRequest,
} = require('../services/aiParkingAssistantService');

const sessionData = (session) => {
  if (!session) return null;
  const data = typeof session.toObject === 'function' ? session.toObject() : session;
  return {
    ...data,
    sessionId: String(data._id),
    messages: (data.messages || []).map((message) => ({
      id: String(message._id || message.id || ''),
      sessionId: String(data._id),
      role: message.role,
      content: message.content,
      intent: message.intent || '',
      state: message.state || '',
      language: message.language || '',
      createdAt: message.createdAt,
    })),
  };
};

const validSessionId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

exports.localizeReply = async (req, res) => {
  if (typeof req.body?.text !== 'string' || req.body.text.length > 8000 || !['en', 'vi'].includes(req.body.language)) {
    return res.status(400).json({ success: false, message: 'Invalid localization request' });
  }
  return res.json({ success: true, data: { text: await localizeBookingReply(req.body.text, req.body.language) } });
};

exports.transcribeVoice = async (req, res) => {
  try {
    const data = await transcribeBookingAudio(req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    const language = req.body?.previousLanguage === 'vi' ? 'vi' : 'en';
    const failure = speechFailureResponse(error, language);
    return res.status(failure.status).json({ success: false, code: failure.code, message: failure.message });
  }
};
const sendMutationResult = (res, result) => {
  if (result?.notFound) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy phiên đặt chỗ.' });
  }
  if (result?.inactive) {
    return res.status(409).json({
      success: false,
      message: result.session?.status === 'EXPIRED'
        ? 'Phiên đặt chỗ đã hết hạn.' : 'Phiên đặt chỗ không còn hoạt động.',
      data: sessionData(result.session),
    });
  }
  return res.json({ success: true, data: sessionData(result?.session || result) });
};

const vietnamBookingClock = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return {
    today: `${part('year')}-${part('month')}-${part('day')}`,
    currentTime: `${part('hour')}:${part('minute')}`,
  };
};

exports.interpret = async (req, res) => {
  const languageInfo = detectBookingLanguage(req.body?.prompt, req.body?.draft?.__language);
  const requestedLanguage = detectRequestedConversationLanguage(req.body?.prompt);
  if (requestedLanguage) Object.assign(languageInfo, { language: requestedLanguage, confidence: 0.99 });
  const responseMessage = (value) => localizeBookingReply(value, languageInfo.language);
  try {
    const referenceClock = vietnamBookingClock();
    const inputError = validateBookingInput(req.body?.prompt, referenceClock.today);
    if (inputError) return res.json({ success: true, data: {
      intent: req.body?.draft?.__intent || 'UNKNOWN',
      draft: { ...req.body?.draft, __language: languageInfo.language, __languageLocked: false },
      language: languageInfo.language,
      validationError: true,
      clarification: languageInfo.language === 'en' ? inputError.englishMessage : inputError.message,
    } });
    const assistantRequest = parseAssistantRequest({
      prompt: req.body?.prompt,
      draft: req.body?.draft,
      today: referenceClock.today,
      currentTime: referenceClock.currentTime,
    });
    const requestsScheduledAvailability = assistantRequest
      && (assistantRequest.intents.includes('CHECK_PARKING_AVAILABILITY')
        || assistantRequest.intents.includes('CHECK_SLOT_STATUS'))
      && (assistantRequest.entities.startDate || assistantRequest.entities.startTime || assistantRequest.entities.endTime);
    if (requestsScheduledAvailability) {
      const normalized = normalizeInterpretation({
        intent: 'CHECK_AVAILABILITY',
        ...assistantRequest.entities,
      }, req.body?.draft || {});
      return res.json({
        success: true,
        data: {
          ...normalized,
          draft: { ...normalized.draft, __language: languageInfo.language, __languageLocked: false },
          language: languageInfo.language,
          languageConfidence: languageInfo.confidence,
          canonicalIntent: assistantRequest.intent,
          intents: assistantRequest.intents,
        },
      });
    }
    if (assistantRequest) {
      const assistantResult = await executeAssistantRequest(
        assistantRequest,
        req.user._id,
        new Date(),
      );
      const previousDraft = req.body?.draft && typeof req.body.draft === 'object'
        ? req.body.draft : {};
      const transition = assistantResult.transition || {};
      const pendingAction = assistantResult.pendingActionDraft
        || assistantResult.pendingAction || null;
      const draft = {
        ...previousDraft,
        ...(transition.draftPatch || {}),
        __language: languageInfo.language, __languageLocked: false,
        assistantContext: {
          ...(previousDraft.assistantContext || {}),
          ...(assistantResult.context || {}),
          ...(pendingAction ? { pendingAction } : { pendingAction: null }),
        },
      };
      return res.json({
        success: true,
        data: {
          intent: transition.intent || assistantRequest.intent,
          language: languageInfo.language,
          languageConfidence: languageInfo.confidence,
          canonicalIntent: assistantRequest.intent,
          intents: assistantRequest.intents,
          draft,
          assistantResult: {
            message: await responseMessage(assistantResult.message),
            pendingAction: assistantResult.pendingAction || null,
            showVipModal: assistantResult.showVipModal === true,
            ...(assistantResult.voucherOptions ? { voucherOptions: assistantResult.voucherOptions } : {}),
          },
        },
      });
    }
    const result = await interpretBookingMessage({
      prompt: req.body?.prompt,
      draft: req.body?.draft,
      today: referenceClock.today,
      currentTime: referenceClock.currentTime,
      conversationHistory: req.body?.conversationHistory,
    });
    if (result.clarification) result.clarification = await responseMessage(result.clarification);
    result.language = languageInfo.language;
    result.draft = { ...result.draft, __language: languageInfo.language, __languageLocked: false };
    if (result.unrecognized || result.validationError || result.clarification) return res.json({ success: true, data: result });
    if (QUERY_INTENTS.has(result.intent)) {
      const fallbackRequest = {
        intent: result.intent,
        intents: [result.intent],
        entities: result.draft || {},
        rawText: String(req.body?.prompt || ''),
      };
      const assistantResult = await executeAssistantRequest(fallbackRequest, req.user._id, new Date());
      const draft = {
        ...(result.draft || {}),
        assistantContext: {
          ...(req.body?.draft?.assistantContext || {}),
          ...(assistantResult.context || {}),
          pendingAction: assistantResult.pendingActionDraft || assistantResult.pendingAction || null,
        },
      };
      return res.json({
        success: true,
        data: {
          intent: assistantResult.transition?.intent || result.intent,
          language: result.language || languageInfo.language,
          languageConfidence: result.languageConfidence || languageInfo.confidence,
          canonicalIntent: result.intent,
          intents: [result.intent],
          draft: { ...draft, ...(assistantResult.transition?.draftPatch || {}), __language: languageInfo.language, __languageLocked: false },
          assistantResult: {
            message: await responseMessage(assistantResult.message),
            pendingAction: assistantResult.pendingAction || null,
            showVipModal: assistantResult.showVipModal === true,
            ...(assistantResult.voucherOptions ? { voucherOptions: assistantResult.voucherOptions } : {}),
          },
        },
      });
    }
    res.json({ success: true, data: { ...result, canonicalIntent: result.intent === 'CREATE_BOOKING' ? 'BOOK_PARKING' : result.intent } });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: await responseMessage(error.statusCode ? error.message : 'Không thể xử lý yêu cầu AI lúc này.'),
    });
  }
};

exports.getLatestSession = async (req, res) => {
  try {
    const language = ['en', 'vi'].includes(req.query?.language) ? req.query.language : undefined;
    const session = await aiBookingSessionService.getLatestSession(req.user._id, language);
    res.json({ success: true, data: sessionData(session) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Không thể tải phiên đặt chỗ lúc này.' });
  }
};

exports.listSessions = async (req, res) => {
  try {
    const data = await aiBookingSessionService.listSessions(req.user._id, {
      language: ['en', 'vi'].includes(req.query?.language) ? req.query.language : undefined, search: req.query?.search || '', page: req.query?.page,
    });
    return res.json({ success: true, data });
  } catch {
    return res.status(500).json({ success: false, message: 'Không thể tải lịch sử trò chuyện.' });
  }
};

exports.renameSession = async (req, res) => {
  if (!validSessionId(req.params.sessionId)) return res.status(400).json({ success: false, message: 'Mã cuộc trò chuyện không hợp lệ.' });
  try {
    const session = await aiBookingSessionService.renameSession(req.user._id, req.params.sessionId, req.body?.title);
    if (!session) return res.status(404).json({ success: false, message: 'Không tìm thấy cuộc trò chuyện.' });
    return res.json({ success: true, data: aiBookingSessionService.historyItem(session) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Không thể đổi tên cuộc trò chuyện.' });
  }
};

exports.deleteSession = async (req, res) => {
  if (!validSessionId(req.params.sessionId)) return res.status(400).json({ success: false, message: 'Mã cuộc trò chuyện không hợp lệ.' });
  try {
    const session = await aiBookingSessionService.deleteSession(req.user._id, req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, message: 'Không tìm thấy cuộc trò chuyện.' });
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ success: false, message: 'Không thể xóa cuộc trò chuyện.' });
  }
};

exports.getSession = async (req, res) => {
  if (!validSessionId(req.params.sessionId)) {
    return res.status(400).json({ success: false, message: 'Mã phiên đặt chỗ không hợp lệ.' });
  }
  try {
    const session = await aiBookingSessionService.getSession(req.user._id, req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, message: 'Không tìm thấy phiên đặt chỗ.' });
    return res.json({ success: true, data: sessionData(session) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Không thể tải phiên đặt chỗ lúc này.' });
  }
};

exports.createSession = async (req, res) => {
  try {
    const session = await aiBookingSessionService.createSession(req.user._id, req.body || {});
    res.status(201).json({ success: true, data: sessionData(session) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Không thể tạo phiên đặt chỗ lúc này.' });
  }
};

exports.appendMessages = async (req, res) => {
  if (!validSessionId(req.params.sessionId)) {
    return res.status(400).json({ success: false, message: 'Mã phiên đặt chỗ không hợp lệ.' });
  }
  try {
    return sendMutationResult(res, await aiBookingSessionService.appendMessages(
      req.user._id, req.params.sessionId, req.body || {}
    ));
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Không thể lưu hội thoại lúc này.' });
  }
};

exports.updateSession = async (req, res) => {
  if (!validSessionId(req.params.sessionId)) {
    return res.status(400).json({ success: false, message: 'Mã phiên đặt chỗ không hợp lệ.' });
  }
  try {
    return sendMutationResult(res, await aiBookingSessionService.updateSession(
      req.user._id, req.params.sessionId, req.body || {}
    ));
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Không thể lưu tiến trình đặt chỗ lúc này.' });
  }
};

exports.completeSession = async (req, res) => {
  if (!validSessionId(req.params.sessionId)) {
    return res.status(400).json({ success: false, message: 'Mã phiên đặt chỗ không hợp lệ.' });
  }
  try {
    return sendMutationResult(res, await aiBookingSessionService.completeSession(
      req.user._id, req.params.sessionId, req.body || {}
    ));
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Không thể hoàn tất phiên đặt chỗ lúc này.' });
  }
};

exports.discardSession = async (req, res) => {
  if (!validSessionId(req.params.sessionId)) {
    return res.status(400).json({ success: false, message: 'Mã phiên đặt chỗ không hợp lệ.' });
  }
  try {
    return sendMutationResult(res, await aiBookingSessionService.discardSession(
      req.user._id, req.params.sessionId
    ));
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Không thể hủy phiên đặt chỗ lúc này.' });
  }
};
