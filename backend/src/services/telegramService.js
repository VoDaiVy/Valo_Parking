module.exports = {
  createGuestClaim: require('./telegramClaimService').createGuestClaim,
  enqueueBookingTicket: require('./telegramDeliveryService').enqueueBookingTicket,
};
