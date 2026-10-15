const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Notification title is required'],
      trim: true,
      maxlength: [200, 'Title must not exceed 200 characters'],
    },
    content: {
      type: String,
      required: [true, 'Notification content is required'],
      trim: true,
      maxlength: [2000, 'Content must not exceed 2000 characters'],
    },
    type: {
      type: String,
      enum: ['SYSTEM', 'PARKING', 'BOOKING', 'WALLET', 'PAYMENT', 'ACCOUNT', 'PROMOTION', 'CAMERA', 'VIOLATION'],
      default: 'SYSTEM',
      index: true,
    },
    priority: {
      type: String,
      enum: ['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'SYSTEM'],
      default: 'INFO',
    },
    targetType: {
      type: String,
      enum: ['ALL_USERS', 'SINGLE_USER', 'MULTI_USER', 'ROLE_BASED'],
      required: true,
    },
    targetRoles: [
      {
        type: String,
        enum: ['customer', 'staff', 'admin'],
        default: 'customer'
      },
    ],
    targetUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    recipientCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null, // null = system-generated
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isRevoked: {
      type: Boolean,
      default: false,
    },
    adminReadBy: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        readAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    adminDeletedBy: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        deletedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Index for admin history queries
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ createdBy: 1, createdAt: -1 });
notificationSchema.index(
  { 'metadata.aiDraftId': 1 },
  { unique: true, partialFilterExpression: { 'metadata.aiDraftId': { $type: 'string' } } }
);

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
