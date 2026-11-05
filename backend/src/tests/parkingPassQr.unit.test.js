const assert = require('node:assert/strict');
const test = require('node:test');
const { buildParkingPassQrPayload, parseAndVerifyParkingPassQr } = require('../services/parkingPassQrService');
const { getAllowedActions } = require('../services/parkingPassService');
process.env.PARKING_PASS_QR_SECRET = 'unit-test-parking-pass-secret';
const passId = '507f1f77bcf86cd799439011';
test('parking pass signature binds identity, format and revocable credential version', () => {
  const payload = buildParkingPassQrPayload({ _id: passId, qrVersion: 7 });
  assert.deepEqual(parseAndVerifyParkingPassQr(payload), { passId, version: 7, formatVersion: 1 });
  for (const changed of [payload.replace(':7:', ':8:'), payload.replace(':1:', ':2:'), payload.replace(passId, '507f1f77bcf86cd799439012'), `${payload}:extra`, payload.replace(':7:', ':07:'), payload.slice(0, -1)]) assert.throws(() => parseAndVerifyParkingPassQr(changed));
});
test('unsigned IDs, unbounded payloads and malformed versions are rejected', () => {
  for (const payload of [null, passId, 'a'.repeat(513), `VALO_PASS:1:${passId}:NaN:fake`, `VALO_PASS:1:${passId}:1000000001:fake`]) assert.throws(() => parseAndVerifyParkingPassQr(payload));
  assert.throws(() => buildParkingPassQrPayload({ _id: passId, qrVersion: 0 }));
});
test('shared ticket actions respect check-in window and paused re-entry', () => {
  const now = new Date('2026-10-08T07:00:00Z');
  const booking = { status: 'PAID', scheduledStart: new Date('2026-10-08T07:15:00Z'), scheduledEnd: new Date('2026-10-08T09:00:00Z') };
  assert.deepEqual(getAllowedActions(booking, null, now), ['CHECK_IN']);
  assert.deepEqual(getAllowedActions(booking, null, new Date('2026-10-08T06:44:59Z')), []);
  assert.deepEqual(getAllowedActions(booking, null, new Date('2026-10-08T07:45:00Z')), ['CHECK_IN']);
  assert.deepEqual(getAllowedActions(booking, null, new Date('2026-10-08T07:45:01Z')), []);
  assert.deepEqual(getAllowedActions({ ...booking, status: 'EXPIRED' }, null, new Date('2026-10-08T07:40:00Z')), ['CHECK_IN']);
  assert.deepEqual(getAllowedActions({ ...booking, status: 'EXPIRED' }, null, new Date('2026-10-08T07:45:01Z')), []);
  assert.deepEqual(getAllowedActions({ ...booking, scheduledEnd: new Date('2026-10-08T07:20:00Z') }, null, new Date('2026-10-08T07:21:00Z')), []);
  assert.deepEqual(getAllowedActions({ ...booking, status: 'PAUSED' }, null, new Date('2026-10-08T08:00:00Z')), ['CHECK_IN']);
  assert.deepEqual(getAllowedActions({ ...booking, status: 'PAUSED' }, null, new Date('2026-10-08T09:00:01Z')), []);
});
test('walk-in ticket cannot create a second entry and terminal bookings cannot checkout', () => {
  assert.deepEqual(getAllowedActions(null, { status: 'active' }), ['CHECK_OUT']);
  assert.deepEqual(getAllowedActions(null, { status: 'completed' }), []);
  assert.deepEqual(getAllowedActions({ status: 'ACTIVE' }, { status: 'active' }), ['CHECK_OUT']);
  for (const status of ['COMPLETED', 'CANCELLED', 'PENDING', 'EXPIRED']) assert.deepEqual(getAllowedActions({ status }, { status: 'active' }), []);
});
