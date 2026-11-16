const crypto = require('crypto');
const KioskDevice = require('../models/KioskDevice');
const User = require('../models/User');
const { protect } = require('./authMiddleware');

const VALID_GATES = new Set(['ENTRY_1', 'EXIT_1']);
const cookieName = (gate) => `valo_kiosk_${gate}`;
const credentialHash = (credential) => crypto.createHash('sha256').update(credential).digest('hex');
const requestGate = (req) => String(req.headers['x-kiosk-gate'] || req.query?.gate || '').toUpperCase();
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api',
});

async function authenticateKiosk(req) {
  const gate = requestGate(req);
  if (!VALID_GATES.has(gate)) return null;
  const origin = req.headers.origin;
  const allowedOrigin = process.env.CLIENT_URL || 'http://localhost:5173';
  if (origin && origin !== allowedOrigin) return null;
  const credential = req.cookies?.[cookieName(gate)];
  if (typeof credential !== 'string' || !/^[a-f0-9]{64}$/.test(credential)) return null;
  const device = await KioskDevice.findOne({
    gate, credentialHash: credentialHash(credential), enabled: true, expiresAt: { $gt: new Date() },
  }).lean();
  if (!device) return null;
  const operator = await User.exists({ _id: device.createdBy, status: true, role: { $in: ['staff', 'admin'] } });
  if (!operator) return null;
  return { deviceId: String(device._id), gate, kind: gate === 'ENTRY_1' ? 'entry' : 'exit', expiresAt: device.expiresAt };
}

async function authorizeParkingOperator(req, res, next) {
  if (req.headers.authorization) {
    return protect(req, res, () => {
      if (!['staff', 'admin'].includes(req.user?.role)) {
        return res.status(403).json({ success: false, message: 'Staff or admin access required.' });
      }
      return next();
    });
  }
  try {
    const device = await authenticateKiosk(req);
    if (!device) {
      return res.status(401).json({
        success: false, code: 'KIOSK_DEVICE_REQUIRED',
        message: 'A staff member must authorize this kiosk before scanning parking tickets.',
      });
    }
    req.kioskDevice = device;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { authorizeParkingOperator, authenticateKiosk, cookieName, credentialHash, cookieOptions, VALID_GATES };
