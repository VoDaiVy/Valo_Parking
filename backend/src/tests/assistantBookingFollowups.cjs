const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GEMINI_API_KEY = '';
process.env.PAYOS_CLIENT_ID ||= 'test-payos-client-id';
process.env.PAYOS_API_KEY ||= 'test-payos-api-key';
process.env.PAYOS_CHECKSUM_KEY ||= 'test-payos-checksum-key';
const { parseBasicVietnameseBooking } = require('../services/aiBookingInterpreter');
const { parseAssistantRequest, executeAssistantRequest } = require('../services/aiParkingAssistantService');
const Booking = require('../models/Booking');
const BookingHold = require('../models/BookingHold');
const Session = require('../models/Session');
const Slot = require('../models/Slot');
const SlotMaintenanceLog = require('../models/SlotMaintenanceLog');
const { getLiveParkingMap } = require('../services/liveParkingMapService');
const Vehicle = require('../models/Vehicle');
const Service = require('../models/Service');
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

test('parking availability questions use the requested dates, times and space without inheriting a prior booking', async () => {
  const draft = {
    __intent: 'CREATE_BOOKING', slotCode: 'D4', floorName: 'Floor 2',
    startDate: '2099-11-12', startTime: '18:00', endTime: '19:00', licensePlate: '43A11111',
    assistantContext: { floorName: 'Floor 2', slotCode: 'D4', zoneName: 'A' },
  };
  for (const [prompt, slot] of [
    ['kiểm tra chỗ trống ngày mai từ 8h đến 9h', ''],
    ['ô B2 ngày mai 8h đến 9h còn trống không', 'B2'],
    ['is slot B2 available tomorrow from 8 am to 9 am', 'B2'],
  ]) {
    const request = parse(prompt, draft);
    assert.equal(request.scheduledAvailability, true, prompt);
    assert.equal(request.entities.startDate, '2026-11-12');
    assert.equal(request.entities.startTime, '08:00');
    assert.equal(request.entities.endTime, '09:00');
    assert.equal(request.entities.slotCode, slot);
    assert.equal(request.entities.floorName, '');
    assert.equal(request.entities.zoneName, '');
  }
  const live = parse('bãi đỗ full chưa', draft);
  assert.equal(live.intent, 'CHECK_PARKING_AVAILABILITY');
  assert.equal(live.scheduledAvailability, false);
  let data;
  await controller.interpret({ body: { prompt: 'bãi đỗ ngày mai còn chỗ không', draft }, user: { _id: 'unit-owner' } },
    { json: result => { data = result.data; } });
  assert.equal(data.intent, 'CHECK_AVAILABILITY');
  assert.match(data.draft.startDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(data.draft.endTime, '');
  assert.equal(data.draft.licensePlate, '');
});

test('AI availability exposes public slot reasons while keeping blocked spaces out of booking results', async (t) => {
  const bookingController = require('../controllers/bookingController');
  const Floor = require('../models/ParkingFloor');
  const Hold = require('../models/BookingHold');
  const Session = require('../models/Session');
  const Slot = require('../models/Slot');
  const Entitlement = require('../models/MembershipSlotEntitlement');
  const Subscription = require('../models/Subscription');
  const query = rows => ({ select() { return this; }, sort() { return this; }, lean: async () => rows });
  const floorId = 'test-floor';
  const names = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
  t.mock.method(Floor, 'find', () => query([{ _id: floorId, name: 'Floor 1', floorNumber: 1,
    layoutData: { elements: names.map((name, id) => ({ id, name, type: 'slot' })) } }]));
  t.mock.method(Booking, 'find', () => query([{ floorId, parkingSlot: 'A2', userId: 'private-owner' }]));
  t.mock.method(Session, 'find', () => query([{ floorId, parkingSlot: 'A3', licensePlate: 'PRIVATE' }]));
  t.mock.method(Hold, 'find', () => query([{ floorId, slotCode: 'A4', userId: 'private-owner' }]));
  t.mock.method(Entitlement, 'find', () => query([]));
  t.mock.method(Subscription, 'find', () => query([]));
  t.mock.method(Slot, 'find', filter => query(filter.status === 'maintenance' ? [{ floorID: floorId, slotNumber: 'A5' }]
    : filter.reservedFor ? [{ floorID: floorId, slotNumber: 'A6', reservedFor: 'private-owner' }] : []));
  const start = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const read = async bookingSource => {
    let result;
    const res = { status: () => res, json: body => { result = body.data; } };
    await bookingController.getAvailableSlots({ query: { startTime: start.toISOString(), endTime: end.toISOString(), bookingSource } }, res, error => { throw error; });
    return result;
  };
  const ai = await read('AI_QUICK');
  assert.deepEqual(ai.slots.map(slot => slot.slotCode), ['A1']);
  assert.deepEqual(ai.unavailableSlots.map(({ slotCode, reason }) => [slotCode, reason]),
    [['A2', 'BOOKED'], ['A3', 'OCCUPIED'], ['A4', 'HELD'], ['A5', 'MAINTENANCE'], ['A6', 'VIP_PACKAGE_REQUIRED']]);
  assert.doesNotMatch(JSON.stringify(ai.unavailableSlots), /PRIVATE|private-owner/);
  const regular = await read(undefined);
  assert.deepEqual(regular.slots, ai.slots);
  assert.equal(regular.unavailableSlots, undefined);
});

test('generic requests for a parking space do not ask for an optional slot code', () => {
  for (const noun of ['ô đỗ', 'bãi đỗ', 'chỗ đỗ']) {
    for (const quantity of ['1', 'một']) {
      const prompt = `tôi muốn đặt ${quantity} ${noun} vào ngày mai lúc 4h đến 5h tối cho xe 55R55555`;
      assert.equal(parse(prompt), null, prompt);
      const result = parseBasicVietnameseBooking(prompt, '2099-11-11', {}, '07:00', 'vi');
      assert.ok(result, prompt);
      assert.equal(result.draft.requestedVehicleCount, 1, prompt);
      assert.equal(result.draft.startDate, '2099-11-12', prompt);
      assert.equal(result.draft.endDate, '2099-11-12', prompt);
      assert.equal(result.draft.startTime, '16:00', prompt);
      assert.equal(result.draft.endTime, '17:00', prompt);
      assert.equal(result.draft.licensePlate, '55R55555', prompt);
      assert.equal(result.draft.slotCode, '', prompt);
      assert.doesNotMatch(result.clarification || '', /mã ô|slot code/i, prompt);
    }
  }
});

test('the screenshot booking sequence keeps tomorrow while collecting its plate and times', () => {
  let draft = {};
  for (const prompt of ['tôi muốn đặt 1 bãi đỗ vào ngày mai', 'đặt 1 xe', 'tôi muốn đặt 1 ô đỗ cho xe 11A11111', '4h đến 5h tối']) {
    assert.equal(parse(prompt, draft), null, prompt);
    const result = parseBasicVietnameseBooking(prompt, '2099-11-11', draft, '07:00', 'vi');
    assert.ok(result, prompt);
    draft = { ...result.draft, __intent: result.intent };
    assert.equal(draft.startDate, '2099-11-12', prompt);
    assert.equal(draft.requestedVehicleCount, 1, prompt);
    assert.doesNotMatch(result.clarification || '', /mã ô|slot code/i, prompt);
  }
  assert.equal(draft.licensePlate, '11A11111');
  assert.equal(draft.startTime, '16:00');
  assert.equal(draft.endTime, '17:00');
});

test('a generic parking request still honors a separately named slot and asks about a malformed explicit slot', () => {
  const request = 'đặt 1 ô đỗ ngày mai 8h đến 9h cho xe 11A11111';
  const chosen = parseBasicVietnameseBooking(`${request}, chọn ô B2`, '2099-11-11', {}, '07:00', 'vi');
  assert.equal(chosen.draft.slotCode, 'B2');
  assert.doesNotMatch(chosen.clarification || '', /mã ô/);
  const invalid = parseBasicVietnameseBooking(`${request}, đổi sang ô`, '2099-11-11', {}, '07:00', 'vi');
  assert.match(invalid.clarification, /mã ô/);
});

test('booking a space right now is creation, not a request to change its optional slot', () => {
  for (const noun of ['ô', 'ô đỗ', 'chỗ đỗ', 'bãi đỗ']) {
    for (const instant of ['ngay bây giờ', 'bây giờ']) {
      const prompt = `tôi muốn đặt 1 ${noun} ${instant}`;
      assert.equal(parse(prompt), null, prompt);
      const result = parseBasicVietnameseBooking(prompt, '2099-11-11', {}, '10:07', 'vi');
      assert.ok(result, prompt);
      assert.equal(result.intent, 'CREATE_BOOKING', prompt);
      assert.equal(result.draft.requestedVehicleCount, 1, prompt);
      assert.equal(result.draft.startDate, '2099-11-11', prompt);
      assert.equal(result.draft.startTime, '10:15', prompt);
      assert.equal(result.draft.slotCode, '', prompt);
      assert.doesNotMatch(result.clarification || '', /mã ô|đổi sang ô/);
    }
  }
  const midnight = parseBasicVietnameseBooking('đặt 1 ô đỗ ngay bây giờ cho xe 11A11111', '2099-11-11', {}, '23:55', 'vi');
  assert.equal(midnight.draft.startDate, '2099-11-12');
  assert.equal(midnight.draft.startTime, '00:00');
  assert.equal(midnight.draft.licensePlate, '11A11111');
  assert.doesNotMatch(midnight.clarification || '', /mã ô/);
});

test('changing a slot keeps the existing booking and only asks for a slot when it was explicitly requested', () => {
  const draft = { __intent: 'CREATE_BOOKING', requestedVehicleCount: 1, licensePlate: '11A11111',
    startDate: '2099-11-12', endDate: '2099-11-12', startTime: '08:00', endTime: '09:00', slotCode: 'B2', serviceIds: ['kept-service'] };
  const changed = parseBasicVietnameseBooking('đổi ô sang A1', '2099-11-11', draft, '10:07', 'vi');
  assert.equal(changed.draft.slotCode, 'A1');
  assert.equal(changed.draft.requestedVehicleCount, 1);
  for (const field of ['startDate', 'endDate', 'startTime', 'endTime', 'licensePlate']) assert.equal(changed.draft[field], draft[field]);
  assert.deepEqual(changed.draft.serviceIds, draft.serviceIds);
  for (const prompt of ['đổi ô', 'đổi sang ô', 'đặt 1 ô đỗ mã']) {
    const result = parseBasicVietnameseBooking(prompt, '2099-11-11', draft, '10:07', 'vi');
    assert.match(result.clarification, /mã ô/, prompt);
  }
});

test('next-morning departure replies use the arrival date rather than today or the prior departure', () => {
  const previous = { __intent: 'CREATE_BOOKING', __awaitingField: 'endTime', requestedVehicleCount: 1,
    startDate: '2099-11-18', endDate: '2099-11-18', startTime: '22:45', endTime: '23:00',
    licensePlate: '11A11111', slotCode: 'B2', serviceIds: ['kept-service'], voucherId: 'kept-voucher' };
  for (const prompt of ['7h sáng hôm sau', '7h sáng ngày hôm sau', '7 giờ sáng ngày kế tiếp']) {
    const result = parseBasicVietnameseBooking(prompt, '2099-11-11', previous, '22:30', 'vi');
    assert.ok(result, prompt);
    assert.equal(result.draft.startDate, '2099-11-18', prompt);
    assert.equal(result.draft.startTime, '22:45', prompt);
    assert.equal(result.draft.endDate, '2099-11-19', prompt);
    assert.equal(result.draft.endTime, '07:00', prompt);
    assert.equal(result.clarification, undefined, prompt);
    assert.equal(result.draft.licensePlate, previous.licensePlate);
    assert.equal(result.draft.slotCode, previous.slotCode);
    assert.deepEqual(result.draft.serviceIds, previous.serviceIds);
    assert.equal(result.draft.voucherId, previous.voucherId);
    const repeated = parseBasicVietnameseBooking(prompt, '2099-11-11', { ...result.draft, __intent: result.intent }, '22:30', 'vi');
    assert.equal(repeated.draft.endDate, '2099-11-19', 'repeating the answer must not advance another day');
  }
});

test('midnight departure means the next midnight unless an explicit same-day date was given', () => {
  const previous = { __intent: 'CREATE_BOOKING', __awaitingField: 'endTime', requestedVehicleCount: 1,
    startDate: '2099-11-18', endDate: '2099-11-18', startTime: '22:45', endTime: '', licensePlate: '11A11111' };
  const midnight = parseBasicVietnameseBooking('0h', '2099-11-11', previous, '22:30', 'vi');
  assert.equal(midnight.draft.endDate, '2099-11-19');
  assert.equal(midnight.draft.endTime, '00:00');
  assert.equal(midnight.clarification, undefined);
  for (const prompt of ['0h ngày 18/11/2099', '7h sáng']) {
    const result = parseBasicVietnameseBooking(prompt, '2099-11-11', previous, '22:30', 'vi');
    assert.match(result.clarification, /ngày.*kết thúc|kết thúc.*ngày/, prompt);
    assert.equal(result.draft.startDate, previous.startDate);
    assert.equal(result.draft.startTime, previous.startTime);
    assert.equal(result.draft.endTime, '');
  }
});

test('an overnight interval in one request retains both endpoints through month and year boundaries', () => {
  for (const [date, next] of [['2099-11-30', '2099-12-01'], ['2099-12-31', '2100-01-01']]) {
    const day = date.split('-').reverse().join('/');
    const prompt = `đặt 1 xe 11A11111 ngày ${day} từ 22h45 đến 7h sáng hôm sau`;
    const result = parseBasicVietnameseBooking(prompt, '2099-11-11', {}, '22:30', 'vi');
    assert.equal(result.draft.startDate, date);
    assert.equal(result.draft.endDate, next);
    assert.equal(result.draft.startTime, '22:45');
    assert.equal(result.draft.endTime, '07:00');
    assert.equal(result.clarification, undefined);
  }
});

test('service-target replies can apply a pending service to both vehicles without changing their schedules', async (t) => {
  t.mock.method(Service, 'find', () => queryOf([{ _id: 'unit-demo', name: 'demo', price: 20000, timeCost: 30 }]));
  const rows = [
    { licensePlate: '43A12345', startDate: '2099-11-13', endDate: '2099-11-13', startTime: '10:00', endTime: '12:00', slotCode: 'D1', serviceIds: [], serviceNames: [], voucherId: 'kept-voucher' },
    { licensePlate: '43B54321', startDate: '2099-11-13', endDate: '2099-11-13', startTime: '08:00', endTime: '09:00', slotCode: 'C3', serviceIds: [], serviceNames: [] },
  ];
  for (const isRemoving of [false, true]) {
    const items = rows.map(row => ({ ...row, serviceIds: isRemoving ? ['unit-demo'] : [], serviceNames: isRemoving ? ['demo'] : [] }));
    const draft = { __intent: 'CREATE_BOOKING', requestedVehicleCount: 2, licensePlates: items.map(item => item.licensePlate), reservationItems: items,
      assistantContext: { pendingServiceSelection: { serviceNames: ['demo'], isRemoving } } };
    for (const prompt of ['cho cả 2 xe', 'cho cả hai xe.', 'cả 2', 'áp dụng cho tất cả xe', 'for both cars', 'for both vehicles']) {
      const request = parse(prompt, draft);
      assert.equal(request?.intent, 'BOOK_SERVICE', prompt);
      const result = await executeAssistantRequest(request, 'unit-owner', now);
      const updated = result.transition.draftPatch.reservationItems;
      assert.equal(result.context.pendingServiceSelection, null);
      for (let index = 0; index < items.length; index++) {
        assert.deepEqual(updated[index].serviceIds, isRemoving ? [] : ['unit-demo'], prompt);
        for (const field of ['licensePlate', 'startDate', 'endDate', 'startTime', 'endTime', 'slotCode', 'voucherId']) assert.equal(updated[index][field], items[index][field], field);
      }
      assert.deepEqual(draft.reservationItems, items, 'must not mutate the input booking');
    }
  }
});

test('choosing a service for a multi-car preview asks which vehicle before adding it', async (t) => {
  t.mock.method(Service, 'find', () => queryOf([{ _id: 'unit-demo', name: 'demo', price: 20000, timeCost: 30 }]));
  const items = [
    { licensePlate: '43A12345', startDate: '2099-11-13', endDate: '2099-11-13', startTime: '10:00', endTime: '12:00', serviceIds: [], serviceNames: [] },
    { licensePlate: '43B54321', startDate: '2099-11-13', endDate: '2099-11-13', startTime: '08:00', endTime: '09:00', serviceIds: [], serviceNames: [] },
  ];
  const draft = { __intent: 'CREATE_BOOKING', requestedVehicleCount: 2, licensePlates: items.map(item => item.licensePlate), reservationItems: items };
  const result = await executeAssistantRequest(parse('thêm dịch vụ demo', draft), 'unit-owner', now);
  assert.match(result.message, /cho xe nào/);
  assert.deepEqual(result.context.pendingServiceSelection.serviceNames, ['demo']);
  assert.ok(result.transition.draftPatch.reservationItems.every(item => item.serviceIds.length === 0));
  assert.deepEqual(draft.reservationItems, items);
});

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

test('the live map uses actual overlapping reservations instead of stale booked flags', async (t) => {
  const now = new Date('2026-11-16T09:45:00Z');
  const floor = { _id: 'floor-1', name: 'Floor 1', floorNumber: 1, acceptsBookings: true };
  const makeSlot = (slotNumber, status = 'available', fields = {}) => ({
    _id: slotNumber, slotNumber, status, floorID: floor, ...fields,
  });
  const findRows = (model, rows) => t.mock.method(model, 'find', () => ({
    select() { return this; },
    populate() { return this; },
    async lean() { return rows; },
  }));
  findRows(Slot, [
    makeSlot('B1', 'booked'),
    makeSlot('D1', 'booked'),
    makeSlot('D2'),
    makeSlot('D3'),
    makeSlot('D4'),
    makeSlot('D5', 'available', { slotType: 'slot-vip' }),
    makeSlot('D6', 'available', { retired: true }),
  ]);
  const bookingFind = findRows(Booking, [{ floorId: floor._id, parkingSlot: 'd1' }]);
  const holdFind = findRows(BookingHold, [{ floorId: floor._id, slotCode: 'D2' }]);
  findRows(Session, [{ floorId: floor._id, parkingSlot: 'D3' }]);
  findRows(SlotMaintenanceLog, [{ slotID: 'D4' }]);

  const rows = await getLiveParkingMap(now);
  const upcoming = new Date('2026-11-16T11:45:00Z');
  assert.deepEqual(bookingFind.mock.calls[0].arguments[0].scheduledStart, { $lt: upcoming });
  assert.deepEqual(bookingFind.mock.calls[0].arguments[0].scheduledEnd, { $gt: now });
  assert.deepEqual(holdFind.mock.calls[0].arguments[0], {
    status: 'active', expiresAt: { $gt: now }, startTime: { $lt: upcoming }, endTime: { $gt: now },
  });
  assert.deepEqual(Object.fromEntries(rows.map(row => [row.id, row.availabilityReason])), {
    B1: 'available', D1: 'booked', D2: 'held', D3: 'occupied',
    D4: 'maintenance', D5: 'dedicated', D6: 'closed',
  });
  const assistant = await executeAssistantRequest({
    intents: ['CHECK_PARKING_AVAILABILITY', 'CHECK_SLOT_STATUS'],
    entities: { floorName: '1', slotCode: 'D1' },
  }, 'unit-owner', now);
  assert.match(assistant.message, /còn 1\/5 ô trống.*B1/);
  assert.match(assistant.message, /Ô D1.*đã có lượt đặt/);
});
