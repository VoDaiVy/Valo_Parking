const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    telegramNotification: { type: require('./telegramNotificationFields'), default: undefined },
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
        vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
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
    packageSnapshot: { type: mongoose.Schema.Types.Mixed, immutable: true },
    bindingVersion: Number,
    paymentMethod: { type: String, enum: ['wallet', 'payos'] },
    idempotencyKey: String,
    payosCheckoutUrl: String,
    payosPaymentLinkId: String,
    activatedAt: Date,
    activationFailureReason: String,
    reconciliationRequired: { type: Boolean, default: false },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'cancelled', 'failed'],
      default: 'pending',
    },
    firstPaidAt: { type: Date, default: null },
    activatedAt: { type: Date, default: null },
    stockHoldUntil: { type: Date, default: null },
    packageTermsSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    packageDurationSnapshot: {
      type: new mongoose.Schema({
        type: { type: String, required: true, enum: ['daily', 'weekly', 'monthly', 'yearly', 'custom'] },
        durationDays: { type: Number, min: 1, max: 3650 },
        durationMinutes: { type: Number, min: 1, max: 5256000 },
      }, { _id: false }),
      default: null,
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
    expiryNotificationPending: { type: Boolean, default: false },
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
  if (this.paymentStatus === 'paid' && this.isModified('paymentStatus') && !this.telegramNotification) {
    this.telegramNotification = { occurredAt: new Date() };
  }
  if (this.paymentStatus === 'paid' && this.isModified('paymentStatus')
    && !this.rewardPayments.some((payment) => payment.orderCode === this.orderCode)) {
    this.rewardPayments.push({ orderCode: this.orderCode, userId: this.user, amount: this.amount, paidAt: new Date() });
  }
  if (this.paymentStatus === 'paid' && !this.firstPaidAt) {
    const initialPayment = this.rewardPayments.find((payment) => payment.orderCode === this.orderCode);
    if (initialPayment) this.firstPaidAt = initialPayment.paidAt;
  }
  next();
});
subscriptionSchema.index({ idempotencyKey: 1, user: 1 }, { unique: true, name: 'unique_package_purchase_request', partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
subscriptionSchema.index({ orderCode: 1 }, { unique: true, name: 'unique_bound_purchase_order', partialFilterExpression: { bindingVersion: 1 } });
subscriptionSchema.index({ 'rewardPayments.paidAt': 1 });
subscriptionSchema.index({ 'telegramNotification.processedAt': 1, 'telegramNotification.occurredAt': 1 });
subscriptionSchema.index({ user: 1, status: 1, expireAt: -1 });
subscriptionSchema.index({ status: 1, paymentStatus: 1, expireAt: 1 });

subscriptionSchema.index({ ticketPackage: 1, status: 1, paymentStatus: 1, stockHoldUntil: 1 });
subscriptionSchema.index({ ticketPackage: 1, status: 1, paymentStatus: 1, expireAt: 1 });
module.exports = mongoose.model('Subscription', subscriptionSchema);
