const mongoose = require('mongoose');
const { normalizeLicensePlate, formatLicensePlateDisplay } = require('../utils/licensePlateUtils');

const vehicleSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    licensePlate: {
      type: String,
      required: [true, 'License plate is required'],
      unique: true,
      trim: true,
      uppercase: true,
      match: [
        /^[A-Z0-9]{4,12}$/,
        'License plate must be 4-12 alphanumeric characters',
      ],
    },
    vehicleType: {
      type: String,
      required: [true, 'Vehicle type is required'],
      enum: {
        values: ['car', 'electric_car'],
        message: 'Vehicle type must be car or electric_car',
      },
    },
    brand: {
      type: String,
      required: [true, 'Brand is required'],
      trim: true,
      maxlength: [50, 'Brand must not exceed 50 characters'],
    },
    model: {
      type: String,
      trim: true,
      maxlength: [50, 'Model must not exceed 50 characters'],
      default: '',
    },
    color: {
      type: String,
      trim: true,
      maxlength: [30, 'Color must not exceed 30 characters'],
      default: '',
    },
    registrationCardImage: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    approvedAt: { type: Date, default: null },
    approvalSource: { type: String, enum: ['ai', 'admin', null], default: null },
    registrationVerification: {
      decision: { type: String, enum: ['not_checked', 'matched', 'review'], default: 'not_checked' },
      reason: { type: String, default: '' },
      checkedAt: { type: Date, default: null },
    },
    nickname: {
      type: String,
      trim: true,
      maxlength: [50, 'Nickname must not exceed 50 characters'],
      default: '',
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    hexColor: {
      type: String,
      trim: true,
      default: '#ffffff',
      match: [/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color format'],
    },
    modelUrl: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

vehicleSchema.virtual('licensePlateDisplay').get(function licensePlateDisplay() {
  return formatLicensePlateDisplay(this.licensePlate);
});

vehicleSchema.set('toJSON', { virtuals: true });
vehicleSchema.set('toObject', { virtuals: true });
vehicleSchema.index({ status: 1, approvedAt: -1 });

vehicleSchema.pre('validate', function normalizePlate(next) {
  if (this.licensePlate) {
    this.licensePlate = normalizeLicensePlate(this.licensePlate);
  }
  next();
});

// Ensure a user can only have one default vehicle at a time
vehicleSchema.pre('save', async function (next) {
  if (this.isDefault && this.isModified('isDefault')) {
    await this.constructor.updateMany(
      { owner: this.owner, _id: { $ne: this._id } },
      { isDefault: false }
    );
  }
  next();
});

module.exports = mongoose.model('Vehicle', vehicleSchema);
