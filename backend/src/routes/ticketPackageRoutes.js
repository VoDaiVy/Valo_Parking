const express = require('express');
const router = express.Router();
const ticketPackageController = require('../controllers/ticketPackageController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// Public/Customer/Kiosk routes
router.get('/active', ticketPackageController.getActivePackages);

// Staff console routes
router.use(protect, authorize('staff', 'admin'));
router.get('/', ticketPackageController.getAllPackages);
router.get('/:id', ticketPackageController.getPackageById);

// Package management is reserved for administrators.
router.post('/', authorize('admin'), ticketPackageController.createPackage);
router.put('/:id', authorize('admin'), ticketPackageController.updatePackage);
router.delete('/:id', authorize('admin'), ticketPackageController.deletePackage);

module.exports = router;
