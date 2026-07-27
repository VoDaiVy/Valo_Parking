const express = require('express');
const router = express.Router();
const {
  getWallet,
  createTopUp,
  getTopUpStatus,
  handleWebhook,
  getTransactions,
} = require('../controllers/walletController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { topUpValidator, transactionQueryValidator } = require('../validators/walletValidator');

// Public route - payOS webhook (must be before auth middleware)
router.post('/webhook', handleWebhook);

// Protected routes - Customer only
router.use(protect);
router.use(authorize('customer'));

router.get('/', getWallet);
router.post('/top-up', topUpValidator, createTopUp);
router.get('/top-up/:orderCode/status', getTopUpStatus);
router.get('/transactions', transactionQueryValidator, getTransactions);

module.exports = router;
