const express = require('express');
const router = express.Router();
const {
  createNotification,
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteUserNotification,
  getAdminHistory,
  markAdminHistoryAsRead,
  markAllAdminHistoryAsRead,
  deleteAdminHistoryNotification,
  revokeNotification,
  getAutoRules,
  updateAutoRule,
  testAutoRule,
} = require('../controllers/notificationController');
const incidents = require('../controllers/staffIncidentController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  createNotificationValidator,
  queryNotificationValidator,
} = require('../validators/notificationValidator');

// All routes require authentication
router.use(protect);

// ── User routes (all authenticated users) ──
router.get('/', queryNotificationValidator, getUserNotifications);
router.get('/unread-count', getUnreadCount);
router.put('/read-all', markAllAsRead);
router.put('/:id/read', markAsRead);
router.delete('/:id', deleteUserNotification);

// ── Admin/Staff routes ──
router.post('/internal-report', authorize('staff'), incidents.create);
router.get('/internal-reports', authorize('staff', 'admin'), incidents.list);
router.get('/internal-reports/:id', authorize('staff', 'admin'), incidents.get);
router.patch('/internal-reports/:id', authorize('staff', 'admin'), incidents.update);
router.post('/', authorize('admin', 'staff'), createNotificationValidator, createNotification);
router.get('/admin/history', authorize('admin', 'staff'), queryNotificationValidator, getAdminHistory);
router.put('/admin/history/read-all', authorize('admin'), markAllAdminHistoryAsRead);
router.put('/admin/history/:id/read', authorize('admin'), markAdminHistoryAsRead);
router.delete('/admin/history/:id', authorize('admin'), deleteAdminHistoryNotification);
router.put('/:id/revoke', authorize('admin'), revokeNotification);

// ── Auto Rules routes (admin/staff) ──
router.get('/admin/rules', authorize('admin'), getAutoRules);
router.put('/admin/rules/:eventKey', authorize('admin'), updateAutoRule);
router.post('/admin/rules/:eventKey/test', authorize('admin'), testAutoRule);

module.exports = router;
