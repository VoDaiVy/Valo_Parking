const mongoose = require('mongoose');

const membershipEntitlementRenewalSchema = new mongoose.Schema(
  {
    entitlementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MembershipSlotEntitlement',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sourceSubscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      required: true,
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
    orderCode: { type: Number, sparse: true, unique: true },
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
    oldExpireAt: { type: Date, required: true },
    newExpireAt: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    packageSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    payosPaymentLinkId: { type: String, default: null },
    payosCheckoutUrl: { type: String, default: null },
    paidAt: { type: Date, default: null },
    notificationPending: { type: Boolean, default: false },
    notificationProcessedAt: { type: Date, default: null },
    failureReason: { type: String, default: '' },
  },
  { timestamps: true }
);

membershipEntitlementRenewalSchema.index({ paidAt: 1 });
membershipEntitlementRenewalSchema.index(
  { entitlementId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
    name: 'one_pending_renewal_per_entitlement',
  }
);

module.exports = mongoose.model(
  'MembershipEntitlementRenewal',
  membershipEntitlementRenewalSchema
);
