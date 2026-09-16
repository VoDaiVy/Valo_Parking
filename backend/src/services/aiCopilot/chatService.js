const { randomUUID } = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { tools, getToolsForRole, execute } = require('./toolRegistry');
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
    type: { type: 'string', enum: ['MODIFY_PRICING', 'CREATE_TICKET_PACKAGE', 'UPDATE_TICKET_PACKAGE', 'UPDATE_USER_STATUS', 'CHANGE_USER_ROLE', 'APPROVE_VEHICLE', 'CREATE_POLICY_DRAFT', 'ARCHIVE_POLICY'] },
    payloadJson: { type: 'string', description: 'JSON with complete proposed payload. For UPDATE_USER_STATUS send {"status":boolean}. For CHANGE_USER_ROLE send {"role":string}. For CREATE_POLICY_DRAFT send {"title","category","summary","content","effectiveDate"}. For APPROVE_VEHICLE/ARCHIVE_POLICY send {}.' },
    targetId: { type: 'string', description: 'Required for UPDATE_TICKET_PACKAGE, UPDATE_USER_STATUS, CHANGE_USER_ROLE, APPROVE_VEHICLE, ARCHIVE_POLICY.' },
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

async function chat({ message, conversationId, adminUserId, actorId, actorRole = 'admin' }) {
  const currentActorId = actorId || adminUserId;
  if (typeof message !== 'string' || !message.trim() || message.length > 2000) { const error = new Error('Câu hỏi phải dài từ 1 đến 2000 ký tự.'); error.statusCode = 400; throw error; }
  const id = conversationId && /^[a-f\d-]{36}$/i.test(conversationId) ? conversationId : randomUUID();
  const key = `${currentActorId}:${id}`;
  const saved = conversations.get(key);
  const history = saved && saved.expiresAt > Date.now() ? saved.messages : [];
  if (!process.env.GEMINI_API_KEY) return { type: 'error', message: 'VALO AI hiện chưa được cấu hình. Vui lòng thử lại sau.', evidence: [], suggestedActions: [], draft: null, conversationId: id };
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const vietnamNow = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const baseInstruction = [
    `Thời điểm hiện tại tại Việt Nam (UTC+7): ${vietnamNow}. Khi người dùng nói "hôm nay", "hôm qua" hoặc bất kỳ mốc thời gian tương đối nào, hãy tính theo ngày/giờ Việt Nam này, KHÔNG dùng UTC.`,
    actorRole === 'staff' 
      ? 'Bạn là trợ lý Staff VALO. Nhiệm vụ của bạn là hỗ trợ tra cứu bãi đỗ, phiên xe và khách hàng. TỪ CHỐI các câu hỏi về tài chính, doanh thu, Admin, và các thao tác vượt quyền. Không bịa số liệu. Luôn hành xử đúng mực như một nhân viên bãi xe.'
      : 'Bạn là trợ lý Admin VALO. Hiểu tiếng Việt có dấu/không dấu, viết tắt như dt hn, co rui ro k, check ht và câu hỏi nối tiếp.',
    'Chỉ dùng công cụ được cung cấp để biết số liệu. Không bịa dữ liệu, phần trăm, nguyên nhân, ngưỡng hay confidence. Nếu chưa đủ dữ liệu, nói rõ: Hiện chưa đủ dữ liệu để kết luận.',
    'Không truy vấn DB trực tiếp. Không tự thay đổi dữ liệu. prepare_draft chỉ tạo bản nháp cần duyệt. Hãy gọi công cụ đọc (search/get) để lấy thông tin mục tiêu (user, vehicle, policy, ticket) TRƯỚC KHI tạo draft. KHÔNG tạo draft cho các hành động: REJECT_VEHICLE, START_SLOT_MAINTENANCE vì chưa được hỗ trợ.',
    'Trả lời ngắn gọn bằng tiếng Việt, nêu nguồn và thời điểm nếu có số liệu. Không nhắc tên model hoặc thông tin kỹ thuật nội bộ.',
    actorRole === 'staff'
      ? 'Viết cho Staff vận hành: kết luận trước, số liệu quan trọng sau, đề xuất nếu có. Diễn đạt trạng thái bằng tiếng Việt tự nhiên; tránh tên tool, tên trường code.'
      : 'Viết cho Admin vận hành: kết luận trước, số liệu quan trọng sau, đề xuất nếu có. Diễn đạt trạng thái và thời lượng bằng tiếng Việt tự nhiên (active: đang hoạt động, unpaid: chưa thanh toán, paid: đã thanh toán, expectedDurationHours: thời lượng dự kiến); tránh tên tool, tên trường code và giá trị enum trong câu trả lời. Chỉ mô tả đúng trạng thái đã có, không suy diễn nguyên nhân.',
    'Giữ ObjectId trong ngữ cảnh để gọi công cụ chính xác ở lượt tiếp theo, nhưng chỉ hiển thị ID nội bộ khi người dùng hỏi trực tiếp ID; ưu tiên tên, biển số, email hoặc vị trí để nhận diện.',
    'Khi user dùng đại từ (người này, xe này, xe đầu tiên, booking đó...), hãy resolve chính xác identifier (ObjectId) từ kết quả tool/message gần nhất và gọi tool tiếp theo. Chỉ hỏi lại khi thực sự ambiguous. Không tự bịa identifier.',
    actorRole === 'staff'
      ? 'Khi Staff yêu cầu gửi thông báo, chỉ dùng search_notification_recipients để tìm người nhận. Nếu không có exact username match và có nhiều kết quả, hãy hỏi Staff chọn lại. Chỉ chuẩn bị SEND_NOTIFICATION draft với title và content; tuyệt đối không gửi trực tiếp.'
      : '',
  ].join('\n');
  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash-lite', systemInstruction: baseInstruction });
  const contents = [...history, { role: 'user', parts: [{ text: message.trim() }] }];
  const evidence = [];
  let draft = null;
  let stage = 'CHAT_REQUEST_RECEIVED';
  trace(stage);
  try {
    for (let step = 0; step < 5; step++) {
      stage = step === 0 ? 'GEMINI_TOOL_SELECTION_START' : 'GEMINI_FINAL_SYNTHESIS_START';
      trace(stage, { step });
      const allowedTools = getToolsForRole(actorRole);
      const roleDraftDecl = actorRole === 'staff' ? {
        name: 'prepare_draft',
        description: 'Prepare a pending proposal only, never execute it. Use after read tools supplied evidence.',
        parameters: { type: 'object', properties: {
          type: { type: 'string', enum: ['UPDATE_USER_STATUS', 'SEND_NOTIFICATION'] },
          payloadJson: { type: 'string', description: 'JSON with complete proposed payload. For UPDATE_USER_STATUS send {"status":boolean}. For SEND_NOTIFICATION send {"title":string,"content":string,"expectedRecipientRole":string}; propose both title and content.' },
          targetId: { type: 'string', description: 'Required for UPDATE_USER_STATUS and SEND_NOTIFICATION. For SEND_NOTIFICATION it must come from search_notification_recipients.' },
          notificationId: { type: 'string', description: 'Optional open AI notification ID.' },
          reason: { type: 'string' },
        }, required: ['type', 'payloadJson', 'targetId', 'reason'] }
      } : draftDeclaration;

      const generated = await model.generateContent({
        contents,
        tools: [{ functionDeclarations: [...allowedTools.map(({ name, description, parameters }) => ({ name, description, parameters })), roleDraftDecl] }],
        toolConfig: { functionCallingConfig: step === 0
          ? { mode: 'ANY', allowedFunctionNames: allowedTools.map((tool) => tool.name) }
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
        const allMsg = [...contents, { role: 'model', parts: [{ text: safeAnswer }] }];
        const starts = allMsg.map((m, i) => m.role === 'user' && m.parts?.some(p => p.text) ? i : -1).filter(i => i !== -1);
        conversations.set(key, { expiresAt: Date.now() + TTL_MS, messages: starts.length > MAX_TURNS ? allMsg.slice(starts[starts.length - MAX_TURNS]) : allMsg });
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
            let grounded = true;
            if (call.args.type === 'MODIFY_PRICING') grounded = used.has('get_pricing_config') && ['get_session_statistics', 'get_parking_occupancy', 'get_revenue_metrics'].some((name) => used.has(name));
            else if (call.args.type.includes('PACKAGE')) grounded = used.has('get_package_list') && used.has('get_subscription_stats');
            else if (call.args.type === 'UPDATE_USER_STATUS' || call.args.type === 'CHANGE_USER_ROLE') grounded = used.has('search_users') || used.has('get_user_detail');
            else if (call.args.type === 'SEND_NOTIFICATION') grounded = used.has('search_notification_recipients');
            else if (call.args.type === 'APPROVE_VEHICLE') grounded = used.has('search_vehicles');
            else if (call.args.type === 'ARCHIVE_POLICY') grounded = used.has('list_admin_policies') || used.has('get_admin_policy');
            if (!grounded) throw new Error('Cần kiểm tra dữ liệu/thực trạng trước khi tạo bản nháp.');
            output = await createDraft({ adminUserId: currentActorId, actorRole, type: call.args.type, payload: JSON.parse(call.args.payloadJson), targetId: call.args.targetId, notificationId: call.args.notificationId, reason: call.args.reason, evidence });
            draft = { id: output._id, type: output.type, payload: output.payload, current: output.current, reason: output.reason, evidence: output.evidence, expiresAt: output.expiresAt };
            output = { draftId: String(output._id), status: 'PENDING' };
          } else {
            output = await execute(call.name, call.args || {}, actorRole);
            evidence.push({ tool: output.tool, source: output.source, timestamp: output.timestamp, data: output.data });
            await AIAuditLog.create({ actorId: currentActorId, action: 'TOOL_EXECUTION', toolName: call.name, metadata: { parameters: output.parameters } });
          }
          trace('TOOL_EXECUTION_SUCCESS', { tool: call.name });
          responses.push({ functionResponse: { name: call.name, response: { result: output } } });
        } catch (error) {
          const blocked = call.name === 'prepare_draft' || !tools.some((tool) => tool.name === call.name);
          const category = blocked ? 'TOOL_NOT_FOUND' : /valid|tham số|ngày|khoảng/i.test(error.message || '') ? 'TOOL_VALIDATION_ERROR' : /mongo|database|connection|server selection/i.test(error.message || '') ? 'DATABASE_ERROR' : 'TOOL_EXECUTION_ERROR';
          trace('TOOL_EXECUTION_FAILED', { tool: call.name, category, errorName: error.name });
          await AIAuditLog.create({ actorId: currentActorId, action: blocked ? 'OPERATION_REFUSED' : 'TOOL_ERROR', toolName: call.name, errorCode: blocked ? 'NOT_ALLOWED_OR_INVALID' : 'TOOL_FAILED' }).catch(() => {});
          responses.push({ functionResponse: { name: call.name, response: { error: error.message } } });
        }
      }
      contents.push({ role: 'user', parts: responses });
    }
    return { type: 'error', message: 'VALO AI cần thu hẹp câu hỏi để trả lời chính xác.', evidence, suggestedActions: [], draft, conversationId: id };
  } catch (error) {
    const category = classifyError(error, stage);
    trace('CHAT_FAILED', { failedStage: stage, category, errorName: error.name, httpStatus: Number(error.status || error.response?.status) || null });
    await AIAuditLog.create({ actorId: currentActorId, action: 'GEMINI_ERROR', errorCode: category }).catch(() => {});
    return { type: 'error', message: 'VALO AI đang tạm gián đoạn. Vui lòng thử lại sau.', evidence: [], suggestedActions: [], draft: null, conversationId: id };
  }
}
module.exports = { chat, conversations, classifyError };
