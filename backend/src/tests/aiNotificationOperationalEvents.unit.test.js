const { describe, it, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const AINotification = require('../models/AINotification');
const User = require('../models/User');
const Session = require('../models/Session');
const Vehicle = require('../models/Vehicle');
const Booking = require('../models/Booking');
const Subscription = require('../models/Subscription');

const { 
  notifyUserRegisteredSafely, 
  notifySessionCreatedSafely, 
  notifyVehiclePendingSafely,
  notifyBookingPaidSafely,
  notifySubscriptionActivatedSafely
} = require('../services/aiCopilot/notificationEvents');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/valo_parking_test_ai_notif_op';

describe('AI Notification Operational Events', () => {
  let appMock;
  let emitCalls = [];

  beforeEach(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(MONGODB_URI);
    }
    await Promise.all([
      AINotification.deleteMany({}),
      User.deleteMany({}),
      Session.deleteMany({}),
      Vehicle.deleteMany({})
    ]);

    emitCalls = [];
    appMock = {
      get: (key) => {
        if (key === 'io') {
          return {
            to: (room) => ({
              emit: (event, payload) => emitCalls.push({ room, event, payload })
            })
          };
        }
        return null;
      }
    };
  });

  after(async () => {
    await mongoose.disconnect();
  });

  it('1. Customer registration mới -> đúng 1 NEW_USER_REGISTERED (và 11. targetRole, 12. Deep-link)', async () => {
    const user = await User.create({ username: 'newuser', email: 'n@v.c', password: 'password123' });
    const success = await notifyUserRegisteredSafely(user, appMock);
    assert.strictEqual(success, true);
    
    const notifs = await AINotification.find({ notificationType: 'NEW_USER_REGISTERED' });
    assert.strictEqual(notifs.length, 1);
    const n = notifs[0];
    
    assert.strictEqual(n.severity, 'NOTICE');
    assert.deepStrictEqual(n.targetRoles, ['admin', 'staff']);
    assert.strictEqual(n.targetRoute, `/admin/accounts?userId=${user._id}`);
    
    // 10. Không leak sensitive data
    assert.strictEqual(n.evidence.username, 'newuser');
    assert.strictEqual(n.evidence.password, undefined);
    assert.strictEqual(n.evidence.hash, undefined);
  });

  it('2. Duplicate notification call -> vẫn 1', async () => {
    const user = await User.create({ username: 'newuser2', email: 'n2@v.c', password: 'password123' });
    await notifyUserRegisteredSafely(user, appMock);
    const success2 = await notifyUserRegisteredSafely(user, appMock);
    assert.strictEqual(success2, false); // duplicate
    
    const count = await AINotification.countDocuments({ notificationType: 'NEW_USER_REGISTERED' });
    assert.strictEqual(count, 1);
  });

  it('3. Notification failure -> không throw error làm crash flow', async () => {
    const fakeUser = { _id: 'invalid-id' }; // Will cause mongoose cast error in entityId
    const success = await notifyUserRegisteredSafely(fakeUser, appMock);
    assert.strictEqual(success, false); // caught and false returned
  });

  it('4. Session được tạo -> NEW_SESSION, và 6. initial status khác nhau vẫn hoạt động', async () => {
    const session = await Session.create({
      licensePlate: '51F-123.45',
      userId: new mongoose.Types.ObjectId(),
      type: 'BOOKING',
      source: 'app_booking',
      parkingSlot: 'A1',
      floorId: new mongoose.Types.ObjectId(),
      expectedDurationHours: 2,
      checkInTime: new Date(),
      status: 'active', // can be any valid initial status
    });
    
    const success = await notifySessionCreatedSafely(session, appMock);
    assert.strictEqual(success, true);
    
    const n = await AINotification.findOne({ notificationType: 'NEW_SESSION' });
    assert.ok(n);
    assert.strictEqual(n.evidence.licensePlate, '51F12345');
    assert.strictEqual(n.evidence.slot, 'A1');
    assert.strictEqual(n.evidence.type, 'BOOKING');
    assert.strictEqual(n.evidence.source, 'app_booking');
    assert.strictEqual(n.evidence.status, 'active');
    assert.ok(n.evidence.checkInTime);
    assert.ok(n.evidence.floor !== undefined);
    assert.strictEqual(n.targetRoute, `/admin/sessions?sessionId=${session._id}`);
  });

  it('5. Same Session status update -> không tạo NEW_SESSION thứ hai', async () => {
    const session = await Session.create({
      licensePlate: '51F-123.45',
      userId: new mongoose.Types.ObjectId(),
      type: 'BOOKING',
      source: 'app_booking',
      checkInTime: new Date(),
      status: 'active',
    });
    
    await notifySessionCreatedSafely(session, appMock);
    
    // Simulate status update
    session.status = 'completed';
    await session.save();
    
    const success = await notifySessionCreatedSafely(session, appMock);
    assert.strictEqual(success, false);
    
    const count = await AINotification.countDocuments({ notificationType: 'NEW_SESSION' });
    assert.strictEqual(count, 1);
  });

  it('7. Vehicle pending mới -> đúng 1 urgent notification', async () => {
    const vehicle = await Vehicle.create({
      owner: new mongoose.Types.ObjectId(),
      licensePlate: '51A-999.99',
      brand: 'Toyota',
      vehicleType: 'car',
      status: 'pending'
    });
    
    const success = await notifyVehiclePendingSafely(vehicle, appMock);
    assert.strictEqual(success, true);
    
    const n = await AINotification.findOne({ notificationType: 'VEHICLE_PENDING_VERIFICATION' });
    assert.ok(n);
    assert.strictEqual(n.severity, 'CRITICAL');
    assert.strictEqual(n.targetRoute, `/admin/vehicle-models?vehicleId=${vehicle._id}`);
  });

  it('8. Vehicle không pending -> không emit', async () => {
    const vehicle = await Vehicle.create({
      owner: new mongoose.Types.ObjectId(),
      licensePlate: '51A-999.98',
      brand: 'Toyota',
      vehicleType: 'car',
      status: 'approved'
    });
    
    const success = await notifyVehiclePendingSafely(vehicle, appMock);
    assert.strictEqual(success, false);
    
    const count = await AINotification.countDocuments({ notificationType: 'VEHICLE_PENDING_VERIFICATION' });
    assert.strictEqual(count, 0);
  });

  it('9. Duplicate vehicle hook -> không duplicate', async () => {
    const vehicle = await Vehicle.create({
      owner: new mongoose.Types.ObjectId(),
      licensePlate: '51A-999.99',
      brand: 'Toyota',
      vehicleType: 'car',
      status: 'pending'
    });
    
    await notifyVehiclePendingSafely(vehicle, appMock);
    const success = await notifyVehiclePendingSafely(vehicle, appMock);
    assert.strictEqual(success, false);
    
    const count = await AINotification.countDocuments({ notificationType: 'VEHICLE_PENDING_VERIFICATION' });
    assert.strictEqual(count, 1);
  });

  it('13. Existing (NEW_BOOKING, NEW_SUBSCRIPTION) không regression', async () => {
    const booking = new Booking({ _id: new mongoose.Types.ObjectId(), status: 'PAID', licensePlate: '51F-111', parkingSlot: 'A1' });
    const successBooking = await notifyBookingPaidSafely(booking, appMock);
    assert.strictEqual(successBooking, true);
    
    const sub = new Subscription({ _id: new mongoose.Types.ObjectId(), status: 'active' });
    const successSub = await notifySubscriptionActivatedSafely(sub, null, appMock);
    assert.strictEqual(successSub, true);
  });
});
