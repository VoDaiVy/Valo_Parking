const mongoose = require('mongoose');

const REMINDERS = ['MEMBERSHIP_ENTITLEMENT_EXPIRING_SOON', 'MEMBERSHIP_ENTITLEMENT_EXPIRED', 'VIP_EXPIRING_SOON', 'VIP_EXPIRED'];
const FILTERS = ['all', 'renewals', 'payments', 'notifications'];

// Only persisted records are timeline events. Wallet transactions and success
// notifications corroborate renewals; they must not create duplicate activities.
function buildPipeline(owner, { page, limit, filter }) {
  const renewal = (scope) => [
    { $match: { userId: owner } },
    ...(scope === 'entitlement' ? [
      { $lookup: { from: 'membershipslotentitlements', let: { entityId: '$entitlementId' }, pipeline: [
        { $match: { ownerId: owner, $expr: { $eq: ['$_id', '$$entityId'] } } },
        { $project: { slotCode: 1, floorId: 1 } },
      ], as: 'space' } },
      { $lookup: { from: 'parkingfloors', localField: 'space.floorId', foreignField: '_id', as: 'floor' } },
    ] : [{ $lookup: { from: 'parkingfloors', localField: 'entitlementSnapshot.slots.floorId', foreignField: '_id', as: 'floor' } }]),
    { $project: {
      _id: 1, scope: { $literal: scope }, status: 1, amount: 1, paymentMethod: 1,
      timestamp: { $ifNull: ['$paidAt', '$createdAt'] },
      oldExpireAt: 1, newExpireAt: 1, packageName: '$packageSnapshot.name',
      ...(scope === 'entitlement' ? {
        slotCode: { $arrayElemAt: ['$space.slotCode', 0] },
        floorName: { $arrayElemAt: ['$floor.name', 0] },
      } : { slotCodes: '$entitlementSnapshot.slots.slotCode', floorNames: '$floor.name' }),
      // A failed attempt's proposed expiry is not an activated entitlement.
      categories: { $literal: ['renewals', 'payments'] },
      kind: { $literal: 'renewal' },
    } },
  ];
  const pipeline = [
    ...renewal('entitlement'),
    { $unionWith: { coll: 'subscriptionrenewals', pipeline: renewal('subscription') } },
    { $unionWith: { coll: 'subscriptions', pipeline: [
      { $match: { user: owner, paymentStatus: { $in: ['paid', 'failed', 'cancelled', 'pending'] } } },
      { $lookup: { from: 'ticketpackages', localField: 'ticketPackage', foreignField: '_id', as: 'pkg' } },
      { $lookup: { from: 'parkingfloors', localField: 'slots.floorId', foreignField: '_id', as: 'floor' } },
      { $project: {
        _id: 1, scope: { $literal: 'purchase' }, kind: { $literal: 'purchase' },
        categories: { $literal: ['payments'] }, status: '$paymentStatus', amount: 1,
        timestamp: '$createdAt', packageName: { $arrayElemAt: ['$pkg.name', 0] },
        slotCodes: '$slots.slotCode', floorNames: '$floor.name',
        // Subscription dates can change after renewal; never present them as
        // historical purchase expiry. No payment method is inferred from orderCode.
      } },
    ] } },
    { $unionWith: { coll: 'usernotifications', pipeline: [
      { $match: { userId: owner, isDeleted: { $ne: true } } },
      { $lookup: { from: 'notifications', localField: 'notificationId', foreignField: '_id', as: 'notice' } },
      { $unwind: '$notice' },
      { $match: { 'notice.isRevoked': { $ne: true }, 'notice.metadata.eventType': { $in: REMINDERS } } },
      { $project: {
        _id: '$notificationId', scope: { $literal: 'notification' }, kind: { $literal: 'notification' },
        categories: { $literal: ['notifications'] }, timestamp: '$createdAt',
        eventType: '$notice.metadata.eventType', packageName: '$notice.metadata.packageName',
        slotCode: '$notice.metadata.slotCode', floorName: '$notice.metadata.floorName',
        expireAt: '$notice.metadata.expireAt', status: { $literal: 'warning' },
      } },
    ] } },
  ];
  if (filter !== 'all') pipeline.push({ $match: { categories: filter } });
  pipeline.push(
    { $sort: { timestamp: -1, scope: 1, _id: -1 } },
    { $facet: { items: [{ $skip: (page - 1) * limit }, { $limit: limit }], count: [{ $count: 'total' }] } },
  );
  return pipeline;
}

const safeText = (value) => typeof value === 'string' ? value.slice(0, 160) : undefined;
function present(row) {
  const failed = row.status === 'failed';
  const paid = row.status === 'paid';
  const expired = ['MEMBERSHIP_ENTITLEMENT_EXPIRED', 'VIP_EXPIRED'].includes(row.eventType);
  const title = row.kind === 'notification' ? (expired ? 'Membership expired reminder' : 'Membership expiry warning')
    : row.kind === 'purchase' ? 'Membership purchase record'
      : paid ? 'Renewal successful' : failed ? 'Renewal payment failed' : row.status === 'cancelled' ? 'Renewal payment cancelled' : 'Renewal payment pending';
  const item = {
    id: `${row.scope}:${row._id}`, kind: row.kind, title,
    timestamp: row.timestamp, status: row.status,
    tone: paid ? 'success' : failed ? 'failed' : row.status === 'warning' ? 'warning' : 'info',
    summary: row.kind === 'notification' ? 'A membership reminder was delivered to your inbox.'
      : row.kind === 'purchase' ? 'Recorded when the membership purchase was created; this is not a payment completion timestamp.'
        : paid ? 'Your membership renewal was completed.'
          : failed ? 'Payment could not be completed. This attempt did not extend your membership.'
            : row.status === 'cancelled' ? 'This renewal payment was cancelled.' : 'This renewal is awaiting payment.',
  };
  for (const key of ['packageName', 'slotCode', 'floorName']) {
    const value = safeText(row[key]);
    if (value) item[key] = value;
  }
  if (Array.isArray(row.slotCodes)) item.slotCodes = row.slotCodes.map(safeText).filter(Boolean);
  if (Array.isArray(row.floorNames)) item.floorNames = row.floorNames.map(safeText).filter(Boolean);
  if (Number.isFinite(row.amount)) item.amount = row.amount;
  if (['wallet', 'payos'].includes(row.paymentMethod)) item.paymentMethod = row.paymentMethod;
  if (row.kind === 'renewal' && paid) {
    if (row.oldExpireAt) item.oldExpireAt = row.oldExpireAt;
    if (row.newExpireAt) item.newExpireAt = row.newExpireAt;
  }
  if (row.kind === 'notification' && row.expireAt) item.expireAt = row.expireAt;
  if (failed) item.failureMessage = 'The payment service could not complete this request. This does not mean your VIP PASS has expired.';
  return item; // Never return raw provider errors, snapshots, bodies or user IDs.
}

function createMembershipActivityService({ Renewal } = {}) {
  async function history(userId, { page = 1, limit = 15, filter = 'all' } = {}) {
    if (!FILTERS.includes(filter) || !Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw Object.assign(new Error('Invalid history filters.'), { statusCode: 400 });
    }
    const Model = Renewal || require('../models/MembershipEntitlementRenewal');
    const [result] = await Model.aggregate(buildPipeline(new mongoose.Types.ObjectId(String(userId)), { page, limit, filter }));
    const total = result?.count?.[0]?.total || 0;
    return { items: (result?.items || []).map(present), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
  return { history };
}

module.exports = { ...createMembershipActivityService(), createMembershipActivityService, buildPipeline, present };
