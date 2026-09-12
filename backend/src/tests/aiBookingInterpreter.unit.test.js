const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretBookingMessage, normalizeInterpretation } = require('../services/aiBookingInterpreter');

test('AI interpreter extracts booking data without creating anything', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Đặt chỗ ngày mai 8h đến 10h', today: '2026-09-12',
    generateText: async () => '```json\n{"intent":"CREATE_BOOKING","startDate":"2026-09-13","startTime":"08:00","endTime":"10:00"}\n```',
  });
  assert.equal(result.intent, 'CREATE_BOOKING');
  assert.deepEqual(result.draft, {
    startDate: '2026-09-13', endDate: '2026-09-13', startTime: '08:00', endTime: '10:00',
    licensePlate: '', floorName: '', slotCode: '', bookingId: '',
  });
});

test('model response tolerates brief surrounding text and lowercase intent', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Giúp tôi đặt chỗ', today: '2026-09-12',
    generateText: async () => 'Đã hiểu: {"intent":"create_booking","startDate":"2026-09-13","startTime":"19:00","endTime":"20:00"}',
  });
  assert.equal(result.intent, 'CREATE_BOOKING');
  assert.equal(result.draft.startTime, '19:00');
});

test('follow-up keeps date while adding hours', async () => {
  const result = await interpretBookingMessage({
    prompt: '8 giờ đến 10 giờ', today: '2026-09-12',
    draft: { __intent: 'CREATE_BOOKING', startDate: '2026-09-13', endDate: '2026-09-13' },
    generateText: async () => '{"intent":"CREATE_BOOKING","startTime":"08:00","endTime":"10:00"}',
  });
  assert.equal(result.draft.startDate, '2026-09-13');
  assert.equal(result.draft.startTime, '08:00');
});

test('Gemini receives the correct prior context for availability follow-ups', async () => {
  let instruction = '';
  const result = await interpretBookingMessage({
    prompt: 'từ 19h đến 20h', today: '2026-09-12',
    draft: { __intent: 'CHECK_AVAILABILITY', startDate: '2026-09-13' },
    generateText: async (value) => {
      instruction = value;
      return '{"intent":"CHECK_AVAILABILITY","startTime":"19:00","endTime":"20:00"}';
    },
  });
  assert.match(instruction, /Prior intent: CHECK_AVAILABILITY/);
  assert.match(instruction, /"startDate":"2026-09-13"/);
  assert.equal(result.draft.startDate, '2026-09-13');
});

test('switching intent discards stale booking fields', () => {
  const result = normalizeInterpretation({ intent: 'CANCEL_BOOKING' }, {
    __intent: 'CREATE_BOOKING', startDate: '2026-09-13', licensePlate: '43A12345',
  });
  assert.equal(result.draft.startDate, '');
  assert.equal(result.draft.licensePlate, '');
});

test('invalid or invented model fields do not become valid booking values', () => {
  const result = normalizeInterpretation({ intent: 'CREATE_BOOKING', startDate: '2026-02-31', startTime: '25:99', licensePlate: '43A-123.45' });
  assert.equal(result.draft.startDate, '');
  assert.equal(result.draft.startTime, '');
  assert.equal(result.draft.licensePlate, '43A12345');
});

test('malformed AI response fails closed', async () => {
  await assert.rejects(interpretBookingMessage({
    prompt: 'đặt chỗ', today: '2026-09-12', generateText: async () => 'not json',
  }), { statusCode: 502 });
});

test('blank prompt is rejected before calling provider', async () => {
  await assert.rejects(interpretBookingMessage({ prompt: '  ', today: '2026-09-12' }), { statusCode: 400 });
});

test('quota fallback understands a Vietnamese evening booking request', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Tôi muốn đặt xe từ 7 giờ tối đến 8 giờ tối ngày mai.',
    today: '2026-09-12',
    generateText: async () => { throw Object.assign(new Error('Quota exceeded. Please retry in 12.4s.'), { status: 429 }); },
  });
  assert.equal(result.intent, 'CREATE_BOOKING');
  assert.equal(result.draft.startDate, '2026-09-13');
  assert.equal(result.draft.endDate, '2026-09-13');
  assert.equal(result.draft.startTime, '19:00');
  assert.equal(result.draft.endTime, '20:00');
});

test('quota fallback can complete booking hours from a previous draft', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Từ 7 giờ tối đến 8 giờ tối', today: '2026-09-12',
    draft: { __intent: 'CREATE_BOOKING', startDate: '2026-09-13', endDate: '2026-09-13' },
    generateText: async () => { throw Object.assign(new Error('Too many requests'), { status: 429 }); },
  });
  assert.equal(result.draft.startDate, '2026-09-13');
  assert.equal(result.draft.startTime, '19:00');
  assert.equal(result.draft.endTime, '20:00');
});

test('quota reports the real cause when a request is outside the safe fallback', async () => {
  await assert.rejects(interpretBookingMessage({
    prompt: 'Còn chỗ ở tầng 2 không?', today: '2026-09-12',
    generateText: async () => { throw Object.assign(new Error('Quota exceeded. Please retry in 12.4s.'), { status: 429 }); },
  }), (error) => error.statusCode === 429 && /hạn mức.*13 giây/.test(error.message));
});

test('quota fallback preserves explicit floor and slot requirements', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Đặt xe từ 7 giờ tối đến 8 giờ tối ngày mai ở tầng 2 ô A-015', today: '2026-09-12',
    generateText: async () => { throw Object.assign(new Error('Quota exceeded'), { status: 429 }); },
  });
  assert.equal(result.draft.floorName, 'tầng 2');
  assert.equal(result.draft.slotCode, 'A-015');
});

test('provider failures are not described as a misunderstanding', async () => {
  await assert.rejects(interpretBookingMessage({
    prompt: 'Đặt chỗ ngày mai', today: '2026-09-12',
    generateText: async () => { throw new Error('network failure'); },
  }), (error) => error.statusCode === 502 && /tạm thời không khả dụng/.test(error.message));
});

test('common booking phrases work without contacting Gemini', async () => {
  const cases = [
    ['Tôi muốn đặt xe từ 7 giờ tối đến 8 giờ tối ngày mai.', '2026-09-13', '2026-09-13', '19:00', '20:00'],
    ['Đặt chỗ ngày kia từ 19h đến 20h', '2026-09-14', '2026-09-14', '19:00', '20:00'],
    ['Đặt chỗ ngày mốt từ 7-8 giờ tối', '2026-09-14', '2026-09-14', '19:00', '20:00'],
    ['Đặt chỗ mốt từ 7-8 giờ tối', '2026-09-14', '2026-09-14', '19:00', '20:00'],
    ['Đặt chỗ tối nay từ 20:30 đến 21:30', '2026-09-12', '2026-09-12', '20:30', '21:30'],
    ['Đặt chỗ từ 13/9 đến 15/9 lúc 19h30 đến 20h30', '2026-09-13', '2026-09-15', '19:30', '20:30'],
    ['Đặt chỗ 7 giờ rưỡi tối đến 9 giờ tối ngày mai', '2026-09-13', '2026-09-13', '19:30', '21:00'],
    ['Đặt chỗ từ 7h đến 8h tối ngày mai', '2026-09-13', '2026-09-13', '19:00', '20:00'],
    ['Ngày mai từ 19h đến 20h', '2026-09-13', '2026-09-13', '19:00', '20:00'],
    ['Tôi muốn gửi xe từ bảy giờ tối đến tám giờ tối ngày mai', '2026-09-13', '2026-09-13', '19:00', '20:00'],
    ['Đặt xe mai từ 7 rưỡi tối đến 8 rưỡi tối', '2026-09-13', '2026-09-13', '19:30', '20:30'],
    ['Sáng mai đỗ xe từ 8h đến 10h', '2026-09-13', '2026-09-13', '08:00', '10:00'],
    ['Đặt chỗ chiều mai từ 2h đến 4h', '2026-09-13', '2026-09-13', '14:00', '16:00'],
    ['Đặt chỗ ngày mai từ 19h trong 2 giờ', '2026-09-13', '2026-09-13', '19:00', '21:00'],
    ['Đặt chỗ ngày mai từ 19h trong 90 phút', '2026-09-13', '2026-09-13', '19:00', '20:30'],
    ['Đặt chỗ thứ hai từ 19h đến 20h', '2026-09-14', '2026-09-14', '19:00', '20:00'],
    ['Đặt chỗ chủ nhật từ 19h đến 20h', '2026-09-13', '2026-09-13', '19:00', '20:00'],
    ['Đặt chỗ thứ 7 tuần sau từ 19h đến 20h', '2026-09-19', '2026-09-19', '19:00', '20:00'],
  ];
  for (const [prompt, startDate, endDate, startTime, endTime] of cases) {
    const result = await interpretBookingMessage({ prompt, today: '2026-09-12' });
    assert.deepEqual([result.draft.startDate, result.draft.endDate, result.draft.startTime, result.draft.endTime],
      [startDate, endDate, startTime, endTime], prompt);
  }
});

test('ambiguous hours request clarification and keep the date', async () => {
  const result = await interpretBookingMessage({ prompt: 'Đặt chỗ ngày mai từ 7h đến 8h', today: '2026-09-12' });
  assert.equal(result.intent, 'CREATE_BOOKING');
  assert.equal(result.draft.startDate, '2026-09-13');
  assert.equal(result.draft.startTime, '');
  assert.match(result.clarification, /sáng hay tối/);
  const answer = await interpretBookingMessage({
    prompt: '19h đến 20h', today: '2026-09-12', draft: { ...result.draft, __intent: result.intent },
  });
  assert.equal(answer.draft.startDate, '2026-09-13');
  assert.equal(answer.draft.startTime, '19:00');
  assert.equal(answer.draft.endTime, '20:00');
  const shortAnswer = await interpretBookingMessage({
    prompt: 'buổi tối', today: '2026-09-12', draft: { ...result.draft, __intent: result.intent },
  });
  assert.equal(shortAnswer.draft.startTime, '19:00');
  assert.equal(shortAnswer.draft.endTime, '20:00');
  assert.equal(shortAnswer.draft.pendingStartTime, undefined);
  const withPronoun = await interpretBookingMessage({
    prompt: 'Tôi muốn đặt chỗ ngày mai từ 7h đến 8h', today: '2026-09-12',
  });
  assert.equal(withPronoun.draft.startTime, '');
  assert.match(withPronoun.clarification, /sáng hay tối/);
  const noAccents = await interpretBookingMessage({
    prompt: 'toi muon dat cho ngay mai tu 7h den 8h', today: '2026-09-12',
  });
  assert.equal(noAccents.draft.startTime, '');
  assert.match(noAccents.clarification, /sáng hay tối/);
  const withToi = await interpretBookingMessage({
    prompt: 'Đặt chỗ ngày mai từ 7h tới 8h', today: '2026-09-12',
  });
  assert.equal(withToi.draft.startTime, '');
  assert.match(withToi.clarification, /sáng hay tối/);
});

test('conflicting duration and clock range is clarified', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Đặt chỗ ngày mai từ 19h đến 20h trong 2 giờ', today: '2026-09-12',
  });
  assert.equal(result.draft.startTime, '');
  assert.match(result.clarification, /chưa khớp/);
});

test('short follow-ups fill date, plate, floor and change only the departure time', async () => {
  let result = await interpretBookingMessage({ prompt: 'Đặt chỗ từ 19h đến 20h', today: '2026-09-12' });
  for (const prompt of ['ngày mai', 'biển số 43B-204.04', 'tầng 2 ô A-015', 'đổi giờ ra 21h']) {
    result = await interpretBookingMessage({ prompt, today: '2026-09-12', draft: { ...result.draft, __intent: result.intent } });
  }
  assert.equal(result.draft.startDate, '2026-09-13');
  assert.equal(result.draft.startTime, '19:00');
  assert.equal(result.draft.endTime, '21:00');
  assert.equal(result.draft.licensePlate, '43B20404');
  assert.equal(result.draft.floorName, 'tầng 2');
  assert.equal(result.draft.slotCode, 'A-015');
});

test('duration-only follow-up computes departure from the selected arrival', async () => {
  const first = await interpretBookingMessage({
    prompt: 'Đặt chỗ ngày mai từ 19h', today: '2026-09-12',
  });
  assert.equal(first.draft.endTime, '');
  const next = await interpretBookingMessage({
    prompt: 'trong 2 giờ', today: '2026-09-12', draft: { ...first.draft, __intent: first.intent },
  });
  assert.equal(next.draft.startTime, '19:00');
  assert.equal(next.draft.endTime, '21:00');
});

test('changing floor clears an old slot instead of silently reusing it', async () => {
  const result = await interpretBookingMessage({
    prompt: 'đổi sang tầng 3', today: '2026-09-12',
    draft: { __intent: 'CREATE_BOOKING', startDate: '2026-09-13', startTime: '19:00', endTime: '20:00', floorName: 'tầng 2', slotCode: 'A-015' },
  });
  assert.equal(result.draft.floorName, 'tầng 3');
  assert.equal(result.draft.slotCode, '');
});

test('incomplete plate or floor preference is clarified before slot selection', async () => {
  const plate = await interpretBookingMessage({
    prompt: 'Đặt xe 43A1 ngày mai từ 19h đến 20h', today: '2026-09-12',
  });
  assert.match(plate.clarification, /biển số đầy đủ/);
  const floor = await interpretBookingMessage({
    prompt: 'Đặt chỗ tầng hầm ngày mai từ 19h đến 20h', today: '2026-09-12',
  });
  assert.match(floor.clarification, /tầng nào/);
});

test('explicit electric-car request remains a vehicle constraint across follow-ups', async () => {
  const first = await interpretBookingMessage({
    prompt: 'Đặt xe điện ngày mai từ 19h đến 20h', today: '2026-09-12',
  });
  assert.equal(first.draft.vehicleType, 'electric_car');
  const followUp = await interpretBookingMessage({
    prompt: 'tầng 2', today: '2026-09-12', draft: { ...first.draft, __intent: first.intent },
  });
  assert.equal(followUp.draft.vehicleType, 'electric_car');
  assert.equal(followUp.draft.floorName, 'tầng 2');
});

test('local parser does not silently ignore unavailable service, recurring or multiple-car requirements', () => {
  const { parseBasicVietnameseBooking } = require('../services/aiBookingInterpreter');
  for (const prompt of [
    'Đặt xe điện có sạc ngày mai từ 19h đến 20h',
    'Đặt chỗ mỗi ngày từ 19h đến 20h',
    'Mai 19h đến 20h ở khu A',
    'Đặt 2 xe ngày mai từ 19h đến 20h',
    'Kiểm tra còn chỗ ngày mai từ 19h đến 20h không?',
    'Không muốn đặt chỗ ngày mai từ 19h đến 20h',
  ]) assert.equal(parseBasicVietnameseBooking(prompt, '2026-09-12'), null, prompt);
  assert.equal(parseBasicVietnameseBooking('từ 19h đến 20h', '2026-09-12', { __intent: 'CHECK_AVAILABILITY', startDate: '2026-09-13' }), null);
});

test('manual-only and motorbike requests do not produce an incomplete booking preview', async () => {
  for (const prompt of [
    'Đặt xe điện có sạc ngày mai từ 19h đến 20h',
    'Đặt 2 xe ngày mai từ 19h đến 20h',
    'Đặt chỗ mỗi ngày từ 19h đến 20h',
    'Mai 19h đến 20h ở khu A',
  ]) {
    const result = await interpretBookingMessage({ prompt, today: '2026-09-12' });
    assert.equal(result.intent, 'CREATE_BOOKING');
    assert.match(result.clarification, /Đặt chỗ thủ công/, prompt);
    assert.equal(result.draft.startTime, '');
  }
  const motorbike = await interpretBookingMessage({ prompt: 'Đặt xe máy ngày mai', today: '2026-09-12' });
  assert.match(motorbike.clarification, /chỉ hỗ trợ.*ô tô/);
});

test('cross-date stay is not mistaken for a booking repeated on both dates', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Đặt chỗ từ 23h ngày mai đến 01h ngày kia', today: '2026-09-12',
  });
  assert.equal(result.draft.startDate, '2026-09-13');
  assert.equal(result.draft.endDate, '2026-09-14');
  assert.equal(result.draft.startTime, '');
  assert.match(result.clarification, /đỗ liên tục qua ngày/);
  const overnight = await interpretBookingMessage({
    prompt: 'Đặt xe qua đêm từ 23h đến 01h ngày mai', today: '2026-09-12',
  });
  assert.equal(overnight.draft.startTime, '');
  assert.match(overnight.clarification, /Đặt chỗ thủ công/);
});
