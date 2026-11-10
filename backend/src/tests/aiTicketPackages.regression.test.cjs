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
  return Object.entries(filter).every(([key, value]) => key === '$or' ? value.some(item => matches(row, item)) : value instanceof RegExp ? value.test(row[key] || '') : row[key] === value);
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

test('Ticket Package search matches literal name/description/type, all types, and explicit active/inactive filters', async () => {
  await withReads(async () => {
    const literal = await registry.execute('search_ticket_packages', { query: '(A+)', type: 'daily', status: 'inactive' }, 'admin');
    assert.equal(literal.data.total, 1); assert.equal(literal.data.items[0]._id, id);
    assert.equal(literal.data.items[0].name, 'Gold_Pass'); assert.equal(literal.data.items[0].price, 0);
    assert.equal(literal.data.items[0].isActive, false); assert.ok(literal.data.items[0].updatedAt.startsWith('2026-11-08T00:00:00.000Z'));
    assert.equal(literal.data.items[0].aiAppliedDraftIds, undefined);
    const bounded = await registry.execute('search_ticket_packages', { query: 'Gold_Pass', limit: 1 }, 'admin');
    assert.equal(bounded.data.total, 2); assert.equal(bounded.data.returned, 1);
    assert.equal((await registry.execute('search_ticket_packages', { status: 'all' }, 'admin')).data.total, 4);
    for (const type of ['hourly', 'daily', 'monthly', 'yearly']) assert.equal((await registry.execute('search_ticket_packages', { type }, 'admin')).data.items[0].type, type);
    assert.equal((await registry.execute('search_ticket_packages', { isActive: false }, 'admin')).data.total, 2);
    await assert.rejects(registry.execute('search_ticket_packages', { status: 'active', isActive: false }, 'admin'));
    await assert.rejects(registry.execute('search_ticket_packages', { isActive: 'invented' }, 'admin'));
    await assert.rejects(registry.execute('search_ticket_packages', { type: 'weekly' }, 'admin'));
    await assert.rejects(registry.execute('search_ticket_packages', { query: {} }, 'admin'));
  });
});

test('package details and View Package use the exact stored ID despite duplicate names', async () => {
  await withReads(async () => {
    const detail = await registry.execute('get_ticket_package_detail', { packageId: id }, 'admin');
    assert.equal(detail.data._id, id); assert.equal(detail.data.type, 'daily');
    assert.equal(detail.data.description, 'Night (A+) coverage'); assert.equal(detail.data.price, 0);
    assert.equal(entityLinks('get_ticket_package_detail', detail.data)[0].url, `/admin/tickets?packageId=${id}`);
    const links = entityLinks('search_ticket_packages', { items: rows.slice(0, 2) });
    assert.equal(links.length, 2); assert.notEqual(links[0].url, links[1].url);
    await assert.rejects(registry.execute('get_ticket_package_detail', { packageId: 'invalid' }, 'admin'));
    await assert.rejects(registry.execute('get_ticket_package_detail', { packageId: '6aebe56ea4ec3a25a06971ba' }, 'admin'), error => error.code === 'PACKAGE_NOT_FOUND');
    for (const role of ['customer', 'staff']) await assert.rejects(registry.execute('get_ticket_package_detail', { packageId: id }, role));
  });
});

test('named details use exact literal identity and reject missing, conflicting, or duplicate matches', async () => {
  await withReads(async filters => {
    const detail = await registry.execute('get_ticket_package_detail', { name: 'monthly' }, 'admin');
    assert.equal(detail.data.name, 'Monthly');
    assert.equal(filters.at(-1).name.source, '^monthly$');
    await assert.rejects(registry.execute('get_ticket_package_detail', { name: 'Month' }, 'admin'), error => error.code === 'PACKAGE_NOT_FOUND');
    await assert.rejects(registry.execute('get_ticket_package_detail', { name: '.*' }, 'admin'), error => error.code === 'PACKAGE_NOT_FOUND');
    await assert.rejects(registry.execute('get_ticket_package_detail', { name: 'Gold_Pass' }, 'admin'), error => error.code === 'PACKAGE_AMBIGUOUS');
    await assert.rejects(registry.execute('get_ticket_package_detail', { name: 'Monthly', packageId: id }, 'admin'), /do not match/);
    for (const role of ['customer', 'staff']) await assert.rejects(registry.execute('get_ticket_package_detail', { name: 'Monthly' }, role));
  });
});

test('package inventory statistics use all matching records, independent of result limits or subscription counts', async () => {
  await withReads(async () => {
    const stats = await registry.execute('get_ticket_package_stats', {}, 'admin');
    assert.equal(stats.data.summary.total, 4); assert.equal(stats.data.summary.active, 2); assert.equal(stats.data.summary.inactive, 2);
    assert.ok(stats.data.summary.latestUpdated.startsWith('2026-11-08T00:00:00.000Z'));
    assert.equal(stats.data.byType.length, 4);
    const filtered = await registry.execute('get_ticket_package_stats', { query: '(A+)', status: 'inactive', type: 'daily' }, 'admin');
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
