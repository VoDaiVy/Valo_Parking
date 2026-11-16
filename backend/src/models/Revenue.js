const mongoose = require('mongoose');

const revenueSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['BOOKING', 'SUBSCRIPTION', 'VIOLATION', 'SERVICE', 'PARKING'],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0, 'Amount cannot be negative'],
      index: true,
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'sourceModel',
      required: true,
      index: true,
    },
    sourceModel: {
      type: String,
      enum: ['Booking', 'Subscription', 'Violation', 'BookingService', 'Session'],
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    paymentIntentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaymentIntent',
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

revenueSchema.index({ type: 1, createdAt: -1 });
revenueSchema.index({ userId: 1, type: 1, createdAt: -1 });
revenueSchema.index({ sourceModel: 1, sourceId: 1 });
revenueSchema.index(
  { type: 1, sourceModel: 1, sourceId: 1 },
  { unique: true, partialFilterExpression: { type: 'PARKING', sourceModel: 'Session' } }
);

module.exports = mongoose.model('Revenue', revenueSchema);
