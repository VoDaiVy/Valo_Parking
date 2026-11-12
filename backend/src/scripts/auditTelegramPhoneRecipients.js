// Read-only by default. --apply only creates indexes; it never imports profile phones.
require('dotenv').config();
const mongoose = require('mongoose');
const Recipient = require('../models/TelegramPhoneRecipient');
const Receipt = require('../models/TelegramReceipt');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const duplicateGroups = await Recipient.aggregate([
      { $group: { _id: '$phone', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }, { $count: 'count' },
    ]);
    const invalid = await Recipient.countDocuments({ $or: [
      { phone: { $not: /^0\d{9}$/ } }, { chatId: null }, { telegramUserId: null },
      { verifiedAt: null }, { consentAt: null }, { expiresAt: null }, { version: { $lt: 1 } },
    ] });
    const duplicates = duplicateGroups[0]?.count || 0;
    console.log(JSON.stringify({ recipients: await Recipient.countDocuments(), duplicatePhoneGroups: duplicates, invalidRecipients: invalid, mode: process.argv.includes('--apply') ? 'apply-indexes' : 'audit' }));
    if (duplicates || invalid) throw new Error('Resolve recipient conflicts before applying indexes. No data was changed.');
    if (process.argv.includes('--apply')) {
      await Recipient.createIndexes();
      await Receipt.createIndexes();
      console.log('Telegram phone recipient and receipt indexes ready.');
    }
  } finally { await mongoose.disconnect(); }
}
main().catch(() => { console.error('Telegram phone recipient audit failed; inspect database connectivity or recipient conflicts.'); process.exitCode = 1; });
