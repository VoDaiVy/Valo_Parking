const crypto = require('crypto');
const service = require('../services/parkingPassService');
const ParkingPassAction = require('../models/ParkingPassAction');
const Session = require('../models/Session');
const pricingEngine = require('../services/pricingEngine');
const bookingRefundService = require('../services/bookingRefundService');
const cloudinary = require('../config/cloudinary');
const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const enforceGate = (req, action) => {
  if (req.kioskDevice && ((action === 'CHECK_IN' && req.kioskDevice.kind !== 'entry') || (action === 'CHECK_OUT' && req.kioskDevice.kind !== 'exit'))) throw fail('Kiosk gate does not permit this action', 403);
};
exports.resolve = async (req, res, next) => {
  try { res.json({ success: true, data: await service.resolveParkingCredential(req.body.payload) }); } catch (err) { next(err); }
};
exports.quote = async (req, res, next) => {
  try {
    enforceGate(req, 'CHECK_OUT');
    const ticket = await service.resolveParkingCredential(req.body.payload);
    if (String(ticket.pass._id) !== req.params.id || !ticket.allowedActions.includes('CHECK_OUT')) throw fail('Checkout is unavailable');
    const now = new Date();
    const quote = ticket.booking ? await bookingRefundService.quoteEarlyCheckout(ticket.booking, ticket.session, now) : null;
    const pricing = quote?.pricingBreakdown || await pricingEngine.calculatePrice(ticket.session.checkInTime, now);
    const amountToPay = quote ? Math.max(quote.extraAmount - quote.refundAmount, 0) : pricing.finalTotal;
    const wallet = ticket.session.type !== 'WALK_IN' && ticket.session.userId ? await require('../services/walletService').getOrCreateWallet(ticket.session.userId) : null;
    const isEarlyExit = Boolean(ticket.booking && new Date(ticket.booking.scheduledEnd) > now);
    res.json({ success: true, data: { ...ticket, totalPrice: pricing.finalTotal, walletBalance: wallet?.balance || 0, canAutoPay: Boolean(wallet && wallet.balance >= amountToPay), isEarlyExit, remainingHours: isEarlyExit ? Math.ceil((new Date(ticket.booking.scheduledEnd) - now) / 3600000) : 0, amountToPay: quote ? Math.max(quote.extraAmount - quote.refundAmount, 0) : pricing.finalTotal, refundAmount: quote ? Math.max(quote.refundAmount - quote.extraAmount, 0) : 0, pricingBreakdown: pricing } });
  } catch (err) { next(err); }
};
exports.transition = async (req, res, next) => {
  let audit;
  try {
    const { action, idempotencyKey, reason, evidenceImageBase64 } = req.body;
    if (!['CHECK_IN', 'CHECK_OUT'].includes(action) || typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 100) throw fail('Action and idempotency key are required', 400);
    enforceGate(req, action);
    const ticket = await service.resolveParkingCredential(req.body.payload);
    if (String(ticket.pass._id) !== req.params.id) throw fail('QR does not match this pass', 400);
    if (req.kioskDevice) {
      const { normalizeLicensePlate } = require('../utils/licensePlateUtils');
      const observedPlate = req.body.licensePlate || req.body.recognizedPlate;
      if (!observedPlate || normalizeLicensePlate(observedPlate) !== normalizeLicensePlate(ticket.licensePlate)) throw fail('Capture and verify the vehicle plate against this ticket', 400);
    }
    const actorId = String(req.user?._id || req.kioskDevice?.deviceId);
    const requestHash = crypto.createHash('sha256').update(JSON.stringify({ passId: req.params.id, action, payload: req.body.payload, paymentMethod: req.body.paymentMethod, checkoutAttemptId: req.body.checkoutAttemptId, keepPaused: req.body.keepPaused, reason, evidenceHash: crypto.createHash('sha256').update(String(evidenceImageBase64 || '')).digest('hex'), observedPlate: req.body.licensePlate || req.body.recognizedPlate })).digest('hex');
    const existing = await ParkingPassAction.findOne({ actorId, idempotencyKey });
    if (existing) {
      if (existing.requestHash !== requestHash) throw fail('Idempotency key belongs to another action');
      if (['completed', 'payment_pending'].includes(existing.status)) return res.status(existing.result.statusCode).json({ ...existing.result.body, idempotent: true });
      if (existing.status === 'failed') throw fail('This action failed; use a new idempotency key to retry');
      throw fail('This action is already processing; rescan the current ticket');
    }
    if (!ticket.allowedActions.includes(action)) throw fail('Action is unavailable for the current ticket state');
    let evidenceImageUrl;
    if (req.user) {
      if (typeof reason !== 'string' || !reason.trim() || reason.length > 500 || typeof evidenceImageBase64 !== 'string' || evidenceImageBase64.length > 20 * 1024 * 1024 || !/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+$/.test(evidenceImageBase64)) throw fail('Reason and evidence photo are required', 400);
      evidenceImageUrl = (await cloudinary.uploader.upload(evidenceImageBase64, { folder: 'valo_parking/pass-evidence' })).secure_url;
    }
    audit = await ParkingPassAction.create({ actorId, idempotencyKey, requestHash, passId: ticket.pass._id, sessionId: ticket.session?._id, action, reason, evidenceImageUrl });
    req.parkingPassAction = { ...req.body, auditId: audit._id, evidenceImageUrl, passId: ticket.pass._id, expectedVersion: ticket.pass.legacy ? null : ticket.pass.qrVersion, expectedBookingQrVersion: req.body.payload.startsWith('VALO_BOOKING:') ? require('../services/bookingQrService').parseAndVerifyBookingQr(req.body.payload).version : null, bookingId: ticket.booking?._id };
    // Existing controllers preserve slot holds, re-entry, refunds and notification contracts.
    if (action === 'CHECK_IN') {
      req.body = { ...req.body, qrPayload: req.body.payload, licensePlate: ticket.licensePlate, entryImageBase64: evidenceImageBase64, entryGate: req.kioskDevice?.gate, parkingPassId: ticket.pass._id };
    } else {
      req.body = { ...req.body, qrPayload: req.body.payload, sessionId: ticket.session._id, exitImageBase64: evidenceImageBase64, exitGate: req.kioskDevice?.gate, paymentMethod: req.body.paymentMethod || (ticket.session.type !== 'WALK_IN' && ticket.session.userId ? 'wallet' : 'vietqr') };
    }
    const originalJson = res.json.bind(res);
    res.json = async (body) => {
      try {
        const completed = body.success && !body.requiresPayment;
        await ParkingPassAction.updateOne({ _id: audit._id }, { $set: { status: completed ? 'completed' : body.requiresPayment ? 'payment_pending' : 'failed', result: { statusCode: res.statusCode, body } } });
        return originalJson(body);
      } catch (err) { return next(err); }
    };
    const controller = require('./sessionController');
    const transitionNext = async (err) => {
      if (err) await ParkingPassAction.updateOne({ _id: audit._id, status: 'pending' }, { $set: { status: 'failed' } });
      return next(err);
    };
    return action === 'CHECK_IN' ? controller.createKioskSession(req, res, transitionNext) : controller.kioskCheckout(req, res, transitionNext);
  } catch (err) {
    if (audit) await ParkingPassAction.updateOne({ _id: audit._id }, { $set: { status: 'failed' } });
    next(err.code === 11000 ? fail('This action is already processing; retry the same idempotency key') : err);
  }
};
exports.getQr = async (req, res, next) => {
  try {
    const ticket = await service.getPassTicket(req.params.id);
    const ownerId = ticket.booking?.userId || ticket.session?.userId;
    if (!['staff', 'admin'].includes(req.user?.role) && String(ownerId) !== String(req.user?._id)) throw fail('Ticket access denied', 403);
    const available = ticket.booking ? ['PAID', 'ACTIVE', 'PAUSED'].includes(ticket.booking.status) : ticket.session?.status === 'active';
    res.json({ success: true, data: { passId: ticket.pass._id, payload: available ? ticket.payload : null, available } });
  } catch (err) { next(err); }
};
exports.reissue = async (req, res, next) => {
  const mongoose = require('mongoose');
  let transaction;
  try {
    if (!service.isPassIssuanceEnabled()) throw fail('Parking pass reissue is disabled', 503);
    if (typeof req.body.reason !== 'string' || !req.body.reason.trim() || req.body.reason.length > 500) throw fail('A reissue reason is required', 400);
    const ticket = await service.getPassTicket(req.params.id);
    const ownerId = ticket.booking?.userId || ticket.session?.userId;
    if (!['staff', 'admin'].includes(req.user?.role) && String(ownerId) !== String(req.user?._id)) throw fail('Ticket access denied', 403);
    if (!ticket.allowedActions.length && !['PAID', 'PAUSED'].includes(ticket.booking?.status)) throw fail('This ticket has ended', 410);
    transaction = await mongoose.startSession();
    let updated;
    await transaction.withTransaction(async () => {
      updated = await require('../models/ParkingPass').findOneAndUpdate({ _id: ticket.pass._id, qrVersion: ticket.pass.qrVersion, revokedAt: null }, { $inc: { qrVersion: 1 } }, { new: true, session: transaction });
      if (!updated) throw fail('Ticket changed; reload it before reissuing');
      await ParkingPassAction.create([{ passId: ticket.pass._id, actorId: String(req.user._id), action: 'REISSUE', idempotencyKey: `reissue:${ticket.pass._id}:${updated.qrVersion}`, requestHash: crypto.createHash('sha256').update(req.body.reason).digest('hex'), reason: req.body.reason, status: 'completed' }], { session: transaction });
      if (ticket.booking) await require('../models/Booking').updateOne({ _id: ticket.booking._id }, { $inc: { qrVersion: 1 } }, { session: transaction });
    });
    res.json({ success: true, data: { passId: updated._id, payload: require('../services/parkingPassQrService').buildParkingPassQrPayload(updated), qrVersion: updated.qrVersion } });
  } catch (err) { next(err); } finally { if (transaction) await transaction.endSession(); }
};
