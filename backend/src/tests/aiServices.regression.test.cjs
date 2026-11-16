const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Service = require('../models/Service');
const Draft = require('../models/AIDraft');
const Audit = require('../models/AIAuditLog');
const { execute } = require('../services/aiCopilot/toolRegistry');
const { createDraft, cleanPayload } = require('../services/aiCopilot/draftService');
const { entityLinks } = require('../services/aiCopilot/entityLinks');
const id = '6aebe56ea4ec3a25a06971bf';
// Isolated read fixtures and proposal capture: no DB connection or real writes.
const rows = Array.from({ length: 24 }, (_, index) => ({ _id: index === 0 ? id : index.toString(16).padStart(24, '0'), name: index < 2 ? 'Car wash' : `Service ${index}`, description: index === 0 ? 'Literal (A+) wash' : 'Stored description', price: index * 2500, timeCost: index + 10, isActive: index % 3 !== 0, updatedAt: new Date('2026-11-09T00:00:00Z'), cloudinary_id: 'private' }));
function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => key === '$or' ? value.some(part => matches(row, part)) : value instanceof RegExp ? value.test(row[key] || '') : typeof value === 'object' ? (value.$gte === undefined || row[key] >= value.$gte) && (value.$lte === undefined || row[key] <= value.$lte) : row[key] === value);
}
function query(items, single = false) {
  let selected = [...items], fields;
  const request = {
    sort(order) { selected.sort((a, b) => { for (const [key, direction] of Object.entries(order)) { if (a[key] < b[key]) return -direction; if (a[key] > b[key]) return direction; } return 0; }); return request; },
    limit(limit) { selected = selected.slice(0, limit); return request; },
    select(value) { fields = value.split(' '); return request; },
    async lean() { const data = selected.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !fields || fields.includes(key)))); return single ? data[0] || null : data; },
  };
  return request;
}
async function withReads(run) {
  const original = { find: Service.find, findById: Service.findById, countDocuments: Service.countDocuments, aggregate: Service.aggregate };
  Service.find = filter => query(rows.filter(row => matches(row, filter)));
  Service.findById = serviceId => query(rows.filter(row => row._id === serviceId), true);
  Service.countDocuments = async filter => rows.filter(row => matches(row, filter)).length;
  Service.aggregate = async pipeline => {
    assert.deepEqual(pipeline[1].$group.totalPrice, { $sum: '$price' });
    const selected = rows.filter(row => matches(row, pipeline[0].$match));
    return selected.length ? [{ total: selected.length, active: selected.filter(row => row.isActive).length, totalPrice: selected.reduce((sum, row) => sum + row.price, 0) }] : [];
  };
  try { await run(); } finally { Object.assign(Service, original); }
}
test('service statistics use the dashboard all-service mean, independent of list limits or booking usage', async () => withReads(async () => {
  const stats = await execute('get_service_stats', {}, 'admin');
  assert.equal(stats.data.summary.total, rows.length);
  assert.equal(stats.data.summary.averagePrice, rows.reduce((sum, row) => sum + row.price, 0) / rows.length);
  assert.equal(stats.data.summary.inactive, rows.filter(row => !row.isActive).length);
  const page = await execute('search_services', { limit: 1 }, 'admin');
  assert.equal(page.data.items.length, 1); assert.equal(page.data.total, rows.length);
  const active = await execute('get_service_stats', { status: 'active' }, 'admin');
  const activeRows = rows.filter(row => row.isActive);
  assert.equal(active.data.summary.averagePrice, activeRows.reduce((sum, row) => sum + row.price, 0) / activeRows.length);
  assert.deepEqual((await execute('get_service_stats', { query: 'missing' }, 'admin')).data.summary, { total: 0, active: 0, inactive: 0, averagePrice: 0 });
}));
test('service price sorting occurs before limit and preserves literal search, filters and safe fields', async () => withReads(async () => {
  const result = await execute('search_services', { sortBy: 'price', sortOrder: 'desc', limit: 3 }, 'admin');
  assert.deepEqual(result.data.items.map(row => row.price), rows.slice(-3).reverse().map(row => row.price));
  assert.equal(result.data.items[0].cloudinary_id, undefined);
  const literal = await execute('search_services', { query: '(A+)', status: 'inactive', maxPrice: 0 }, 'admin');
  assert.equal(literal.data.total, 1); assert.equal(literal.data.items[0]._id, id); assert.equal(literal.data.items[0].price, 0);
  for (const args of [{ sortBy: 'invented' }, { sortOrder: 'random' }, { minPrice: -1 }, { minPrice: 3, maxPrice: 1 }, { isActive: 'false' }, { status: 'active', isActive: false }]) await assert.rejects(execute('search_services', args, 'admin'));
}));
test('service links and details use the exact ID despite duplicate names and enforce AI roles', async () => withReads(async () => {
  const detail = await execute('get_service_detail', { serviceId: id }, 'admin');
  assert.equal(detail.data.description, rows[0].description);
  const links = entityLinks('search_services', { items: rows.slice(0, 2) });
  assert.equal(links[0].url, `/admin/services?serviceId=${id}`); assert.notEqual(links[0].url, links[1].url);
  await assert.rejects(execute('get_service_detail', { serviceId: 'bad' }, 'admin'));
  await assert.rejects(execute('get_service_detail', { serviceId: 'ffffffffffffffffffffffff' }, 'admin'), error => error.code === 'SERVICE_NOT_FOUND');
  for (const role of ['staff', 'customer']) for (const tool of ['search_services', 'get_service_stats', 'get_service_detail']) await assert.rejects(execute(tool, { serviceId: id }, role));
}));
test('service price proposals capture the stored before value, remain pending and cannot apply changes', async () => withReads(async () => {
  const originalCreate = Draft.create, originalAudit = Audit.create, originalWrite = Service.findOneAndUpdate;
  let captured;
  Draft.create = async input => { captured = input; return { ...input, _id: id, status: 'PENDING' }; };
  Audit.create = async () => ({});
  Service.findOneAndUpdate = () => assert.fail('Proposal preparation must never apply a service update');
  try {
    const input = { adminUserId: id, actorRole: 'admin', type: 'UPDATE_SERVICE', targetId: id, payload: { price: 12345 }, evidence: [{ tool: 'get_service_detail', data: rows[0] }] };
    const proposal = await createDraft(input);
    assert.equal(proposal.status, 'PENDING'); assert.deepEqual(captured.payload, { price: 12345 });
    assert.equal(captured.current.price, rows[0].price); assert.equal(captured.current.name, rows[0].name);
    assert.ok(captured.current.updatedAt);
    await assert.rejects(createDraft({ ...input, evidence: [] }), /exact service/);
    await assert.rejects(createDraft({ ...input, actorRole: 'staff' }));
    for (const payload of [{ price: -1 }, { price: 'bad' }, { timeCost: 1.5 }, {}]) assert.throws(() => cleanPayload('UPDATE_SERVICE', payload));
  } finally { Draft.create = originalCreate; Audit.create = originalAudit; Service.findOneAndUpdate = originalWrite; }
}));
test('View Service reveals a filtered row on the exact page and highlights for four seconds without a click', async t => {
  const helper = await import(pathToFileURL(path.resolve(__dirname, '../../../frontend/src/pages/Admin/serviceDeepLink.js')));
  const state = helper.serviceLinkState({ ok: true, data: { success: true, data: rows } }, rows[22]._id.toUpperCase());
  assert.equal(state.serviceId, rows[22]._id); assert.equal(helper.serviceRowPage(rows, state.serviceId), 3);
  assert.equal(helper.includeLinkedService([rows[1]], rows, state.serviceId).at(-1)._id, rows[22]._id);
  assert.equal(helper.serviceLinkState({ status: 403 }, id).status, 'unavailable');
  assert.equal(helper.serviceLinkState({ ok: true, data: { success: true, data: rows } }, 'bad').status, 'missing');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const classes = new Set(); let scroll;
  const cleanup = helper.highlightServiceRow({ scrollIntoView: value => { scroll = value; }, classList: { add: name => classes.add(name), remove: name => classes.delete(name) }, click: () => assert.fail('Must not open a modal') });
  assert.deepEqual(scroll, { behavior: 'smooth', block: 'center' });
  t.mock.timers.tick(3999); assert.ok(classes.has('service-ai-highlight'));
  t.mock.timers.tick(1); assert.ok(!classes.has('service-ai-highlight')); cleanup();
});
