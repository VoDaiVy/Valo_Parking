const router = require('express').Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const service = require('../services/membershipServiceBenefitService');
const selection = require('../services/membershipServiceSelectionService');

router.use(protect, authorize('customer', 'staff', 'admin'));
router.get('/sessions/:id/benefits', authorize('customer'), async (req, res, next) => {
  try { res.json({ success: true, data: await selection.benefits(req.params.id, req.user._id) }); } catch (error) { next(error); }
});
router.put('/sessions/:id/selection', authorize('customer'), async (req, res, next) => {
  try { res.json({ success: true, data: await selection.select(req.user._id, req.params.id, req.body, req.app) }); } catch (error) { next(error); }
});
router.get('/grants', async (req, res, next) => {
  try { res.json({ success: true, data: await service.listGrants(req.user._id, req.query) }); } catch (error) { next(error); }
});
router.get('/requests', async (req, res, next) => {
  try { res.json({ success: true, data: await service.listRequests(req.user._id, req.user.role, req.query) }); } catch (error) { next(error); }
});
router.post('/requests', authorize('customer'), async (req, res, next) => {
  res.status(409).json({ success: false, code: 'SERVICE_START_AT_PARKING', message: 'Please ask staff to start your included service when your vehicle is at the parking lot.' });
});
router.get('/staff/sessions', authorize('staff', 'admin'), async (req, res, next) => {
  try { res.json({ success: true, data: await service.listStaffSessions(req.query) }); } catch (error) { next(error); }
});
router.get('/staff/sessions/:id/benefits', authorize('staff', 'admin'), async (req, res, next) => {
  try { res.json({ success: true, data: await service.sessionBenefits(req.params.id, req.query.requestId) }); } catch (error) { next(error); }
});
router.post('/staff/start', authorize('staff', 'admin'), async (req, res, next) => {
  try { res.status(201).json({ success: true, data: await service.startServices(req.user, req.body, req.app) }); } catch (error) { next(error); }
});
router.post('/requests/:id/:action', authorize('staff', 'admin'), async (req, res, next) => {
  try { res.json({ success: true, data: await service.transitionRequest(req.user, req.params.id, req.params.action, req.body?.reason, req.app) }); } catch (error) { next(error); }
});
module.exports = router;
