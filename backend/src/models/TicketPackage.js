const mongoose = require('mongoose');
const { PACKAGE_TYPES } = require('../utils/ticketPackageRules');

const ticketPackageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: PACKAGE_TYPES,
      required: true,
      default: 'hourly',
    },
    price: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isSafeInteger, message: 'Package price must be a whole VND amount.' },
    },
    durationDays: {
      type: Number,
      min: 1,
      max: 3650,
      required() { return this.type === 'custom' && this.durationMinutes == null; },
      validate: { validator: (value) => value == null || Number.isInteger(value), message: 'Duration must be a whole number of days.' },
    },
    durationMinutes: { type: Number, min: 1, max: 5256000, validate: { validator: (value) => value == null || Number.isInteger(value), message: 'Duration must be whole minutes.' } },
    revision: { type: Number, default: 0 },
    benefitsVersion: { type: Number, default: 0 },
    displayBenefits: { type: [String], default: [] },
    serviceBenefits: [{
      _id: false,
      serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
      serviceName: { type: String, required: true },
      quantityPerSlot: { type: Number, min: 1, max: 10000, required: true, validate: Number.isInteger },
    }],
    description: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    saleLimit: { type: Number, default: null, min: 0, validate: { validator: (value) => value == null || Number.isSafeInteger(value), message: 'Sale limit must be a non-negative safe integer.' } },
    inactiveReason: { type: String, enum: ['SOLD_OUT', 'ADMIN_PAUSED', null], default: null },
    stockRevision: { type: Number, default: 0 },
    maxSlots: {
      type: Number,
      default: 3,
      min: 1,
      max: 10,
    },
    renewalWindowDays: {
      type: Number,
      default: 7,
      min: 1,
      max: 60,
    },
    isRenewable: {
      type: Boolean,
      default: true,
    },
    aiDraftId: { type: mongoose.Schema.Types.ObjectId, ref: 'AIDraft' },
    duration: {
      unit: { type: String, enum: ['minutes', 'hours', 'days', 'months', 'calendarMonths'] },
      value: { type: Number, min: 1 },
    },
    salesStartAt: { type: Date, default: null },
    salesEndAt: { type: Date, default: null },
    optionalServiceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
    optionalServices: { type: [mongoose.Schema.Types.Mixed], default: [] },
    service: { type: String, enum: ['RESERVED_FREE', 'RESERVED_PAID'] },
    serviceConfiguration: {
      kind: { type: String, enum: ['RESERVED_FREE', 'RESERVED_PAID'] },
      eligibility: { type: String, enum: ['BOUND_VEHICLE_REGISTERED_SLOT'] },
      baseParkingFee: { type: String, enum: ['WAIVED_WHILE_EFFECTIVE', 'NORMAL_PRICING'] },
      auxiliaryServices: { type: String, enum: ['CHARGED_SEPARATELY'] },
    },
    purchaseRevision: { type: Number, default: 0 },
    configurationKey: String,
    normalizedName: String,
    aiAppliedDraftIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true }
);

ticketPackageSchema.index({ aiDraftId: 1 }, { unique: true, sparse: true });
ticketPackageSchema.index({ configurationKey: 1 }, {
  name: 'unique_sellable_package_configuration', unique: true,
  partialFilterExpression: { isActive: true, configurationKey: { $type: 'string' } },
});
ticketPackageSchema.index({ normalizedName: 1 }, {
  name: 'unique_sellable_package_name', unique: true,
  partialFilterExpression: { isActive: true, normalizedName: { $type: 'string' } },
});

module.exports = mongoose.model('TicketPackage', ticketPackageSchema);
