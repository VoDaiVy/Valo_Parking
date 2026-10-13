const test = require('node:test');
const assert = require('node:assert/strict');
const { detectBookingLanguage } = require('../services/aiBookingLanguage');
const { interpretBookingMessage } = require('../services/aiBookingInterpreter');
const { toEnglishBookingMessage, vietnameseMarker } = require('../services/aiBookingReplyLanguage');

test('detects Vietnamese, English, mixed utterances, and keeps context for short replies', () => {
  assert.equal(detectBookingLanguage('Tôi muốn đặt chỗ ngày mai').language, 'vi');
  assert.equal(detectBookingLanguage('I would like to book a parking spot tomorrow').language, 'en');
  assert.equal(detectBookingLanguage('Tôi want to book a parking spot tomorrow', 'vi').language, 'en');
  assert.equal(detectBookingLanguage('43A12345', 'en').language, 'en');
  assert.equal(detectBookingLanguage('OK', 'vi').language, 'vi');
});

test('English booking is parsed locally with dates, AM/PM, duration, and spoken plate', async () => {
  const range = await interpretBookingMessage({
    prompt: 'Book a parking spot tomorrow from 7 PM to 9 PM for car 43A12345',
    today: '2026-10-02', currentTime: '10:00',
  });
  assert.equal(range.language, 'en');
  assert.equal(range.intent, 'CREATE_BOOKING');
  assert.deepEqual(
    [range.draft.startDate, range.draft.startTime, range.draft.endTime, range.draft.licensePlate],
    ['2026-10-03', '19:00', '21:00', '43A12345'],
  );

  const duration = await interpretBookingMessage({
    prompt: 'Tomorrow at 8 AM for two hours, license plate four three alpha one two three four five',
    today: '2026-10-02', currentTime: '10:00', draft: { __language: 'en' },
  });
  assert.deepEqual(
    [duration.draft.startTime, duration.draft.endTime, duration.draft.licensePlate],
    ['08:00', '10:00', '43A12345'],
  );

  const conversationalDuration = await interpretBookingMessage({
    prompt: 'I will be parking tomorrow at 8 AM for about a couple of hours, plate 43A12345',
    today: '2026-10-02', currentTime: '10:00',
  });
  assert.equal(conversationalDuration.draft.endTime, '10:00');
});

test('English browser voice misrecognitions still enter the intended booking flow', async () => {
  const screenshotCase = await interpretBookingMessage({
    prompt: 'I nick Bookwonder.', today: '2026-10-08', currentTime: '17:00',
    draft: { __language: 'en' },
  });
  assert.equal(screenshotCase.intent, 'CREATE_BOOKING');
  assert.equal(screenshotCase.language, 'en');

  const complete = await interpretBookingMessage({
    prompt: 'I one to book a parking spice to morrow at 8 AM for too hours',
    today: '2026-10-08', currentTime: '17:00', draft: { __language: 'en' },
  });
  assert.deepEqual(
    [complete.draft.startDate, complete.draft.startTime, complete.draft.endTime],
    ['2026-10-09', '08:00', '10:00'],
  );
});

test('English voice keeps bare time pairs joined by and across the license-plate follow-up', async () => {
  const booking = await interpretBookingMessage({
    prompt: 'I can book one car tomorrow, 5:00 AM and 9:00 AM.',
    today: '2026-10-08', currentTime: '17:00', draft: { __language: 'en' },
  });
  assert.deepEqual(
    [booking.draft.startDate, booking.draft.endDate, booking.draft.startTime, booking.draft.endTime],
    ['2026-10-09', '2026-10-09', '05:00', '09:00'],
  );
  assert.match(booking.clarification, /license plate/i);
  assert.doesNotMatch(booking.clarification, /arrival time|departure time/i);

  const withPlate = await interpretBookingMessage({
    prompt: '44 C 1234.', today: '2026-10-08', currentTime: '17:00',
    draft: { ...booking.draft, __intent: booking.intent, __language: 'en' },
  });
  assert.deepEqual(
    [withPlate.draft.startDate, withPlate.draft.startTime, withPlate.draft.endTime, withPlate.draft.licensePlate],
    ['2026-10-09', '05:00', '09:00', '44C1234'],
  );
  assert.doesNotMatch(withPlate.clarification || '', /arrival time|departure time/i);

  const correctedTimes = await interpretBookingMessage({
    prompt: '9:00 AM and 10:00 AM.', today: '2026-10-08', currentTime: '17:00',
    draft: {
      ...withPlate.draft,
      __intent: 'CREATE_BOOKING', __language: 'en',
      startTime: '', endTime: '',
    },
  });
  assert.deepEqual(
    [correctedTimes.draft.startTime, correctedTimes.draft.endTime, correctedTimes.draft.licensePlate],
    ['09:00', '10:00', '44C1234'],
  );
  assert.doesNotMatch(correctedTimes.clarification || '', /arrival time|departure time/i);
});

test('Vietnamese bãi wording selects a new slot and clears the stale inherited floor', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Tôi muốn đặt bãi E7 vào ngày mai lúc 8 giờ đến 9 giờ.',
    today: '2026-10-08', currentTime: '10:00',
    draft: {
      __intent: 'CREATE_BOOKING', __language: 'vi',
      floorName: 'Floor 2', slotCode: 'A-015',
    },
  });
  assert.deepEqual(
    [result.draft.startDate, result.draft.startTime, result.draft.endTime],
    ['2026-10-09', '08:00', '09:00'],
  );
  assert.equal(result.draft.slotCode, 'E7');
  assert.equal(result.draft.floorName, '');

  for (const prompt of [
    'Đặt chỗ E7 ngày mai từ 8 giờ đến 9 giờ',
    'Đặt vị trí E7 ngày mai từ 8 giờ đến 9 giờ',
  ]) {
    const variant = await interpretBookingMessage({ prompt, today: '2026-10-08', currentTime: '10:00' });
    assert.equal(variant.draft.slotCode, 'E7', prompt);
  }
});

test('English month names, follow-up correction, and approximate time clarification retain context', async () => {
  const initial = await interpretBookingMessage({
    prompt: 'Reserve parking on October fifth from 7:30 AM to 10 AM for 43A12345',
    today: '2026-10-02', currentTime: '10:00',
  });
  assert.equal(initial.draft.startDate, '2026-10-05');
  const correction = await interpretBookingMessage({
    prompt: 'Actually change the time to 9 AM to 11 AM',
    today: '2026-10-02', currentTime: '10:00',
    draft: { ...initial.draft, __intent: 'CREATE_BOOKING', __language: 'en' },
  });
  assert.equal(correction.draft.startDate, '2026-10-05');
  assert.equal(correction.draft.startTime, '09:00');
  assert.equal(correction.draft.endTime, '11:00');

  const approximate = await interpretBookingMessage({
    prompt: 'Book tomorrow around 7 PM', today: '2026-10-02', currentTime: '10:00',
  });
  assert.match(approximate.clarification, /exact time/i);
});

test('partial license-plate follow-ups never fall back to Vietnamese in an English session', async () => {
  const partial = await interpretBookingMessage({
    prompt: '12345', today: '2026-10-02', currentTime: '08:00',
    draft: { __intent: 'CREATE_BOOKING', __language: 'en', startTime: '09:00' },
  });
  assert.equal(partial.language, 'en');
  assert.equal(partial.draft.pendingLicensePlate, '12345');
  assert.equal(partial.clarification, 'I recorded 12345. Please provide the rest of the license plate.');
  assert.equal(vietnameseMarker.test(partial.clarification), false);

  const completed = await interpretBookingMessage({
    prompt: '45-A12345', today: '2026-10-02', currentTime: '08:00',
    draft: { ...partial.draft, __intent: 'CREATE_BOOKING', __language: 'en' },
  });
  assert.equal(completed.draft.licensePlate, '45A12345');
  assert.equal(vietnameseMarker.test(completed.clarification || ''), false);
});

test('English voice plate homophones are decoded as one plate instead of a vehicle count', async () => {
  const voiceResult = await interpretBookingMessage({
    prompt: 'For for a want to chi for fire for fire I want to chi for fire.',
    today: '2026-10-02', currentTime: '08:00',
    draft: {
      __intent: 'CREATE_BOOKING', __language: 'en',
      startDate: '2026-10-03', endDate: '2026-10-03', startTime: '09:00', endTime: '10:00',
    },
  });
  assert.equal(voiceResult.language, 'en');
  assert.equal(voiceResult.draft.licensePlate, '44A12345');
  assert.deepEqual(voiceResult.draft.licensePlates, ['44A12345']);
  assert.equal(voiceResult.draft.requestedVehicleCount, undefined);
  assert.equal(voiceResult.clarification || '', '');
});

test('canonical and common English speech-recognition plate words produce the same plate', async () => {
  const prompts = [
    'four four alpha one two three four five',
    'four four ay won too tree fore fire',
    '44 a one two three four five',
  ];
  for (const prompt of prompts) {
    const result = await interpretBookingMessage({
      prompt, today: '2026-10-02', currentTime: '08:00',
      draft: { __intent: 'CREATE_BOOKING', __language: 'en' },
    });
    assert.equal(result.draft.licensePlate, '44A12345', prompt);
    assert.equal(result.draft.requestedVehicleCount, undefined, prompt);
  }
});

test('English voice keeps numeric plate parts and asks only for a misheard A, B, or C letter', async () => {
  const cases = [
    { heard: '481122', pending: '48_1122', letter: 'Alpha', plate: '48A1122' },
    { heard: '4931122', pending: '49_1122', letter: 'letter Charlie', plate: '49C1122' },
  ];
  for (const sample of cases) {
    const ambiguous = await interpretBookingMessage({
      prompt: sample.heard, today: '2026-10-02', currentTime: '08:00',
      draft: { __intent: 'CREATE_BOOKING', __language: 'en' },
    });
    assert.equal(ambiguous.draft.pendingLicensePlate, sample.pending);
    assert.match(ambiguous.clarification, /Alpha, Bravo, Charlie/);
    assert.equal(vietnameseMarker.test(ambiguous.clarification), false);

    const completed = await interpretBookingMessage({
      prompt: sample.letter, today: '2026-10-02', currentTime: '08:00',
      draft: { ...ambiguous.draft, __intent: 'CREATE_BOOKING', __language: 'en' },
    });
    assert.equal(completed.draft.licensePlate, sample.plate);
    assert.equal(completed.draft.pendingLicensePlate, undefined);
  }
});

test('every Vietnamese parser clarification has an English-only fallback', () => {
  const vietnameseCases = [
    'Mình đã ghi 12345. Hãy đọc tiếp phần còn lại của biển số.',
    'Biển số chưa hợp lệ. Hãy đọc lại biển số đầy đủ của ô tô.',
    'Bạn muốn đổi giờ vào và giờ ra thành mấy giờ?',
    'Bạn muốn đổi sang ngày nào?',
    'Bạn muốn sửa xe nào? Hãy nói số thứ tự hoặc biển số xe.',
    'Bạn muốn sửa thông tin nào của xe 43A11111?',
    'Bạn muốn đổi giờ của xe 43A11111 thành từ mấy giờ đến mấy giờ?',
    'Bạn muốn đổi xe 43A11111 sang biển số nào?',
    'Bạn muốn đổi xe 43A11111 sang ô đỗ nào?',
    'Bạn muốn đổi xe 43A11111 sang tầng nào?',
    'Biển số đúng là gì?',
    'Bạn muốn ngày đó trong tháng nào?',
    'Bạn muốn chính xác mấy giờ?',
    'Giờ ra cần sau giờ vào trong cùng ngày. Bạn muốn đổi lại khoảng giờ nào?',
    'Bạn muốn đặt 2 xe. Vui lòng đọc đủ 2 biển số.',
    'Bạn muốn tầng nào? Hãy ghi rõ số hoặc tên tầng.',
    'Thời lượng đặt chỗ phải tối thiểu 30 phút.',
  ];
  for (const message of vietnameseCases) {
    const translated = toEnglishBookingMessage(message);
    assert.equal(vietnameseMarker.test(translated), false, `${message} -> ${translated}`);
    assert.match(translated, /[a-z]/i);
  }
});

test('multi-vehicle edit prompts are translated with the selected vehicle intact', () => {
  assert.equal(
    toEnglishBookingMessage('Bạn muốn sửa xe nào? Hãy nói số thứ tự hoặc biển số xe.'),
    'Which vehicle would you like to edit? Please say its position or license plate.',
  );
  assert.equal(
    toEnglishBookingMessage('Bạn muốn đổi xe 43A11111 sang ô đỗ nào?'),
    'Which parking slot should vehicle 43A11111 use instead?',
  );
  assert.equal(
    toEnglishBookingMessage('Bạn muốn đổi giờ của xe 43A11111 thành từ mấy giờ đến mấy giờ?'),
    'What arrival and departure times should vehicle 43A11111 use instead?',
  );
});

test('short slot replies replace a stale requested slot and release an inherited floor', async () => {
  const previous = {
    __intent: 'CREATE_BOOKING', __language: 'vi', startDate: '2026-10-08', endDate: '2026-10-08',
    startTime: '08:00', endTime: '09:00', licensePlate: '43B20404', floorName: 'tầng 1', slotCode: 'A6',
  };
  for (const prompt of ['Cho tôi E6', 'lấy ô E6', 'E6']) {
    const result = await interpretBookingMessage({ prompt, today: '2026-10-07', draft: previous });
    assert.equal(result.draft.slotCode, 'E6', prompt);
    assert.equal(result.draft.floorName, '', prompt);
    assert.equal(result.draft.startTime, '08:00', prompt);
  }
  const english = await interpretBookingMessage({
    prompt: "I'll take E10", today: '2026-10-07', draft: { ...previous, __language: 'en' },
  });
  assert.equal(english.draft.slotCode, 'E10');
  assert.equal(english.language, 'en');
});

test('natural English date, clock, and duration variants are normalized locally', async () => {
  const relative = await interpretBookingMessage({
    prompt: 'I need somewhere to park in two days at half past eight AM for 90 minutes',
    today: '2026-10-07', currentTime: '10:00',
  });
  assert.deepEqual(
    [relative.draft.startDate, relative.draft.endDate, relative.draft.startTime, relative.draft.endTime],
    ['2026-10-09', '2026-10-09', '08:30', '10:00'],
  );

  const range = await interpretBookingMessage({
    prompt: 'Reserve from Monday to Wednesday, from quarter past eight AM until quarter to ten AM',
    today: '2026-10-07', currentTime: '10:00',
  });
  assert.deepEqual(
    [range.draft.startDate, range.draft.endDate, range.draft.startTime, range.draft.endTime],
    ['2026-10-12', '2026-10-14', '08:15', '09:45'],
  );

  const ambiguous = await interpretBookingMessage({
    prompt: 'Can you save me a spot in a few days?', today: '2026-10-07', currentTime: '10:00',
  });
  assert.match(ambiguous.clarification, /exact date/i);
});

test('natural English vehicle quantities include both cars and another car', async () => {
  const both = await interpretBookingMessage({
    prompt: 'Book parking for both cars tomorrow from 8 AM to 9 AM',
    today: '2026-10-07', currentTime: '10:00',
  });
  assert.equal(both.draft.requestedVehicleCount, 2);
  const another = await interpretBookingMessage({
    prompt: 'Add another car', today: '2026-10-07', currentTime: '10:00',
    draft: { ...both.draft, __intent: 'CREATE_BOOKING', __language: 'en', requestedVehicleCount: 2 },
  });
  assert.equal(another.draft.requestedVehicleCount, 3);
});

test('Vietnamese natural durations are continuous and vague dates or times are never guessed', async () => {
  const previous = {
    __intent: 'CREATE_BOOKING', startDate: '2026-10-08', endDate: '2026-10-08',
    startTime: '08:00', endTime: '', licensePlate: '43A12345',
  };
  const halfHour = await interpretBookingMessage({ prompt: 'nửa tiếng', today: '2026-10-07', draft: previous });
  assert.equal(halfHour.draft.endTime, '08:30');
  const threeDays = await interpretBookingMessage({ prompt: 'à, đặt 3 ngày nhé', today: '2026-10-07', draft: previous });
  assert.deepEqual([threeDays.draft.endDate, threeDays.draft.endTime], ['2026-10-11', '08:00']);
  const week = await interpretBookingMessage({ prompt: 'một tuần', today: '2026-10-07', draft: previous });
  assert.deepEqual([week.draft.endDate, week.draft.endTime], ['2026-10-15', '08:00']);

  const vagueTime = await interpretBookingMessage({ prompt: 'tầm 8 giờ', today: '2026-10-07', draft: previous });
  assert.match(vagueTime.clarification, /chính xác mấy giờ/);
  assert.equal(vagueTime.draft.startTime, '');
  const vagueDate = await interpretBookingMessage({ prompt: 'vài ngày nữa', today: '2026-10-07', draft: previous });
  assert.match(vagueDate.clarification, /chính xác ngày/);
  assert.equal(vagueDate.draft.startDate, '');
});

test('next week, next month, ordinal dates, and next-month ranges resolve without Gemini', async () => {
  const cases = [
    ['Đặt chỗ 2 ngày nữa từ 8h đến 9h', ['2026-10-09', '2026-10-09'], ['08:00', '09:00']],
    ['Đặt ngày 5 tháng sau từ 8h đến 9h', ['2026-11-05', '2026-11-05'], ['08:00', '09:00']],
    ['Đặt từ ngày 5 đến ngày 8 tháng sau, từ 8h đến 9h', ['2026-11-05', '2026-11-08'], ['08:00', '09:00']],
    ['Đặt tuần tới từ 8h đến 9h', ['2026-10-12', '2026-10-12'], ['08:00', '09:00']],
    ['Đặt cả cuối tuần sau từ 8h đến 9h', ['2026-10-17', '2026-10-18'], ['08:00', '09:00']],
    ['Book next month from 8 AM to 9 AM', ['2026-11-01', '2026-11-01'], ['08:00', '09:00']],
    ['Book on the 5th from noon to 1 PM', ['2026-11-05', '2026-11-05'], ['12:00', '13:00']],
  ];
  for (const [prompt, expectedDates, expectedTimes] of cases) {
    const result = await interpretBookingMessage({ prompt, today: '2026-10-07', currentTime: '10:00' });
    assert.deepEqual([result.draft.startDate, result.draft.endDate], expectedDates, prompt);
    assert.deepEqual([result.draft.startTime, result.draft.endTime], expectedTimes, prompt);
  }
});

test('English tonight phrases retain the date and use evening or midnight hours', async () => {
  const cases = [
    ['Book tonight at 8 for two hours', ['2026-10-07', '2026-10-07'], ['20:00', '22:00']],
    ['Book at 8 tonight for two hours', ['2026-10-07', '2026-10-07'], ['20:00', '22:00']],
    ['Book tomorrow night at 8 for two hours', ['2026-10-08', '2026-10-08'], ['20:00', '22:00']],
    ['Book at 12 tonight for one hour', ['2026-10-08', '2026-10-08'], ['00:00', '01:00']],
    ['Book tonight at 7:30 for two hours', ['2026-10-07', '2026-10-07'], ['19:30', '21:30']],
    ['Book tonight at half past eight for two hours', ['2026-10-07', '2026-10-07'], ['20:30', '22:30']],
    ['Book tonight at quarter past eight for one hour', ['2026-10-07', '2026-10-07'], ['20:15', '21:15']],
    ['Book tonight at quarter to one for one hour', ['2026-10-08', '2026-10-08'], ['00:45', '01:45']],
    ['Book tomorrow evening at 8 for one hour', ['2026-10-08', '2026-10-08'], ['20:00', '21:00']],
    ['Book next Friday night at 8 for one hour', ['2026-10-09', '2026-10-09'], ['20:00', '21:00']],
    ['Book tomorrow night at 12 for one hour', ['2026-10-09', '2026-10-09'], ['00:00', '01:00']],
  ];
  for (const [prompt, expectedDates, expectedTimes] of cases) {
    const result = await interpretBookingMessage({ prompt, today: '2026-10-07', currentTime: '10:00' });
    assert.deepEqual([result.draft.startDate, result.draft.endDate], expectedDates, prompt);
    assert.deepEqual([result.draft.startTime, result.draft.endTime], expectedTimes, prompt);
  }
});

test('English relative arrival and multi-day duration can be used in the same request', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Book in two days for three days from 8 AM',
    today: '2026-10-07',
    currentTime: '10:00',
  });
  assert.deepEqual(
    [result.draft.startDate, result.draft.startTime, result.draft.endDate, result.draft.endTime],
    ['2026-10-09', '08:00', '2026-10-12', '08:00'],
  );
});

test('English compound durations and overnight ranges preserve every stated unit', async () => {
  const compound = await interpretBookingMessage({
    prompt: 'Book in two days for one day and two hours from 8 AM',
    today: '2026-10-07', currentTime: '10:00',
  });
  assert.deepEqual(
    [compound.draft.startDate, compound.draft.startTime, compound.draft.endDate, compound.draft.endTime],
    ['2026-10-09', '08:00', '2026-10-10', '10:00'],
  );

  const hoursAndMinutes = await interpretBookingMessage({
    prompt: 'Book tomorrow from 8 AM for two hours and 30 minutes',
    today: '2026-10-07', currentTime: '10:00',
  });
  assert.deepEqual([hoursAndMinutes.draft.endDate, hoursAndMinutes.draft.endTime], ['2026-10-08', '10:30']);

  const overnight = await interpretBookingMessage({
    prompt: 'Book tonight from 11 PM to 1 AM',
    today: '2026-10-07', currentTime: '10:00',
  });
  assert.deepEqual(
    [overnight.draft.startDate, overnight.draft.startTime, overnight.draft.endDate, overnight.draft.endTime],
    ['2026-10-07', '23:00', '2026-10-08', '01:00'],
  );
  assert.equal(overnight.clarification, undefined);

  const overnightFollowUp = await interpretBookingMessage({
    prompt: 'From 11 PM to 1 AM',
    today: '2026-10-07', currentTime: '10:00',
    draft: {
      __intent: 'CREATE_BOOKING',
      startDate: '2026-10-08', endDate: '2026-10-08',
    },
  });
  assert.deepEqual(
    [overnightFollowUp.draft.startDate, overnightFollowUp.draft.startTime,
      overnightFollowUp.draft.endDate, overnightFollowUp.draft.endTime],
    ['2026-10-08', '23:00', '2026-10-09', '01:00'],
  );
  assert.equal(overnightFollowUp.clarification, undefined);
});

test('Vietnamese fractional day duration uses half of the stated unit', async () => {
  const result = await interpretBookingMessage({
    prompt: 'Đặt ngày mai lúc 8 giờ trong 1 ngày rưỡi',
    today: '2026-10-07', currentTime: '10:00',
  });
  assert.deepEqual(
    [result.draft.startDate, result.draft.startTime, result.draft.endDate, result.draft.endTime],
    ['2026-10-08', '08:00', '2026-10-09', '20:00'],
  );
});
