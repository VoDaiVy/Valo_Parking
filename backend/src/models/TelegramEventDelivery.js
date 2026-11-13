const mongoose = require('mongoose');
const LegacyDelivery = require('./TelegramDelivery');

// Older deployments consume every pending record in TelegramDelivery as a
// parking ticket. Keep new event types in a collection they cannot claim.
module.exports = mongoose.model('TelegramEventDelivery', LegacyDelivery.schema.clone());
