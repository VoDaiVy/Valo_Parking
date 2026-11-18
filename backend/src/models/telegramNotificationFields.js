const mongoose = require('mongoose');

// Embedded outbox: committed with the business record, retained after delivery TTL.
// No default on the parent field: existing records must never become new events.
const telegramNotificationSchema = new mongoose.Schema({
  occurredAt: { type: Date, required: true },
  processedAt: Date,
}, { _id: false });

module.exports = telegramNotificationSchema;
