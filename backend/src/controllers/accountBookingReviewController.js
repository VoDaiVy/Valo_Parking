const mongoose = require('mongoose');
const User = require('../models/User');
const review = require('../services/accountBookingReview');

exports.list = async (req, res, next) => {
  try {
    const rows = await review.getBookingReviews();
    res.json({ success: true, data: rows });
  } catch (error) { next(error); }
};

exports.detail = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Customer not found.' });
    const user = await User.findOne({ _id: req.params.id, role: 'customer' }).select('bookingRestriction').lean();
    if (!user) return res.status(404).json({ success: false, message: 'Customer not found.' });
    const [activity] = await review.getBookingReviews(user._id);
    res.json({
      success: true, data: {
        ...(activity || {
          cancelledOrders: 0, nearCutoffOrders: 0, flagged: false,
          totalCancelledOrders: 0, totalNearCutoffOrders: 0, lastFlaggedAt: null, samples: [],
        }),
        restriction: user.bookingRestriction,
        days: review.REVIEW_DAYS, nearCutoffMinutes: review.NEAR_CUTOFF_MINUTES,
        nearCutoffThreshold: review.NEAR_CUTOFF_ORDERS, repeatedThreshold: review.REPEATED_CANCELLATIONS,
      },
    });
  } catch (error) { next(error); }
};

exports.setRestriction = async (req, res, next) => {
  try {
    const { blocked, reason } = req.body || {};
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Customer not found.' });
    if (typeof blocked !== 'boolean' || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
      return res.status(400).json({ success: false, message: 'Enter a reason of 1 to 500 characters.' });
    }
    const restriction = { blocked, reason: reason.trim(), changedAt: new Date(), changedBy: req.user._id };
    const user = await User.findOneAndUpdate({ _id: req.params.id, role: 'customer' },
      { $set: { bookingRestriction: restriction } }, { new: true, runValidators: true }).select('bookingRestriction').lean();
    if (!user) return res.status(404).json({ success: false, message: 'Customer not found.' });
    res.json({ success: true, data: user.bookingRestriction });
  } catch (error) { next(error); }
};
