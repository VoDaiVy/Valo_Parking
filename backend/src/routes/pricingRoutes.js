const express = require('express');
const pricingController = require('../controllers/pricingController');
const { protect, authorize } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/current', pricingController.getCurrentPricing);

router.use(protect, authorize('admin'));
router.get('/config', pricingController.getConfig);
router.put('/config', pricingController.updateConfig);
router.get('/rules', pricingController.getRules);
router.post('/rules', pricingController.createRule);
router.put('/rules/:id', pricingController.updateRule);
router.delete('/rules/:id', pricingController.deleteRule);
router.get('/suggestions', pricingController.getSuggestions);
router.post('/suggestions/:id/approve', pricingController.approveSuggestion);
router.post('/suggestions/:id/reject', pricingController.rejectSuggestion);
router.get('/history', pricingController.getHistory);
router.get('/stats', pricingController.getStats);

module.exports = router;
