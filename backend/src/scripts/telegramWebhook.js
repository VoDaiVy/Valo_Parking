// Register a replacement tunnel without discarding pending Telegram messages.
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const envPath = path.resolve(__dirname, '../../.env');
require('dotenv').config({ path: envPath, quiet: true });

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required.');
  const api = axios.create({ baseURL: `https://api.telegram.org/bot${token}`, timeout: 15000 });
  const target = process.argv[2];
  if (target && target !== '--status') {
    const url = new URL(target);
    if (url.protocol !== 'https:' || url.pathname !== '/api/telegram/webhook' || url.username || url.password || url.search || url.hash) {
      throw new Error('Use https://<host>/api/telegram/webhook.');
    }
    if (!process.env.TELEGRAM_WEBHOOK_SECRET) throw new Error('TELEGRAM_WEBHOOK_SECRET is required.');
    const response = await api.post('/setWebhook', {
      url: url.href,
      secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['message'],
      drop_pending_updates: false,
    });
    if (!response.data.ok) throw new Error('Telegram rejected webhook registration.');
    const original = fs.readFileSync(envPath, 'utf8');
    const entry = `TELEGRAM_WEBHOOK_URL=${url.href}`;
    const updated = /^\s*TELEGRAM_WEBHOOK_URL\s*=.*$/m.test(original)
      ? original.replace(/^[\t ]*TELEGRAM_WEBHOOK_URL[\t ]*=.*$/m, () => entry)
      : `${original}${original.endsWith('\n') ? '' : '\n'}${entry}\n`;
    fs.writeFileSync(envPath, updated);
    console.log('Webhook registered and backend/.env updated. Pending messages preserved.');
  }
  const response = await api.get('/getWebhookInfo');
  if (!response.data.ok) throw new Error('Could not read webhook status.');
  const info = response.data.result;
  console.log(JSON.stringify({
    url: info.url,
    pending: info.pending_update_count,
    lastError: info.last_error_message || null,
    lastErrorAt: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
  }, null, 2));
}

main().catch(error => {
  // Axios errors contain the bot token in their request URL; never dump the error.
  console.error(`Telegram webhook: ${error.response?.data?.description || (error.isAxiosError ? error.code || 'request failed' : error.message)}`);
  process.exitCode = 1;
});
