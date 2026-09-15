const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  _id: { type: String, default: 'primary' },
  owner: String,
  until: Date,
});
module.exports = mongoose.model('AIMonitorLease', schema);
