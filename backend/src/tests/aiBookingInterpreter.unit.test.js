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
    licensePlate: '', floorName: '', zoneName: '', slotCode: '', bookingId: '',
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

test('a coded zone stays in quick booking and duration produces the departure time', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Đặt cho tôi một chỗ ở Zone B2, ngày mai lúc 8 giờ sáng, trong 3 tiếng.',
    today: '2026-09-27',
  });
  assert.equal(result.intent, 'CREATE_BOOKING');
  assert.equal(result.draft.startDate, '2026-09-28');
  assert.equal(result.draft.startTime, '08:00');
  assert.equal(result.draft.endTime, '11:00');
  assert.equal(result.draft.zoneName, 'B2');
  assert.equal(result.draft.slotCode, '');
  assert.doesNotMatch(result.clarification || '', /Đặt chỗ thủ công/);
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

test('month names and the coming weekend resolve from the supplied current date', async () => {
  const cases = [
    ['Đặt chỗ 23 tháng 9 từ 08:00 đến 09:00', '2026-09-23', '2026-09-23'],
    ['Đặt chỗ 23 tháng 9 năm 2027 từ 08:00 đến 09:00', '2027-09-23', '2027-09-23'],
    ['Đặt chỗ 23/09 từ 08:00 đến 09:00', '2026-09-23', '2026-09-23'],
    ['Đặt chỗ cuối tuần từ 08:00 đến 09:00', '2026-09-26', '2026-09-27'],
  ];
  for (const [prompt, startDate, endDate] of cases) {
    const result = await interpretBookingMessage({ prompt, today: '2026-09-22' });
    assert.deepEqual([result.draft.startDate, result.draft.endDate, result.draft.startTime, result.draft.endTime],
      [startDate, endDate, '08:00', '09:00'], prompt);
  }
  const nextYear = await interpretBookingMessage({ prompt: 'Đặt chỗ 02/01 từ 08:00 đến 09:00', today: '2026-12-31' });
  assert.equal(nextYear.draft.startDate, '2027-01-02');
  const sunday = await interpretBookingMessage({ prompt: 'Đặt chỗ cuối tuần từ 08:00 đến 09:00', today: '2026-09-27' });
  assert.deepEqual([sunday.draft.startDate, sunday.draft.endDate], ['2026-10-03', '2026-10-04']);
});

test('bare clock hours use 24-hour notation and the preview can confirm the interpretation', async () => {
  for (const prompt of [
    'Đặt chỗ ngày mai từ 8h đến 9h',
    'Đặt chỗ ngày mai từ 8 giờ đến 9 giờ',
    'Tôi muốn đặt chỗ ngày mai từ 8h đến 9h',
    'toi muon dat cho ngay mai tu 8h den 9h',
    'Đặt chỗ ngày mai từ 8h tới 9h',
  ]) {
    const result = await interpretBookingMessage({ prompt, today: '2026-09-12' });
    assert.deepEqual([result.intent, result.draft.startDate, result.draft.startTime, result.draft.endTime],
      ['CREATE_BOOKING', '2026-09-13', '08:00', '09:00'], prompt);
    assert.equal(result.clarification, undefined);
  }
  const evening = await interpretBookingMessage({ prompt: 'Đặt chỗ ngày mai từ 8 giờ tối đến 9 giờ tối', today: '2026-09-12' });
  assert.deepEqual([evening.draft.startTime, evening.draft.endTime], ['20:00', '21:00']);
});

test('short spoken follow-ups keep date and vehicle while changing the time of day', async () => {
  const prior = {
    __intent: 'CREATE_BOOKING', startDate: '2026-09-23', endDate: '2026-09-23',
    startTime: '07:00', endTime: '08:00', licensePlate: '43B20404',
  };
  for (const prompt of ['tối', 'buổi tối', 'Tôi muốn đặt vào buổi tối.', 'Đổi sang buổi tối']) {
    const result = await interpretBookingMessage({ prompt, today: '2026-09-22', draft: prior });
    assert.deepEqual([result.intent, result.draft.startDate, result.draft.startTime, result.draft.endTime, result.draft.licensePlate],
      ['CREATE_BOOKING', '2026-09-23', '19:00', '20:00', '43B20404'], prompt);
  }
  const morning = await interpretBookingMessage({ prompt: 'buổi sáng', today: '2026-09-22',
    draft: { ...prior, startTime: '19:00', endTime: '20:00' } });
  assert.deepEqual([morning.draft.startTime, morning.draft.endTime], ['07:00', '08:00']);
  const unclearAfternoon = await interpretBookingMessage({ prompt: 'buổi chiều', today: '2026-09-22', draft: prior });
  assert.equal(unclearAfternoon.draft.startDate, prior.startDate);
  assert.equal(unclearAfternoon.draft.startTime, '');
  assert.match(unclearAfternoon.clarification, /nói rõ giờ/);
});

test('asking for another vehicle clears only the plate and preserves the booking schedule', async () => {
  const prior = { __intent: 'CREATE_BOOKING', startDate: '2026-09-23', endDate: '2026-09-23',
    startTime: '07:00', endTime: '08:00', licensePlate: '43B20404' };
  const result = await interpretBookingMessage({ prompt: 'xe khác', today: '2026-09-22', draft: prior });
  assert.equal(result.draft.licensePlate, '');
  assert.equal(result.draft.startDate, '2026-09-23');
  assert.equal(result.draft.startTime, '07:00');
  assert.match(result.clarification, /biển số đầy đủ/);
  const replacement = await interpretBookingMessage({ prompt: 'biển số khác là 43C-678.90', today: '2026-09-22', draft: prior });
  assert.equal(replacement.draft.licensePlate, '43C67890');
  assert.equal(replacement.draft.startDate, '2026-09-23');
  assert.equal(replacement.draft.startTime, '07:00');
  const spoken = await interpretBookingMessage({ prompt: 'biển số khác là bốn ba bê hai không bốn không bốn', today: '2026-09-22', draft: prior });
  assert.equal(spoken.draft.licensePlate, '43B20404');
  const spaced = await interpretBookingMessage({ prompt: 'biển số 43 B 204 04', today: '2026-09-22', draft: prior });
  assert.equal(spaced.draft.licensePlate, '43B20404');
  const combined = await interpretBookingMessage({
    prompt: 'Đặt chỗ biển số bốn ba bê hai không bốn không bốn từ 8h đến 9h ngày mai', today: '2026-09-22',
  });
  assert.deepEqual([combined.draft.licensePlate, combined.draft.startTime, combined.draft.endTime], ['43B20404', '08:00', '09:00']);
});

test('a bare spoken replacement plate keeps the VIP booking schedule and distinguishes letters from digits', async () => {
  const prior = {
    __intent: 'CREATE_BOOKING', blockedVipPlate: '43B20404',
    startDate: '2026-09-24', endDate: '2026-09-24', startTime: '08:00', endTime: '20:00',
    requestedVehicleCount: 1, licensePlate: '', licensePlates: [],
  };
  for (const [prompt, plate] of [
    ['bốn ba a năm năm năm năm năm', '43A55555'],
    ['bóng ba bê hai không bốn không bốn', '43B20404'],
    ['bốn ba xê một hai ba bốn năm', '43C12345'],
    ['43 D 678 90', '43D67890'],
  ]) {
    const result = await interpretBookingMessage({ prompt, today: '2026-09-23', draft: prior });
    assert.equal(result.intent, 'CREATE_BOOKING', prompt);
    assert.equal(result.draft.licensePlate, plate, prompt);
    assert.equal(result.draft.startDate, prior.startDate, prompt);
    assert.equal(result.draft.startTime, prior.startTime, prompt);
    assert.equal(result.draft.endTime, prior.endTime, prompt);
  }
});

test('a license plate can be spoken in separate turns without losing the booking context', async () => {
  const prior = {
    __intent: 'CREATE_BOOKING', blockedVipPlate: '43B20404',
    startDate: '2026-09-24', endDate: '2026-09-24', startTime: '08:00', endTime: '20:00',
    requestedVehicleCount: 1, licensePlate: '', licensePlates: [],
  };
  const suffix = await interpretBookingMessage({ prompt: 'A năm năm năm năm năm', today: '2026-09-23', draft: prior });
  assert.equal(suffix.draft.pendingLicensePlate, 'A55555');
  assert.equal(suffix.draft.startDate, prior.startDate);
  assert.match(suffix.clarification, /2 số đầu/);
  const completed = await interpretBookingMessage({
    prompt: 'bốn ba', today: '2026-09-23',
    draft: { ...suffix.draft, blockedVipPlate: prior.blockedVipPlate, __intent: suffix.intent },
  });
  assert.equal(completed.draft.licensePlate, '43A55555');
  assert.equal(completed.draft.pendingLicensePlate, undefined);
  assert.equal(completed.draft.startTime, '08:00');

  const prefix = await interpretBookingMessage({ prompt: 'bốn ba', today: '2026-09-23', draft: prior });
  assert.equal(prefix.draft.pendingLicensePlate, '43');
  const reverseCompleted = await interpretBookingMessage({
    prompt: 'bê hai không bốn không bốn', today: '2026-09-23',
    draft: { ...prefix.draft, blockedVipPlate: prior.blockedVipPlate, __intent: prefix.intent },
  });
  assert.equal(reverseCompleted.draft.licensePlate, '43B20404');
});

test('a raw plate answers the normal missing-vehicle question without requiring the words biển số', async () => {
  const result = await interpretBookingMessage({
    prompt: 'bốn ba a một hai ba bốn năm', today: '2026-09-23',
    draft: { __intent: 'CREATE_BOOKING', startDate: '2026-09-24', endDate: '2026-09-24', startTime: '08:00', endTime: '09:00' },
  });
  assert.equal(result.draft.licensePlate, '43A12345');
  assert.equal(result.draft.startDate, '2026-09-24');
});

test('AI booking rejects a motorcycle-shaped or overlong plate and keeps asking for a valid car plate', async () => {
  const prior = {
    __intent: 'CREATE_BOOKING', startDate: '2026-09-24', endDate: '2026-09-24',
    startTime: '08:00', endTime: '09:00',
  };
  for (const prompt of ['81A123456', 'Sẽ có biển số là 81A123456']) {
    const result = await interpretBookingMessage({ prompt, today: '2026-09-23', draft: prior });
    assert.equal(result.draft.licensePlate, '');
    assert.match(result.clarification, /không hợp lệ|chưa hợp lệ/i);
    assert.match(result.clarification, /43A12345/);
  }
  const valid = await interpretBookingMessage({ prompt: '81A12345', today: '2026-09-23', draft: prior });
  assert.equal(valid.draft.licensePlate, '81A12345');
});

test('an UNKNOWN model follow-up retains the active intent and accumulated draft', () => {
  const result = normalizeInterpretation({ intent: 'UNKNOWN' }, {
    __intent: 'CREATE_BOOKING', startDate: '2026-09-24', startTime: '08:00', endTime: '09:00', licensePlate: '43A12345',
  });
  assert.equal(result.intent, 'CREATE_BOOKING');
  assert.equal(result.draft.startDate, '2026-09-24');
  assert.equal(result.draft.licensePlate, '43A12345');
});

test('multiple vehicles can be supplied together or over a short follow-up', async () => {
  const together = await interpretBookingMessage({
    prompt: 'Đặt 2 xe biển số 43A-123.45 và 43B-204.04 ngày mai từ 8h đến 10h', today: '2026-09-22',
  });
  assert.equal(together.intent, 'CREATE_BOOKING');
  assert.equal(together.draft.requestedVehicleCount, 2);
  assert.deepEqual(together.draft.licensePlates, ['43A12345', '43B20404']);
  assert.equal(together.clarification, undefined);

  const first = await interpretBookingMessage({
    prompt: 'Đặt 2 xe ngày mai từ 8h đến 10h', today: '2026-09-22',
  });
  assert.match(first.clarification, /đủ 2 biển số/);
  const completed = await interpretBookingMessage({
    prompt: '43A-123.45 và 43B-204.04', today: '2026-09-22',
    draft: { ...first.draft, __intent: first.intent },
  });
  assert.deepEqual(completed.draft.licensePlates, ['43A12345', '43B20404']);
  assert.equal(completed.draft.startDate, '2026-09-23');
  assert.equal(completed.clarification, undefined);
});

test('two four-digit plates separated by voice punctuation are retained in one request', async () => {
  for (const plates of [
    '43A5555 và 43B, 4444',
    '43 A 5555 và 43 B 4444',
    '43A-5555 và 43B.4444',
  ]) {
    const result = await interpretBookingMessage({
      prompt: `Đặt 2 xe vào ngày mai, lúc 4 giờ chiều đến 5 giờ chiều biển số ${plates}.`,
      today: '2026-09-23',
      currentTime: '10:00',
    });
    assert.equal(result.intent, 'CREATE_BOOKING', plates);
    assert.equal(result.draft.requestedVehicleCount, 2, plates);
    assert.equal(result.draft.startDate, '2026-09-24', plates);
    assert.equal(result.draft.startTime, '16:00', plates);
    assert.equal(result.draft.endTime, '17:00', plates);
    assert.deepEqual(result.draft.licensePlates, ['43A5555', '43B4444'], plates);
    assert.equal(result.clarification, undefined, plates);
  }
});

test('spoken plates for several vehicles accumulate without losing the schedule or earlier cars', async () => {
  const first = await interpretBookingMessage({
    prompt: 'Đặt 2 xe ngày mai từ 8h đến 10h', today: '2026-09-22',
  });
  const oneCar = await interpretBookingMessage({
    prompt: 'bốn ba a một hai ba bốn năm', today: '2026-09-22',
    draft: { ...first.draft, __intent: first.intent },
  });
  assert.deepEqual(oneCar.draft.licensePlates, ['43A12345']);
  assert.match(oneCar.clarification, /1\/2 biển số/);

  const twoCars = await interpretBookingMessage({
    prompt: 'bốn ba bê hai không bốn không bốn', today: '2026-09-22',
    draft: { ...oneCar.draft, __intent: oneCar.intent },
  });
  assert.deepEqual(twoCars.draft.licensePlates, ['43A12345', '43B20404']);
  assert.equal(twoCars.draft.startDate, '2026-09-23');
  assert.equal(twoCars.draft.startTime, '08:00');
  assert.equal(twoCars.draft.endTime, '10:00');
  assert.equal(twoCars.clarification, undefined);
});

test('several vehicles can keep independent time ranges in one conversation', async () => {
  const common = await interpretBookingMessage({
    prompt: 'Đặt 2 xe ngày mai từ 8 giờ đến 9 giờ', today: '2026-09-23',
  });
  const result = await interpretBookingMessage({
    prompt: 'Xe 1 từ 8 đến 9 giờ, xe 2 từ 10 đến 12 giờ', today: '2026-09-23',
    draft: { ...common.draft, __intent: common.intent },
  });
  assert.deepEqual(result.draft.reservationItems.map((item) => ({
    date: item.startDate, start: item.startTime, end: item.endTime,
  })), [
    { date: '2026-09-24', start: '08:00', end: '09:00' },
    { date: '2026-09-24', start: '10:00', end: '12:00' },
  ]);
  assert.match(result.clarification, /biển số.*từng xe/i);
});

test('two sequential time ranges are assigned in order and later plates fill the matching vehicles', async () => {
  let result = await interpretBookingMessage({
    prompt: 'Tôi muốn đặt 2 xe vào ngày mai.', today: '2026-09-23',
  });
  result = await interpretBookingMessage({
    prompt: 'Từ 8 giờ đến 9 giờ sáng thứ 2 từ 9 giờ tới 10 giờ.', today: '2026-09-23',
    draft: { ...result.draft, __intent: result.intent },
  });
  assert.deepEqual(result.draft.reservationItems.map((item) => [item.startTime, item.endTime]), [
    ['08:00', '09:00'], ['09:00', '10:00'],
  ]);

  result = await interpretBookingMessage({
    prompt: 'Biển số xe thứ nhất 43A555, biển số xe thứ 2 43B44444.', today: '2026-09-23',
    draft: { ...result.draft, __intent: result.intent },
  });
  assert.equal(result.draft.reservationItems[0].licensePlate, '');
  assert.equal(result.draft.reservationItems[1].licensePlate, '43B44444');
  assert.match(result.clarification, /Biển số xe 1 chưa hợp lệ/i);
  assert.equal(result.draft.pendingLicensePlate, '43A555');

  result = await interpretBookingMessage({
    prompt: '5 4 3 2 1', today: '2026-09-23',
    draft: { ...result.draft, __intent: result.intent },
  });
  assert.deepEqual(result.draft.reservationItems.map((item) => item.licensePlate), ['43A54321', '43B44444']);
  assert.deepEqual(result.draft.reservationItems.map((item) => [item.startTime, item.endTime]), [
    ['08:00', '09:00'], ['09:00', '10:00'],
  ]);
  assert.equal(result.clarification, undefined);
});

test('voice can select one vehicle from a multi-booking preview and change only its time', async () => {
  const prior = {
    __intent: 'CREATE_BOOKING', requestedVehicleCount: 2,
    startDate: '2026-09-24', endDate: '2026-09-24',
    reservationItems: [
      { licensePlate: '43B54321', startDate: '2026-09-24', endDate: '2026-09-24', startTime: '19:00', endTime: '20:00' },
      { licensePlate: '43A54321', startDate: '2026-09-24', endDate: '2026-09-24', startTime: '19:00', endTime: '20:00' },
    ],
    licensePlates: ['43B54321', '43A54321'], licensePlate: '43B54321',
  };
  const selected = await interpretBookingMessage({
    prompt: 'Tôi muốn đổi giờ của xe 43A54321.', today: '2026-09-23', draft: prior,
  });
  assert.equal(selected.draft.pendingReservationEditIndex, 1);
  assert.match(selected.clarification, /43A54321.*từ mấy giờ đến mấy giờ/i);

  const changed = await interpretBookingMessage({
    prompt: 'Từ 10 giờ đến 11 giờ.', today: '2026-09-23',
    draft: { ...selected.draft, __intent: selected.intent },
  });
  assert.deepEqual(changed.draft.reservationItems.map((item) => [item.startTime, item.endTime]), [
    ['19:00', '20:00'], ['10:00', '11:00'],
  ]);
  assert.equal(changed.draft.pendingReservationEditIndex, undefined);
  assert.equal(changed.clarification, undefined);
});

test('voice can change a selected vehicle time in one sentence without losing the other item', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Đổi giờ xe thứ 2 từ 10 giờ đến 12 giờ.', today: '2026-09-23',
    draft: {
      __intent: 'CREATE_BOOKING', requestedVehicleCount: 2,
      reservationItems: [
        { licensePlate: '43A12345', startDate: '2026-09-24', endDate: '2026-09-24', startTime: '08:00', endTime: '09:00' },
        { licensePlate: '47A67890', startDate: '2026-09-24', endDate: '2026-09-24', startTime: '09:00', endTime: '10:00' },
      ],
      licensePlates: ['43A12345', '47A67890'], licensePlate: '43A12345',
    },
  });
  assert.deepEqual(result.draft.reservationItems.map((item) => [item.startTime, item.endTime]), [
    ['08:00', '09:00'], ['10:00', '12:00'],
  ]);
  assert.deepEqual(result.draft.licensePlates, ['43A12345', '47A67890']);
});

test('mentioning one existing plate with a new time changes only that car from a shared schedule', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Diển 43a 65432 đặt từ 11 giờ tới 12 giờ cho tôi.', today: '2026-09-23',
    draft: {
      __intent: 'CREATE_BOOKING', requestedVehicleCount: 2,
      startDate: '2026-09-24', endDate: '2026-09-24', startTime: '10:00', endTime: '11:00',
      licensePlates: ['43A12346', '43A65432'], licensePlate: '43A12346',
    },
  });
  assert.deepEqual(result.draft.reservationItems.map((item) => ({
    plate: item.licensePlate, start: item.startTime, end: item.endTime,
  })), [
    { plate: '43A12346', start: '10:00', end: '11:00' },
    { plate: '43A65432', start: '11:00', end: '12:00' },
  ]);
  assert.deepEqual(result.draft.licensePlates, ['43A12346', '43A65432']);
  assert.equal(result.clarification, undefined);
});

test('voice can replace one plate over two turns while preserving both schedules', async () => {
  const prior = {
    __intent: 'CREATE_BOOKING', requestedVehicleCount: 2,
    reservationItems: [
      { licensePlate: '43A12345', startDate: '2026-09-24', endDate: '2026-09-24', startTime: '08:00', endTime: '09:00' },
      { licensePlate: '47A67890', startDate: '2026-09-24', endDate: '2026-09-24', startTime: '10:00', endTime: '11:00' },
    ],
    licensePlates: ['43A12345', '47A67890'], licensePlate: '43A12345',
  };
  const selected = await interpretBookingMessage({
    prompt: 'Đổi biển số xe thứ nhất.', today: '2026-09-23', draft: prior,
  });
  assert.equal(selected.draft.pendingReservationEditIndex, 0);
  assert.match(selected.clarification, /sang biển số nào/i);

  const changed = await interpretBookingMessage({
    prompt: '43B54321', today: '2026-09-23',
    draft: { ...selected.draft, __intent: selected.intent },
  });
  assert.deepEqual(changed.draft.reservationItems.map((item) => item.licensePlate), ['43B54321', '47A67890']);
  assert.deepEqual(changed.draft.reservationItems.map((item) => [item.startTime, item.endTime]), [
    ['08:00', '09:00'], ['10:00', '11:00'],
  ]);
});

test('several vehicles can keep independent dates and later receive plates in order', async () => {
  const schedules = await interpretBookingMessage({
    prompt: 'Đặt 2 xe. Xe 1 ngày mai từ 8 đến 9 giờ, xe 2 ngày mốt từ 9 đến 11 giờ', today: '2026-09-23',
  });
  assert.deepEqual(schedules.draft.reservationItems.map((item) => [item.startDate, item.startTime, item.endTime]), [
    ['2026-09-24', '08:00', '09:00'],
    ['2026-09-25', '09:00', '11:00'],
  ]);
  const firstPlate = await interpretBookingMessage({
    prompt: 'bốn ba a một hai ba bốn năm', today: '2026-09-23',
    draft: { ...schedules.draft, __intent: schedules.intent },
  });
  const completed = await interpretBookingMessage({
    prompt: 'bốn bảy a sáu bảy tám chín không', today: '2026-09-23',
    draft: { ...firstPlate.draft, __intent: firstPlate.intent },
  });
  assert.deepEqual(completed.draft.reservationItems.map((item) => item.licensePlate), ['43A12345', '47A67890']);
  assert.deepEqual(completed.draft.reservationItems.map((item) => item.startDate), ['2026-09-24', '2026-09-25']);
  assert.equal(completed.clarification, undefined);
});

test('an unspecified multiple-vehicle request asks for quantity and plates while retaining its schedule', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Đặt cho nhiều xe ngày mai từ 8h đến 10h', today: '2026-09-22',
  });
  assert.equal(result.draft.startDate, '2026-09-23');
  assert.equal(result.draft.startTime, '08:00');
  assert.match(result.clarification, /bao nhiêu xe.*biển số/);
});

test('vehicle quantity is data-driven up to the current five-item booking limit', async () => {
  for (const count of [3, 4, 5]) {
    const result = await interpretBookingMessage({
      prompt: `Đặt ${count} xe ngày mai từ 8 giờ đến 9 giờ`, today: '2026-09-23',
    });
    assert.equal(result.draft.requestedVehicleCount, count);
    assert.equal(result.draft.startTime, '08:00');
    assert.match(result.clarification, new RegExp(`đủ ${count} biển số`));
  }
});

test('an incomplete two-vehicle request stays in quick booking and asks for the shared time', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Tôi muốn đặt 2 xe vào ngày mai.', today: '2026-09-23',
  });
  assert.equal(result.intent, 'CREATE_BOOKING');
  assert.equal(result.draft.requestedVehicleCount, 2);
  assert.equal(result.draft.startDate, '2026-09-24');
  assert.equal(result.draft.endDate, '2026-09-24');
  assert.equal(result.draft.startTime, '');
  assert.doesNotMatch(result.clarification, /Đặt chỗ thủ công/);
  assert.match(result.clarification, /từ mấy giờ đến mấy giờ/);

  const withTime = await interpretBookingMessage({
    prompt: 'Từ 8 giờ đến 9 giờ.', today: '2026-09-23',
    draft: { ...result.draft, __intent: result.intent },
  });
  assert.equal(withTime.draft.startDate, '2026-09-24');
  assert.equal(withTime.draft.startTime, '08:00');
  assert.equal(withTime.draft.endTime, '09:00');
  assert.equal(withTime.draft.requestedVehicleCount, 2);
  assert.match(withTime.clarification, /2 biển số/i);

  const withPlates = await interpretBookingMessage({
    prompt: '43A-12345 và 47A-67890', today: '2026-09-23',
    draft: { ...withTime.draft, __intent: withTime.intent },
  });
  assert.deepEqual(withPlates.draft.licensePlates, ['43A12345', '47A67890']);
  assert.equal(withPlates.draft.startDate, '2026-09-24');
  assert.equal(withPlates.draft.startTime, '08:00');
  assert.equal(withPlates.draft.endTime, '09:00');
  assert.equal(withPlates.clarification, undefined);
});

test('asking to book another vehicle switches from viewing to creation and keeps the stated schedule', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Cho một xe khác', today: '2026-09-22',
    draft: { __intent: 'VIEW_BOOKING', startDate: '2026-09-23', endDate: '2026-09-23', startTime: '07:00', endTime: '08:00', licensePlate: '43A12345' },
  });
  assert.equal(result.intent, 'CREATE_BOOKING');
  assert.equal(result.draft.startDate, '2026-09-23');
  assert.equal(result.draft.startTime, '07:00');
  assert.equal(result.draft.licensePlate, '');
  assert.match(result.clarification, /biển số đầy đủ/);
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

test('duration before the arrival time is understood without asking for the end time again', async () => {
  for (const prompt of [
    'Đặt cho tôi 3 tiếng từ 2 giờ chiều',
    'Đỗ ba tiếng bắt đầu lúc hai giờ chiều',
    'Đặt từ 2 giờ chiều, kéo dài 3 tiếng',
  ]) {
    const result = await interpretBookingMessage({ prompt, today: '2026-09-27' });
    assert.equal(result.intent, 'CREATE_BOOKING', prompt);
    assert.equal(result.draft.startDate, '', prompt);
    assert.equal(result.draft.startTime, '14:00', prompt);
    assert.equal(result.draft.endTime, '17:00', prompt);
    assert.doesNotMatch(result.clarification || '', /từ mấy giờ đến mấy giờ/i, prompt);
  }
});

test('relative arrival phrases use the current Vietnam time and do not become parking duration', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Tôi cần đậu xe trong 30 phút nữa.',
    today: '2026-09-23',
    currentTime: '13:40',
  });
  assert.equal(result.intent, 'CREATE_BOOKING');
  assert.equal(result.draft.startDate, '2026-09-23');
  assert.equal(result.draft.endDate, '2026-09-23');
  assert.equal(result.draft.startTime, '14:10');
  assert.equal(result.draft.endTime, '');

  const afterMidnight = await interpretBookingMessage({
    prompt: 'Sau 30 phút tôi cần đậu xe.',
    today: '2026-09-23',
    currentTime: '23:50',
  });
  assert.equal(afterMidnight.draft.startDate, '2026-09-24');
  assert.equal(afterMidnight.draft.startTime, '00:20');

  const durationOnly = await interpretBookingMessage({
    prompt: 'Tôi cần đậu xe trong 30 phút.',
    today: '2026-09-23',
    currentTime: '13:40',
  });
  assert.equal(durationOnly.draft.startDate, '');
  assert.equal(durationOnly.draft.startTime, '');
  assert.equal(durationOnly.draft.endTime, '');
});

test('quick booking rejects recently elapsed dates and elapsed hours today', async () => {
  const pastDate = await interpretBookingMessage({
    prompt: 'Muốn đặt 2 xe vào ngày 18 tháng chín.',
    today: '2026-09-23',
    currentTime: '14:00',
  });
  assert.equal(pastDate.intent, 'CREATE_BOOKING');
  assert.equal(pastDate.draft.startDate, '');
  assert.equal(pastDate.draft.endDate, '');
  assert.equal(pastDate.draft.requestedVehicleCount, 2);
  assert.match(pastDate.clarification, /18\/09\/2026.*đã qua/);
  assert.doesNotMatch(pastDate.clarification, /biển số|mấy giờ/i);

  const pastHour = await interpretBookingMessage({
    prompt: 'Đặt 2 xe hôm nay từ 8 giờ đến 9 giờ.',
    today: '2026-09-23',
    currentTime: '14:00',
  });
  assert.equal(pastHour.draft.startDate, '2026-09-23');
  assert.equal(pastHour.draft.startTime, '');
  assert.equal(pastHour.draft.endTime, '');
  assert.match(pastHour.clarification, /08:00.*hôm nay đã qua.*sau 14:00/);
  assert.doesNotMatch(pastHour.clarification, /biển số/i);
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

test('local parser does not silently ignore unavailable service or recurring requirements', () => {
  const { parseBasicVietnameseBooking } = require('../services/aiBookingInterpreter');
  for (const prompt of [
    'Đặt xe điện có sạc ngày mai từ 19h đến 20h',
    'Đặt chỗ mỗi ngày từ 19h đến 20h',
    'Mai 19h đến 20h ở khu A',
    'Kiểm tra còn chỗ ngày mai từ 19h đến 20h không?',
    'Không muốn đặt chỗ ngày mai từ 19h đến 20h',
  ]) assert.equal(parseBasicVietnameseBooking(prompt, '2026-09-12'), null, prompt);
  assert.equal(parseBasicVietnameseBooking('từ 19h đến 20h', '2026-09-12', { __intent: 'CHECK_AVAILABILITY', startDate: '2026-09-13' }), null);
});

test('manual-only and motorbike requests do not produce an incomplete booking preview', async () => {
  for (const prompt of [
    'Đặt xe điện có sạc ngày mai từ 19h đến 20h',
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
