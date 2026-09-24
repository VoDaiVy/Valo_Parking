const { interpretBookingMessage, normalizeInterpretation } = require('../services/aiBookingInterpreter');
const mongoose = require('mongoose');
const aiBookingSessionService = require('../services/aiBookingSessionService');
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
      createdAt: message.createdAt,
    })),
  };
};

const validSessionId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));
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

exports.interpret = async (req, res) => {
  try {
    const assistantRequest = parseAssistantRequest({
      prompt: req.body?.prompt,
      draft: req.body?.draft,
      today: req.body?.today,
      currentTime: req.body?.currentTime,
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
          canonicalIntent: assistantRequest.intent,
          intents: assistantRequest.intents,
          draft,
          assistantResult: {
            message: assistantResult.message,
            pendingAction: assistantResult.pendingAction || null,
          },
        },
      });
    }
    const result = await interpretBookingMessage({
      prompt: req.body?.prompt,
      draft: req.body?.draft,
      today: req.body?.today,
      currentTime: req.body?.currentTime,
    });
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
          canonicalIntent: result.intent,
          intents: [result.intent],
          draft: { ...draft, ...(assistantResult.transition?.draftPatch || {}) },
          assistantResult: {
            message: assistantResult.message,
            pendingAction: assistantResult.pendingAction || null,
          },
        },
      });
    }
    res.json({ success: true, data: { ...result, canonicalIntent: result.intent === 'CREATE_BOOKING' ? 'BOOK_PARKING' : result.intent } });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Không thể xử lý yêu cầu AI lúc này.',
    });
  }
};

exports.getLatestSession = async (req, res) => {
  try {
    const session = await aiBookingSessionService.getLatestSession(req.user._id);
    res.json({ success: true, data: sessionData(session) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Không thể tải phiên đặt chỗ lúc này.' });
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
    res.status(500).json({ success: false, message: 'Không thể tạo phiên đặt chỗ lúc này.' });
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
    return res.status(500).json({ success: false, message: 'Không thể hoàn tất phiên đặt chỗ lúc này.' });
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
