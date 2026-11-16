const crypto = require('crypto');
const { protect, authorize } = require('./authMiddleware');
const { VALID_GATES } = require('./kioskDeviceMiddleware');

const staffOnly = (req, res, next) => protect(req, res, () => authorize('staff', 'admin')(req, res, next));
const validateGate = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ success: false, message: 'A barrier request object is required.' });
  const gate = String(req.body?.gate || 'ENTRY_1').toUpperCase();
  if (!VALID_GATES.has(gate)) return res.status(400).json({ success: false, message: 'Invalid barrier gate.' });
  req.body.gate = gate;
  return next();
};
const bridgeOrStaffClose = (req, res, next) => {
  const supplied = req.headers['x-iot-bridge-secret'];
  const expected = process.env.IOT_BRIDGE_SECRET;
  if (expected && typeof supplied === 'string') {
    const left = Buffer.from(supplied), right = Buffer.from(expected);
    if (left.length === right.length && crypto.timingSafeEqual(left, right)) {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ success: false, message: 'A barrier request object is required.' });
      req.body.fromBridge = true;
      return next();
    }
  }
  return staffOnly(req, res, next);
};

module.exports = { staffOnly, validateGate, bridgeOrStaffClose };
