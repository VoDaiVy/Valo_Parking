const crypto = require('crypto');
const express = require('express');
const KioskDevice = require('../models/KioskDevice');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { authenticateKiosk, cookieName, cookieOptions, credentialHash, VALID_GATES } = require('../middlewares/kioskDeviceMiddleware');

const router = express.Router();

router.get('/session', async (req, res, next) => {
  try {
    const device = await authenticateKiosk(req);
    return res.json({ success: true, data: { authorized: Boolean(device), device } });
  } catch (error) { return next(error); }
});

router.post('/session', protect, authorize('staff', 'admin'), async (req, res, next) => {
  try {
    const gate = String(req.body?.gate || '').toUpperCase();
    if (!VALID_GATES.has(gate)) return res.status(400).json({ success: false, message: 'Invalid kiosk gate.' });
    const previous = req.cookies?.[cookieName(gate)];
    if (typeof previous === 'string' && /^[a-f0-9]{64}$/.test(previous)) {
      await KioskDevice.updateOne({ credentialHash: credentialHash(previous), gate }, { $set: { enabled: false } });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const configuredHours = Number(process.env.KIOSK_SESSION_HOURS);
    const hours = Number.isFinite(configuredHours) && configuredHours > 0 ? Math.min(configuredHours, 168) : 24;
    const expiresAt = new Date(Date.now() + hours * 3600000);
    const device = await KioskDevice.create({ gate, credentialHash: credentialHash(token), createdBy: req.user._id, expiresAt });
    res.cookie(cookieName(gate), token, { ...cookieOptions(), maxAge: hours * 3600000 });
    return res.status(201).json({ success: true, data: { authorized: true, device: { deviceId: String(device._id), gate, expiresAt } } });
  } catch (error) { return next(error); }
});

router.delete('/session', protect, authorize('staff', 'admin'), async (req, res, next) => {
  try {
    const gate = String(req.body?.gate || req.query?.gate || '').toUpperCase();
    if (!VALID_GATES.has(gate)) return res.status(400).json({ success: false, message: 'Invalid kiosk gate.' });
    const token = req.cookies?.[cookieName(gate)];
    if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) {
      await KioskDevice.updateOne({ gate, credentialHash: credentialHash(token) }, { $set: { enabled: false } });
    }
    res.clearCookie(cookieName(gate), cookieOptions());
    return res.json({ success: true, data: { authorized: false } });
  } catch (error) { return next(error); }
});

module.exports = router;
