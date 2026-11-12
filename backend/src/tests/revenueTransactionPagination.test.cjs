const { test } = require('node:test');
const assert = require('node:assert/strict');
const { paginateRevenueTransactions } = require('../services/revenueTransactionPagination');

const records = Array.from({ length: 35 }, (_, index) => ({
  id: String(index).padStart(3, '0'), paidAt: new Date(Date.UTC(2026, 10, 1, 0, index)),
  type: index % 2 ? 'PACKAGE_PURCHASE' : 'PAYMENT', amount: index * 1000,
}));

test('pages all merged sources beyond the previous 20-record cap without omissions', () => {
  const original = [...records];
  const pages = Array.from({ length: 9 }, (_, index) => index + 1).map(page => paginateRevenueTransactions(records, page));
  assert.deepEqual(pages.map(result => result.recentTransactions.length), [4, 4, 4, 4, 4, 4, 4, 4, 3]);
  assert.deepEqual(pages[2].transactionPagination, { page: 3, pageSize: 4, total: 35, totalPages: 9 });
  const merged = pages.flatMap(result => result.recentTransactions);
  assert.deepEqual(merged.map(row => row.id), [...records].reverse().map(row => row.id));
  assert.equal(new Set(merged.map(row => row.id)).size, 35);
  assert.deepEqual(records, original);
  assert.equal(merged.reduce((sum, row) => sum + row.amount, 0), records.reduce((sum, row) => sum + row.amount, 0));
});

test('normalizes query values and clamps pages after filters reduce the result count', () => {
  for (const value of [undefined, '', 'invalid', -1, 0, 1.5, Infinity]) {
    assert.equal(paginateRevenueTransactions(records, value).transactionPagination.page, 1);
  }
  assert.equal(paginateRevenueTransactions(records, '2').transactionPagination.page, 2);
  assert.equal(paginateRevenueTransactions(records.slice(0, 3), 99).transactionPagination.page, 1);
  assert.deepEqual(paginateRevenueTransactions([], 2), {
    recentTransactions: [], transactionPagination: { page: 1, pageSize: 4, total: 0, totalPages: 1 },
  });
});

test('uses stable IDs to order equal timestamps across payment sources', () => {
  const sameDate = records.slice(0, 14).map(row => ({ ...row, paidAt: records[0].paidAt })).reverse();
  const result = [1, 2, 3, 4].flatMap(page => paginateRevenueTransactions(sameDate, page).recentTransactions);
  assert.deepEqual(result.map(row => row.id), records.slice(0, 14).map(row => row.id));
});


test('report service applies query paging after merging sources and preserves filtered analytics (mocked reads only)', async t => {
  const models = ['Booking', 'Subscription', 'SubscriptionRenewal', 'MembershipEntitlementRenewal', 'WalletTransaction', 'Session'];
  for (const name of models) {
    t.mock.method(require(`../models/${name}`), 'aggregate', async () => []);
  }
  const chain = rows => ({ select() { return this; }, sort() { return this; }, lean: async () => rows });
  t.mock.method(require('../models/Booking'), 'find', () => chain([]));
  t.mock.method(require('../models/Session'), 'countDocuments', async () => 0);
  const wallet = require('../models/WalletTransaction');
  const queries = [];
  t.mock.method(wallet, 'find', query => {
    queries.push(query);
    return chain(query.$or ? records.map(row => ({ ...row, _id: row.id, createdAt: row.paidAt, status: 'COMPLETED', type: 'PAYMENT', refSource: 'booking' })) : []);
  });
  const packagePayment = { id: 'package', paidAt: new Date('2026-11-02T00:00:00Z'), amount: 5000, kind: 'purchase', reference: 'full-package-reference', paymentMethod: 'wallet' };
  t.mock.method(require('../services/revenuePackagePayments'), 'getPackageRevenuePayments', async () => [packagePayment]);
  const { getAdminPlatformRevenueStatistics } = require('../services/statisticsService');
  const filters = { mode: 'month', year: 2026, month: 11 };
  const first = await getAdminPlatformRevenueStatistics({ ...filters, transactionPage: 1 });
  const last = await getAdminPlatformRevenueStatistics({ ...filters, transactionPage: '9' });
  assert.deepEqual(first.transactionPagination, { page: 1, pageSize: 4, total: 36, totalPages: 9 });
  assert.equal(first.recentTransactions[0].id, 'package');
  assert.equal(first.recentTransactions[0].reference, 'full-package-reference');
  assert.equal(last.recentTransactions.length, 4);
  assert.deepEqual(last.summary, first.summary);
  assert.deepEqual(last.trend, first.trend);
  assert.deepEqual(last.packageBreakdown, first.packageBreakdown);
  assert.equal(first.summary.packageRevenue, 5000);
  const query = queries.find(query => query.$or);
  assert.equal(query.createdAt.$gte.toISOString(), '2026-10-31T17:00:00.000Z');
  assert.equal(query.createdAt.$lt.toISOString(), '2026-11-30T17:00:00.000Z');
  assert.equal(query.status, 'COMPLETED');
});
