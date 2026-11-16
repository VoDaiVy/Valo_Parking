const diagnoseMembershipError = require('../utils/membershipErrorDiagnostics');
const { validationResult } = require('express-validator');
const renewalService = require('../services/subscriptionRenewalService');

const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({
    success: false,
    message: 'Validation failed',
    errors: errors.array().map((error) => ({
      field: error.path || error.param,
      message: error.msg,
    })),
  });
  return true;
};

const getQuote = async (req, res, next) => {
  try {
    if (handleValidation(req, res)) return;
    const data = await renewalService.getRenewalQuote(
      req.user._id,
      req.params.subscriptionId
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    diagnoseMembershipError(req, error);
    next(error);
  }
};

const payWithWallet = async (req, res, next) => {
  try {
    if (handleValidation(req, res)) return;
    const data = await renewalService.renewWithWallet({
      userId: req.user._id,
      app: req.app,
      subscriptionId: req.params.subscriptionId,
      idempotencyKey: req.body.idempotencyKey,
    });
    res.status(200).json({ success: true, message: 'Subscription renewed.', data });
  } catch (error) {
    diagnoseMembershipError(req, error);
    next(error);
  }
};

const createPayosPayment = async (req, res, next) => {
  try {
    if (handleValidation(req, res)) return;
    const data = await renewalService.createPayosRenewal({
      userId: req.user._id,
      app: req.app,
      subscriptionId: req.params.subscriptionId,
      idempotencyKey: req.body.idempotencyKey,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    diagnoseMembershipError(req, error);
    next(error);
  }
};

const verifyPayosPayment = async (req, res, next) => {
  try {
    if (handleValidation(req, res)) return;
    const data = await renewalService.verifyPayosRenewal({
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

module.exports = {
  getQuote,
  payWithWallet,
  createPayosPayment,
  verifyPayosPayment,
};
