const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');

const { protect, authorize } = require('../middlewares/authMiddleware');

// GET /api/sessions/active-status
router.get('/active-status', sessionController.getActiveParkingStatus);

// POST /api/sessions/verify-plate
router.post('/verify-plate', sessionController.verifyPlate);

// GET /api/sessions/check-full
router.get('/check-full', sessionController.checkParkingFull);

// POST /api/sessions/kiosk-verify-qr
router.post('/kiosk-verify-qr', sessionController.kioskVerifyQr);

// POST /api/sessions/kiosk-entry
router.post('/kiosk-entry', sessionController.createKioskSession);

// GET /api/sessions/my-history
router.get('/my-history', protect, authorize('customer', 'admin'), sessionController.getMyHistory);

// GET /api/sessions
router.get('/', protect, authorize('staff', 'admin'), sessionController.getAllSessions);

// POST /api/sessions/kiosk-exit-scan
router.post('/kiosk-exit-scan', sessionController.kioskExitScan);

// POST /api/sessions/kiosk-checkout
router.post('/kiosk-checkout', sessionController.kioskCheckout);

// GET /api/sessions/check-payos/:orderCode
router.get('/check-payos/:orderCode', sessionController.checkPayosStatus);

module.exports = router;
