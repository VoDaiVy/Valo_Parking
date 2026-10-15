const mongoose = require('mongoose');

const subscriptionRenewalSchema = new mongoose.Schema(
  {
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ['wallet', 'payos'],
      required: true,
    },
    orderCode: {
      type: Number,
      sparse: true,
      unique: true,
    },
    walletTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    oldExpireAt: {
      type: Date,
      required: true,
    },
    newExpireAt: {
      type: Date,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    packageSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    entitlementSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    payosPaymentLinkId: {
      type: String,
      default: null,
    },
    payosCheckoutUrl: {
      type: String,
      default: null,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    failureReason: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

subscriptionRenewalSchema.index({ userId: 1, createdAt: -1 });
subscriptionRenewalSchema.index({ subscriptionId: 1, status: 1, createdAt: -1 });
subscriptionRenewalSchema.index({ paidAt: 1 });
subscriptionRenewalSchema.index(
  { subscriptionId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
    name: 'one_pending_renewal_per_subscription',
  }
);

module.exports = mongoose.model('SubscriptionRenewal', subscriptionRenewalSchema);
