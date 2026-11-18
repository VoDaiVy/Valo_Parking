const mongoose = require('mongoose');
const { createHash } = require('crypto');
const Grant = require('../models/MembershipServiceGrant');
const Request = require('../models/MembershipServiceRequest');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Vehicle = require('../models/Vehicle');
const Service = require('../models/Service');
const ParkingSession = require('../models/Session');
const Operation = require('../models/MembershipServiceOperation');
const serviceNotifications = require('./membershipServiceNotifications');

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const requireId = (value) => {
  if (!mongoose.isObjectIdOrHexString(value)) throw fail('Invalid identifier.');
};

async function inTransaction(work, app) {
  const session = await mongoose.startSession();
  const notifications = [];
  try {
    const result = await session.withTransaction(() => {
      notifications.length = 0;
      return work(session, notifications);
    });
    await serviceNotifications.publish(app, notifications);
    return result;
  } finally {
    await session.endSession();
  }
}

async function grantBenefits({ entitlement, terms, sourceKey, validFrom, expireAt, session }) {
  for (const benefit of terms?.serviceBenefits || []) {
    await Grant.updateOne(
      { entitlementId: entitlement._id, sourceKey, serviceId: benefit.serviceId },
      { $setOnInsert: {
        serviceName: benefit.serviceName,
        validFrom,
        expireAt,
        total: benefit.quantityPerSlot,
        reserved: 0,
        used: 0,
      } },
      { upsert: true, runValidators: true, session }
    );
  }
}

async function assertNoOpenRequests(entitlementId, session) {
  const open = await Request.exists({ entitlementId, $or: [{ status: 'in_progress' }, { status: 'pending', expiresAt: { $gt: new Date() } }] }).session(session);
  if (open) throw fail('Complete or cancel the service requests for this space before transferring it.', 409);
}

async function expirePendingRequests() {
  const now = new Date();
  const expired = await Request.find({ accountingMode: { $ne: 'customer_reserved' }, status: 'pending', expiresAt: { $lte: now } }).select('_id').limit(100).lean();
  for (const item of expired) {
    await inTransaction(async (session) => {
      const request = await Request.findOneAndUpdate(
        { _id: item._id, status: 'pending', expiresAt: { $lte: now } },
        { $set: { status: 'cancelled' }, $push: { history: { status: 'cancelled', at: now, reason: 'Benefit expired before service started.' } } },
        { new: true, session }
      );
      if (request) {
        const result = await Grant.updateOne({ _id: request.grantId, reserved: { $gt: 0 } }, { $inc: { reserved: -1 } }, { session });
        if (result.modifiedCount !== 1) throw fail('Service allowance requires reconciliation.', 409);
      }
    });
  }
}

function parsePage(query = {}) {
  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || Array.isArray(query.page)) throw fail('Invalid page.');
  return { page, limit: 20 };
}

async function listGrants(userId, query) {
  const { page, limit } = parsePage(query);
  await expirePendingRequests();
  const owned = await Entitlement.find({ ownerId: userId }).select('_id slotCode status').lean();
  const ownership = new Map(owned.map((item) => [String(item._id), item]));
  const filter = { entitlementId: { $in: owned.map((item) => item._id) } };
  const [grants, total] = await Promise.all([
    Grant.find(filter).populate('serviceId', 'isActive').sort({ expireAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Grant.countDocuments(filter),
  ]);
  const now = new Date();
  return { items: grants.map((grant) => {
    const entitlement = ownership.get(String(grant.entitlementId));
    const available = Math.max(0, grant.total - grant.reserved - grant.used);
    return {
      ...grant,
      slotCode: entitlement.slotCode,
      available,
      canUse: entitlement.status === 'active' && grant.validFrom <= now && grant.expireAt > now && available > 0 && grant.serviceId?.isActive === true,
      serviceId: grant.serviceId?._id || null,
    };
  }), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

async function listRequests(userId, role, query) {
  const { page, limit } = parsePage(query);
  await expirePendingRequests();
  const filter = ['staff', 'admin'].includes(role) ? {} : { requesterId: userId };
  if (query.sessionId) { requireId(query.sessionId); filter.sessionId = query.sessionId; }
  if (query.status) {
    if (!['pending', 'in_progress', 'done', 'cancelled'].includes(query.status)) throw fail('Invalid status.');
    filter.status = query.status;
  }
  await require('./membershipServiceSelectionService').expirePending();
  const [items, total] = await Promise.all([
    Request.find(filter).select('-idempotencyKey -requestHash').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Request.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

function requestFingerprint(grantId, vehicleId) {
  return createHash('sha256').update(`${grantId}:${vehicleId}`).digest('hex');
}

async function reserveService(userId, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail('Invalid service request.');
  const { grantId, vehicleId, idempotencyKey } = payload;
  requireId(grantId);
  requireId(vehicleId);
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 100) throw fail('Provide a valid idempotency key.');
  const requestHash = requestFingerprint(grantId, vehicleId);
  await expirePendingRequests();
  const existingRequest = async (session) => {
    const query = Request.findOne({ requesterId: userId, idempotencyKey });
    if (session) query.session(session);
    const existing = await query;
    if (existing && existing.requestHash !== requestHash) throw fail('This request key was already used for different details.', 409);
    return existing;
  };
  try {
    return await inTransaction(async (session) => {
      const existing = await existingRequest(session);
      if (existing) return existing;
      const now = new Date();
      const grant = await Grant.findById(grantId).session(session);
      if (!grant) throw fail('Service allowance unavailable.', 404);
      const entitlement = await Entitlement.findOneAndUpdate(
        { _id: grant.entitlementId, ownerId: userId, status: 'active', validFrom: { $lte: now }, expireAt: { $gt: now } },
        { $inc: { serviceUsageRevision: 1 } },
        { new: true, session }
      );
      if (!entitlement) throw fail('This membership space is unavailable.', 409);
      const vehicle = await Vehicle.findOne({ _id: vehicleId, owner: userId, status: 'approved' }).session(session);
      if (!vehicle) throw fail('Select an approved vehicle belonging to your account.');
      if (!await Service.exists({ _id: grant.serviceId, isActive: true }).session(session)) throw fail('This service is temporarily unavailable.', 409);
      const reserved = await Grant.findOneAndUpdate(
        { _id: grantId, validFrom: { $lte: now }, expireAt: { $gt: now }, $expr: { $lt: [{ $add: ['$used', '$reserved'] }, '$total'] } },
        { $inc: { reserved: 1 } },
        { new: true, session }
      );
      if (!reserved) throw fail('No available uses remain for this service period.', 409);
      const [request] = await Request.create([{
        grantId, entitlementId: entitlement._id, requesterId: userId, vehicleId,
        licensePlate: vehicle.licensePlate, serviceName: grant.serviceName, slotCode: entitlement.slotCode,
        expiresAt: grant.expireAt, idempotencyKey, requestHash,
        history: [{ status: 'pending', actorId: userId, at: now }],
      }], { session });
      return request;
    });
  } catch (error) {
    if (error.code === 11000) {
      const existing = await existingRequest();
      if (existing) return existing;
    }
    throw error;
  }
}

async function transitionRequest(actor, requestId, action, reason = '', app = null) {
  requireId(requestId);
  if (await Request.exists({ _id: requestId, accountingMode: 'customer_reserved' })) return require('./membershipServiceSelectionService').transition(actor, requestId, action, reason, app);
  if (!['start', 'complete', 'cancel'].includes(action)) throw fail('Invalid action.');
  if (typeof reason !== 'string' || reason.length > 500) throw fail('Invalid reason.');
  const staff = ['staff', 'admin'].includes(actor.role);
  if (!staff && action !== 'cancel') throw fail('Staff permission required.', 403);
  if (action === 'start') throw fail('Restart this legacy request from the parking session.', 409);
  return inTransaction(async (session, notifications) => {
    const now = new Date();
    const request = await Request.findOne({ _id: requestId, ...(!staff ? { requesterId: actor._id } : {}) }).session(session);
    if (!request) throw fail('Service request unavailable.', 404);
    const consumed = request.accountingMode === 'consumed_on_start';
    if (consumed && !staff) throw fail('Staff permission required.', 403);
    const target = { start: 'in_progress', complete: 'done', cancel: 'cancelled' }[action];
    if (request.status === target) return request;
    const allowed = action === 'cancel' ? ['pending', 'in_progress'] : [action === 'start' ? 'pending' : 'in_progress'];
    if (!allowed.includes(request.status)) throw fail('This service request has already changed.', 409);
    if (consumed) {
      const parking = await ParkingSession.findOneAndUpdate(
        { _id: request.sessionId, status: 'active', activeServiceJobs: { $gte: 1 } },
        { $inc: { activeServiceJobs: -1 } }, { new: true, session }
      );
      if (!parking) throw fail('Vehicle must be at the parking lot to finish this service.', 409);
    }
    if (action === 'cancel' && request.status === 'in_progress' && (!staff || !reason.trim())) throw fail('Staff must provide a reason to cancel work already started.', 403);
    const grant = await Grant.findById(request.grantId).session(session);
    if (!grant) throw fail('Service allowance unavailable.', 409);
    if (action === 'start') {
      if (grant.validFrom > now || grant.expireAt <= now) throw fail('This service period has expired or has not started.', 409);
      if (!await Service.exists({ _id: grant.serviceId, isActive: true }).session(session)) throw fail('Service unavailable.', 409);
    }
    const entitlement = await Entitlement.findOneAndUpdate(
      { _id: request.entitlementId, ownerId: request.requesterId, ...(action === 'start' ? { status: 'active', expireAt: { $gt: now } } : {}) },
      { $inc: { serviceUsageRevision: 1 } }, { new: true, session }
    );
    if (!entitlement) throw fail('Membership ownership changed.', 409);
    const updated = await Request.findOneAndUpdate(
      { _id: requestId, status: request.status },
      { $set: { status: target,
        ...(action === 'start' ? { startedBy: actor._id, startedAt: now } : {}),
        ...(action === 'complete' ? { completedBy: actor._id, completedAt: now } : {}),
        ...(consumed && action === 'cancel' ? { usageReversedAt: now, usageReversedBy: actor._id } : {}),
      }, $push: { history: { status: target, actorId: actor._id, at: now, reason: reason.trim() } } },
      { new: true, session }
    );
    if (!updated) throw fail('This service request has already changed.', 409);
    if (consumed && action === 'cancel') {
      const result = await Grant.updateOne({ _id: grant._id, used: { $gte: 1 } }, { $inc: { used: -1 } }, { session });
      if (result.modifiedCount !== 1) throw fail('Service allowance requires reconciliation.', 409);
    } else if (!consumed && action !== 'start') {
      const increments = { reserved: -1, ...(action === 'complete' ? { used: 1 } : {}) };
      const result = await Grant.updateOne({ _id: grant._id, reserved: { $gt: 0 } }, { $inc: increments }, { session });
      if (result.modifiedCount !== 1) throw fail('Service allowance requires reconciliation.', 409);
    }
    notifications.push(await serviceNotifications.create(updated, actor._id, session));
    return updated;
  }, app);
}

async function listStaffSessions(query = {}) {
  const { page, limit } = parsePage(query);
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 40)) throw fail('Invalid search.');
  const filter = { type: 'SUBSCRIPTION', status: 'active', userId: { $ne: null } };
  if (query.search?.trim()) filter.licensePlate = { $regex: query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const [items, total] = await Promise.all([
    ParkingSession.find(filter).select('licensePlate userId entitlementId subscriptionId parkingSlot floorId checkInTime activeServiceJobs').sort({ checkInTime: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ParkingSession.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

async function sessionBenefits(sessionId, requestId) {
  return require('./membershipServiceSelectionService').benefits(sessionId, null, requestId);
}

async function startServices(actor, payload, app = null) {
  if (!['staff', 'admin'].includes(actor?.role)) throw fail('Staff permission required.', 403);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail('Invalid service selection.');
  const { sessionId, grantIds, idempotencyKey } = payload;
  requireId(sessionId);
  if (!Array.isArray(grantIds) || grantIds.length < 1 || grantIds.length > 50) throw fail('Select between 1 and 50 services.');
  grantIds.forEach(requireId);
  const ids = grantIds.map((id) => String(id).toLowerCase()).sort();
  if (new Set(ids).size !== ids.length) throw fail('Select each service only once.');
  if ('quantity' in payload || 'remaining' in payload) throw fail('Each selected service uses exactly one allowance.');
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 100) throw fail('Provide a valid idempotency key.');
  const requestHash = createHash('sha256').update(`${String(sessionId).toLowerCase()}:${ids.join(',')}`).digest('hex');
  await expirePendingRequests();
  const replay = async (session) => {
    const operation = await Operation.findOne({ sessionId, idempotencyKey }).session(session);
    if (!operation) return null;
    if (operation.requestHash !== requestHash) throw fail('This request key was already used for different details.', 409);
    return { requests: await Request.find({ _id: { $in: operation.requestIds } }).session(session),
      grants: await Grant.find({ _id: { $in: ids } }).session(session) };
  };
  try {
    return await inTransaction(async (session, notifications) => {
      const existing = await replay(session);
      if (existing) return existing;
      const now = new Date();
      const parking = await ParkingSession.findOneAndUpdate(
        { _id: sessionId, type: 'SUBSCRIPTION', status: 'active' }, { $inc: { activeServiceJobs: ids.length, serviceSelectionRevision: 1 } }, { new: true, session }
      );
      if (!parking) throw fail('Vehicle is not currently at the parking lot.', 409);
      const owned = await Entitlement.find({ ownerId: parking.userId, status: 'active', validFrom: { $lte: now }, expireAt: { $gt: now } }).session(session);
      const vehicle = await Vehicle.findOne({ owner: parking.userId, licensePlate: parking.licensePlate, status: 'approved' }).session(session);
      if (!vehicle) throw fail('Session vehicle must be approved and belong to the membership owner.', 409);
      const grants = await Grant.find({ _id: { $in: ids }, entitlementId: { $in: owned.map((e) => e._id) } }).session(session);
      if (grants.length !== ids.length) throw fail('A selected allowance does not belong to this membership space.', 409);
      const serviceIds = grants.map((grant) => String(grant.serviceId));
      if (new Set(serviceIds).size !== serviceIds.length) throw fail('Select each service only once.');
      if (await Request.exists({ sessionId, serviceId: { $in: serviceIds }, status: { $in: ['pending', 'in_progress'] } }).session(session)) throw fail('A selected service already has an open request.', 409);
      if (await Service.countDocuments({ _id: { $in: serviceIds }, isActive: true }).session(session) !== ids.length) throw fail('A selected service is temporarily unavailable.', 409);
      const requests = [];
      const updatedGrants = [];
      for (const grant of grants) {
        const entitlement = await Entitlement.findOneAndUpdate({ _id: grant.entitlementId, ownerId: parking.userId, status: 'active', validFrom: { $lte: now }, expireAt: { $gt: now } }, { $inc: { serviceUsageRevision: 1 } }, { new: true, session });
        if (!entitlement) throw fail('Membership changed.', 409);
        const updated = await Grant.findOneAndUpdate({ _id: grant._id, validFrom: { $lte: now }, expireAt: { $gt: now }, $expr: { $lt: [{ $add: ['$used', '$reserved'] }, '$total'] } },
          { $inc: { used: 1 } }, { new: true, session });
        if (!updated) throw fail(`No available uses remain for ${grant.serviceName}.`, 409);
        const [request] = await Request.create([{
          grantId: grant._id, entitlementId: entitlement._id, requesterId: parking.userId, vehicleId: vehicle._id,
          sessionId, serviceId: grant.serviceId, accountingMode: 'consumed_on_start', status: 'in_progress',
          licensePlate: parking.licensePlate, serviceName: grant.serviceName, slotCode: parking.parkingSlot,
          expiresAt: new Date(Math.min(+grant.expireAt, +entitlement.expireAt)), startedBy: actor._id, startedAt: now,
          // Keep the legacy requester/key unique index intact without colliding within a batch.
          idempotencyKey: `staff:${sessionId}:${idempotencyKey}:${grant.serviceId}`, requestHash,
          history: [{ status: 'in_progress', actorId: actor._id, at: now }],
        }], { session });
        requests.push(request);
        notifications.push(await serviceNotifications.create(request, actor._id, session));
        updatedGrants.push(updated);
      }
      await Operation.create([{ sessionId, idempotencyKey, requestHash, actorId: actor._id, requestIds: requests.map((request) => request._id) }], { session });
      return { requests, grants: updatedGrants };
    }, app);
  } catch (error) {
    if (error.code === 11000) {
      const existing = await replay(null);
      if (existing) return existing;
      throw fail('A selected service is already in progress. Refresh the session.', 409);
    }
    throw error;
  }
}

module.exports = { grantBenefits, assertNoOpenRequests, listGrants, listRequests, reserveService, transitionRequest, requestFingerprint, listStaffSessions, sessionBenefits, startServices };
