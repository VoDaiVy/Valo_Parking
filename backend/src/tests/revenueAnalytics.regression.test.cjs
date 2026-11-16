const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Booking = require('../models/Booking');
const BookingService = require('../models/BookingService');
const Subscription = require('../models/Subscription');
const Renewal = require('../models/SubscriptionRenewal');
const EntitlementRenewal = require('../models/MembershipEntitlementRenewal');
const WalletTransaction = require('../models/WalletTransaction');
const Session = require('../models/Session');
const TicketPackage = require('../models/TicketPackage');
const { getAdminPlatformRevenueStatistics, _private: helpers } = require('../services/statisticsService');
const oid = () => new mongoose.Types.ObjectId();
const date = value => new Date(value);
const november = { mode: 'month', year: '2026', month: '11' };

// No .env, application server or production URI is used. Every write below is
// fixture data in a fresh, disposable MongoDB instance owned by this test.
test('Revenue Analytics reconciles actual records end-to-end in an isolated database', async t => {
  const server = await MongoMemoryServer.create({ binary: { downloadDir: path.join(os.tmpdir(), 'valo-revenue-mongodb-binaries') }, instance: { dbName: 'revenue_analytics_regression' } });
  await mongoose.connect(server.getUri(), { autoIndex: false });
  try {
    const ids = Array.from({ length: 6 }, oid), packageId = oid(), subId = oid();
    const paid = date('2026-11-10T03:00:00Z');
    await Booking.collection.insertMany(ids.map((_id, index) => ({ _id, prepaidAmount: index === 1 ? 8000 : 10000,
      status: ['COMPLETED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'PENDING'][index],
      scheduledStart: paid, createdAt: paid, updatedAt: paid,
      ...(index === 2 ? { cancelledAt: paid } : index !== 3 ? { completedAt: paid } : {}),
      paymentBreakdownSnapshot: { source: 'calculated', serviceAmount: index === 0 || index === 2 ? 2000 : 0 },
      paidOverageAdjustments: index === 4 ? [{ amount: 3000, paidAt: paid }] : [],
      refundSettlements: index === 0 ? [{ payoutStatus: 'credited', netWalletAmount: 1000, refundableServiceAmount: 0 }]
        : index === 2 ? [{ payoutStatus: 'credited', netWalletAmount: 9000, refundableServiceAmount: 2000 }]
          : index === 4 ? [{ payoutStatus: 'debited', netWalletAmount: -2000 }] : [],
    })));
    await BookingService.collection.insertOne({ bookingId: ids[0], status: 'done', price: 2000 });
    await WalletTransaction.collection.insertMany([
      ...[[ids[0], 1000, 'early'], [ids[1], 2000, `booking:${ids[1]}:modification:1`], [ids[2], 9000, 'cancel']].map(([refSourceId, amount, idempotencyKey]) => ({ type: 'REFUND', status: 'COMPLETED', refSource: 'booking', refSourceId, amount, idempotencyKey, createdAt: paid })),
      { type: 'PAYMENT', status: 'COMPLETED', refSource: 'booking_order', refSourceId: oid(), amount: 10000, createdAt: paid, description: 'Individual order payment' },
      { type: 'TRANSFER_FEE', status: 'COMPLETED', amount: 500, createdAt: paid },
      { type: 'TRANSFER_OUT', status: 'COMPLETED', amount: 100000, createdAt: paid },
      { type: 'TOP_UP', status: 'COMPLETED', amount: 999999, createdAt: paid },
      { type: 'PAYMENT', status: 'FAILED', refSource: 'booking', amount: 999999, createdAt: paid },
      { type: 'TRANSFER_FEE', status: 'COMPLETED', amount: 1, createdAt: date('2022-01-01T00:00:00Z') },
      { type: 'PAYMENT', status: 'COMPLETED', refSource: 'subscription', refSourceId: subId, amount: 50000, createdAt: date('2026-10-31T17:00:00Z') },
    ]);
    await TicketPackage.collection.insertOne({ _id: packageId, name: 'Actual package', type: 'monthly', isActive: true });
    await Subscription.collection.insertMany([
      { _id: subId, ticketPackage: packageId, paymentStatus: 'paid', amount: 50000, orderCode: 1, createdAt: date('2026-10-01T00:00:00Z'), rewardPayments: [
        { _id: oid(), orderCode: 1, amount: 50000, paidAt: date('2026-10-31T17:00:00Z') },
        { _id: oid(), orderCode: 2, amount: 10000, paidAt: date('2026-11-02T00:00:00Z') },
        { _id: oid(), orderCode: 3, amount: 12000, paidAt: date('2026-11-03T00:00:00Z') },
      ] },
      { ticketPackage: packageId, paymentStatus: 'paid', amount: 5000, orderCode: 4, createdAt: date('2026-11-05T00:00:00Z') },
      { ticketPackage: packageId, paymentStatus: 'pending', amount: 999999, orderCode: 5, createdAt: paid },
    ]);
    await Renewal.collection.insertOne({ subscriptionId: subId, status: 'paid', paymentMethod: 'payos', orderCode: 3, amount: 12000, paidAt: date('2026-11-03T00:00:00Z') });
    await EntitlementRenewal.collection.insertOne({ sourceSubscriptionId: subId, status: 'paid', paymentMethod: 'wallet', amount: 8000, paidAt: date('2026-11-04T00:00:00Z') });
    await Session.collection.insertMany([
      { status: 'active', checkInTime: date('2026-11-01T00:00:00Z'), checkOutTime: null },
      { status: 'completed', checkInTime: date('2026-10-01T00:00:00Z'), checkOutTime: paid },
      { status: 'completed', checkInTime: paid, checkOutTime: paid },
      { status: 'cancelled', checkInTime: paid, checkOutTime: paid },
    ]);
    const result = await getAdminPlatformRevenueStatistics(november);
    await t.test('net booking/service totals include finalized cancellation fees and exclude transient expiry without double refunds', () => {
      assert.equal(result.summary.bookingRevenue, 31000);
      assert.equal(result.summary.serviceRevenue, 2000);
      assert.equal(result.summary.refunds, 12000); // includes modification refunds for disclosure, without deducting them again
      assert.equal(result.summary.membershipTransferFees, 500);
      assert.equal(result.summary.totalRevenue, 118500);
    });
    await t.test('paid timestamps, legacy renewals, and modern duplicate mirrors reconcile to package rows', () => {
      assert.equal(result.summary.packageRevenue, 85000);
      assert.equal(result.packageBreakdown[0].purchaseCount, 2);
      assert.equal(result.packageBreakdown[0].renewalCount, 3);
      assert.equal(result.packageBreakdown[0].packageName, 'Actual package');
      assert.equal(result.trend[0].packageRevenue, 50000);
      for (const key of ['totalRevenue', 'bookingRevenue', 'serviceRevenue', 'packageRevenue', 'membershipTransferFees', 'refunds']) {
        assert.equal(result.trend.reduce((sum, row) => sum + row[key], 0), result.summary[key], key);
      }
      assert.equal(result.packageBreakdown.reduce((sum, row) => sum + row.totalAmount, 0), result.summary.packageRevenue);
      assert.ok(result.availableYears.includes(2022));
    });
    await t.test('traffic counts valid entry/exit events; booking statuses use scheduled start, including pending', () => {
      assert.deepEqual(result.trafficSummary, { totalEntries: 2, totalExits: 2, currentlyParked: 1 });
      assert.equal(result.statusDistribution.totalBookings, 6);
      assert.equal(result.statusDistribution.byStatus.find(row => row.status === 'PENDING').count, 1);
    });
    await t.test('recent transactions contain actual payment records and exclude top-ups, transfers, and failures', async () => {
      assert.equal(result.recentTransactions.length, 4);
      const pages = await Promise.all(Array.from({ length: result.transactionPagination.totalPages }, (_, index) =>
        getAdminPlatformRevenueStatistics({ ...november, transactionPage: index + 1 })));
      const transactions = pages.flatMap(page => page.recentTransactions);
      assert.equal(transactions.length, 10);
      assert.equal(new Set(transactions.map(row => row.id)).size, 10);
      assert.ok(transactions.some(row => row.description === 'Individual order payment'));
      assert.ok(transactions.some(row => row.dateBasis === 'legacy_created_at'));
      assert.ok(transactions.every(row => row.amount !== 999999 && row.amount !== 100000));
      assert.ok(transactions.every((row, index, rows) => !index || new Date(rows[index - 1].paidAt) >= new Date(row.paidAt)));
    });
    await t.test('API data passes frontend integrity validation, and refresh reads new records', async () => {
      const { inspectRevenueResponse } = await import(pathToFileURL(path.resolve(__dirname, '../../../frontend/src/pages/Admin/revenueAnalyticsData.js')));
      assert.deepEqual(inspectRevenueResponse(result).issues, []);
      await WalletTransaction.collection.insertOne({ type: 'TRANSFER_FEE', status: 'COMPLETED', amount: 250, createdAt: paid });
      const refreshed = await getAdminPlatformRevenueStatistics(november);
      assert.equal(refreshed.summary.totalRevenue, result.summary.totalRevenue + 250);
      assert.equal(refreshed.transactionPagination.total, result.transactionPagination.total + 1);
      assert.equal(refreshed.recentTransactions.length, 4);
    });
    await t.test('controller validates mode filters before DB access and returns the real report contract', async () => {
      const { statisticsQueryValidator } = require('../validators/statisticsValidator');
      const controller = require('../controllers/statisticsController');
      for (const [query, status] of [[{ mode: 'month', month: '13' }, 400], [november, 200]]) {
        const req = { query };
        for (const validator of statisticsQueryValidator) await validator.run(req);
        let code, response;
        const res = { status(value) { code = value; return this; }, json(value) { response = value; } };
        await controller.getAdminPlatformRevenue(req, res, error => { throw error; });
        assert.equal(code, status);
        assert.equal(response.success, status === 200);
        if (status === 200) assert.ok(Array.isArray(response.data.recentTransactions));
      }
    });
    await t.test('empty periods return true zero totals and empty records, not fabricated payments', async () => {
      const empty = await getAdminPlatformRevenueStatistics({ mode: 'month', year: '2025', month: '2' });
      assert.equal(empty.summary.totalRevenue, 0);
      assert.deepEqual(empty.packageBreakdown, []); assert.deepEqual(empty.recentTransactions, []);
      assert.equal(empty.trend.length, 28);
    });
    await t.test('exclusive Vietnam month boundaries exclude the following month', async () => {
      await WalletTransaction.collection.insertMany([
        { type: 'TRANSFER_FEE', status: 'COMPLETED', amount: 70, createdAt: date('2026-11-30T16:59:59.999Z') },
        { type: 'TRANSFER_FEE', status: 'COMPLETED', amount: 999, createdAt: date('2026-11-30T17:00:00Z') },
      ]);
      const refreshed = await getAdminPlatformRevenueStatistics(november);
      assert.equal(refreshed.summary.membershipTransferFees, 820);
      assert.equal(refreshed.trend.at(-1).membershipTransferFees, 70);
    });    await t.test('orphaned renewal snapshots retain package attribution; mirrored wallet renewals count once', async () => {
      const archivedId = oid(), walletId = oid();
      await EntitlementRenewal.collection.insertOne({ sourceSubscriptionId: oid(), status: 'paid', amount: 3000, paymentMethod: 'payos', paidAt: paid,
        packageSnapshot: { id: archivedId, name: 'Historical package name', type: 'yearly' } });
      await Subscription.collection.updateOne({ _id: subId }, { $push: { rewardPayments: { _id: oid(), paymentKey: `wallet:${walletId}`, amount: 4000, paidAt: paid } } });
      await Renewal.collection.insertOne({ subscriptionId: subId, status: 'paid', amount: 4000, paymentMethod: 'wallet', walletTransactionId: walletId, paidAt: paid });
      const refreshed = await getAdminPlatformRevenueStatistics(november);
      assert.equal(refreshed.summary.packageRevenue, 92000);
      assert.equal(refreshed.packageBreakdown.find(row => row.packageId === String(archivedId)).packageName, 'Historical package name');
      for (const mode of ['7d', 'quarter', 'year', 'years']) {
        const report = await getAdminPlatformRevenueStatistics({ mode, year: 2026, quarter: 4 });
        const { inspectRevenueResponse } = await import(pathToFileURL(path.resolve(__dirname, '../../../frontend/src/pages/Admin/revenueAnalyticsData.js')));
        assert.deepEqual(inspectRevenueResponse(report).issues, [], mode);
      }
    });

  } finally {
    await mongoose.disconnect(); await server.stop();
  }
});

test('all supported modes use exclusive Vietnam boundaries and correct bucket counts', () => {
  const now = date('2026-11-09T17:30:00Z');
  const week = helpers.resolveModeDateRange({ mode: '7d' }, now);
  assert.equal(week.startDate.toISOString(), '2026-11-03T17:00:00.000Z');
  assert.equal(week.endDate.toISOString(), '2026-11-10T17:00:00.000Z');
  assert.equal(helpers.generateBucketLabels(week.startDate, week.endDate, week.granularity).length, 7);
  for (const [filters, count] of [
    [{ mode: 'month', year: 2024, month: 2 }, 29],
    [{ mode: 'quarter', year: 2026, quarter: 4 }, 3],
    [{ mode: 'year', year: 2026 }, 12],
    [{ mode: 'years' }, 5],
  ]) {
    const period = helpers.resolveModeDateRange(filters, now, 2022);
    assert.equal(helpers.generateBucketLabels(period.startDate, period.endDate, period.granularity).length, count);
    assert.equal(period.startDate.getUTCHours(), 17);
    assert.equal(period.endDate.getUTCHours(), 17);
  }
});
