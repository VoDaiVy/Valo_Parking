const crypto = require('crypto');
const mongoose = require('mongoose');

const QR_PREFIX = 'VALO_MEMBERSHIP';
const ACCOUNT_QR_PREFIX = 'VALO_MEMBERSHIP_ACCOUNT';
const DEFAULT_QR_VERSION = 1;

const getSecret = () => {
  const secret =
    process.env.MEMBERSHIP_QR_SECRET ||
    process.env.BOOKING_QR_SECRET ||
    process.env.JWT_SECRET;
  if (!secret) {
    throw Object.assign(new Error('Membership QR signing secret is not configured'), {
      statusCode: 500,
    });
  }
  return secret;
};

const sign = (subscriptionId, version) =>
  crypto
    .createHmac('sha256', getSecret())
    .update(`${QR_PREFIX}:${version}:${subscriptionId}`)
    .digest('base64url');

const signAccount = (userId, version) =>
  crypto
    .createHmac('sha256', getSecret())
    .update(`${ACCOUNT_QR_PREFIX}:${version}:${userId}`)
    .digest('base64url');

const buildMembershipQrPayload = (subscription) => {
  const subscriptionId = String(subscription?._id || subscription);
  const version = Number(subscription?.qrVersion || DEFAULT_QR_VERSION);

  if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
    throw Object.assign(new Error('Invalid subscription ID'), { statusCode: 400 });
  }

  return `${QR_PREFIX}:${version}:${subscriptionId}:${sign(subscriptionId, version)}`;
};

const parseAndVerifyMembershipQr = (payload) => {
  if (typeof payload !== 'string' || payload.length > 512) {
    throw Object.assign(new Error('Invalid membership QR code'), { statusCode: 400 });
  }

  const [prefix, rawVersion, subscriptionId, signature, ...extra] = payload.trim().split(':');
  const version = Number(rawVersion);
  if (
    extra.length > 0 ||
    prefix !== QR_PREFIX ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > 1_000_000_000 ||
    !mongoose.Types.ObjectId.isValid(subscriptionId) ||
    !signature
  ) {
    throw Object.assign(new Error('Invalid membership QR code'), { statusCode: 400 });
  }

  const expected = Buffer.from(sign(subscriptionId, version));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw Object.assign(new Error('Membership QR signature is invalid'), { statusCode: 400 });
  }

  return { subscriptionId, version };
};

const buildAccountMembershipQrPayload = (user) => {
  const userId = String(user?._id || user);
  const version = Number(user?.membership?.qrVersion || DEFAULT_QR_VERSION);
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw Object.assign(new Error('Invalid user ID'), { statusCode: 400 });
  }
  return `${ACCOUNT_QR_PREFIX}:${version}:${userId}:${signAccount(userId, version)}`;
};

const parseAndVerifyAnyMembershipQr = (payload) => {
  if (typeof payload !== 'string' || payload.length > 512) {
    throw Object.assign(new Error('Invalid membership QR code'), { statusCode: 400 });
  }
  if (!payload.trim().startsWith(`${ACCOUNT_QR_PREFIX}:`)) {
    return {
      credentialType: 'LEGACY_SUBSCRIPTION',
      ...parseAndVerifyMembershipQr(payload),
    };
  }

  const [prefix, rawVersion, userId, signature, ...extra] = payload.trim().split(':');
  const version = Number(rawVersion);
  if (
    extra.length > 0 ||
    prefix !== ACCOUNT_QR_PREFIX ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > 1_000_000_000 ||
    !mongoose.Types.ObjectId.isValid(userId) ||
    !signature
  ) {
    throw Object.assign(new Error('Invalid membership QR code'), { statusCode: 400 });
  }
  const expected = Buffer.from(signAccount(userId, version));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw Object.assign(new Error('Membership QR signature is invalid'), { statusCode: 400 });
  }
  return { credentialType: 'ACCOUNT', userId, version };
};

const isMembershipQrAvailable = (subscription, now = new Date()) =>
  Boolean(
    subscription &&
    subscription.status === 'active' &&
    subscription.paymentStatus === 'paid' &&
    new Date(subscription.expireAt) > now
  );

async function verifyCurrentMembershipQr(payload) {
  const parsed = parseAndVerifyAnyMembershipQr(payload);
  const User = require('../models/User');
  if (parsed.credentialType === 'ACCOUNT') {
    const user = await User.findOne({ _id: parsed.userId, status: true }).select('membership');
    if (!user || Number(user.membership?.qrVersion || 1) !== parsed.version) throw Object.assign(new Error('Membership QR has been replaced or revoked.'), { statusCode: 410 });
    return { ...parsed, userId: user._id };
  }
  if (!require('../utils/featureFlags').isEnabled('MEMBERSHIP_LEGACY_QR_ENABLED', true)) throw Object.assign(new Error('Legacy membership QR is disabled.'), { statusCode: 410 });
  const subscription = await require('../models/Subscription').findOne({ _id: parsed.subscriptionId, paymentStatus: 'paid' });
  const user = subscription && await User.exists({ _id: subscription.user, status: true });
  if (!subscription || !user || Number(subscription.qrVersion || 1) !== parsed.version) throw Object.assign(new Error('Membership QR has been replaced or revoked.'), { statusCode: 410 });
  return { ...parsed, userId: subscription.user };
}

module.exports = {
  verifyCurrentMembershipQr,
  ACCOUNT_QR_PREFIX,
  buildAccountMembershipQrPayload,
  buildMembershipQrPayload,
  isMembershipQrAvailable,
  parseAndVerifyAnyMembershipQr,
  parseAndVerifyMembershipQr,
};
