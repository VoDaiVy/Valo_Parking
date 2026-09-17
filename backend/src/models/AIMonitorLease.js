const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  _id: { type: String, default: 'primary' },
  owner: String,
  until: Date,
  startedAt: Date,
  cursorAt: Date,
});
module.exports = mongoose.model('AIMonitorLease', schema);
