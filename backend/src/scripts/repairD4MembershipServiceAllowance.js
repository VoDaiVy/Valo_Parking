// One-account repair authorized by the user. Dry-run unless --apply is supplied.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const mongoose = require('mongoose');
const assert = require('node:assert/strict');
const { ObjectId } = mongoose.mongo;
const ids = {
  purchase: new ObjectId('6afddd2a9abba2f7b5567933'),
  entitlement: new ObjectId('6afddd2d2470b2b42caabc02'),
  package: new ObjectId('6afd8f09e465b09346f2a97f'),
  service: new ObjectId('6a3a07972703c3b916c3195c'),
};
const apply = process.argv.includes('--apply');
const same = (a, b) => String(a) === String(b);

async function repair(session) {
  const db = mongoose.connection.db;
  const opts = session ? { session } : {};
  const purchases = db.collection('subscriptions');
  const entitlements = db.collection('membershipslotentitlements');
  const grants = db.collection('membershipservicegrants');
  const [purchase, entitlement, pkg, service] = await Promise.all([
    purchases.findOne({ _id: ids.purchase }, opts),
    entitlements.findOne({ _id: ids.entitlement }, opts),
    db.collection('ticketpackages').findOne({ _id: ids.package }, opts),
    db.collection('services').findOne({ _id: ids.service }, opts),
  ]);
  assert(purchase && entitlement && pkg && service, 'REPAIR_RECORD_MISSING');
  assert(purchase.paymentStatus === 'paid' && purchase.status === 'active', 'PURCHASE_NOT_PAID_ACTIVE');
  assert(same(purchase.ticketPackage, ids.package) && pkg.name === 'Annual Signature', 'WRONG_PACKAGE');
  assert(same(entitlement.sourceSubscriptionId, ids.purchase) && same(entitlement.ownerId, purchase.user), 'OWNERSHIP_CHANGED');
  assert(same(entitlement.packageId, ids.package) && entitlement.slotCode === 'D4' && entitlement.status === 'active', 'WRONG_ENTITLEMENT');
  assert(!entitlement.transferCount && new Date(entitlement.expireAt) > new Date(), 'ENTITLEMENT_CHANGED_OR_EXPIRED');
  assert(purchase.slots.length === 1 && purchase.slots[0].slotCode === 'D4' && same(purchase.slots[0].floorId, entitlement.floorId), 'WRONG_PURCHASE_SCOPE');
  assert(pkg.revision === 4 && pkg.benefitsVersion === 1 && pkg.type === 'yearly', 'CATALOG_CHANGED');
  assert(new Date(pkg.updatedAt) <= new Date(purchase.createdAt), 'CATALOG_CHANGED_AFTER_PURCHASE');
  assert(purchase.amount === pkg.price && service.isActive === true, 'PRICE_OR_SERVICE_CHANGED');
  const benefit = pkg.serviceBenefits?.find((item) => same(item.serviceId, ids.service));
  assert(pkg.serviceBenefits?.length === 1 && benefit?.quantityPerSlot === 24, 'BENEFITS_CHANGED');
  const sourceKey = `purchase:${ids.purchase}`;
  const existing = await grants.find({ entitlementId: ids.entitlement }, opts).toArray();
  const requests = await db.collection('membershipservicerequests').countDocuments({ entitlementId: ids.entitlement }, opts);
  if (existing.length) {
    assert(existing.length === 1 && same(existing[0].serviceId, ids.service) && existing[0].sourceKey === sourceKey && existing[0].total === 24, 'EXISTING_GRANTS_REQUIRE_REVIEW');
    assert(purchase.packageTermsSnapshot?.serviceBenefits?.[0]?.quantityPerSlot === 24 && entitlement.packageTermsSnapshot?.serviceBenefits?.[0]?.quantityPerSlot === 24, 'PARTIAL_REPAIR_REQUIRES_REVIEW');
    return { state: 'already_repaired', total: 24, used: existing[0].used, reserved: existing[0].reserved, available: 24 - existing[0].used - existing[0].reserved };
  }
  assert(requests === 0, 'SERVICE_HISTORY_REQUIRES_REVIEW');
  assert(!purchase.packageTermsSnapshot && !entitlement.packageTermsSnapshot, 'SNAPSHOT_ALREADY_EXISTS');
  const validFrom = new Date(purchase.validFrom);
  const expireAt = new Date(entitlement.expireAt);
  const summary = { state: apply ? 'repaired' : 'dry_run', purchaseId: String(ids.purchase), entitlementId: String(ids.entitlement), slotCode: 'D4',
    serviceName: service.name, total: 24, used: 0, reserved: 0, available: 24, validFrom, expireAt };
  if (!apply) return summary;
  assert(session?.inTransaction(), 'TRANSACTION_REQUIRED');
  const now = new Date();
  const terms = { name: pkg.name, unitPrice: purchase.amount, type: pkg.type, durationDays: pkg.durationDays ?? null,
    durationMinutes: pkg.durationMinutes ?? null, benefitsVersion: 1, displayBenefits: pkg.displayBenefits || [],
    serviceBenefits: [{ serviceId: ids.service, serviceName: service.name, quantityPerSlot: 24 }], revision: pkg.revision,
    recovery: { reason: 'User-approved restoration of missing purchased service terms for D4 only', restoredAt: now } };
  const snapshot = { packageTermsSnapshot: terms, packageDurationSnapshot: { type: 'yearly', durationDays: null, durationMinutes: null } };
  const purchaseWrite = await purchases.updateOne({ _id: ids.purchase, user: purchase.user, paymentStatus: 'paid', packageTermsSnapshot: null }, { $set: snapshot }, opts);
  const entitlementWrite = await entitlements.updateOne({ _id: ids.entitlement, ownerId: purchase.user, status: 'active', packageTermsSnapshot: null },
    { $set: snapshot, $inc: { serviceUsageRevision: 1 } }, opts);
  assert(purchaseWrite.modifiedCount === 1 && entitlementWrite.modifiedCount === 1, 'REPAIR_CONFLICT');
  await grants.updateOne({ entitlementId: ids.entitlement, sourceKey, serviceId: ids.service }, {
    $setOnInsert: { serviceName: service.name, total: 24, used: 0, reserved: 0, validFrom, expireAt, createdAt: now, updatedAt: now },
  }, { ...opts, upsert: true });
  return summary;
}

async function run() {
  const timeout = setTimeout(() => { console.error('REPAIR_TIMEOUT'); process.exit(2); }, 30000);
  try {
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 7000, connectTimeoutMS: 7000, socketTimeoutMS: 7000 });
    let result;
    if (apply) {
      const session = await mongoose.startSession();
      try { result = await session.withTransaction(() => repair(session)); }
      finally { await session.endSession(); }
    } else result = await repair(null);
    console.log(JSON.stringify(result));
    if (result.state === 'repaired' || result.state === 'already_repaired') {
      require('../models/Service');
      const purchase = await mongoose.connection.db.collection('subscriptions').findOne({ _id: ids.purchase }, { projection: { user: 1 } });
      const pool = await require('../services/membershipServiceSelectionService').pool(purchase.user);
      const restored = pool.find((grant) => same(grant.entitlementId, ids.entitlement) && same(grant.serviceId, ids.service));
      assert(restored && restored.canUse, 'RESTORED_SERVICE_NOT_SELECTABLE');
      console.log(JSON.stringify({ verifiedSelectable: true, slotCode: restored.slotCode, serviceName: restored.serviceName,
        total: restored.total, used: restored.used, reserved: restored.reserved, available: restored.available }));
    }
  } catch (error) {
    console.error(JSON.stringify({ repairFailed: true, errorType: error.name, reason: error.code === 'ERR_ASSERTION' ? error.message : error.code || 'DATABASE_ERROR' }));
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    clearTimeout(timeout);
  }
}
run();
