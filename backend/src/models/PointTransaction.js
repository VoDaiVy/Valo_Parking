const mongoose = require('mongoose');

const pointTransactionSchema = new mongoose.Schema(
  {
    loyaltyAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LoyaltyAccount',
      required: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['EARN', 'REVOKE', 'REDEEM', 'EXPIRE'], required: true },
    amount: { type: Number, required: true, min: 0 },
    // EARN transactions behave as FIFO point lots. Each lot is valid for 30 days.
    remainingAmount: { type: Number, min: 0, default: null },
    expiresAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },
    balanceBefore: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true, min: 0 },
    refSource: {
      type: String,
      enum: ['booking', 'subscription', 'voucher'],
      default: null,
    },
    refSourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true }
);

pointTransactionSchema.index({ loyaltyAccountId: 1, createdAt: -1 });
pointTransactionSchema.index({ userId: 1, type: 1, expiresAt: 1, remainingAmount: 1 });
pointTransactionSchema.index({ userId: 1, type: 1, refSourceId: 1 });
pointTransactionSchema.index(
  { userId: 1, type: 1, refSource: 1, refSourceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: { $in: ['EARN', 'REVOKE'] },
      refSourceId: { $type: 'objectId' },
    },
  }
);

module.exports = mongoose.model('PointTransaction', pointTransactionSchema);
