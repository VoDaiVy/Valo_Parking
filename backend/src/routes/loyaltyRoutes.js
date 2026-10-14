const express = require('express');
const loyaltyController = require('../controllers/loyaltyController');
const { protect, authorize } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect, authorize('customer'));
router.get('/account', loyaltyController.getAccount);
router.get('/templates', loyaltyController.listTemplates);
router.post('/redeem', loyaltyController.redeemVoucher);
router.get('/vouchers', loyaltyController.getVouchers);

module.exports = router;
