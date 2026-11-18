const mongoose = require('mongoose');

const violationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Violation title is required'],
      trim: true,
      maxlength: [200, 'Title must not exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description must not exceed 1000 characters'],
      default: '',
    },
    fineAmount: {
      type: Number,
      required: [true, 'Fine amount is required'],
      min: [10000, 'Minimum fine amount is 10,000 VND'],
      max: [50000000, 'Maximum fine amount is 50,000,000 VND'],
      index: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'PAID', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },
    paidAt: {
      type: Date,
      default: null,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true,
    },
    parkingSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      default: null,
      index: true,
    },
    evidenceImages: {
      type: [String],
      default: [],
    },
    walletTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

violationSchema.virtual('isOverdue').get(function isOverdue() {
  if (this.status !== 'PENDING' || !this.createdAt) return false;
  const paymentWindow = 72 * 60 * 60 * 1000;
  return Date.now() - this.createdAt.getTime() > paymentWindow;
});

violationSchema.virtual('daysLeftInPaymentWindow').get(function daysLeftInPaymentWindow() {
  if (this.status !== 'PENDING' || !this.createdAt) return 0;
  const paymentWindow = 72 * 60 * 60 * 1000;
  const remaining = paymentWindow - (Date.now() - this.createdAt.getTime());
  return remaining > 0 ? Math.ceil(remaining / (24 * 60 * 60 * 1000)) : 0;
});

violationSchema.set('toJSON', { virtuals: true });
violationSchema.set('toObject', { virtuals: true });

violationSchema.index({ userId: 1, createdAt: -1 });
violationSchema.index({ status: 1, createdAt: -1 });
violationSchema.index({ createdBy: 1, createdAt: -1 });

module.exports = mongoose.model('Violation', violationSchema);
