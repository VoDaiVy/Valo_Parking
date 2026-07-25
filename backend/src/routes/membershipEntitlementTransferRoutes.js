const express = require('express');
const { body, param, query } = require('express-validator');
const { protect, authorize } = require('../middlewares/authMiddleware');
const controller = require('../controllers/membershipEntitlementTransferController');

const router = express.Router();
router.use(protect);

const transferId = param('id').isMongoId().withMessage('Invalid transfer ID');
const entitlementId = param('entitlementId')
  .isMongoId()
  .withMessage('Invalid entitlement ID');
const reason = body('reason').isString().trim().isLength({ min: 3, max: 500 });

router.post(
  '/customer/membership-entitlements/:entitlementId/transfers',
  authorize('customer'),
  entitlementId,
  body('mode').optional().isIn(['DIRECT', 'PUBLIC']),
  body('toUserId').optional().isMongoId(),
  body('toUserEmail').optional().isEmail().normalizeEmail(),
  body().custom((value) => {
    const mode = String(value.mode || 'DIRECT').toUpperCase();
    if (mode === 'DIRECT' && !value.toUserId && !value.toUserEmail) {
      throw new Error('Recipient user ID or email is required');
    }
    if (mode === 'PUBLIC' && (value.toUserId || value.toUserEmail)) {
      throw new Error('Public listings cannot target a recipient');
    }
    return true;
  }),
  body('askingPrice').isInt({ min: 0 }),
  reason,
  controller.create
);
router.get(
  '/customer/membership-transfer-recipients',
  authorize('customer'),
  query('q').optional().isString().trim().isLength({ max: 100 }),
  query('limit').optional().isInt({ min: 1, max: 20 }),
  controller.searchRecipients
);
router.get(
  '/customer/membership-transfer-marketplace',
  authorize('customer'),
  query('parkingLotId').optional().isMongoId(),
  query('floorId').optional().isMongoId(),
  query('minPrice').optional().isInt({ min: 0 }),
  query('maxPrice').optional().isInt({ min: 0 }),
  query('minRemainingDays').optional().isInt({ min: 0 }),
  query('sort').optional().isIn(['newest', 'price_asc', 'expiry_asc']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  controller.listMarketplace
);
router.get(
  '/customer/membership-transfer-marketplace/:id',
  authorize('customer'),
  transferId,
  controller.marketplaceDetail
);
router.post(
  '/customer/membership-transfer-marketplace/:id/claim',
  authorize('customer'),
  transferId,
  controller.claimMarketplace
);
router.get(
  '/customer/membership-entitlement-transfers',
  authorize('customer'),
  controller.listMine
);
router.put(
  '/customer/membership-entitlement-transfers/:id/cancel',
  authorize('customer'),
  transferId,
  body('reason').optional().isString().trim().isLength({ max: 500 }),
  controller.cancel
);
router.put(
  '/customer/membership-entitlement-transfers/:id/accept',
  authorize('customer'),
  transferId,
  controller.accept
);
router.put(
  '/customer/membership-entitlement-transfers/:id/reject',
  authorize('customer'),
  transferId,
  body('reason').optional().isString().trim().isLength({ max: 500 }),
  controller.reject
);
router.post(
  '/customer/membership-entitlement-transfers/:id/settle-wallet',
  authorize('customer'),
  transferId,
  controller.settle
);
router.get(
  '/membership-entitlement-transfers/:id/pdf',
  transferId,
  controller.pdf
);
router.get(
  '/admin/membership-entitlement-transfers',
  authorize('admin'),
  controller.listAdmin
);
router.put(
  '/admin/membership-entitlement-transfers/:id/approve',
  authorize('admin'),
  transferId,
  controller.approve
);
router.put(
  '/admin/membership-entitlement-transfers/:id/reject',
  authorize('admin'),
  transferId,
  reason,
  controller.adminReject
);

module.exports = router;
