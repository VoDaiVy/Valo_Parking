const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GEMINI_API_KEY = '';
const { parseBasicVietnameseBooking } = require('../services/aiBookingInterpreter');
const { parseAssistantRequest, executeAssistantRequest } = require('../services/aiParkingAssistantService');
const Booking = require('../models/Booking');
const Vehicle = require('../models/Vehicle');
const UserVoucher = require('../models/UserVoucher');
const controller = require('../controllers/aiBookingController');

test('a lookup asks for one plate without dumping inventory and remembers what the plate is for', async (t) => {
  const vehicles = Array.from({ length: 25 }, (_, index) => ({ status: 'approved', licensePlate: `43A${String(10000 + index)}` }));
  t.mock.method(Vehicle, 'find', () => queryOf(vehicles));
  t.mock.method(Booking, 'find', () => queryOf([]));
  const request = parse('xe của tôi vào bãi lúc mấy giờ');
  const result = await executeAssistantRequest(request, 'unit-owner', now);
  assert.match(result.message, /nhập biển số/);
  assert.ok(!result.message.includes(vehicles[0].licensePlate));
  assert.equal(result.context.pendingLookupIntent, 'CHECK_VEHICLE_ENTRY_TIME');
  for (const intent of ['CHECK_VEHICLE_ENTRY_TIME', 'CHECK_VEHICLE_EXIT_TIME', 'CHECK_VEHICLE_LOCATION', 'CHECK_VEHICLE_DURATION', 'CHECK_PARKING_FEE']) {
    for (const prompt of ['43A10000', 'Biển số 43A10000.', 'License plate 43A10000']) {
      const next = parse(prompt, { assistantContext: { pendingLookupIntent: intent } });
      assert.equal(next?.intent, intent, `${intent}: ${prompt}`);
      assert.equal(next.entities.licensePlate, '43A10000');
    }
  }
});
const now = new Date('2026-11-11T00:00:00Z');
const queryOf = (value) => { const query = { sort: () => query, populate: () => query, lean: async () => value }; return query; };
const parse = (prompt, draft = {}) => parseAssistantRequest({ prompt, draft, today: '2026-11-11', currentTime: '07:00' });
const booking = { _id: '111111111111111111111111', userId: 'unit-owner', licensePlate: '43A11111', status: 'PAID', scheduledStart: '2099-11-11T00:00:00Z', scheduledEnd: '2099-11-12T01:00:00Z', floorId: { name: 'Floor 1' }, parkingSlot: 'A5' };

test('booking date question after an overlap uses the conflicted plate and reads live owned data', async (t) => {
  const queries = [];
  t.mock.method(Booking, 'findOne', (query) => { queries.push(query); return queryOf(booking); });
  const draft = { licensePlate: '43A11111', assistantContext: { lastBookingConflict: { code: 'VEHICLE_BOOKING_OVERLAP', licensePlate: '43A11111', conflictBooking: { bookingId: booking._id, scheduledStart: 'FAKE', parkingSlot: 'UNTRUSTED' } } } };
  const result = await executeAssistantRequest(parse('đặt ngày nào vậy', draft), 'unit-owner', now);
  assert.ok(result.message.includes('11/11/2099') && result.message.includes('12/11/2099'));
  assert.ok(result.message.includes('A5')); assert.ok(!result.message.includes('UNTRUSTED'));
  assert.equal(queries[0].userId, 'unit-owner'); assert.equal(queries[0].licensePlate, '43A11111');
});
test('asking without a known plate saves the lookup, and a plate-only reply resumes it', async (t) => {
  t.mock.method(Booking, 'findOne', () => queryOf(booking));
  const first = await executeAssistantRequest(parse('đặt ngày nào vậy'), 'unit-owner', now);
  assert.equal(first.context.pendingLookupIntent, 'CHECK_BOOKING_STATUS');
  const next = parse('43A11111', { assistantContext: first.context });
  assert.equal(next.intent, 'CHECK_BOOKING_STATUS'); assert.equal(next.entities.licensePlate, '43A11111');
  const result = await executeAssistantRequest(next, 'unit-owner', now);
  assert.ok(result.message.includes('11/11/2099')); assert.equal(result.context.pendingLookupIntent, null);
});
test('an explicit new plate overrides the old lookup plate and booking id', () => {
  const result = parse('xem booking xe 22F3333', { assistantContext: { licensePlate: '43A11111', bookingId: booking._id }, licensePlate: '43A11111' });
  assert.equal(result.entities.licensePlate, '22F3333'); assert.equal(result.entities.bookingId, '');
});
test('another account conflict never exposes details submitted in draft metadata', async (t) => {
  const queries = []; t.mock.method(Booking, 'findOne', (query) => { queries.push(query); return queryOf(null); });
  const result = await executeAssistantRequest(parse('đặt ngày nào vậy', { assistantContext: { lastBookingConflict: { code: 'LICENSE_PLATE_BOOKING_CONFLICT', licensePlate: '43A11111', conflictBooking: { bookingId: booking._id, parkingSlot: 'PRIVATE_SLOT' } } } }), 'unit-owner', now);
  assert.ok(!result.message.includes('PRIVATE_SLOT')); assert.ok(queries.every((query) => query.userId === 'unit-owner'));
});
test('controller preserves the pending lookup across the real request/response contract', async (t) => {
  t.mock.method(Booking, 'findOne', () => queryOf(booking));
  const send = async (prompt, draft) => {
    let body; const res = { json(value) { body = value; return this; }, status() { return this; } };
    await controller.interpret({ body: { prompt, draft }, user: { _id: 'unit-owner' } }, res);
    assert.equal(body.success, true); return body.data;
  };
  const first = await send('đặt ngày nào vậy', {});
  assert.equal(first.draft.assistantContext.pendingLookupIntent, 'CHECK_BOOKING_STATUS');
  const next = await send('43A11111', first.draft);
  assert.equal(next.canonicalIntent, 'CHECK_BOOKING_STATUS'); assert.ok(next.assistantResult.message.includes('43A11111'));
});
test('voucher questions recognize colloquial Vietnamese and English without selecting a code', () => {
  for (const text of ['tôi còn thẻ giảm giá nào không', 'tôi có mã giảm giá không', 'có phiếu giảm giá không', 'Do I have any vouchers?', 'Do I have a discount code?', 'Can I use my voucher?']) {
    const result = parse(text); assert.ok(result, text); assert.ok(result.intents.includes('CHECK_VOUCHERS'), text); assert.ok(!result.intents.includes('USE_VOUCHER'), text);
  }
});
const voucher = { _id: '222222222222222222222222', status: 'available', expiresAt: new Date('2099-12-01'), benefitSnapshot: { name: 'Unit discount', type: 'FIXED_DISCOUNT', discountAmount: 5000, minimumAmount: 10000 } };

test('voucher listing states the minimum and contextual use replies select without creating a booking', async (t) => {
  t.mock.method(UserVoucher, 'find', () => queryOf([voucher]));
  const first = await executeAssistantRequest(parse('tôi có mã giảm giá nào không'), 'unit-owner', now);
  assert.match(first.message, /booking tối thiểu 10\.000/);
  assert.equal(first.context.pendingVoucherSelection, true);
  for (const reply of ['sử dụng', 'sửa dụng', 'use it', 'sử dụng mã giảm giá']) {
    const current = { __intent: 'CREATE_BOOKING', startDate: '2099-11-12', startTime: '08:00', endTime: '09:00', assistantContext: first.context };
    const request = parse(reply, current);
    assert.equal(request?.intent, 'USE_VOUCHER', reply);
    const result = await executeAssistantRequest(request, 'unit-owner', now);
    assert.equal(result.transition?.draftPatch.voucherId, voucher._id, reply);
    assert.equal(result.context.pendingVoucherSelection, false);
    assert.equal(result.pendingAction, null);
  }
  assert.equal(parse('sửa dụng'), null);
});
test('voucher inventory is owner scoped, excludes reserved/expired codes and does not apply them', async (t) => {
  let filter; t.mock.method(UserVoucher, 'find', (query) => { filter = query; return queryOf([voucher]); });
  const result = await executeAssistantRequest(parse('tôi còn thẻ giảm giá nào không'), 'unit-owner', now);
  assert.equal(filter.userId, 'unit-owner'); assert.equal(filter.bookingId, null); assert.equal(filter.status, 'available'); assert.deepEqual(filter.expiresAt, { $gt: now });
  assert.ok(result.message.includes('Unit discount')); assert.equal(result.transition, null); assert.equal(result.voucherOptions.length, 1);
});
test('no voucher produces no apply question or draft change', async (t) => {
  t.mock.method(UserVoucher, 'find', () => queryOf([]));
  const result = await executeAssistantRequest(parse('tôi có mã giảm giá không'), 'unit-owner', now);
  assert.ok(result.message.includes('không có mã')); assert.deepEqual(result.voucherOptions, []); assert.equal(result.transition, null);
});
test('unknown explicit voucher names are not silently replaced by the only available code', async (t) => {
  t.mock.method(UserVoucher, 'find', () => queryOf([voucher]));
  const result = await executeAssistantRequest(parse('dùng voucher KHONGTONTAI'), 'unit-owner', now);
  assert.equal(result.transition, null);
});
test('removing an expired voucher works without loading inventory, including per-vehicle voucher fields', async (t) => {
  t.mock.method(UserVoucher, 'find', () => assert.fail('removal must not require an available voucher'));
  const draft = { voucherId: voucher._id, reservationItems: [{ licensePlate: '33C3333', voucherId: voucher._id }] };
  const result = await executeAssistantRequest(parse('bỏ mã giảm giá', draft), 'unit-owner', now);
  assert.equal(result.transition.draftPatch.voucherId, ''); assert.equal(result.transition.draftPatch.reservationItems[0].voucherId, '');
});
test('a voucher explicitly selected for car 2 never changes car 1 or its services', async (t) => {
  t.mock.method(UserVoucher, 'find', () => queryOf([voucher]));
  const draft = { requestedVehicleCount: 2, licensePlates: ['33C3333', '44F4444'], reservationItems: [{ licensePlate: '33C3333', serviceIds: ['wash'], voucherId: 'first-code' }, { licensePlate: '44F4444', serviceIds: ['charge'] }] };
  const result = await executeAssistantRequest(parse('dùng voucher Unit discount cho xe 2', draft), 'unit-owner', now);
  assert.equal(result.transition.draftPatch.reservationItems[0].voucherId, 'first-code'); assert.equal(result.transition.draftPatch.reservationItems[1].voucherId, voucher._id);
  assert.deepEqual(result.transition.draftPatch.reservationItems[1].serviceIds, ['charge']); assert.ok(result.message.includes('xe 2'));
});
test('removing the second car voucher preserves the first car voucher', async () => {
  const draft = { requestedVehicleCount: 2, voucherId: 'first-code', reservationItems: [{ licensePlate: '33C3333', voucherId: 'first-code' }, { licensePlate: '44F4444', voucherId: 'second-code' }] };
  const result = await executeAssistantRequest(parse('bỏ mã giảm giá xe 2', draft), 'unit-owner', now);
  assert.equal(result.transition.draftPatch.voucherId, undefined); assert.equal(result.transition.draftPatch.reservationItems[0].voucherId, 'first-code'); assert.equal(result.transition.draftPatch.reservationItems[1].voucherId, '');
});
test('the same voucher cannot be assigned to two vehicles', async (t) => {
  t.mock.method(UserVoucher, 'find', () => queryOf([voucher]));
  const result = await executeAssistantRequest(parse('dùng voucher Unit discount cho xe 2', { requestedVehicleCount: 2, licensePlates: ['33C3333', '44F4444'], voucherId: voucher._id }), 'unit-owner', now);
  assert.equal(result.transition, null); assert.ok(result.message.includes('một lượt đặt xe'));
});
const basic = (text, draft = {}) => parseBasicVietnameseBooking(text, '2026-11-11', { ...draft, __intent: 'CREATE_BOOKING' }, '07:00', 'vi');
test('the three multi-car inputs from the screenshot are accepted locally', () => {
  const first = basic('xe 1: 33c3333', { requestedVehicleCount: 2 });
  assert.equal(first.draft.reservationItems[0].licensePlate, '33C3333');
  const second = basic('xe thứ nhất biển số 11d2222 . biển thứ hai 22f3333', { requestedVehicleCount: 2 });
  assert.deepEqual(second.draft.reservationItems.map((item) => item.licensePlate), ['11D2222', '22F3333']);
  const third = basic('đặt hai xe 33d3333 và 44f4444 vào ngày mai');
  assert.deepEqual(third.draft.licensePlates, ['33D3333', '44F4444']); assert.equal(third.draft.startDate, '2026-11-12');
});
test('successive numbered plate replies retain the other vehicle and its selected services', () => {
  const first = basic('xe 1: 33C3333', { requestedVehicleCount: 2, reservationItems: [{ licensePlate: '', serviceIds: ['unit-service'] }, { licensePlate: '' }] });
  const next = basic('xe thứ hai: 44F4444', first.draft);
  assert.deepEqual(next.draft.reservationItems.map((item) => item.licensePlate), ['33C3333', '44F4444']); assert.deepEqual(next.draft.reservationItems[0].serviceIds, ['unit-service']);
});
test('shared schedule follows a multi-plate request without losing any plates', () => {
  const first = basic('đặt hai xe 33D3333 và 44F4444 vào ngày mai');
  const next = basic('7h đến 8h', first.draft);
  assert.deepEqual(next.draft.licensePlates, ['33D3333', '44F4444']); assert.equal(next.draft.startTime, '07:00'); assert.equal(next.draft.endTime, '08:00');
});
test('out-of-range vehicle index asks for correction instead of changing another vehicle', () => {
  const result = basic('xe 6: 33C3333', { requestedVehicleCount: 2, licensePlates: ['11D2222', '22F3333'] });
  assert.ok(result.clarification.includes('5')); assert.deepEqual(result.draft.licensePlates, ['11D2222', '22F3333']);
});
test('six distinct supplied plates are not silently truncated to five', () => {
  const result = basic('đặt xe 11D2222, 22F3333, 33C3333, 44F4444, 55A5555, 66B6666 vào ngày mai');
  assert.ok(result.clarification.includes('5')); assert.equal(result.draft.licensePlates, undefined);
});

test('the numbered two-plate screenshot keeps the previously supplied tomorrow schedule', () => {
  const previous = basic('Tôi muốn đặt 2 xe vào ngày mai lúc 8 giờ đến 9 giờ.').draft;
  for (const text of ['Xe thứ nhất 43A11213, xe thứ 2 43B11112.', 'xe thứ nhất: 43A-112.13; xe thứ hai: 43B-111.12.']) {
    const result = basic(text, previous);
    assert.ok(result); assert.equal(result.clarification, undefined);
    assert.deepEqual(result.draft.licensePlates, ['43A11213', '43B11112']);
    assert.ok(result.draft.reservationItems.every((row) => row.startDate === previous.startDate && row.startTime === '08:00' && row.endTime === '09:00'));
  }
});

test('one malformed plate is clarified specifically without discarding the other supplied car or the schedule', () => {
  const previous = { requestedVehicleCount: 2, startDate: '2099-11-12', endDate: '2099-11-12', startTime: '08:00', endTime: '09:00' };
  for (const value of ['43A111213', '43AII213', '43A11I13', '43A1111.11']) {
    const result = basic(`Xe thứ nhất ${value}, xe thứ 2 43B11112.`, previous);
    assert.ok(result, value); assert.match(result.clarification, /Biển số xe 1.*chưa hợp lệ/);
    assert.equal(result.draft.reservationItems[1].licensePlate, '43B11112');
    assert.equal(result.draft.reservationItems[0].licensePlate, '');
    assert.equal(result.draft.startDate, previous.startDate); assert.equal(result.draft.endTime, previous.endTime);
    assert.equal(result.draft.pendingReservationEditIndex, 0);
    const corrected = basic('43A11213', result.draft);
    assert.deepEqual(corrected.draft.reservationItems.map((row) => row.licensePlate), ['43A11213', '43B11112']);
    assert.equal(corrected.draft.pendingLicensePlate, undefined); assert.equal(corrected.draft.pendingReservationEditIndex, undefined);
  }
});

test('correcting only the second invalid plate preserves the first vehicle services and voucher', () => {
  const previous = { requestedVehicleCount: 2, startDate: '2099-11-12', endDate: '2099-11-12', startTime: '08:00', endTime: '09:00',
    reservationItems: [{ licensePlate: '', serviceIds: ['wash'], voucherId: 'kept-voucher' }, { licensePlate: '' }] };
  const result = basic('Xe thứ nhất 43A11213, xe thứ 2 43B11I12.', previous);
  assert.match(result.clarification, /Biển số xe 2/);
  const corrected = basic('43B11112', result.draft);
  assert.deepEqual(corrected.draft.licensePlates, ['43A11213', '43B11112']);
  assert.deepEqual(corrected.draft.reservationItems[0].serviceIds, ['wash']); assert.equal(corrected.draft.reservationItems[0].voucherId, 'kept-voucher');
});

test('the controller preserves valid rows and requests a targeted retry instead of returning unrecognized', async () => {
  const previous = { __intent: 'CREATE_BOOKING', __language: 'vi', requestedVehicleCount: 2, startDate: '2099-11-12', endDate: '2099-11-12', startTime: '08:00', endTime: '09:00' };
  let body;
  const res = { json(value) { body = value; return this; }, status() { return this; } };
  await controller.interpret({ body: { prompt: 'Xe thứ nhất 43AII213, xe thứ 2 43B11112.', draft: previous }, user: { _id: 'unit-owner' } }, res);
  assert.equal(body.success, true); assert.notEqual(body.data.unrecognized, true);
  assert.match(body.data.clarification, /Biển số xe 1/); assert.equal(body.data.draft.reservationItems[1].licensePlate, '43B11112');
});

test('updating the second row does not erase an outstanding invalid first plate', () => {
  const previous = { requestedVehicleCount: 2, startDate: '2099-11-12', endDate: '2099-11-12', startTime: '08:00', endTime: '09:00' };
  const first = basic('xe thứ nhất 43AII213, xe thứ 2 43B11112', previous);
  const next = basic('xe thứ hai 43B11112', first.draft);
  assert.equal(next.draft.pendingLicensePlate, '43AII213'); assert.equal(next.draft.pendingReservationEditIndex, 0);
  assert.match(next.clarification, /Biển số xe 1/); assert.equal(next.draft.reservationItems[1].licensePlate, '43B11112');
  const corrected = basic('Xe thứ nhất 43A11213, xe thứ hai 43C11111', next.draft);
  assert.deepEqual(corrected.draft.licensePlates, ['43A11213', '43C11111']);
  assert.equal(corrected.draft.pendingLicensePlate, undefined); assert.equal(corrected.draft.pendingReservationEditIndex, undefined);
});

test('malformed plate handling does not bypass unrelated-message protection for arbitrary text', async () => {
  const { interpretBookingMessage } = require('../services/aiBookingInterpreter');
  const previous = { __intent: 'CREATE_BOOKING', requestedVehicleCount: 2, startDate: '2099-11-12', startTime: '08:00', endTime: '09:00' };
  const result = await interpretBookingMessage({ prompt: 'xe thứ nhất 43AII213 qwerty abcxyz', draft: previous, today: '2099-11-11', generateText: () => assert.fail('unrelated input must not need a network call') });
  assert.equal(result.unrecognized, true); assert.deepEqual(result.draft, previous);
});
