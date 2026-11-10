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

const sendError = (res, error) => res.status(error.statusCode || 500).json({ success: false, message: error.statusCode === 403 ? 'You do not have permission to perform this action.' : error.statusCode === 404 ? 'The requested item was not found.' : error.statusCode === 409 ? 'The proposal is no longer pending or has expired.' : error.statusCode === 400 ? 'Check the provided values and try again.' : 'VALO AI is temporarily unavailable. Please try again.' });

const sendAdminError = (res, error) => res.status(error.statusCode || 500).json({ success: false, code: error.publicMessage ? error.code : undefined, draftStatus: error.draftStatus, message: error.publicMessage || (error.statusCode === 409 ? 'This proposal is no longer pending or has expired.' : error.statusCode === 403 ? 'You do not have permission to perform this action.' : error.statusCode === 404 ? 'The requested account or proposal was not found.' : error.statusCode === 400 ? 'Unable to process this request. Check the provided values and try again.' : 'VALO AI is temporarily unavailable. Please try again later.') });

// ---- ADMIN ROUTES ----
adminRouter.post('/chat', async (req, res) => {
  try { res.json({ success: true, data: await chat({ message: req.body.message, conversationId: req.body.conversationId, actorId: req.user._id, actorRole: 'admin', adminUserId: req.user._id }) }); }
  catch (error) { sendAdminError(res, error); }
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
    const unreadFilter = { ...filter, readBy: { $ne: userId } };
    if (req.query.filter === 'unread') filter.readBy = { $ne: userId };
    if (req.query.filter === 'warning') filter.severity = 'WARNING';
    if (req.query.filter === 'critical') filter.severity = 'CRITICAL';
    const [rows, total, unreadCount] = await Promise.all([
      AINotification.find(filter).sort({ detectedAt: -1 }).skip((page - 1) * limit).limit(limit).populate('resolvedBy', 'username').lean(),
      AINotification.countDocuments(filter),
      AINotification.countDocuments(unreadFilter),
    ]);
    res.json({ success: true, data: { notifications: rows.map((row) => ({ ...row, isRead: row.readBy?.some((id) => String(id) === String(userId)), isDismissed: false, readBy: undefined, dismissedBy: undefined })), total, unreadCount } });
  } catch (error) { sendAdminError(res, error); }
});
adminRouter.get('/notifications/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid notification or proposal ID.' });
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
    if (!item) return res.status(404).json({ success: false, message: 'Notification not found.' });
    res.json({ success: true, data: { ...item, isRead: item.readBy?.some((id) => String(id) === String(req.user._id)), readBy: undefined, dismissedBy: undefined } });
  } catch (error) { sendAdminError(res, error); }
});
adminRouter.patch('/notifications/:id/read', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid notification or proposal ID.' });
    const item = await AINotification.findOneAndUpdate({ _id: req.params.id, $or: [{ targetRoles: 'admin' }, { targetRoles: { $exists: false } }, { targetRoles: { $size: 0 } }] }, { $addToSet: { readBy: req.user._id } }, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Notification not found.' });
    res.json({ success: true });
  } catch (error) { sendAdminError(res, error); }
});
adminRouter.patch('/notifications/:id/dismiss', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid notification or proposal ID.' });
    const item = await AINotification.findOneAndUpdate({ _id: req.params.id, $or: [{ targetRoles: 'admin' }, { targetRoles: { $exists: false } }, { targetRoles: { $size: 0 } }] }, { $addToSet: { dismissedBy: req.user._id } }, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Notification not found.' });
    res.json({ success: true });
  } catch (error) { sendAdminError(res, error); }
});
adminRouter.post('/drafts/:id/approve', async (req, res) => {
  try { res.json({ success: true, data: await approveDraft(req.params.id, req.user._id, 'admin', req.app) }); }
  catch (error) {
    const diagnostics = { operation: 'APPROVE_DRAFT', stage: error.approvalStage || 'CHECK_PROPOSAL', errorName: error.name, code: error.code || 'APPROVAL_FAILED', httpStatus: error.statusCode || 500 };
    console.error('[VALO_AI_APPROVAL_FAILED]', JSON.stringify(diagnostics));
    await AIAuditLog.create({ actorId: req.user._id, action: 'DRAFT_EXECUTION_FAILED', subjectId: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined, errorCode: String(diagnostics.code), metadata: diagnostics }).catch(() => {});
    if (mongoose.isValidObjectId(req.params.id)) { const state = await AIDraft.findOne({ _id: req.params.id, adminUserId: req.user._id }).select('status').lean(); if (state) error.draftStatus = state.status; }
    sendAdminError(res, error);
  }
});
adminRouter.post('/drafts/:id/reject', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid notification or proposal ID.' });
    const draft = await AIDraft.findOneAndUpdate(
      { _id: req.params.id, adminUserId: req.user._id, status: 'PENDING' },
      { $set: { status: 'REJECTED', rejectedAt: new Date(), rejectedBy: req.user._id } },
      { new: true },
    );
    if (!draft) {
      const current = await AIDraft.findOne({ _id: req.params.id, adminUserId: req.user._id }).select('status').lean();
      if (current?.status === 'REJECTED') return res.json({ success: true, data: { status: 'REJECTED', alreadyRejected: true } });
      return res.status(current ? 409 : 404).json({ success: false, code: current?.status === 'EXECUTED' ? 'DRAFT_EXECUTED' : 'DRAFT_NOT_PENDING', draftStatus: current?.status, message: current?.status === 'EXECUTED' ? 'This proposal was already applied.' : current ? 'This proposal is already being processed.' : 'Proposal not found.' });
    }
    await AIAuditLog.create({ actorId: req.user._id, action: 'DRAFT_REJECTED', subjectId: draft._id, metadata: { type: draft.type } }).catch(() => console.warn('[VALO_AI] Rejection audit write failed'));
    res.json({ success: true, data: { status: 'REJECTED' } });
  } catch (error) { sendAdminError(res, error); }
});

// ---- STAFF ROUTES ----
staffRouter.post('/chat', async (req, res) => {
  try { res.json({ success: true, data: await chat({ message: req.body.message, conversationId: req.body.conversationId, actorId: req.user._id, actorRole: 'staff', adminUserId: req.user._id }) }); }
  catch (error) { sendError(res, error); }
});
staffRouter.get('/customers/search', async (req, res) => {
  try {
    const args = { ...req.query };
    if (args.status !== undefined) {
      if (!['true', 'false'].includes(args.status)) return res.status(400).json({ success: false, message: 'Invalid customer status.' });
      args.status = args.status === 'true';
    }
    const result = await require('../services/aiCopilot/toolRegistry').execute('search_users', args, 'staff', { actorId: req.user._id });
    res.json({ success: true, data: result.data });
  } catch (error) { sendError(res, error); }
});
staffRouter.get('/notifications', async (req, res) => {
  try {
    const userId = req.user._id;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const filter = { dismissedBy: { $ne: userId }, targetRoles: 'staff' };
    const unreadFilter = { ...filter, readBy: { $ne: userId } };
    if (req.query.filter === 'unread') filter.readBy = { $ne: userId };
    if (req.query.filter === 'warning') filter.severity = 'WARNING';
    if (req.query.filter === 'critical') filter.severity = 'CRITICAL';
    const [rows, total, unreadCount] = await Promise.all([
      AINotification.find(filter).sort({ detectedAt: -1 }).skip((page - 1) * limit).limit(limit).populate('resolvedBy', 'username').lean(),
      AINotification.countDocuments(filter),
      AINotification.countDocuments(unreadFilter),
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
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid identifier.' });
    const item = await AINotification.findOne({ _id: req.params.id, dismissedBy: { $ne: req.user._id }, targetRoles: 'staff' }).populate('resolvedBy', 'username').lean();
    if (!item) return res.status(404).json({ success: false, message: 'Notification not found.' });
    if (item.notificationType === 'FLOOR_FULL') item.targetRoute = '/staff/live-grid';
    res.json({ success: true, data: { ...item, isRead: item.readBy?.some((id) => String(id) === String(req.user._id)), readBy: undefined, dismissedBy: undefined } });
  } catch (error) { sendError(res, error); }
});
staffRouter.patch('/notifications/:id/read', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid identifier.' });
    const item = await AINotification.findOneAndUpdate({ _id: req.params.id, targetRoles: 'staff' }, { $addToSet: { readBy: req.user._id } }, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Notification not found.' });
    res.json({ success: true });
  } catch (error) { sendError(res, error); }
});
staffRouter.patch('/notifications/:id/dismiss', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid identifier.' });
    const item = await AINotification.findOneAndUpdate({ _id: req.params.id, targetRoles: 'staff' }, { $addToSet: { dismissedBy: req.user._id } }, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Notification not found.' });
    res.json({ success: true });
  } catch (error) { sendError(res, error); }
});
staffRouter.post('/drafts/:id/approve', async (req, res) => {
  try { res.json({ success: true, data: await approveDraft(req.params.id, req.user._id, 'staff', req.app) }); }
  catch (error) { sendError(res, error); }
});
staffRouter.post('/drafts/:id/reject', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid identifier.' });
    const draft = await AIDraft.findOneAndUpdate(
      { _id: req.params.id, adminUserId: req.user._id, status: 'PENDING', type: { $in: ['UPDATE_USER_STATUS', 'SEND_NOTIFICATION'] } },
      { $set: { status: 'REJECTED', rejectedAt: new Date(), rejectedBy: req.user._id } },
      { new: true },
    );
    if (!draft) return res.status(409).json({ success: false, message: 'The proposal is no longer pending.' });
    await AIAuditLog.create({ actorId: req.user._id, action: 'DRAFT_REJECTED', subjectId: draft._id, metadata: { type: draft.type } });
    res.json({ success: true });
  } catch (error) { sendError(res, error); }
});

router.use('/staff', protect, authorize('staff'), staffRouter);
router.use('/', protect, authorize('admin'), adminRouter);

module.exports = router;
