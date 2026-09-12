import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAiAvailability, confirmAiBooking, confirmAiExistingAction, enumerateBookingDays, findAiActionBookings, prepareAiBooking, prepareAiExistingAction } from './aiBookingFlow.js';

const vehicle = { _id: 'vehicle-1', licensePlate: '43A12345', status: 'approved' };
const baseDraft = { startDate: '2099-01-15', endDate: '2099-01-15', startTime: '08:00', endTime: '10:00' };
const slot = (code = 'A-015') => ({ floorId: 'floor-2', floorName: 'Floor 2', floorNumber: 2, slotCode: code, slotType: 'slot' });
const ok = (data) => ({ ok: true, status: 200, data: { success: true, data } });

function gateway(overrides = {}) {
  const calls = { holds: [], releases: [], creates: [] };
  return {
    calls,
    getMyBookings: async () => ok([]),
    getAvailableBookingSlots: async () => ok({ slots: [slot(), slot('A-016')] }),
    quoteBulkBooking: async ({ items }) => ok({ grandTotal: items.length * 20000, items: items.map((item) => ({ clientItemId: item.clientItemId, totalAmount: 20000 })), itemErrors: [] }),
    getWalletInfo: async () => ok({ balance: 1000000 }),
    createBookingHold: async (item) => { calls.holds.push(item); return ok({ _id: `hold-${calls.holds.length}` }); },
    releaseBookingHold: async (id) => { calls.releases.push(id); return ok({}); },
    createBulkBooking: async (payload) => { calls.creates.push(payload); return ok({ bookings: payload.items }); },
    ...overrides,
  };
}

test('normal booking previews correct slot, duration and server price without creating a booking', async () => {
  const api = gateway();
  const preview = await prepareAiBooking(baseDraft, api, [vehicle]);
  assert.equal(preview.total, 20000);
  assert.equal(preview.durationMinutes, 120);
  assert.ok(['A-015', 'A-016'].includes(preview.items[0].slotCode));
  assert.equal(api.calls.holds.length, 0);
  assert.equal(api.calls.creates.length, 0);
});

test('missing time asks for it', async () => {
  const result = await prepareAiBooking({ startDate: '2099-01-15' }, gateway(), [vehicle]);
  assert.match(result.missing.join(' '), /mấy giờ/);
});

test('missing vehicle asks customer when several are registered', async () => {
  const result = await prepareAiBooking(baseDraft, gateway(), [vehicle, { ...vehicle, _id: 'vehicle-2', licensePlate: '43A99999' }]);
  assert.match(result.missing.join(' '), /xe nào/);
});

test('an electric-car request selects only an approved electric car', async () => {
  const electric = { _id: 'electric-1', licensePlate: '43E12345', status: 'approved', vehicleType: 'electric_car' };
  const ordinary = { ...vehicle, vehicleType: 'car' };
  const preview = await prepareAiBooking({ ...baseDraft, vehicleType: 'electric_car' }, gateway(), [ordinary, electric]);
  assert.equal(preview.items[0].vehicleId, 'electric-1');
  await assert.rejects(prepareAiBooking({ ...baseDraft, vehicleType: 'electric_car', licensePlate: '43A12345' }, gateway(), [ordinary, electric]), /xe điện đã được duyệt/);
  const missing = await prepareAiBooking({ ...baseDraft, vehicleType: 'electric_car' }, gateway(), [ordinary]);
  assert.match(missing.missing.join(' '), /chưa có xe điện đã duyệt/);
});

test('ordinary cars never receive electric, accessible or VIP slots', async () => {
  const options = [
    { ...slot('E1'), slotType: 'slot-ev' },
    { ...slot('E4'), slotType: 'slot-handicap' },
    { ...slot('E5'), slotType: 'slot-vip' },
    { ...slot('I6'), floorId: 'floor-3', floorName: 'Floor 3', floorNumber: 3 },
  ];
  const api = gateway({ getAvailableBookingSlots: async () => ok({ slots: options }) });
  const preview = await prepareAiBooking(baseDraft, api, [vehicle]);
  assert.equal(preview.items[0].floorName, 'Floor 3');
  assert.equal(preview.items[0].slotCode, 'I6');
  const wrongPreference = await prepareAiBooking({ ...baseDraft, slotCode: 'E1' }, api, [vehicle]);
  assert.match(wrongPreference.conflicts[0], /không phù hợp với loại xe/);
  assert.match(wrongPreference.conflicts[0], /I6/);
});

test('electric cars prefer an electric slot and skip accessible spaces', async () => {
  const electric = { _id: 'electric-1', licensePlate: '43E12345', status: 'approved', vehicleType: 'electric_car' };
  const api = gateway({ getAvailableBookingSlots: async () => ok({ slots: [
    { ...slot('E4'), slotType: 'slot-handicap' },
    { ...slot('E1'), slotType: 'slot-ev' },
    slot('E6'),
  ] }) });
  const preview = await prepareAiBooking(baseDraft, api, [electric]);
  assert.equal(preview.items[0].slotCode, 'E1');
});

test('automatic choice is stable across API order and spreads different requests', async () => {
  const options = ['A6', 'A7', 'E6', 'E7', 'I6', 'I7'].map((code, index) => ({
    floorId: `floor-${Math.floor(index / 2) + 1}`,
    floorName: `Floor ${Math.floor(index / 2) + 1}`,
    floorNumber: Math.floor(index / 2) + 1,
    slotCode: code,
    slotType: 'slot',
  }));
  const api = gateway({ getAvailableBookingSlots: async () => ok({ slots: options }) });
  const first = await prepareAiBooking(baseDraft, api, [vehicle]);
  api.getAvailableBookingSlots = async () => ok({ slots: [...options].reverse() });
  const repeated = await prepareAiBooking(baseDraft, api, [vehicle]);
  assert.equal(repeated.items[0].floorId, first.items[0].floorId);
  assert.equal(repeated.items[0].slotCode, first.items[0].slotCode);
  const confirmed = await confirmAiBooking(first, baseDraft, api, [vehicle], 'stable-choice');
  assert.ok(confirmed.success);
  const selections = new Set();
  for (let day = 15; day <= 25; day += 1) {
    const date = `2099-01-${day}`;
    const preview = await prepareAiBooking({ ...baseDraft, startDate: date, endDate: date }, api, [vehicle]);
    selections.add(`${preview.items[0].floorId}:${preview.items[0].slotCode}`);
  }
  assert.ok(selections.size > 1);
});

test('same vehicle is rejected for an overlapping booking, including an older booking without vehicleId', async () => {
  const api = gateway({ getMyBookings: async () => ok([{ status: 'PAID', licensePlate: '43A-123.45', scheduledStart: '2099-01-15T02:00:00Z', scheduledEnd: '2099-01-15T04:00:00Z' }]) });
  const result = await prepareAiBooking(baseDraft, api, [vehicle]);
  assert.match(result.conflicts[0], /trùng thời gian/);
  assert.match(result.conflicts[0], /43A12345/);
  assert.deepEqual(api.calls.holds, []);
});

test('same vehicleId is rejected even when an older booking has a different plate', async () => {
  const api = gateway({ getMyBookings: async () => ok([{ status: 'ACTIVE', vehicleId: 'vehicle-1', licensePlate: '43A99999', scheduledStart: '2099-01-15T02:00:00Z', scheduledEnd: '2099-01-15T04:00:00Z' }]) });
  const result = await prepareAiBooking(baseDraft, api, [vehicle]);
  assert.match(result.conflicts[0], /trùng thời gian/);
});

test('another registered or manual plate can book at the same time when another slot is available', async () => {
  const secondVehicle = { _id: 'vehicle-2', licensePlate: '43B54321', status: 'approved', vehicleType: 'car' };
  const prior = { status: 'PAID', vehicleId: 'vehicle-1', licensePlate: '43A12345', parkingSlot: 'A-017', scheduledStart: '2099-01-15T02:00:00Z', scheduledEnd: '2099-01-15T04:00:00Z' };
  const api = gateway({ getMyBookings: async () => ok([prior]) });
  for (const draft of [
    { ...baseDraft, licensePlate: secondVehicle.licensePlate },
    { ...baseDraft, licensePlate: '43C67890' },
  ]) {
    const preview = await prepareAiBooking(draft, api, [vehicle, secondVehicle]);
    assert.equal(preview.conflicts, undefined);
    assert.equal(preview.items[0].licensePlate, draft.licensePlate);
  }
});

test('a different vehicle cannot use the same occupied slot', async () => {
  const secondVehicle = { _id: 'vehicle-2', licensePlate: '43B54321', status: 'approved', vehicleType: 'car' };
  const api = gateway({
    getMyBookings: async () => ok([{ status: 'PAID', vehicleId: 'vehicle-1', licensePlate: '43A12345', parkingSlot: 'A-015', scheduledStart: '2099-01-15T02:00:00Z', scheduledEnd: '2099-01-15T04:00:00Z' }]),
    getAvailableBookingSlots: async () => ok({ slots: [slot('A-016')] }),
  });
  const result = await prepareAiBooking({ ...baseDraft, licensePlate: secondVehicle.licensePlate, slotCode: 'A-015' }, api, [vehicle, secondVehicle]);
  assert.match(result.conflicts[0], /ô A-015/);
  assert.doesNotMatch(result.conflicts[0], /booking trùng thời gian/);
});

test('cancelled bookings and adjacent time ranges do not block the same vehicle', async () => {
  const bookings = [
    { status: 'CANCELLED', licensePlate: vehicle.licensePlate, scheduledStart: '2099-01-15T02:00:00Z', scheduledEnd: '2099-01-15T04:00:00Z' },
    { status: 'COMPLETED', licensePlate: vehicle.licensePlate, scheduledStart: '2099-01-15T02:00:00Z', scheduledEnd: '2099-01-15T04:00:00Z' },
    { status: 'PAID', licensePlate: vehicle.licensePlate, scheduledStart: '2099-01-15T00:00:00Z', scheduledEnd: '2099-01-15T01:00:00Z' },
    { status: 'PAUSED', licensePlate: vehicle.licensePlate, scheduledStart: '2099-01-15T03:00:00Z', scheduledEnd: '2099-01-15T04:00:00Z' },
  ];
  const preview = await prepareAiBooking(baseDraft, gateway({ getMyBookings: async () => ok(bookings) }), [vehicle]);
  assert.equal(preview.conflicts, undefined);
  assert.equal(preview.items.length, 1);
});

test('multi-day booking reports only the day overlapping the selected vehicle', async () => {
  const bookings = [
    { status: 'PAID', licensePlate: '43B54321', scheduledStart: '2099-01-15T02:00:00Z', scheduledEnd: '2099-01-15T04:00:00Z' },
    { status: 'PAID', licensePlate: vehicle.licensePlate, scheduledStart: '2099-01-16T02:00:00Z', scheduledEnd: '2099-01-16T04:00:00Z' },
  ];
  const result = await prepareAiBooking({ ...baseDraft, endDate: '2099-01-16' }, gateway({ getMyBookings: async () => ok(bookings) }), [vehicle]);
  assert.equal(result.conflicts.length, 1);
  assert.match(result.conflicts[0], /16\/01\/2099/);
});

test('taken requested slot suggests another available slot', async () => {
  const result = await prepareAiBooking({ ...baseDraft, slotCode: 'A-015' }, gateway({ getAvailableBookingSlots: async () => ok({ slots: [slot('A-016')] }) }), [vehicle]);
  assert.match(result.conflicts[0], /A-016/);
});

test('Vietnamese floor preference maps to the existing floor number', async () => {
  const preview = await prepareAiBooking({ ...baseDraft, floorName: 'tầng 2' }, gateway(), [vehicle]);
  assert.equal(preview.items[0].floorId, 'floor-2');
});

test('basement floor code never silently selects a numbered above-ground floor', async () => {
  const result = await prepareAiBooking({ ...baseDraft, floorName: 'tầng B1' }, gateway(), [vehicle]);
  assert.match(result.conflicts[0], /không có ô phù hợp/);
});

test('full parking floor reports no suitable slot', async () => {
  const result = await prepareAiBooking(baseDraft, gateway({ getAvailableBookingSlots: async () => ok({ slots: [] }) }), [vehicle]);
  assert.match(result.conflicts[0], /không còn trống/);
});

test('multi-day booking checks every day and reports exact conflicting day', async () => {
  const api = gateway({ getAvailableBookingSlots: async ({ startTime }) => ok({ slots: startTime.startsWith('2099-01-16') ? [] : [slot()] }) });
  const result = await prepareAiBooking({ ...baseDraft, endDate: '2099-01-18' }, api, [vehicle]);
  assert.equal(result.days.length, 4);
  assert.match(result.conflicts[0], /16\/01\/2099/);
  assert.equal(api.calls.creates.length, 0);
});

test('multi-day preview contains every date and uses a common slot', async () => {
  const preview = await prepareAiBooking({ ...baseDraft, endDate: '2099-01-18' }, gateway(), [vehicle]);
  assert.equal(preview.items.length, 4);
  assert.equal(preview.total, 80000);
  assert.ok(preview.items.every((item) => item.slotCode === preview.items[0].slotCode));
});

test('more than five days is refused before creating holds', () => {
  assert.throws(() => enumerateBookingDays('2099-01-15', '2099-01-21'), /tối đa 5 ngày/);
});

test('closing or cancelling at preview leaves no hold and no booking', async () => {
  const api = gateway();
  await prepareAiBooking(baseDraft, api, [vehicle]);
  assert.deepEqual(api.calls.holds, []);
  assert.deepEqual(api.calls.creates, []);
});

test('confirmation holds slots then calls existing bulk create once', async () => {
  const api = gateway();
  const preview = await prepareAiBooking(baseDraft, api, [vehicle]);
  const result = await confirmAiBooking(preview, baseDraft, api, [vehicle], 'confirmation-1');
  assert.ok(result.success);
  assert.equal(api.calls.holds.length, 1);
  assert.equal(api.calls.creates.length, 1);
  assert.equal(api.calls.creates[0].items[0].holdId, 'hold-1');
});

test('a failed later hold releases every earlier hold', async () => {
  const api = gateway();
  const preview = await prepareAiBooking({ ...baseDraft, endDate: '2099-01-16' }, api, [vehicle]);
  api.createBookingHold = async (item) => { api.calls.holds.push(item); return api.calls.holds.length === 2 ? { ok: false, data: { message: 'taken' } } : ok({ _id: 'hold-1' }); };
  await assert.rejects(confirmAiBooking(preview, { ...baseDraft, endDate: '2099-01-16' }, api, [vehicle], 'confirmation-2'), /taken/);
  assert.deepEqual(api.calls.releases, ['hold-1']);
  assert.equal(api.calls.creates.length, 0);
});

test('failed booking creation releases all holds', async () => {
  const api = gateway({ createBulkBooking: async () => ({ ok: false, status: 400, data: { message: 'conflict' } }) });
  const preview = await prepareAiBooking(baseDraft, api, [vehicle]);
  await assert.rejects(confirmAiBooking(preview, baseDraft, api, [vehicle], 'confirmation-3'), /conflict/);
  assert.deepEqual(api.calls.releases, ['hold-1']);
});

test('changed price requires a new confirmation without any hold', async () => {
  const api = gateway();
  const preview = await prepareAiBooking(baseDraft, api, [vehicle]);
  api.quoteBulkBooking = async ({ items }) => ok({ grandTotal: 30000, items: items.map((item) => ({ clientItemId: item.clientItemId, totalAmount: 30000 })), itemErrors: [] });
  const result = await confirmAiBooking(preview, baseDraft, api, [vehicle], 'confirmation-4');
  assert.equal(result.refreshed.total, 30000);
  assert.equal(api.calls.holds.length, 0);
});

test('quote item error blocks preview even if HTTP status is 200', async () => {
  const api = gateway({ quoteBulkBooking: async () => ok({ grandTotal: 0, items: [], itemErrors: [{ message: 'VIP restriction' }] }) });
  const result = await prepareAiBooking(baseDraft, api, [vehicle]);
  assert.match(result.conflicts[0], /VIP restriction/);
});

test('insufficient wallet blocks confirmation before any hold', async () => {
  const api = gateway({ getWalletInfo: async () => ok({ balance: 0 }) });
  const preview = await prepareAiBooking(baseDraft, api, [vehicle]);
  await assert.rejects(confirmAiBooking(preview, baseDraft, api, [vehicle], 'confirmation-5'), /Số dư ví/);
  assert.equal(api.calls.holds.length, 0);
});

test('network error during availability is surfaced', async () => {
  const api = gateway({ getAvailableBookingSlots: async () => ({ ok: false, status: 0, data: { message: 'Network error' } }) });
  await assert.rejects(prepareAiBooking(baseDraft, api, [vehicle]), /Network error/);
});

test('network response lost after successful create is reconciled from My Bookings', async () => {
  const api = gateway();
  const preview = await prepareAiBooking(baseDraft, api, [vehicle]);
  let created = false;
  api.createBulkBooking = async () => { created = true; return { ok: false, status: 0, data: { message: 'Network error' } }; };
  api.getMyBookings = async () => ok(created ? [{ status: 'PAID', licensePlate: '43A12345', floorId: preview.items[0].floorId, parkingSlot: preview.items[0].slotCode, scheduledStart: preview.items[0].startTime, scheduledEnd: preview.items[0].endTime }] : []);
  const result = await confirmAiBooking(preview, baseDraft, api, [vehicle], 'confirmation-6');
  assert.equal(result.success.reconciled, true);
  assert.deepEqual(api.calls.releases, []);
});

test('availability intent checks each requested date without needing a vehicle', async () => {
  const result = await checkAiAvailability({ ...baseDraft, endDate: '2099-01-16' }, gateway());
  assert.equal(result.availability.length, 2);
  assert.equal(result.availability[0].count, 2);
});

test('availability counts only slots compatible with the requested car type', async () => {
  const api = gateway({ getAvailableBookingSlots: async () => ok({ slots: [
    { ...slot('E1'), slotType: 'slot-ev' },
    { ...slot('E4'), slotType: 'slot-handicap' },
    slot('E6'),
  ] }) });
  const ordinary = await checkAiAvailability(baseDraft, api);
  assert.equal(ordinary.availability[0].count, 1);
  const electric = await checkAiAvailability({ ...baseDraft, vehicleType: 'electric_car' }, api);
  assert.equal(electric.availability[0].count, 2);
});

test('invalid and past time are rejected', async () => {
  await assert.rejects(prepareAiBooking({ ...baseDraft, endTime: '07:00' }, gateway(), [vehicle]), /sau giờ bắt đầu/);
  await assert.rejects(prepareAiBooking(baseDraft, gateway(), [vehicle], Date.UTC(2100, 0, 1)), /đã qua/);
});

test('cancel intent selects only paid bookings and does not cancel during lookup or quote', async () => {
  let cancelled = 0;
  const paid = { _id: 'booking-1', status: 'PAID', licensePlate: '43A12345', scheduledStart: '2099-01-15T01:00:00Z' };
  const api = gateway({
    getMyBookings: async () => ok([paid, { ...paid, _id: 'booking-2', status: 'ACTIVE' }]),
    getBookingCancellationQuote: async () => ok({ refundAmount: 15000 }),
    cancelBooking: async () => { cancelled += 1; return ok({ refundAmount: 15000 }); },
  });
  const found = await findAiActionBookings('CANCEL_BOOKING', { licensePlate: '43A12345' }, api);
  assert.deepEqual(found.map((item) => item._id), ['booking-1']);
  const quote = await prepareAiExistingAction('CANCEL_BOOKING', found[0], api);
  assert.equal(quote.refundAmount, 15000);
  assert.equal(cancelled, 0);
  await confirmAiExistingAction('CANCEL_BOOKING', found[0], null, api);
  assert.equal(cancelled, 1);
});

test('modify intent uses owned booking and sends validated new range only on confirm', async () => {
  let changed = null;
  const booking = { _id: 'booking-1', status: 'PAID', licensePlate: '43A12345', scheduledStart: '2099-01-15T01:00:00Z' };
  const api = gateway({
    getMyBookings: async () => ok([booking]),
    extendBooking: async (id, payload) => { changed = { id, payload }; return ok({}); },
  });
  const found = await findAiActionBookings('MODIFY_BOOKING', { licensePlate: '43A12345' }, api);
  assert.equal(found.length, 1);
  assert.equal(changed, null);
  await assert.rejects(confirmAiExistingAction('MODIFY_BOOKING', found[0], { startDate: '2099-01-15', startTime: '10:00', endDate: '2099-01-15', endTime: '09:00' }, api), /chưa hợp lệ/);
  assert.equal(changed, null);
  await confirmAiExistingAction('MODIFY_BOOKING', found[0], { startDate: '2099-01-15', startTime: '09:00', endDate: '2099-01-15', endTime: '11:00' }, api);
  assert.equal(changed.id, 'booking-1');
  assert.equal(changed.payload.newStart, '2099-01-15T02:00:00.000Z');
});

test('view intent reads owned bookings without side effects', async () => {
  const api = gateway({ getMyBookings: async () => ok([{ _id: 'booking-1', status: 'COMPLETED', scheduledStart: '2099-01-15T01:00:00Z' }]) });
  const found = await findAiActionBookings('VIEW_BOOKING', {}, api);
  assert.equal(found.length, 1);
  assert.deepEqual(api.calls.creates, []);
  assert.deepEqual(api.calls.holds, []);
});

test('cancellation and modification failures surface server business rules', async () => {
  const booking = { _id: 'booking-1' };
  const api = gateway({
    cancelBooking: async () => ({ ok: false, status: 400, data: { message: 'Too late to cancel' } }),
    extendBooking: async () => ({ ok: false, status: 400, data: { message: 'Slot already booked' } }),
  });
  await assert.rejects(confirmAiExistingAction('CANCEL_BOOKING', booking, null, api), /Too late to cancel/);
  await assert.rejects(confirmAiExistingAction('MODIFY_BOOKING', booking, { startDate: '2099-01-15', startTime: '09:00', endDate: '2099-01-15', endTime: '11:00' }, api), /Slot already booked/);
});
