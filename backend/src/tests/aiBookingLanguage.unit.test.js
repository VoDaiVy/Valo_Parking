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
