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
const { isEnabled } = require('../utils/featureFlags');
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

const addPackageDuration = (fromDate, packageType) => {
  if (packageType === 'monthly') return addMonthsClamped(fromDate, 1);
  if (packageType === 'yearly') return addMonthsClamped(fromDate, 12);
  throw businessError('This package type cannot be renewed.', 'PACKAGE_NOT_RENEWABLE');
};

const normalizeSlotCode = (value) => String(value || '').trim().toUpperCase();
const slotKey = (floorId, slotCode) => `${String(floorId)}:${normalizeSlotCode(slotCode)}`;

const buildQuoteId = (payload) =>
  crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);

const normalizeRequestedSlots = (slots) => {
  if (!Array.isArray(slots) || slots.length === 0) {
    throw businessError('Please select at least one parking slot.', 'SLOTS_REQUIRED');
  }

  const normalizedSlots = slots.map((slot) => ({
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

const validateNewSubscriptionEligibility = async ({
  userId,
  ticketPackage,
  slots,
  now = new Date(),
  session = null,
}) => {
  const normalizedSlots = normalizeRequestedSlots(slots);

  let vehicleQuery = Vehicle.countDocuments({ owner: userId, status: 'approved' });
  const entitlementMode = isEnabled(
    'MEMBERSHIP_ENTITLEMENTS_ENABLED',
    true
  );
  let activeOwnershipQuery = entitlementMode
    ? MembershipSlotEntitlement.countDocuments({
        ownerId: userId,
        status: { $in: ['active', 'transfer_locked'] },
        expireAt: { $gt: now },
      })
    : Subscription.find({
        user: userId,
        status: 'active',
        paymentStatus: 'paid',
        expireAt: { $gt: now },
      }).select('slots');
  let legacySubscriptionsQuery = entitlementMode
    ? Subscription.find({
        user: userId,
        status: 'active',
        paymentStatus: 'paid',
        expireAt: { $gt: now },
      }).select('slots')
    : null;
  if (session) {
    vehicleQuery = vehicleQuery.session(session);
    activeOwnershipQuery = activeOwnershipQuery.session(session);
    if (legacySubscriptionsQuery) {
      legacySubscriptionsQuery = legacySubscriptionsQuery.session(session);
    }
  }

  const [eligibleVehicleCount, activeOwnership, legacySubscriptions] =
    await Promise.all([
      vehicleQuery,
      activeOwnershipQuery,
      legacySubscriptionsQuery || Promise.resolve([]),
    ]);
  let activeSlotCount = entitlementMode
    ? Number(activeOwnership || 0)
    : (activeOwnership || []).reduce(
        (total, subscription) => total + (subscription.slots || []).length,
        0
      );
  if (entitlementMode && legacySubscriptions.length) {
    let sourceEntitlementsQuery = MembershipSlotEntitlement.find({
      sourceSubscriptionId: {
        $in: legacySubscriptions.map((subscription) => subscription._id),
      },
    }).select('sourceSubscriptionId floorId slotCode');
    if (session) {
      sourceEntitlementsQuery = sourceEntitlementsQuery.session(session);
    }
    const sourceEntitlements = await sourceEntitlementsQuery.lean();
    activeSlotCount += getUnmigratedLegacySlots(
      legacySubscriptions,
      sourceEntitlements
    ).length;
  }

  const maxSlots = Math.min(3, eligibleVehicleCount);
  const availableSlots = Math.max(0, maxSlots - activeSlotCount);
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

  let ticketPackage = subscription.ticketPackage;
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
  const newExpireAt = addPackageDuration(renewalBase, ticketPackage.type);
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
