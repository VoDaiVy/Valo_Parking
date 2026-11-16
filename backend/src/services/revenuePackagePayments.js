const Subscription = require('../models/Subscription');
const SubscriptionRenewal = require('../models/SubscriptionRenewal');
const MembershipEntitlementRenewal = require('../models/MembershipEntitlementRenewal');

// Initial purchases and older renewals have their own payment snapshots. Modern
// renewal documents are authoritative when the same payment is also mirrored here.
const subscriptionPaymentPipeline = (startDate, endDate) => [
  { $match: { paymentStatus: 'paid' } },
  { $lookup: { from: 'wallettransactions', let: { id: '$_id' }, pipeline: [
    { $match: { status: 'COMPLETED', type: 'PAYMENT', refSource: 'subscription', $expr: { $eq: ['$refSourceId', '$$id'] } } },
    { $sort: { createdAt: 1 } }, { $limit: 1 },
  ], as: 'purchaseWallet' } },
  { $set: { initialPayment: { $arrayElemAt: [{ $filter: { input: { $ifNull: ['$rewardPayments', []] }, as: 'p', cond: { $eq: ['$$p.orderCode', '$orderCode'] } } }, 0] } } },
  { $project: { packageId: '$ticketPackage', reference: '$_id', payments: { $concatArrays: [
    [{ id: { $toString: '$_id' }, amount: { $ifNull: ['$initialPayment.amount', '$amount'] },
      paidAt: { $ifNull: [{ $arrayElemAt: ['$purchaseWallet.createdAt', 0] }, { $ifNull: ['$initialPayment.paidAt', '$createdAt'] }] },
      paymentMethod: { $cond: [{ $gt: [{ $size: '$purchaseWallet' }, 0] }, 'wallet', null] }, kind: 'purchase',
      dateBasis: { $cond: [{ $or: [{ $gt: [{ $size: '$purchaseWallet' }, 0] }, { $ne: [{ $ifNull: ['$initialPayment.paidAt', null] }, null] }] }, 'payment', 'legacy_created_at'] } }],
    { $map: { input: { $filter: { input: { $ifNull: ['$rewardPayments', []] }, as: 'p', cond: { $ne: ['$$p.orderCode', '$orderCode'] } } }, as: 'p', in: {
      id: { $concat: [{ $toString: '$_id' }, ':', { $toString: '$$p._id' }] }, amount: '$$p.amount', paidAt: '$$p.paidAt', orderCode: '$$p.orderCode', paymentKey: '$$p.paymentKey',
      paymentMethod: { $cond: [{ $regexMatch: { input: { $ifNull: ['$$p.paymentKey', ''] }, regex: '^wallet:' } }, 'wallet', 'payos'] }, kind: 'renewal', dateBasis: 'payment',
    } } },
  ] } } },
  { $unwind: '$payments' },
  ...['subscriptionrenewals', 'membershipentitlementrenewals'].map((from, index) => ({ $lookup: {
    from, let: { code: '$payments.orderCode', key: '$payments.paymentKey', kind: '$payments.kind' }, pipeline: [
      { $match: { status: 'paid', $expr: { $and: [{ $eq: ['$$kind', 'renewal'] }, { $or: [
        { $and: [{ $ne: [{ $ifNull: ['$$code', null] }, null] }, { $eq: ['$orderCode', '$$code'] }] },
        { $and: [{ $ne: [{ $ifNull: ['$walletTransactionId', null] }, null] }, { $eq: [{ $concat: ['wallet:', { $toString: '$walletTransactionId' }] }, '$$key'] }] },
      ] }] } } }, { $limit: 1 },
    ], as: `modern${index}`,
  } })),
  { $match: { 'payments.paidAt': { $gte: startDate, $lt: endDate }, modern0: { $size: 0 }, modern1: { $size: 0 } } },
  { $project: { _id: 0, id: '$payments.id', amount: '$payments.amount', paidAt: '$payments.paidAt', paymentMethod: '$payments.paymentMethod', kind: '$payments.kind', dateBasis: '$payments.dateBasis', packageId: 1, reference: 1 } },
];

const renewalPaymentPipeline = (subscriptionField, startDate, endDate) => [
  { $match: { status: 'paid', $or: [{ paidAt: { $gte: startDate, $lt: endDate } }, { paidAt: null, createdAt: { $gte: startDate, $lt: endDate } }] } },
  { $lookup: { from: 'subscriptions', localField: subscriptionField, foreignField: '_id', as: 'subscription' } },
  { $project: { _id: 0, id: { $toString: '$_id' }, reference: '$_id', amount: 1, paymentMethod: 1, kind: { $literal: 'renewal' },
    packageId: { $ifNull: ['$packageSnapshot.id', { $arrayElemAt: ['$subscription.ticketPackage', 0] }] },
    packageName: '$packageSnapshot.name', packageType: '$packageSnapshot.type',
    paidAt: { $ifNull: ['$paidAt', '$createdAt'] }, dateBasis: { $cond: [{ $ne: [{ $ifNull: ['$paidAt', null] }, null] }, 'payment', 'legacy_created_at'] },
  } },
];

async function getPackageRevenuePayments(startDate, endDate) {
  const rows = await Promise.all([
    Subscription.aggregate(subscriptionPaymentPipeline(startDate, endDate)),
    SubscriptionRenewal.aggregate(renewalPaymentPipeline('subscriptionId', startDate, endDate)),
    MembershipEntitlementRenewal.aggregate(renewalPaymentPipeline('sourceSubscriptionId', startDate, endDate)),
  ]);
  return rows.flat();
}
module.exports = { getPackageRevenuePayments, subscriptionPaymentPipeline, renewalPaymentPipeline };
