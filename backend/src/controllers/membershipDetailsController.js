const diagnoseMembershipError = require('../utils/membershipErrorDiagnostics');
const { validationResult } = require('express-validator');
const service = require('../services/membershipDetailsService');

const handle = (history = false) => async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: 'Invalid membership request.', errors: errors.array() });
    const kind = req.params.entitlementId ? 'entitlement' : 'subscription';
    const id = req.params.entitlementId || req.params.subscriptionId;
    const data = history
      ? await service.history(req.user._id, id, kind, { page: Number(req.query.page || 1), limit: Number(req.query.limit || 10) })
      : await service.getDetail(req.user._id, id, kind);
    res.json({ success: true, data });
  } catch (error) { diagnoseMembershipError(req, error); next(error); }
};
exports.detail = handle();
exports.history = handle(true);
