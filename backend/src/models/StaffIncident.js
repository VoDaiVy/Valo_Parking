const mongoose = require('mongoose');
const { Schema } = mongoose;

const schema = new Schema({
  reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reporterName: { type: String, required: true },
  priority: { type: String, enum: ['INFO', 'WARNING', 'ERROR'], required: true },
  content: { type: String, required: true, maxlength: 2000 },
  status: { type: String, enum: ['OPEN', 'IN_PROGRESS', 'CLOSED'], default: 'OPEN', required: true },
  revision: { type: Number, default: 0, required: true },
  closedAt: Date,
  messages: [{
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorName: { type: String, required: true },
    role: { type: String, enum: ['staff', 'admin'], required: true },
    content: { type: String, required: true, maxlength: 2000 },
    closed: { type: Boolean, default: false },
    createdAt: { type: Date, required: true },
  }],
}, { timestamps: true });
schema.index({ reporterId: 1, updatedAt: -1 });
schema.index({ status: 1, priority: 1, updatedAt: -1 });

module.exports = mongoose.model('StaffIncident', schema);
