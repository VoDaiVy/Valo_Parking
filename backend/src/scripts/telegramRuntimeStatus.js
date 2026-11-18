// Read-only diagnostics. Never print tokens, chat IDs, phone numbers or message payloads.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const mongoose = require('mongoose');
const Update = require('../models/TelegramUpdate');

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    const recentUpdates = await Update.find().sort({ createdAt: -1 }).limit(10)
      .select('status attempts errorCode createdAt updatedAt -_id').lean();
    console.log(JSON.stringify({
      enabled: process.env.TELEGRAM_ENABLED === 'true',
      mode: process.env.TELEGRAM_UPDATE_MODE || 'webhook',
      recentUpdates,
    }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(() => {
  console.error('Telegram runtime diagnostic failed. Check database connectivity.');
  process.exitCode = 1;
});
