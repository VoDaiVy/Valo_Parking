// Read-only diagnostic. Never print connection strings or user contact data.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const mongoose = require('mongoose');
const timeout = setTimeout(() => { console.error('AUDIT_TIMEOUT'); process.exit(2); }, 25000);

async function run() {
  try {
    if (!process.env.MONGODB_URI) throw new Error('MISSING_DATABASE_CONFIG');
    console.log('AUDIT_CONNECTING');
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 7000, connectTimeoutMS: 7000, socketTimeoutMS: 7000 });
    const db = mongoose.connection.db;
    const packages = await db.collection('ticketpackages').find({ name: { $in: ['Annual Signature', 'Premium Monthly'] } }, {
      projection: { name: 1, serviceBenefits: 1, benefitsVersion: 1, revision: 1, updatedAt: 1 },
    }).toArray();
    console.log(JSON.stringify({ packages }));
    const purchases = await db.collection('subscriptions').find({ ticketPackage: { $in: packages.map((p) => p._id) }, status: 'active', 'slots.slotCode': 'D4' }, {
      projection: { ticketPackage: 1, packageTermsSnapshot: 1, slots: 1, validFrom: 1, createdAt: 1, paymentStatus: 1 },
    }).sort({ createdAt: -1 }).limit(3).toArray();
    for (const purchase of purchases) {
      const entitlements = await db.collection('membershipslotentitlements').find({ sourceSubscriptionId: purchase._id }, {
        projection: { slotCode: 1, packageTermsSnapshot: 1, validFrom: 1, expireAt: 1, status: 1 },
      }).toArray();
      const grants = await db.collection('membershipservicegrants').find({ entitlementId: { $in: entitlements.map((e) => e._id) } }, {
        projection: { entitlementId: 1, serviceId: 1, total: 1, reserved: 1, used: 1, sourceKey: 1 },
      }).toArray();
      console.log(JSON.stringify({ purchase, entitlements, grants }));
    }
    console.log('AUDIT_COMPLETE');
  } catch (error) {
    console.error(JSON.stringify({ auditFailed: true, errorType: error.name, code: error.code || null }));
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    clearTimeout(timeout);
  }
}
run();
