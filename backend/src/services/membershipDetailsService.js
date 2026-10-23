const mongoose = require('mongoose');
const { isEnabled, defaultForCurrentEnvironment } = require('../utils/featureFlags');

const DAY_MS = 86400000;
const { renewalWindowDays: getRenewalWindowDays, isInRenewalWindow } = require('../utils/membershipRenewalWindow');
const unavailable = () => Object.assign(new Error('This membership is unavailable. It may have been transferred or you may no longer have access.'), { statusCode: 404, code: 'MEMBERSHIP_UNAVAILABLE' });
const { preserveFloorReference } = require('./membershipProjectionService');

function createMembershipDetailsService(deps = {}) {
  const Entitlement = deps.Entitlement || require('../models/MembershipSlotEntitlement');
  const Subscription = deps.Subscription || require('../models/Subscription');
  const Renewal = deps.Renewal || require('../models/MembershipEntitlementRenewal');
  const SubscriptionRenewal = deps.SubscriptionRenewal || require('../models/SubscriptionRenewal');
  const Vehicle = deps.Vehicle || require('../models/Vehicle');
  const quoteEntitlement = deps.quoteEntitlement || ((...args) => require('./membershipEntitlementRenewalService').getQuote(...args));
  const quoteSubscription = deps.quoteSubscription || ((...args) => require('./subscriptionRenewalService').getRenewalQuote(...args));
  const validateTransferSpace = deps.validateTransferSpace || require('./membershipSpaceValidationService').validateEntitlementSpace;

  async function renewalState(userId, entity, kind = 'entitlement', now = new Date()) {
    const pkg = kind === 'entitlement' ? entity.packageId : entity.ticketPackage;
    const daysRemaining = Math.max(0, Math.ceil((new Date(entity.expireAt) - now) / DAY_MS));
    const renewalWindowDays = getRenewalWindowDays(pkg); // Same backend fallback as eligibility.
    const result = { canRenew: false, renewalWindowDays, daysRemaining, reasonCode: '', message: '' };
    const deny = (reasonCode, message) => ({ ...result, reasonCode, message });
    if (!(deps.renewalEnabled ?? isEnabled('SUBSCRIPTION_RENEWAL_ENABLED', defaultForCurrentEnvironment()))) return deny('RENEWAL_DISABLED', 'Renewal is currently unavailable.');
    if (entity.status === 'transfer_locked') return deny('TRANSFER_LOCKED', 'Renewal is unavailable while a transfer is awaiting payment.');
    if (entity.status !== 'active' || new Date(entity.expireAt) <= now) return deny('MEMBERSHIP_EXPIRED', 'This membership has expired and cannot be renewed under the current policy.');
    if (!pkg || pkg.isRenewable === false || !['monthly', 'yearly'].includes(pkg.type)) return deny('PACKAGE_NOT_RENEWABLE', 'This package does not support renewal.');
    const pending = await (kind === 'entitlement' ? Renewal : SubscriptionRenewal).findOne({
      [kind === 'entitlement' ? 'entitlementId' : 'subscriptionId']: entity._id,
      status: 'pending',
    }).select('_id');
    if (pending) return deny('RENEWAL_PENDING', 'A renewal payment is already pending.');
    if (!isInRenewalWindow(entity.expireAt, pkg, now)) return deny('RENEWAL_WINDOW_NOT_OPEN', `Renewal opens ${renewalWindowDays} days before expiration.`);
    try {
      await (kind === 'entitlement' ? quoteEntitlement : quoteSubscription)(userId, entity._id);
      return { ...result, canRenew: true, message: 'This membership is eligible for renewal.' };
    } catch (error) {
      if (!error.statusCode) throw error; // Infrastructure errors must not look like ineligibility.
      return deny(error.code || 'RENEWAL_UNAVAILABLE', error.message);
    }
  }

  async function presentEntitlement(userId, entity, now = new Date()) {
    const daysRemaining = Math.max(0, Math.ceil((new Date(entity.expireAt) - now) / DAY_MS));
    const status = ['active', 'transfer_locked'].includes(entity.status) && new Date(entity.expireAt) <= now ? 'expired' : entity.status;
    let canTransfer = status === 'active' && Number(entity.transferCount || 0) < 1;
    let transferUnavailableReason = '';
    if (canTransfer) {
      try { await validateTransferSpace(entity, userId, { operation: 'Transfer' }); }
      catch (error) {
        if (!error.statusCode) throw error;
        canTransfer = false;
        transferUnavailableReason = error.message;
      }
    }
    return {
      entitlementId: entity._id, sourceSubscriptionId: entity.sourceSubscriptionId,
      slotId: entity.slotId,
      floorId: entity.floorId?._id || entity.floorId, floorName: entity.floorId?.name || '',
      floorNumber: entity.floorId?.floorNumber ?? null, slotCode: entity.slotCode,
      status, validFrom: entity.validFrom, expireAt: entity.expireAt, daysRemaining,
      expiringSoon: ['active', 'transfer_locked'].includes(status) && isInRenewalWindow(entity.expireAt, entity.packageId, now),
      expiryReminderDays: getRenewalWindowDays(entity.packageId),
      package: entity.packageId ? { id: entity.packageId._id, name: entity.packageId.name, type: entity.packageId.type } : null,
      renewal: await renewalState(userId, entity, 'entitlement', now),
      canTransfer, transferUnavailableReason,
      transferCount: entity.transferCount, unitAmount: entity.unitAmount,
    };
  }

  async function owned(userId, id, kind) {
    const entity = kind === 'entitlement'
      ? await Entitlement.findOne({ _id: id, ownerId: userId }).populate('packageId').populate({ path: 'floorId', select: 'name floorNumber', transform: preserveFloorReference }).lean()
      : await Subscription.findOne({ _id: id, user: userId }).populate('ticketPackage').populate({ path: 'slots.floorId', select: 'name floorNumber', transform: preserveFloorReference }).lean();
    if (!entity) throw unavailable(); // Never fetch or return the new owner's data.
    if (kind === 'subscription') {
      const migrated = await Entitlement.find({ sourceSubscriptionId: id }).select('ownerId floorId slotCode').lean();
      if (migrated.length) {
        const ownedKeys = new Set(migrated.filter((e) => String(e.ownerId) === String(userId)).map((e) => `${e.floorId}:${e.slotCode}`));
        entity.slots = (entity.slots || []).filter((s) => ownedKeys.has(`${s.floorId?._id || s.floorId}:${s.slotCode}`));
        if (!entity.slots.length) throw unavailable();
      }
    }
    return entity;
  }

  async function getDetail(userId, id, kind = 'entitlement') {
    const entity = await owned(userId, id, kind);
    const vehicles = await Vehicle.find({ owner: userId, status: 'approved' }).select('licensePlate vehicleType brand model').lean();
    const data = kind === 'entitlement'
      ? await presentEntitlement(userId, entity)
      : {
          subscriptionId: entity._id, status: new Date(entity.expireAt) <= new Date() ? 'expired' : entity.status,
          validFrom: entity.validFrom, expireAt: entity.expireAt,
          package: entity.ticketPackage ? { id: entity.ticketPackage._id, name: entity.ticketPackage.name, type: entity.ticketPackage.type } : null,
          slots: entity.slots,
          renewal: await renewalState(userId, entity, 'subscription'),
        };
    return { ...data, kind, eligibleVehicles: vehicles, vehicleUsageNote: 'Approved vehicles share your available membership spaces. Each space can serve only one vehicle at a time; access depends on actual availability.' };
  }

  async function history(userId, id, kind = 'entitlement', { page = 1, limit = 10 } = {}) {
    const entity = await owned(userId, id, kind);
    const owner = new mongoose.Types.ObjectId(String(userId));
    const subscriptionId = new mongoose.Types.ObjectId(String(kind === 'entitlement' ? entity.sourceSubscriptionId : entity._id));
    const entitlementMatch = { userId: owner, ...(kind === 'entitlement' ? { entitlementId: new mongoose.Types.ObjectId(String(id)) } : { sourceSubscriptionId: subscriptionId }) };
    const subscriptionMatch = { userId: owner, subscriptionId };
    if (kind === 'entitlement') subscriptionMatch['entitlementSnapshot.slots'] = { $elemMatch: { floorId: entity.floorId?._id || entity.floorId, slotCode: entity.slotCode } };
    const project = (scope) => ({ $project: {
      _id: 1, createdAt: 1, paidAt: 1, oldExpireAt: 1, newExpireAt: 1,
      amount: 1, paymentMethod: 1, status: 1, orderCode: 1, walletTransactionId: 1,
      scope: { $literal: scope },
    } });
    const [result] = await Renewal.aggregate([
      { $match: entitlementMatch }, project('entitlement'),
      { $unionWith: { coll: SubscriptionRenewal.collection.name, pipeline: [{ $match: subscriptionMatch }, project('subscription')] } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $facet: { items: [{ $skip: (page - 1) * limit }, { $limit: limit }], count: [{ $count: 'total' }] } },
    ]);
    const total = result?.count?.[0]?.total || 0;
    return { items: result?.items || [], pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
  return { getDetail, history, presentEntitlement, renewalState };
}

module.exports = { ...createMembershipDetailsService(), createMembershipDetailsService };
