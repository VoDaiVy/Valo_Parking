const mongoose = require('mongoose');

// Each month and threshold has a shared document to serialize voucher issuance.
const schema = new mongoose.Schema({
  _id: String,
  version: { type: Number, default: 0 },
});

module.exports = mongoose.model('SpendRewardQuota', schema);
