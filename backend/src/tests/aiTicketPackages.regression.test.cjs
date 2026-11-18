const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Package = require('../models/TicketPackage');
const registry = require('../services/aiCopilot/toolRegistry');
const { entityLinks } = require('../services/aiCopilot/entityLinks');
const id = '6aebe56ea4ec3a25a06971bf';
const otherId = '6aebe56ea4ec3a25a06971be';
// Isolated read fixtures. No database connection, writes, or AI provider calls.
const rows = [
  { _id: id, name: 'Gold_Pass', description: 'Night (A+) coverage', type: 'daily', price: 0, isActive: false, updatedAt: new Date('2026-11-08T00:00:00Z'), aiAppliedDraftIds: [otherId] },
  { _id: otherId, name: 'Gold_Pass', description: 'Hourly parking', type: 'hourly', price: 12000, isActive: true, updatedAt: new Date('2026-11-07T00:00:00Z') },
  { _id: '6aebe56ea4ec3a25a06971bd', name: 'Monthly', type: 'monthly', price: 150000, isActive: true },
  { _id: '6aebe56ea4ec3a25a06971bc', name: 'Yearly', type: 'yearly', price: 1500000, isActive: false },
];
function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => key === '$or' ? value.some(item => matches(row, item)) : value instanceof RegExp ? value.test(row[key] || '') : value?.$in ? value.$in.includes(row[key]) : row[key] === value);
}
function query(items, single = false) {
  let fields; let limit = Infinity;
  const request = { sort: () => request, limit: value => { limit = value; return request; }, select: value => { fields = value.split(' '); return request; }, lean: async () => {
    const selected = items.slice(0, limit).map(item => Object.fromEntries(Object.entries(item).filter(([key]) => !fields || fields.includes(key))));
    return single ? selected[0] || null : selected;
  } };
  return request;
}
async function withReads(run) {
  const original = { find: Package.find, findById: Package.findById, countDocuments: Package.countDocuments, aggregate: Package.aggregate };
  const filters = [];
  Package.find = filter => { filters.push(filter); return query(rows.filter(row => matches(row, filter))); };
  Package.findById = packageId => query(rows.filter(row => row._id === packageId), true);
  Package.countDocuments = async filter => rows.filter(row => matches(row, filter)).length;
  Package.aggregate = async pipeline => {
    const selected = rows.filter(row => matches(row, pipeline[0].$match));
    const summary = { total: selected.length, active: selected.filter(row => row.isActive).length, inactive: selected.filter(row => row.isActive === false).length, latestUpdated: selected.map(row => row.updatedAt).filter(Boolean).sort((a, b) => b - a)[0] || null };
    const byType = [...new Set(selected.map(row => row.type))].map(type => { const items = selected.filter(row => row.type === type); return { _id: type, total: items.length, active: items.filter(row => row.isActive).length, inactive: items.filter(row => !row.isActive).length }; });
    return [{ summary: selected.length ? [summary] : [], byType }];
  };
  try { await run(filters); } finally { Object.assign(Package, original); }
}

test('Ticket Package search excludes retired types while preserving supported status and text filters', async () => {
  await withReads(async () => {
    const all = await registry.execute('search_ticket_packages', { status: 'all' }, 'admin');
    assert.equal(all.data.total, 2);
    assert.deepEqual(all.data.items.map(item => item.type), ['monthly', 'yearly']);
    const bounded = await registry.execute('search_ticket_packages', { limit: 1 }, 'admin');
    assert.equal(bounded.data.total, 2); assert.equal(bounded.data.returned, 1);
    assert.equal((await registry.execute('search_ticket_packages', { isActive: false }, 'admin')).data.total, 1);
    assert.equal((await registry.execute('search_ticket_packages', { query: 'Monthly', status: 'active' }, 'admin')).data.total, 1);
    assert.equal((await registry.execute('search_ticket_packages', { query: 'Gold_Pass' }, 'admin')).data.total, 0);
    for (const type of ['hourly', 'daily', 'invented']) await assert.rejects(registry.execute('search_ticket_packages', { type }, 'admin'));
    await assert.rejects(registry.execute('search_ticket_packages', { status: 'active', isActive: false }, 'admin'));
    await assert.rejects(registry.execute('search_ticket_packages', { query: {} }, 'admin'));
  });
});

test('catalog details reject retired types and retain supported exact IDs and permissions', async () => {
  await withReads(async () => {
    const supportedId = rows[2]._id;
    const detail = await registry.execute('get_ticket_package_detail', { packageId: supportedId }, 'admin');
    assert.equal(detail.data._id, supportedId); assert.equal(detail.data.type, 'monthly');
    assert.equal(entityLinks('get_ticket_package_detail', detail.data)[0].url, `/admin/tickets?packageId=${supportedId}`);
    for (const packageId of [id, otherId, '6aebe56ea4ec3a25a06971ba']) await assert.rejects(registry.execute('get_ticket_package_detail', { packageId }, 'admin'), error => error.code === 'PACKAGE_NOT_FOUND');
    await assert.rejects(registry.execute('get_ticket_package_detail', { packageId: 'invalid' }, 'admin'));
    for (const role of ['customer', 'staff']) await assert.rejects(registry.execute('get_ticket_package_detail', { packageId: supportedId }, role));
  });
});

test('named details use exact literal identity and reject missing, conflicting, or duplicate matches', async () => {
  await withReads(async filters => {
    const detail = await registry.execute('get_ticket_package_detail', { name: 'monthly' }, 'admin');
    assert.equal(detail.data.name, 'Monthly');
    assert.equal(filters.at(-1).name.source, '^monthly$');
    await assert.rejects(registry.execute('get_ticket_package_detail', { name: 'Month' }, 'admin'), error => error.code === 'PACKAGE_NOT_FOUND');
    await assert.rejects(registry.execute('get_ticket_package_detail', { name: '.*' }, 'admin'), error => error.code === 'PACKAGE_NOT_FOUND');
    await assert.rejects(registry.execute('get_ticket_package_detail', { name: 'Gold_Pass' }, 'admin'), error => error.code === 'PACKAGE_NOT_FOUND');
    await assert.rejects(registry.execute('get_ticket_package_detail', { name: 'Monthly', packageId: id }, 'admin'), /do not match/);
    for (const role of ['customer', 'staff']) await assert.rejects(registry.execute('get_ticket_package_detail', { name: 'Monthly' }, role));
  });
});

test('package inventory statistics use all matching records, independent of result limits or subscription counts', async () => {
  await withReads(async () => {
    const stats = await registry.execute('get_ticket_package_stats', {}, 'admin');
    assert.equal(stats.data.summary.total, 2); assert.equal(stats.data.summary.active, 1); assert.equal(stats.data.summary.inactive, 1);
    assert.equal(stats.data.summary.latestUpdated, null);
    assert.equal(stats.data.byType.length, 2);
    const filtered = await registry.execute('get_ticket_package_stats', { query: 'Yearly', status: 'inactive', type: 'yearly' }, 'admin');
    assert.equal(filtered.data.summary.total, 1); assert.equal(filtered.data.summary.active, 0);
    const empty = await registry.execute('get_ticket_package_stats', { query: 'missing' }, 'admin');
    assert.deepEqual(empty.data.summary, { total: 0, active: 0, inactive: 0, latestUpdated: null });
    await assert.rejects(registry.execute('get_ticket_package_stats', {}, 'customer'));
  });
});

test('View Package verifies the authorized exact ID and reveals a row excluded by filters', async () => {
  const { ticketPackageLinkState, includeLinkedPackage } = await import(pathToFileURL(path.resolve(__dirname, '../../../frontend/src/pages/Admin/ticketPackageDeepLink.js')));
  const response = { ok: true, status: 200, data: { success: true, data: rows } };
  const state = ticketPackageLinkState(response, id.toUpperCase());
  assert.equal(state.status, 'ready'); assert.equal(state.packageId, id);
  assert.deepEqual(includeLinkedPackage([rows[1]], rows, state.packageId).map(row => row._id), [id, otherId]);
  assert.equal(ticketPackageLinkState({ status: 403 }, id).status, 'unavailable');
  assert.equal(ticketPackageLinkState(response, 'invalid').status, 'missing');
  assert.equal(ticketPackageLinkState({ ok: true, data: { success: true, data: [] } }, id).status, 'missing');
  assert.equal(ticketPackageLinkState({ ok: false, status: 500 }, id).status, 'error');
});

test('View Package scrolls and highlights for four seconds without invoking edit or click', async t => {
  const { highlightTicketPackageRow } = await import(pathToFileURL(path.resolve(__dirname, '../../../frontend/src/pages/Admin/ticketPackageDeepLink.js')));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const classes = new Set(); let scroll;
  const row = { scrollIntoView: options => { scroll = options; }, classList: { add: name => classes.add(name), remove: name => classes.delete(name) }, click: () => assert.fail('Navigation must not invoke edit/click') };
  const cleanup = highlightTicketPackageRow(row);
  assert.deepEqual(scroll, { behavior: 'smooth', block: 'center' });
  t.mock.timers.tick(3999); assert.ok(classes.has('ticket-package-highlight'));
  t.mock.timers.tick(1); assert.ok(!classes.has('ticket-package-highlight'));
  cleanup();
});
