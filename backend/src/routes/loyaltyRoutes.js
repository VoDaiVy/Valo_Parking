const express = require('express');
const loyaltyController = require('../controllers/loyaltyController');
const { protect, authorize } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect, authorize('customer'));
const retiredPoints = (_req, res) => res.status(410).json({ success: false, message: 'Points redemption has been retired. Vouchers are now issued automatically or by an administrator.' });
router.get('/account', retiredPoints);
router.get('/templates', retiredPoints);
router.post('/redeem', retiredPoints);
router.get('/spending', require('../controllers/spendRewardController').getProgress);
router.get('/vouchers', loyaltyController.getVouchers);

module.exports = router;
