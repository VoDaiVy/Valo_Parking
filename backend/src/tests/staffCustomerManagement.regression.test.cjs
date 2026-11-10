const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const User = require('../models/User'), Detail = require('../models/UserDetail'), Draft = require('../models/AIDraft'), Audit = require('../models/AIAuditLog');
const { execute } = require('../services/aiCopilot/toolRegistry');
const { entityLinks } = require('../services/aiCopilot/entityLinks');
const { createDraft } = require('../services/aiCopilot/draftService');
const id = '6a17bf45f57436ad72e17852', actorId = '6a1809f444b0febec5648a40';
const query = value => { const q = { select: () => q, sort: () => q, lean: async () => value, then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) }; return q; };

test('active-customer pages share a role/status DB match and accurate total; admin-like names are not role indicators', async () => {
  const { staffCustomerStatus } = require('../services/aiCopilot/staffCustomerScope');
  assert.equal(staffCustomerStatus('Show all active customer accounts'), true);
  assert.equal(staffCustomerStatus('List blocked customers'), false);
  for (const message of ['List active and inactive customers', 'Find customer active@example.test', 'Update customer phone', 'Find customer with active membership']) assert.equal(staffCustomerStatus(message), undefined, message);
  const fixtures = [
    { _id: id, username: 'admin', role: 'customer', status: true },
    { _id: actorId, username: 'actual_admin', role: 'admin', status: true },
    { _id: '000000000000000000000001', username: 'valo_staff', role: 'customer', status: true },
    { _id: '000000000000000000000002', username: 'actual_staff', role: 'staff', status: true },
    { _id: '000000000000000000000003', username: 'blocked', role: 'customer', status: false },
  ];
  const original = User.aggregate;
  User.aggregate = async pipeline => {
    const filter = pipeline.find(stage => stage.$match).$match;
    assert.equal(filter.role, 'customer'); assert.equal(filter.status, true);
    const matching = fixtures.filter(row => row.role === filter.role && row.status === filter.status);
    const facet = pipeline.at(-1).$facet;
    const skip = facet.items.find(stage => stage.$skip)?.$skip || 0;
    const limit = facet.items.find(stage => stage.$limit).$limit;
    return [{ items: matching.slice(skip, skip + limit), count: [{ total: matching.length }] }];
  };
  try {
    const first = await execute('search_users', { role: 'admin', status: true, page: 1, limit: 1 }, 'staff');
    const second = await execute('search_users', { ...first.data.filters, page: 2, limit: 1 }, 'staff');
    assert.equal(first.data.total, 2); assert.equal(second.data.total, 2); assert.equal(second.data.pages, 2);
    assert.deepEqual([...first.data.items, ...second.data.items].map(row => row.username), ['admin', 'valo_staff']);
  } finally { User.aggregate = original; }
});

test('Staff searches/details enforce the customer role inside DB queries, paginate before projection and produce exact Staff links', async () => {
  const original = User.aggregate; const pipelines = [];
  User.aggregate = async pipeline => {
    pipelines.push(pipeline);
    if (pipeline.at(-1).$facet) return [{ items: [{ _id: id, role: 'customer', profile: { firstName: 'Linh', phone: '0901234567' } }], count: [{ total: 24 }] }];
    assert.equal(pipeline[0].$match.role, 'customer');
    return String(pipeline[0].$match._id) === id ? [{ _id: id, role: 'customer' }] : [];
  };
  try {
    const result = await execute('search_users', { role: 'admin', query: 'Linh', page: 2, limit: 10 }, 'staff');
    const filter = pipelines[0].find(stage => stage.$match).$match;
    assert.equal(filter.role, 'customer'); assert.equal(result.data.page, 2); assert.equal(result.data.pages, 3);
    assert.ok(pipelines[0].at(-1).$facet.items.some(stage => stage.$skip === 10));
    assert.equal(entityLinks('search_users', result.data, 'staff')[0].url, `/staff/accounts?userId=${id}`);
    assert.deepEqual(entityLinks('get_user_detail', { _id: id, role: 'admin' }, 'staff'), []);
    assert.equal((await execute('get_user_detail', { userId: id }, 'staff')).data.role, 'customer');
    await assert.rejects(execute('get_user_detail', { userId: actorId }, 'staff'));
    await assert.rejects(execute('search_users', {}, 'customer'));
  } finally { User.aggregate = original; }
});

test('Staff name/phone preparation is a pending delta; phone conflicts and non-customer targets are rejected before persistence', async () => {
  const originals = [User.findById, Detail.findOne, Detail.exists, Draft.findOne, Draft.create, Audit.create];
  let conflict = false, targetRole = 'customer', captured, creates = 0;
  User.findById = value => query(value === actorId ? { _id: actorId, role: 'staff', status: true } : { _id: id, role: targetRole, status: true, updatedAt: new Date(0) });
  Detail.findOne = () => query({ firstName: 'Old', lastName: 'Name', phone: '', updatedAt: new Date(0) });
  Detail.exists = filter => { assert.equal(filter.userId.$ne, id); return query(conflict ? { _id: actorId } : null); };
  Draft.findOne = () => query(null);
  Draft.create = async data => { creates += 1; captured = data; return { ...data, _id: id, status: 'PENDING' }; };
  Audit.create = async () => ({});
  const args = { adminUserId: actorId, actorRole: 'staff', type: 'UPDATE_USER_PROFILE', targetId: id, payload: { firstName: 'Linh', phone: '+84 901 234 567', role: 'admin' }, evidence: [{ tool: 'get_user_detail', data: { _id: id } }] };
  try {
    const result = await createDraft(args);
    assert.equal(result.status, 'PENDING'); assert.deepEqual(captured.payload, { firstName: 'Linh', phone: '0901234567' });
    assert.equal(captured.current.profile.lastName, 'Name');
    conflict = true; await assert.rejects(createDraft(args), error => error.code === 'PHONE_IN_USE');
    conflict = false; targetRole = 'admin'; await assert.rejects(createDraft(args), error => error.statusCode === 403);
    targetRole = 'customer'; await assert.rejects(createDraft({ ...args, type: 'CHANGE_USER_ROLE', payload: { role: 'admin' } }));
    assert.equal(creates, 1);
  } finally { [User.findById, Detail.findOne, Detail.exists, Draft.findOne, Draft.create, Audit.create] = originals; }
});

test('exact customer links reveal excluded rows and correct pages; highlight clears after four seconds', async t => {
  const { revealCustomer, highlightCustomerRow } = await import(pathToFileURL(path.resolve(__dirname, '../../../frontend/src/pages/Staff/customerDeepLink.js')));
  const rows = Array.from({ length: 25 }, (_, index) => ({ _id: index === 23 ? id : index.toString(16).padStart(24, '0'), role: 'customer' }));
  const target = revealCustomer(rows, rows, id.toUpperCase(), 10);
  assert.equal(target.page, 3); assert.equal(target.target._id, id);
  assert.equal(revealCustomer(rows, [rows[0]], id, 10).rows[0]._id, id);
  assert.equal(revealCustomer([{ _id: id, role: 'admin' }], [], id, 10), null);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const classes = new Set(); let scrolled = false;
  const cleanup = highlightCustomerRow({ scrollIntoView() { scrolled = true; }, classList: { add: value => classes.add(value), remove: value => classes.delete(value) } });
  assert.equal(scrolled, true); t.mock.timers.tick(3999); assert.ok(classes.has('customer-ai-highlight'));
  t.mock.timers.tick(1); assert.ok(!classes.size); cleanup();
});
