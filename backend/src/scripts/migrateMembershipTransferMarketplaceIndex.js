const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MembershipEntitlementTransfer = require('../models/MembershipEntitlementTransfer');

const LEGACY_INDEX_NAME = 'one_open_transfer_per_entitlement';
const INDEX_NAME = 'one_open_transfer_per_entitlement_v2';
const BROWSE_INDEX_NAME = 'membership_transfer_marketplace_browse';
const OPEN_STATUSES = [
  'PENDING_RECIPIENT',
  'PENDING_ADMIN',
  'LISTED',
  'AWAITING_PAYMENT',
];
const applyChanges = process.argv.includes('--apply');

const expectedFilter = { status: { $in: OPEN_STATUSES } };

const sameFilter = (value) => {
  const statuses = value?.status?.$in;
  return (
    Array.isArray(statuses) &&
    statuses.length === OPEN_STATUSES.length &&
    OPEN_STATUSES.every((status) => statuses.includes(status))
  );
};

const main = async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI);

  const collection = MembershipEntitlementTransfer.collection;
  const duplicateGroups = await MembershipEntitlementTransfer.aggregate([
    { $match: { status: { $in: OPEN_STATUSES } } },
    {
      $group: {
        _id: '$entitlementId',
        count: { $sum: 1 },
        transferIds: { $push: '$_id' },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);
  const indexes = await collection.indexes();
  const currentIndex = indexes.find((index) => index.name === INDEX_NAME);
  const indexIsCurrent =
    currentIndex?.unique === true &&
    sameFilter(currentIndex.partialFilterExpression);

  const report = {
    mode: applyChanges ? 'apply' : 'dry-run',
    missingModeCount: await MembershipEntitlementTransfer.countDocuments({
      mode: { $exists: false },
    }),
    duplicateGroups,
    currentIndex: currentIndex || null,
    indexIsCurrent,
  };

  if (duplicateGroups.length) {
    console.log(JSON.stringify(report, null, 2));
    throw new Error('Duplicate open transfers found; resolve them before migrating.');
  }

  if (!applyChanges) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const backfill = await collection.updateMany(
    { mode: { $exists: false } },
    { $set: { mode: 'DIRECT' } }
  );

  if (!indexIsCurrent) {
    if (currentIndex) await collection.dropIndex(INDEX_NAME);
    await collection.createIndex(
      { entitlementId: 1 },
      {
        name: INDEX_NAME,
        unique: true,
        partialFilterExpression: expectedFilter,
      }
    );
  }
  await collection.createIndex(
    { mode: 1, status: 1, listingExpiresAt: 1, askingPrice: 1 },
    { name: BROWSE_INDEX_NAME }
  );

  const legacyIndex = (await collection.indexes()).find(
    (index) => index.name === LEGACY_INDEX_NAME
  );
  if (legacyIndex) await collection.dropIndex(LEGACY_INDEX_NAME);

  const finalIndex = (await collection.indexes()).find(
    (index) => index.name === INDEX_NAME
  );
  if (!finalIndex?.unique || !sameFilter(finalIndex.partialFilterExpression)) {
    throw new Error('Marketplace transfer index verification failed.');
  }

  console.log(
    JSON.stringify(
      {
        ...report,
        backfilledModes: backfill.modifiedCount,
        finalIndex,
        success: true,
      },
      null,
      2
    )
  );
};

main()
  .catch((error) => {
    console.error('[MembershipTransferMarketplaceMigration] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
