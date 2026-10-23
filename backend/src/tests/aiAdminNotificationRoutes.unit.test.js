const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('../routes/aiCopilotRoutes');
const AINotification = require('../models/AINotification');
const adminRouter = router.stack.at(-1).handle;
const staffRouter = router.stack.find((layer) => layer.handle?.stack).handle;
const handler = (nested, path, method = 'get') => nested.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack[0].handle;
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('Admin pagination keeps global unread count independent of severity filter', async () => {
  const originalFind = AINotification.find;
  const originalCount = AINotification.countDocuments;
  const filters = []; const pagination = {};
  AINotification.find = (filter) => {
    filters.push(filter);
    return { sort() { return this; }, skip(value) { pagination.skip = value; return this; }, limit(value) { pagination.limit = value; return this; }, populate() { return this; }, lean: async () => [] };
  };
  AINotification.countDocuments = async (filter) => { filters.push(filter); return 0; };
  try {
    const res = response();
    await handler(adminRouter, '/notifications')({ user: { _id: 'admin' }, query: { page: '2', filter: 'critical' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(pagination.skip, 20);
    assert.equal(pagination.limit, 20);
    assert.equal(filters[0].severity, 'CRITICAL');
    assert.equal(filters[2].severity, undefined);
    assert.equal(filters[2].readBy.$ne, 'admin');
  } finally { AINotification.find = originalFind; AINotification.countDocuments = originalCount; }
});

test('invalid notification ID uses English for Admin while Staff retains its existing response', async () => {
  const admin = response(); const staff = response();
  const req = { params: { id: 'invalid' }, user: { _id: 'user' } };
  await handler(adminRouter, '/notifications/:id')(req, admin);
  await handler(staffRouter, '/notifications/:id')(req, staff);
  assert.equal(admin.statusCode, 400);
  assert.match(admin.body.message, /Invalid/);
  assert.match(staff.body.message, /không hợp lệ/);
});
