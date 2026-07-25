const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { protect, authorize, softProtect } = require('../middlewares/authMiddleware');
const { requirePolicyAcceptance } = require('../middlewares/policyAcceptanceMiddleware');

// Route public dành cho webhook PayOS thanh toán đặt chỗ
router.post('/webhook', bookingController.handleBookingWebhook);

// Gợi ý ô đỗ thông minh
router.get('/suggest-slot', bookingController.suggestSmartSlot);

// Khóa ô đỗ tạm thời (Guest & User)
router.get('/pricing-config', softProtect, bookingController.getPricingConfig);
router.get('/active-holds', softProtect, bookingController.getActiveHolds);
router.post('/hold', softProtect, bookingController.createBookingHold);
router.delete('/holds/:holdId', softProtect, bookingController.releaseBookingHold);

// Route cho Staff/Admin xem toàn bộ booking
router.get('/active-for-map', protect, authorize('staff', 'admin'), bookingController.getActiveMapBookings);
router.get('/all', protect, authorize('staff', 'admin'), bookingController.getAllBookings);
router.get(
  '/available-slots',
  protect,
  authorize('customer', 'staff', 'admin'),
  bookingController.getAvailableSlots
);

// Các route yêu cầu khách hàng đã đăng nhập
router.use(protect);
router.use(authorize('customer', 'admin'));

router.get('/my', bookingController.getMyBookings);
router.get('/my-history', bookingController.getMyBookings);
router.get('/:id/qr', bookingController.getBookingQr);
router.post('/', requirePolicyAcceptance({ action: 'booking:create' }), bookingController.createBooking);
router.post('/bulk', requirePolicyAcceptance({ action: 'booking:create' }), bookingController.createBulkBooking);
router.post('/bulk/quote', bookingController.quoteBulkBooking);
router.get('/status/:orderCode', bookingController.checkVietQRStatus);
router.post('/:id/cancel', bookingController.cancelBooking);
router.put('/:id/time', bookingController.modifyBookingTime);
router.put('/:id/vehicle', bookingController.updateBookingVehicle);
router.post('/:id/check-in', bookingController.checkInBooking);
router.post('/:id/check-out', bookingController.checkOutBooking);

module.exports = router;
