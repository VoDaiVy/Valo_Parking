const client = require('./telegramClient');
const { persistUpdate } = require('./telegramUpdateService');

async function pollTelegramUpdatesOnce(offset, options) {
  const updates = await client.getUpdates(offset, options);
  let nextOffset = offset;
  for (const update of updates) {
    // Acknowledge only after durable storage. Replays are deduplicated by updateId.
    await persistUpdate(update);
    nextOffset = Math.max(nextOffset || 0, update.update_id + 1);
  }
  return nextOffset;
}

function startTelegramPolling() {
  if (!client.enabled() || process.env.TELEGRAM_UPDATE_MODE !== 'polling') return () => {};
  const controller = new AbortController();
  let stopped = false, timer, offset, checkedWebhook = false;
  const tick = async () => {
    let delay = 100;
    try {
      if (!checkedWebhook) {
        const info = await client.getWebhookInfo();
        if (stopped) return;
        if (info.url) {
          console.warn('[Telegram] polling stopped: a webhook is registered. Use webhook mode or remove it explicitly.');
          stopped = true;
          return;
        }
        checkedWebhook = true;
        console.log('[Telegram] polling receiver started');
      }
      offset = await pollTelegramUpdatesOnce(offset, { signal: controller.signal });
    } catch (error) {
      if (stopped) return;
      // Never log Axios errors: their request URLs contain the bot token.
      const code = Number(error.response?.data?.error_code || error.response?.status || 0);
      if ([401, 404, 409].includes(code)) {
        console.warn(`[Telegram] polling stopped (API ${code}). Check the token, webhook and other polling processes.`);
        stopped = true;
        return;
      }
      console.warn('[Telegram] polling failed; retrying in 5 seconds');
      delay = 5000;
    }
    if (!stopped) {
      timer = setTimeout(tick, delay);
      timer.unref();
    }
  };
  tick();
  return () => { stopped = true; clearTimeout(timer); controller.abort(); };
}

module.exports = { pollTelegramUpdatesOnce, startTelegramPolling };
