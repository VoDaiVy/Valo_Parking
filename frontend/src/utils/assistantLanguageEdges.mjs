import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookingTurnQueue, mayConfirmQueuedBooking } from './aiBookingTurnQueue.js';
import { detectBookingInputLanguage, detectRequestedConversationLanguage, isLanguageOnlyRequest } from './aiBookingLanguage.js';
import { createSpeechBoundary, createAutoLanguageVoiceSession } from './aiBookingAutoVoice.js';
import { createAiBookingRecognition, createAiBookingSpeaker, formatAiBookingSpeech, createConciseAiBookingSpeech } from './aiBookingVoice.js';
import { createAiBookingSnapshot, normalizeAiBookingSession } from './aiBookingSession.js';
import { prepareAiBooking, confirmAiBooking } from './aiBookingFlow.js';

test('1–3. rapid and mixed inputs use new evidence, neutral answers preserve previous language', () => {
  let language = 'vi';
  for (const [text, expected] of [['check my wallet', 'en'], ['100.000 VND', 'en'], ['kiểm tra ví', 'vi'], ['43 A 11111', 'vi'], ['book a parking space please', 'en'], ['A 1', 'en'], ['đổi giờ ra 11h', 'vi']]) { language = detectBookingInputLanguage(text, language).language; assert.equal(language, expected, text); }
  for (const prior of ['vi', 'en']) assert.equal(detectBookingInputLanguage('book xe', prior).language, prior);
  assert.equal(detectRequestedConversationLanguage('do not speak English'), ''); assert.equal(detectRequestedConversationLanguage('nói tiếng Anh'), 'en');
  assert.equal(isLanguageOnlyRequest('speak English and book a car'), false); assert.equal(isLanguageOnlyRequest('nói tiếng Anh'), true);
});
test('4. voice preserves invalid dates, valid grouped amounts and complete plates without truncating facts', () => {
  assert.ok(formatAiBookingSpeech('Date 31/02/2027 is invalid.', 'en').includes('31/02/2027')); assert.ok(formatAiBookingSpeech('20/11/2027', 'en').includes('November 20, 2027'));
  assert.match(formatAiBookingSpeech('43a-111.11', 'en'), /4 3 A 1 1 1 1 1/); assert.equal(formatAiBookingSpeech('100.000 VND', 'en'), '100000 Vietnamese dong');
  assert.equal(formatAiBookingSpeech('08:00 PM', 'en'), '08:00 PM'); assert.ok(formatAiBookingSpeech('100,000 VND', 'vi').includes('100000 đồng'));
  assert.ok(createConciseAiBookingSpeech('The price is 100.000 VND. ' + 'Please review the details before confirming. '.repeat(5), 'en').includes('100.000 VND.'));
  assert.equal(createConciseAiBookingSpeech(`${'Booking details '.repeat(15)}43A11111: 20/11/2027 08:00; 100.000 VND.`, 'en'), 'See full details on screen.');
});
test('5. isolated noise is not speech; sustained speech ends after silence', () => {
  const noise = createSpeechBoundary(); noise.sample(0.04, 0); noise.sample(0, 400); assert.equal(noise.sample(0, 19000).heardSpeech, false);
  const voice = createSpeechBoundary(); voice.sample(0.03, 0); voice.sample(0.03, 80); assert.deepEqual(voice.sample(0, 1000), { heardSpeech: true, finished: true });
});
test('6. native fallback asks to repeat low confidence/conflicting numbers and preserves clear raw text', () => {
  let recognition, repeats = 0; const received = [];
  class Recognition { constructor() { recognition = this; } }
  createAiBookingRecognition({ SpeechRecognition: Recognition }, { automaticLanguage: true, onTranscript: (text) => received.push(text), onClarification: () => repeats++, onError() {} });
  recognition.onresult({ results: [[{ transcript: 'confirm', confidence: 0.3 }]] }); recognition.onresult({ results: [[{ transcript: '43A11111', confidence: 0.95 }, { transcript: '43A11112', confidence: 0.9 }]] });
  assert.equal(repeats, 2); assert.equal(received.length, 0); recognition.onresult({ results: [[{ transcript: '43 a 11111', confidence: 0.99 }]] }); assert.deepEqual(received, ['43 a 11111']);
});
test('6. native no-speech asks to repeat without submitting anything', () => {
  let recognition, repeats = 0;
  class Recognition { constructor() { recognition = this; } start() {} stop() {} abort() {} }
  const session = createAutoLanguageVoiceSession({ SpeechRecognition: Recognition }, { onTranscript: () => assert.fail('noise must not submit'), onClarification: () => repeats++, onError() {}, onListeningChange() {} });
  session.start(); recognition.onerror({ error: 'no-speech' }); assert.equal(repeats, 1); session.stop();
});
// Device fixtures exercise the actual recorder without opening a microphone.
function audioBrowser() {
  let recorder, sample; const track = { enabled: true, stop() {} };
  class Recorder { static isTypeSupported() { return true; } constructor() { recorder = this; this.mimeType = 'audio/webm'; this.state = 'inactive'; } start() { this.state = 'recording'; } stop() { this.state = 'inactive'; return this.onstop?.(); } }
  class Context { async resume() {} async close() {} createAnalyser() { return { fftSize: 16, getFloatTimeDomainData: (values) => values.fill(0.04) }; } createMediaStreamSource() { return { connect() {}, disconnect() {} }; } }
  class Reader { readAsDataURL() { this.result = 'data:audio/webm;base64,YXVkaW8='; queueMicrotask(() => this.onload()); } }
  return { browser: { AudioContext: Context, MediaRecorder: Recorder, Blob, FileReader: Reader, navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } }, setInterval: (callback) => { sample = callback; return 1; }, clearInterval() {} }, finish: () => { sample(); sample(); return recorder.stop(); } };
}
test('5–7. actual recorder lifecycle handles VI/EN transitions and asks to repeat uncertain speech', async () => {
  const device = audioBrowser(), received = []; let repeats = 0;
  const results = [{ transcript: 'tui muốn đậu xe', language: 'vi' }, { transcript: 'check my wallet', language: 'en' }, { transcript: '', needsRepeat: true }];
  const session = createAutoLanguageVoiceSession(device.browser, { transcribe: async () => ok(results.shift()), onTranscript: (text, language) => received.push([text, language]), onClarification: () => repeats++, onListeningChange() {}, onError: (message) => assert.fail(message) });
  await session.start(); await device.finish(); session.resume(); await device.finish(); session.resume(); await device.finish();
  assert.deepEqual(received, [['tui muốn đậu xe', 'vi'], ['check my wallet', 'en']]); assert.equal(repeats, 1); session.stop();
});
test('7. each TTS uses the reply locale; stale voice callbacks cannot finish a newer reply', () => {
  const spoken = []; let ended = 0;
  class Utterance { constructor(text) { this.text = text; } }
  const speaker = createAiBookingSpeaker({ SpeechSynthesisUtterance: Utterance, speechSynthesis: { getVoices: () => [], speak: (item) => spoken.push(item), cancel() {} } }, { onEnd: () => ended++ });
  speaker.speak('Kiểm tra ví', 'vi'); speaker.speak('Check my wallet', 'en'); assert.deepEqual(spoken.map(({ lang }) => lang), ['vi-VN', 'en-US']); spoken[0].onend(); assert.equal(ended, 0); spoken[1].onend(); assert.equal(ended, 1);
});
test('8. paused in-flight transcription cannot submit its late result', async () => {
  const device = audioBrowser(); let complete, requested = false; const result = new Promise((resolve) => { complete = resolve; });
  const session = createAutoLanguageVoiceSession(device.browser, { transcribe: () => { requested = true; return result; }, onTranscript: () => assert.fail('stale audio must not execute'), onListeningChange() {}, onError: (message) => assert.fail(message) });
  await session.start(); const finished = device.finish(); await new Promise((resolve) => setTimeout(resolve, 0)); assert.equal(requested, true); session.pause(); complete(ok({ transcript: 'confirm', language: 'en' })); await finished; session.stop();
});
test('8. new messages process serially with the resulting context and individual languages', async () => {
  const events = []; let finish, time = '08:00'; const barrier = new Promise((resolve) => { finish = resolve; });
  const queue = createBookingTurnQueue({ process: async ({ text, language }) => { events.push([text, language, time]); if (text === 'first') { await barrier; time = '10:00'; } } });
  const first = queue.enqueue({ text: 'first', language: 'en' }), next = queue.enqueue({ text: 'next', language: 'vi' }); await Promise.resolve(); assert.equal(events.length, 1); finish(); await Promise.all([first, next]); await queue.whenIdle();
  assert.deepEqual(events, [['first', 'en', '08:00'], ['next', 'vi', '10:00']]); queue.dispose();
});
test('8. errors cannot drop later messages and disposed queues cancel new work', async () => {
  const received = []; const queue = createBookingTurnQueue({ process: async (text) => { if (text === 'bad') throw new Error('network'); received.push(text); }, onError: () => { throw new Error('display failed'); } });
  await Promise.all([queue.enqueue('bad'), queue.enqueue('next')]); assert.deepEqual(received, ['next']); queue.dispose(); assert.deepEqual(await queue.enqueue('late'), { cancelled: true });
});
test('8/10. confirmations apply only to the same ready preview already displayed at send time', () => {
  for (const [sent, current, expected] of [[{ ready: false, key: 'old' }, { ready: true, key: 'old' }, false], [{ ready: true, key: 'old' }, { ready: true, key: 'new' }, false], [{ ready: true, key: 'old' }, { ready: false, key: 'old' }, false], [{ ready: true, key: 'old' }, { ready: true, key: 'old' }, true]]) assert.equal(mayConfirmQueuedBooking(sent, current), expected);
});
test('9. history retains original multilingual messages and booking facts while allowing a new language', () => {
  const snapshot = createAiBookingSnapshot({ bookingDraft: { licensePlate: '43A11111', startDate: '2027-11-20', startTime: '08:00', endTime: '09:00', serviceIds: ['unit-service'], __confirmationKey: 'persisted', __language: 'en' }, messages: [{ role: 'user', text: 'book a car', language: 'en' }, { role: 'assistant', text: 'Chọn ngày', language: 'vi' }] });
  const restored = normalizeAiBookingSession(JSON.parse(JSON.stringify(snapshot))); assert.deepEqual(restored.messages.map(({ text, language }) => [text, language]), [['book a car', 'en'], ['Chọn ngày', 'vi']]);
  assert.equal(restored.bookingDraft.__confirmationKey, 'persisted'); assert.equal(restored.bookingDraft.licensePlate, '43A11111'); assert.equal(restored.messages[0].speak, false); assert.equal(detectBookingInputLanguage('đổi giờ ra 10h', restored.bookingDraft.__language).language, 'vi');
});
const ok = (data) => ({ ok: true, data: { data } });
function isolatedGateway() {
  const calls = { writes: [] }; let price = 100000;
  return { calls, setPrice: (value) => { price = value; }, gateway: {
    getMyBookings: async () => ok([]), getAvailableBookingSlots: async () => ok({ slots: [{ floorId: 'unit-floor', floorName: 'Floor 1', slotCode: 'A-015', slotType: 'SLOT' }] }), quoteBulkBooking: async ({ items }) => ok({ grandTotal: price, items: items.map(() => ({ totalAmount: price })) }), getWalletInfo: async () => ok({ balance: 200000 }),
    createBookingHold: async (payload) => { calls.writes.push(['hold', payload]); return ok({ _id: 'unit-hold' }); }, createBulkBooking: async (payload) => { calls.writes.push(['confirm', payload]); return ok({ confirmed: true }); }, releaseBookingHold: async () => ok({}),
  } };
}
const draft = { startDate: '2099-11-20', endDate: '2099-11-20', startTime: '08:00', endTime: '09:00', licensePlate: '43A11111', floorName: 'Floor 1', slotCode: 'A-015', serviceIds: ['unit-service'], voucherId: 'unit-voucher' };
test('10. language cannot change Quick Booking quotes, services, vouchers or confirmation payloads', async () => {
  const { gateway, calls } = isolatedGateway(); const vi = await prepareAiBooking({ ...draft, __language: 'vi' }, gateway, []), en = await prepareAiBooking({ ...draft, __language: 'en' }, gateway, []);
  assert.deepEqual(en, vi); assert.equal(calls.writes.length, 0); assert.equal(en.total, 100000); assert.deepEqual(en.items[0].serviceIds, draft.serviceIds); assert.equal(en.items[0].voucherId, draft.voucherId);
  assert.ok((await confirmAiBooking(en, { ...draft, __language: 'vi' }, gateway, [], 'same-key')).success); const payload = calls.writes.find(([action]) => action === 'confirm')[1]; assert.equal(payload.bookingSource, 'AI_QUICK'); assert.equal(payload.expectedTotal, 100000); assert.equal(payload.idempotencyKey, 'same-key');
});
test('10. price changes after a language switch require reconfirmation without holds or charges', async () => {
  const { gateway, calls, setPrice } = isolatedGateway(); const preview = await prepareAiBooking({ ...draft, __language: 'vi' }, gateway, []); setPrice(120000); const result = await confirmAiBooking(preview, { ...draft, __language: 'en' }, gateway, [], 'same-key'); assert.equal(result.refreshed.total, 120000); assert.equal(calls.writes.length, 0);
});
