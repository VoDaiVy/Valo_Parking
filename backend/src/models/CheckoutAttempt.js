const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
  amountDue: { type: Number, required: true, min: 0 },
  orderCode: { type: Number, required: true, unique: true },
  quoteTime: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'paid', 'settled', 'cancelled'], default: 'pending' },
  settledAt: Date,
  qrCode: String,
  checkoutUrl: String,
}, { timestamps: true });
schema.index({ sessionId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['pending', 'paid'] } } });
module.exports = mongoose.model('CheckoutAttempt', schema);
