const mongoose = require('mongoose');

const pointTransactionSchema = new mongoose.Schema(
  {
    loyaltyAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LoyaltyAccount',
      required: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['EARN', 'REVOKE', 'REDEEM'], required: true },
    amount: { type: Number, required: true, min: 0 },
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
