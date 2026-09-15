const express = require('express');
const mongoose = require('mongoose');
const { protect, authorize } = require('../middlewares/authMiddleware');
const AINotification = require('../models/AINotification');
const AIDraft = require('../models/AIDraft');
const AIAuditLog = require('../models/AIAuditLog');
const { chat } = require('../services/aiCopilot/chatService');
const { approveDraft } = require('../services/aiCopilot/draftService');
const router = express.Router();
router.use(protect, authorize('admin'));
const sendError = (res, error) => res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'VALO AI đang tạm gián đoạn. Vui lòng thử lại.' });

router.post('/chat', async (req, res) => {
  try { res.json({ success: true, data: await chat({ message: req.body.message, conversationId: req.body.conversationId, adminUserId: req.user._id }) }); }
  catch (error) { sendError(res, error); }
});
router.get('/notifications', async (req, res) => {
  try {
    const userId = req.user._id;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const filter = { dismissedBy: { $ne: userId } };
    if (req.query.filter === 'unread') filter.readBy = { $ne: userId };
    if (req.query.filter === 'warning') filter.severity = 'WARNING';
    if (req.query.filter === 'critical') filter.severity = 'CRITICAL';
    const [rows, total, unreadCount] = await Promise.all([
      AINotification.find(filter).sort({ detectedAt: -1 }).skip((page - 1) * limit).limit(limit).populate('resolvedBy', 'username').lean(),
      AINotification.countDocuments(filter),
      AINotification.countDocuments({ readBy: { $ne: userId }, dismissedBy: { $ne: userId } }),
    ]);
    res.json({ success: true, data: { notifications: rows.map((row) => ({ ...row, isRead: row.readBy?.some((id) => String(id) === String(userId)), isDismissed: false, readBy: undefined, dismissedBy: undefined })), total, unreadCount } });
  } catch (error) { sendError(res, error); }
});
router.get('/notifications/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
    const item = await AINotification.findOne({ _id: req.params.id, dismissedBy: { $ne: req.user._id } }).populate('resolvedBy', 'username').lean();
    if (!item) return res.status(404).json({ success: false, message: 'Không tìm thấy cảnh báo.' });
    res.json({ success: true, data: { ...item, isRead: item.readBy?.some((id) => String(id) === String(req.user._id)), readBy: undefined, dismissedBy: undefined } });
  } catch (error) { sendError(res, error); }
});
router.patch('/notifications/:id/read', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
    const item = await AINotification.findByIdAndUpdate(req.params.id, { $addToSet: { readBy: req.user._id } }, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Không tìm thấy cảnh báo.' });
    res.json({ success: true });
  } catch (error) { sendError(res, error); }
});
router.patch('/notifications/:id/dismiss', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
    const item = await AINotification.findByIdAndUpdate(req.params.id, { $addToSet: { dismissedBy: req.user._id } }, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Không tìm thấy cảnh báo.' });
    res.json({ success: true });
  } catch (error) { sendError(res, error); }
});
router.post('/drafts/:id/approve', async (req, res) => {
  try { res.json({ success: true, data: await approveDraft(req.params.id, req.user._id) }); }
  catch (error) { sendError(res, error); }
});
router.post('/drafts/:id/reject', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
    const draft = await AIDraft.findOneAndUpdate(
      { _id: req.params.id, adminUserId: req.user._id, status: 'PENDING' },
      { $set: { status: 'REJECTED', rejectedAt: new Date(), rejectedBy: req.user._id } },
      { new: true },
    );
    if (!draft) return res.status(409).json({ success: false, message: 'Bản nháp không còn chờ duyệt.' });
    await AIAuditLog.create({ actorId: req.user._id, action: 'DRAFT_REJECTED', subjectId: draft._id, metadata: { type: draft.type } });
    res.json({ success: true });
  } catch (error) { sendError(res, error); }
});
module.exports = router;
