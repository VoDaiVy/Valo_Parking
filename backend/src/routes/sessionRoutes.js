const express = require('express');
const router = express.Router();
const { authorizeParkingOperator } = require('../middlewares/kioskDeviceMiddleware');
const gate = (kind) => (req, res, next) => req.kioskDevice && req.kioskDevice.kind !== kind ? res.status(403).json({ success: false, message: 'Wrong kiosk gate' }) : next();
const sessionController = require('../controllers/sessionController');

const { protect, authorize } = require('../middlewares/authMiddleware');

// GET /api/sessions/active-status
router.get('/active-status', sessionController.getActiveParkingStatus);

// POST /api/sessions/verify-plate
router.post('/verify-plate', sessionController.verifyPlate);

// POST /api/sessions/verify-phone
router.post('/verify-phone', sessionController.verifyPhone);

// GET /api/sessions/check-full
router.get('/check-full', sessionController.checkParkingFull);

// POST /api/sessions/kiosk-verify-qr
router.post('/kiosk-verify-qr', authorizeParkingOperator, sessionController.kioskVerifyQr);

// POST /api/sessions/kiosk-entry
router.post('/kiosk-entry', authorizeParkingOperator, gate('entry'), sessionController.createKioskSession);

// GET /api/sessions/my-history
router.get('/my-history', protect, authorize('customer', 'admin'), sessionController.getMyHistory);

// GET /api/sessions
router.get('/', protect, authorize('staff', 'admin'), sessionController.getAllSessions);

// POST /api/sessions/kiosk-exit-scan
router.post('/kiosk-exit-scan', authorizeParkingOperator, gate('exit'), sessionController.kioskExitScan);

// POST /api/sessions/kiosk-checkout
router.post('/kiosk-checkout', authorizeParkingOperator, gate('exit'), sessionController.kioskCheckout);

// GET /api/sessions/check-payos/:orderCode
router.get('/check-payos/:orderCode', authorizeParkingOperator, gate('exit'), sessionController.checkPayosStatus);

// POST /api/sessions/:id/reassign-slot
router.post('/:id/reassign-slot', protect, authorize('staff', 'admin'), sessionController.reassignSlot);

module.exports = router;
