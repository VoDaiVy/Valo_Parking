const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    ticketPackage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TicketPackage',
      required: true,
    },
    slots: [
      {
        floorId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'ParkingFloor',
          required: true,
        },
        slotCode: {
          type: String,
          required: true,
        },
      },
    ],
    amount: {
      type: Number,
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'cancelled', 'failed'],
      default: 'pending',
    },
    orderCode: {
      type: Number,
      required: true, // PayOS order code
    },
    validFrom: {
      type: Date,
      default: Date.now,
    },
    expireAt: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'expired', 'cancelled', 'failed'],
      default: 'pending',
    },
    qrVersion: {
      type: Number,
      default: 1,
      min: 1,
    },
    expireWarningSent: {
      type: Boolean,
      default: false,
    },
    pendingRenewal: {
      orderCode: Number,
      newExpireAt: Date,
      amount: Number
    },
    rewardPayments: [{
      orderCode: { type: Number },
      paymentKey: String,
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      amount: { type: Number, required: true, min: 0 },
      paidAt: { type: Date, required: true },
    }],
    renewalCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastRenewedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

subscriptionSchema.pre('save', function recordRewardPayment(next) {
  if (this.paymentStatus === 'paid' && this.isModified('paymentStatus')
    && !this.rewardPayments.some((payment) => payment.orderCode === this.orderCode)) {
    this.rewardPayments.push({ orderCode: this.orderCode, userId: this.user, amount: this.amount, paidAt: new Date() });
  }
  next();
});
subscriptionSchema.index({ 'rewardPayments.paidAt': 1 });
subscriptionSchema.index({ user: 1, status: 1, expireAt: -1 });
subscriptionSchema.index({ status: 1, paymentStatus: 1, expireAt: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
