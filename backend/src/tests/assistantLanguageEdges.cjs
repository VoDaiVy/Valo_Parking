const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GEMINI_API_KEY = ''; // Keep this isolated test worker offline.
const { detectBookingLanguage } = require('../services/aiBookingLanguage');
const { interpretBookingMessage, parseBasicVietnameseBooking } = require('../services/aiBookingInterpreter');
const { parseBookingUtterance } = require('../services/bookingUtteranceParser');
const { transcribeBookingAudio } = require('../services/aiBookingSpeech');
const { protectBookingReplyFacts, localizeBookingReply } = require('../services/aiBookingLocalization');

// Isolated inputs only: never open a database, microphone or external model.
const facts = { startDate: '2027-11-20', endDate: '2027-11-20', startTime: '08:00', endTime: '09:00', licensePlate: '43A11111', __intent: 'CREATE_BOOKING' };
const interpret = (prompt, draft) => {
  const local = parseBasicVietnameseBooking(prompt, '2027-11-10', draft, '07:00', detectBookingLanguage(prompt, draft.__language).language);
  return interpretBookingMessage({ prompt, draft, today: '2027-11-10', currentTime: '07:00', ...(local ? {} : { generateText: async () => { throw new Error('Unexpected model fallback'); } }) });
};

test('1. continuous language switches preserve unchanged booking facts', async () => {
  let draft = { ...facts, __language: 'vi' };
  for (const [text, language, time] of [['change end time to 10am', 'en', '10:00'], ['đổi giờ ra 11h', 'vi', '11:00'], ['change end time to 12pm', 'en', '12:00'], ['đổi giờ ra 13h', 'vi', '13:00']]) {
    const result = await interpret(text, draft);
    assert.equal(result.language, language, text); assert.equal(result.draft.endTime, time, text);
    for (const field of ['licensePlate', 'startDate', 'startTime']) assert.equal(result.draft[field], facts[field]);
    draft = { ...result.draft, __intent: result.intent };
  }
});
test('2/5. mixed language and dialects retain English times and Vietnamese dates in either locale', () => {
  for (const language of ['en', 'vi']) for (const text of ['book xe ngày mai from 8am to 9am biển số 43A11111', 'tui muốn đậu xe ngày mai from 8am to 9am']) {
    const result = parseBookingUtterance(text, '2027-11-10', {}, '07:00', language);
    assert.equal(result.changes.startDate, '2027-11-11', text); assert.equal(result.changes.startTime, '08:00', text); assert.equal(result.changes.endTime, '09:00', text);
  }
  const mixed = parseBasicVietnameseBooking('change giờ vào thành 10h', '2027-11-10', facts, '07:00', 'vi');
  assert.equal(mixed.draft.startTime, '10:00'); assert.equal(mixed.draft.licensePlate, facts.licensePlate);
});
test('3. short neutral facts retain prior language; clear replies can change language', () => {
  for (const prior of ['vi', 'en']) for (const text of ['A 1', '43 A 11111', '43a-111.11', '08:00', '8h30', '100.000 VND', '20/11/2027', 'ok', '...']) assert.equal(detectBookingLanguage(text, prior).language, prior, text);
  assert.equal(detectBookingLanguage('yes', 'vi').language, 'en'); assert.equal(detectBookingLanguage('đồng ý', 'en').language, 'vi');
});
test('4. nonexistent dates and times are rejected without changing the existing booking', async () => {
  for (const text of ['đặt xe từ ngày 20/11 đến 32/11', 'book on 31/02/2027 at 8am', 'đổi giờ ra 25h', 'change end time to 09:75']) {
    const result = await interpret(text, { ...facts, __language: 'en' });
    assert.ok(result.clarification, text); assert.equal(result.draft.startDate, facts.startDate); assert.equal(result.draft.endTime, facts.endTime);
  }
});
test('4. protect complete formatted plates, identifiers, dates, clocks and signed monetary values', () => {
  const protectedFacts = protectBookingReplyFacts('Xe 43a-111.11, ô A-015, 20/11/2027 08:30: -100.000 VND, +25.50 USD').facts;
  for (const value of ['43a-111.11', 'A-015', '20/11/2027', '08:30', '-100.000 VND', '+25.50 USD']) assert.ok(protectedFacts.some(({ fact }) => fact === value), value);
});
test('4. translation preserves facts and rejects fact reordering or invented digits', async () => {
  const source = 'A vehicle has 43a-111.11 and costs -100.000 VND.';
  const valid = await localizeBookingReply(source, 'vi', async () => ({ text: 'Xe có __FACT_0__ và phí __FACT_1__.' }));
  assert.ok(valid.includes('43a-111.11') && valid.includes('-100.000 VND'));
  for (const [suffix, text] of [[' Check.', 'Phí __FACT_1__ của xe __FACT_0__.'], [' Check again.', 'Xe __FACT_0__, phí __FACT_1__, thêm 50.']]) {
    assert.ok(!(await localizeBookingReply(source + suffix, 'vi', async () => ({ text }))).includes('43a-111.11'));
  }
});
const audio = { audio: 'YXVkaW8=', mimeType: 'audio/webm;codecs=opus', previousLanguage: 'vi' };
const speech = (transcript, language = 'vi') => ({ transcript, language, confidence: 0.98, uncertainFields: [], speechDetected: true });
test('5. STT keeps dialect/mixed words original and its prompt explicitly forbids guessing', async () => {
  const text = 'tui muốn đậu xe ngày mai from 8am to 9am';
  const result = await transcribeBookingAudio(audio, async ([prompt]) => { assert.match(prompt, /regional accents/); assert.match(prompt, /Never guess/); return speech(text); });
  assert.equal(result.transcript, text);
});
test('6. noise, unclear critical values, missing confidence and malformed responses require repeating', async () => {
  for (const response of [null, { ...speech(''), speechDetected: false }, { ...speech('43A11111'), confidence: 0.4 }, { ...speech('43A11111'), uncertainFields: ['plate'] }, { transcript: 'confirm', language: 'en', speechDetected: true }]) {
    const result = await transcribeBookingAudio(audio, async () => response); assert.equal(result.transcript, ''); assert.equal(result.needsRepeat, true);
  }
});
test('7. STT detects each new language but neutral plates inherit prior language', async () => {
  for (const [text, modelLanguage, expected] of [['check my wallet', 'en', 'en'], ['kiểm tra ví', 'vi', 'vi'], ['43 A 11111', 'en', 'vi']]) {
    const result = await transcribeBookingAudio(audio, async () => speech(text, modelLanguage)); assert.equal(result.language, expected); assert.equal(result.transcript, text);
  }
});
test('9. a reopened legacy history cannot lock the next reply language or lose booking facts', async () => {
  const result = await interpret('change end time to 10am', { ...facts, __language: 'vi', __languageLocked: true });
  assert.equal(result.language, 'en'); assert.equal(result.draft.__languageLocked, false); assert.equal(result.draft.licensePlate, facts.licensePlate); assert.equal(result.draft.endTime, '10:00');
});
test('10. unrelated text in another language never edits or confirms an existing booking', async () => {
  const result = await interpret('What is the weather tomorrow?', { ...facts, __language: 'vi' });
  assert.equal(result.unrecognized, true); assert.equal(result.draft.startDate, facts.startDate); assert.equal(result.draft.licensePlate, facts.licensePlate);
});
