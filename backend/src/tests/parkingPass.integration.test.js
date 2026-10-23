const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const Module = require('node:module');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

process.env.PARKING_PASS_QR_SECRET = 'isolated-integration-parking-secret';
process.env.BOOKING_QR_SECRET = 'isolated-integration-booking-secret';
process.env.PARKING_PASS_ISSUE_ENABLED = 'true';
const providerPayments = new Map();
const payos = { paymentRequests: {
  create: async (input) => {
    if (failNextProviderCreate) { failNextProviderCreate = false; throw new Error('Simulated transport failure'); }
    providerPayments.set(input.orderCode, { ...input, status: 'PENDING', amountPaid: 0, amountRemaining: input.amount });
    return { qrCode: `PAYMENT:${input.orderCode}`, checkoutUrl: 'https://example.invalid/payment' };
  },
  get: async (orderCode) => {
    if (!providerPayments.has(orderCode)) throw Object.assign(new Error('Provider order not found'), { statusCode: 404 });
    return providerPayments.get(orderCode);
  },
  cancel: async (orderCode) => { const value = providerPayments.get(orderCode); value.status = 'CANCELLED'; return value; },
} };
let onEvidenceUpload = null;
let failNextProviderCreate = false;
const noopAsync = async () => {};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '../config/payos') return payos;
  if (request === '../config/cloudinary') return { uploader: { upload: async () => { if (onEvidenceUpload) await onEvidenceUpload(); return { secure_url: 'https://example.invalid/evidence' }; } } };
  if (request === '../utils/emailUtils') return { sendKioskCheckInEmail: noopAsync, sendCheckoutEmail: noopAsync };
  if (request === '../services/notificationTriggers') return { notifyVehicleEntry: noopAsync, notifyVehicleExit: noopAsync, notifyPaymentSuccess: noopAsync };
  if (request === '../services/aiCopilot/notificationEvents') return { notifySessionCreatedSafely: () => {} };
  if (request === '../services/loyaltyService') return { earnPoints: noopAsync };
  if (request === '../routes/iotRoutes') return { triggerBarrierOpen: () => {} };
  if (request === '../services/telegramService') return { createGuestClaim: async () => null };
  return originalLoad.call(this, request, parent, isMain);
};
const controller = require('../controllers/sessionController');
const passController = require('../controllers/parkingPassController');
const attempts = require('../services/checkoutAttemptService');
Module._load = originalLoad;
const Session = require('../models/Session');
const Booking = require('../models/Booking');
const ParkingFloor = require('../models/ParkingFloor');
const BookingHold = require('../models/BookingHold');
const ParkingPass = require('../models/ParkingPass');
const ParkingPassAction = require('../models/ParkingPassAction');
const CheckoutAttempt = require('../models/CheckoutAttempt');
const passService = require('../services/parkingPassService');
const qr = require('../services/parkingPassQrService');
const call = (fn, request) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ statusCode: this.statusCode, body }); return this; } };
  Promise.resolve(fn({ app: { get: () => null }, ...request }, res, reject)).catch(reject);
});
const operator = { _id: new mongoose.Types.ObjectId(), role: 'staff' };
const evidence = 'data:image/jpeg;base64,YQ==';

test('parking passes operate atomically on an isolated replica set', { timeout: 240000 }, async (t) => {
  const replica = await MongoMemoryReplSet.create({ binary: { downloadDir: path.resolve(__dirname, '../../../.mongodb-binaries') }, replSet: { count: 1 } });
  try {
    await mongoose.connect(replica.getUri(), { dbName: 'parking_pass_isolated_tests' });
    await Promise.all([ParkingPass.init(), ParkingPassAction.init(), CheckoutAttempt.init()]);
    await Session.collection.createIndex({ licensePlate: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
    await Session.collection.createIndex({ floorId: 1, parkingSlot: 1 }, { unique: true, partialFilterExpression: { status: 'active', floorId: { $type: 'objectId' }, parkingSlot: { $type: 'string' } } });
    const floor = await ParkingFloor.create({ floorNumber: 1, layoutData: { elements: Array.from({ length: 10 }, (_, i) => ({ name: `A${i}`, type: 'slot' })) } });
    await t.test('concurrent issuance produces exactly one booking credential', async () => {
      const booking = await Booking.create({ licensePlate: '51A12345', floorId: floor._id, parkingSlot: 'A0', scheduledStart: new Date(), scheduledEnd: new Date(Date.now() + 3600000), durationHours: 1, paymentMethod: 'wallet', status: 'PAID' });
      const results = await Promise.all(Array.from({ length: 8 }, () => passService.ensureBookingPass(booking)));
      assert.equal(new Set(results.map((value) => String(value._id))).size, 1);
      assert.equal(await ParkingPass.countDocuments({ bookingId: booking._id }), 1);
      await Booking.deleteOne({ _id: booking._id });
    });
    await t.test('two concurrent walk-in entries cannot create two active sessions', async () => {
      const now = new Date();
      const holds = await BookingHold.create(['A1', 'A2'].map((slotCode) => ({ floorId: floor._id, slotCode, licensePlate: '51A22222', startTime: now, endTime: new Date(Date.now() + 3600000), expiresAt: new Date(Date.now() + 300000) })));
      const results = await Promise.allSettled(holds.map((hold) => call(controller.createKioskSession, { body: { licensePlate: '51A22222', phone: '0901234567', floorId: floor._id, parkingSlot: hold.slotCode, bookingHoldId: hold._id }, user: operator })));
      const successful = results.filter((value) => value.status === 'fulfilled' && value.value.body.success);
      assert.equal(successful.length, 1);
      assert.equal(await Session.countDocuments({ licensePlate: '51A22222', status: 'active' }), 1);
      const created = successful[0].value.body;
      assert.ok(created.pass?.payload.startsWith('VALO_PASS:'));
      const ticket = await passService.resolveParkingCredential(created.pass.payload);
      assert.deepEqual(ticket.allowedActions, ['CHECK_OUT']);
    });
    await t.test('staff cash checkout is audited and same QR cannot checkout twice', async () => {
      const parkingSession = await Session.findOne({ licensePlate: '51A22222', status: 'active' });
      const pass = await passService.ensureSessionPass(parkingSession);
      const payload = qr.buildParkingPassQrPayload(pass);
      const request = { params: { id: String(pass._id) }, body: { payload, action: 'CHECK_OUT', idempotencyKey: 'cash-checkout-once', reason: 'Verified matching vehicle', evidenceImageBase64: evidence, paymentMethod: 'cash' }, user: operator };
      const result = await call(passController.transition, request);
      assert.equal(result.body.success, true);
      assert.equal((await Session.findById(parkingSession._id)).status, 'completed');
      const replay = await call(passController.transition, { ...request, body: { payload, action: 'CHECK_OUT', idempotencyKey: 'cash-checkout-once', reason: 'Verified matching vehicle', evidenceImageBase64: evidence, paymentMethod: 'cash' } });
      assert.equal(replay.body.idempotent, true);
      assert.equal(await ParkingPassAction.countDocuments({ passId: pass._id, status: 'completed' }), 1);
      const completed = await Session.findById(parkingSession._id);
      assert.equal(completed.settledPaidAmount, completed.totalPrice);
      assert.deepEqual((await passService.resolveParkingCredential(payload)).allowedActions, []);
    });
    await t.test('same booking QR checks in on staff phone and checks out at kiosk', async () => {
      const User = require('../models/User');
      const Wallet = require('../models/Wallet');
      const owner = await User.create({ username: 'booking-qr-owner', email: 'booking-qr-owner@example.invalid', role: 'customer' });
      await Wallet.create({ userId: owner._id, balance: 100000 });
      const booking = await Booking.create({ userId: owner._id, licensePlate: '51A44444', floorId: floor._id, parkingSlot: 'A4', scheduledStart: new Date(), scheduledEnd: new Date(Date.now() + 3600000), durationHours: 1, paymentMethod: 'wallet', prepaidAmount: 10000, status: 'PAID' });
      const pass = await passService.ensureBookingPass(booking);
      const payload = qr.buildParkingPassQrPayload(pass);
      const checkedIn = await call(passController.transition, { params: { id: String(pass._id) }, user: operator, body: { payload, action: 'CHECK_IN', idempotencyKey: 'staff-booking-entry', reason: 'Vehicle matches', evidenceImageBase64: evidence } });
      assert.equal(checkedIn.body.success, true);
      assert.equal((await Booking.findById(booking._id)).status, 'ACTIVE');
      const checkedOut = await call(passController.transition, { params: { id: String(pass._id) }, kioskDevice: { deviceId: 'isolated-exit-device', kind: 'exit', gate: 'EXIT_1' }, body: { payload, licensePlate: '51A44444', action: 'CHECK_OUT', idempotencyKey: 'kiosk-booking-exit', paymentMethod: 'wallet' } });
      assert.equal(checkedOut.body.success, true, JSON.stringify(checkedOut.body));
      assert.equal((await Booking.findById(booking._id)).status, 'COMPLETED');
      const completed = await Session.findOne({ bookingId: booking._id });
      assert.equal(typeof completed.settledPaidAmount, 'number');
      const finalizedBooking = await Booking.findById(booking._id);
      assert.equal((await Wallet.findOne({ userId: owner._id })).balance, 100000 + finalizedBooking.refundSettlements[0].netWalletAmount);
    });
    await t.test('reissue invalidates both pass and legacy booking QR, including during a transition', async () => {
      const booking = await Booking.create({ licensePlate: '51A55555', floorId: floor._id, parkingSlot: 'A5', scheduledStart: new Date(), scheduledEnd: new Date(Date.now() + 3600000), durationHours: 1, paymentMethod: 'wallet', status: 'PAID' });
      const pass = await passService.ensureBookingPass(booking);
      const payload = qr.buildParkingPassQrPayload(pass);
      const oldLegacy = require('../services/bookingQrService').buildBookingQrPayload(booking);
      const replaced = await call(passController.reissue, { params: { id: String(pass._id) }, user: operator, body: { reason: 'Lost ticket' } });
      assert.equal(replaced.body.success, true);
      await assert.rejects(() => passService.resolveParkingCredential(payload), { statusCode: 410 });
      await assert.rejects(() => passService.resolveParkingCredential(oldLegacy), { statusCode: 410 });
      const current = replaced.body.data.payload;
      onEvidenceUpload = async () => { onEvidenceUpload = null; await ParkingPass.updateOne({ _id: pass._id }, { $inc: { qrVersion: 1 } }); };
      await assert.rejects(() => call(passController.transition, { params: { id: String(pass._id) }, user: operator, body: { payload: current, action: 'CHECK_IN', idempotencyKey: 'stale-entry-reissue-race', reason: 'Vehicle matches', evidenceImageBase64: evidence } }), { statusCode: 410 });
      assert.equal((await Booking.findById(booking._id)).status, 'PAID');
      assert.equal(await Session.countDocuments({ bookingId: booking._id }), 0);
    });
    await t.test('checkout rechecks credential version inside its transaction after evidence upload', async () => {
      const parkingSession = await Session.create({ licensePlate: '51A77777', floorId: floor._id, parkingSlot: 'A7', checkInTime: new Date(Date.now() - 3600000) });
      const pass = await passService.ensureSessionPass(parkingSession);
      const payload = qr.buildParkingPassQrPayload(pass);
      let uploads = 0;
      onEvidenceUpload = async () => {
        uploads += 1;
        if (uploads === 2) { onEvidenceUpload = null; await ParkingPass.updateOne({ _id: pass._id }, { $inc: { qrVersion: 1 } }); }
      };
      await assert.rejects(() => call(passController.transition, { params: { id: String(pass._id) }, user: operator, body: { payload, action: 'CHECK_OUT', idempotencyKey: 'reissue-during-checkout', reason: 'Vehicle matches', evidenceImageBase64: evidence, paymentMethod: 'cash' } }), { statusCode: 410 });
      onEvidenceUpload = null;
      assert.equal((await Session.findById(parkingSession._id)).status, 'active');
      assert.equal((await ParkingPassAction.findOne({ idempotencyKey: 'reissue-during-checkout' })).status, 'failed');
    });
    await t.test('two concurrent wallet checkouts debit once and cannot finalize without payment', async () => {
      const Wallet = require('../models/Wallet');
      const WalletTransaction = require('../models/WalletTransaction');
      const ownerId = new mongoose.Types.ObjectId();
      await Wallet.create({ userId: ownerId, balance: 100000 });
      const parkingSession = await Session.create({ licensePlate: '51A88888', type: 'SUBSCRIPTION', userId: ownerId, floorId: floor._id, parkingSlot: 'A8', checkInTime: new Date(Date.now() - 3600000) });
      const pass = await passService.ensureSessionPass(parkingSession);
      const payload = qr.buildParkingPassQrPayload(pass);
      const results = await Promise.allSettled(['wallet-race-a', 'wallet-race-b'].map((idempotencyKey) => call(passController.transition, { params: { id: String(pass._id) }, user: operator, body: { payload, action: 'CHECK_OUT', idempotencyKey, reason: 'Vehicle matches', evidenceImageBase64: evidence, paymentMethod: 'wallet' } })));
      assert.equal(results.filter((value) => value.status === 'fulfilled' && value.value.body.success).length, 1);
      const completed = await Session.findById(parkingSession._id);
      assert.equal(completed.status, 'completed');
      assert.equal((await Wallet.findOne({ userId: ownerId })).balance, 100000 - completed.totalPrice);
      assert.equal(await WalletTransaction.countDocuments({ userId: ownerId }), 1);
    });
    await t.test('walk-in sessions cannot debit a wallet inferred from phone, and quotes hide its balance', async () => {
      const Wallet = require('../models/Wallet');
      const ownerId = new mongoose.Types.ObjectId();
      await Wallet.create({ userId: ownerId, balance: 90000 });
      const parkingSession = await Session.create({ licensePlate: '51A99999', type: 'WALK_IN', userId: ownerId, floorId: floor._id, parkingSlot: 'A9', phone: '0901234567', checkInTime: new Date(Date.now() - 3600000) });
      const pass = await passService.ensureSessionPass(parkingSession);
      const payload = qr.buildParkingPassQrPayload(pass);
      const quoted = await call(passController.quote, { params: { id: String(pass._id) }, user: operator, body: { payload } });
      assert.equal(quoted.body.data.walletBalance, 0);
      assert.equal(quoted.body.data.canAutoPay, false);
      const scanned = await call(controller.kioskExitScan, { user: operator, body: { licensePlate: parkingSession.licensePlate } });
      assert.equal(scanned.body.data.walletBalance, 0);
      assert.equal(scanned.body.data.canAutoPay, false);
      const denied = await call(passController.transition, { params: { id: String(pass._id) }, user: operator, body: { payload, action: 'CHECK_OUT', idempotencyKey: 'walk-in-cannot-use-inferred-wallet', reason: 'Vehicle matches', evidenceImageBase64: evidence, paymentMethod: 'wallet' } });
      assert.equal(denied.statusCode, 403);
      assert.equal(denied.body.code, 'WALK_IN_WALLET_UNVERIFIED');
      assert.equal((await Wallet.findOne({ userId: ownerId })).balance, 90000);
      assert.equal((await Session.findById(parkingSession._id)).status, 'active');
    });
    await t.test('provider provisioning failure retries the same server order rather than creating a second payment', async () => {
      const parkingSession = await Session.create({ licensePlate: '51A66666', floorId: floor._id, parkingSlot: 'A6' });
      failNextProviderCreate = true;
      await assert.rejects(() => attempts.createAttempt({ sessionId: parkingSession._id, amountDue: 20000, quoteTime: new Date() }), /Simulated transport failure/);
      const persisted = await CheckoutAttempt.findOne({ sessionId: parkingSession._id });
      const recovered = await attempts.createAttempt({ sessionId: parkingSession._id, amountDue: 20000, quoteTime: new Date() });
      assert.equal(recovered.orderCode, persisted.orderCode);
      assert.equal(await CheckoutAttempt.countDocuments({ sessionId: parkingSession._id }), 1);
      assert.ok(recovered.qrCode);
    });
    await t.test('expired local quote still recognizes exact provider payment and another session cannot claim it', async () => {
      const parkingSession = await Session.create({ licensePlate: '51A33333', floorId: floor._id, parkingSlot: 'A3' });
      const payment = await attempts.createAttempt({ sessionId: parkingSession._id, amountDue: 30000, quoteTime: new Date() });
      const existing = await attempts.createAttempt({ sessionId: parkingSession._id, amountDue: 30000, quoteTime: new Date() });
      assert.equal(String(existing.checkoutAttemptId), String(payment.checkoutAttemptId));
      await CheckoutAttempt.updateOne({ _id: payment.checkoutAttemptId }, { $set: { expiresAt: new Date(Date.now() - 60000) } });
      Object.assign(providerPayments.get(payment.orderCode), { status: 'PAID', amountPaid: 30000, amountRemaining: 0 });
      assert.equal((await attempts.verifyAttempt({ attemptId: payment.checkoutAttemptId, sessionId: parkingSession._id })).amountDue, 30000);
      await assert.rejects(() => attempts.verifyAttempt({ attemptId: payment.checkoutAttemptId, sessionId: new mongoose.Types.ObjectId() }), { statusCode: 409 });
    });
  } finally {
    await mongoose.disconnect();
    await replica.stop();
  }
});
