const mongoose = require('mongoose');

const aiBookingMessageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
    intent: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true, id: false }
);

const aiBookingSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    clientSessionId: {
      type: String,
      trim: true,
      maxlength: 100,
      default: () => new mongoose.Types.ObjectId().toString(),
    },
    status: {
      type: String,
      enum: ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED'],
      default: 'DRAFT',
      index: true,
    },
    currentStep: {
      type: String,
      enum: [
        'COLLECT_DATE',
        'COLLECT_TIME',
        'SELECT_VEHICLE',
        'SELECT_SLOT',
        'SELECT_SERVICE',
        'CONFIRM_BOOKING',
        'PAYMENT',
        'COMPLETED',
      ],
      default: 'COLLECT_DATE',
    },
    completionPercent: { type: Number, min: 0, max: 100, default: 10 },
    intent: { type: String, trim: true, default: 'UNKNOWN' },
    phase: { type: String, trim: true, default: 'IDLE' },
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },
    bookingDraft: { type: mongoose.Schema.Types.Mixed, default: {} },
    preview: { type: mongoose.Schema.Types.Mixed, default: null },
    messages: { type: [aiBookingMessageSchema], default: [] },
    expiresAt: { type: Date, required: true, index: true },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

aiBookingSessionSchema.index({ userId: 1, status: 1, updatedAt: -1 });
aiBookingSessionSchema.index(
  { userId: 1, clientSessionId: 1 },
  { unique: true }
);

module.exports = mongoose.model('AiBookingSession', aiBookingSessionSchema);
