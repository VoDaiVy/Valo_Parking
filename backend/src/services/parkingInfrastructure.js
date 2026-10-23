const mongoose = require('mongoose');
const Session = require('../models/Session');

async function assertParkingInfrastructure() {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') {
    throw new Error('Parking passes require a MongoDB replica set for atomic check-in and checkout.');
  }
  if (process.env.TELEGRAM_ENABLED === 'true') {
    const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET', 'PARKING_PASS_QR_SECRET'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) throw new Error(`Telegram configuration is incomplete: ${missing.join(', ')}.`);
  }
  let indexes;
  try { indexes = await Session.collection.indexes(); }
  catch { indexes = []; }
  const names = ['parking_active_unique_plate', 'parking_active_unique_slot'];
  for (const name of names) {
    if (!indexes.some((index) => index.name === name && index.unique && index.partialFilterExpression?.status === 'active')) {
      throw new Error('Run npm run audit:parking-passes, resolve conflicts, then npm run migrate:parking-passes -- --apply before enabling parking passes.');
    }
  }
  const models = [
    require('../models/ParkingPass'), require('../models/ParkingPassAction'),
    require('../models/CheckoutAttempt'), require('../models/KioskDevice'),
  ];
  if (process.env.TELEGRAM_ENABLED === 'true') models.push(
    require('../models/TelegramLink'), require('../models/TelegramClaimToken'),
    require('../models/TelegramUpdate'), require('../models/TelegramDelivery'),
  );
  if (process.env.TELEGRAM_PHONE_RECEIPTS_ENABLED === 'true') models.push(
    require('../models/TelegramPhoneRecipient'), require('../models/TelegramReceipt'),
  );
  // Do not accept traffic until dedupe/ownership constraints are enforced.
  for (const model of models) await model.createIndexes();
}

module.exports = { assertParkingInfrastructure };
