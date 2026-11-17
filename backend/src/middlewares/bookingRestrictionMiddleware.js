module.exports = function requireBookingAccess(req, res, next) {
  if (req.user?.role === 'customer' && req.user.bookingRestriction?.blocked === true) {
    return res.status(403).json({
      success: false, code: 'ACCOUNT_BOOKING_RESTRICTED',
      message: 'New bookings are restricted for this account. Please contact support.',
    });
  }
  return next();
};
