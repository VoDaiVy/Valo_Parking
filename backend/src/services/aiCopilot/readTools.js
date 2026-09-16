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
const Session = require('../../models/Session');
const User = require('../../models/User');
const Vehicle = require('../../models/Vehicle');
const Booking = require('../../models/Booking');
const ParkingFloor = require('../../models/ParkingFloor');
const Slot = require('../../models/Slot');
const WalletTransaction = require('../../models/WalletTransaction');
const Subscription = require('../../models/Subscription');
const { startOfVietnamDay, parseVietnamCalendarDate } = require('../../utils/bookingDateRange');
const { normalizeLicensePlate } = require('../../utils/licensePlateUtils');
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

const USER_SAFE_SELECT = '_id username email role status membership createdAt';
const SESSION_SAFE_SELECT = '_id licensePlate type source vehicleType status paymentStatus parkingSlot checkInTime checkOutTime expectedDurationHours totalPrice floorId userId';
const BOOKING_SAFE_SELECT = '_id licensePlate floorId parkingSlot scheduledStart scheduledEnd durationHours prepaidAmount status paymentMethod userId vehicleId createdAt';
const VEHICLE_SAFE_SELECT = '_id licensePlate vehicleType brand model color status nickname isDefault owner createdAt';
const WALLET_TX_SAFE_SELECT = '_id userId type amount balanceBefore balanceAfter status description refSource createdAt';
const SUBSCRIPTION_SAFE_SELECT = '_id user ticketPackage slots amount paymentStatus validFrom expireAt status renewalCount lastRenewedAt createdAt';

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
  return { items, total, returned: items.length, limit: actualLimit };
}

/* ── 2. search_sessions ──────────────────────────────────────────────── */

async function searchSessions({ plateNumber, status, startDate, endDate, userId, limit } = {}) {
  const filter = {};
  if (plateNumber) filter.licensePlate = new RegExp(escapeRegex(normalizeLicensePlate(plateNumber)), 'i');
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
  if (!startDate && !endDate && !plateNumber && !status && !userId) {
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
  return { items, total, returned: items.length, limit: actualLimit };
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
  return session;
}

/* ── 4. search_users ─────────────────────────────────────────────────── */

async function searchUsers({ query, role, status, limit } = {}, actorRole = 'admin') {
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

async function searchBookings({ userId, plateNumber, status, startDate, endDate, limit } = {}) {
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
    filter.scheduledStart = {};
    if (start) filter.scheduledStart.$gte = start;
    if (end) filter.scheduledStart.$lte = end;
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

async function getSubscriptionMembers({ userId, packageId, status, limit } = {}) {
  const filter = {};
  if (userId) {
    if (!isObjectId(userId)) throw new Error('userId không hợp lệ.');
    filter.user = userId;
  }
  if (packageId) {
    if (!isObjectId(packageId)) throw new Error('packageId không hợp lệ.');
    filter.ticketPackage = packageId;
  }
  if (status) {
    const allowed = ['pending', 'active', 'expired', 'cancelled', 'failed'];
    if (!allowed.includes(status)) throw new Error(`status phải là: ${allowed.join(', ')}.`);
    filter.status = status;
  }
  if (!userId && !packageId && !status) {
    filter.status = 'active';
  }
  const actualLimit = clampLimit(limit, 15);
  const [items, total] = await Promise.all([
    Subscription.find(filter)
      .sort({ expireAt: -1 })
      .limit(actualLimit)
      .select(SUBSCRIPTION_SAFE_SELECT)
      .populate('user', 'username email')
      .populate('ticketPackage', 'name type price')
      .lean(),
    Subscription.countDocuments(filter)
  ]);
  return { items, total, returned: items.length, limit: actualLimit };
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
  searchNotificationRecipients,
};

module.exports = Object.fromEntries(
  Object.entries(exportsList).map(([name, fn]) => [
    name,
    async (args, actorRole = 'admin') => serializeForAI(await fn(args, actorRole)),
  ])
);
