const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { requirePolicyAcceptance } = require('../middlewares/policyAcceptanceMiddleware');
const renewalController = require('../controllers/subscriptionRenewalController');
const entitlementRenewalController = require('../controllers/membershipEntitlementRenewalController');
const membershipDetailsController = require('../controllers/membershipDetailsController');
const { body, param, query } = require('express-validator');
const {
  subscriptionIdValidator,
  renewalPaymentValidator,
  renewalVerifyValidator,
} = require('../validators/subscriptionValidator');
const { isEnabled, defaultForCurrentEnvironment } = require('../utils/featureFlags');

const renewalEnabled = (req, res, next) => {
  if (!isEnabled('SUBSCRIPTION_RENEWAL_ENABLED', defaultForCurrentEnvironment())) {
    return res.status(404).json({ success: false, message: 'Renewal is not enabled.' });
  }
  next();
};

router.use(protect);

router.get('/membership/history', authorize('customer'),
  query('page').optional().isInt({ min: 1, max: 10000 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('filter').optional().isIn(['all', 'renewals', 'payments', 'notifications']),
  require('../controllers/membershipActivityController').history);

const historyQuery = [query('page').optional().isInt({ min: 1, max: 10000 }), query('limit').optional().isInt({ min: 1, max: 50 })];
router.get('/entitlements/:entitlementId/renewals', authorize('customer'), param('entitlementId').isMongoId(), historyQuery, membershipDetailsController.history);
router.get('/:subscriptionId/renewals', authorize('customer'), param('subscriptionId').isMongoId(), historyQuery, membershipDetailsController.history);
router.get('/entitlements/:entitlementId/details', authorize('customer'), param('entitlementId').isMongoId(), membershipDetailsController.detail);
router.get('/:subscriptionId/details', authorize('customer'), param('subscriptionId').isMongoId(), membershipDetailsController.detail);

router.get('/membership', subscriptionController.getMembership);
router.get('/membership/qr', subscriptionController.getAccountMembershipQr);
router.post(
  '/entitlements/renew/verify-payment',
  renewalEnabled,
  renewalVerifyValidator,
  entitlementRenewalController.verifyPayment
);
router.post(
  '/entitlements/:entitlementId/renew/quote',
  renewalEnabled,
  param('entitlementId').isMongoId(),
  entitlementRenewalController.getQuote
);
router.post(
  '/entitlements/:entitlementId/renew/pay-with-wallet',
  renewalEnabled,
  requirePolicyAcceptance({ action: 'membership-entitlement:renew-wallet' }),
  param('entitlementId').isMongoId(),
  body('idempotencyKey').isString().trim().isLength({ min: 16, max: 128 }),
  entitlementRenewalController.payWithWallet
);
router.post(
  '/entitlements/:entitlementId/renew/create-payment',
  renewalEnabled,
  requirePolicyAcceptance({ action: 'membership-entitlement:renew-payment' }),
  param('entitlementId').isMongoId(),
  body('idempotencyKey').isString().trim().isLength({ min: 16, max: 128 }),
  entitlementRenewalController.createPayment
);
router.get('/:subscriptionId/qr', subscriptionIdValidator, subscriptionController.getMembershipQr);
router.post(
  '/renew/verify-payment',
  renewalEnabled,
  renewalVerifyValidator,
  renewalController.verifyPayosPayment
);
router.post(
  '/:subscriptionId/renew/quote',
  renewalEnabled,
  subscriptionIdValidator,
  renewalController.getQuote
);
router.post(
  '/:subscriptionId/renew/pay-with-wallet',
  renewalEnabled,
  requirePolicyAcceptance({ action: 'subscription:renew-wallet' }),
  renewalPaymentValidator,
  renewalController.payWithWallet
);
router.post(
  '/:subscriptionId/renew/create-payment',
  renewalEnabled,
  requirePolicyAcceptance({ action: 'subscription:renew-payment' }),
  renewalPaymentValidator,
  renewalController.createPayosPayment
);
router.post('/payment', requirePolicyAcceptance({ action: 'subscription:create-payment' }), subscriptionController.createSubscriptionPayment);
router.post('/create-payment', requirePolicyAcceptance({ action: 'subscription:create-payment' }), subscriptionController.createSubscriptionPayment);
router.post('/verify-payment', subscriptionController.verifyPayment);
router.post('/pay-with-wallet', requirePolicyAcceptance({ action: 'subscription:pay-with-wallet' }), subscriptionController.paySubscriptionWithWallet);
router.post('/renew', requirePolicyAcceptance({ action: 'subscription:renew' }), subscriptionController.renewSubscription);
// Admin route to get all subscriptions
router.get('/all', authorize('admin', 'staff'), subscriptionController.getAllSubscriptions);
module.exports = router;
