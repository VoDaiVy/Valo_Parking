const crypto = require('crypto');
const PREFIX = 'VALO_PASS';
const fail = (message) => Object.assign(new Error(message), { statusCode: 400 });
const sign = (value) => {
  const secret = process.env.PARKING_PASS_QR_SECRET;
  if (!secret) throw Object.assign(new Error('Parking pass signing secret is not configured'), { statusCode: 503 });
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
};
const buildParkingPassQrPayload = (pass) => {
  const id = String(pass?._id || '');
  const version = Number(pass?.qrVersion);
  if (!/^[a-f0-9]{24}$/i.test(id) || !Number.isSafeInteger(version) || version < 1 || version > 1e9) throw fail('Invalid parking pass');
  const value = `${PREFIX}:1:${id}:${version}`;
  return `${value}:${sign(value)}`;
};
const parseAndVerifyParkingPassQr = (payload) => {
  if (typeof payload !== 'string' || payload.length > 512) throw fail('Invalid parking pass QR');
  const [prefix, format, passId, rawVersion, signature, ...extra] = payload.trim().split(':');
  const version = Number(rawVersion);
  if (prefix !== PREFIX || format !== '1' || extra.length || !/^[a-f0-9]{24}$/i.test(passId || '') || !/^[1-9]\d{0,9}$/.test(rawVersion || '') || !Number.isSafeInteger(version) || version > 1e9 || !/^[A-Za-z0-9_-]{43}$/.test(signature || '')) throw fail('Invalid parking pass QR');
  const expected = Buffer.from(sign(`${prefix}:${format}:${passId}:${rawVersion}`));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(expected, actual)) throw fail('Invalid parking pass signature');
  return { passId, version, formatVersion: 1 };
};
module.exports = { buildParkingPassQrPayload, parseAndVerifyParkingPassQr };
