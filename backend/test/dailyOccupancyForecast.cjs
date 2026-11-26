const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const service = require('../src/services/dailyOccupancyForecast');
const { targetDateTime } = require('../src/utils/pricingHorizon');
const HOUR = 3600000;
const start = targetDateTime('2026-11-24', 0);
const now = targetDateTime('2026-11-24', 9);
const at = hour => new Date(+start + hour * HOUR);
const capacitySlots = ['A', 'B', 'C'].map(slotCode => ({ floorId: 'f', slotCode }));
const session = (plate, from, to, extra = {}) => ({ licensePlate: plate, vehicleType: 'car', floorId: 'f',
  parkingSlot: 'A', checkInTime: at(from), checkOutTime: at(to), status: 'completed', type: 'WALK_IN', ...extra });
const booking = (plate, from, to, extra = {}) => ({ licensePlate: plate, vehicleType: 'car', floorId: 'f',
  parkingSlot: 'A', status: 'PAID', scheduledStart: at(from), scheduledEnd: at(to), ...extra });
const inputs = { start, now, selectedHour: 10, capacitySlots, maintenance: [], sessions: [], bookings: [], holds: [] };
const daily = (extra = {}) => service.buildDailyOccupancyForecast({ ...inputs, ...extra });
const history = (extra = {}) => [7, 14, 21].map(days => session('HISTORY', 10 - days * 24, 11 - days * 24, extra));

test('half-open intervals count concurrent vehicles, including different vehicles on one slot', () => {
  assert.equal(daily({ sessions: [session('A', 8, 8.5), session('B', 8.5, 9)] }).items[8].predictedVehicles, 1);
  const point = daily({ sessions: [session('A', 8, 9), session('B', 8.5, 9)] }).items[8];
  assert.equal(point.predictedVehicles, 2);
  assert.equal(point.busynessScore, 67);
});

test('canonical vehicleId/normalized plate mapping retains overlapping reference counts across reassignment', () => {
  const rows = [session('43A-123.45', 8, 9, { vehicleId: 'v1', parkingSlot: 'A' }),
    session('43a12345', 8.1, 8.2, { parkingSlot: 'B' }),
    session('', 8.5, 9, { vehicleId: 'v1', parkingSlot: null }), session('OTHER', 8.6, 9)];
  assert.equal(daily({ sessions: rows }).items[8].predictedVehicles, 2);
  assert.equal(daily({ sessions: rows.slice(0, 3) }).items[8].predictedVehicles, 1);
});

test('missing identity falls back to record id, never slot or a shared empty plate', () => {
  assert.equal(daily({ sessions: [session('', 8, 9, { _id: 's1' }),
    session('', 8, 9, { _id: 's1' }), session('', 8, 9, { _id: 's2' })] }).items[8].predictedVehicles, 2);
});

test('history ignores current inventory, reassignment and maintenance; capacity alone changes', () => {
  const sessions = history({ parkingSlot: null });
  const normal = daily({ sessions });
  const result = daily({ sessions, capacitySlots: [...capacitySlots, capacitySlots[0]],
    maintenance: [{ floorID: 'f', slotNumber: 'A' }, { floorID: 'f', slotNumber: 'A' }] });
  assert.equal(result.totalPhysicalCapacity, 3);
  assert.equal(result.totalCapacity, 2);
  assert.equal(result.items[10].predictedVehicles, normal.items[10].predictedVehicles);
  assert.equal(result.items[10].predictedVehicles, 1);
  assert.equal(result.dataQuality.historicalDayCount, 3);
});

test('history filters actual floor and actual vehicle type, never inferred slot type', () => {
  const sessions = [...history(), ...history({ licensePlate: 'EV', vehicleType: 'electric_car' }),
    ...history({ licensePlate: 'MOTO', vehicleType: 'motorcycle' }), ...history({ licensePlate: 'F2', floorId: 'g' })];
  assert.equal(daily({ sessions, floorId: 'f', vehicleType: 'car' }).items[10].predictedVehicles, 1);
  assert.equal(daily({ sessions, floorId: 'f', vehicleType: 'electric_car' }).items[10].predictedVehicles, 1);
  assert.equal(daily({ sessions, floorId: 'f', vehicleType: 'all' }).items[10].predictedVehicles, 3);
  assert.equal(daily({ sessions, floorId: 'g', vehicleType: 'motorcycle' }).items[10].dataKind, 'known_only');
});

test('subscription demand is historical unscheduled demand; booking history is not added again', () => {
  const sessions = [...history({ type: 'SUBSCRIPTION' }),
    ...history({ licensePlate: 'BOOKED', type: 'BOOKING', bookingId: 'old' })];
  const result = daily({ sessions, bookings: [booking('FUTURE', 10, 11)] });
  assert.equal(result.items[10].predictedVehicles, 2);
  sessions.push(session('CURRENT', 10, 11, { type: 'SUBSCRIPTION' }));
  assert.equal(daily({ sessions, bookings: [booking('FUTURE', 10, 11)] }).items[10].predictedVehicles, 2);
});

test('bookingId and vehicle aliases deduplicate booking/session overlap without slot coupling', () => {
  const result = daily({ now: at(10), sessions: [session('SESSION', 9, null,
    { status: 'active', bookingId: 'b1', type: 'BOOKING', parkingSlot: 'B' })],
    bookings: [booking('BOOKING', 9, 12, { _id: 'b1', vehicleId: 'v1' }),
      booking('SESSION', 10, 11, { _id: 'b2' })] });
  assert.equal(result.items[10].predictedVehicles, 1);
  assert.equal(result.items[10].activeBookings, 1);
  assert.equal(result.items[11].predictedVehicles, 1);
  assert.equal(result.items[12].predictedVehicles, 0);
});

test('confirmed statuses only; holds never become vehicle demand', () => {
  const result = daily({ bookings: [booking('PENDING', 10, 11, { status: 'PENDING' }),
    booking('CANCELLED', 10, 11, { status: 'CANCELLED' }), booking('PAID', 10, 11)],
    holds: [{ floorId: 'f', slotCode: 'B', startTime: at(10), endTime: at(11), expiresAt: at(12) }] });
  assert.equal(result.items[10].predictedVehicles, 1);
  assert.equal(result.dataQuality.holdsIncluded, false);
  assert.equal(daily({ bookings: [booking('PAST', 8, 9)] }).items[8].predictedVehicles, 0);
});

test('active sessions without evidence stop at observation, not fabricated expectedDurationHours', () => {
  const result = daily({ now: at(13.5), sessions: [session('ACTIVE', -24, null,
    { status: 'active', expectedDurationHours: 100 })] });
  assert.deepEqual(result.items.slice(0, 14).map(p => p.predictedVehicles), Array(14).fill(1));
  assert.equal(result.items[14].predictedVehicles, 0);
  assert.equal(result.items[14].dataKind, 'known_only');
  assert.equal(result.dataQuality.unsupportedActiveSessions, 1);
});

test('active departure uses supported conditional dwell samples and rejects duplicate/expired evidence', () => {
  const dwell = [1, 2, 3].map(day => session(`D${day}`, -day * 24, 4 - day * 24));
  const active = session('ACTIVE', 8, null, { status: 'active' });
  const result = daily({ sessions: [...dwell, active] });
  assert.equal(result.items[11].predictedVehicles, 1);
  assert.equal(result.items[12].predictedVehicles, 0);
  assert.equal(result.dataQuality.unsupportedActiveSessions, 0);
  assert.equal(daily({ sessions: [dwell[0], { ...dwell[0] }, { ...dwell[0] }, active] }).items[10].predictedVehicles, 0);
  assert.equal(daily({ sessions: [...dwell, session('LONG', 0, null, { status: 'active' })] }).items[10].predictedVehicles, 0);
  assert.equal(daily({ sessions: [...dwell.map(row => ({ ...row, floorId: 'g' })), active] }).items[10].predictedVehicles, 0);
  assert.equal(daily({ sessions: [active], bookings: [booking('ACTIVE', 7, 8)] }).items[10].predictedVehicles, 0);
});

test('insufficient history stays known_only and never fabricates zero-demand days', () => {
  const result = daily({ sessions: history().slice(0, 2), bookings: [booking('KNOWN', 10, 11)] });
  assert.equal(result.dataQuality.historicalDayCount, 2);
  assert.equal(result.items[10].dataKind, 'known_only');
  assert.equal(result.items[10].predictedVehicles, 1);
  assert.equal(result.items[10].estimatedAvailableSlots, null);
  assert.equal(daily({ sessions: history() }).dataQuality.historicalDayCount, 3);
});

test('raw demand survives overcapacity and zero capacity, availability is clamped', () => {
  const extra = { sessions: history(), bookings: ['A', 'B', 'C', 'D'].map(plate => booking(plate, 10, 11)) };
  const point = daily(extra).items[10];
  assert.equal(point.predictedVehicles, 5);
  assert.equal(point.estimatedOccupiedSlots, 5);
  assert.equal(point.estimatedAvailableSlots, 0);
  assert.equal(point.busynessScore, 100);
  const zero = daily({ ...extra, capacitySlots: [] }).items[10];
  assert.equal(zero.predictedVehicles, 5);
  assert.equal(zero.busynessScore, null);
  assert.equal(zero.estimatedAvailableSlots, 0);
  assert.equal(zero.isPeak, false);
});

test('invalid/cancelled sessions and future history are excluded', () => {
  assert.equal(daily({ sessions: [session('X', 8, 9, { status: 'cancelled' }), session('Y', 9, 8),
    session('Z', 8, null)] }).items[8].predictedVehicles, 0);
  assert.equal(daily({ start: targetDateTime('2026-11-03', 0), sessions: history() }).dataQuality.historicalDayCount, 0);
});

test('day/week/month use identical concurrent peaks, raw demand and availability', () => {
  const extra = { sessions: history(), bookings: ['A', 'B', 'C', 'D'].map(plate => booking(plate, 10, 11)) };
  for (const timeframe of ['week', 'month']) {
    const period = service.buildPeriodOccupancyForecast({ ...inputs, ...extra, date: '2026-11-24', timeframe, selectedIndex: '2' });
    const day = period.items.find(item => item.date === '2026-11-24');
    assert.equal(day.predictedVehicles, Math.max(...daily(extra).items.map(item => item.predictedVehicles)));
    assert.equal(day.estimatedAvailableSlots, 0);
    assert.equal(period.selectedIndex, 2);
    assert.equal(period.dataQuality.countingUnit, 'vehicles');
  }
});

test('validation and database failures do not fabricate forecasts', async () => {
  await assert.rejects(service.getDailyOccupancyForecast({ date: '2026-02-30', now }), { statusCode: 400 });
  await assert.rejects(service.getDailyOccupancyForecast({ vehicleType: 'truck', now }), { statusCode: 400 });
  await assert.rejects(service.getDailyOccupancyForecast({ now }), { statusCode: 503 });
});

test('database inputs select identities, resolve booking type and preserve capacity eligibility', async () => {
  const controllerPath = require.resolve('../src/controllers/bookingController');
  const original = require.cache[controllerPath];
  const state = mongoose.connection.readyState;
  const names = ['Slot', 'Session', 'Booking', 'Vehicle'];
  const models = names.map(name => require(`../src/models/${name}`));
  const finds = models.map(model => model.find);
  const floorId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const seen = {};
  try {
    mongoose.connection.readyState = 1;
    require.cache[controllerPath] = { id: controllerPath, filename: controllerPath, loaded: true,
      exports: { getGeneralBookableSlots: async () => [
        { floorId, slotCode: 'A', slotType: 'slot' }, { floorId, slotCode: 'B', slotType: 'slot-ev' },
        { floorId: 'bbbbbbbbbbbbbbbbbbbbbbbb', slotCode: 'C', slotType: 'slot' },
        { floorId, slotCode: 'D', slotType: 'slot-vip' },
      ] } };
    models.forEach((model, i) => { model.find = query => ({ select: projection => ({ lean: async () => {
      seen[names[i]] = { query, projection };
      if (names[i] === 'Session') return [session('CAR', 8, null, { _id: 's', floorId, status: 'active', bookingId: null })];
      if (names[i] === 'Booking') return [booking('c-a-r', 8, 12, { _id: 'b', floorId }),
        booking('EV', 10, 11, { _id: 'ev', floorId, vehicleId: 'cccccccccccccccccccccccc' })];
      if (names[i] === 'Vehicle') return [{ _id: 'cccccccccccccccccccccccc', licensePlate: 'EV', vehicleType: 'electric_car' }];
      return [];
    } }) }); });
    for (const [vehicleType, capacity, demand] of [['car', 1, 1], ['electric_car', 2, 1], ['all', 2, 2], ['motorcycle', 0, 0]]) {
      const result = await service.getDailyOccupancyForecast({ now, vehicleType, floorId });
      assert.equal(result.totalCapacity, capacity);
      assert.equal(result.items[10].predictedVehicles, demand);
    }
    assert.match(seen.Session.projection, /vehicleId/);
    assert.match(seen.Session.projection, /licensePlate/);
    assert.match(seen.Session.projection, /vehicleType/);
    assert.equal(seen.Session.query.floorId, floorId);
    assert.deepEqual(seen.Booking.query.$or[1]._id.$in, []);
    models[1].find = () => { throw new Error('DB failed'); };
    await assert.rejects(service.getDailyOccupancyForecast({ now }), /DB failed/);
  } finally {
    models.forEach((model, i) => { model.find = finds[i]; });
    mongoose.connection.readyState = state;
    if (original) require.cache[controllerPath] = original;
    else delete require.cache[controllerPath];
  }
});


test('explicitly linked early arrivals use valid booking end before scheduled start', () => {
  const result = daily({ now: at(8), sessions: [session('EARLY', 7, null,
    { status: 'active', bookingId: 'early', type: 'BOOKING' })],
    bookings: [booking('EARLY', 10, 12, { _id: 'early' })] });
  assert.equal(result.items[9].predictedVehicles, 1);
  assert.equal(result.items[11].predictedVehicles, 1);
  assert.equal(result.items[12].predictedVehicles, 0);
  const unrelated = daily({ now: at(8), sessions: [session('EARLY', 7, null, { status: 'active' })],
    bookings: [booking('EARLY', 10, 12)] });
  assert.equal(unrelated.items[9].predictedVehicles, 0);
});

test('dwell evidence window is fixed across daily/week/month query coverage', () => {
  const recent = [1, 2, 3].map(day => session(`D${day}`, -day * 24, 4 - day * 24));
  const old = [60, 61, 62].map(day => session(`OLD${day}`, -day * 24, 20 - day * 24));
  const active = session('ACTIVE', 8, null, { status: 'active' });
  const expected = daily({ sessions: [...recent, active] }).items[12].predictedVehicles;
  for (const timeframe of ['week', 'month']) {
    const period = service.buildPeriodOccupancyForecast({ ...inputs, sessions: [...old, ...recent, active],
      date: '2026-11-24', timeframe });
    const point = period.items.find(row => row.date === '2026-11-24');
    assert.equal(point.predictedVehicles, Math.max(...daily({ sessions: [...recent, active] }).items.map(row => row.predictedVehicles)));
  }
  assert.equal(expected, 0);
  assert.equal(daily({ sessions: [...old, ...recent, active] }).items[12].predictedVehicles, expected);
});

test('known booking replaces the same vehicles historical subscription demand only during overlap', () => {
  const sessions = history({ type: 'SUBSCRIPTION', licensePlate: '43A-123.45', vehicleId: 'v' });
  const point = daily({ sessions, bookings: [booking('43a12345', 10, 11)] }).items[10];
  assert.equal(point.predictedVehicles, 1);
  assert.equal(daily({ sessions, bookings: [booking('OTHER', 10, 11)] }).items[10].predictedVehicles, 2);
  assert.equal(daily({ sessions, bookings: [booking('43a12345', 11, 12)] }).items[10].predictedVehicles, 1);
});

test('unresolved departures expose deduplicated bucket scenarios and conservative availability', () => {
  const active = session('43A-123.45', -500, null, { status: 'active', type: 'BOOKING', vehicleId: 'v1' });
  const result = daily({ sessions: [...history(), active,
    { ...active, licensePlate: '43a12345', vehicleId: undefined, parkingSlot: 'B' }] });
  const point = result.items[10];
  assert.equal(point.predictedVehicles, 1);
  assert.equal(point.estimatedOccupiedSlots, 1);
  assert.equal(point.uncertainty.unresolvedActiveVehicles, 1);
  assert.equal(point.uncertainty.reason, 'unsupported_active_departure');
  assert.deepEqual(point.uncertainty.predictedVehiclesRange, { min: 1, max: 2 });
  assert.deepEqual(point.uncertainty.availableSpacesRange, { min: 1, max: 2 });
  assert.equal(point.estimatedAvailableSlots, 1);
  assert.equal(result.items[8].uncertainty.unresolvedActiveVehicles, 0);
  // Possibility remains explicit without assigning a checkout or changing the point forecast.
  const tomorrow = daily({ start: at(24), sessions: [active] }).items[10];
  assert.equal(tomorrow.predictedVehicles, 0);
  assert.deepEqual(tomorrow.uncertainty.predictedVehiclesRange, { min: 0, max: 1 });
  assert.equal(tomorrow.estimatedAvailableSlots, null);
});

test('uncertainty respects booking identity, actual scope and supported departures', () => {
  const stale = session('A', -500, null, { status: 'active', type: 'BOOKING', bookingId: 'old' });
  const result = daily({ sessions: [...history(), stale,
    session('EV', -500, null, { status: 'active', vehicleType: 'electric_car' }),
    session('OTHER_FLOOR', -500, null, { status: 'active', floorId: 'g' })],
    floorId: 'f', vehicleType: 'car', bookings: [booking('A', 10, 11, { _id: 'new' })] });
  assert.equal(result.items[10].uncertainty.unresolvedActiveVehicles, 1);
  assert.deepEqual(result.items[10].uncertainty.predictedVehiclesRange, { min: 2, max: 2 });
  const supported = daily({ sessions: [session('A', 8, null, { status: 'active', bookingId: 'b' })],
    bookings: [booking('A', 8, 12, { _id: 'b' })] });
  assert.equal(supported.items[13].uncertainty.unresolvedActiveVehicles, 0);
});

test('uncertain demand preserves known_only, zero capacity and overcapacity boundaries', () => {
  const sessions = [1, 2, 3, 4].map(id => session(`STALE${id}`, -500, null, { status: 'active', type: 'BOOKING' }));
  const unknown = daily({ sessions }).items[10];
  assert.equal(unknown.dataKind, 'known_only');
  assert.equal(unknown.estimatedAvailableSlots, null);
  assert.equal(unknown.uncertainty.availableSpacesRange, null);
  assert.deepEqual(unknown.uncertainty.predictedVehiclesRange, { min: 0, max: 4 });
  const point = daily({ sessions: [...history(), ...sessions] }).items[10];
  assert.deepEqual(point.uncertainty.predictedVehiclesRange, { min: 1, max: 5 });
  assert.deepEqual(point.uncertainty.availableSpacesRange, { min: 0, max: 2 });
  assert.equal(point.estimatedAvailableSlots, 0);
  const zero = daily({ capacitySlots: [], sessions: [...history(), ...sessions] }).items[10];
  assert.equal(zero.busynessScore, null);
  assert.deepEqual(zero.uncertainty.availableSpacesRange, { min: 0, max: 0 });
});

test('week/month aggregate uncertainty across all hours without changing the vehicle peak', () => {
  const extra = { sessions: [...history(), ...[1, 2, 3].map(id => session(`STALE${id}`, -500, null,
    { status: 'active', type: 'BOOKING' }))] };
  const hours = daily(extra).items;
  for (const timeframe of ['week', 'month']) {
    const period = service.buildPeriodOccupancyForecast({ ...inputs, ...extra, date: '2026-11-24', timeframe });
    const point = period.items.find(item => item.date === '2026-11-24');
    assert.equal(point.predictedVehicles, Math.max(...hours.map(hour => hour.predictedVehicles)));
    assert.equal(point.uncertainty.predictedVehiclesRange.max, Math.max(...hours.map(hour => hour.uncertainty.predictedVehiclesRange.max)));
    assert.equal(point.uncertainty.unresolvedActiveVehicles, 3);
    assert.equal(point.uncertainty.predictedVehiclesRange.max, 4);
  }
});

test('verified six-active pattern keeps a two-to-six vehicle scenario and 23-to-27 spaces', () => {
  const dwell = [1, 2, 3].map(day => session(`D${day}`, -day * 24, 4 - day * 24));
  const active = [1, 2].map(id => session(`WALK${id}`, 8, null, { status: 'active' }));
  const stale = [1, 2, 3, 4].map(id => session(`STALE${id}`, -200, null,
    { status: 'active', type: id === 4 ? 'SUBSCRIPTION' : 'BOOKING' }));
  const result = daily({ capacitySlots: Array.from({ length: 29 }, (_, id) => ({ floorId: 'f', slotCode: String(id) })),
    sessions: [...history(), ...dwell, ...active, ...stale] });
  const point = result.items[10];
  assert.equal(point.predictedVehicles, 2);
  assert.equal(point.uncertainty.unresolvedActiveVehicles, 4);
  assert.deepEqual(point.uncertainty.predictedVehiclesRange, { min: 2, max: 6 });
  assert.deepEqual(point.uncertainty.availableSpacesRange, { min: 23, max: 27 });
  assert.equal(point.estimatedAvailableSlots, 23);
  assert.equal(point.busynessScore, 7);
});
