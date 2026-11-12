// Additive only. Default is read-only preflight; --apply creates missing indexes.
// Never drops indexes, rewrites documents, or resolves duplicates automatically.
require('dotenv').config();
const mongoose = require('mongoose');
const models = [
  require('../models/TicketPackage'), require('../models/Subscription'),
  require('../models/CheckoutAttempt'), require('../models/MembershipSlotEntitlement'),
  require('../models/Session'), require('../models/Slot'), require('../models/StaffSubscriptionAction'), require('../models/WalletTransaction'),
  require('../models/SubscriptionRenewal'), require('../models/MembershipEntitlementRenewal'),
];

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  const apply = process.argv.includes('--apply');
  try {
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('A replica set or sharded cluster is required for payment transactions.');
    const build = await mongoose.connection.db.admin().command({ buildInfo: 1 });
    if (Number(build.versionArray?.[0]) < 6) throw new Error('MongoDB 6.0+ is required for the partial index filters.');
    const planned = [];
    for (const model of models) {
      const existing = await model.collection.indexes().catch((error) => {
        if (error.code === 26) return [];
        throw error;
      });
      for (const [keys, options] of model.schema.indexes().filter(([, options]) => options.unique)) {
        const name = options.name || Object.entries(keys).map(([key, value]) => `${key}_${value}`).join('_');
        const match = options.partialFilterExpression || (options.sparse ? { $or: Object.keys(keys).map((key) => ({ [key]: { $exists: true } })) } : {});
        const duplicates = await model.aggregate([
          { $match: match },
          { $group: { _id: Object.fromEntries(Object.keys(keys).map((key, i) => [`k${i}`, `$${key}`])), count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } }, { $limit: 1 },
        ]);
        if (duplicates.length) throw new Error(`${model.collection.name}.${name}: duplicate data requires manual reconciliation. No indexes have been changed.`);
        const installed = existing.find((index) => index.name === name);
        if (installed && (JSON.stringify(installed.key) !== JSON.stringify(keys) || installed.unique !== true
          || JSON.stringify(installed.partialFilterExpression || {}) !== JSON.stringify(options.partialFilterExpression || {})
          || Boolean(installed.sparse) !== Boolean(options.sparse))) {
          throw new Error(`${model.collection.name}.${name}: incompatible existing index. Review manually; this script does not drop indexes.`);
        }
        if (!installed) planned.push({ model, keys, options, name });
      }
    }
    console.log(`Preflight passed. ${planned.length} missing unique indexes. Mode: ${apply ? 'apply' : 'read-only'}.`);
    for (const { model, keys, options, name } of planned) {
      if (apply) await model.collection.createIndex(keys, options);
      console.log(`${apply ? 'Installed' : 'Required'} ${model.collection.name}.${name}`);
    }
  } finally { await mongoose.disconnect(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
