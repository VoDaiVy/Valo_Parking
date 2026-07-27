const mongoose = require('mongoose');
const Policy = require('../models/Policy');
const PolicyVersion = require('../models/PolicyVersion');
const PolicyAcceptance = require('../models/PolicyAcceptance');
const RefundRuleVersion = require('../models/RefundRuleVersion');
const { cloneLegacyRefundRule } = require('./refundLegacyDefaults');
const { normalizeRule } = require('./refundEngine');

const normalizeSlug = Policy.normalizeSlug;

const pickDefined = (source, fields) =>
  fields.reduce((acc, field) => {
    if (source[field] !== undefined) acc[field] = source[field];
    return acc;
  }, {});

const ensureObjectId = (id, label = 'id') => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw Object.assign(new Error(`Invalid ${label}`), { statusCode: 400 });
  }
};

const sanitizeBoolean = (value) => value === true || value === 'true';

const parseDate = (value, fallback = new Date()) => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw Object.assign(new Error('Invalid effective date'), { statusCode: 400 });
  }
  return date;
};

const formatPolicy = (policy) => {
  const raw = policy?.toObject ? policy.toObject() : policy;
  if (!raw) return null;

  return {
    ...raw,
    currentVersion: raw.currentVersionId && typeof raw.currentVersionId === 'object'
      ? raw.currentVersionId
      : null,
  };
};

const validateRefundDesignation = (payload) => {
  const controlsBookingRefunds =
    payload.controlsBookingRefunds === true || payload.controlsBookingRefunds === 'true';
  if (controlsBookingRefunds && payload.category !== 'refund') {
    throw Object.assign(
      new Error('A booking refund policy must use the refund category'),
      { statusCode: 400 }
    );
  }
  return controlsBookingRefunds;
};

const createRefundRuleDraft = async ({
  policy,
  policyVersion,
  payload,
  userId,
  session,
}) => {
  if (!policy.controlsBookingRefunds) return null;
  const rule = normalizeRule(payload || cloneLegacyRefundRule());
  const created = await RefundRuleVersion.create(
    [
      {
        policyId: policy._id,
        policyVersionId: policyVersion._id,
        versionNumber: policyVersion.versionNumber,
        status: 'draft',
        ...rule,
        createdBy: userId,
        updatedBy: userId,
      },
    ],
    session ? { session } : undefined
  );
  return created[0];
};

const createPolicyWithDraft = async (payload, userId) => {
  const title = String(payload.title || '').trim();
  const content = String(payload.content || '').trim();
  const slug = normalizeSlug(payload.slug || title);

  if (!title) {
    throw Object.assign(new Error('Policy title is required'), { statusCode: 400 });
  }
  if (!slug) {
    throw Object.assign(new Error('Policy slug is required'), { statusCode: 400 });
  }
  if (!content) {
    throw Object.assign(new Error('Policy content is required'), { statusCode: 400 });
  }

  const controlsBookingRefunds = validateRefundDesignation(payload);
  const policy = await Policy.create({
    title,
    slug,
    category: payload.category || 'other',
    description: payload.description || '',
    requiresAcceptance: sanitizeBoolean(payload.requiresAcceptance),
    controlsBookingRefunds,
    status: 'draft',
    createdBy: userId,
    updatedBy: userId,
  });

  let version = null;
  try {
    version = await PolicyVersion.create({
      policyId: policy._id,
      versionNumber: 1,
      status: 'draft',
      title,
      summary: payload.summary || '',
      content,
      effectiveDate: parseDate(payload.effectiveDate),
      changeNote: payload.changeNote || '',
      createdBy: userId,
      updatedBy: userId,
    });
    const refundRule = await createRefundRuleDraft({
      policy,
      policyVersion: version,
      payload: payload.refundRule,
      userId,
    });

    return {
      policy,
      versions: [version],
      draftVersion: version,
      refundRule,
    };
  } catch (error) {
    if (version?._id) {
      await RefundRuleVersion.deleteMany({ policyVersionId: version._id }).catch(() => {});
      await PolicyVersion.deleteOne({ _id: version._id }).catch(() => {});
    }
    await policy.deleteOne().catch(() => {});
    throw error;
  }
};

const listAdminPolicies = async ({ includeDeleted = false } = {}) => {
  const filter = includeDeleted ? {} : { deletedAt: null };
  const policies = await Policy.find(filter)
    .populate('currentVersionId')
    .sort({ updatedAt: -1 })
    .lean();

  const currentVersionIds = policies
    .map((policy) => policy.currentVersionId?._id)
    .filter(Boolean);

  const acceptanceCounts = currentVersionIds.length
    ? await PolicyAcceptance.aggregate([
        { $match: { policyVersionId: { $in: currentVersionIds } } },
        { $group: { _id: '$policyVersionId', count: { $sum: 1 } } },
      ])
    : [];

  const countByVersion = new Map(acceptanceCounts.map((item) => [String(item._id), item.count]));

  return policies.map((policy) => ({
    ...formatPolicy(policy),
    currentVersionAcceptanceCount: policy.currentVersionId?._id
      ? countByVersion.get(String(policy.currentVersionId._id)) || 0
      : 0,
  }));
};

const listPublishedPolicies = async () => {
  const policies = await Policy.find({
    status: 'published',
    deletedAt: null,
    currentVersionId: { $ne: null },
  })
    .populate('currentVersionId')
    .sort({ category: 1, title: 1 })
    .lean();

  return policies.map(formatPolicy);
};

const getAdminPolicy = async (policyId) => {
  ensureObjectId(policyId, 'policy id');

  const policy = await Policy.findById(policyId).populate('currentVersionId').lean();
  if (!policy || policy.deletedAt) {
    throw Object.assign(new Error('Policy not found'), { statusCode: 404 });
  }

  const versions = await PolicyVersion.find({ policyId })
    .sort({ versionNumber: -1 })
    .lean();
  const refundRules = await RefundRuleVersion.find({ policyId }).lean();
  const refundRuleByVersion = new Map(
    refundRules.map((rule) => [String(rule.policyVersionId), rule])
  );

  const versionIds = versions.map((version) => version._id);
  const acceptanceCounts = versionIds.length
    ? await PolicyAcceptance.aggregate([
        { $match: { policyVersionId: { $in: versionIds } } },
        { $group: { _id: '$policyVersionId', count: { $sum: 1 } } },
      ])
    : [];

  const countByVersion = new Map(acceptanceCounts.map((item) => [String(item._id), item.count]));

  return {
    policy: formatPolicy(policy),
    versions: versions.map((version) => ({
      ...version,
      acceptanceCount: countByVersion.get(String(version._id)) || 0,
      refundRule: refundRuleByVersion.get(String(version._id)) || null,
    })),
  };
};

const getPublishedPolicyBySlug = async (slug) => {
  const policy = await Policy.findOne({
    slug: normalizeSlug(slug),
    status: 'published',
    deletedAt: null,
    currentVersionId: { $ne: null },
  })
    .populate('currentVersionId')
    .lean();

  if (!policy) {
    throw Object.assign(new Error('Policy not found'), { statusCode: 404 });
  }

  const versions = await PolicyVersion.find({
    policyId: policy._id,
    status: 'published',
  })
    .select('versionNumber publishedAt effectiveDate changeNote')
    .sort({ versionNumber: -1 })
    .lean();

  return {
    policy: formatPolicy(policy),
    versions,
  };
};

const getPublishedPolicyVersion = async (slug, versionNumber) => {
  const policy = await Policy.findOne({
    slug: normalizeSlug(slug),
    status: 'published',
    deletedAt: null,
  }).lean();

  if (!policy) {
    throw Object.assign(new Error('Policy not found'), { statusCode: 404 });
  }

  const version = await PolicyVersion.findOne({
    policyId: policy._id,
    versionNumber: Number(versionNumber),
    status: 'published',
  }).lean();

  if (!version) {
    throw Object.assign(new Error('Policy version not found'), { statusCode: 404 });
  }

  return { policy, version };
};

const updatePolicyMetadata = async (policyId, payload, userId) => {
  ensureObjectId(policyId, 'policy id');

  const currentPolicy = await Policy.findOne({ _id: policyId, deletedAt: null }).lean();
  if (!currentPolicy) {
    throw Object.assign(new Error('Policy not found'), { statusCode: 404 });
  }

  const nextCategory = payload.category ?? currentPolicy.category;
  const nextControls =
    payload.controlsBookingRefunds === undefined
      ? currentPolicy.controlsBookingRefunds
      : sanitizeBoolean(payload.controlsBookingRefunds);
  validateRefundDesignation({
    category: nextCategory,
    controlsBookingRefunds: nextControls,
  });

  const updateData = pickDefined(payload, [
    'title',
    'slug',
    'category',
    'description',
    'requiresAcceptance',
    'controlsBookingRefunds',
  ]);
  if (updateData.slug !== undefined) updateData.slug = normalizeSlug(updateData.slug);
  if (updateData.requiresAcceptance !== undefined) {
    updateData.requiresAcceptance = sanitizeBoolean(updateData.requiresAcceptance);
  }
  if (updateData.controlsBookingRefunds !== undefined) {
    updateData.controlsBookingRefunds = sanitizeBoolean(updateData.controlsBookingRefunds);
  }
  updateData.updatedBy = userId;

  const policy = await Policy.findOneAndUpdate(
    { _id: policyId, deletedAt: null },
    updateData,
    { new: true, runValidators: true }
  ).populate('currentVersionId');

  if (!policy) {
    throw Object.assign(new Error('Policy not found'), { statusCode: 404 });
  }

  if (policy.controlsBookingRefunds) {
    const draftVersion = await PolicyVersion.findOne({ policyId, status: 'draft' });
    if (draftVersion) {
      const existingRule = await RefundRuleVersion.findOne({
        policyVersionId: draftVersion._id,
      });
      if (!existingRule) {
        await createRefundRuleDraft({
          policy,
          policyVersion: draftVersion,
          payload: payload.refundRule,
          userId,
        });
      }
    }
  }

  return policy;
};

const updateDraftVersion = async (policyId, versionId, payload, userId) => {
  ensureObjectId(policyId, 'policy id');
  ensureObjectId(versionId, 'version id');

  const policy = await Policy.findById(policyId).lean();
  const normalizedRule =
    policy?.controlsBookingRefunds && payload.refundRule
      ? normalizeRule(payload.refundRule)
      : null;

  const version = await PolicyVersion.findOne({
    _id: versionId,
    policyId,
    status: 'draft',
  });

  if (!version) {
    throw Object.assign(new Error('Editable draft version not found'), { statusCode: 404 });
  }

  const updateData = pickDefined(payload, ['title', 'summary', 'content', 'effectiveDate', 'changeNote']);
  if (updateData.effectiveDate !== undefined) {
    updateData.effectiveDate = parseDate(updateData.effectiveDate, version.effectiveDate);
  }

  Object.assign(version, updateData, { updatedBy: userId });
  await version.save();

  let refundRule = null;
  if (policy?.controlsBookingRefunds) {
    if (payload.refundRule) {
      refundRule = await RefundRuleVersion.findOneAndUpdate(
        { policyVersionId: version._id, status: 'draft' },
        {
          $set: {
            ...normalizedRule,
            updatedBy: userId,
          },
          $setOnInsert: {
            policyId,
            policyVersionId: version._id,
            versionNumber: version.versionNumber,
            status: 'draft',
            createdBy: userId,
          },
        },
        { new: true, upsert: true, runValidators: true }
      );
    } else {
      refundRule = await RefundRuleVersion.findOne({
        policyVersionId: version._id,
        status: 'draft',
      });
    }
  }

  return {
    ...version.toObject(),
    refundRule: refundRule?.toObject ? refundRule.toObject() : refundRule,
  };
};

const createNextDraftVersion = async (policyId, payload, userId) => {
  ensureObjectId(policyId, 'policy id');

  const policy = await Policy.findOne({ _id: policyId, deletedAt: null });
  if (!policy) {
    throw Object.assign(new Error('Policy not found'), { statusCode: 404 });
  }

  const existingDraft = await PolicyVersion.findOne({ policyId, status: 'draft' }).lean();
  if (existingDraft) {
    throw Object.assign(new Error('This policy already has a draft version'), { statusCode: 409 });
  }

  const latestVersion = await PolicyVersion.findOne({ policyId })
    .sort({ versionNumber: -1 })
    .lean();

  const versionNumber = (latestVersion?.versionNumber || 0) + 1;

  const version = await PolicyVersion.create({
    policyId,
    versionNumber,
    status: 'draft',
    title: payload.title || latestVersion?.title || policy.title,
    summary: payload.summary !== undefined ? payload.summary : latestVersion?.summary || '',
    content: payload.content || latestVersion?.content || '',
    effectiveDate: parseDate(payload.effectiveDate, latestVersion?.effectiveDate || new Date()),
    changeNote: payload.changeNote || '',
    createdBy: userId,
    updatedBy: userId,
  });

  let sourceRule = payload.refundRule;
  if (!sourceRule && policy.controlsBookingRefunds && policy.currentVersionId) {
    sourceRule = await RefundRuleVersion.findOne({
      policyVersionId: policy.currentVersionId,
      status: 'published',
    }).lean();
  }
  let refundRule = null;
  try {
    refundRule = await createRefundRuleDraft({
      policy,
      policyVersion: version,
      payload: sourceRule,
      userId,
    });

    policy.status = policy.currentVersionId ? 'published' : 'draft';
    policy.updatedBy = userId;
    await policy.save();
  } catch (error) {
    await RefundRuleVersion.deleteMany({ policyVersionId: version._id }).catch(() => {});
    await PolicyVersion.deleteOne({ _id: version._id }).catch(() => {});
    throw error;
  }

  return {
    ...version.toObject(),
    refundRule: refundRule?.toObject ? refundRule.toObject() : refundRule,
  };
};

const publishVersion = async (policyId, versionId, userId) => {
  ensureObjectId(policyId, 'policy id');
  ensureObjectId(versionId, 'version id');

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const policy = await Policy.findOne({ _id: policyId, deletedAt: null }).session(session);
    if (!policy) {
      throw Object.assign(new Error('Policy not found'), { statusCode: 404 });
    }

    const version = await PolicyVersion.findOne({ _id: versionId, policyId }).session(session);
    if (!version) {
      throw Object.assign(new Error('Policy version not found'), { statusCode: 404 });
    }
    if (version.status !== 'draft') {
      throw Object.assign(new Error('Only draft policy versions can be published'), {
        statusCode: 409,
      });
    }

    let refundRule = null;
    if (policy.controlsBookingRefunds) {
      if (policy.category !== 'refund') {
        throw Object.assign(new Error('The designated booking refund policy must use refund category'), {
          statusCode: 400,
        });
      }
      refundRule = await RefundRuleVersion.findOne({
        policyVersionId: version._id,
        status: 'draft',
      }).session(session);
      if (!refundRule) {
        throw Object.assign(new Error('A complete refund rule draft is required before publishing'), {
          statusCode: 400,
        });
      }
      normalizeRule(refundRule);
    }

    const publishedAt = new Date();
    version.status = 'published';
    version.publishedAt = publishedAt;
    version.publishedBy = userId;
    version.updatedBy = userId;
    await version.save({ session });

    if (refundRule) {
      refundRule.status = 'published';
      refundRule.publishedAt = publishedAt;
      refundRule.publishedBy = userId;
      refundRule.updatedBy = userId;
      await refundRule.save({ session });
    }

    policy.title = version.title;
    policy.status = 'published';
    policy.currentVersionId = version._id;
    policy.currentVersionNumber = version.versionNumber;
    policy.updatedBy = userId;
    policy.archivedAt = null;
    await policy.save({ session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  return getAdminPolicy(policyId);
};

const archivePolicy = async (policyId, userId) => {
  ensureObjectId(policyId, 'policy id');

  const policy = await Policy.findOneAndUpdate(
    { _id: policyId, deletedAt: null },
    {
      status: 'archived',
      archivedAt: new Date(),
      controlsBookingRefunds: false,
      updatedBy: userId,
    },
    { new: true, runValidators: true }
  ).populate('currentVersionId');

  if (!policy) {
    throw Object.assign(new Error('Policy not found'), { statusCode: 404 });
  }

  return policy;
};

const deletePolicyPermanently = async (policyId) => {
  ensureObjectId(policyId, 'policy id');

  const session = await mongoose.startSession();
  let deletedPolicy = null;

  try {
    await session.withTransaction(async () => {
      deletedPolicy = await Policy.findOne({ _id: policyId, deletedAt: null })
        .session(session)
        .lean();

      if (!deletedPolicy) {
        throw Object.assign(new Error('Policy not found'), { statusCode: 404 });
      }

      await Promise.all([
        PolicyAcceptance.deleteMany({ policyId }, { session }),
        RefundRuleVersion.deleteMany({ policyId }, { session }),
        PolicyVersion.deleteMany({ policyId }, { session }),
      ]);

      const result = await Policy.deleteOne({ _id: policyId }, { session });
      if (result.deletedCount !== 1) {
        throw Object.assign(new Error('Policy could not be deleted'), { statusCode: 409 });
      }
    });
  } finally {
    await session.endSession();
  }

  return deletedPolicy;
};

const getPolicyAcceptances = async (policyId, { page = 1, limit = 20 } = {}) => {
  ensureObjectId(policyId, 'policy id');

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const [items, total] = await Promise.all([
    PolicyAcceptance.find({ policyId })
      .populate('userId', 'username email role')
      .populate('policyVersionId', 'versionNumber title publishedAt')
      .sort({ acceptedAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    PolicyAcceptance.countDocuments({ policyId }),
  ]);

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit),
    },
  };
};

module.exports = {
  archivePolicy,
  createNextDraftVersion,
  createPolicyWithDraft,
  getAdminPolicy,
  getPolicyAcceptances,
  getPublishedPolicyBySlug,
  getPublishedPolicyVersion,
  listAdminPolicies,
  listPublishedPolicies,
  publishVersion,
  deletePolicyPermanently,
  updateDraftVersion,
  updatePolicyMetadata,
};
