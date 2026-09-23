const express = require('express');
const router = express.Router();
const {
  scanPlate,
  scanRegistrationCard,
  getOccupancyForecast,
  resolveUnclearPlate,
  scanParkingSlots,
  autoDetectSlotGrid,
} = require('../controllers/aiController');
const { protect } = require('../middlewares/authMiddleware');

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
router.post('/scan-slots', scanParkingSlots);

// @route   POST /api/ai/auto-detect-grid
// @desc    Auto-detect diorama grid ROI coordinates for parking slots
// @access  Public / Staff
router.post('/auto-detect-grid', autoDetectSlotGrid);

module.exports = router;

