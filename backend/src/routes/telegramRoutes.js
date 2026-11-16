const express = require('express');
const { protect } = require('../middlewares/authMiddleware');
const controller = require('../controllers/telegramController');
const router = express.Router();
router.get('/capabilities', (req, res) => res.json({ success: true, data: {
  phoneReceiptsEnabled: require('../services/telegramReceiptService').enabled(),
  accountReceiptsEnabled: require('../services/telegramClient').enabled(),
} }));
router.post('/webhook', controller.webhook);
const { authorizeParkingOperator } = require('../middlewares/kioskDeviceMiddleware');
router.post('/receipts/status', authorizeParkingOperator, controller.receiptStatus);
router.post('/receipts/claim', authorizeParkingOperator, controller.receiptClaim);
router.post('/receipts/retry', authorizeParkingOperator, controller.receiptRetry);
router.use(protect);
router.get('/bookings/:bookingId/receipt', controller.bookingReceipt);
router.get('/link', controller.getLink);
router.get('/status', controller.getLink);
router.post('/link-token', controller.createLinkToken);
router.patch('/preferences', controller.preferences);
router.delete('/link', controller.unlink);
module.exports = router;
