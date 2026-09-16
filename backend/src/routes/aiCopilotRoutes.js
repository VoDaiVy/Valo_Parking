const express = require('express');
const mongoose = require('mongoose');
const { protect, authorize } = require('../middlewares/authMiddleware');
const AINotification = require('../models/AINotification');
const AIDraft = require('../models/AIDraft');
const AIAuditLog = require('../models/AIAuditLog');
const { chat } = require('../services/aiCopilot/chatService');
const { approveDraft } = require('../services/aiCopilot/draftService');

const router = express.Router();
const adminRouter = express.Router();
const staffRouter = express.Router();

const sendError = (res, error) => res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'VALO AI đang tạm gián đoạn. Vui lòng thử lại.' });

// ---- ADMIN ROUTES ----
adminRouter.post('/chat', async (req, res) => {
  try { res.json({ success: true, data: await chat({ message: req.body.message, conversationId: req.body.conversationId, actorId: req.user._id, actorRole: 'admin', adminUserId: req.user._id }) }); }
  catch (error) { sendError(res, error); }
});
adminRouter.get('/notifications', async (req, res) => {
  try {
    const userId = req.user._id;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const filter = { 
      dismissedBy: { $ne: userId },
      $or: [
        { targetRoles: 'admin' },
        { targetRoles: { $exists: false } },
        { targetRoles: { $size: 0 } }
      ]
    };
    if (req.query.filter === 'unread') filter.readBy = { $ne: userId };
    if (req.query.filter === 'warning') filter.severity = 'WARNING';
    if (req.query.filter === 'critical') filter.severity = 'CRITICAL';
    const [rows, total, unreadCount] = await Promise.all([
      AINotification.find(filter).sort({ detectedAt: -1 }).skip((page - 1) * limit).limit(limit).populate('resolvedBy', 'username').lean(),
      AINotification.countDocuments(filter),
      AINotification.countDocuments({ ...filter, readBy: { $ne: userId } }),
    ]);
    res.json({ success: true, data: { notifications: rows.map((row) => ({ ...row, isRead: row.readBy?.some((id) => String(id) === String(userId)), isDismissed: false, readBy: undefined, dismissedBy: undefined })), total, unreadCount } });
  } catch (error) { sendError(res, error); }
});
adminRouter.get('/notifications/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
    const filter = { 
      _id: req.params.id, 
      dismissedBy: { $ne: req.user._id },
      $or: [
        { targetRoles: 'admin' },
        { targetRoles: { $exists: false } },
        { targetRoles: { $size: 0 } }
      ]
    };
    const item = await AINotification.findOne(filter).populate('resolvedBy', 'username').lean();
    if (!item) return res.status(404).json({ success: false, message: 'Không tìm thấy cảnh báo.' });
    res.json({ success: true, data: { ...item, isRead: item.readBy?.some((id) => String(id) === String(req.user._id)), readBy: undefined, dismissedBy: undefined } });
  } catch (error) { sendError(res, error); }
});
adminRouter.patch('/notifications/:id/read', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
    const item = await AINotification.findOneAndUpdate({ _id: req.params.id, $or: [{ targetRoles: 'admin' }, { targetRoles: { $exists: false } }, { targetRoles: { $size: 0 } }] }, { $addToSet: { readBy: req.user._id } }, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Không tìm thấy cảnh báo.' });
    res.json({ success: true });
  } catch (error) { sendError(res, error); }
});
adminRouter.patch('/notifications/:id/dismiss', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
    const item = await AINotification.findOneAndUpdate({ _id: req.params.id, $or: [{ targetRoles: 'admin' }, { targetRoles: { $exists: false } }, { targetRoles: { $size: 0 } }] }, { $addToSet: { dismissedBy: req.user._id } }, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Không tìm thấy cảnh báo.' });
    res.json({ success: true });
  } catch (error) { sendError(res, error); }
});
adminRouter.post('/drafts/:id/approve', async (req, res) => {
  try { res.json({ success: true, data: await approveDraft(req.params.id, req.user._id, 'admin', req.app) }); }
  catch (error) { sendError(res, error); }
});
adminRouter.post('/drafts/:id/reject', async (req, res) => {
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

// ---- STAFF ROUTES ----
staffRouter.post('/chat', async (req, res) => {
  try { res.json({ success: true, data: await chat({ message: req.body.message, conversationId: req.body.conversationId, actorId: req.user._id, actorRole: 'staff', adminUserId: req.user._id }) }); }
  catch (error) { sendError(res, error); }
});
staffRouter.get('/notifications', async (req, res) => {
  try {
    const userId = req.user._id;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const filter = { dismissedBy: { $ne: userId }, targetRoles: 'staff' };
    if (req.query.filter === 'unread') filter.readBy = { $ne: userId };
    if (req.query.filter === 'warning') filter.severity = 'WARNING';
    if (req.query.filter === 'critical') filter.severity = 'CRITICAL';
    const [rows, total, unreadCount] = await Promise.all([
      AINotification.find(filter).sort({ detectedAt: -1 }).skip((page - 1) * limit).limit(limit).populate('resolvedBy', 'username').lean(),
      AINotification.countDocuments(filter),
      AINotification.countDocuments({ ...filter, readBy: { $ne: userId } }),
    ]);
    const notifications = rows.map((row) => {
      const n = { ...row, isRead: row.readBy?.some((id) => String(id) === String(userId)), isDismissed: false, readBy: undefined, dismissedBy: undefined };
      if (n.notificationType === 'FLOOR_FULL') n.targetRoute = '/staff/live-grid';
      return n;
    });
    res.json({ success: true, data: { notifications, total, unreadCount } });
  } catch (error) { sendError(res, error); }
});
staffRouter.get('/notifications/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
    const item = await AINotification.findOne({ _id: req.params.id, dismissedBy: { $ne: req.user._id }, targetRoles: 'staff' }).populate('resolvedBy', 'username').lean();
    if (!item) return res.status(404).json({ success: false, message: 'Không tìm thấy cảnh báo.' });
    if (item.notificationType === 'FLOOR_FULL') item.targetRoute = '/staff/live-grid';
    res.json({ success: true, data: { ...item, isRead: item.readBy?.some((id) => String(id) === String(req.user._id)), readBy: undefined, dismissedBy: undefined } });
  } catch (error) { sendError(res, error); }
});
staffRouter.patch('/notifications/:id/read', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
    const item = await AINotification.findOneAndUpdate({ _id: req.params.id, targetRoles: 'staff' }, { $addToSet: { readBy: req.user._id } }, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Không tìm thấy cảnh báo.' });
    res.json({ success: true });
  } catch (error) { sendError(res, error); }
});
staffRouter.patch('/notifications/:id/dismiss', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
    const item = await AINotification.findOneAndUpdate({ _id: req.params.id, targetRoles: 'staff' }, { $addToSet: { dismissedBy: req.user._id } }, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Không tìm thấy cảnh báo.' });
    res.json({ success: true });
  } catch (error) { sendError(res, error); }
});
staffRouter.post('/drafts/:id/approve', async (req, res) => {
  try { res.json({ success: true, data: await approveDraft(req.params.id, req.user._id, 'staff', req.app) }); }
  catch (error) { sendError(res, error); }
});
staffRouter.post('/drafts/:id/reject', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'ID không hợp lệ.' });
    const draft = await AIDraft.findOneAndUpdate(
      { _id: req.params.id, adminUserId: req.user._id, status: 'PENDING', type: { $in: ['UPDATE_USER_STATUS', 'SEND_NOTIFICATION'] } },
      { $set: { status: 'REJECTED', rejectedAt: new Date(), rejectedBy: req.user._id } },
      { new: true },
    );
    if (!draft) return res.status(409).json({ success: false, message: 'Bản nháp không còn chờ duyệt.' });
    await AIAuditLog.create({ actorId: req.user._id, action: 'DRAFT_REJECTED', subjectId: draft._id, metadata: { type: draft.type } });
    res.json({ success: true });
  } catch (error) { sendError(res, error); }
});

router.use('/staff', protect, authorize('staff'), staffRouter);
router.use('/', protect, authorize('admin'), adminRouter);

module.exports = router;
