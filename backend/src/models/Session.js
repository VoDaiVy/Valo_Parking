const mongoose = require('mongoose');
const { normalizeLicensePlate } = require('../utils/licensePlateUtils');

const sessionSchema = new mongoose.Schema(
  {
    licensePlate: {
      type: String,
      required: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
      index: true,
    },
    entitlementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MembershipSlotEntitlement',
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ['BOOKING', 'WALK_IN', 'SUBSCRIPTION'],
      default: 'WALK_IN',
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    source: {
      type: String,
      enum: ['kiosk', 'app_booking', 'booking', 'walk_in', 'staff_manual'],
      default: 'kiosk',
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    vehicleType: {
      type: String,
      enum: ['car', 'electric_car', 'motorcycle'],
      default: 'car',
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'cancelled'],
      default: 'active',
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'refunded'],
      default: 'unpaid',
    },
    parkingSlot: {
      type: String,
      trim: true,
      default: null,
    },
    floorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ParkingFloor',
      default: null,
    },
    checkInTime: {
      type: Date,
      default: Date.now,
    },
    checkOutTime: {
      type: Date,
      default: null,
    },
    expectedDurationHours: {
      type: Number,
      default: 1,
    },
    entryImage_url: {
      type: String,
      default: null,
    },
    exitImage_url: {
      type: String,
      default: null,
    },
    entryCamera: {
      type: String,
      default: null,
    },
    exitCamera: {
      type: String,
      default: null,
    },
    confidence: {
      type: Number,
      default: 100,
    },
    aiRecognitionResult: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    entryGate: {
      type: String,
      default: null,
    },
    exitGate: {
      type: String,
      default: null,
    },
    totalPrice: {
      type: Number,
      default: 0,
    },
    settledPaidAmount: { type: Number, min: 0, default: null },
    pricingBreakdown: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

sessionSchema.pre('validate', function normalizePlate(next) {
  if (this.licensePlate) {
    this.licensePlate = normalizeLicensePlate(this.licensePlate);
  }
  next();
});

sessionSchema.index({ licensePlate: 1, status: 1, checkInTime: 1 });
sessionSchema.index({ checkOutTime: 1, bookingId: 1, userId: 1 });

module.exports = mongoose.model('Session', sessionSchema);
