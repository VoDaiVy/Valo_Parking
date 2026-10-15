const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  requestId: { type: String, required: true, unique: true },
  templateId: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });
module.exports = mongoose.model('VoucherDistribution', schema);
