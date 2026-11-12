const crypto = require('crypto');
const mongoose = require('mongoose');

const PREFIX = 'VALO_CHECKOUT';
const VERSION = 1;
const TTL_MS = 5 * 60 * 1000;

const getSecret = () => process.env.SESSION_QR_SECRET || process.env.JWT_SECRET;

const sign = (sessionId, expiresAt) => crypto
  .createHmac('sha256', getSecret())
  .update(`${PREFIX}:${VERSION}:${sessionId}:${expiresAt}`)
  .digest('base64url');

const buildCheckoutChallenge = (session, now = Date.now()) => {
  const sessionId = String(session?._id || session || '');
  if (!mongoose.Types.ObjectId.isValid(sessionId) || !getSecret()) return null;
  const expiresAt = now + TTL_MS;
  return `${PREFIX}:${VERSION}:${sessionId}:${expiresAt}:${sign(sessionId, expiresAt)}`;
};

const parseAndVerifyCheckoutChallenge = (payload, now = Date.now()) => {
  if (typeof payload !== 'string' || payload.length > 512) {
    throw Object.assign(new Error('Invalid checkout challenge'), { statusCode: 400 });
  }

  const [prefix, rawVersion, sessionId, rawExpiresAt, signature, ...extra] = payload.trim().split(':');
  const version = Number(rawVersion);
  const expiresAt = Number(rawExpiresAt);
  if (
    extra.length > 0
    || prefix !== PREFIX
    || version !== VERSION
    || !mongoose.Types.ObjectId.isValid(sessionId)
    || !Number.isSafeInteger(expiresAt)
    || expiresAt <= now
    || !signature
    || !getSecret()
  ) {
    throw Object.assign(new Error('Invalid or expired checkout challenge'), { statusCode: 400 });
  }

  const expected = Buffer.from(sign(sessionId, expiresAt));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw Object.assign(new Error('Checkout challenge signature is invalid'), { statusCode: 400 });
  }

  return { sessionId, expiresAt, version };
};

module.exports = { buildCheckoutChallenge, parseAndVerifyCheckoutChallenge };
