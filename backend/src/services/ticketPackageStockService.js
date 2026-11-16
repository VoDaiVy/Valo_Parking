const mongoose = require('mongoose');
const Package = require('../models/TicketPackage');
const Subscription = require('../models/Subscription');
const Entitlement = require('../models/MembershipSlotEntitlement');
const { isMembershipPackageType } = require('../utils/ticketPackageRules');

const error = (message, code = 'PACKAGE_SOLD_OUT', statusCode = 409) => Object.assign(new Error(message), { code, statusCode });
const finite = (pkg) => isMembershipPackageType(pkg.type) && pkg.saleLimit != null;
const sourceSlot = (source, floor, slot) => `${source}:${floor}:${String(slot).trim().toUpperCase()}`;

async function transact(session, work) {
  if (session) return work(session);
  const own = await mongoose.startSession();
  try { return await own.withTransaction(() => work(own)); }
  finally { await own.endSession(); }
}

async function lockPackage(packageId, { session } = {}) {
  if (!session) throw error('Package stock lock requires a transaction.', 'STOCK_TRANSACTION_REQUIRED');
  const pkg = await Package.findOneAndUpdate({ _id: packageId }, { $inc: { stockRevision: 1 } }, { new: true, session, timestamps: false });
  if (!pkg) throw error('Ticket package not found.', 'PACKAGE_NOT_FOUND', 404);
  return pkg;
}

async function snapshot(pkg, { session = null, excludeSubscriptionId = null, now = new Date(), ownerId = null } = {}) {
  const excluded = excludeSubscriptionId ? String(excludeSubscriptionId) : null;
  const active = await Entitlement.find({ packageId: pkg._id, ...(ownerId ? { ownerId } : {}), status: { $in: ['active', 'transfer_locked'] }, expireAt: { $gt: now } }).select('sourceSubscriptionId').session(session).lean();
  let allocatedQuantity = active.filter((item) => String(item.sourceSubscriptionId) !== excluded).length;
  const legacy = await Subscription.find({ ticketPackage: pkg._id, ...(ownerId ? { user: ownerId } : {}), status: 'active', paymentStatus: 'paid', expireAt: { $gt: now } }).select('_id slots').session(session).lean();
  const migrated = legacy.length ? await Entitlement.find({ sourceSubscriptionId: { $in: legacy.map((item) => item._id) } }).select('sourceSubscriptionId floorId slotCode').session(session).lean() : [];
  const represented = new Set(migrated.map((item) => sourceSlot(item.sourceSubscriptionId, item.floorId, item.slotCode)));
  for (const sub of legacy) {
    if (String(sub._id) === excluded) continue;
    allocatedQuantity += (sub.slots || []).filter((slot) => !represented.has(sourceSlot(sub._id, slot.floorId, slot.slotCode))).length;
  }
  const pending = await Subscription.find({ ticketPackage: pkg._id, ...(ownerId ? { user: ownerId } : {}), status: 'pending', paymentStatus: 'pending', stockHoldUntil: { $gt: now } }).select('_id slots').session(session).lean();
  const heldQuantity = pending.filter((sub) => String(sub._id) !== excluded).reduce((sum, sub) => sum + (sub.slots || []).length, 0);
  return { saleLimit: finite(pkg) ? pkg.saleLimit : null, allocatedQuantity, heldQuantity,
    remainingQuantity: finite(pkg) ? Math.max(0, pkg.saleLimit - allocatedQuantity - heldQuantity) : null };
}

function availability(pkg, stock, { manualPause, isActive, creating = false } = {}) {
  let paused = pkg.inactiveReason === 'ADMIN_PAUSED' || (!pkg.isActive && pkg.inactiveReason !== 'SOLD_OUT');
  if (creating) paused = isActive === false;
  if (manualPause !== undefined) paused = manualPause;
  else if (isActive !== undefined && isActive !== pkg.isActive) paused = !isActive;
  if (paused) return { isActive: false, inactiveReason: 'ADMIN_PAUSED' };
  if (stock.remainingQuantity === 0) return { isActive: false, inactiveReason: 'SOLD_OUT' };
  return { isActive: true, inactiveReason: null };
}

async function refreshPackage(packageId, { session = null } = {}) {
  return transact(session, async (dbSession) => {
    const pkg = await lockPackage(packageId, { session: dbSession });
    const stock = await snapshot(pkg, { session: dbSession });
    const state = availability(pkg, stock);
    await Package.updateOne({ _id: pkg._id }, { $set: state }, { session: dbSession, timestamps: false });
    Object.assign(pkg, state);
    return { package: pkg, stock };
  });
}

async function refreshAll() {
  const packages = await Package.find({ saleLimit: { $ne: null } }).select('_id saleLimit type').lean();
  for (const pkg of packages.filter(finite)) await refreshPackage(pkg._id);
}

async function reserve(subscription, { session = null, holdUntil } = {}) {
  if (!holdUntil || !Number.isFinite(new Date(holdUntil).getTime()) || new Date(holdUntil) <= new Date()) throw error('Invalid payment hold expiry.', 'INVALID_STOCK_HOLD', 400);
  return transact(session, async (dbSession) => {
    const pkg = await lockPackage(subscription.ticketPackage, { session: dbSession });
    const stock = await snapshot(pkg, { session: dbSession, excludeSubscriptionId: subscription._id });
    const state = availability(pkg, stock);
    if (!state.isActive) throw error(state.inactiveReason === 'ADMIN_PAUSED' ? 'This package is paused by the administrator.' : 'No membership spaces remain for this package.', state.inactiveReason === 'ADMIN_PAUSED' ? 'PACKAGE_PAUSED' : 'PACKAGE_SOLD_OUT');
    const quantity = subscription.slots?.length || 0;
    if (!quantity || (finite(pkg) && stock.remainingQuantity < quantity)) throw error('Not enough membership spaces remain for this package.');
    const held = await Subscription.updateOne({ _id: subscription._id, status: 'pending', paymentStatus: 'pending' }, { $set: { stockHoldUntil: holdUntil } }, { session: dbSession });
    if (held.matchedCount !== 1) throw error('Payment order is no longer pending.', 'ORDER_NOT_PENDING');
    subscription.stockHoldUntil = holdUntil;
    return refreshPackage(pkg._id, { session: dbSession });
  });
}

async function ensureActivation(subscription, { session = null, allowPaused = false } = {}) {
  return transact(session, async (dbSession) => {
    const pkg = await lockPackage(subscription.ticketPackage, { session: dbSession });
    const stock = await snapshot(pkg, { session: dbSession, excludeSubscriptionId: subscription._id });
    const hasHold = subscription.stockHoldUntil && new Date(subscription.stockHoldUntil) > new Date();
    const existingActivation = subscription.activatedAt && subscription.expireAt > new Date();
    if (!allowPaused && !hasHold && !existingActivation && availability(pkg, stock).inactiveReason === 'ADMIN_PAUSED') throw error('This package is paused by the administrator.', 'PACKAGE_PAUSED');
    const quantity = subscription.slots?.length || 0;
    if (!quantity || (finite(pkg) && stock.remainingQuantity < quantity)) throw error('Payment received, but the package no longer has enough available spaces. Please contact support.', 'PACKAGE_CAPACITY_UNAVAILABLE');
    return stock;
  });
}

async function release(subscription, { session = null } = {}) {
  return transact(session, async (dbSession) => {
    await lockPackage(subscription.ticketPackage, { session: dbSession });
    await Subscription.updateOne({ _id: subscription._id }, { $unset: { stockHoldUntil: 1 } }, { session: dbSession });
    subscription.stockHoldUntil = undefined;
    return refreshPackage(subscription.ticketPackage, { session: dbSession });
  });
}

async function assertAvailable(packageId, quantity, { session = null, allowSoldOut = false } = {}) {
  return transact(session, async (dbSession) => {
    const pkg = await lockPackage(packageId, { session: dbSession });
    const stock = await snapshot(pkg, { session: dbSession });
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw error('Invalid space quantity.', 'INVALID_STOCK_QUANTITY', 400);
    if (!allowSoldOut && !availability(pkg, stock).isActive) throw error('This package is not available for new purchases.');
    if (finite(pkg) && stock.remainingQuantity < quantity) throw error('No capacity remains for this membership renewal.', 'PACKAGE_CAPACITY_UNAVAILABLE');
    return stock;
  });
}

async function getBuyers(packageId, query = {}) {
  if (!mongoose.isObjectIdOrHexString(packageId)) throw error('Invalid ticket package ID.', 'INVALID_PACKAGE_ID', 400);
  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || Array.isArray(query.page)) throw error('Invalid page.', 'INVALID_PAGE', 400);
  const id = new mongoose.Types.ObjectId(String(packageId));
  const pkg = await Package.findById(id).lean();
  if (!pkg) throw error('Ticket package not found.', 'PACKAGE_NOT_FOUND', 404);
  const grouped = [
    { $match: { ticketPackage: id, paymentStatus: 'paid', status: { $in: ['active', 'expired'] } } },
    { $group: { _id: '$user', purchasedQuantity: { $sum: { $size: { $ifNull: ['$slots', []] } } }, orderCount: { $sum: 1 }, lastPurchasedAt: { $max: { $ifNull: ['$firstPaidAt', '$createdAt'] } } } },
  ];
  const summaryRows = await Subscription.aggregate([...grouped, { $group: { _id: null, uniqueBuyers: { $sum: 1 }, orderCount: { $sum: '$orderCount' }, purchasedQuantity: { $sum: '$purchasedQuantity' } } }]);
  const items = await Subscription.aggregate([...grouped, { $sort: { lastPurchasedAt: -1, _id: 1 } }, { $skip: (page - 1) * 20 }, { $limit: 20 },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'users' } },
    { $project: { _id: 0, user: { _id: '$_id', name: { $ifNull: [{ $arrayElemAt: ['$users.username', 0] }, 'Deleted account'] }, email: { $arrayElemAt: ['$users.email', 0] } }, purchasedQuantity: 1, orderCount: 1, lastPurchasedAt: 1 } },
  ]);
  for (const item of items) item.activeQuantity = (await snapshot(pkg, { ownerId: item.user._id })).allocatedQuantity;
  const stock = await snapshot(pkg);
  const summary = { uniqueBuyers: 0, orderCount: 0, purchasedQuantity: 0, ...(summaryRows[0] || {}), activeQuantity: stock.allocatedQuantity };
  delete summary._id;
  return { items, pagination: { page, limit: 20, total: summary.uniqueBuyers, totalPages: Math.ceil(summary.uniqueBuyers / 20) }, summary };
}

module.exports = { lockPackage, snapshot, availability, reserve, ensureActivation, release, refreshPackage, refreshAll, getBuyers, transact, assertAvailable };
