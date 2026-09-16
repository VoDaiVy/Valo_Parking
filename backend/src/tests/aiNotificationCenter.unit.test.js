const test = require('node:test');
const assert = require('node:assert/strict');
const AINotification = require('../models/AINotification');
const { notifyBookingPaid, notifyBookingPaidSafely } = require('../services/aiCopilot/notificationEvents');
const { runFloorMonitorNow } = require('../services/aiCopilot/floorFullMonitor');
const { processRefundTransaction } = require('../services/aiCopilot/refundCompletedMonitor');
const payosPath = require.resolve('../config/payos');
const originalPayosModule = require.cache[payosPath];
require.cache[payosPath] = { id: payosPath, filename: payosPath, loaded: true, exports: {} };
const bookingController = require('../controllers/bookingController');
if (originalPayosModule) require.cache[payosPath] = originalPayosModule;
else delete require.cache[payosPath];
const ParkingFloor = require('../models/ParkingFloor');
const Booking = require('../models/Booking');
const Session = require('../models/Session');
const Slot = require('../models/Slot');
const BookingHold = require('../models/BookingHold');
const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const Subscription = require('../models/Subscription');

function fakeStore() {
  const rows = [];
  let nextId = 1;
  const original = AINotification.updateOne;
  AINotification.updateOne = async (filter, update, options = {}) => {
    const current = rows.find((row) => row.deduplicationKey === filter.deduplicationKey && row.status === 'OPEN');
    if (update.$setOnInsert && options.upsert) {
      if (current) return { upsertedCount: 0 };
      const _id = `notice-${nextId++}`;
      rows.push({ _id, ...update.$setOnInsert });
      return { upsertedCount: 1, upsertedId: _id };
    }
    if (current && update.$set) Object.assign(current, update.$set);
    return { modifiedCount: current ? 1 : 0 };
  };
  return { rows, restore: () => { AINotification.updateOne = original; } };
}

test('floor full creates one open event per full period and rearms after recovery', async () => {
  const store = fakeStore();
  const emitted = [];
  const app = { get: () => ({ to: (room) => ({ emit: (_, event) => { if (room === 'valo-ai-admins') emitted.push(event); } }) }) };
  let available = 1;
  const snapshot = async () => [{ floorId: 'floor-1', name: 'Floor 1', capacity: 2, available }];
  try {
    await runFloorMonitorNow({ app, snapshot });
    assert.equal(store.rows.length, 0);
    available = 0;
    await runFloorMonitorNow({ app, snapshot });
    await runFloorMonitorNow({ app, snapshot });
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].title, 'Floor 1 đã đầy');
    assert.equal(store.rows[0].targetRoute, '/admin/parking-lots');
    assert.equal(emitted.length, 1);
    available = 1;
    await runFloorMonitorNow({ app, snapshot });
    assert.equal(store.rows[0].status, 'CLEARED');
    available = 0;
    await runFloorMonitorNow({ app, snapshot });
    assert.equal(store.rows.length, 2);
    assert.equal(emitted.length, 2);
    available = 0;
    await runFloorMonitorNow({ app, snapshot: async () => [{ floorId: 'empty', name: 'Empty', capacity: 0, available }] });
    assert.equal(store.rows.length, 2);
  } finally { store.restore(); }
});

test('paid booking notification is idempotent and pending booking is ignored', async () => {
  const store = fakeStore();
  const emitted = [];
  const app = { get: () => ({ to: (room) => ({ emit: (_, event) => { if (room === 'valo-ai-admins') emitted.push(event); } }) }) };
  const booking = { _id: 'booking-1', status: 'PENDING', licensePlate: '51A-12345', parkingSlot: 'A01' };
  try {
    assert.equal(await notifyBookingPaid(booking, app), false);
    assert.equal(store.rows.length, 0);
    booking.status = 'PAID';
    assert.equal(await notifyBookingPaid(booking, app), true);
    assert.equal(await notifyBookingPaid(booking, app), false);
    assert.equal(store.rows.length, 1);
    assert.equal(emitted.length, 1);
    assert.equal(store.rows[0].deduplicationKey, 'new-booking:booking-1');
    assert.equal(store.rows[0].targetRoute, '/admin/bookings');
  } finally { store.restore(); }
});

test('booking notification failure does not escape the safe side effect', async () => {
  const original = AINotification.updateOne;
  const originalError = console.error;
  AINotification.updateOne = async () => { throw new Error('notification DB unavailable'); };
  console.error = () => {};
  try {
    const booking = { _id: 'booking-2', status: 'PAID', licensePlate: '51A-12345', parkingSlot: 'A01' };
    assert.equal(await notifyBookingPaidSafely(booking), false);
    assert.equal(booking.status, 'PAID');
  } finally { AINotification.updateOne = original; console.error = originalError; }
});

test('completed, credited booking refund notifies once; other payout states do not', async () => {
  const store = fakeStore();
  const emitted = [];
  const app = { get: () => ({ to: (room) => ({ emit: (_, event) => { if (room === 'valo-ai-admins') emitted.push(event); } }) }) };
  const transaction = { _id: 'refund-1', type: 'REFUND', status: 'COMPLETED', refSource: 'booking', refSourceId: 'booking-1', amount: 25000, createdAt: new Date() };
  const booking = { refundSettlements: [{ payoutStatus: 'credited', walletTransactionId: 'refund-1' }] };
  try {
    assert.equal(await processRefundTransaction(transaction, booking, app), true);
    assert.equal(await processRefundTransaction(transaction, booking, app), false);
    assert.equal(store.rows.length, 1);
    assert.equal(emitted.length, 1);
    assert.equal(store.rows[0].targetRoute, '/admin/revenue');
    assert.equal(store.rows[0].entityId, 'refund-1');
    assert.equal(await processRefundTransaction({ ...transaction, _id: 'pending', status: 'PENDING' }, booking, app), false);
    assert.equal(await processRefundTransaction({ ...transaction, _id: 'suppressed' }, { refundSettlements: [{ payoutStatus: 'suppressed', walletTransactionId: 'suppressed' }] }, app), false);
    assert.equal(await processRefundTransaction({ ...transaction, _id: 'not-required' }, { refundSettlements: [{ payoutStatus: 'not_required', walletTransactionId: 'not-required' }] }, app), false);
    assert.equal(store.rows.length, 1);
  } finally { store.restore(); }
});

test('floor detector reuses booking availability for every real blocker and ignores ghost/fixed slots', async () => {
  const query = (rows) => ({ sort() { return this; }, select() { return this; }, lean() { return Promise.resolve(rows); } });
  const originals = [
    [ParkingFloor, ParkingFloor.find], [Booking, Booking.find], [Session, Session.find],
    [Slot, Slot.find], [BookingHold, BookingHold.find],
    [MembershipSlotEntitlement, MembershipSlotEntitlement.find], [Subscription, Subscription.find],
  ];
  const floor = { _id: 'floor-1', name: 'Floor 1', floorNumber: 1, layoutData: { elements: [
    ...['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07'].map((name) => ({ id: name, type: 'slot', name })),
    { id: 'ghost', type: 'slot', name: '' }, { id: 'moto', type: 'slot-moto', name: 'M01' },
    { id: 'fixed-zone', type: 'zone', name: 'yearly fixed' },
    { id: 'fixed', type: 'slot', name: 'F01', parentId: 'fixed-zone' },
  ] } };
  let maintenance = ['A03'];
  ParkingFloor.find = () => query([floor]);
  Booking.find = () => query([{ floorId: 'floor-1', parkingSlot: 'A01' }]);
  Session.find = () => query([{ floorId: 'floor-1', parkingSlot: 'A02' }]);
  Slot.find = (filter) => query(filter.status === 'maintenance'
    ? maintenance.map((slotNumber) => ({ floorID: 'floor-1', slotNumber }))
    : [{ floorID: 'floor-1', slotNumber: 'A05' }]);
  BookingHold.find = () => query([{ floorId: 'floor-1', slotCode: 'A04' }]);
  MembershipSlotEntitlement.find = () => query([{ floorId: 'floor-1', slotCode: 'A06', sourceSubscriptionId: 'subscription-1' }]);
  Subscription.find = () => query([]);
  try {
    const start = new Date();
    const end = new Date(start.getTime() + 60000);
    assert.equal((await bookingController.getAllBookableSlots()).length, 7);
    assert.deepEqual((await bookingController.getAvailableSlotsForRange(start, end)).map((slot) => slot.slotCode), ['A07']);
    maintenance = ['A03', 'A07'];
    assert.equal((await bookingController.getAvailableSlotsForRange(start, end)).length, 0);
  } finally { originals.forEach(([model, find]) => { model.find = find; }); }
});
