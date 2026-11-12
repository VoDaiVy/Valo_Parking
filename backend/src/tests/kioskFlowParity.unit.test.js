const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.PAYOS_CLIENT_ID = process.env.PAYOS_CLIENT_ID || 'test-payos-client-id';
process.env.PAYOS_API_KEY = process.env.PAYOS_API_KEY || 'test-payos-api-key';
process.env.PAYOS_CHECKSUM_KEY = process.env.PAYOS_CHECKSUM_KEY || 'test-payos-checksum-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key';
process.env.BOOKING_QR_SECRET = process.env.BOOKING_QR_SECRET || 'test-booking-qr-secret';
process.env.MEMBERSHIP_QR_SECRET = process.env.MEMBERSHIP_QR_SECRET || 'test-membership-qr-secret';
process.env.SESSION_QR_SECRET = process.env.SESSION_QR_SECRET || 'test-session-qr-secret';

const Session = require('../models/Session');
const Booking = require('../models/Booking');
const Vehicle = require('../models/Vehicle');
const User = require('../models/User');
const UserDetail = require('../models/UserDetail');
const Subscription = require('../models/Subscription');
const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const ParkingFloor = require('../models/ParkingFloor');
const Slot = require('../models/Slot');
const BookingHold = require('../models/BookingHold');
const SlotAuditLog = require('../models/SlotAuditLog');
const SlotMaintenanceLog = require('../models/SlotMaintenanceLog');
const Revenue = require('../models/Revenue');
const pricingEngine = require('../services/pricingEngine');
const bookingRefundService = require('../services/bookingRefundService');
const walletService = require('../services/walletService');
const { buildBookingQrPayload } = require('../services/bookingQrService');
const { buildAccountMembershipQrPayload } = require('../services/membershipQrService');
const { buildCheckoutChallenge } = require('../services/checkoutChallengeService');
const sessionController = require('../controllers/sessionController');
const bookingController = require('../controllers/bookingController');

const oid = (hex) => new mongoose.Types.ObjectId(hex);

function createRes() {
  const state = { statusCode: 200, body: null };
  return {
    state,
    status(code) {
      state.statusCode = code;
      return this;
    },
    json(payload) {
      state.body = payload;
      return this;
    },
  };
}

function queryable(value) {
  return {
    sort() { return this; },
    populate() { return this; },
    select() { return this; },
    session() { return this; },
    lean() { return Promise.resolve(value); },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function stubMany(pairs) {
  const restores = [];
  for (const [obj, key, impl] of pairs) {
    const prev = obj[key];
    obj[key] = impl;
    restores.push(() => { obj[key] = prev; });
  }
  return () => {
    for (let i = restores.length - 1; i >= 0; i--) restores[i]();
  };
}

describe('Kiosk Check-in / Check-out Parity Fixes', { concurrency: false }, () => {
  test('verifyPlate flags reallocation for PAID booking whose slot is physically occupied and nulls assignedSlot', async () => {
    const floorId = oid('507f1f77bcf86cd799439021');
    const bookingId = oid('507f1f77bcf86cd799439022');
    const now = Date.now();

    const bookingDoc = {
      _id: bookingId,
      licensePlate: '30A12345',
      status: 'PAID',
      parkingSlot: 'A-01',
      durationHours: 2,
      floorId: { _id: floorId, name: 'F1' },
      scheduledStart: new Date(now - 5 * 60 * 1000),
      scheduledEnd: new Date(now + 115 * 60 * 1000),
    };

    let bookingCallCount = 0;
    const restore = stubMany([
      [Session, 'findOne', (q) => {
        if (q?.licensePlate && q?.status === 'active') return queryable(null);
        if (q?.floorId && q?.parkingSlot === 'A-01' && q?.status === 'active') {
          return queryable({ _id: oid('507f1f77bcf86cd799439099') });
        }
        return queryable(null);
      }],
      [Vehicle, 'findOne', () => queryable(null)],
      [Booking, 'findOne', () => {
        bookingCallCount++;
        return queryable(bookingCallCount === 1 ? bookingDoc : null);
      }],
      [Slot, 'findOne', () => queryable(null)],
    ]);

    try {
      const req = { body: { licensePlate: '30A-123.45' } };
      const res = createRes();
      await sessionController.verifyPlate(req, res, (err) => { if (err) throw err; });

      assert.equal(res.state.statusCode, 200);
      assert.equal(res.state.body.data.hasPreBooking, true);
      assert.equal(res.state.body.data.requiresSlotReallocation, true);
      assert.equal(res.state.body.data.isBookingReallocation, true);
      assert.equal(res.state.body.data.originalSlot, 'A-01');
      assert.equal(res.state.body.data.assignedSlot, null);
    } finally {
      restore();
    }
  });

  test('verifyPlate enforces full check and never auto-assigns FastPass for quota-exhausted VIP', async () => {
    const floorId = oid('507f1f77bcf86cd799439031');
    const userId = oid('507f1f77bcf86cd799439032');
    const entitlementId = oid('507f1f77bcf86cd799439033');

    const restore = stubMany([
      [Session, 'findOne', (q) => {
        if (q?.floorId && q?.parkingSlot === 'V-01' && q?.status === 'active') {
          return queryable({ _id: oid('507f1f77bcf86cd799439098'), userId });
        }
        return queryable(null);
      }],
      [Session, 'find', () => queryable([
        { floorId, parkingSlot: 'V-01' },
        { floorId, parkingSlot: 'S-01' },
      ])],
      [Vehicle, 'findOne', () => queryable({ owner: userId, licensePlate: '30A99999', status: 'approved' })],
      [UserDetail, 'findOne', () => queryable({ userId, phone: '0901234567' })],
      [User, 'findById', () => queryable({ _id: userId, membership: { isVip: true, expireAt: new Date(Date.now() + 86400000) } })],
      [MembershipSlotEntitlement, 'find', () => queryable([{
        _id: entitlementId,
        floorId: { _id: floorId, name: 'F1' },
        slotCode: 'V-01',
        expireAt: new Date(Date.now() + 86400000),
      }])],
      [Booking, 'findOne', () => queryable(null)],
      [Booking, 'find', () => queryable([])],
      [Slot, 'findOne', () => queryable(null)],
      [Slot, 'find', () => queryable([])],
      [BookingHold, 'findOne', () => queryable(null)],
      [ParkingFloor, 'find', () => queryable([{
        _id: floorId,
        name: 'F1',
        layoutData: {
          elements: [
            { type: 'slot', name: 'V-01' },
            { type: 'slot', name: 'S-01' },
          ],
        },
      }])],
    ]);

    try {
      const req = { body: { licensePlate: '30A99999' } };
      const res = createRes();
      await sessionController.verifyPlate(req, res, (err) => { if (err) throw err; });

      assert.equal(res.state.statusCode, 200);
      assert.equal(res.state.body.data.quotaExhausted, true);
      assert.equal(res.state.body.data.isMonthly, false);
      assert.equal(res.state.body.data.assignedSlot, null);
      assert.equal(res.state.body.data.isFull, true);
    } finally {
      restore();
    }
  });

  test('kioskVerifyQr rejects already-active and >30m early Booking QRs with explicit error codes', async () => {
    const bookingActiveId = oid('507f1f77bcf86cd799439041');
    const bookingEarlyId = oid('507f1f77bcf86cd799439042');
    const qrActive = buildBookingQrPayload({ _id: bookingActiveId });
    const qrEarly = buildBookingQrPayload({ _id: bookingEarlyId });

    const restore = stubMany([
      [Booking, 'findById', (id) => {
        if (String(id) === String(bookingActiveId)) {
          return queryable({ _id: bookingActiveId, status: 'ACTIVE', licensePlate: '51A11111' });
        }
        return queryable({
          _id: bookingEarlyId,
          status: 'PAID',
          licensePlate: '51A22222',
          scheduledStart: new Date(Date.now() + 2 * 60 * 60 * 1000),
        });
      }],
    ]);

    try {
      const resActive = createRes();
      await sessionController.kioskVerifyQr({ body: { qrPayload: qrActive } }, resActive);
      assert.equal(resActive.state.statusCode, 409);
      assert.equal(resActive.state.body.code, 'BOOKING_ALREADY_ACTIVE');

      const resEarly = createRes();
      await sessionController.kioskVerifyQr({ body: { qrPayload: qrEarly } }, resEarly);
      assert.equal(resEarly.state.statusCode, 400);
      assert.equal(resEarly.state.body.code, 'BOOKING_TOO_EARLY');
    } finally {
      restore();
    }
  });

  test('kioskExitScan selects matching multi-car VIP session by detectedPlate and bills expired VIP from expireAt onward', async () => {
    const userId = oid('507f1f77bcf86cd799439051');
    const entitlementId = oid('507f1f77bcf86cd799439052');
    const now = Date.now();
    const checkInTime = new Date(now - 5 * 60 * 60 * 1000);
    const expireAt = new Date(now - 30 * 60 * 1000);

    const sessionCar1 = {
      _id: oid('507f1f77bcf86cd799439053'),
      userId,
      licensePlate: '51A11111',
      type: 'SUBSCRIPTION',
      entitlementId,
      checkInTime,
      parkingSlot: 'V-01',
      status: 'active',
      expectedDurationHours: 24,
    };
    const sessionCar2 = {
      _id: oid('507f1f77bcf86cd799439054'),
      userId,
      licensePlate: '51A22222',
      type: 'SUBSCRIPTION',
      entitlementId,
      checkInTime,
      parkingSlot: 'V-02',
      status: 'active',
      expectedDurationHours: 24,
    };

    const recordedStarts = [];
    const membershipQr = buildAccountMembershipQrPayload({ _id: userId, membership: { qrVersion: 1 } });

    const restore = stubMany([
      [Session, 'find', () => queryable([sessionCar1, sessionCar2])],
      [MembershipSlotEntitlement, 'exists', () => Promise.resolve(false)],
      [MembershipSlotEntitlement, 'findOne', () => queryable({ _id: entitlementId, expireAt })],
      [walletService, 'getOrCreateWallet', () => Promise.resolve({ balance: 0 })],
      [SlotAuditLog, 'find', () => queryable([])],
      [pricingEngine, 'calculatePrice', async (start, end) => {
        recordedStarts.push(new Date(start).getTime());
        const hrs = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 3600000));
        return { durationHours: hrs, finalTotal: hrs * 10000 };
      }],
    ]);

    try {
      const req = {
        body: {
          qrPayload: membershipQr,
          detectedPlate: '51A22222',
          exitImageBase64: 'data:image/jpeg;base64,ZmFrZQ==',
        },
      };
      const res = createRes();
      await sessionController.kioskExitScan(req, res, (err) => { if (err) throw err; });

      assert.equal(res.state.statusCode, 200);
      assert.equal(res.state.body.data.session.licensePlate, '51A22222');
      assert.equal(res.state.body.data.isSubscriptionExpired, true);
      assert.ok(res.state.body.data.subscriptionExpiredAt);
      assert.equal(res.state.body.data.amountToPay, 10000);
      assert.ok(recordedStarts.includes(expireAt.getTime()));
    } finally {
      restore();
    }
  });

  test('kioskCheckout with keepPaused=true keeps primary Slot status as booked instead of releasing to available', async () => {
    const floorId = oid('507f1f77bcf86cd799439061');
    const bookingId = oid('507f1f77bcf86cd799439062');
    const sessionId = oid('507f1f77bcf86cd799439063');
    const userId = oid('507f1f77bcf86cd799439064');

    const activeSession = {
      _id: sessionId,
      licensePlate: '30A88888',
      userId,
      bookingId,
      type: 'BOOKING',
      parkingSlot: 'B-02',
      floorId,
      checkInTime: new Date(Date.now() - 3600000),
      status: 'active',
      toObject() { return { ...this }; },
    };
    const activeBooking = {
      _id: bookingId,
      userId,
      licensePlate: '30A88888',
      status: 'ACTIVE',
      parkingSlot: 'B-02',
      floorId,
      scheduledStart: new Date(Date.now() - 3600000),
      scheduledEnd: new Date(Date.now() + 3600000 * 3),
    };
    let savedSlotStatus = null;
    const primarySlotDoc = {
      _id: oid('507f1f77bcf86cd799439065'),
      floorID: floorId,
      slotNumber: 'B-02',
      status: 'occupied',
      aiObservation: { occupied: true, sessionId, detectedPlate: '30A88888' },
      async save() {
        savedSlotStatus = this.status;
        return this;
      },
    };
    const fakeMongoSession = {
      startTransaction() { },
      async commitTransaction() { },
      async abortTransaction() { },
      endSession() { },
    };

    const restore = stubMany([
      [mongoose, 'startSession', async () => fakeMongoSession],
      [Session, 'findById', () => queryable(activeSession)],
      [Booking, 'findById', () => queryable(activeBooking)],
      [Booking, 'findOneAndUpdate', async () => ({ ...activeBooking, status: 'PAUSED' })],
      [Session, 'findOneAndUpdate', async () => ({ ...activeSession, status: 'completed' })],
      [bookingRefundService, 'quoteEarlyCheckout', async () => ({
        actualParkingCharge: 10000,
        extraAmount: 0,
        refundAmount: 0,
        pricingBreakdown: { durationHours: 1, finalTotal: 10000 },
      })],
      [pricingEngine, 'calculatePrice', async () => ({ durationHours: 1, finalTotal: 10000 })],
      [Slot, 'find', async () => [primarySlotDoc]],
      [SlotMaintenanceLog, 'find', () => queryable([])],
      [SlotAuditLog, 'updateMany', async () => ({ modifiedCount: 0 })],
      [SlotAuditLog, 'create', async () => ({})],
      [User, 'findById', () => queryable({ _id: userId, email: 'test@example.com' })],
    ]);

    try {
      const req = {
        app: { get: () => null },
        body: {
          sessionId: String(sessionId),
          paymentMethod: 'free',
          keepPaused: true,
          checkoutToken: buildCheckoutChallenge(activeSession),
        },
      };
      const res = createRes();
      await sessionController.kioskCheckout(req, res, (err) => { if (err) throw err; });

      assert.equal(res.state.statusCode, 200);
      assert.equal(res.state.body.success, true);
      assert.equal(savedSlotStatus, 'booked');
    } finally {
      restore();
    }
  });

  test('createBookingHold allows KIOSK_REALLOCATION to bypass self vehicleOverlap for PAID/PAUSED/EXPIRED booking', async () => {
    const floorId = oid('507f1f77bcf86cd799439071');
    const reallocateBookingId = oid('507f1f77bcf86cd799439072');
    let capturedOverlapQuery = null;

    const restore = stubMany([
      [ParkingFloor, 'findById', () => queryable({
        _id: floorId,
        status: 'published',
        layoutData: { elements: [{ type: 'slot', name: 'A-09' }] },
      })],
      [BookingHold, 'findOne', () => queryable(null)],
      [BookingHold, 'countDocuments', async () => 0],
      [BookingHold, 'create', async ([doc]) => [{ _id: oid('507f1f77bcf86cd799439073'), ...doc }]],
      [Session, 'findOne', () => queryable(null)],
      [Slot, 'findOne', () => queryable(null)],
      [Booking, 'findById', () => queryable({
        _id: reallocateBookingId,
        licensePlate: '30A12345',
        status: 'PAID',
      })],
      [Booking, 'findOne', (q) => {
        if (q?.licensePlate && q?._id) capturedOverlapQuery = q;
        return queryable(null);
      }],
      [mongoose.connection, 'transaction', async (fn) => fn({})],
    ]);

    try {
      const req = {
        app: { get: () => null },
        body: {
          floorId: String(floorId),
          slotCode: 'A-09',
          licensePlate: '30A12345',
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + 3600000).toISOString(),
          bookingSource: 'KIOSK_REALLOCATION',
          reallocateBookingId: String(reallocateBookingId),
        },
      };
      const res = createRes();
      await bookingController.createBookingHold(req, res, (err) => { if (err) throw err; });

      assert.equal(res.state.statusCode, 201);
      assert.equal(String(capturedOverlapQuery?._id?.$ne), String(reallocateBookingId));
    } finally {
      restore();
    }
  });

  test('kioskExitScan scopes SlotAuditLog violation lookup to current sessionId or createdAt >= checkInTime', async () => {
    const checkInTime = new Date(Date.now() - 30 * 60 * 1000);
    const activeSession = {
      _id: oid('507f1f77bcf86cd799439081'),
      licensePlate: '43B20408',
      type: 'WALK_IN',
      checkInTime,
      parkingSlot: 'A3',
      status: 'active',
      expectedDurationHours: 2,
    };
    let capturedAuditFilter = null;

    const restore = stubMany([
      [Session, 'findOne', () => queryable(activeSession)],
      [SlotAuditLog, 'find', (filter) => {
        capturedAuditFilter = filter;
        return queryable([]);
      }],
      [pricingEngine, 'calculatePrice', async () => ({ durationHours: 1, finalTotal: 10000 })],
    ]);

    try {
      const req = {
        body: {
          licensePlate: '43B20408',
          exitImageBase64: 'data:image/jpeg;base64,ZmFrZQ==',
        },
      };
      const res = createRes();
      await sessionController.kioskExitScan(req, res, (err) => { if (err) throw err; });

      assert.equal(res.state.statusCode, 200);
      assert.equal(res.state.body.data.violationDetails, null);
      assert.ok(Array.isArray(capturedAuditFilter?.$or));
      assert.equal(String(capturedAuditFilter.$or[0]?.sessionId), String(activeSession._id));
      assert.equal(
        new Date(capturedAuditFilter.$or[1]?.createdAt?.$gte).getTime(),
        checkInTime.getTime()
      );
    } finally {
      restore();
    }
  });

  test('kioskExitScan enables canAutoPay and walletBalance for WALK_IN session matching an approved registered Vehicle', async () => {
    const ownerId = oid('507f1f77bcf86cd799439091');
    const activeSession = {
      _id: oid('507f1f77bcf86cd799439092'),
      licensePlate: '43B20408',
      userId: ownerId,
      type: 'WALK_IN',
      checkInTime: new Date(Date.now() - 45 * 60 * 1000),
      parkingSlot: 'A3',
      status: 'active',
      expectedDurationHours: 2,
    };

    const restore = stubMany([
      [Session, 'findOne', () => queryable(activeSession)],
      [Vehicle, 'findOne', () => queryable({ owner: ownerId })],
      [walletService, 'getOrCreateWallet', async () => ({ userId: ownerId, balance: 120000 })],
      [SlotAuditLog, 'find', () => queryable([])],
      [pricingEngine, 'calculatePrice', async () => ({ durationHours: 1, finalTotal: 10000 })],
    ]);

    try {
      const req = {
        body: {
          licensePlate: '43B20408',
          exitImageBase64: 'data:image/jpeg;base64,ZmFrZQ==',
        },
      };
      const res = createRes();
      await sessionController.kioskExitScan(req, res, (err) => { if (err) throw err; });

      assert.equal(res.state.statusCode, 200);
      assert.equal(res.state.body.data.walletBalance, 120000);
      assert.equal(res.state.body.data.hasWallet, true);
      assert.equal(res.state.body.data.canAutoPay, true);
      assert.ok(res.state.body.data.checkoutToken);
    } finally {
      restore();
    }
  });

  test('kioskCheckout auto-debits owner wallet for approved registered WALK_IN vehicle with valid checkoutToken', async () => {
    const ownerId = oid('507f1f77bcf86cd799439093');
    const sessionId = oid('507f1f77bcf86cd799439094');
    const floorId = oid('507f1f77bcf86cd799439095');

    const activeSession = {
      _id: sessionId,
      licensePlate: '43B20408',
      userId: ownerId,
      type: 'WALK_IN',
      parkingSlot: 'A3',
      floorId,
      checkInTime: new Date(Date.now() - 3600000),
      status: 'active',
      toObject() { return { ...this }; },
    };
    const fakeMongoSession = {
      startTransaction() { },
      async withTransaction(fn) { return fn(); },
      async commitTransaction() { },
      async abortTransaction() { },
      endSession() { },
    };
    let debitedArgs = null;

    const restore = stubMany([
      [mongoose, 'startSession', async () => fakeMongoSession],
      [Session, 'findById', () => queryable(activeSession)],
      [Vehicle, 'findOne', () => queryable({ owner: ownerId })],
      [pricingEngine, 'calculatePrice', async () => ({ durationHours: 1, finalTotal: 10000 })],
      [walletService, 'getOrCreateWallet', async () => ({ userId: ownerId, balance: 50000 })],
      [walletService, 'debitWallet', async (...args) => {
        debitedArgs = args;
        return { balance: 40000 };
      }],
      [Session, 'findOneAndUpdate', async () => ({ ...activeSession, status: 'completed', totalPrice: 10000 })],
      [Revenue, 'findOneAndUpdate', async () => ({ _id: oid('507f1f77bcf86cd799439099') })],
      [Slot, 'find', async () => []],
      [SlotMaintenanceLog, 'find', () => queryable([])],
      [SlotAuditLog, 'updateMany', async () => ({ modifiedCount: 0 })],
      [User, 'findById', () => queryable({ _id: ownerId, email: 'owner@example.com' })],
    ]);

    try {
      const req = {
        app: { get: () => null },
        body: {
          sessionId: String(sessionId),
          paymentMethod: 'wallet',
          checkoutToken: buildCheckoutChallenge(activeSession),
        },
      };
      const res = createRes();
      await sessionController.kioskCheckout(req, res, (err) => { if (err) throw err; });

      assert.equal(res.state.statusCode, 200);
      assert.equal(res.state.body.success, true);
      assert.ok(debitedArgs);
      assert.equal(String(debitedArgs[0]), String(ownerId));
      assert.equal(debitedArgs[1], 10000);
    } finally {
      restore();
    }
  });

  test('kioskCheckout rejects wallet payment with 403 WALK_IN_WALLET_UNVERIFIED when WALK_IN vehicle is unregistered', async () => {
    const sessionId = oid('507f1f77bcf86cd799439096');
    const activeSession = {
      _id: sessionId,
      licensePlate: '99A99999',
      type: 'WALK_IN',
      parkingSlot: 'B1',
      checkInTime: new Date(Date.now() - 3600000),
      status: 'active',
    };

    const restore = stubMany([
      [Session, 'findById', () => queryable(activeSession)],
      [Vehicle, 'findOne', () => queryable(null)],
    ]);

    try {
      const req = {
        app: { get: () => null },
        body: {
          sessionId: String(sessionId),
          paymentMethod: 'wallet',
          checkoutToken: buildCheckoutChallenge(activeSession),
        },
      };
      const res = createRes();
      await sessionController.kioskCheckout(req, res, (err) => { if (err) throw err; });

      assert.equal(res.state.statusCode, 403);
      assert.equal(res.state.body.code, 'WALK_IN_WALLET_UNVERIFIED');
    } finally {
      restore();
    }
  });
});
