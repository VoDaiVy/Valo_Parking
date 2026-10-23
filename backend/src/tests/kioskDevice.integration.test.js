const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const express = require('express');
const cookieParser = require('cookie-parser');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../models/User');
const Device = require('../models/KioskDevice');
const deviceRoutes = require('../routes/kioskDeviceRoutes');
const { authorizeParkingOperator } = require('../middlewares/kioskDeviceMiddleware');

test('kiosk enrollment enforces staff identity, cookie scope, revocation and account status over HTTP', { timeout: 240000 }, async () => {
  const oldSecret = process.env.JWT_SECRET;
  const oldNodeEnv = process.env.NODE_ENV;
  const oldBridge = process.env.IOT_BRIDGE_SECRET;
  process.env.JWT_SECRET = 'isolated-kiosk-test-secret';
  process.env.NODE_ENV = 'test';
  process.env.IOT_BRIDGE_SECRET = 'isolated-bridge-close-secret';
  const replica = await MongoMemoryReplSet.create({ binary: { downloadDir: path.resolve(__dirname, '../../../.mongodb-binaries') }, replSet: { count: 1 } });
  let server;
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'kiosk_device_isolated_tests' });
    await Device.init();
    const [staff, customer] = await User.create([
      { username: 'staff-test', email: 'staff@example.invalid', role: 'staff', status: true },
      { username: 'customer-test', email: 'customer@example.invalid', role: 'customer', status: true },
    ]);
    const app = express();
    app.use(express.json()); app.use(cookieParser());
    app.use('/api/kiosk-devices', deviceRoutes);
    app.use('/api/iot', require('../routes/iotRoutes').router);
    app.post('/api/operator', authorizeParkingOperator, (req, res) => res.json({ gate: req.kioskDevice?.gate, role: req.user?.role }));
    server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const staffToken = jwt.sign({ id: String(staff._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const customerToken = jwt.sign({ id: String(customer._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const enroll = (token) => fetch(`${base}/api/kiosk-devices/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ gate: 'ENTRY_1' }),
    });
    assert.equal((await enroll()).status, 401);
    assert.equal((await enroll(customerToken)).status, 403);
    const barrier = (endpoint, headers = {}, body = { gate: 'ENTRY_1' }) => fetch(`${base}/api/iot/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    assert.equal((await barrier('open-barrier')).status, 401);
    assert.equal((await barrier('open-barrier', { Authorization: `Bearer ${customerToken}` })).status, 403);
    assert.equal((await barrier('open-barrier', { 'X-IoT-Bridge-Secret': process.env.IOT_BRIDGE_SECRET })).status, 401);
    assert.equal((await barrier('open-barrier', { Authorization: `Bearer ${staffToken}` })).status, 200);
    assert.equal((await barrier('open-barrier', { Authorization: `Bearer ${staffToken}` }, { gate: 'INVALID' })).status, 400);
    assert.equal((await barrier('close-barrier', { 'X-IoT-Bridge-Secret': 'wrong' })).status, 401);
    assert.equal((await barrier('close-barrier', { 'X-IoT-Bridge-Secret': process.env.IOT_BRIDGE_SECRET })).status, 200);
    const accepted = await enroll(staffToken);
    assert.equal(accepted.status, 201);
    const setCookie = accepted.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    const credential = setCookie.split(';')[0];
    const result = await accepted.json();
    assert.equal(result.data.device.gate, 'ENTRY_1');
    assert.equal(result.data.device.credentialHash, undefined);
    assert.equal(result.data.token, undefined);
    const operate = (gate, origin) => fetch(`${base}/api/operator`, {
      method: 'POST', headers: { Cookie: credential, 'X-Kiosk-Gate': gate, ...(origin ? { Origin: origin } : {}) },
    });
    assert.equal((await operate('ENTRY_1')).status, 200);
    assert.equal((await operate('EXIT_1')).status, 401);
    assert.equal((await operate('ENTRY_1', 'https://foreign.invalid')).status, 401);
    const withoutCookie = await fetch(`${base}/api/operator`, { method: 'POST', headers: { 'X-Kiosk-Gate': 'ENTRY_1' } });
    assert.equal(withoutCookie.status, 401);
    await User.updateOne({ _id: staff._id }, { $set: { status: false } });
    assert.equal((await operate('ENTRY_1')).status, 401);
    await User.updateOne({ _id: staff._id }, { $set: { status: true } });
    const revoked = await fetch(`${base}/api/kiosk-devices/session`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${staffToken}`, Cookie: credential, 'Content-Type': 'application/json' }, body: JSON.stringify({ gate: 'ENTRY_1' }),
    });
    assert.equal(revoked.status, 200);
    assert.equal((await operate('ENTRY_1')).status, 401);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect(); await replica.stop();
    if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
    if (oldBridge === undefined) delete process.env.IOT_BRIDGE_SECRET; else process.env.IOT_BRIDGE_SECRET = oldBridge;
  }
});
