const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SESSION_QR_SECRET = 'unit-test-session-secret';

const {
  buildSessionExitQrPayload,
  parseAndVerifySessionExitQr,
} = require('../services/sessionQrService');

test('session exit QR is signed and expires', () => {
  const sessionId = '507f1f77bcf86cd799439011';
  const now = 1_800_000_000_000;
  const ttl = 30 * 24 * 60 * 60 * 1000;
  const payload = buildSessionExitQrPayload({ _id: sessionId }, now);

  assert.deepEqual(parseAndVerifySessionExitQr(payload, now + 1), {
    sessionId,
    expiresAt: now + ttl,
    version: 1,
  });

  assert.throws(
    () => parseAndVerifySessionExitQr(payload.replace(/.$/, 'x'), now + 1),
    /signature is invalid/
  );
  assert.throws(
    () => parseAndVerifySessionExitQr(payload, now + ttl + 1),
    /expired session exit QR/
  );
});
