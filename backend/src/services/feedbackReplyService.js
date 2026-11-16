const mongoose = require('mongoose');
const Feedback = require('../models/BookingFeedback');
const Booking = require('../models/Booking');
const User = require('../models/User');
const notificationService = require('./notificationService');
const { assertId } = require('./feedbackService');
const { fail, validateReply } = require('../validators/feedbackValidator');

async function replyToFeedback(id, adminId, body) {
  assertId(id);
  const { content, expectedRevision } = validateReply(body);
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const existing = await Feedback.findById(id).session(session);
      if (!existing) fail('Feedback not found.', 404);
      // Account deletion already removes bookings. Retain the feedback audit,
      // but do not create a response whose recipient or destination is gone.
      const recipient = await User.exists({ _id: existing.userId }).session(session);
      const booking = await Booking.exists({ _id: existing.bookingId }).session(session);
      if (!recipient || !booking) fail('The customer or booking is no longer available. This feedback is read-only.');
      if (existing.replyRevision !== expectedRevision) fail('Another admin updated this reply. Reload before saving.', 409);
      if (expectedRevision >= 51) fail('The reply has reached the limit of 50 edits.');
      const now = new Date();
      const reply = { content, repliedBy: adminId, repliedAt: existing.reply?.repliedAt || now, updatedAt: now };
      const feedback = await Feedback.findOneAndUpdate({ _id: id, replyRevision: expectedRevision }, {
        $set: { reply }, $inc: { replyRevision: 1 },
        $push: { replyHistory: { revision: expectedRevision + 1, content, changedBy: adminId, changedAt: now } },
      }, { new: true, runValidators: true, session });
      if (!feedback) fail('Another admin updated this reply. Reload before saving.', 409);
      let notification = null;
      if (expectedRevision === 0) {
        notification = await notificationService.createForUser(existing.userId, {
          title: 'Valo Parking replied to your feedback',
          content: 'Your booking feedback has a new reply. Open your booking to view it.',
          type: 'BOOKING', priority: 'INFO',
          metadata: { eventType: 'BOOKING_FEEDBACK_REPLIED', bookingId: String(existing.bookingId), feedbackId: String(existing._id) },
        }, adminId, { session });
      }
      return { feedback, notification };
    });
  } finally {
    await session.endSession();
  }
}
module.exports = { replyToFeedback };
