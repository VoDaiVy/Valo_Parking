const mongoose = require('mongoose');
const { normalizePhone } = require('../utils/phoneUtils');

const userDetailSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    firstName: {
      type: String,
      trim: true,
      default: '',
    },
    lastName: {
      type: String,
      trim: true,
      default: '',
    },
    phone: {
      type: String,
      trim: true,
      default: '',
      set: (value) => normalizePhone(value),
    },
    // Internal transaction fence shared by profile changes and Telegram linking.
    telegramLinkRevision: { type: Number, default: 0, select: false },
    dob: {
      type: Date,
      default: null,
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other', ''],
      default: '',
    },
    avatar: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

userDetailSchema.index({ phone: 1 });

const UserDetail = mongoose.model('UserDetail', userDetailSchema);

module.exports = UserDetail;
