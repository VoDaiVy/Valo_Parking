const mongoose = require('mongoose');

const paymentIntentSchema = new mongoose.Schema(
  {
    purpose: {
      type: String,
      enum: ['KIOSK_CHECKOUT', 'BOOKING', 'TOP_UP', 'SUBSCRIPTION'],
      required: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      default: null,
      index: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    provider: {
      type: String,
      enum: ['PAYOS', 'WALLET', 'CASH'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'VND',
      immutable: true,
    },
    status: {
      type: String,
      enum: ['CREATED', 'PENDING', 'PAID', 'SETTLED', 'FAILED', 'CANCELLED', 'EXPIRED'],
      default: 'CREATED',
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
    },
    providerOrderCode: {
      type: Number,
      default: null,
    },
    providerPaymentLinkId: {
      type: String,
      default: null,
    },
    checkoutUrl: {
      type: String,
      default: null,
    },
    qrCode: {
      type: String,
      default: null,
    },
    providerReference: {
      type: String,
      default: null,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    settledAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    cashReceivedAmount: {
      type: Number,
      min: 0,
      default: null,
    },
    changeAmount: {
      type: Number,
      min: 0,
      default: null,
    },
    confirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    revenueRecordedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

paymentIntentSchema.index(
  { purpose: 1, idempotencyKey: 1 },
  { unique: true }
);
paymentIntentSchema.index(
  { provider: 1, providerOrderCode: 1 },
  {
    unique: true,
    partialFilterExpression: { providerOrderCode: { $type: 'number' } },
  }
);

module.exports = mongoose.model('PaymentIntent', paymentIntentSchema);
