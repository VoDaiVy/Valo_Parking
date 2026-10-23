const assert = require('node:assert/strict');
const { test } = require('node:test');
const Device = require('../models/KioskDevice');
const User = require('../models/User');
const { authenticateKiosk, authorizeParkingOperator, cookieName, credentialHash } = require('../middlewares/kioskDeviceMiddleware');

test('kiosk authentication rejects unprovisioned, malformed and foreign-origin requests without database lookup', async () => {
  const original = Device.findOne;
  let queries = 0;
  Device.findOne = () => { queries += 1; throw new Error('Unexpected query'); };
  try {
    assert.equal(await authenticateKiosk({ headers: {}, query: {}, cookies: {} }), null);
    assert.equal(await authenticateKiosk({ headers: { 'x-kiosk-gate': 'ENTRY_1' }, cookies: { [cookieName('ENTRY_1')]: 'bad' } }), null);
    assert.equal(await authenticateKiosk({ headers: { 'x-kiosk-gate': 'ENTRY_1', origin: 'https://foreign.invalid' }, cookies: { [cookieName('ENTRY_1')]: 'a'.repeat(64) } }), null);
    assert.equal(queries, 0);
  } finally { Device.findOne = original; }
});

test('kiosk credential must match gate, expiry and enabled state and belong to an active staff account', async () => {
  const oldFind = Device.findOne;
  const oldExists = User.exists;
  const token = 'a'.repeat(64);
  let active = true;
  let captured;
  Device.findOne = (query) => {
    captured = query;
    return { lean: async () => ({ _id: 'device-1', createdBy: 'staff-1', expiresAt: new Date(Date.now() + 1000) }) };
  };
  User.exists = async (query) => {
    assert.equal(query.status, true);
    assert.deepEqual(query.role.$in, ['staff', 'admin']);
    return active ? { _id: 'staff-1' } : null;
  };
  try {
    const req = { headers: { 'x-kiosk-gate': 'EXIT_1' }, cookies: { [cookieName('EXIT_1')]: token } };
    const result = await authenticateKiosk(req);
    assert.equal(result.kind, 'exit');
    assert.equal(result.gate, 'EXIT_1');
    assert.equal(captured.credentialHash, credentialHash(token));
    assert.equal(captured.enabled, true);
    assert.equal(captured.gate, 'EXIT_1');
    assert.ok(captured.expiresAt.$gt instanceof Date);
    active = false;
    assert.equal(await authenticateKiosk(req), null);
  } finally { Device.findOne = oldFind; User.exists = oldExists; }
});

test('unprovisioned operator receives actionable 401 and never runs transition', async () => {
  let nextCalled = false;
  let status;
  let response;
  await authorizeParkingOperator({ headers: {}, query: {}, cookies: {} }, {
    status(value) { status = value; return this; },
    json(value) { response = value; return this; },
  }, () => { nextCalled = true; });
  assert.equal(status, 401);
  assert.equal(response.code, 'KIOSK_DEVICE_REQUIRED');
  assert.equal(nextCalled, false);
});
