const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  originSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
  activeSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', default: null },
  usageCounter: { type: Number, default: 0 },
  qrVersion: { type: Number, default: 1, min: 1 },
  revokedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ bookingId: 1 }, { unique: true, partialFilterExpression: { bookingId: { $type: 'objectId' } } });
schema.index({ originSessionId: 1 }, { unique: true, partialFilterExpression: { originSessionId: { $type: 'objectId' } } });
module.exports = mongoose.model('ParkingPass', schema);
