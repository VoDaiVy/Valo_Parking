const express = require('express');
const router = express.Router();
const {
  scanPlate,
  scanRegistrationCard,
  getOccupancyForecast,
  resolveUnclearPlate,
  scanParkingSlots,
  autoDetectSlotGrid,
  downloadArucoMarkersSheet,
  getViolationLogs,
  getViolationLogEvidence,
  getSlotLogs,
  resolveViolation,
  clearAllViolations,
  getDriverContactInfo,
  sendViolationEmail,
} = require('../controllers/aiController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const aiBookingController = require('../controllers/aiBookingController');

router.post('/booking/interpret', protect, authorize('customer'), aiBookingController.interpret);
router.get('/booking/sessions/latest', protect, authorize('customer'), aiBookingController.getLatestSession);
router.get('/booking/sessions/:sessionId', protect, authorize('customer'), aiBookingController.getSession);
router.post('/booking/sessions', protect, authorize('customer'), aiBookingController.createSession);
router.post('/booking/sessions/:sessionId/messages', protect, authorize('customer'), aiBookingController.appendMessages);
router.put('/booking/sessions/:sessionId', protect, authorize('customer'), aiBookingController.updateSession);
router.post('/booking/sessions/:sessionId/complete', protect, authorize('customer'), aiBookingController.completeSession);
router.delete('/booking/sessions/:sessionId', protect, authorize('customer'), aiBookingController.discardSession);

// @route   POST /api/ai/scan-plate
// @desc    Scan license plate from base64 image using PlateRecognizer
// @access  Public
router.post('/scan-plate', scanPlate);

// @route   POST /api/ai/scan-registration-card
// @desc    Scan vehicle registration card and extract vehicle info using Gemini Vision
// @access  Private
router.post('/scan-registration-card', protect, scanRegistrationCard);

// @route   GET /api/ai/occupancy-forecast
// @desc    Get 24h occupancy & busyness forecast for a specific date/hour
// @access  Public
router.get('/occupancy-forecast', getOccupancyForecast);

// @route   POST /api/ai/resolve-unclear-plate
// @desc    Resolve blurred / damaged license plate with AI Fuzzy matching and Gemini Vision
// @access  Public
router.post('/resolve-unclear-plate', resolveUnclearPlate);

// @route   POST /api/ai/scan-slots
// @desc    Scan parking slots status & plates from live camera ROI
// @access  Public / Staff
router.post('/scan-slots', protect, authorize('staff', 'admin'), scanParkingSlots);

// @route   POST /api/ai/auto-detect-grid
// @desc    Auto-detect diorama grid ROI coordinates for parking slots
// @access  Public / Staff
router.post('/auto-detect-grid', protect, authorize('staff', 'admin'), autoDetectSlotGrid);

// @route   GET /api/ai/aruco-markers-sheet
// @desc    Download printable 4-corner ArUco marker sheet (IDs 0-3)
// @access  Public / Staff
router.get('/aruco-markers-sheet', protect, authorize('staff', 'admin'), downloadArucoMarkersSheet);

// @route   GET /api/ai/violation-logs
// @desc    Get global parking lot violation logs
// @access  Public / Staff
router.get('/violation-logs', protect, authorize('staff', 'admin'), getViolationLogs);

// @route   GET /api/ai/violation-logs/:id/evidence
// @desc    Lazy-load snapshot images for a single violation log
// @access  Staff / Admin
router.get('/violation-logs/:id/evidence', protect, authorize('staff', 'admin'), getViolationLogEvidence);

// @route   GET /api/ai/slot-logs/:slotCode
// @desc    Get history logs for a specific parking slot
// @access  Public / Staff
router.get('/slot-logs/:slotCode', protect, authorize('staff', 'admin'), getSlotLogs);

// @route   POST /api/ai/resolve-violation
// @desc    Resolve slot violation (reassign or warning)
// @access  Public / Staff
router.post('/resolve-violation', protect, authorize('staff', 'admin'), resolveViolation);

// @route   POST /api/ai/clear-all-violations
// @desc    Clear/reset all active slot violations and pending audit logs (for clean testing)
// @access  Public / Staff
router.post('/clear-all-violations', protect, authorize('admin'), clearAllViolations);

// @route   GET /api/ai/driver-contact
// @desc    Get phone/email of offending vehicle driver and VIP owner info
// @access  Public / Staff
router.get('/driver-contact', protect, authorize('staff', 'admin'), getDriverContactInfo);

// @route   POST /api/ai/send-warning-email
// @desc    Send urgent violation warning email to vehicle driver
// @access  Public / Staff
router.post('/send-warning-email', protect, authorize('staff', 'admin'), sendViolationEmail);

module.exports = router;
