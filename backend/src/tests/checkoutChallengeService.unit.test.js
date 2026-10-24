const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');

process.env.SESSION_QR_SECRET = 'checkout-challenge-test-secret';

const {
  buildCheckoutChallenge,
  parseAndVerifyCheckoutChallenge,
} = require('../services/checkoutChallengeService');

test('checkout challenge is bound to the session and expires', () => {
  const sessionId = new mongoose.Types.ObjectId();
  const issuedAt = 1_700_000_000_000;
  const token = buildCheckoutChallenge({ _id: sessionId }, issuedAt);
  const parsed = parseAndVerifyCheckoutChallenge(token, issuedAt + 1);

  assert.equal(parsed.sessionId, sessionId.toString());
  assert.throws(
    () => parseAndVerifyCheckoutChallenge(token, issuedAt + 5 * 60 * 1000 + 1),
    /expired/i
  );
});

test('checkout challenge rejects tampering', () => {
  const token = buildCheckoutChallenge({ _id: new mongoose.Types.ObjectId() });
  const tampered = token.replace(/:([A-Za-z0-9_-]+)$/, ':tampered');

  assert.throws(
    () => parseAndVerifyCheckoutChallenge(tampered),
    /invalid/i
  );
});
