const diagnoseMembershipError = require('../utils/membershipErrorDiagnostics');
const { validationResult } = require('express-validator');
const service = require('../services/membershipEntitlementRenewalService');

const validate = (req, res) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  return true;
};

exports.getQuote = async (req, res, next) => {
  try {
    if (validate(req, res)) return;
    const data = await service.getQuote(req.user._id, req.params.entitlementId);
    res.status(200).json({ success: true, data });
  } catch (error) {
    diagnoseMembershipError(req, error);
    next(error);
  }
};

exports.payWithWallet = async (req, res, next) => {
  try {
    if (validate(req, res)) return;
    const data = await service.renewWithWallet({
      userId: req.user._id,
      app: req.app,
      entitlementId: req.params.entitlementId,
      idempotencyKey: req.body.idempotencyKey,
    });
    res.status(200).json({ success: true, message: 'Parking space renewed.', data });
  } catch (error) {
    diagnoseMembershipError(req, error);
    next(error);
  }
};

exports.createPayment = async (req, res, next) => {
  try {
    if (validate(req, res)) return;
    const data = await service.createPayosRenewal({
      userId: req.user._id,
      app: req.app,
      entitlementId: req.params.entitlementId,
      idempotencyKey: req.body.idempotencyKey,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    diagnoseMembershipError(req, error);
    next(error);
  }
};

exports.verifyPayment = async (req, res, next) => {
  try {
    if (validate(req, res)) return;
    const data = await service.verifyPayosRenewal({
      userId: req.user._id,
      app: req.app,
      orderCode: req.body.orderCode,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    diagnoseMembershipError(req, error);
    next(error);
  }
};
