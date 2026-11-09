const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Wallet = require('../models/WalletTransaction');
const User = require('../models/User');
const Detail = require('../models/UserDetail');
const { bookingManagementFilter, combineBookingFilters } = require('../utils/bookingManagementFilter');
const { resolveVietnamCalendarDay, buildBookingDayOverlapMatch } = require('../utils/bookingDateRange');
const floor = '6aebe56ea4ec3a25a06971bf';
const otherFloor = '6aebe56ea4ec3a25a06971be';
const userId = new mongoose.Types.ObjectId('6aebe56ea4ec3a25a06971bd');
// Isolated read fixtures, never connected to a database or returned by the app.
const rows = Array.from({ length: 31 }, (_, index) => ({
  _id: new mongoose.Types.ObjectId(index.toString(16).padStart(24, '0')),
  status: ['ACTIVE', 'PAID', 'COMPLETED', 'CANCELLED', 'PAUSED'][index % 5],
  floorId: new mongoose.Types.ObjectId(index % 2 ? floor : otherFloor),
  scheduledStart: new Date(`2026-11-${String(index + 1).padStart(2, '0')}T01:00:00Z`),
  scheduledEnd: new Date(`2026-11-${String(index + 1).padStart(2, '0')}T02:00:00Z`),
  licensePlate: index === 1 ? '43A11111' : 'OTHER', parkingSlot: `A-${index}`, userId: index === 1 ? userId : null, prepaidAmount: index * 1000,
})).filter(row => Number.isFinite(row.scheduledStart.getTime()));
function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some(part => matches(row, part));
    if (key === '$and') return value.every(part => matches(row, part));
    if (value instanceof RegExp) return value.test(row[key] || '');
    if (value && typeof value === 'object' && !value._bsontype && !(value instanceof Date)) return Object.entries(value).every(([op, target]) => op === '$in' ? target.some(item => String(item) === String(row[key])) : op === '$gte' ? row[key] >= target : op === '$lte' ? row[key] <= target : op === '$lt' ? row[key] < target : false);
    return String(row[key]) === String(value);
  });
}
function query(items) {
  let selected = [...items];
  const q = { populate: () => q, select: () => q, sort(order) { selected.sort((a, b) => { for (const [key, direction] of Object.entries(order)) { if (a[key] < b[key]) return -direction; if (a[key] > b[key]) return direction; } return 0; }); return q; }, skip(value) { selected = selected.slice(value); return q; }, limit(value) { selected = selected.slice(0, value); return q; }, lean: async () => selected };
  return q;
}
async function withReads(run) {
  const originals = [Booking.find, Booking.countDocuments, Booking.aggregate, Wallet.aggregate, User.find, Detail.find];
  Booking.find = filter => query(rows.filter(row => matches(row, filter)));
  Booking.countDocuments = async filter => rows.filter(row => matches(row, filter)).length;
  Booking.aggregate = async () => [];
  Wallet.aggregate = async () => [];
  User.find = () => query([]);
  Detail.find = filter => query(filter.$expr ? [{ userId }] : []);
  try { await run(); } finally { [Booking.find, Booking.countDocuments, Booking.aggregate, Wallet.aggregate, User.find, Detail.find] = originals; }
}
test('Daily includes the selected Vietnam day; All time omits date but retains floor and search', async () => {
  const { bookingManagementScope } = await import(pathToFileURL(path.resolve(__dirname, '../../../frontend/src/pages/Staff/bookingManagementScope.js')));
  assert.deepEqual(bookingManagementScope('all', '2026-11-09', floor, '  A-1 '), { floorId: floor, search: 'A-1' });
  assert.deepEqual(bookingManagementScope('daily', '2026-11-09', 'all', ''), { date: '2026-11-09' });
  const day = resolveVietnamCalendarDay('2026-11-09');
  assert.equal(day.startDate.toISOString(), '2026-11-08T17:00:00.000Z');
  const match = buildBookingDayOverlapMatch(day);
  assert.ok(matches({ scheduledStart: new Date('2026-11-08T16:00:00Z'), scheduledEnd: new Date('2026-11-08T18:00:00Z') }, match));
  assert.ok(!matches({ scheduledStart: new Date('2026-11-09T17:00:00Z'), scheduledEnd: new Date('2026-11-09T18:00:00Z') }, match));
});
test('list pagination traverses historical dates and all statuses; daily, search, floor and exact ID remain scoped', async () => withReads(async () => {
  // Payment configuration is irrelevant to this read-only controller test.
  const payosPath = require.resolve('../config/payos'); const previous = require.cache[payosPath];
  require.cache[payosPath] = { id: payosPath, filename: payosPath, loaded: true, exports: {} };
  try {
    const { getAllBookings } = require('../controllers/bookingController');
    const call = async parameters => { let body, status; const res = { status(value) { status = value; return res; }, json(value) { body = value; } }; await getAllBookings({ query: parameters }, res); assert.equal(status, 200); return body; };
    const first = await call({ page: 1, limit: 20 });
    const second = await call({ page: 2, limit: 20 });
    assert.equal(first.pagination.total, rows.length);
    assert.equal(first.data.length, 20);
    const combined = [...first.data, ...second.data];
    assert.equal(new Set(combined.map(row => String(row._id))).size, rows.length);
    assert.deepEqual(new Set(combined.map(row => row.status)), new Set(rows.map(row => row.status)));
    const daily = await call({ date: '2026-11-09', page: 1, limit: 20 });
    assert.deepEqual(daily.data.map(row => String(row._id)), rows.filter(row => matches(row, buildBookingDayOverlapMatch(resolveVietnamCalendarDay('2026-11-09')))).map(row => String(row._id)));
    const floorRows = await call({ floorId: floor, page: 1, limit: 100 });
    assert.ok(floorRows.data.every(row => String(row.floorId) === floor));
    const searched = await call({ search: '43A11111', page: 1, limit: 20 });
    assert.ok(searched.data.some(row => row.licensePlate === '43A11111'));
    const detail = await call({ bookingId: String(rows[25]._id) });
    assert.equal(detail.data.length, 1); assert.equal(String(detail.data[0]._id), String(rows[25]._id)); assert.equal(detail.pagination, undefined);
  } finally { if (previous) require.cache[payosPath] = previous; else delete require.cache[payosPath]; }
}));
test('completed/cancelled KPI definitions use the same full floor/search/date scope without list limits', async () => withReads(async () => {
  const stats = require('../services/statisticsService');
  const all = await stats.getAdminBookingStatistics({ range: 'all', floorId: floor });
  assert.equal(all.completed.count, rows.filter(row => String(row.floorId) === floor && row.status === 'COMPLETED').length);
  assert.equal(all.cancelled.count, rows.filter(row => String(row.floorId) === floor && row.status === 'CANCELLED').length);
  const daily = await stats.getAdminBookingStatistics({ range: 'daily', date: '2026-11-09' });
  assert.equal(daily.cancelled.count, rows.filter(row => row.status === 'CANCELLED' && matches(row, buildBookingDayOverlapMatch(resolveVietnamCalendarDay('2026-11-09')))).length);
  const dateSearch = combineBookingFilters(buildBookingDayOverlapMatch(resolveVietnamCalendarDay('2026-11-09')), await bookingManagementFilter({ search: '(A+)' }));
  assert.equal(dateSearch.$and.length, 2); // Neither search nor schedule $or overwrites the other.
  assert.equal(dateSearch.$and[1].$or[0].licensePlate.source, '\\(A\\+\\)');
  await assert.rejects(bookingManagementFilter({ floorId: 'invalid' }));
}));
