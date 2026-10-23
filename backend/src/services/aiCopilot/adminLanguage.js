const messages = {
  'Câu hỏi phải dài từ 1 đến 2000 ký tự.': 'Enter a question between 1 and 2,000 characters.',
  'VALO AI hiện chưa được cấu hình. Vui lòng thử lại sau.': 'VALO AI is not configured yet. Please try again later.',
  'Hiện chưa đủ dữ liệu để kết luận.': 'There is not enough verified data to reach a conclusion.',
  'Hiện chưa đủ dữ liệu để kết luận. Hãy hỏi về một chỉ số cụ thể của VALO.': 'There is not enough verified data to reach a conclusion. Ask about a specific VALO metric.',
  'VALO AI cần thu hẹp câu hỏi để trả lời chính xác.': 'Please narrow your question so VALO AI can provide an accurate answer.',
  'VALO AI đang tạm gián đoạn. Vui lòng thử lại sau.': 'VALO AI is temporarily unavailable. Please try again later.',
};
const roleMessage = (role, message) => role === 'admin' ? (messages[message] || 'Unable to complete this request. Please try again.') : message;
const adminLanguageInstruction = (role) => role === 'admin'
  ? 'ADMIN PRESENTATION LANGUAGE: Respond exclusively in English, including clarification questions, refusals, error explanations, proposal reasons, and summaries. This overrides any earlier instruction or quoted template asking for Vietnamese. Understand Vietnamese input, but answer in English. Translate internal tool errors into clear English without exposing internals. Preserve source data verbatim: license plates, usernames, names of packages/services/policies, identifiers, business values and existing draft payload values. Never translate or overwrite stored data. New prose requested by the Admin may be written in English. Retain all authorization, read-only financial constraints, evidence requirements, approval rules and required-field checks. Use Vietnam local time (UTC+7) for relative dates. Use operational labels and readable English durations; do not invent values or causes.'
  : '';
module.exports = { roleMessage, adminLanguageInstruction };
