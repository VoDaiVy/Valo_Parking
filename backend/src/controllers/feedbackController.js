const service = require('../services/feedbackService');
const { replyToFeedback } = require('../services/feedbackReplyService');

const handler = (callback, status = 200) => async (req, res, next) => {
  try { res.status(status).json({ success: true, data: await callback(req) }); }
  catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    next(error);
  }
};
exports.create = handler(req => service.createFeedback(req.params.id, req.user._id, req.body), 201);
exports.get = handler(req => service.getFeedback(req.params.id, req.user._id));
exports.list = handler(req => service.listFeedbacks(req.query));
exports.stats = handler(req => service.getStats(req.query));
exports.detail = handler(req => service.getAdminFeedback(req.params.id));
exports.publicList = handler(() => service.listPublicFeedbacks());
exports.publication = handler(req => service.setPublication(req.params.id, req.body));
exports.reply = handler(async req => {
  const { feedback, notification } = await replyToFeedback(req.params.id, req.user._id, req.body);
  if (notification) {
    try {
      const { emitNotification } = require('../sockets/notificationSocket');
      const io = req.app.get('io');
      if (io) await emitNotification(io, feedback.userId, notification, { notifyAdmins: false, includeAudience: false });
    } catch (error) {
      console.error('[Feedback] Notification delivery failed after commit', { feedbackId: String(feedback._id), revision: feedback.replyRevision, message: error.message });
    }
  }
  return service.getAdminFeedback(String(feedback._id));
});
