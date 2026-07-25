const mongoose = require('mongoose');

const membershipEntitlementTransferSchema = new mongoose.Schema(
  {
    entitlementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MembershipSlotEntitlement',
      required: true,
      index: true,
    },
    fromUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    mode: {
      type: String,
      enum: ['DIRECT', 'PUBLIC'],
      default: 'DIRECT',
      required: true,
      index: true,
    },
    toUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: [
        'PENDING_RECIPIENT',
        'PENDING_ADMIN',
        'LISTED',
        'AWAITING_PAYMENT',
        'COMPLETED',
        'REJECTED',
        'CANCELLED',
        'EXPIRED',
      ],
      default: 'PENDING_RECIPIENT',
      index: true,
    },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    askingPrice: { type: Number, required: true, min: 0 },
    remainingValue: { type: Number, required: true, min: 0 },
    transferFee: { type: Number, required: true, min: 0 },
    priceSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    acceptedAt: { type: Date, default: null },
    listingApprovedAt: { type: Date, default: null },
    listingExpiresAt: { type: Date, default: null, index: true },
    claimedAt: { type: Date, default: null },
    claimAttemptCount: { type: Number, default: 0, min: 0 },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    lockExpiresAt: { type: Date, default: null, index: true },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: '', trim: true, maxlength: 500 },
    cancelledAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    recipientWalletTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    senderWalletTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    feeWalletTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    contractNumber: { type: String, default: null, unique: true, sparse: true },
    contractSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

membershipEntitlementTransferSchema.index(
  { entitlementId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: {
        $in: ['PENDING_RECIPIENT', 'PENDING_ADMIN', 'LISTED', 'AWAITING_PAYMENT'],
      },
    },
    name: 'one_open_transfer_per_entitlement_v2',
  }
);
membershipEntitlementTransferSchema.index(
  { mode: 1, status: 1, listingExpiresAt: 1, askingPrice: 1 },
  { name: 'membership_transfer_marketplace_browse' }
);

module.exports = mongoose.model(
  'MembershipEntitlementTransfer',
  membershipEntitlementTransferSchema
);
