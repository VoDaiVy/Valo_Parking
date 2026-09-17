const express = require('express');
const router = express.Router();
const { scanPlate, scanRegistrationCard, getOccupancyForecast, resolveUnclearPlate } = require('../controllers/aiController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const aiBookingController = require('../controllers/aiBookingController');

router.post('/booking/interpret', protect, authorize('customer'), aiBookingController.interpret);

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

module.exports = router;
