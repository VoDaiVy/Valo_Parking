import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiBookingSpeaker, formatAiBookingSpeech, splitAiBookingSpeechSegments } from './aiBookingVoice.js';
import { bookingPreviewSummary } from './aiBookingConversation.js';

const preview = {
  items: [
    { licensePlate: '44D4444', startTime: '2026-11-18T02:00:00Z', endTime: '2026-11-18T13:00:00Z', floorName: 'Tầng 1', slotCode: 'B3' },
    { licensePlate: '33D3333', startTime: '2026-11-18T00:00:00Z', endTime: '2026-11-18T01:00:00Z', floorName: 'Tầng 1', slotCode: 'B3' },
  ], total: 109000, walletBalance: 200000,
};
const draft = { reservationItems: [{ licensePlate: '44D4444', serviceNames: ['demo'] }, { licensePlate: '33D3333', serviceNames: [] }] };
const normalize = (text) => text.replace(/\s+([.,:;!?])/g, '$1').replace(/\s+/g, ' ').trim();
function playback(browserOptions = {}) {
  const utterances = []; const events = []; let cancels = 0, resumes = 0;
  class Utterance { constructor(text) { this.text = text; } }
  const synthesis = {
    getVoices: () => [{ lang: 'vi-VN', name: 'Vietnamese' }, { lang: 'en-US', name: 'English' }],
    speak: (utterance) => utterances.push(utterance), cancel: () => cancels++,
    paused: false, resume: () => { resumes++; synthesis.paused = false; },
  };
  const speaker = createAiBookingSpeaker({ SpeechSynthesisUtterance: Utterance, speechSynthesis: synthesis, ...browserOptions }, {
    onStart: () => events.push('start'), onEnd: () => events.push('end'), onError: (_event, language) => events.push(`error:${language}`),
  });
  const finish = () => {
    // Each native end event schedules the next segment. Bound this loop so a
    // broken continuation fails rather than hanging the test worker.
    for (let index = 0; index < utterances.length; index++) {
      assert.ok(index < 200); utterances[index].onstart?.(); utterances[index].onend?.();
    }
  };
  return { speaker, utterances, events, finish, synthesis, cancels: () => cancels, resumes: () => resumes };
}

test('two-car preview reads both plates, schedules, demo service, total and confirmation question', () => {
  const text = bookingPreviewSummary(preview, draft, 'vi');
  const player = playback(); player.speaker.speak(text, 'vi'); player.finish();
  const spoken = player.utterances.map(({ text }) => text).join(' ');
  assert.ok(spoken.includes('4 4 D 4 4 4 4')); assert.ok(spoken.includes('3 3 D 3 3 3 3'));
  for (const fact of ['9 giờ', '20 giờ', '7 giờ', '8 giờ', 'đê mô', '109000 đồng', 'Xác nhận đặt 2 chỗ?']) assert.ok(spoken.includes(fact), fact);
  assert.ok(!spoken.includes('Xem thông tin đầy đủ trên màn hình'));
  assert.equal(normalize(spoken), normalize(formatAiBookingSpeech(text, 'vi')));
  assert.deepEqual(player.events, ['start', 'end']); assert.ok(player.utterances.length > 1);
});

test('all content of a five-car reply is retained, including its final amount and question', () => {
  const five = { ...preview, items: Array.from({ length: 5 }, (_, index) => ({ ...preview.items[0], licensePlate: `${11 + index}A11111` })), total: 1234567, walletBalance: 2000000 };
  for (const language of ['vi', 'en']) {
    const text = bookingPreviewSummary(five, {}, language);
    const segments = splitAiBookingSpeechSegments(text, language);
    assert.equal(normalize(segments.map(({ text }) => text).join(' ')), normalize(formatAiBookingSpeech(text, language)));
    assert.ok(segments.every(({ lang }) => lang === (language === 'vi' ? 'vi-VN' : 'en-US')));
    assert.ok(segments.every(({ text }) => text.length <= 240));
    assert.ok(segments.at(-1).text.includes('?'));
  }
});

test('segment boundaries preserve grouped money, dates and complete spelled plate sequences', () => {
  const source = 'Xe 44D4444 ngày 18/11/2026 lúc 09:00. Tổng 109.000đ. Xác nhận đặt chỗ?';
  const segments = splitAiBookingSpeechSegments(source, 'vi', 80);
  assert.ok(segments.some(({ text }) => text.includes('4 4 D 4 4 4 4')));
  assert.ok(segments.some(({ text }) => text.includes('109000 đồng')));
  assert.equal(normalize(segments.map(({ text }) => text).join(' ')), normalize(formatAiBookingSpeech(source, 'vi')));
});

test('long service replies read through to their final line without shortening the information', () => {
  const text = Array.from({ length: 20 }, (_, index) => `Service ${index + 1}: vehicle care, ${20000 + index * 1000} VND.`).join('\n');
  const player = playback(); player.speaker.speak(text, 'en'); player.finish();
  assert.ok(player.utterances.at(-1).text.includes('39000 Vietnamese dong'));
  assert.equal(normalize(player.utterances.map(({ text }) => text).join(' ')), normalize(formatAiBookingSpeech(text, 'en')));
  assert.deepEqual(player.events, ['start', 'end']);
});

test('interrupting speech cancels all remaining segments and ignores late native callbacks', () => {
  const player = playback(); player.speaker.speak(bookingPreviewSummary(preview, draft, 'vi'), 'vi');
  const old = player.utterances[0]; old.onstart(); player.speaker.cancel();
  const count = player.utterances.length; old.onend(); old.onerror({ error: 'canceled' });
  assert.equal(player.utterances.length, count); assert.deepEqual(player.events, ['start', 'end']); assert.equal(player.cancels(), 1);
});

test('a new reply or replay replaces the old batch and keeps the new response language', () => {
  const player = playback(); player.speaker.speak(bookingPreviewSummary(preview, draft, 'vi'), 'vi');
  const old = player.utterances[0]; player.speaker.speak('Your new total is 109.000 VND. Would you like to confirm?', 'en');
  old.onend(); old.onerror({ error: 'canceled' });
  player.utterances.slice(1).forEach((utterance) => { utterance.onstart(); utterance.onend(); });
  // The second sentence is only submitted after the first finishes.
  const last = player.utterances.at(-1); if (!player.events.includes('end')) { last.onstart(); last.onend(); }
  assert.ok(player.utterances.slice(1).every(({ lang }) => lang === 'en-US'));
  assert.ok(!player.events.some((event) => event.startsWith('error'))); assert.equal(player.events.filter((event) => event === 'end').length, 1);
});

test('native speech errors stop the batch and allow the whole reply to be replayed', () => {
  const player = playback(); const text = bookingPreviewSummary(preview, draft, 'vi');
  player.speaker.speak(text, 'vi'); const old = player.utterances[0]; old.onerror({ error: 'not-allowed' }); old.onend();
  assert.equal(player.utterances.length, 1); assert.deepEqual(player.events, ['error:vi']);
  player.speaker.speak(text, 'vi');
  for (let index = 1; index < player.utterances.length; index++) { player.utterances[index].onstart(); player.utterances[index].onend(); }
  assert.deepEqual(player.events, ['error:vi', 'start', 'end']);
});

test('paused browser synthesis is resumed and unavailable playback is detected', () => {
  const player = playback(); player.synthesis.paused = true; player.speaker.speak('Xin chào.', 'vi');
  assert.equal(player.resumes(), 1); assert.equal(createAiBookingSpeaker({}), null);
});

test('a browser that never starts speech reports failure instead of remaining silently pending', () => {
  let timeout; const cleared = [];
  const player = playback({ setTimeout: (callback) => { timeout = callback; return 7; }, clearTimeout: (id) => cleared.push(id) });
  player.speaker.speak('Xin chào.', 'vi'); timeout();
  assert.deepEqual(player.events, ['error:vi']); assert.equal(player.cancels(), 1); assert.deepEqual(cleared, [7]);
  player.utterances[0].onend(); assert.equal(player.utterances.length, 1);
});

test('starting or cancelling speech clears the startup timeout and ignores stale timer callbacks', () => {
  let timeout; const cleared = [];
  const player = playback({ setTimeout: (callback) => { timeout = callback; return 7; }, clearTimeout: (id) => cleared.push(id) });
  player.speaker.speak('Xin chào.', 'vi'); const stale = timeout; player.utterances[0].onstart();
  assert.deepEqual(cleared, [7]); player.speaker.cancel(); stale();
  assert.deepEqual(player.events, ['start', 'end']);
});
