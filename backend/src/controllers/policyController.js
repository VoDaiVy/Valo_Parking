const { validationResult } = require('express-validator');
const policyService = require('../services/policyService');
const policyAcceptanceService = require('../services/policyAcceptanceService');

const getRequestMeta = (req) => ({
  ipAddress: req.ip || req.headers['x-forwarded-for'] || '',
  userAgent: req.headers['user-agent'] || '',
  source: req.body?.source || 'web',
});

const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;

  res.status(400).json({
    success: false,
    message: 'Validation failed',
    errors: errors.array(),
  });
  return true;
};

exports.listPublishedPolicies = async (req, res, next) => {
  try {
    const policies = await policyService.listPublishedPolicies();

    res.status(200).json({
      success: true,
      count: policies.length,
      data: policies,
    });
  } catch (error) {
    next(error);
  }
};

exports.getPublishedPolicyBySlug = async (req, res, next) => {
  try {
    const data = await policyService.getPublishedPolicyBySlug(req.params.slug);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};

exports.getPublishedPolicyVersion = async (req, res, next) => {
  try {
    const data = await policyService.getPublishedPolicyVersion(
      req.params.slug,
      req.params.versionNumber
    );

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};

exports.getAcceptanceStatus = async (req, res, next) => {
  try {
    const data = await policyAcceptanceService.getAcceptanceStatus(req.user._id);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};

exports.acceptPolicy = async (req, res, next) => {
  try {
    const data = await policyAcceptanceService.acceptCurrentVersion(
      req.user._id,
      req.params.policyId,
      getRequestMeta(req)
    );

    res.status(200).json({
      success: true,
      message: 'Policy accepted successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

exports.listAdminPolicies = async (req, res, next) => {
  try {
    const policies = await policyService.listAdminPolicies({
      includeDeleted: req.query.includeDeleted === 'true',
    });

    res.status(200).json({
      success: true,
      count: policies.length,
      data: policies,
    });
  } catch (error) {
    next(error);
  }
};

exports.getAdminPolicy = async (req, res, next) => {
  try {
    const data = await policyService.getAdminPolicy(req.params.id);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};

exports.createPolicy = async (req, res, next) => {
  try {
    if (handleValidation(req, res)) return;

    const data = await policyService.createPolicyWithDraft(req.body, req.user._id);

    res.status(201).json({
      success: true,
      message: 'Policy draft created successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

exports.updatePolicy = async (req, res, next) => {
  try {
    if (handleValidation(req, res)) return;

    const policy = await policyService.updatePolicyMetadata(
      req.params.id,
      req.body,
      req.user._id
    );

    res.status(200).json({
      success: true,
      message: 'Policy updated successfully',
      data: policy,
    });
  } catch (error) {
    next(error);
  }
};

exports.createVersion = async (req, res, next) => {
  try {
    if (handleValidation(req, res)) return;

    const data = await policyService.createNextDraftVersion(
      req.params.id,
      req.body,
      req.user._id
    );

    res.status(201).json({
      success: true,
      message: 'Policy draft version created successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

exports.updateVersion = async (req, res, next) => {
  try {
    if (handleValidation(req, res)) return;

    const data = await policyService.updateDraftVersion(
      req.params.id,
      req.params.versionId,
      req.body,
      req.user._id
    );

    res.status(200).json({
      success: true,
      message: 'Policy draft version updated successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

exports.publishVersion = async (req, res, next) => {
  try {
    const data = await policyService.publishVersion(
      req.params.id,
      req.params.versionId,
      req.user._id
    );

    res.status(200).json({
      success: true,
      message: 'Policy version published successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

exports.archivePolicy = async (req, res, next) => {
  try {
    const policy = await policyService.archivePolicy(req.params.id, req.user._id);

    res.status(200).json({
      success: true,
      message: 'Policy archived successfully',
      data: policy,
    });
  } catch (error) {
    next(error);
  }
};

exports.deletePolicy = async (req, res, next) => {
  try {
    const policy = await policyService.deletePolicyPermanently(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Policy deleted successfully',
      data: policy,
    });
  } catch (error) {
    next(error);
  }
};

exports.getPolicyAcceptances = async (req, res, next) => {
  try {
    const data = await policyService.getPolicyAcceptances(req.params.id, req.query);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};
