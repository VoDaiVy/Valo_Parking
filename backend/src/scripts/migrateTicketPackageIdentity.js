const path = require('path');
const mongoose = require('mongoose');
const { packageIdentity, IDENTITY_INDEX } = require('../utils/ticketPackageIdentity');

// Run with catalog writes stopped. Audit is read-only; --apply requires an explicit URI.
async function migrate(collection, apply = false) {
  const packages = await collection.find({}, { projection: { type: 1, price: 1, serviceBenefits: 1 } }).toArray();
  const groups = new Map();
  for (const pkg of packages) {
    if (typeof pkg.type !== 'string' || !Number.isFinite(pkg.price) || pkg.price < 0) {
      throw new Error(`Gói ${pkg._id} có loại hoặc giá không hợp lệ; cần xử lý trước.`);
    }
    const key = packageIdentity(pkg);
    groups.set(key, [...(groups.get(key) || []), String(pkg._id)]);
  }
  const duplicates = [...groups.entries()].filter(([, ids]) => ids.length > 1).map(([identityKey, ids]) => ({ identityKey, ids }));
  const report = { mode: apply ? 'apply' : 'audit', count: packages.length, duplicates };
  if (!apply || duplicates.length) return report;
  if (packages.length) await collection.bulkWrite(packages.map((pkg) => ({ updateOne: {
    filter: { _id: pkg._id }, update: { $set: { identityKey: packageIdentity(pkg) } },
  } })));
  await collection.createIndex({ identityKey: 1 }, { unique: true, sparse: true, name: IDENTITY_INDEX });
  return { ...report, indexCreated: true };
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  const apply = process.argv.includes('--apply');
  const uriPosition = process.argv.indexOf('--uri');
  const explicitUri = uriPosition >= 0 ? process.argv[uriPosition + 1] : null;
  if (apply && (!explicitUri || explicitUri.startsWith('--'))) throw new Error('--apply yêu cầu --uri chỉ rõ database đích. Dừng các luồng ghi gói trước khi chạy.');
  const uri = explicitUri || process.env.MONGODB_URI;
  if (!uri) throw new Error('Thiếu MONGODB_URI hoặc --uri.');
  try {
    await mongoose.connect(uri, { autoIndex: false });
    const report = await migrate(mongoose.connection.collection('ticketpackages'), apply);
    console.log(JSON.stringify(report, null, 2));
    if (report.duplicates.length) process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { migrate };
