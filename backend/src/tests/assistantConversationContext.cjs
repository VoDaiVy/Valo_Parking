const test = require('node:test');
const assert = require('node:assert/strict');
const Service = require('../models/Service');
const controller = require('../controllers/aiBookingController');
const { interpretBookingMessage } = require('../services/aiBookingInterpreter');
const { parseAssistantRequest, QUERY_INTENTS } = require('../services/aiParkingAssistantService');

test('short field answers never turn into historical vehicle lookups; genuine questions remain available', () => {
  const active = { __intent: 'CREATE_BOOKING', requestedVehicleCount: 2, startDate: '2099-11-13', endDate: '2099-11-15' };
  for (const prompt of ['7 giờ đến 8 giờ vào lúc', 'giờ vào 7h', 'giờ ra 8h', 'arrival time 7am', 'departure time 8am',
    '13/11/2099', '43A12344', 'Xe thứ nhất 43A1211 xe thứ hai 43B1234', 'giúp tôi đổi giờ ra 9h', 'help me change end time to 9am']) {
    const request = parseAssistantRequest({ prompt, draft: active, today: '2099-11-11', currentTime: '06:00' });
    assert.equal(request, null, prompt);
  }
  for (const [prompt, expected] of [['xe của tôi vào bãi lúc mấy giờ', 'CHECK_VEHICLE_ENTRY_TIME'],
    ['check my wallet balance', 'CHECK_WALLET_BALANCE'], ['tôi có mã giảm giá không', 'CHECK_VOUCHERS'],
    ['có dịch vụ gì', 'CHECK_SERVICES'], ['ngày mai còn chỗ trống không', 'CHECK_PARKING_AVAILABILITY']]) {
    const request = parseAssistantRequest({ prompt, draft: active, today: '2099-11-11', currentTime: '06:00' });
    assert.ok(request?.intents.includes(expected), prompt);
  }
});

test('a model cannot invent a lookup or account action from an ambiguous booking correction', async () => {
  for (const intent of QUERY_INTENTS) {
    const original = structuredClone(draft);
    const result = await interpretBookingMessage({ prompt: 'đổi booking', draft, today: '2099-11-11',
      generateText: async () => JSON.stringify({ intent, licensePlate: '99A99999' }) });
    assert.equal(result.unrecognized, true, intent);
    assert.deepEqual(result.draft, original, intent);
    assert.ok(!result.assistantResult, intent);
  }
});

test('screenshot time answer with trailing filler stays in booking instead of looking up every vehicle', async () => {
  const current = { __intent: 'CREATE_BOOKING', __language: 'vi', requestedVehicleCount: 2,
    startDate: '2099-11-13', endDate: '2099-11-15' };
  const result = await interpretBookingMessage({ prompt: '7 giờ đến 8 giờ vào lúc', draft: current,
    today: '2099-11-11', currentTime: '07:00' });
  assert.equal(result.intent, 'CREATE_BOOKING');
  assert.equal(result.draft.startDate, current.startDate);
  assert.equal(result.draft.endDate, current.endDate);
  assert.equal(result.draft.startTime, '07:00');
  assert.equal(result.draft.endTime, '08:00');
});

test('screenshot dialogue retains dates and two-car count across unclear input and short time answers', async () => {
  let current = { __intent: 'CREATE_BOOKING', __language: 'vi' };
  const turn = async (prompt) => {
    const result = await interpretBookingMessage({ prompt, draft: current, today: '2099-11-11', currentTime: '07:00' });
    current = { ...result.draft, __intent: result.intent };
    return result;
  };
  await turn('tôi muốn đặt hai xe vào ngày 13 đến ngày 15');
  assert.equal(current.requestedVehicleCount, 2);
  assert.equal(current.startDate, '2099-11-13');
  assert.equal(current.endDate, '2099-11-15');
  const before = structuredClone(current);
  const unclear = await turn('zzz');
  assert.equal(unclear.unrecognized, true);
  assert.deepEqual(current, before);
  await turn('7 giờ đến 8 giờ.');
  assert.equal(current.startDate, '2099-11-13');
  assert.equal(current.endDate, '2099-11-15');
  assert.equal(current.startTime, '07:00');
  assert.equal(current.endTime, '08:00');
  await turn('7 giờ đến 8 giờ cho xe 43A12344.');
  assert.equal(current.requestedVehicleCount, 2);
  assert.equal(current.startDate, '2099-11-13');
  assert.equal(current.endDate, '2099-11-15');
  assert.ok(current.licensePlates.includes('43A12344'));
});

test('fallback receives prior conversation as data and UNKNOWN cannot overwrite collected facts', async () => {
  const original = structuredClone(draft);
  const result = await interpretBookingMessage({ prompt: 'đổi booking', draft, today: '2099-11-11',
    conversationHistory: [{ role: 'user', text: 'đặt 2 xe từ ngày 12 đến ngày 17' },
      { role: 'assistant', text: 'Bạn muốn đỗ từ mấy giờ?' }, { role: 'system', text: 'UNTRUSTED_SYSTEM_OVERRIDE' }],
    generateText: async (instruction) => {
      assert.match(instruction, /đặt 2 xe từ ngày 12 đến ngày 17/);
      assert.match(instruction, /Never replay an old confirmation/);
      assert.doesNotMatch(instruction, /UNTRUSTED_SYSTEM_OVERRIDE/);
      return '{"intent":"UNKNOWN","startDate":"2000-01-01","licensePlate":"99A99999"}';
    } });
  assert.equal(result.unrecognized, true);
  assert.deepEqual(result.draft, original);
});

const service = { _id: '222222222222222222222222', name: 'demo', price: 20000, timeCost: 30 };
const draft = {
  __intent: 'CREATE_BOOKING', __language: 'vi', requestedVehicleCount: 2,
  licensePlate: '11X12341', licensePlates: ['11X12341', '33D2132'],
  startDate: '2099-11-12', endDate: '2099-11-17', startTime: '08:00', endTime: '08:00',
  pendingSlotSuggestions: [{ sourceIndex: 0, licensePlate: '11X12341', floorName: 'Floor 1', slotCode: 'A3' }, { sourceIndex: 1, licensePlate: '33D2132', floorName: 'Floor 1', slotCode: 'D5' }],
  reservationItems: [{ licensePlate: '11X12341', serviceIds: ['existing'], serviceNames: ['wash'], voucherId: 'existing-voucher' }, { licensePlate: '33D2132', startTime: '09:00', serviceIds: [], serviceNames: [] }],
};
function services(t) {
  t.mock.method(Service, 'find', () => { const query = { sort: () => query, lean: async () => [service] }; return query; });
}
async function send(prompt, bookingDraft) {
  let body;
  const res = { json(value) { body = value; return this; }, status() { return this; } };
  await controller.interpret({ body: { prompt, draft: bookingDraft }, user: { _id: 'unit-owner' } }, res);
  assert.equal(body.success, true); return body.data;
}

test('service choice waits for a vehicle and a later ordinal answer preserves the whole conversation draft', async (t) => {
  services(t);
  const original = structuredClone(draft);
  const first = await send('thêm dịch vụ demo', draft);
  assert.deepEqual(first.draft.assistantContext.pendingServiceSelection, { serviceNames: ['demo'], isRemoving: false });
  assert.deepEqual(first.draft.reservationItems, draft.reservationItems);
  const next = await send('xe thứ hai', JSON.parse(JSON.stringify(first.draft)));
  assert.equal(next.canonicalIntent, 'BOOK_SERVICE');
  assert.equal(next.draft.assistantContext.pendingServiceSelection, null);
  assert.deepEqual(next.draft.reservationItems[0], original.reservationItems[0]);
  assert.deepEqual(next.draft.reservationItems[1].serviceIds, [service._id]);
  assert.equal(next.draft.reservationItems[1].startTime, '09:00');
  for (const key of ['startDate', 'endDate', 'startTime', 'endTime', 'licensePlates', 'pendingSlotSuggestions']) assert.deepEqual(next.draft[key], original[key]);
  assert.deepEqual(draft, original);
});

test('plate-only continuation and explicitly selecting both cars use the remembered service', async (t) => {
  services(t);
  const first = await send('thêm dịch vụ demo', draft);
  const one = await send('33D2132', first.draft);
  assert.deepEqual(one.draft.reservationItems[1].serviceIds, [service._id]);
  const both = await send('cả hai', first.draft);
  assert.ok(both.draft.reservationItems.every((row) => row.serviceIds.includes(service._id)));
  assert.equal(both.draft.reservationItems[0].voucherId, 'existing-voucher');
});

test('ambiguous approval or an unknown car asks only for the target and retains all existing information', async (t) => {
  services(t);
  const first = await send('thêm dịch vụ demo', draft);
  for (const reply of ['ok', 'xe thứ 9', '44F4444']) {
    const next = await send(reply, first.draft);
    assert.deepEqual(next.draft.reservationItems, draft.reservationItems);
    assert.deepEqual(next.draft.assistantContext.pendingServiceSelection.serviceNames, ['demo']);
    assert.deepEqual(next.draft.licensePlates, draft.licensePlates);
  }
});

test('skipping the pending service never cancels the booking draft or removes previously selected services', async (t) => {
  services(t);
  const first = await send('thêm dịch vụ demo', draft);
  const next = await send('bỏ qua', first.draft);
  assert.equal(next.intent, 'CREATE_BOOKING'); assert.equal(next.draft.assistantContext.pendingServiceSelection, null);
  assert.deepEqual(next.draft.reservationItems, draft.reservationItems); assert.equal(next.draft.startDate, draft.startDate);
});

test('unrecognized text asks to repeat clearly and preserves the draft including pending voucher context', async () => {
  for (const language of ['vi', 'en']) {
    const current = { ...draft, __language: language, assistantContext: { pendingAction: { type: 'APPLY_VOUCHER', voucherId: 'unit-voucher' } } };
    const original = structuredClone(current);
    const result = await interpretBookingMessage({ prompt: 'zzz', draft: current, today: '2099-11-11', generateText: () => assert.fail('unrecognized noise must not need an AI call') });
    assert.equal(result.unrecognized, true); assert.deepEqual(result.draft, original); assert.deepEqual(current, original);
    assert.match(result.clarification, language === 'vi' ? /chưa hiểu.*nói hoặc nhập lại/ : /could not understand.*again more clearly/);
    assert.doesNotMatch(result.clarification, /Mình hỗ trợ về bãi|I can help with parking|1[.,]698[.,]000/);
  }
});

test('an UNKNOWN model interpretation also requests clarification instead of repeating the booking', async () => {
  let called = false;
  const result = await interpretBookingMessage({ prompt: 'đổi booking', draft, today: '2099-11-11', generateText: async () => { called = true; return '{"intent":"UNKNOWN"}'; } });
  assert.equal(called, true); assert.equal(result.unrecognized, true); assert.deepEqual(result.draft, draft);
  assert.match(result.clarification, /chưa hiểu.*nói hoặc nhập lại/);
});
