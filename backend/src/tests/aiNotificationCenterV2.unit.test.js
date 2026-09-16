const test = require('node:test');
const assert = require('node:assert/strict');
const AINotification = require('../models/AINotification');
const Session = require('../models/Session');
const AIMonitorLease = require('../models/AIMonitorLease');
const { notifyBookingPaid, notifyBookingCancelled, notifyBookingCancelledSafely, notifySubscriptionActivated, notifySubscriptionActivatedSafely } = require('../services/aiCopilot/notificationEvents');
const { runFloorMonitorNow } = require('../services/aiCopilot/floorFullMonitor');
const { runSessionOverdueMonitorNow } = require('../services/aiCopilot/sessionOverdueMonitor');

function fakeStore() {
  const rows = [];
  let nextId = 1;
  const original = AINotification.updateOne;
  const originalUpdateMany = AINotification.updateMany;
  const originalFind = AINotification.find;
  
  AINotification.updateOne = async (filter, update, options = {}) => {
    const current = rows.find((row) => row.deduplicationKey === filter.deduplicationKey && row.status === 'OPEN');
    if (update.$setOnInsert && options.upsert) {
      if (current) return { upsertedCount: 0 };
      const _id = `notice-${nextId++}`;
      rows.push({ _id, deduplicationKey: filter.deduplicationKey, status: 'OPEN', ...update.$setOnInsert });
      return { upsertedCount: 1, upsertedId: _id };
    }
    if (current && update.$set) {
      Object.assign(current, update.$set);
      return { modifiedCount: 1 };
    }
    return { modifiedCount: 0 };
  };

  AINotification.updateMany = async (filter, update) => {
    let modified = 0;
    if (filter._id && filter._id.$in) {
      rows.forEach(r => {
        if (filter._id.$in.includes(r._id)) {
          Object.assign(r, update.$set);
          modified++;
        }
      });
    }
    return { modifiedCount: modified };
  };

  AINotification.find = (filter) => {
    return {
      lean: async () => {
        return rows.filter(r => {
          if (filter.notificationType && r.notificationType !== filter.notificationType) return false;
          if (filter.status && r.status !== filter.status) return false;
          return true;
        });
      }
    };
  };

  return { 
    rows, 
    restore: () => { 
      AINotification.updateOne = original; 
      AINotification.updateMany = originalUpdateMany;
      AINotification.find = originalFind;
    } 
  };
}

test('BOOKING_CANCELLED notification triggers correctly on real cancellation', async () => {
  const store = fakeStore();
  const emitted = [];
  const app = { get: () => ({ to: (room) => ({ emit: (_, event) => { emitted.push(event); } }) }) };
  
  const booking = { _id: 'booking-c1', status: 'CANCELLED', licensePlate: '51A-12345', parkingSlot: 'A01' };
  
  try {
    assert.equal(await notifyBookingCancelled(booking, app), true);
    assert.equal(await notifyBookingCancelled(booking, app), false); // deduplicated
    
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].notificationType, 'BOOKING_CANCELLED');
    assert.equal(store.rows[0].deduplicationKey, 'booking-cancelled:booking-c1');
    assert.equal(store.rows[0].targetRoute, '/admin/parking-lots?bookingId=booking-c1');
    assert.equal(store.rows[0].entityId, 'booking-c1');
    assert.equal(emitted.length, 2); // To both admin and staff
    
    // Safety check
    const originalUpdateOne = AINotification.updateOne;
    AINotification.updateOne = async () => { throw new Error('DB Error'); };
    assert.equal(await notifyBookingCancelledSafely(booking, app), false);
    AINotification.updateOne = originalUpdateOne;
  } finally { store.restore(); }
});

test('NEW_BOOKING notification targets Parking Lots and preserves bookingId', async () => {
  const store = fakeStore();
  const app = { get: () => ({ to: () => ({ emit: () => {} }) }) };
  const booking = { _id: 'booking-n1', status: 'PAID', licensePlate: '99A-99999', parkingSlot: 'B02' };
  
  try {
    assert.equal(await notifyBookingPaid(booking, app), true);
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].notificationType, 'NEW_BOOKING');
    assert.equal(store.rows[0].targetRoute, '/admin/parking-lots?bookingId=booking-n1');
    assert.equal(store.rows[0].entityId, 'booking-n1');
  } finally { store.restore(); }
});

test('NEW_SUBSCRIPTION notification triggers on first activation', async () => {
  const store = fakeStore();
  const emitted = [];
  const app = { get: () => ({ to: (room) => ({ emit: (_, event) => { emitted.push(event); } }) }) };
  
  const sub = { _id: 'sub-1', status: 'active' };
  const tp = { type: 'monthly' };
  
  try {
    assert.equal(await notifySubscriptionActivated(sub, tp, app), true);
    assert.equal(await notifySubscriptionActivated(sub, tp, app), false); // deduplicated
    
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].notificationType, 'NEW_SUBSCRIPTION');
    assert.equal(store.rows[0].targetRoles.includes('staff'), false); // admin only
    
    // Ignore non-active
    sub.status = 'pending';
    assert.equal(await notifySubscriptionActivated(sub, tp, app), false);
    
    // Safety check
    const originalUpdateOne = AINotification.updateOne;
    AINotification.updateOne = async () => { throw new Error('DB Error'); };
    assert.equal(await notifySubscriptionActivatedSafely({_id: 's2', status: 'active'}, tp, app), false);
    AINotification.updateOne = originalUpdateOne;
  } finally { store.restore(); }
});

test('FLOOR state machine: available -> full -> available', async () => {
  const store = fakeStore();
  const app = { get: () => ({ to: () => ({ emit: () => {} }) }) };
  let capacity = 10;
  let available = 10;
  const snapshot = async () => [{ floorId: 'f1', name: 'F1', capacity, available }];
  
  try {
    // Available -> Available (nothing)
    await runFloorMonitorNow({ app, snapshot });
    assert.equal(store.rows.length, 0);
    
    // Available -> Full
    available = 0;
    await runFloorMonitorNow({ app, snapshot });
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].notificationType, 'FLOOR_FULL');
    
    // Full -> Full (nothing)
    await runFloorMonitorNow({ app, snapshot });
    assert.equal(store.rows.length, 1);
    
    // Full -> Available (clear FLOOR_FULL and emit FLOOR_AVAILABLE_AGAIN)
    available = 2;
    await runFloorMonitorNow({ app, snapshot });
    assert.equal(store.rows.length, 2);
    assert.equal(store.rows[0].status, 'CLEARED');
    assert.equal(store.rows[1].notificationType, 'FLOOR_AVAILABLE_AGAIN');
    assert.equal(store.rows[1].status, 'OPEN');
  } finally { store.restore(); }
});

test('OCCUPANCY state machine', async () => {
  const store = fakeStore();
  const app = { get: () => ({ to: () => ({ emit: () => {} }) }) };
  let capacity = 100;
  let available = 11; // 89%
  const snapshot = async () => [{ floorId: 'f1', name: 'F1', capacity, available }];
  
  try {
    // 89 -> 90 emits once
    available = 10;
    await runFloorMonitorNow({ app, snapshot });
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].notificationType, 'OCCUPANCY_HIGH');
    
    // 90 -> 95 no duplicate
    available = 5;
    await runFloorMonitorNow({ app, snapshot });
    assert.equal(store.rows.length, 1);
    
    // 95 -> 100 FLOOR_FULL emits, OCCUPANCY_HIGH stays open
    available = 0;
    await runFloorMonitorNow({ app, snapshot });
    assert.equal(store.rows.length, 2);
    const high = store.rows.find(r => r.notificationType === 'OCCUPANCY_HIGH');
    const full = store.rows.find(r => r.notificationType === 'FLOOR_FULL');
    assert.equal(high.status, 'OPEN');
    assert.equal(full.status, 'OPEN');
    
    // 100 -> 95 FLOOR_AVAILABLE_AGAIN emits, OCCUPANCY_HIGH stays open
    available = 5;
    await runFloorMonitorNow({ app, snapshot });
    assert.equal(store.rows.length, 3);
    assert.equal(full.status, 'CLEARED');
    assert.equal(high.status, 'OPEN');
    
    // <= 85 clears
    available = 16;
    await runFloorMonitorNow({ app, snapshot });
    assert.equal(high.status, 'CLEARED');
    
    // <= 85 -> >= 90 emits again
    available = 9;
    await runFloorMonitorNow({ app, snapshot });
    assert.equal(store.rows.length, 4); // a new OCCUPANCY_HIGH
    const newHigh = store.rows[3];
    assert.equal(newHigh.notificationType, 'OCCUPANCY_HIGH');
    assert.equal(newHigh.status, 'OPEN');
  } finally { store.restore(); }
});

test('SESSION_OVERDUE monitor', async () => {
  const store = fakeStore();
  const app = { get: () => ({ to: () => ({ emit: () => {} }) }) };
  const baseline = new Date('2026-09-01T00:00:00Z');
  const now = new Date('2026-09-02T12:00:00Z');
  
  // Mock Session.aggregate and Session.find
  const originalAggregate = Session.aggregate;
  const originalFind = Session.find;
  
  // Overdue session (checkIn = 09:00, expectedDuration = 2, expectedEnd = 11:00 < 12:00)
  const session1 = {
    _id: 's1',
    status: 'active',
    checkInTime: new Date('2026-09-02T09:00:00Z'),
    expectedDurationHours: 2,
    expectedEndTime: new Date('2026-09-02T11:00:00Z'),
    licensePlate: 'ABC'
  };
  
  Session.aggregate = async () => {
    return [session1]; // Return the overdue session
  };
  
  // Return s1 as active
  Session.find = () => {
    return {
      select: () => ({
        lean: async () => [{ _id: 's1' }]
      })
    };
  };

  try {
    const emittedCount = await runSessionOverdueMonitorNow({ app, now, baseline });
    assert.equal(emittedCount, 1);
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].notificationType, 'SESSION_OVERDUE');
    assert.equal(store.rows[0].status, 'OPEN');
    
    // Repeated run => deduplicated
    await runSessionOverdueMonitorNow({ app, now, baseline });
    assert.equal(store.rows.length, 1);
    
    // Now simulate checkout (session no longer active)
    Session.find = () => {
      return {
        select: () => ({
          lean: async () => [] // no active sessions
        })
      };
    };
    
    await runSessionOverdueMonitorNow({ app, now, baseline });
    assert.equal(store.rows[0].status, 'CLEARED');
  } finally { 
    store.restore(); 
    Session.aggregate = originalAggregate;
    Session.find = originalFind;
  }
});
