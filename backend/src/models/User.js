const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [30, 'Username must not exceed 30 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    password: {
      type: String,
      minlength: [6, 'Password must be at least 6 characters'],
      select: false, // Don't return password by default in queries
    },
    role: {
      type: String,
      enum: ['guest', 'customer', 'staff', 'admin'],
      default: 'customer',
    },
    googleId: {
      type: String,
      default: null,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    status: {
      type: Boolean,
      default: true, // true = active, false = inactive
    },
    bookingRestriction: {
      blocked: { type: Boolean, default: false },
      reason: { type: String, maxlength: 500 },
      changedAt: Date,
      changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
    membership: {
      isVip: { type: Boolean, default: false },
      expireAt: { type: Date, default: null },
      packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'TicketPackage', default: null },
      freeServiceCount: { type: Number, default: 0 },
      qrVersion: { type: Number, default: 1, min: 1 },
    },
    expoPushTokens: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  // Only hash if password is modified or present
  if (!this.isModified('password') || !this.password) return next();

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON output
userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  return user;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
