const User = require('../models/User');
const Vehicle = require('../models/Vehicle');
const TicketPackage = require('../models/TicketPackage');
const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const Subscription = require('../models/Subscription');
const { normalizeLicensePlate } = require('../utils/licensePlateUtils');

const sameId = (left, right) => String(left || '') === String(right || '');
const inSession = (query, session) => session ? query.session(session) : query;

const findForeignVipPlateRestriction = async (
  { userId, licensePlate, at = new Date(), session }, dependencies = {}
) => {
  const vehicles = dependencies.Vehicle || Vehicle;
  const entitlements = dependencies.MembershipSlotEntitlement || MembershipSlotEntitlement;
  const subscriptions = dependencies.Subscription || Subscription;
  const plate = normalizeLicensePlate(licensePlate);
  if (!plate) return null;
  const registered = await inSession(vehicles.findOne({ licensePlate: plate, status: 'approved' }), session);
  if (!registered || sameId(registered.owner, userId)) return null;
  const activeEntitlements = await inSession(entitlements.find({
    ownerId: registered.owner, status: { $in: ['active', 'transfer_locked'] }, expireAt: { $gt: at },
  }), session);
  if (activeEntitlements.length) return { licensePlate: plate };
  const subscription = await inSession(subscriptions.findOne({
    user: registered.owner, status: 'active', paymentStatus: 'paid', expireAt: { $gt: at },
  }), session);
  return subscription?.slots?.length ? { licensePlate: plate } : null;
};

const getActiveMembershipType = async (user, at, ticketPackages = TicketPackage) => {
  const membership = user?.membership;
  if (!membership?.isVip || !membership?.expireAt || !membership?.packageId) return null;
  const expireAt = new Date(membership.expireAt);
  if (Number.isNaN(expireAt.getTime()) || expireAt <= at) return null;

  if (membership.packageId?.type) return membership.packageId.type;
  const ticketPackage = await ticketPackages.findById(membership.packageId).select('type').lean();
  return ticketPackage?.type || null;
};

const findVipRegisteredVehicleBookingRestriction = async (
  { userId, licensePlate, start },
  dependencies = {}
) => {
  const users = dependencies.User || User;
  const vehicles = dependencies.Vehicle || Vehicle;
  const ticketPackages = dependencies.TicketPackage || TicketPackage;
  const at = start instanceof Date && !Number.isNaN(start.getTime()) ? start : new Date();
  const plate = normalizeLicensePlate(licensePlate);
  if (!plate) return null;

  const [user, registeredVehicle] = await Promise.all([
    users.findById(userId).select('membership').lean(),
    vehicles.findOne({ owner: userId, licensePlate: plate, status: 'approved' })
      .select('_id licensePlate').lean(),
  ]);
  if (!registeredVehicle) return null;

  const membershipType = await getActiveMembershipType(user, at, ticketPackages);
  if (!['monthly', 'yearly'].includes(membershipType)) return null;

  // An active monthly/yearly membership already grants direct access to the
  // dedicated space. Creating an hourly booking for that vehicle would only
  // duplicate the entitlement (even when the selected space is the VIP one).
  return { membershipType, registeredVehicle, reason: 'ACTIVE_VIP_MEMBERSHIP' };
};

const vipBookingRestrictionMessage = (_restriction, licensePlate) =>
  `Xe ${licensePlate} đang có gói VIP và đã có ô đỗ riêng. Không cần tạo booking theo giờ; hãy dùng trực tiếp ô VIP hoặc chọn biển số xe khác.`;

module.exports = {
  getActiveMembershipType, findVipRegisteredVehicleBookingRestriction,
  findForeignVipPlateRestriction, vipBookingRestrictionMessage,
};
