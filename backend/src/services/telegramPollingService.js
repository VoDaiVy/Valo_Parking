const axios = require('axios');
const client = require('./telegramClient');
const { storeUpdate } = require('./telegramUpdateService');

function startTelegramPolling() {
  if (!client.enabled() || process.env.TELEGRAM_UPDATE_MODE !== 'polling') return () => {};
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('[Telegram] polling requires TELEGRAM_BOT_TOKEN');
    return () => {};
  }
  const controller = new AbortController();
  const api = axios.create({ baseURL: `https://api.telegram.org/bot${token}`, timeout: 35000, signal: controller.signal });
  let timer;
  let offset;
  let initialized = false;
  const call = async (method, body) => {
    const response = await api.post(method, body);
    if (!response.data?.ok) throw new Error('Telegram rejected polling request');
    return response.data.result;
  };
  const poll = async () => {
    try {
      if (!initialized) {
        await call('deleteWebhook', { drop_pending_updates: false });
        initialized = true;
        console.log('[Telegram] polling active; webhook removed, pending messages preserved');
      }
      const updates = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
      for (const update of updates) {
        if (controller.signal.aborted) return;
        await storeUpdate(update);
        // Acknowledge only after persistence; duplicates are safe on restart.
        offset = update.update_id + 1;
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 0);
    } catch (error) {
      if (controller.signal.aborted) return;
      // Never log Axios errors: request URLs contain the bot token.
      console.warn(`[Telegram] polling failed (status ${error.response?.status || 'unavailable'}); retrying in 5s`);
      timer = setTimeout(poll, 5000);
    }
  };
  poll();
  return () => { controller.abort(); clearTimeout(timer); };
}

module.exports = { startTelegramPolling };
