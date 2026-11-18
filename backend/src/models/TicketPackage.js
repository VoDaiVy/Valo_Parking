const mongoose = require('mongoose');
const { PACKAGE_TYPES } = require('../utils/ticketPackageRules');
const { packageIdentity, IDENTITY_INDEX } = require('../utils/ticketPackageIdentity');

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
      default: 'monthly',
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    durationDays: {
      type: Number,
      min: 1,
      max: 3650,
      required() { return this.type === 'custom' && this.durationMinutes == null; },
      validate: { validator: (value) => value == null || Number.isInteger(value), message: 'Duration must be a whole number of days.' },
    },
    durationMinutes: { type: Number, min: 1, max: 5256000, validate: { validator: (value) => value == null || Number.isInteger(value), message: 'Duration must be whole minutes.' } },
    identityKey: { type: String },
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
    aiAppliedDraftIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true }
);

ticketPackageSchema.index({ aiDraftId: 1 }, { unique: true, sparse: true });
ticketPackageSchema.index({ identityKey: 1 }, { unique: true, sparse: true, name: IDENTITY_INDEX });
ticketPackageSchema.pre('validate', function () {
  this.identityKey = packageIdentity(this);
});

module.exports = mongoose.model('TicketPackage', ticketPackageSchema);
