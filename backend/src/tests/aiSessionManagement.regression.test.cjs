const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Session = require('../models/Session');
const reads = require('../services/aiCopilot/readTools');
const registry = require('../services/aiCopilot/toolRegistry');
const id = '6aebe56ea4ec3a25a06971bf';
const otherId = '6aebe56ea4ec3a25a06971be';
// Isolated query fixtures only: these tests never connect to or write a database.
const rows = [
  { _id: id, licensePlate: '43A11111', phone: '0935.384.249', userId: null, status: 'completed', checkInTime: new Date('2020-01-01T01:00:00Z'), checkOutTime: new Date('2020-01-01T02:00:00Z'), totalPrice: 34000, entryImage_url: 'https://example.test/entry.jpg', exitImage_url: null },
  { _id: otherId, licensePlate: '43A1111', phone: '+84935384249', userId: null, status: 'active', checkInTime: new Date('2026-11-07T01:00:00Z'), totalPrice: 0, entryImage_url: null, exitImage_url: 'https://example.test/exit.jpg' },
];
function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some(condition => matches(row, condition));
    if (value instanceof RegExp) return value.test(row[key] || '');
    if (value && typeof value === 'object') {
      if (value.$in) return value.$in.includes(row[key]);
      return (!value.$gte || row[key] >= value.$gte) && (!value.$lte || row[key] <= value.$lte);
    }
    return row[key] === value;
  });
}
async function withReads(run) {
  const original = { find: Session.find, findById: Session.findById, countDocuments: Session.countDocuments };
  const filters = []; const projections = [];
  function query(items, single = false) {
    let selected;
    const value = { sort: () => value, limit: () => value, populate: () => value, select: fields => { selected = fields.split(' '); projections.push(selected); return value; }, lean: async () => {
      const result = items.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => !selected || selected.includes(key))));
      return single ? result[0] || null : result;
    } };
    return value;
  }
  Session.find = filter => { filters.push(filter); return query(rows.filter(row => matches(row, filter))); };
  Session.findById = sessionId => query(rows.filter(row => row._id === sessionId), true);
  Session.countDocuments = async filter => rows.filter(row => matches(row, filter)).length;
  try { await run({ filters, projections }); } finally { Object.assign(Session, original); }
}

test('session phone lookup matches stored national/international/formatted phones, including historical unlinked walk-ins', async () => {
  await withReads(async ({ filters, projections }) => {
    assert.equal(registry.tools.find(tool => tool.name === 'search_sessions').parameters.properties.phone.type, 'string');
    for (const phone of ['0935384249', '+84 935 384 249', '84935384249']) {
      const output = await registry.execute('search_sessions', { phone }, 'admin');
      assert.deepEqual(output.data.items.map(item => item._id), [id, otherId]);
      assert.equal(output.data.total, 2);
      assert.equal(output.data.items[0].userId, null);
      assert.equal(output.data.items[0].phone, '0935.384.249');
      assert.equal(filters.at(-1).checkInTime, undefined);
      assert.equal(matches({ phone: '0935384248' }, filters.at(-1)), false);
      assert.equal(matches({ phone: '10935384249' }, filters.at(-1)), false);
    }
    assert.ok(projections.every(fields => ['phone', 'entryImage_url', 'exitImage_url'].every(field => fields.includes(field))));
    const missing = await reads.searchSessions({ phone: '0935384248' });
    assert.equal(missing.total, 0); assert.deepEqual(missing.items, []);
    await assert.rejects(reads.searchSessions({ phone: 'not a phone' }));
    await assert.rejects(registry.execute('search_sessions', { phone: '0935384249' }, 'customer'));
  });
});

test('complete plates keep exact digit counts; partial matching remains explicit and dates use Vietnam boundaries', async () => {
  await withReads(async ({ filters }) => {
    for (const [plate, expected] of [['43A11111', id], ['43A1111', otherId]]) {
      const result = await reads.searchSessions({ plateNumber: plate });
      assert.deepEqual(result.items.map(item => item._id), [expected]);
      assert.equal(result.items[0].licensePlate, plate);
    }
    assert.equal((await reads.searchSessions({ plateNumber: '43A1111', plateMatchMode: 'contains' })).total, 2);
    assert.equal((await reads.searchSessions({ plateNumber: '43A' })).total, 2);
    await reads.searchSessions({ startDate: '2026-11-07', endDate: '2026-11-07' });
    assert.equal(filters.at(-1).checkInTime.$gte.toISOString(), '2026-11-06T17:00:00.000Z');
    assert.equal(filters.at(-1).checkInTime.$lte.toISOString(), '2026-11-07T16:59:59.999Z');
  });
});

test('image availability comes independently from the same entry/exit fields as Session Details', async () => {
  await withReads(async () => {
    const entry = await reads.getSessionDetail({ sessionId: id });
    assert.deepEqual(entry.imageAvailability, { entry: true, exit: false });
    assert.equal(entry.entryImage_url, rows[0].entryImage_url);
    assert.equal(entry.totalPrice, 34000); assert.equal(entry.status, 'completed');
    assert.ok(entry.checkInTime.startsWith('2020-01-01T01:00:00.000Z'));
    const exit = await reads.getSessionDetail({ sessionId: otherId });
    assert.deepEqual(exit.imageAvailability, { entry: false, exit: true });
    assert.equal(exit.totalPrice, 0); assert.equal(exit.status, 'active');
    const active = await reads.getActiveSessions({});
    assert.deepEqual(active.items[0].imageAvailability, exit.imageAvailability);
  });
});

test('deep link resolves the exact ID onto its page rather than a similar license plate', async () => {
  const { sessionRowTarget, verifiedSessionForQuery } = await import(pathToFileURL(path.resolve(__dirname, '../../../frontend/src/pages/Staff/sessionDeepLink.js')));
  const sessions = Array.from({ length: 32 }, (_, index) => ({ _id: index.toString(16).padStart(24, '0'), licensePlate: index === 0 ? '43A11111' : '43A1111', checkInTime: new Date(2026, 0, index + 1).toISOString() }));
  const target = sessionRowTarget(sessions[0]._id, sessions);
  assert.equal(target.id, sessions[0]._id); assert.equal(target.page, 3);
  assert.equal(sessionRowTarget(id, sessions), null);
  assert.equal(verifiedSessionForQuery({ status: 'verified', sessionId: id, requestKey: 'old', session: rows[0] }, id, 'new'), null);
});

test('session row scrolls into view and highlights yellow for exactly four seconds', async t => {
  const { highlightSessionRow } = await import(pathToFileURL(path.resolve(__dirname, '../../../frontend/src/pages/Staff/sessionDeepLink.js')));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const classes = new Set(); let scroll;
  const row = { scrollIntoView: options => { scroll = options; }, classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
  const cleanup = highlightSessionRow(row);
  assert.deepEqual(scroll, { behavior: 'smooth', block: 'center' });
  t.mock.timers.tick(3999); assert.ok(classes.has('session-ai-highlight'));
  t.mock.timers.tick(1); assert.ok(!classes.has('session-ai-highlight'));
  cleanup();
  const cancel = highlightSessionRow(row); cancel(); assert.equal(classes.size, 0);
});

test('an Admin deep link with a verified session does not auto-open Session Details', async () => {
  const frontend = path.resolve(__dirname, '../../../frontend');
  const fe = require('node:module').createRequire(path.join(frontend, 'package.json'));
  const React = fe('react'); const router = fe('react-router-dom');
  const { renderToStaticMarkup } = fe('react-dom/server');
  const { transformWithOxc } = await import(pathToFileURL(fe.resolve('vite')));
  const pagination = await import(pathToFileURL(path.join(frontend, 'src/pages/Staff/sessionPagination.js')));
  const deepLink = await import(pathToFileURL(path.join(frontend, 'src/pages/Staff/sessionDeepLink.js')));
  const metrics = await import(pathToFileURL(path.join(frontend, 'src/pages/Staff/sessionMetrics.js')));
  const source = require('node:fs').readFileSync(path.join(frontend, 'src/pages/Staff/SessionManagement.jsx'), 'utf8').replace(/^import .*;$/gm, '').replace('export default function', 'function');
  const { code } = await transformWithOxc(source, 'SessionManagement.jsx', { jsx: { runtime: 'classic' } });
  const deps = { ...React, ...fe('lucide-react'), ...router, ...pagination, ...deepLink, ...metrics,
    getAllSessions: async () => { throw new Error('No API calls in server rendering'); },
    StaffDropdown: () => null, AIPlateResolutionModal: () => null,
    verifiedSessionForQuery: () => rows[0],
  };
  const Component = new Function('React', 'deps', `const {${Object.keys(deps).filter(key => /^[a-zA-Z_$][\w$]*$/.test(key)).join(',')}} = deps; ${code}; return SessionManagement;`)(React, deps);
  const html = renderToStaticMarkup(React.createElement(router.MemoryRouter, { initialEntries: [`/admin/sessions?sessionId=${id}`] }, React.createElement(Component)));
  assert.ok(html.includes('Session Management'));
  assert.ok(!html.includes('>Session Details<'));
  assert.ok(!html.includes('alt="Entry"'));
});
