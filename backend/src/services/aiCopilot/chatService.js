const { randomUUID } = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { tools, execute } = require('./toolRegistry');
const { createDraft } = require('./draftService');
const AIAuditLog = require('../../models/AIAuditLog');

const conversations = new Map();
const TTL_MS = 3600000;
const MAX_TURNS = 8;
const cleanup = setInterval(() => { for (const [key, value] of conversations) if (value.expiresAt <= Date.now()) conversations.delete(key); }, 10 * 60000);
cleanup.unref?.();
const draftDeclaration = {
  name: 'prepare_draft',
  description: 'Prepare a pending proposal only, never execute it. Use after read tools supplied evidence.',
  parameters: { type: 'object', properties: {
    type: { type: 'string', enum: ['MODIFY_PRICING', 'CREATE_TICKET_PACKAGE', 'UPDATE_TICKET_PACKAGE'] },
    payloadJson: { type: 'string', description: 'JSON with complete proposed pricing config or package fields.' },
    targetId: { type: 'string', description: 'Required for package update.' },
    notificationId: { type: 'string', description: 'Optional open AI notification ID.' },
    reason: { type: 'string' },
  }, required: ['type', 'payloadJson', 'reason'] },
};

function classifyError(error, stage) {
  const status = Number(error.status || error.statusCode || error.response?.status);
  if (status === 429) return 'GEMINI_RATE_LIMIT';
  if (status === 401 || status === 403) return 'GEMINI_AUTH_ERROR';
  if (error.name === 'AbortError' || /timed?\s*out|deadline/i.test(error.message || '')) return 'GEMINI_TIMEOUT';
  if (stage === 'GEMINI_FINAL_SYNTHESIS_START') return 'FINAL_SYNTHESIS_ERROR';
  if (stage === 'CHAT_RESPONSE_VALIDATION') return 'RESPONSE_VALIDATION_ERROR';
  if (stage === 'TOOL_EXECUTION_START') return 'TOOL_EXECUTION_ERROR';
  if (status === 404 || status === 400) return 'GEMINI_MODEL_ERROR';
  return 'UNKNOWN_AI_ERROR';
}
function trace(stage, details = {}) { console.info('[VALO_AI_CHAT]', JSON.stringify({ stage, ...details })); }

async function chat({ message, conversationId, adminUserId }) {
  if (typeof message !== 'string' || !message.trim() || message.length > 2000) { const error = new Error('Câu hỏi phải dài từ 1 đến 2000 ký tự.'); error.statusCode = 400; throw error; }
  const id = conversationId && /^[a-f\d-]{36}$/i.test(conversationId) ? conversationId : randomUUID();
  const key = `${adminUserId}:${id}`;
  const saved = conversations.get(key);
  const history = saved && saved.expiresAt > Date.now() ? saved.messages : [];
  if (!process.env.GEMINI_API_KEY) return { type: 'error', message: 'VALO AI hiện chưa được cấu hình. Vui lòng thử lại sau.', evidence: [], suggestedActions: [], draft: null, conversationId: id };
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const vietnamNow = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash-lite', systemInstruction: [
    `Thời điểm hiện tại tại Việt Nam (UTC+7): ${vietnamNow}. Khi Admin nói "hôm nay", "hôm qua" hoặc bất kỳ mốc thời gian tương đối nào, hãy tính theo ngày/giờ Việt Nam này, KHÔNG dùng UTC.`,
    'Bạn là trợ lý Admin VALO. Hiểu tiếng Việt có dấu/không dấu, viết tắt như dt hn, co rui ro k, check ht và câu hỏi nối tiếp.',
    'Chỉ dùng công cụ được cung cấp để biết số liệu. Không bịa dữ liệu, phần trăm, nguyên nhân, ngưỡng hay confidence. Nếu chưa đủ dữ liệu, nói rõ: Hiện chưa đủ dữ liệu để kết luận.',
    'Không truy vấn DB trực tiếp. Không tự thay đổi dữ liệu. prepare_draft chỉ tạo bản nháp cần Admin duyệt. Chỉ soạn draft giá hoặc gói vé sau khi đã gọi công cụ đọc thích hợp.',
    'Trả lời ngắn gọn bằng tiếng Việt, nêu nguồn và thời điểm nếu có số liệu. Không nhắc tên model hoặc thông tin kỹ thuật nội bộ.',
  ].join('\n') });
  const contents = [...history, { role: 'user', parts: [{ text: message.trim() }] }];
  const evidence = [];
  let draft = null;
  let stage = 'CHAT_REQUEST_RECEIVED';
  trace(stage);
  try {
    for (let step = 0; step < 5; step++) {
      stage = step === 0 ? 'GEMINI_TOOL_SELECTION_START' : 'GEMINI_FINAL_SYNTHESIS_START';
      trace(stage, { step });
      const generated = await model.generateContent({
        contents,
        tools: [{ functionDeclarations: [...tools.map(({ name, description, parameters }) => ({ name, description, parameters })), draftDeclaration] }],
        toolConfig: { functionCallingConfig: step === 0
          ? { mode: 'ANY', allowedFunctionNames: tools.map((tool) => tool.name) }
          : { mode: 'AUTO' } },
      });
      const response = generated.response;
      const calls = response.functionCalls?.() || [];
      trace(step === 0 ? 'GEMINI_TOOL_SELECTION_SUCCESS' : 'GEMINI_FINAL_SYNTHESIS_SUCCESS', { step, selectedTools: calls.map((call) => call.name) });
      if (!calls.length) {
        stage = 'CHAT_RESPONSE_VALIDATION';
        trace(stage, { evidenceCount: evidence.length, hasDraft: !!draft });
        const answer = response.text?.().trim() || 'Hiện chưa đủ dữ liệu để kết luận.';
        const safeAnswer = evidence.length || draft ? answer : 'Hiện chưa đủ dữ liệu để kết luận. Hãy hỏi về một chỉ số cụ thể của VALO.';
        conversations.set(key, { expiresAt: Date.now() + TTL_MS, messages: [...contents.filter((c) => c.parts?.some((p) => p.text)).slice(-2 * MAX_TURNS), { role: 'model', parts: [{ text: safeAnswer }] }].slice(-2 * MAX_TURNS) });
        return { type: draft ? 'draft' : 'analysis', message: safeAnswer, evidence, suggestedActions: [], draft, conversationId: id };
      }
      const modelContent = response.candidates?.[0]?.content;
      if (!modelContent) throw new Error('Gemini không trả về model content.');
      contents.push(modelContent);
      const responses = [];
      for (const call of calls) {
        try {
          stage = 'TOOL_EXECUTION_START';
          trace(stage, { tool: call.name });
          let output;
          if (call.name === 'prepare_draft') {
            if (draft) throw new Error('Đã tạo một bản nháp trong lượt trả lời này.');
            const used = new Set(evidence.map((item) => item.tool));
            const grounded = call.args.type === 'MODIFY_PRICING'
              ? used.has('get_pricing_config') && ['get_session_statistics', 'get_parking_occupancy', 'get_revenue_metrics'].some((name) => used.has(name))
              : used.has('get_package_list') && used.has('get_subscription_stats');
            if (!grounded) throw new Error('Cần kiểm tra dữ liệu giá/gói và hoạt động thực tế trước khi tạo bản nháp.');
            output = await createDraft({ adminUserId, type: call.args.type, payload: JSON.parse(call.args.payloadJson), targetId: call.args.targetId, notificationId: call.args.notificationId, reason: call.args.reason, evidence });
            draft = { id: output._id, type: output.type, payload: output.payload, current: output.current, reason: output.reason, evidence: output.evidence, expiresAt: output.expiresAt };
            output = { draftId: String(output._id), status: 'PENDING' };
          } else {
            output = await execute(call.name, call.args || {});
            evidence.push({ tool: output.tool, source: output.source, timestamp: output.timestamp, data: output.data });
            await AIAuditLog.create({ actorId: adminUserId, action: 'TOOL_EXECUTION', toolName: call.name, metadata: { parameters: output.parameters } });
          }
          trace('TOOL_EXECUTION_SUCCESS', { tool: call.name });
          responses.push({ functionResponse: { name: call.name, response: { result: output } } });
        } catch (error) {
          const blocked = call.name === 'prepare_draft' || !tools.some((tool) => tool.name === call.name);
          const category = blocked ? 'TOOL_NOT_FOUND' : /valid|tham số|ngày|khoảng/i.test(error.message || '') ? 'TOOL_VALIDATION_ERROR' : /mongo|database|connection|server selection/i.test(error.message || '') ? 'DATABASE_ERROR' : 'TOOL_EXECUTION_ERROR';
          trace('TOOL_EXECUTION_FAILED', { tool: call.name, category, errorName: error.name });
          await AIAuditLog.create({ actorId: adminUserId, action: blocked ? 'OPERATION_REFUSED' : 'TOOL_ERROR', toolName: call.name, errorCode: blocked ? 'NOT_ALLOWED_OR_INVALID' : 'TOOL_FAILED' }).catch(() => {});
          responses.push({ functionResponse: { name: call.name, response: { error: error.message } } });
        }
      }
      contents.push({ role: 'user', parts: responses });
    }
    return { type: 'error', message: 'VALO AI cần thu hẹp câu hỏi để trả lời chính xác.', evidence, suggestedActions: [], draft, conversationId: id };
  } catch (error) {
    const category = classifyError(error, stage);
    trace('CHAT_FAILED', { failedStage: stage, category, errorName: error.name, httpStatus: Number(error.status || error.response?.status) || null });
    await AIAuditLog.create({ actorId: adminUserId, action: 'GEMINI_ERROR', errorCode: category }).catch(() => {});
    return { type: 'error', message: 'VALO AI đang tạm gián đoạn. Vui lòng thử lại sau.', evidence: [], suggestedActions: [], draft: null, conversationId: id };
  }
}
module.exports = { chat, conversations, classifyError };
