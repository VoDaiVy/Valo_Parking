const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GEMINI_API_KEY = '';
const { parseBasicVietnameseBooking } = require('../services/aiBookingInterpreter');
const { interpretBookingMessage } = require('../services/aiBookingInterpreter');
const { parseAssistantRequest } = require('../services/aiParkingAssistantService');
const previous = { __intent: 'CREATE_BOOKING', licensePlate: '44D4444', vehicleId: 'unit-vehicle', requestedVehicleCount: 1,
  startDate: '2099-11-18', endDate: '2099-11-18', startTime: '09:00', endTime: '20:00', floorName: 'Tầng 1', slotCode: 'B3',
  serviceIds: ['unit-demo'], serviceNames: ['demo'], voucherId: 'unit-voucher', voucherName: 'Unit voucher' };
const parse = (text, draft = previous, language = 'vi') => parseBasicVietnameseBooking(text, '2099-11-11', { ...draft, __intent: 'CREATE_BOOKING' }, '07:00', language);
const plates = (result) => result.draft.reservationItems.map((item) => item.licensePlate);

test('two numbered plates in the screenshot complete the existing schedule', () => {
  const draft = { __intent: 'CREATE_BOOKING', requestedVehicleCount: 2,
    startDate: '2099-11-13', endDate: '2099-11-13', startTime: '08:00', endTime: '09:00' };
  for (const text of ['Xe thứ nhất 43A1211 xe thứ 2 43B1234.', 'Xe thứ nhất 43A1211, xe thứ 2 43B1234.',
    'Xe thứ nhất 43A1211 xe thứ hai 43B1234.']) {
    const result = parse(text, draft);
    assert.equal(parseAssistantRequest({ prompt: text, draft, today: '2099-11-11', currentTime: '07:00' }), null, text);
    assert.ok(result, text);
    assert.deepEqual(plates(result), ['43A1211', '43B1234'], text);
    assert.equal(result.draft.requestedVehicleCount, 2);
    assert.ok(result.draft.reservationItems.every((item) => item.startDate === draft.startDate
      && item.endDate === draft.endDate && item.startTime === '08:00' && item.endTime === '09:00'));
    assert.equal(result.clarification, undefined);
  }
});

test('a letter I in the numeric plate suffix asks about that car instead of rejecting both cars', () => {
  const draft = { __intent: 'CREATE_BOOKING', requestedVehicleCount: 2,
    startDate: '2099-11-13', endDate: '2099-11-13', startTime: '08:00', endTime: '09:00' };
  const result = parse('Xe thứ nhất 43AI211 xe thứ 2 43B1234.', draft);
  assert.ok(result);
  assert.match(result.clarification, /biển số xe 1/i);
  assert.match(result.clarification, /chữ I hay số 1/);
  assert.equal(result.draft.reservationItems[1].licensePlate, '43B1234');
});

test('full interpreter accepts ordinal plate follow-ups without a model and asks only about the malformed row', async () => {
  const draft = { __intent: 'CREATE_BOOKING', __language: 'vi', requestedVehicleCount: 2,
    startDate: '2099-11-13', endDate: '2099-11-15', startTime: '08:00', endTime: '09:00' };
  const valid = await interpretBookingMessage({ prompt: 'Xe thứ nhất 43A1211 xe thứ 2 43B1234.',
    draft, today: '2099-11-11', currentTime: '07:00' });
  assert.ok(!valid.unrecognized);
  assert.deepEqual(plates(valid), ['43A1211', '43B1234']);
  const invalid = await interpretBookingMessage({ prompt: 'Xe thứ nhất 43AI211 xe thứ 2 43B1234.',
    draft, today: '2099-11-11', currentTime: '07:00' });
  assert.ok(!invalid.unrecognized);
  assert.match(invalid.clarification, /biển số xe 1/i);
  const corrected = await interpretBookingMessage({ prompt: '43A1211', draft: { ...invalid.draft, __intent: invalid.intent },
    today: '2099-11-11', currentTime: '07:00' });
  assert.deepEqual(plates(corrected), ['43A1211', '43B1234']);
  for (const item of corrected.draft.reservationItems) {
    for (const field of ['startDate', 'endDate', 'startTime', 'endTime']) assert.equal(item[field], draft[field]);
  }
});

test('spoken day-month dates and times in the screenshot are retained without asking again', () => {
  const sentence = 'Tôi muốn đặt 2 xe từ ngày 13 tháng 11 đến ngày 15 tháng 11';
  const first = parse(sentence + '.', {});
  assert.equal(first.draft.requestedVehicleCount, 2);
  assert.equal(first.draft.startDate, '2099-11-13');
  assert.equal(first.draft.endDate, '2099-11-15');
  const legacyDraft = { __intent: 'CREATE_BOOKING', requestedVehicleCount: 4,
    reservationItems: Array.from({ length: 4 }, () => ({ startDate: '', endDate: '', startTime: '', endTime: '', licensePlate: '' })) };
  for (const draft of [{}, first.draft, legacyDraft]) {
    const result = parse(sentence + ' vào lúc 8 giờ đến 9 giờ.', draft);
    assert.equal(result.draft.requestedVehicleCount, 2);
    assert.equal(result.draft.startDate, '2099-11-13');
    assert.equal(result.draft.endDate, '2099-11-15');
    assert.equal(result.draft.startTime, '08:00');
    assert.equal(result.draft.endTime, '09:00');
    assert.doesNotMatch(result.clarification || '', /đỗ ngày nào|mấy giờ/);
    assert.ok((result.draft.reservationItems || []).length <= 2);
  }
});

test('from-date after xe is not the ordinal fourth vehicle in the screenshot', () => {
  for (const text of [
    'Tôi muốn đặt 2 xe từ ngày 12 đến ngày 15',
    'toi muon dat 2 xe tu ngay 12 den ngay 15',
    'đặt hai xe từ ngày 12 đến ngày 15',
    'đặt 2 xe từ ngày 12/11/2099 đến ngày 15/11/2099',
  ]) {
    const result = parse(text, {});
    assert.equal(result.draft.requestedVehicleCount, 2, text);
    assert.equal(result.draft.startDate, '2099-11-12', text);
    assert.equal(result.draft.endDate, '2099-11-15', text);
    assert.ok((result.draft.reservationItems || []).length <= 2, text);
  }
});

test('latest screenshot with clock colons keeps two cars and the complete interval', () => {
  const result = parse('Tôi muốn đặt 2 xe từ ngày 13 đến ngày 15, vào lúc 8:00 đến 9:00.', {});
  assert.equal(result.draft.requestedVehicleCount, 2);
  assert.equal(result.draft.startDate, '2099-11-13');
  assert.equal(result.draft.endDate, '2099-11-15');
  assert.equal(result.draft.startTime, '08:00');
  assert.equal(result.draft.endTime, '09:00');
  assert.ok((result.draft.reservationItems || []).length <= 2);
});

test('from-time applies to the two existing vehicles while explicit fourth ordinal still works', () => {
  const initial = parse('đặt 2 xe từ ngày 12 đến ngày 15', {});
  const timed = parse('cho 2 xe từ 8h đến 9h', initial.draft);
  assert.equal(timed.draft.requestedVehicleCount, 2);
  assert.equal(timed.draft.startDate, '2099-11-12');
  assert.equal(timed.draft.endDate, '2099-11-15');
  assert.equal(timed.draft.startTime, '08:00');
  assert.equal(timed.draft.endTime, '09:00');
  const fourth = parse('xe thứ tư biển số 44D4444 ngày 12/11/2099 từ 8h đến 9h', {});
  assert.equal(fourth.draft.requestedVehicleCount, 4);
  assert.equal(fourth.draft.reservationItems[3].licensePlate, '44D4444');
});

test('the screenshot adds both supplied cars to the existing car, producing three vehicles', () => {
  const result = parse('thêm xe 55d5555 và xe 66d6666');
  assert.deepEqual(plates(result), ['44D4444', '55D5555', '66D6666']); assert.equal(result.draft.requestedVehicleCount, 3); assert.equal(result.clarification, undefined);
  assert.equal(result.draft.licensePlate, previous.licensePlate); assert.equal(result.draft.slotCode, '');
  assert.ok(result.draft.reservationItems.every((item) => item.startTime === '09:00' && item.endTime === '20:00' && item.startDate === '2099-11-18'));
  assert.equal(result.draft.reservationItems[0].slotCode, 'B3'); assert.equal(result.draft.reservationItems[1].slotCode, '');
  assert.deepEqual(result.draft.reservationItems[0].serviceIds, ['unit-demo']); assert.deepEqual(result.draft.reservationItems[1].serviceIds, []);
  assert.equal(result.draft.reservationItems[0].voucherId, 'unit-voucher'); assert.equal(result.draft.reservationItems[1].voucherId, '');
});
test('adding to an existing per-vehicle row preserves its services, voucher, id and schedule', () => {
  const row = { ...previous, licensePlate: previous.licensePlate };
  const result = parse('thêm 2 xe 55D5555 và 66D6666', { ...previous, reservationItems: [row] });
  assert.equal(result.draft.reservationItems.length, 3); assert.equal(result.draft.reservationItems[0].vehicleId, 'unit-vehicle');
  assert.deepEqual(result.draft.reservationItems[0].serviceIds, ['unit-demo']); assert.equal(result.draft.reservationItems[0].slotCode, 'B3');
});
test('English additive requests use additional counts rather than replacing the total count', () => {
  for (const text of ['add two cars 55D5555 and 66D6666', 'add cars 55D5555 and 66D6666', 'include 2 more vehicles 55D5555 and 66D6666']) {
    const result = parse(text, previous, 'en'); assert.ok(result, text); assert.deepEqual(plates(result), ['44D4444', '55D5555', '66D6666'], text); assert.equal(result.draft.requestedVehicleCount, 3, text);
  }
});
test('additional schedules affect only the added cars, preserving the old booking endpoints', () => {
  const result = parse('thêm xe 55D5555 và xe 66D6666 ngày 19/11/2099 từ 10h đến 11h');
  assert.equal(result.draft.reservationItems[0].startDate, '2099-11-18'); assert.equal(result.draft.reservationItems[0].startTime, '09:00');
  for (const item of result.draft.reservationItems.slice(1)) { assert.equal(item.startDate, '2099-11-19'); assert.equal(item.startTime, '10:00'); assert.equal(item.endTime, '11:00'); }
});
test('different existing schedules prompt for the added car time, then scope the answer to that car', () => {
  const old = { ...previous, requestedVehicleCount: 2, licensePlates: ['44D4444', '33D3333'], reservationItems: [
    { ...previous, serviceIds: ['unit-demo'] }, { licensePlate: '33D3333', startDate: '2099-11-18', endDate: '2099-11-18', startTime: '07:00', endTime: '08:00', slotCode: 'B3', serviceIds: [] },
  ] };
  const added = parse('thêm xe 55D5555', old);
  assert.ok(added.clarification.includes('Xe 3')); assert.equal(added.draft.reservationItems[2].startTime, '');
  const completed = parse('10h đến 11h', added.draft);
  assert.equal(completed.draft.reservationItems[0].startTime, '09:00'); assert.equal(completed.draft.reservationItems[1].startTime, '07:00'); assert.equal(completed.draft.reservationItems[2].startTime, '10:00');
  assert.deepEqual(completed.draft.reservationItems[0].serviceIds, ['unit-demo']);
});
test('missing plates are requested only for the unfilled added vehicles and filled without dropping old cars', () => {
  const added = parse('thêm 2 xe 55D5555');
  assert.equal(added.draft.requestedVehicleCount, 3); assert.ok(added.clarification.includes('xe 3'));
  const completed = parse('66D6666', added.draft);
  assert.deepEqual(plates(completed), ['44D4444', '55D5555', '66D6666']); assert.equal(completed.draft.requestedVehicleCount, 3);
});
test('duplicate supplied plates cannot create phantom vehicles', () => {
  const duplicate = parse('thêm xe 44D4444'); assert.equal(duplicate.draft.requestedVehicleCount, 1); assert.ok(duplicate.clarification.includes('đã có'));
  const repeat = parse('thêm xe 55D5555 và xe 55D5555'); assert.equal(repeat.draft.requestedVehicleCount, 2); assert.deepEqual(plates(repeat), ['44D4444', '55D5555']);
});
test('a count/plate mismatch or exceeding five cars asks for correction without replacing the current draft', () => {
  for (const text of ['thêm 1 xe 55D5555 và 66D6666', 'thêm 5 xe']) {
    const result = parse(text); assert.ok(result.clarification); assert.equal(result.draft.requestedVehicleCount, 1); assert.equal(result.draft.licensePlate, '44D4444');
  }
});
test('a vehicle appended to a booking is not routed to vehicle registration', () => {
  assert.equal(parseAssistantRequest({ prompt: 'thêm xe 55D5555 và xe 66D6666', draft: previous, today: '2099-11-11', currentTime: '07:00' }), null);
});
test('supplementing several cars works, while explicit account registration keeps its own route', () => {
  const result = parse('bổ sung 2 xe 55D5555 và 66D6666'); assert.deepEqual(plates(result), ['44D4444', '55D5555', '66D6666']);
  const registration = parseAssistantRequest({ prompt: 'thêm xe 55D5555 vào tài khoản', draft: previous, today: '2099-11-11', currentTime: '07:00' });
  assert.equal(registration.intent, 'ADD_VEHICLE');
});
test('fresh preview allocates three independent slots and charges the old service only once', async () => {
  const { prepareAiBooking } = await import('../../../frontend/src/utils/aiBookingFlow.js');
  const result = parse('thêm xe 55D5555 và xe 66D6666');
  const ok = (data) => ({ ok: true, data: { data } }); let payload;
  const gateway = { getMyBookings: async () => ok([]), getAvailableBookingSlots: async () => ok({ slots: ['B3', 'B4', 'B5'].map((slotCode) => ({ slotCode, floorId: 'unit-floor', floorName: 'Tầng 1', slotType: 'SLOT' })) }),
    quoteBulkBooking: async (value) => { payload = value; return ok({ grandTotal: 50000, items: value.items.map((item) => ({ clientItemId: item.clientItemId, totalAmount: item.serviceIds.length ? 30000 : 10000 })) }); },
    getWalletInfo: async () => ok({ balance: 100000 }), createBookingHold: () => assert.fail('preview must not hold'), createBulkBooking: () => assert.fail('preview must not book'),
  };
  const checked = await prepareAiBooking(result.draft, gateway, [], Date.parse('2099-11-11T00:00:00Z'));
  assert.equal(checked.items.length, 3); assert.equal(new Set(checked.items.map((item) => item.slotCode)).size, 3);
  assert.equal(checked.items[0].slotCode, 'B3'); assert.deepEqual(payload.items.map((item) => item.serviceIds), [['unit-demo'], [], []]);
  assert.deepEqual(payload.items.map((item) => item.voucherId || ''), ['unit-voucher', '', '']);
});
