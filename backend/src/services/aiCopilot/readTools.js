/**
 * readTools.js – Bounded, read-only query functions for VALO AI Copilot.
 *
 * Every function:
 *  - Uses allowlist .select() projections (no raw documents)
 *  - Validates ObjectId before querying
 *  - Escapes regex to prevent ReDoS
 *  - Enforces hard limits on result count
 *  - Never exposes password, tokens, OTP, secrets
 */

const mongoose = require('mongoose');
const adminAccounts = require('./adminAccounts');
const Session = require('../../models/Session');
const User = require('../../models/User');
const Vehicle = require('../../models/Vehicle');
const Booking = require('../../models/Booking');
const ParkingFloor = require('../../models/ParkingFloor');
const Slot = require('../../models/Slot');
const TicketPackage = require('../../models/TicketPackage');
const Subscription = require('../../models/Subscription');
const MembershipSlotEntitlement = require('../../models/MembershipSlotEntitlement');
const MembershipEntitlementTransfer = require('../../models/MembershipEntitlementTransfer');
const { MEMBERSHIP_KPIS } = require('./membershipResponses');
const { startOfVietnamDay, parseVietnamCalendarDate } = require('../../utils/bookingDateRange');
const { normalizeLicensePlate, isValidCarLicensePlate } = require('../../utils/licensePlateUtils');
const { normalizePhone, getPhoneSearchConditions } = require('../../utils/phoneUtils');
const notificationService = require('../notificationService');

/* ── helpers ──────────────────────────────────────────────────────────── */

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clampLimit = (v, max) => Math.min(Math.max(Number(v) || 10, 1), max);

function serializeForAI(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) {
    if (isNaN(obj.getTime())) return obj;
    const vnStr = obj.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false,
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
    return `${obj.toISOString()} (${vnStr} VN)`;
  }
  if (obj instanceof mongoose.Types.ObjectId) {
    return String(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => serializeForAI(item));
  }
  if (typeof obj === 'object') {
    const serialized = {};
    for (const [key, value] of Object.entries(obj)) {
      serialized[key] = serializeForAI(value);
    }
    return serialized;
  }
  return obj;
}

const USER_SAFE_SELECT = '_id username email role status membership createdAt updatedAt';
const SESSION_SAFE_SELECT = '_id licensePlate phone type source vehicleType status paymentStatus parkingSlot checkInTime checkOutTime expectedDurationHours totalPrice floorId userId entryImage_url exitImage_url';
const sessionWithImages = session => ({ ...session, imageAvailability: { entry: Boolean(session.entryImage_url), exit: Boolean(session.exitImage_url) } });
const BOOKING_SAFE_SELECT = '_id licensePlate floorId parkingSlot scheduledStart scheduledEnd durationHours prepaidAmount status paymentMethod userId vehicleId createdAt';
const VEHICLE_SAFE_SELECT = '_id licensePlate vehicleType brand model color status nickname isDefault owner createdAt';
const WALLET_TX_SAFE_SELECT = '_id userId type amount balanceBefore balanceAfter status description refSource createdAt';
const SUBSCRIPTION_SAFE_SELECT = '_id user ticketPackage slots amount paymentStatus validFrom expireAt status renewalCount lastRenewedAt createdAt';
const TICKET_PACKAGE_SAFE_SELECT = '_id name type price description isActive maxSlots renewalWindowDays isRenewable createdAt updatedAt';

function parseDateRange(args) {
  const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const start = args.startDate
    ? (isDay(args.startDate) ? parseVietnamCalendarDate(args.startDate) : new Date(args.startDate))
    : null;
  const end = args.endDate
    ? (isDay(args.endDate) ? new Date(parseVietnamCalendarDate(args.endDate).getTime() + 86400000 - 1) : new Date(args.endDate))
    : null;
  if (start && !Number.isFinite(start.getTime())) throw new Error('startDate không hợp lệ.');
  if (end && !Number.isFinite(end.getTime())) throw new Error('endDate không hợp lệ.');
  if (start && end && start > end) throw new Error('startDate phải trước endDate.');
  return { start, end };
}

/* ── 1. get_active_sessions ──────────────────────────────────────────── */

async function getActiveSessions({ floorId, limit } = {}) {
  const filter = { status: 'active' };
  if (floorId) {
    if (!isObjectId(floorId)) throw new Error('floorId không hợp lệ.');
    filter.floorId = floorId;
  }
  const actualLimit = clampLimit(limit, 20);
  const [items, total] = await Promise.all([
    Session.find(filter)
      .sort({ checkInTime: -1 })
      .limit(actualLimit)
      .select(SESSION_SAFE_SELECT)
      .populate('floorId', 'name floorNumber')
      .populate('userId', 'username email')
      .lean(),
    Session.countDocuments(filter)
  ]);
  return { items: items.map(sessionWithImages), total, returned: items.length, limit: actualLimit };
}

/* ── 2. search_sessions ──────────────────────────────────────────────── */

async function searchSessions({ plateNumber, plateMatchMode, phone, status, startDate, endDate, userId, limit } = {}) {
  const filter = {};
  if (plateMatchMode && !['exact', 'contains'].includes(plateMatchMode)) throw new Error('Choose exact or contains for the license plate match.');
  if (plateNumber) {
    const plate = normalizeLicensePlate(plateNumber);
    if (!plate) throw new Error('Enter a license plate.');
    const exact = plateMatchMode ? plateMatchMode === 'exact' : isValidCarLicensePlate(plate);
    filter.licensePlate = new RegExp(exact ? `^${escapeRegex(plate)}$` : escapeRegex(plate), 'i');
  }
  if (phone !== undefined) {
    if (typeof phone !== 'string' || !/^[+\d\s().-]+$/.test(phone) || !/^0[35789]\d{8}$/.test(normalizePhone(phone))) throw new Error('Enter a valid Vietnamese phone number.');
    filter.$or = getPhoneSearchConditions(phone).map(condition => condition.phone instanceof RegExp ? { phone: new RegExp(`^${condition.phone.source}`, 'i') } : condition);
  }
  if (status) {
    const allowed = ['active', 'completed', 'cancelled'];
    if (!allowed.includes(status)) throw new Error(`status phải là: ${allowed.join(', ')}.`);
    filter.status = status;
  }
  if (userId) {
    if (!isObjectId(userId)) throw new Error('userId không hợp lệ.');
    filter.userId = userId;
  }
  const { start, end } = parseDateRange({ startDate, endDate });
  if (start || end) {
    filter.checkInTime = {};
    if (start) filter.checkInTime.$gte = start;
    if (end) filter.checkInTime.$lte = end;
  }
  if (!startDate && !endDate && !plateNumber && !phone && !status && !userId) {
    filter.checkInTime = { $gte: startOfVietnamDay(new Date()) };
  }
  const actualLimit = clampLimit(limit, 20);
  const [items, total] = await Promise.all([
    Session.find(filter)
      .sort({ checkInTime: -1 })
      .limit(actualLimit)
      .select(SESSION_SAFE_SELECT)
      .populate('floorId', 'name floorNumber')
      .populate('userId', 'username email')
      .lean(),
    Session.countDocuments(filter)
  ]);
  return { items: items.map(sessionWithImages), total, returned: items.length, limit: actualLimit };
}

/* ── 3. get_session_detail ───────────────────────────────────────────── */

async function getSessionDetail({ sessionId }) {
  if (!sessionId || !isObjectId(sessionId)) throw new Error('sessionId không hợp lệ.');
  const session = await Session.findById(sessionId)
    .select(SESSION_SAFE_SELECT)
    .populate('floorId', 'name floorNumber')
    .populate('userId', 'username email role')
    .lean();
  if (!session) throw new Error('Không tìm thấy phiên này.');
  return sessionWithImages(session);
}

/* ── 4. search_users ─────────────────────────────────────────────────── */

async function searchUsers(args = {}, actorRole = 'admin') {
  if (actorRole === 'admin') return adminAccounts.searchAccounts(args);
  const { query, role, status, limit } = args;
  const filter = {};
  if (actorRole === 'staff') {
    filter.role = 'customer';
  } else if (role) {
    const allowed = ['guest', 'customer', 'staff', 'admin'];
    if (!allowed.includes(role)) throw new Error(`role phải là: ${allowed.join(', ')}.`);
    filter.role = role;
  }
  if (query) {
    const escaped = escapeRegex(query);
    filter.$or = [
      { username: new RegExp(escaped, 'i') },
      { email: new RegExp(escaped, 'i') },
    ];
  }
  if (status !== undefined && status !== null) {
    filter.status = status === true || status === 'true';
  }
  if (!query && !filter.role && status === undefined) throw new Error('Cần ít nhất query, role hoặc status để tìm kiếm user.');
  const actualLimit = clampLimit(limit, 10);
  const [items, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .limit(actualLimit)
      .select(USER_SAFE_SELECT)
      .lean(),
    User.countDocuments(filter)
  ]);
  return { items, total, returned: items.length, limit: actualLimit };
}

/* ── 5. get_user_detail ──────────────────────────────────────────────── */

async function getUserDetail({ userId } = {}, actorRole = 'admin') {
  if (actorRole === 'admin') return adminAccounts.getAccount(userId);
  if (!userId || !isObjectId(userId)) throw new Error('userId không hợp lệ.');
  const filter = { _id: userId };
  if (actorRole === 'staff') {
    filter.role = 'customer';
  }
  const user = await User.findOne(filter)
    .select(USER_SAFE_SELECT)
    .lean();
  if (!user) throw new Error('Không tìm thấy người dùng.');
  return user;
}

/* ── 6. search_vehicles ──────────────────────────────────────────────── */

async function searchVehicles({ plateNumber, userId, vehicleType, status, limit } = {}, actorRole = 'admin') {
  const filter = {};
  if (plateNumber) filter.licensePlate = new RegExp(escapeRegex(normalizeLicensePlate(plateNumber)), 'i');
  
  if (userId) {
    if (!isObjectId(userId)) throw new Error('userId không hợp lệ.');
    if (actorRole === 'staff') {
      const isCustomer = await User.exists({ _id: userId, role: 'customer' });
      if (!isCustomer) return { items: [], total: 0, returned: 0, limit: clampLimit(limit, 10) };
    }
    filter.owner = userId;
  } else if (actorRole === 'staff') {
    const customerIds = await User.distinct('_id', { role: 'customer' });
    filter.owner = { $in: customerIds };
  }
  
  if (vehicleType) {
    const allowed = ['car', 'electric_car'];
    if (!allowed.includes(vehicleType)) throw new Error(`vehicleType phải là: ${allowed.join(', ')}.`);
    filter.vehicleType = vehicleType;
  }
  if (status) {
    const allowed = ['pending', 'approved', 'rejected'];
    if (!allowed.includes(status)) throw new Error(`status phải là: ${allowed.join(', ')}.`);
    filter.status = status;
  }
  if (!plateNumber && !userId && !vehicleType && !status && actorRole !== 'staff') throw new Error('Cần ít nhất plateNumber, userId, vehicleType hoặc status.');
  const actualLimit = clampLimit(limit, 10);
  let [items, total] = await Promise.all([
    Vehicle.find(filter)
      .sort({ createdAt: -1 })
      .limit(actualLimit)
      .select(VEHICLE_SAFE_SELECT)
      .populate('owner', 'username email role')
      .lean(),
    Vehicle.countDocuments(filter)
  ]);
  
  return { items, total, returned: items.length, limit: actualLimit };
}

/* ── 7. search_bookings ──────────────────────────────────────────────── */

async function searchBookings({ userId, plateNumber, status, startDate, endDate, dateType = 'overlap', limit } = {}) {
  const filter = {};
  if (userId) {
    if (!isObjectId(userId)) throw new Error('userId không hợp lệ.');
    filter.userId = userId;
  }
  if (plateNumber) filter.licensePlate = new RegExp(escapeRegex(normalizeLicensePlate(plateNumber)), 'i');
  if (status) {
    const allowed = ['PENDING', 'PAID', 'ACTIVE', 'PAUSED', 'EXPIRED', 'COMPLETED', 'CANCELLED'];
    if (!allowed.includes(status)) throw new Error(`status phải là: ${allowed.join(', ')}.`);
    filter.status = status;
  }
  const { start, end } = parseDateRange({ startDate, endDate });
  if (start || end) {
    if (dateType === 'create') {
      filter.createdAt = {};
      if (start) filter.createdAt.$gte = start;
      if (end) filter.createdAt.$lte = end;
    } else if (dateType === 'start') {
      filter.scheduledStart = {};
      if (start) filter.scheduledStart.$gte = start;
      if (end) filter.scheduledStart.$lte = end;
    } else {
      // overlap semantics: bookingStart <= end AND bookingEnd >= start
      if (start && end) {
        filter.scheduledStart = { $lte: end };
        filter.scheduledEnd = { $gte: start };
      } else if (start) {
        filter.scheduledEnd = { $gte: start };
      } else if (end) {
        filter.scheduledStart = { $lte: end };
      }
    }
  }
  const actualLimit = clampLimit(limit, 20);
  const [items, total] = await Promise.all([
    Booking.find(filter)
      .sort({ scheduledStart: -1 })
      .limit(actualLimit)
      .select(BOOKING_SAFE_SELECT)
      .populate('floorId', 'name floorNumber')
      .populate('userId', 'username email')
      .populate('vehicleId', 'licensePlate vehicleType brand')
      .lean(),
    Booking.countDocuments(filter)
  ]);
  return { items, total, returned: items.length, limit: actualLimit };
}

/* ── 8. get_booking_detail ───────────────────────────────────────────── */

async function getBookingDetail({ bookingId }) {
  if (!bookingId || !isObjectId(bookingId)) throw new Error('bookingId không hợp lệ.');
  const booking = await Booking.findById(bookingId)
    .select(BOOKING_SAFE_SELECT + ' paymentBreakdownSnapshot modificationCount completedAt cancelledAt paidAt')
    .populate('floorId', 'name floorNumber')
    .populate('userId', 'username email role')
    .populate('vehicleId', 'licensePlate vehicleType brand model color')
    .lean();
  if (!booking) throw new Error('Không tìm thấy booking.');
  return booking;
}

/* ── 9. get_parking_floors ───────────────────────────────────────────── */

async function getParkingFloors() {
  const floors = await ParkingFloor.find()
    .select('_id name floorNumber')
    .sort({ floorNumber: 1 })
    .lean();
  return floors;
}

/* ── 10. get_parking_slots ───────────────────────────────────────────── */

async function getParkingSlots({ floorId, status, slotType, limit } = {}) {
  const filter = {};
  if (floorId) {
    if (!isObjectId(floorId)) throw new Error('floorId không hợp lệ.');
    filter.floorID = floorId;
  }
  if (status) {
    const allowed = ['available', 'occupied', 'maintenance', 'booked'];
    if (!allowed.includes(status)) throw new Error(`status phải là: ${allowed.join(', ')}.`);
    filter.status = status;
  }
  if (slotType) filter.slotType = slotType;
  if (!floorId && !status && !slotType) throw new Error('Cần ít nhất floorId, status hoặc slotType.');
  const actualLimit = clampLimit(limit, 50);
  const [items, total] = await Promise.all([
    Slot.find(filter)
      .sort({ slotNumber: 1 })
      .limit(actualLimit)
      .select('_id slotNumber slotType status maintenanceReason floorID')
      .populate('floorID', 'name floorNumber')
      .lean(),
    Slot.countDocuments(filter)
  ]);
  return { items, total, returned: items.length, limit: actualLimit };
}

/* ── 11. search_transactions ─────────────────────────────────────────── */

async function searchTransactions({ userId, type, status, startDate, endDate, limit } = {}) {
  const filter = {};
  if (userId) {
    if (!isObjectId(userId)) throw new Error('userId không hợp lệ.');
    filter.userId = userId;
  }
  if (type) {
    const allowed = ['TOP_UP', 'PAYMENT', 'REFUND', 'TRANSFER_OUT', 'TRANSFER_IN', 'TRANSFER_FEE'];
    if (!allowed.includes(type)) throw new Error(`type phải là: ${allowed.join(', ')}.`);
    filter.type = type;
  }
  if (status) {
    const allowed = ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'];
    if (!allowed.includes(status)) throw new Error(`status phải là: ${allowed.join(', ')}.`);
    filter.status = status;
  }
  const { start, end } = parseDateRange({ startDate, endDate });
  if (start || end) {
    filter.createdAt = {};
    if (start) filter.createdAt.$gte = start;
    if (end) filter.createdAt.$lte = end;
  }
  const actualLimit = clampLimit(limit, 20);
  const [items, total] = await Promise.all([
    WalletTransaction.find(filter)
      .sort({ createdAt: -1 })
      .limit(actualLimit)
      .select(WALLET_TX_SAFE_SELECT)
      .populate('userId', 'username email')
      .lean(),
    WalletTransaction.countDocuments(filter)
  ]);
  return { items, total, returned: items.length, limit: actualLimit };
}

/* ── 12. get_subscription_members ────────────────────────────────────── */

async function getSubscriptionMembers({ userId, packageId, subscriptionId, status, limit, includeVehicles = false } = {}) {
  if (typeof includeVehicles !== 'boolean') throw new Error('includeVehicles must be a boolean.');
  const filter = {};
  const conditions = [];
  if (subscriptionId) {
    if (!isObjectId(subscriptionId)) throw new Error('Invalid membership identifier.');
    filter._id = subscriptionId;
  }
  if (userId) {
    if (!isObjectId(userId)) throw new Error('userId không hợp lệ.');
    const owned = await MembershipSlotEntitlement.find({ ownerId: userId }).select('sourceSubscriptionId').lean();
    conditions.push({ $or: [{ user: userId }, { _id: { $in: owned.map(item => item.sourceSubscriptionId) } }] });
  }
  if (packageId) {
    if (!isObjectId(packageId)) throw new Error('packageId không hợp lệ.');
    filter.ticketPackage = packageId;
  }
  if (status) {
    const allowed = ['pending', 'active', 'expired', 'cancelled', 'failed', 'all'];
    if (!allowed.includes(status)) throw new Error(`status phải là: ${allowed.join(', ')}.`);
    if (status !== 'all') filter.status = status;
  }
  if (!userId && !packageId && !subscriptionId && !status) {
    filter.status = 'active';
  }
  if (conditions.length) filter.$and = conditions;
  const actualLimit = clampLimit(limit, 15);
  const [items, total] = await Promise.all([
    Subscription.find(filter)
      .sort({ expireAt: -1 })
      .limit(actualLimit)
      .select(SUBSCRIPTION_SAFE_SELECT)
      .populate('user', 'username email')
      .populate('ticketPackage', 'name type price')
      .populate('slots.floorId', 'name floorNumber')
      .lean(),
    Subscription.countDocuments(filter)
  ]);
  const entitlements = items.length ? await MembershipSlotEntitlement.find({ sourceSubscriptionId: { $in: items.map(item => item._id) } })
    .select('sourceSubscriptionId ownerId slotCode status validFrom expireAt')
    .populate('ownerId', 'username email')
    .lean() : [];
  const now = new Date();
  const referencedOwners = [...items.map(item => item.user?._id), ...entitlements.map(item => item.ownerId?._id)].filter(Boolean);
  const vehicles = includeVehicles && referencedOwners.length ? await Vehicle.find({ owner: { $in: referencedOwners } }).select('owner licensePlate').lean() : [];
  return { items: items.map(item => {
    const ownership = entitlements.filter(row => String(row.sourceSubscriptionId) === String(item._id));
    const currentOwners = [...new Map(ownership.filter(row => row.ownerId?._id).map(row => [String(row.ownerId._id), row.ownerId])).values()];
    const ownerIds = new Set([item.user?._id, ...currentOwners.map(owner => owner._id)].filter(Boolean).map(String));
    return { ...item, currentOwners, slotOwnership: ownership, ...(includeVehicles ? { linkedVehicles: vehicles.filter(vehicle => ownerIds.has(String(vehicle.owner))).map(vehicle => ({ ownerId: vehicle.owner, licensePlate: vehicle.licensePlate })) } : {}), effectiveStatus: item.status === 'active' && item.expireAt && new Date(item.expireAt) <= now ? 'expired' : item.status };
  }), total, returned: items.length, limit: actualLimit };
}

async function getSubscriptionDetail({ subscriptionId, includeVehicles = false } = {}) {
  if (!subscriptionId || !isObjectId(subscriptionId)) throw new Error('Invalid membership identifier.');
  const result = await getSubscriptionMembers({ subscriptionId, limit: 1, includeVehicles });
  if (!result.items[0]) throw Object.assign(new Error('Membership not found.'), { code: 'MEMBERSHIP_NOT_FOUND', statusCode: 404, publicMessage: 'Membership not found.' });
  return result.items[0];
}

async function getMembershipStatistics({ kpis, ...filters } = {}) {
  if (kpis !== undefined && (!Array.isArray(kpis) || kpis.some(key => !MEMBERSHIP_KPIS.includes(key)))) throw new Error('Invalid membership KPIs.');
  const dashboard = ['total', 'active', 'expiringSoon', 'pendingTransfers'];
  const requested = kpis || MEMBERSHIP_KPIS;
  const data = !kpis || !kpis.length || kpis.some(key => !dashboard.includes(key))
    ? await require('../statisticsService').getAdminSubscriptionStatistics(filters) : { summary: {} };
  const today = startOfVietnamDay(new Date());
  await Promise.all(dashboard.filter(key => requested.includes(key)).map(async key => {
    if (key === 'pendingTransfers') {
      // The Admin dashboard filters PENDING_ADMIN after loading the latest 100 reviews.
      const reviews = await MembershipEntitlementTransfer.find({}).sort({ createdAt: -1 }).limit(100).select('status').lean();
      data.summary[key] = reviews.filter(review => review.status === 'PENDING_ADMIN').length;
    } else {
      const filter = key === 'total' ? {} : key === 'active' ? { status: 'active' } : { status: 'active', expireAt: { $gte: today, $lt: new Date(today.getTime() + 31 * 86400000) } };
      data.summary[key] = await Subscription.countDocuments(filter);
    }
  }));
  if (kpis) data.summary = Object.fromEntries(kpis.filter(key => Object.hasOwn(data.summary, key)).map(key => [key, data.summary[key]]));
  return { ...data, ...(kpis ? { requestedKpis: kpis } : {}) };
}

async function searchNotificationRecipients(args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some((key) => key !== 'query')) {
    throw new Error('Tham số tìm người nhận không hợp lệ.');
  }
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query || query.length > 100) throw new Error('query phải dài từ 1 đến 100 ký tự.');
  const result = await notificationService.searchEligibleRecipients(query, 20);
  const exact = result.items.find((user) =>
    String(user.username || '').toLocaleLowerCase('vi-VN') === query.toLocaleLowerCase('vi-VN')
  );
  return {
    query,
    items: result.items,
    total: result.total,
    returned: result.items.length,
    exactMatchUserId: exact ? String(exact._id) : null,
  };
}

/* ── 14. search_ticket_packages ──────────────────────────────────────── */

function ticketPackageFilter({ query, type, isActive, status } = {}) {
  const filter = {};
  if (query !== undefined && (typeof query !== 'string' || query.length > 150)) throw new Error('Package search text must contain at most 150 characters.');
  if (query?.trim()) {
    const pattern = new RegExp(escapeRegex(query.trim()), 'i');
    filter.$or = ['name', 'description', 'type'].map(field => ({ [field]: pattern }));
  }
  if (type) {
    if (!['hourly', 'daily', 'monthly', 'yearly'].includes(type)) throw new Error('Choose an hourly, daily, monthly, or yearly package.');
    filter.type = type;
  }
  if (isActive !== undefined) {
    if (![true, false, 'true', 'false'].includes(isActive)) throw new Error('Package activity must be true or false.');
    filter.isActive = isActive === true || isActive === 'true';
  }
  if (status !== undefined && !['active', 'inactive', 'all'].includes(status)) throw new Error('Choose Active, Inactive, or All package status.');
  if (status && status !== 'all') {
    const active = status === 'active';
    if (filter.isActive !== undefined && filter.isActive !== active) throw new Error('Package status filters conflict.');
    filter.isActive = active;
  }
  return filter;
}

async function searchTicketPackages({ limit, ...args } = {}) {
  const filter = ticketPackageFilter(args);
  const actualLimit = clampLimit(limit, 20);
  const [items, total] = await Promise.all([
    TicketPackage.find(filter).sort({ createdAt: -1 }).limit(actualLimit).select(TICKET_PACKAGE_SAFE_SELECT).lean(),
    TicketPackage.countDocuments(filter),
  ]);
  return { items, total, returned: items.length, limit: actualLimit };
}

async function getTicketPackageDetail({ packageId, name } = {}) {
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim() || name.length > 150) throw new Error('Invalid package name.');
    const matches = await TicketPackage.find({ name: new RegExp(`^${escapeRegex(name.trim())}$`, 'i') }).limit(2).select(TICKET_PACKAGE_SAFE_SELECT).lean();
    if (!matches.length) throw Object.assign(new Error('Ticket package not found.'), { code: 'PACKAGE_NOT_FOUND', publicMessage: 'Ticket package not found.' });
    if (matches.length > 1) throw Object.assign(new Error('Multiple ticket packages have this name. Please specify the package ID.'), { code: 'PACKAGE_AMBIGUOUS', publicMessage: 'Multiple ticket packages have this name. Please specify the package ID.' });
    if (packageId && String(matches[0]._id).toLowerCase() !== String(packageId).toLowerCase()) throw new Error('Package name and identifier do not match.');
    return matches[0];
  }
  if (!packageId || !isObjectId(packageId)) throw new Error('Invalid package identifier.');
  const item = await TicketPackage.findById(packageId).select(TICKET_PACKAGE_SAFE_SELECT).lean();
  if (!item) throw Object.assign(new Error('Ticket package not found.'), { code: 'PACKAGE_NOT_FOUND', statusCode: 404, publicMessage: 'Ticket package not found.' });
  return item;
}

async function getTicketPackageStatistics(args = {}) {
  const filter = ticketPackageFilter(args);
  const counts = { total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } }, inactive: { $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] } } };
  const [result] = await TicketPackage.aggregate([{ $match: filter }, { $facet: {
    summary: [{ $group: { _id: null, ...counts, latestUpdated: { $max: '$updatedAt' } } }],
    byType: [{ $group: { _id: '$type', ...counts } }, { $sort: { _id: 1 } }],
  } }]);
  const { _id, ...summary } = result?.summary?.[0] || { total: 0, active: 0, inactive: 0, latestUpdated: null };
  return { summary, byType: result?.byType || [] };
}

const SERVICE_SAFE_SELECT = '_id name price timeCost description isActive imageUrl updatedAt createdAt';
function serviceFilter({ name, query, minPrice, maxPrice, isActive, status } = {}) {
  const filter = {};
  for (const text of [name, query]) if (text !== undefined && (typeof text !== 'string' || text.length > 150)) throw new Error('Invalid service search text.');
  if (name?.trim()) filter.name = new RegExp(escapeRegex(name.trim()), 'i');
  if (query?.trim()) filter.$or = ['name', 'description'].map(key => ({ [key]: new RegExp(escapeRegex(query.trim()), 'i') }));
  if (minPrice !== undefined || maxPrice !== undefined) {
    if ([minPrice, maxPrice].some(value => value !== undefined && (!Number.isFinite(value) || value < 0)) || (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice)) throw new Error('Invalid service price range.');
    filter.price = {};
    if (minPrice !== undefined) filter.price.$gte = minPrice;
    if (maxPrice !== undefined) filter.price.$lte = maxPrice;
  }
  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') throw new Error('Service activity must be true or false.');
    filter.isActive = isActive;
  }
  if (status !== undefined && !['active', 'inactive', 'all'].includes(status)) throw new Error('Invalid service status.');
  if (status && status !== 'all') {
    const active = status === 'active';
    if (isActive !== undefined && isActive !== active) throw new Error('Service status filters conflict.');
    filter.isActive = active;
  }
  return filter;
}
async function searchServices({ limit, sortBy = 'createdAt', sortOrder = 'desc', ...args } = {}) {
  const filter = serviceFilter(args);
  if (!['price', 'name', 'createdAt', 'updatedAt', 'timeCost'].includes(sortBy) || !['asc', 'desc'].includes(sortOrder)) throw new Error('Invalid service sort.');
  const actualLimit = clampLimit(limit, 20);
  const Service = require('../../models/Service');
  const [items, total] = await Promise.all([
    Service.find(filter)
      .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1, _id: 1 })
      .limit(actualLimit)
      .select(SERVICE_SAFE_SELECT)
      .lean(),
    Service.countDocuments(filter)
  ]);

  const sanitizedItems = items.map(s => ({
    _id: s._id,
    name: s.name,
    price: s.price,
    timeCost: s.timeCost, // Duration
    description: s.description,
    isActive: s.isActive,
    hasImage: !!s.imageUrl,
    updatedAt: s.updatedAt
  }));

  return { items: sanitizedItems, total, returned: sanitizedItems.length, limit: actualLimit, sortBy, sortOrder };
}

async function getServiceDetail({ serviceId } = {}) {
  if (!serviceId || !isObjectId(serviceId)) throw new Error('Invalid service identifier.');
  const item = await require('../../models/Service').findById(serviceId).select(SERVICE_SAFE_SELECT).lean();
  if (!item) throw Object.assign(new Error('Service not found.'), { code: 'SERVICE_NOT_FOUND', publicMessage: 'Service not found.' });
  return item;
}
async function getServiceStatistics(args = {}) {
  const [summary] = await require('../../models/Service').aggregate([
    { $match: serviceFilter(args) },
    { $group: { _id: null, total: { $sum: 1 }, active: { $sum: { $cond: ['$isActive', 1, 0] } }, totalPrice: { $sum: '$price' } } },
  ]);
  const { total = 0, active = 0, totalPrice = 0 } = summary || {};
  return { summary: { total, active, inactive: total - active, averagePrice: total ? totalPrice / total : 0 }, definition: 'Sum of stored prices divided by all matching services, including inactive services unless filtered. Same scope as Admin Services dashboard; not booking revenue or a limited search page.' };
}

const exportsList = {
  getActiveSessions,
  searchSessions,
  getSessionDetail,
  searchUsers,
  getUserDetail,
  searchVehicles,
  searchBookings,
  getBookingDetail,
  getParkingFloors,
  getParkingSlots,
  searchTransactions,
  getSubscriptionMembers,
  getSubscriptionDetail,
  getMembershipStatistics,
  searchNotificationRecipients,
  searchTicketPackages,
  getTicketPackageDetail,
  getTicketPackageStatistics,
  searchServices,
  getServiceDetail,
  getServiceStatistics,
};

module.exports = Object.fromEntries(
  Object.entries(exportsList).map(([name, fn]) => [
    name,
    async (args, actorRole = 'admin') => serializeForAI(await fn(args, actorRole)),
  ])
);
