const axios = require('axios');
const FormData = require('form-data');

function enabled() { return process.env.TELEGRAM_ENABLED === 'true'; }
function botUrl() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw Object.assign(new Error('Telegram chưa được cấu hình'), { code: 'TELEGRAM_DISABLED' });
  return `https://api.telegram.org/bot${token}`;
}
function classifyError(error, attempts = 1, now = Date.now()) {
  const body = error.response?.data;
  const code = Number(body?.error_code || error.response?.status || 0);
  if (code === 403) return { status: 'failed', errorCode: 'BOT_BLOCKED' };
  if (code === 400 || code === 401 || code === 404) return { status: 'failed', errorCode: `BOT_${code}` };
  const uncertain = !error.response && ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'].includes(error.code);
  if (attempts >= 5) return { status: uncertain ? 'uncertain' : 'failed', errorCode: uncertain ? 'SEND_UNCERTAIN' : 'RETRY_EXHAUSTED' };
  const delay = code === 429 ? Math.max(1, Number(body?.parameters?.retry_after) || 30) * 1000 : Math.min(300000, 2000 * 2 ** attempts) + Math.floor(Math.random() * 1000);
  return { status: uncertain ? 'uncertain' : 'pending', errorCode: uncertain ? 'SEND_UNCERTAIN' : code === 429 ? 'RATE_LIMIT' : 'BOT_UNAVAILABLE', nextAttemptAt: new Date(now + delay) };
}
async function call(method, data, headers) {
  const response = await axios.post(`${botUrl()}/${method}`, data, { timeout: 15000, headers, maxContentLength: 2 * 1024 * 1024 });
  if (!response.data?.ok) throw Object.assign(new Error('Telegram API failure'), { response: { data: response.data } });
  return response.data.result;
}
function sendMessage(chatId, text, replyMarkup) { return call('sendMessage', { chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }); }
async function sendPhoto(chatId, png, caption) {
  const form = new FormData();
  form.append('chat_id', chatId); form.append('caption', caption);
  form.append('photo', png, { filename: 'valo-ticket.png', contentType: 'image/png' });
  return call('sendPhoto', form, form.getHeaders());
}
module.exports = { enabled, sendMessage, sendPhoto, classifyError };
