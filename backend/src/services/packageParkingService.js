const crypto = require('crypto');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Vehicle = require('../models/Vehicle');
const Subscription = require('../models/Subscription');
const Slot = require('../models/Slot');
const pricingEngine = require('./pricingEngine');
const { normalizeLicensePlate } = require('../utils/licensePlateUtils');

const identifier = (value) => String(value?._id || value || '');
const fail = (message, code = 'PACKAGE_INELIGIBLE') => Object.assign(new Error(message), { statusCode: 409, code });

async function checkInContext({ subscriptionId, entitlementId, userId, licensePlate, floorId, slotCode, now, session }) {
  floorId = floorId?._id || floorId;
  await require('./slotReservationAuthorizationService').authorizeSlotReservation({
    floorId, slotCode, userId, licensePlate, at: new Date(), session });
  if (userId) {
    const vehicle = await Vehicle.findOneAndUpdate({ owner: userId, status: 'approved', licensePlate: normalizeLicensePlate(licensePlate) }, { $inc: { entitlementRevision: 1 } }, { new: true, session });
    if (vehicle && await require('../models/Session').exists({ licensePlate: normalizeLicensePlate(licensePlate), status: 'active' }).session(session)) throw fail('This vehicle already has an active parking session.');
  }
  if (!entitlementId) {
    if (!subscriptionId) return null;
    const source = await Subscription.findOneAndUpdate({ _id: subscriptionId, user: userId, status: 'active', paymentStatus: 'paid', validFrom: { $lte: now }, expireAt: { $gt: now }, bindingVersion: { $ne: 1 } }, { $inc: { __v: 1 } }, { new: true, session });
    if (!source || !source.slots.some((slot) => String(slot.floorId) === String(floorId) && slot.slotCode === String(slotCode).trim().toUpperCase())) throw fail('The original membership no longer covers this parking space.');
    return { ownerId: userId, floorId, slotCode: String(slotCode).trim().toUpperCase(), validFrom: source.validFrom, expireAt: source.expireAt, terms: source.packageSnapshot || { service: 'LEGACY_RESERVED' } };
  }
  const entitlement = await Entitlement.findOneAndUpdate({ _id: entitlementId, ownerId: userId,
    status: { $in: ['active', 'transfer_locked'] }, validFrom: { $lte: now }, expireAt: { $gt: now },
  }, { $inc: { usageRevision: 1 } }, { new: true, session });
  if (!entitlement) throw fail('The parking entitlement is no longer effective.');
  const slot = await Slot.findOne({ _id: entitlement.slotId, floorID: floorId,
    slotNumber: String(slotCode).trim().toUpperCase(), reservedFor: userId,
    reservedByEntitlementId: entitlement._id }).session(session);
  if (!slot) throw fail('The entitlement does not cover this parking space.');
  if (entitlement.vehicleId) {
    const vehicle = await Vehicle.findOne({ _id: entitlement.vehicleId, owner: userId,
      status: 'approved', licensePlate: normalizeLicensePlate(licensePlate) }).session(session);
    if (!vehicle) throw fail('The entitlement belongs to a different vehicle.');
  }
  return { entitlementId: entitlement._id, vehicleId: entitlement.vehicleId,
    ownerId: userId, slotId: entitlement.slotId, floorId, slotCode: entitlement.slotCode,
    validFrom: entitlement.vehicleBindingFrom || entitlement.validFrom, expireAt: entitlement.expireAt,
    terms: entitlement.packageSnapshot || { service: 'LEGACY_RESERVED' } };
}

// Preview and settlement use exactly one normal-pricing call for the payable
// period. Whole intersecting blocks, rounding and caps remain engine-owned.
async function quoteParking(session, now, config = null) {
  let context = session.packageContext;
  if (!context) {
    // Legacy sessions are tied to their original entitlement/subscription only.
    // Never use another membership bought after this session began.
    const source = session.entitlementId
      ? await Entitlement.findOne({ _id: session.entitlementId, ownerId: session.userId }).lean()
      : session.subscriptionId ? await Subscription.findOne({ _id: session.subscriptionId, user: session.userId, paymentStatus: 'paid' }).lean() : null;
    if (!source) throw fail('The original purchased terms are unavailable. Staff review is required.', 'PACKAGE_PRICING_REVIEW_REQUIRED');
    context = { ownerId: session.userId, floorId: session.floorId, slotCode: session.parkingSlot,
      validFrom: source.validFrom, expireAt: source.expireAt,
      terms: source.packageSnapshot || { service: 'LEGACY_RESERVED' } };
  }
  if (identifier(context.ownerId) !== identifier(session.userId)
    || (context.vehicleId && identifier(context.vehicleId) !== identifier(session.vehicleId))
    || identifier(context.floorId) !== identifier(session.floorId) || context.slotCode !== session.parkingSlot)
    throw fail('Session package context does not match the vehicle or parking space.');
  const service = context.terms?.service;
  if (!['RESERVED_FREE', 'RESERVED_PAID', 'LEGACY_RESERVED'].includes(service))
    throw fail('The purchased parking service is unsupported. Contact staff for assistance.');
  const start = new Date(session.checkInTime), end = new Date(now);
  const validFrom = new Date(context.validFrom), expiry = new Date(context.expireAt);
  if (context.validFrom == null || context.expireAt == null || ![start, end, validFrom, expiry].every((date) => Number.isFinite(date.getTime())) || end < start || expiry <= validFrom)
    throw fail('The parking period or purchased coverage dates are invalid. Contact staff for assistance.', 'PACKAGE_PRICING_REVIEW_REQUIRED');

  // Benefits selected after check-in never cover an already-running session.
  const eligible = service !== 'RESERVED_PAID' && start >= validFrom && start < expiry;
  const coveredEnd = new Date(Math.min(end.getTime(), expiry.getTime()));
  const coveredInterval = eligible && coveredEnd > start ? { start, end: coveredEnd } : null;
  const chargeStart = coveredInterval ? coveredEnd : start;
  const uncoveredInterval = end > chargeStart ? { start: chargeStart, end } : null;
  const pricingConfig = config || await pricingEngine.getActivePricingConfig();
  const blocks = pricingEngine.resolvePricingBlocks(pricingConfig);
  if (![pricingConfig.cap12h, pricingConfig.cap24h].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0)
    || !blocks.length || blocks.some((block) => !Number.isFinite(block.price) || block.price < 0
      || !Number.isInteger(block.startHour) || !Number.isInteger(block.endHour)
      || block.startHour < 0 || block.startHour > 23 || block.endHour < 0 || block.endHour > 24))
    throw fail('Parking pricing is not configured safely. Contact an administrator before collecting payment.', 'PACKAGE_PRICING_REVIEW_REQUIRED');
  // A single contiguous chargeable interval needs calculatePrice, not separate
  // calls whose caps could be counted twice. calculateTotalForIntervals is for
  // multiple visits/intervals; this session has just one payable tail.
  const normal = uncoveredInterval
    ? await pricingEngine.calculatePrice(uncoveredInterval.start, uncoveredInterval.end, true, pricingConfig)
    : { finalTotal: 0, rawTotal: 0, baseRawTotal: 0, durationHours: 0, appliedPolicies: [], capApplied: 'NONE' };
  if (!Number.isSafeInteger(normal.finalTotal) || normal.finalTotal < 0)
    throw fail('The parking fee could not be calculated safely. Contact staff for assistance.', 'PACKAGE_PRICING_REVIEW_REQUIRED');
  const pricingConfigSnapshot = pricingConfig.toObject ? pricingConfig.toObject() : pricingConfig;
  const pricingVersion = crypto.createHash('sha256').update(JSON.stringify(pricingConfigSnapshot)).digest('hex');
  return { ...normal, packageName: context.terms?.name || 'Legacy parking package', pricingVersion, amountToPay: normal.finalTotal, packageService: service,
    sessionId: session._id, quotedAt: end, sessionCheckInTime: start,
    sessionDurationHours: Math.ceil((end - start) / 3600000),
    appliedEntitlement: { entitlementId: context.entitlementId || session.entitlementId || null,
      subscriptionId: session.subscriptionId || null, vehicleId: context.vehicleId || session.vehicleId || null,
      slotId: context.slotId || null, validFrom, expireAt: expiry, service },
    coveredInterval, uncoveredInterval,
    coverageStatus: coveredInterval ? (uncoveredInterval ? 'partially_covered' : 'fully_covered') : 'not_covered',
    packageExpired: end >= expiry, pricingConfigSnapshot,
    normalPricing: normal, prorated: false };
}

module.exports = { checkInContext, quoteParking };
