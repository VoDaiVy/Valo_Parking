const mongoose = require('mongoose');
const { createHash } = require('crypto');
const Parking = require('../models/Session');
const Grant = require('../models/MembershipServiceGrant');
const Request = require('../models/MembershipServiceRequest');
const Operation = require('../models/MembershipServiceOperation');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Vehicle = require('../models/Vehicle');
const notifications = require('./membershipServiceNotifications');
const { isEnabled } = require('../utils/featureFlags');

const mode = 'customer_reserved';
const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const requireId = (id) => { if (!mongoose.isObjectIdOrHexString(id)) throw fail('Invalid identifier.', 400); };
const enabled = () => isEnabled('MEMBERSHIP_SERVICE_SELECTION_ENABLED', true);
const activeTerms = (now) => ({ status: 'active', validFrom: { $lte: now }, expireAt: { $gt: now } });

async function transaction(work, app) {
  const db = await mongoose.startSession();
  const events = [];
  try {
    const result = await db.withTransaction(() => { events.length = 0; return work(db, events); });
    await notifications.publish(app, events);
    return result;
  } finally { await db.endSession(); }
}

async function getParking(sessionId, userId, db) {
  requireId(sessionId);
  const parking = await Parking.findOne({ _id: sessionId, ...(userId ? { userId } : {}) }).session(db).lean();
  if (!parking) throw fail('Parking session unavailable.', 404);
  if (parking.type !== 'SUBSCRIPTION' || !parking.userId) throw fail('Included services are only available for Membership parking.');
  return parking;
}

async function lockParking(sessionId, userId, db, revision) {
  const parking = await getParking(sessionId, userId, db);
  if (parking.status !== 'active') throw fail('Vehicle is no longer at the parking lot.');
  const filter = { _id: parking._id, status: 'active', type: 'SUBSCRIPTION', userId: parking.userId };
  if (revision !== undefined) filter.$or = [{ serviceSelectionRevision: revision }, ...(revision === 0 ? [{ serviceSelectionRevision: { $exists: false } }] : [])];
  const updated = await Parking.findOneAndUpdate(filter, { $inc: { serviceSelectionRevision: 1 } }, { new: true, session: db });
  if (!updated) throw fail('Service selection changed. Refresh before trying again.');
  return updated;
}

async function lockSource(id, ownerId, db, now, active = true) {
  const source = await Entitlement.findOneAndUpdate({ _id: id, ownerId, ...(active ? activeTerms(now) : {}) },
    { $inc: { serviceUsageRevision: 1 } }, { new: true, session: db });
  if (!source) throw fail('Membership ownership or validity changed.');
  return source;
}

async function pool(ownerId, db, now = new Date()) {
  const sources = await Entitlement.find({ ownerId, ...activeTerms(now) }).select('_id slotCode expireAt').session(db).lean();
  const grants = await Grant.find({ entitlementId: { $in: sources.map((s) => s._id) }, validFrom: { $lte: now }, expireAt: { $gt: now } })
    .populate('serviceId', 'isActive').sort({ expireAt: 1, _id: 1 }).session(db).lean();
  const sourceMap = new Map(sources.map((s) => [String(s._id), s]));
  return grants.filter((g) => g.serviceId?.isActive).map((g) => ({ ...g,
    serviceId: g.serviceId._id, slotCode: sourceMap.get(String(g.entitlementId)).slotCode,
    effectiveExpireAt: new Date(Math.min(+g.expireAt, +sourceMap.get(String(g.entitlementId)).expireAt)),
    available: Math.max(0, g.total - g.used - g.reserved), canUse: g.total > g.used + g.reserved,
  })).sort((a, b) => a.effectiveExpireAt - b.effectiveExpireAt || String(a._id).localeCompare(String(b._id)));
}

function groupGrants(grants) {
  const grouped = new Map();
  for (const g of grants) {
    const key = String(g.serviceId);
    const item = grouped.get(key) || { serviceId: key, serviceName: g.serviceName, available: 0, reserved: 0, nearestExpiry: null };
    item.available += g.available;
    item.reserved += g.reserved;
    if (g.available && (!item.nearestExpiry || g.effectiveExpireAt < item.nearestExpiry)) item.nearestExpiry = g.effectiveExpireAt;
    grouped.set(key, item);
  }
  return [...grouped.values()];
}

async function benefits(sessionId, userId = null, requestId = null) {
  await expirePending();
  const parking = await getParking(sessionId, userId);
  const grants = parking.status === 'active' ? await pool(parking.userId) : [];
  const [requests, floor] = await Promise.all([
    Promise.all([Request.find({ sessionId, status: { $in: ['pending', 'in_progress'] } }).select('-idempotencyKey -requestHash').lean(),
      Request.find({ sessionId, status: { $in: ['done', 'cancelled'] } }).select('-idempotencyKey -requestHash').sort({ createdAt: -1, _id: -1 }).limit(100).lean()]).then(([open, history]) => [...open, ...history]),
    parking.floorId ? require('../models/ParkingFloor').findById(parking.floorId).select('name floorNumber').lean() : null,
  ]);
  if (requestId) {
    requireId(requestId);
    if (!requests.some((r) => String(r._id) === requestId)) {
      const linked = await Request.findOne({ _id: requestId, sessionId }).select('-idempotencyKey -requestHash').lean();
      if (!linked) throw fail('Service request unavailable.', 404);
      requests.push(linked);
    }
  }
  return { session: { ...parking, floorName: floor?.name || null }, grants, groupedBenefits: groupGrants(grants), requests,
    revision: parking.serviceSelectionRevision || 0, selectionEnabled: enabled() && parking.status === 'active', historyLimit: 100 };
}

async function cancelPending(request, actorId, reason, db, events) {
  const updated = await Request.findOneAndUpdate({ _id: request._id, status: 'pending' },
    { $set: { status: 'cancelled' }, $push: { history: { status: 'cancelled', actorId, at: new Date(), reason } } }, { new: true, session: db });
  if (!updated) throw fail('Service request changed.');
  const result = await Grant.updateOne({ _id: request.grantId, reserved: { $gte: 1 } }, { $inc: { reserved: -1 } }, { session: db });
  if (result.modifiedCount !== 1) throw fail('Service allowance requires reconciliation.');
  if (events) events.push(await notifications.create(updated, actorId, db));
  return updated;
}

async function select(userId, sessionId, payload, app) {
  requireId(sessionId);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail('Invalid selection.', 400);
  const { serviceIds, revision, idempotencyKey } = payload;
  if (!Array.isArray(serviceIds) || serviceIds.length > 30) throw fail('Select at most 30 services.', 400);
  serviceIds.forEach(requireId);
  const ids = serviceIds.map((id) => String(id).toLowerCase()).sort();
  if (new Set(ids).size !== ids.length || !Number.isSafeInteger(revision) || revision < 0) throw fail('Invalid selection or revision.', 400);
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 100) throw fail('Invalid request key.', 400);
  if (['grantId', 'grantIds', 'quantity', 'remaining'].some((key) => key in payload)) throw fail('Choose service types only.', 400);
  const key = `customer:${idempotencyKey}`;
  const hash = createHash('sha256').update(JSON.stringify([String(userId), String(sessionId).toLowerCase(), revision, ids])).digest('hex');
  await expirePending(app);
  return transaction(async (db, events) => {
    await getParking(sessionId, userId, db);
    const receipt = await Operation.findOne({ sessionId, idempotencyKey: key }).session(db);
    if (receipt) {
      if (receipt.requestHash !== hash || String(receipt.actorId) !== String(userId)) throw fail('Request key already used with different details.');
      return { replayed: true };
    }
    const now = new Date();
    const parking = await lockParking(sessionId, userId, db, revision);
    const vehicle = await Vehicle.findOne({ owner: userId, licensePlate: parking.licensePlate, status: 'approved' }).session(db);
    if (!vehicle) throw fail('Vehicle must be approved and belong to this account.');
    const open = await Request.find({ sessionId, status: { $in: ['pending', 'in_progress'] } }).session(db);
    if (open.some((r) => r.status === 'in_progress' && ids.includes(String(r.serviceId)))) throw fail('A selected service is already in progress.');
    const pending = open.filter((r) => r.accountingMode === mode && r.status === 'pending');
    if (!enabled() && ids.some((id) => !pending.some((r) => String(r.serviceId) === id))) throw fail('New membership service selections are temporarily disabled.', 503);
    for (const request of pending.filter((r) => !ids.includes(String(r.serviceId)))) {
      await lockSource(request.entitlementId, userId, db, now, false);
      const cancelled = await cancelPending(request, userId, 'Customer updated service selection.', db, events);
      events.push(await notifications.createStaff(cancelled, userId, db));
    }
    const grants = await pool(userId, db, now);
    const selected = [];
    const candidates = ids.filter((id) => !pending.some((r) => String(r.serviceId) === id)).map((id) => {
      if (open.some((r) => String(r.serviceId) === id)) throw fail('Service already has an open request.');
      const grant = grants.find((g) => String(g.serviceId) === id && g.available > 0);
      if (!grant) throw fail('No available uses remain for a selected service.');
      return grant;
    });
    for (const id of [...new Set(candidates.map((g) => String(g.entitlementId)))].sort()) await lockSource(id, userId, db, now);
    for (const g of candidates) {
      const reserved = await Grant.updateOne({ _id: g._id, validFrom: { $lte: now }, expireAt: { $gt: now }, $expr: { $lt: [{ $add: ['$used', '$reserved'] }, '$total'] } },
        { $inc: { reserved: 1 } }, { session: db });
      if (reserved.modifiedCount !== 1) throw fail('Service allowance changed. Refresh the selection.');
      const [request] = await Request.create([{ grantId: g._id, entitlementId: g.entitlementId, requesterId: userId, vehicleId: vehicle._id,
        sessionId, serviceId: g.serviceId, accountingMode: mode, licensePlate: parking.licensePlate,
        slotCode: parking.parkingSlot, serviceName: g.serviceName, expiresAt: g.effectiveExpireAt,
        idempotencyKey: `${key}:${sessionId}:${g.serviceId}`, requestHash: hash,
        history: [{ status: 'pending', actorId: userId, at: now }],
      }], { session: db });
      events.push(await notifications.create(request, userId, db));
      events.push(await notifications.createStaff(request, userId, db));
      selected.push(request._id);
    }
    await Operation.create([{ sessionId, idempotencyKey: key, requestHash: hash, actorId: userId, requestIds: selected }], { session: db });
    return { revision: parking.serviceSelectionRevision };
  }, app);
}

async function transition(actor, requestId, action, reason = '', app) {
  requireId(requestId);
  if (!['staff', 'admin'].includes(actor?.role)) throw fail('Staff permission required.', 403);
  if (!['start', 'complete', 'cancel'].includes(action) || typeof reason !== 'string' || reason.length > 500) throw fail('Invalid service action.', 400);
  return transaction(async (db, events) => {
    const now = new Date();
    const request = await Request.findOne({ _id: requestId, accountingMode: mode }).session(db);
    if (!request) throw fail('Service request unavailable.', 404);
    const target = { start: 'in_progress', complete: 'done', cancel: 'cancelled' }[action];
    if (request.status === target) return request;
    if (!((request.status === 'pending' && ['start', 'cancel'].includes(action)) || (request.status === 'in_progress' && ['complete', 'cancel'].includes(action)))) throw fail('Service request already changed.');
    if (action === 'cancel' && !reason.trim()) throw fail('Provide a reason to cancel this service.', 400);
    const parking = await lockParking(request.sessionId, request.requesterId, db);
    await lockSource(request.entitlementId, request.requesterId, db, now, action === 'start');
    if (request.status === 'pending' && action === 'cancel') return cancelPending(request, actor._id, reason.trim(), db, events);
    const grant = await Grant.findById(request.grantId).session(db);
    if (!grant) throw fail('Service allowance unavailable.');
    if (action === 'start') {
      if (request.expiresAt <= now || grant.validFrom > now || grant.expireAt <= now) throw fail('Service allowance expired.');
      if (!await require('../models/Service').exists({ _id: grant.serviceId, isActive: true }).session(db)) throw fail('Service unavailable.');
      if (!await Vehicle.exists({ _id: request.vehicleId, owner: request.requesterId, licensePlate: parking.licensePlate, status: 'approved' }).session(db)) throw fail('Vehicle ownership or approval changed.');
      if (await Request.exists({ _id: { $ne: request._id }, sessionId: request.sessionId, serviceId: request.serviceId, status: { $in: ['pending', 'in_progress'] } }).session(db)) throw fail('Another open request exists for this service.');
      const used = await Grant.updateOne({ _id: grant._id, reserved: { $gte: 1 } }, { $inc: { reserved: -1, used: 1 } }, { session: db });
      if (used.modifiedCount !== 1) throw fail('Service allowance requires reconciliation.');
      await Parking.updateOne({ _id: parking._id }, { $inc: { activeServiceJobs: 1 } }, { session: db });
    } else {
      const ended = await Parking.updateOne({ _id: parking._id, activeServiceJobs: { $gte: 1 } }, { $inc: { activeServiceJobs: -1 } }, { session: db });
      if (ended.modifiedCount !== 1) throw fail('Active service count requires reconciliation.');
      if (action === 'cancel') {
        const returned = await Grant.updateOne({ _id: grant._id, used: { $gte: 1 } }, { $inc: { used: -1 } }, { session: db });
        if (returned.modifiedCount !== 1) throw fail('Service allowance requires reconciliation.');
      }
    }
    const updated = await Request.findOneAndUpdate({ _id: requestId, status: request.status }, {
      $set: { status: target, ...(action === 'start' ? { startedBy: actor._id, startedAt: now } : {}),
        ...(action === 'complete' ? { completedBy: actor._id, completedAt: now } : {}),
        ...(action === 'cancel' ? { usageReversedAt: now, usageReversedBy: actor._id } : {}) },
      $push: { history: { status: target, actorId: actor._id, at: now, reason: reason.trim() } },
    }, { new: true, session: db });
    if (!updated) throw fail('Service request changed.');
    events.push(await notifications.create(updated, actor._id, db));
    return updated;
  }, app);
}

// Called inside the checkout transaction after its conditional session write.
async function cancelForCheckout(parking, db) {
  if (parking.type !== 'SUBSCRIPTION') return;
  if (!db?.inTransaction()) throw fail('Membership checkout requires a transaction.');
  const requests = await Request.find({ sessionId: parking._id, accountingMode: mode, status: 'pending' }).session(db);
  for (const request of requests) await cancelPending(request, null, 'Vehicle checked out before service started.', db, []);
}

async function expirePending(app) {
  const now = new Date();
  const items = await Request.find({ accountingMode: mode, status: 'pending', expiresAt: { $lte: now } }).select('_id').limit(100).lean();
  for (const item of items) await transaction(async (db, events) => {
    const request = await Request.findOne({ _id: item._id, status: 'pending', expiresAt: { $lte: now } }).session(db);
    if (!request) return;
    await Parking.updateOne({ _id: request.sessionId }, { $inc: { serviceSelectionRevision: 1 } }, { session: db });
    await cancelPending(request, null, 'Membership service allowance expired.', db, events);
  }, app);
}

module.exports = { benefits, select, transition, pool, groupGrants, cancelForCheckout, expirePending, enabled };
