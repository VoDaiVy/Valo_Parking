const { assertNoMembershipBookingConflict } = require('./membershipBookingConflictService');
const { legacyConflict } = require('./legacyEntitlementCompatibilityService');
const { snapshotPackage, addConfiguredDuration } = require('./ticketPackageTerms');
const { renewalWindowDays: getRenewalWindowDays, isInRenewalWindow } = require('../utils/membershipRenewalWindow');
const { validateMembershipSpace } = require('./membershipSpaceValidationService');
const crypto = require('crypto');
const Subscription = require('../models/Subscription');
const SubscriptionRenewal = require('../models/SubscriptionRenewal');
const TicketPackage = require('../models/TicketPackage');
const Vehicle = require('../models/Vehicle');
const Slot = require('../models/Slot');
const User = require('../models/User');
const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const {
  getUnmigratedLegacySlots,
} = require('./membershipProjectionService');

const DAY_MS = 24 * 60 * 60 * 1000;

const businessError = (message, code, statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

const addMonthsClamped = (date, months) => {
  const result = new Date(date);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(
    result.getUTCFullYear(),
    result.getUTCMonth() + 1,
    0
  )).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
};

// Renewal remains based on purchased terms, independent of current catalog sales.
const addPackageDuration = (fromDate, pkg) => addConfiguredDuration(fromDate, typeof pkg === 'string' ? { type: pkg } : pkg);

const normalizeSlotCode = (value) => String(value || '').trim().toUpperCase();
const slotKey = (floorId, slotCode) => `${String(floorId)}:${normalizeSlotCode(slotCode)}`;

const buildQuoteId = (payload) =>
  crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);

const normalizeRequestedSlots = (slots) => {
  if (!Array.isArray(slots) || slots.length === 0) {
    throw businessError('Please select at least one parking slot.', 'SLOTS_REQUIRED');
  }

  const normalizedSlots = slots.map((slot) => ({
    vehicleId: slot?.vehicleId,
    floorId: slot?.floorId,
    slotCode: normalizeSlotCode(slot?.slotCode),
  }));
  if (normalizedSlots.some((slot) => !slot.floorId || !slot.slotCode)) {
    throw businessError('Each selected slot must include a floor and slot code.', 'INVALID_SLOT');
  }

  const uniqueKeys = new Set(
    normalizedSlots.map((slot) => slotKey(slot.floorId, slot.slotCode))
  );
  if (uniqueKeys.size !== normalizedSlots.length) {
    throw businessError('The same parking slot cannot be selected twice.', 'DUPLICATE_SLOTS');
  }

  return normalizedSlots;
};

// Capacity is based on vehicle identity, never the number of spaces already owned.
// Unbound legacy spaces retain their rights without inventing a vehicle binding.
const getPurchaseVehicleEligibility = async ({ userId, now = new Date(), session = null }) => {
  const read = (query) => session ? query.session(session).lean() : query.lean();
  const vehicles = await read(Vehicle.find({ owner: userId, status: 'approved' }).select('_id'));
  const vehicleIds = vehicles.map((vehicle) => vehicle._id);
  const [entitlements, subscriptions] = await Promise.all([
    read(MembershipSlotEntitlement.find({ vehicleId: { $in: vehicleIds },
      status: { $in: ['active', 'transfer_locked', 'pending'] }, expireAt: { $gt: now },
    }).select('vehicleId')),
    read(Subscription.find({ 'slots.vehicleId': { $in: vehicleIds }, $or: [
      { status: 'pending', paymentStatus: 'pending' },
      { status: 'active', paymentStatus: 'paid', expireAt: { $gt: now } },
    ] }).select('slots')),
  ]);
  const blocked = new Set(entitlements.map((item) => String(item.vehicleId)));
  // Migrated source slots must not keep blocking a vehicle after transfer/rebinding.
  const migrated = subscriptions.length ? await read(MembershipSlotEntitlement.find({
    sourceSubscriptionId: { $in: subscriptions.map((item) => item._id) },
  }).select('sourceSubscriptionId floorId slotCode')) : [];
  for (const { slot } of getUnmigratedLegacySlots(subscriptions, migrated)) {
    if (slot.vehicleId) blocked.add(String(slot.vehicleId));
  }
  const legacy = await legacyConflict({ ownerId: userId, from: now, session });
  const eligibleVehicleIds = legacy ? [] : vehicleIds.map(String).filter((id) => !blocked.has(id));
  return { customerId: String(userId), approvedVehicleCount: vehicleIds.length,
    eligibleVehicleIds, availableVehicleCapacity: eligibleVehicleIds.length,
    legacyConflict: legacy,
    reason: legacy ? legacy.reason : !vehicleIds.length ? 'Add an approved vehicle before purchasing.' :
      !eligibleVehicleIds.length ? 'All approved vehicles already have an entitlement or pending purchase.' : null };
};

const validateNewSubscriptionEligibility = async ({
  userId,
  ticketPackage,
  slots,
  now = new Date(),
  session = null,
}) => {
  const normalizedSlots = normalizeRequestedSlots(slots);

  const eligibility = await getPurchaseVehicleEligibility({ userId, now, session });
  if (eligibility.legacyConflict) throw businessError(eligibility.legacyConflict.reason, eligibility.legacyConflict.code, 409);
  const eligibleVehicleCount = eligibility.approvedVehicleCount;
  const activeSlotCount = eligibleVehicleCount - eligibility.availableVehicleCapacity;
  const maxSlots = Number(ticketPackage.maxSlots ?? 3);
  const availableSlots = Math.min(maxSlots, eligibility.availableVehicleCapacity);
  if (normalizedSlots.some((slot) => !eligibility.eligibleVehicleIds.includes(String(slot.vehicleId)))) {
    throw businessError('Select an approved owned vehicle without an effective entitlement or pending purchase.', 'VEHICLE_NOT_ELIGIBLE');
  }
  if (!eligibleVehicleCount || normalizedSlots.length > availableSlots) {
    throw businessError(
      `You can select up to ${availableSlots} additional slot(s) based on your approved vehicles.`,
      'INSUFFICIENT_ELIGIBLE_VEHICLES'
    );
  }

  let slotsQuery = Slot.find({
    $or: normalizedSlots.map((slot) => ({
      floorID: slot.floorId,
      slotNumber: slot.slotCode,
    })),
  }).select(
    'floorID slotNumber status reservedFor reservedBySubscriptionId reservedByEntitlementId'
  );
  if (session) slotsQuery = slotsQuery.session(session);
  const slotDocuments = await slotsQuery;
  const slotMap = new Map(
    slotDocuments.map((slot) => [slotKey(slot.floorID, slot.slotNumber), slot])
  );

  for (const selectedSlot of normalizedSlots) {
    const slot = slotMap.get(slotKey(selectedSlot.floorId, selectedSlot.slotCode));
    if (!slot) {
      throw businessError(
        `Slot ${selectedSlot.slotCode} no longer exists.`,
        'SLOT_NOT_FOUND',
        404
      );
    }
    if (slot.status !== 'available') {
      throw businessError(
        `Slot ${selectedSlot.slotCode} is currently ${slot.status}.`,
        'SLOT_NOT_AVAILABLE',
        409
      );
    }
    if (slot.reservedFor || slot.reservedBySubscriptionId || slot.reservedByEntitlementId) {
      throw businessError(
        `Slot ${selectedSlot.slotCode} is already reserved.`,
        'SLOT_ALREADY_RESERVED',
        409
      );
    }
  }

  const expireAt = addPackageDuration(now, ticketPackage);
  for (const selected of normalizedSlots) {
    await assertNoMembershipBookingConflict({ ...selected, validFrom: now, expireAt, session });
  }

  return {
    normalizedSlots,
    eligibleVehicleCount,
    maxSlots,
    activeSlotCount,
    availableSlots,
  };
};

const validateRenewalEligibility = async ({
  userId,
  subscriptionId,
  now = new Date(),
  ignoreRenewalId = null,
  quotedTerms = null,
  session = null,
}) => {
  let subscriptionQuery = Subscription.findOne({
    _id: subscriptionId,
    user: userId,
  }).populate('ticketPackage');
  if (session) subscriptionQuery = subscriptionQuery.session(session);
  const subscription = await subscriptionQuery;

  if (!subscription) {
    throw businessError('Subscription not found.', 'SUBSCRIPTION_NOT_FOUND', 404);
  }
  let entitlementCountQuery = MembershipSlotEntitlement.countDocuments({
    sourceSubscriptionId: subscription._id,
  });
  if (session) entitlementCountQuery = entitlementCountQuery.session(session);
  if ((await entitlementCountQuery) > 0) {
    throw businessError(
      'Renew each membership space separately.',
      'USE_ENTITLEMENT_RENEWAL',
      409
    );
  }
  if (subscription.status !== 'active' || subscription.paymentStatus !== 'paid') {
    throw businessError(
      'Only an active paid subscription can be renewed.',
      'SUBSCRIPTION_NOT_ACTIVE'
    );
  }

  const currentExpireAt = new Date(subscription.expireAt);
  if (Number.isNaN(currentExpireAt.getTime()) || currentExpireAt <= now) {
    throw businessError(
      'This subscription has expired. Please choose a new package.',
      'SUBSCRIPTION_EXPIRED'
    );
  }

  let ticketPackage = quotedTerms ? { ...quotedTerms, _id: quotedTerms.id, price: quotedTerms.unitPrice } : subscription.packageSnapshot ? { ...subscription.packageSnapshot, _id: subscription.packageSnapshot.id, price: subscription.packageSnapshot.unitPrice } : subscription.ticketPackage;
  if (!ticketPackage?._id) {
    let packageQuery = TicketPackage.findById(subscription.ticketPackage);
    if (session) packageQuery = packageQuery.session(session);
    ticketPackage = await packageQuery;
  }
  if (!ticketPackage || !['monthly', 'yearly'].includes(ticketPackage.type)) {
    throw businessError('Package is not renewable.', 'PACKAGE_NOT_RENEWABLE');
  }
  if (ticketPackage.isRenewable === false) {
    throw businessError('Renewal is disabled for this package.', 'PACKAGE_RENEWAL_DISABLED');
  }

  const renewalWindowDays = getRenewalWindowDays(ticketPackage);
  const daysUntilExpiration = Math.ceil((currentExpireAt.getTime() - now.getTime()) / DAY_MS);
  if (!isInRenewalWindow(currentExpireAt, ticketPackage, now)) {
    throw businessError(
      `Renewal opens ${renewalWindowDays} days before expiration.`,
      'RENEWAL_WINDOW_NOT_OPEN'
    );
  }

  let userQuery = User.findById(userId).select('status');
  let vehicleQuery = Vehicle.countDocuments({ owner: userId, status: 'approved' });
  const pendingFilter = {
    subscriptionId: subscription._id,
    status: 'pending',
  };
  if (ignoreRenewalId) pendingFilter._id = { $ne: ignoreRenewalId };
  let pendingQuery = SubscriptionRenewal.findOne(pendingFilter).select('_id');
  if (session) {
    userQuery = userQuery.session(session);
    vehicleQuery = vehicleQuery.session(session);
    pendingQuery = pendingQuery.session(session);
  }

  const [user, eligibleVehicleCount, otherPendingRenewal] = await Promise.all([
    userQuery,
    vehicleQuery,
    pendingQuery,
  ]);
  if (!user?.status) {
    throw businessError('Account is not active.', 'ACCOUNT_INACTIVE', 403);
  }
  if (otherPendingRenewal) {
    throw businessError(
      'A renewal payment is already pending for this subscription.',
      'RENEWAL_ALREADY_PENDING',
      409
    );
  }

  const selectedSlots = (subscription.slots || []).map((slot) => ({
    floorId: slot.floorId,
    slotCode: normalizeSlotCode(slot.slotCode),
  }));
  if (!selectedSlots.length) {
    throw businessError('Subscription has no reserved slots.', 'NO_RESERVED_SLOTS');
  }

  const uniqueKeys = new Set(selectedSlots.map((slot) => slotKey(slot.floorId, slot.slotCode)));
  if (uniqueKeys.size !== selectedSlots.length) {
    throw businessError('Subscription contains duplicate slots.', 'DUPLICATE_SLOTS');
  }

  const maxSlots = Math.min(Number(ticketPackage.maxSlots || 3), eligibleVehicleCount);
  if (!eligibleVehicleCount || selectedSlots.length > maxSlots) {
    throw businessError(
      `Renewal requires ${selectedSlots.length} approved vehicle(s).`,
      'INSUFFICIENT_ELIGIBLE_VEHICLES'
    );
  }

  let slotsQuery = Slot.find({
    $or: selectedSlots.map((slot) => ({
      floorID: slot.floorId,
      slotNumber: slot.slotCode,
    })),
  }).select('floorID slotNumber status reservedFor reservedBySubscriptionId');
  if (session) slotsQuery = slotsQuery.session(session);
  const slotDocuments = await slotsQuery;
  const slotMap = new Map(
    slotDocuments.map((slot) => [slotKey(slot.floorID, slot.slotNumber), slot])
  );

  for (const selectedSlot of selectedSlots) {
    const slot = slotMap.get(slotKey(selectedSlot.floorId, selectedSlot.slotCode));
    if (!slot) {
      throw businessError(
        `Slot ${selectedSlot.slotCode} no longer exists.`,
        'SLOT_NOT_FOUND'
      );
    }
    await validateMembershipSpace({
      floorId: selectedSlot.floorId, slotId: slot._id, slotCode: selectedSlot.slotCode,
      ownerId: userId, subscriptionId: subscription._id,
    }, { session });
    if (slot.status === 'maintenance') {
      throw businessError(
        `Slot ${selectedSlot.slotCode} is under maintenance.`,
        'SLOT_UNDER_MAINTENANCE'
      );
    }
    if (!slot.reservedFor || String(slot.reservedFor) !== String(userId)) {
      throw businessError(
        `Slot ${selectedSlot.slotCode} is no longer reserved for this account.`,
        'SLOT_OWNERSHIP_MISMATCH',
        409
      );
    }
    if (
      slot.reservedBySubscriptionId &&
      String(slot.reservedBySubscriptionId) !== String(subscription._id)
    ) {
      throw businessError(
        `Slot ${selectedSlot.slotCode} belongs to another subscription.`,
        'SLOT_SUBSCRIPTION_CONFLICT',
        409
      );
    }
  }

  const renewalBase = currentExpireAt > now ? currentExpireAt : now;
  const newExpireAt = addPackageDuration(renewalBase, ticketPackage);
  const unitPrice = Number(ticketPackage.price || 0);
  const amount = unitPrice * selectedSlots.length;
  const quotePayload = {
    subscriptionId: String(subscription._id),
    currentExpireAt: currentExpireAt.toISOString(),
    newExpireAt: newExpireAt.toISOString(),
    packageId: String(ticketPackage._id),
    unitPrice,
    slotCount: selectedSlots.length,
    amount,
  };

  return {
    quoteId: buildQuoteId(quotePayload),
    quoteExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    subscription,
    ticketPackage,
    currentExpireAt,
    newExpireAt,
    daysUntilExpiration,
    renewalWindowDays,
    eligibleVehicleCount,
    selectedSlots,
    unitPrice,
    amount,
    packageSnapshot: {
      ...snapshotPackage(ticketPackage),
      id: ticketPackage._id,
      name: ticketPackage.name,
      type: ticketPackage.type,
      unitPrice,
      renewalWindowDays,
    },
    entitlementSnapshot: {
      slots: selectedSlots,
      eligibleVehicleCount,
      maxSlots: Number(ticketPackage.maxSlots || 3),
    },
  };
};

const toPublicQuote = (quote) => ({
  quoteId: quote.quoteId,
  quoteExpiresAt: quote.quoteExpiresAt,
  subscriptionId: quote.subscription._id,
  currentExpireAt: quote.currentExpireAt,
  newExpireAt: quote.newExpireAt,
  daysUntilExpiration: quote.daysUntilExpiration,
  renewalWindowDays: quote.renewalWindowDays,
  eligibleVehicleCount: quote.eligibleVehicleCount,
  retainedSlots: quote.selectedSlots,
  unitPrice: quote.unitPrice,
  amount: quote.amount,
  package: quote.packageSnapshot,
});

module.exports = {
  getPurchaseVehicleEligibility,
  validateNewSubscriptionEligibility,
  validateRenewalEligibility,
  toPublicQuote,
  businessError,
  _private: {
    addMonthsClamped,
    addPackageDuration,
    slotKey,
    normalizeSlotCode,
    normalizeRequestedSlots,
  },
};
