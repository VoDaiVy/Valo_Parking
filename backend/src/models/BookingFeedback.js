const mongoose = require('mongoose');

const replySchema = new mongoose.Schema({
  content: { type: String, required: true, trim: true, maxlength: 2000 },
  repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  repliedAt: { type: Date, required: true },
  updatedAt: { type: Date, required: true },
}, { _id: false });

const schema = new mongoose.Schema({
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true, immutable: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
  comment: { type: String, trim: true, maxlength: 1000, default: '' },
  categories: [{ type: String, enum: ['parking', 'staff', 'payment', 'app', 'other'] }],
  reply: { type: replySchema, default: null },
  replyRevision: { type: Number, default: 0, min: 0 },
  replyHistory: [{
    _id: false,
    revision: Number,
    content: String,
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: Date,
  }],
}, { timestamps: true });
schema.index({ userId: 1, createdAt: -1 });
schema.index({ createdAt: -1, _id: -1 });
schema.index({ 'reply.repliedAt': 1, createdAt: -1 });

module.exports = mongoose.model('BookingFeedback', schema);
