const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const service = require('../src/services/dailyOccupancyForecast');
const { targetDateTime } = require('../src/utils/pricingHorizon');
const HOUR = 3600000;
const start = targetDateTime('2026-11-24', 0);
const now = targetDateTime('2026-11-24', 9);
const at = (hour) => new Date(+start + hour * HOUR);
const capacitySlots = ['A', 'B', 'C'].map(slotCode => ({ floorId: 'f', slotCode }));
const session = (slot, from, to, extra = {}) => ({ floorId: 'f', parkingSlot: slot,
  checkInTime: at(from), checkOutTime: at(to), status: 'completed', type: 'WALK_IN', ...extra });
const booking = (slot, from, to) => ({ floorId: 'f', parkingSlot: slot, scheduledStart: at(from), scheduledEnd: at(to) });
const hold = (slot, from, to, expiry) => ({ floorId: 'f', slotCode: slot,
  startTime: at(from), endTime: at(to), expiresAt: at(expiry) });
const inputs = { start, now, selectedHour: 10, capacitySlots, maintenance: [], sessions: [], bookings: [], holds: [] };
const daily = (extra = {}) => service.buildDailyOccupancyForecast({ ...inputs, ...extra });

test('sequential slots do not stack; concurrent slots do', () => {
  assert.equal(daily({ sessions: [session('A', 8, 8.5), session('B', 8.5, 9)] }).items[8].estimatedOccupiedSlots, 1);
  const point = daily({ sessions: [session('A', 8, 9), session('B', 8.5, 9)] }).items[8];
  assert.equal(point.estimatedOccupiedSlots, 2);
  assert.equal(point.busynessScore, 67);
});

test('overlapping records on the same slot retain reference counts', () => {
  const point = daily({ sessions: [session('A', 10, 11), session('A', 10.1, 10.2)],
    bookings: [booking('A', 10, 11), booking('B', 10.5, 11)], holds: [hold('A', 10, 11, 12)] }).items[10];
  assert.equal(point.estimatedOccupiedSlots, 2);
  assert.equal(point.activeBookings, 2);
});

test('expired holds, hour boundaries, and past reservations', () => {
  const result = daily({ holds: [hold('A', 10, 11, 9), hold('B', 10, 11, 10), hold('C', 11, 12, 13)],
    bookings: [booking('A', 8, 9)] });
  assert.equal(result.items[10].estimatedOccupiedSlots, 0);
  assert.equal(result.items[11].estimatedOccupiedSlots, 1);
  assert.equal(result.items[8].estimatedOccupiedSlots, 0);
  assert.equal(result.items[8].dataKind, 'known_only');
  assert.equal(daily({ holds: [hold('A', 10, 11, 10.5)],
    bookings: [booking('B', 10.5, 11)] }).items[10].estimatedOccupiedSlots, 1);
});

test('maintenance, unknown slots and duplicate inventory cannot inflate capacity', () => {
  const result = daily({ capacitySlots: [...capacitySlots, capacitySlots[0]],
    maintenance: [{ floorID: 'f', slotNumber: 'A' }, { floorID: 'f', slotNumber: 'A' }],
    bookings: [booking('A', 10, 11), booking('D', 10, 11), booking('B', 10, 11)] });
  assert.equal(result.totalPhysicalCapacity, 3);
  assert.equal(result.totalCapacity, 2);
  assert.equal(result.items[10].estimatedOccupiedSlots, 1);
  assert.equal(result.items[10].busynessScore, 50);
});

function history() {
  return [7, 14, 21].flatMap(days => [session('A', 10 - days * 24, 10.5 - days * 24),
    session('B', 10.5 - days * 24, 11 - days * 24)]);
}
test('historical baseline uses simultaneous walk-ins, excludes unknown empty days', () => {
  const result = daily({ sessions: history() });
  assert.equal(result.dataQuality.historicalDayCount, 3);
  assert.equal(result.items[10].estimatedOccupiedSlots, 1);
  assert.equal(result.items[10].estimatedAvailableSlots, 2);
  assert.equal(result.items[10].dataKind, 'estimated');
});

test('baseline does not double count observed walk-ins and overlaps reservations in time', () => {
  assert.equal(daily({ sessions: [...history(), session('A', 10, 11)],
    bookings: [booking('A', 10, 11)] }).items[10].estimatedOccupiedSlots, 1);
  assert.equal(daily({ sessions: [...history(), session('A', 10, 10.2)],
    bookings: [booking('B', 10.5, 11)] }).items[10].estimatedOccupiedSlots, 2);
});

test('missing history and zero capacity remain explicit', () => {
  assert.equal(daily().items[10].dataKind, 'known_only');
  assert.equal(daily().items[10].estimatedAvailableSlots, null);
  const point = daily({ capacitySlots: [], sessions: history() }).items[10];
  assert.equal(point.busynessScore, null);
  assert.equal(point.isPeak, false);
  assert.equal(point.estimatedOccupiedSlots, 0);
  const sparse = daily({ sessions: [session('A', 8, 9)] });
  assert.equal(sparse.items[7].dataKind, 'known_only');
  assert.equal(sparse.items[7].estimatedAvailableSlots, null);
  assert.equal(sparse.items[8].dataKind, 'recorded');
});

test('UTC+7 active sessions explain flat recorded hours and cutoff without inventing departures', () => {
  const result = daily({ now: at(13.5), sessions: [session('A', -24, 0, { status: 'active', checkOutTime: null })] });
  assert.equal(start.toISOString(), '2026-11-23T17:00:00.000Z');
  assert.deepEqual(result.items.slice(0, 14).map(p => p.estimatedOccupiedSlots), Array(14).fill(1));
  assert.equal(result.items[14].estimatedOccupiedSlots, 0);
  assert.equal(result.items[14].dataKind, 'known_only');
  assert.equal(result.items[14].estimatedAvailableSlots, null);
});

test('nine usable slots and six simultaneous known slots yield 67 percent and three estimated available', () => {
  const slots = Array.from({ length: 9 }, (_, id) => ({ floorId: 'f', slotCode: String(id) }));
  const extra = { capacitySlots: slots, sessions: [7, 14, 21].map(days => session('0', 10 - days * 24, 11 - days * 24)),
    bookings: slots.slice(0, 6).map(s => booking(s.slotCode, 10, 11)) };
  const result = daily(extra);
  assert.equal(result.totalCapacity, 9);
  // Walk-in baseline adds one demand slot to six reservations.
  assert.equal(result.items[10].estimatedOccupiedSlots, 7);
  extra.sessions.push(session('0', 10, 11));
  const point = daily(extra).items[10];
  assert.equal(point.estimatedOccupiedSlots, 6);
  assert.equal(point.busynessScore, 67);
  assert.equal(point.estimatedAvailableSlots, 3);
});

test('cancelled sessions are excluded and historical days never use subsequent history', () => {
  assert.equal(daily({ sessions: [session('A', 8, 9, { status: 'cancelled' })] }).items[8].estimatedOccupiedSlots, 0);
  const result = daily({ start: targetDateTime('2026-11-03', 0), sessions: history() });
  assert.equal(result.dataQuality.historicalDayCount, 0);
  assert.equal(result.items[10].dataKind, 'recorded');
  assert.equal(result.items[10].estimatedOccupiedSlots, 1);
});

test('week/month peaks match daily output and accept string selection', () => {
  for (const timeframe of ['week', 'month']) {
    const extra = { sessions: history(), bookings: [booking('A', 10, 11), booking('B', 10, 11), booking('C', 10, 11)] };
    const period = service.buildPeriodOccupancyForecast({ ...inputs, ...extra, date: '2026-11-24', timeframe, selectedIndex: '2' });
    const day = period.items.find(item => item.date === '2026-11-24');
    assert.equal(day.estimatedOccupiedSlots, Math.max(...daily(extra).items.map(item => item.estimatedOccupiedSlots)));
    assert.equal(day.busynessScore, 100);
    assert.equal(day.isPeak, true);
    assert.equal(period.selectedIndex, 2);
  }
});

test('input validation and database failures propagate without fabricated forecasts', async () => {
  await assert.rejects(service.getDailyOccupancyForecast({ date: '2026-02-30', now }), { statusCode: 400 });
  await assert.rejects(service.getDailyOccupancyForecast({ vehicleType: 'truck', now }), { statusCode: 400 });
  await assert.rejects(service.getDailyOccupancyForecast({ now }), { statusCode: 503 });
});

test('inventory filters preserve general slots, EV eligibility, floor and query failures', async () => {
  const controllerPath = require.resolve('../src/controllers/bookingController');
  const original = require.cache[controllerPath];
  const state = mongoose.connection.readyState;
  const models = ['Slot', 'Session', 'Booking', 'BookingHold'].map(name => require(`../src/models/${name}`));
  const finds = models.map(model => model.find);
  try {
    mongoose.connection.readyState = 1;
    require.cache[controllerPath] = { id: controllerPath, filename: controllerPath, loaded: true,
      exports: { getGeneralBookableSlots: async () => [
        { floorId: 'aaaaaaaaaaaaaaaaaaaaaaaa', slotCode: 'A', slotType: 'slot' },
        { floorId: 'aaaaaaaaaaaaaaaaaaaaaaaa', slotCode: 'B', slotType: 'slot-ev' },
        { floorId: 'bbbbbbbbbbbbbbbbbbbbbbbb', slotCode: 'C', slotType: 'slot' },
        { floorId: 'aaaaaaaaaaaaaaaaaaaaaaaa', slotCode: 'D', slotType: 'slot-vip' },
      ] } };
    models.forEach(model => { model.find = () => ({ select: () => ({ lean: async () => [] }) }); });
    for (const [vehicleType, capacity] of [['car', 1], ['electric_car', 2], ['all', 2], ['motorcycle', 0]]) {
      const result = await service.getDailyOccupancyForecast({ now, vehicleType, floorId: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
      assert.equal(result.totalCapacity, capacity);
    }
    models[1].find = () => { throw new Error('DB failed'); };
    await assert.rejects(service.getDailyOccupancyForecast({ now }), /DB failed/);
  } finally {
    models.forEach((model, i) => { model.find = finds[i]; });
    mongoose.connection.readyState = state;
    if (original) require.cache[controllerPath] = original;
    else delete require.cache[controllerPath];
  }
});

