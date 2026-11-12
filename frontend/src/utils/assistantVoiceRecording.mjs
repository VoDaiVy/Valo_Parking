import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoLanguageVoiceSession } from './aiBookingAutoVoice.js';
import { canUseFastBookingSpeech } from './aiBookingSpeechLanguage.js';

function microphone() {
  const events = [], deadlines = new Map(); let meter, recorder, timerId = 0, level = 0.04, acquisitions = 0;
  const track = { enabled: true, stop() { events.push('track-stop'); } };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { recorder = this; this.mimeType = 'audio/webm'; this.state = 'inactive'; }
    start() { assert.equal(track.enabled, true); events.push('record'); this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['user-audio']) }); return this.onstop?.(); }
  }
  class Context {
    async resume() {} async close() {}
    createAnalyser() { return { fftSize: 16, getFloatTimeDomainData: (values) => values.fill(level) }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  }
  class Reader { readAsDataURL() { this.result = 'data:audio/webm;base64,dXNlci1hdWRpbw=='; queueMicrotask(() => this.onload()); } }
  return { track, events, deadlines, browser: {
    MediaRecorder: Recorder, AudioContext: Context, Blob, FileReader: Reader,
    navigator: { mediaDevices: { getUserMedia: async () => { acquisitions++; return { getTracks: () => [track] }; } } },
    setInterval: (callback) => { meter = callback; return 1; }, clearInterval() {},
    setTimeout: (callback) => { const id = ++timerId; deadlines.set(id, callback); return id; }, clearTimeout: (id) => deadlines.delete(id),
  }, finish: () => { meter(); meter(); return recorder.stop(); }, sample: (value) => { level = value; meter?.(); }, stopRecording: () => recorder.stop(), acquisitions: () => acquisitions };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const ok = (data) => ({ ok: true, data: { data } });

// Set up a real accepted audio transcription before testing the fast path.
// UI language setters alone must never establish a spoken language.
async function verifiedVoiceSession(device, options, language = 'vi') {
  let priming = true;
  const callbacks = {};
  for (const name of ['onTranscript', 'onPreparingChange', 'onListeningChange', 'onTranscribingChange', 'onClarification']) {
    callbacks[name] = (...args) => { if (!priming) options[name]?.(...args); };
  }
  const session = createAutoLanguageVoiceSession(device.browser, {
    ...options, ...callbacks,
    transcribe: (...args) => priming ? Promise.resolve(ok({ transcript: language === 'vi' ? '\u0111\u1eb7t xe' : 'book a car', language })) : options.transcribe?.(...args),
  });
  session.setLanguage(language); await session.start(); await device.finish(); session.stop();
  priming = false; device.events.length = 0;
  return session;
}

function enableFastRecognition(device) {
  const recognizers = [];
  device.browser.SpeechRecognition = class {
    constructor() { recognizers.push(this); }
    start() { device.events.push('browser-recognition'); queueMicrotask(() => this.onaudiostart?.()); }
    abort() {} stop() { this.onend?.(); }
  };
  return recognizers;
}

test('clear Vietnamese first speech is delivered even when the initial UI language is English', async () => {
  const device = microphone(); const received = [];
  const text = 'tôi muốn đặt xe vào ngày mai';
  const session = createAutoLanguageVoiceSession(device.browser, {
    transcribe: async () => ok({ transcript: text, language: 'vi', needsRepeat: false }),
    onListeningChange() {}, onTranscript: (...args) => received.push(args), onError: (message) => assert.fail(message),
  });
  session.setLanguage('en'); await session.start(); await device.finish();
  assert.deepEqual(received, [[text, 'vi']]); session.stop();
});

test('unclear Vietnamese speech asks to repeat in Vietnamese without submitting business data', async () => {
  const device = microphone(); const languages = [];
  const session = createAutoLanguageVoiceSession(device.browser, {
    transcribe: async () => ok({ transcript: '', language: 'vi', needsRepeat: true }),
    onClarification: (language) => languages.push(language), onListeningChange() {},
    onTranscript: () => assert.fail('unclear speech must not submit'), onError: (message) => assert.fail(message),
  });
  await session.start(); await device.finish(); assert.deepEqual(languages, ['vi']); session.stop();
});

test('a stalled transcription clears processing, aborts transport and ignores its late result', async () => {
  const device = microphone(); const processing = [], errors = []; let complete, signal;
  const session = createAutoLanguageVoiceSession(device.browser, {
    transcribe: (_audio, _mime, _language, options) => { signal = options.signal; return new Promise((resolve) => { complete = resolve; }); },
    onTranscribingChange: (value) => processing.push(value), onError: (message) => errors.push(message), onListeningChange() {},
    onTranscript: () => assert.fail('timed-out speech cannot submit'),
  });
  await session.start(); const finish = device.finish(); await tick();
  assert.equal(processing.at(-1), true); [...device.deadlines.values()][0](); await finish;
  assert.equal(signal.aborted, true); assert.equal(processing.at(-1), false); assert.equal(device.deadlines.size, 0);
  assert.equal(errors.length, 1); assert.equal(session.isActive(), false);
  complete(ok({ transcript: 'confirm', language: 'en' })); await tick();
});

test('a service outage is not reclassified as unclear speech and does not start a second browser recording', async () => {
  const device = microphone(); const errors = []; let nativeStarts = 0;
  device.browser.SpeechRecognition = class { start() { nativeStarts++; queueMicrotask(() => this.onaudiostart?.()); } stop() { this.onend?.(); } abort() {} };
  const session = await verifiedVoiceSession(device, {
    transcribe: async () => ({ ok: false, status: 503, data: { message: 'Speech service unavailable' } }),
    onError: (message) => errors.push(message), onListeningChange() {},
    onClarification: () => assert.fail('service errors are not unclear speech'), onTranscript: () => assert.fail('failed speech cannot submit'),
  });
  await session.start(); assert.equal(nativeStarts, 1); await device.finish();
  assert.deepEqual(errors, ['Speech service unavailable']); assert.equal(nativeStarts, 1); assert.equal(session.isActive(), false);
});

test('clear browser speech appears immediately without waiting for silence or calling Gemini', async () => {
  const device = microphone(), native = enableFastRecognition(device), received = [], processing = [];
  let uploads = 0;
  const text = 'tôi muốn đặt xe vào ngày mai';
  const session = await verifiedVoiceSession(device, {
    transcribe: () => { uploads++; return new Promise(() => {}); }, onTranscript: (...args) => received.push(args),
    onTranscribingChange: (value) => processing.push(value), onListeningChange() {}, onError: (message) => assert.fail(message),
  });
  session.setLanguage('vi'); await session.start();
  assert.equal(native[0].lang, 'vi-VN');
  native[0].onspeechstart?.(); native[0].onresult({ results: [[{ transcript: text, confidence: 0.98 }]] });
  assert.deepEqual(received, [[text, 'vi']]); assert.equal(uploads, 0); assert.ok(!processing.includes(true));
  native[0].onspeechstart?.(); native[0].onresult({ results: [[{ transcript: text, confidence: 0.98 }]] });
  assert.equal(received.length, 1); session.stop();
});

test('low quality or conflicting browser results send the original recording once instead of guessing or recording again', async () => {
  for (const alternatives of [
    [{ transcript: '43A11111', confidence: 0.3 }],
    [{ transcript: '43A11111', confidence: 0.95 }, { transcript: '43A11112', confidence: 0.9 }],
    [{ transcript: '43A11111', confidence: 0.95 }, { transcript: '43B11111', confidence: 0.9 }],
  ]) {
    const device = microphone(), native = enableFastRecognition(device), received = [];
    let uploads = 0;
    const session = await verifiedVoiceSession(device, {
      transcribe: async (audio) => { uploads++; assert.equal(audio, 'dXNlci1hdWRpbw=='); return ok({ transcript: '43A11111', language: 'vi' }); },
      onListeningChange() {}, onTranscript: (...args) => received.push(args), onError: (message) => assert.fail(message),
    });
    session.setLanguage('vi'); await session.start(); native[0].onspeechstart?.(); native[0].onresult({ results: [alternatives] }); await tick();
    assert.equal(uploads, 1); assert.deepEqual(received, [['43A11111', 'vi']]);
    assert.equal(device.events.filter((value) => value === 'record').length, 1); session.stop();
  }
});

test('a language switch is verified with the captured audio then updates the next fast recognition locale', async () => {
  const device = microphone(), native = enableFastRecognition(device), received = []; let uploads = 0;
  const session = await verifiedVoiceSession(device, {
    transcribe: async () => { uploads++; return ok({ transcript: 'check my wallet', language: 'en' }); },
    onListeningChange() {}, onTranscript: (...args) => received.push(args), onError: (message) => assert.fail(message),
  });
  session.setLanguage('vi'); await session.start();
  native[0].onspeechstart?.(); native[0].onresult({ results: [[{ transcript: 'check my wallet', confidence: 0.99 }]] }); await tick();
  assert.equal(uploads, 1); assert.deepEqual(received, [['check my wallet', 'en']]);
  await session.resume(); assert.equal(native[1].lang, 'en-US'); session.stop();
});

test('a failed browser recognizer falls back to the existing recording and late browser events cannot duplicate the command', async () => {
  const device = microphone(), native = enableFastRecognition(device), received = []; let uploads = 0;
  const session = await verifiedVoiceSession(device, {
    transcribe: async () => { uploads++; return ok({ transcript: 'check my wallet', language: 'en' }); },
    onListeningChange() {}, onTranscript: (...args) => received.push(args), onError: (message) => assert.fail(message),
  });
  await session.start(); native[0].onerror({ error: 'network' }); await device.finish();
  native[0].onspeechstart?.(); native[0].onresult({ results: [[{ transcript: 'confirm booking', confidence: 0.99 }]] });
  assert.equal(uploads, 1); assert.deepEqual(received, [['check my wallet', 'en']]); session.stop();
});

test('clear browser transcription preserves invalid dates, money and formatted plates for booking validation', async () => {
  const device = microphone(), native = enableFastRecognition(device), received = [];
  const text = 'đặt xe 43A-111.11 ngày 31/02/2027 lúc 25:00 giá 100.000 VND';
  const session = await verifiedVoiceSession(device, {
    transcribe: () => assert.fail('clear result must not require a server upload'), onListeningChange() {},
    onTranscript: (value) => received.push(value), onError: (message) => assert.fail(message),
  });
  session.setLanguage('vi'); await session.start(); native[0].onspeechstart?.(); native[0].onresult({ results: [[{ transcript: text, confidence: 0.99 }]] });
  assert.deepEqual(received, [text]); session.stop();
});

test('cold startup waits for actual audio capture and accepts the very first utterance without a sound delay', async () => {
  const device = microphone(), recognizers = [], received = [], preparing = [], listening = [];
  let uploads = 0, repeats = 0;
  device.browser.SpeechRecognition = class {
    constructor() { recognizers.push(this); }
    start() { device.events.push('recognition-start'); if (recognizers.length > 1) queueMicrotask(() => this.onaudiostart?.()); }
    stop() { this.onend?.(); } abort() {}
  };
  const session = await verifiedVoiceSession(device, {
    transcribe: () => { uploads++; return ok({ transcript: '', needsRepeat: true }); },
    onPreparingChange: (value) => preparing.push(value), onListeningChange: (value) => listening.push(value),
    onTranscript: (text) => received.push(text), onClarification: () => repeats++, onError: (message) => assert.fail(message),
  });
  session.setLanguage('vi'); const start = session.start(); await tick();
  assert.deepEqual(device.events, ['recognition-start']); assert.equal(preparing.at(-1), true);
  assert.ok(!listening.includes(true)); assert.equal(device.track.enabled, false);
  // Device startup noise is not a user request and must never finish the turn.
  recognizers[0].onresult({ results: [[{ transcript: 'noise', confidence: 0.1 }]] });
  assert.equal(repeats, 0); assert.equal(uploads, 0);
  recognizers[0].onaudiostart(); await start;
  assert.deepEqual(device.events, ['recognition-start', 'record']); assert.equal(preparing.at(-1), false);
  recognizers[0].onresult({ results: [[{ transcript: 'noise', confidence: 0.1 }]] });
  assert.equal(repeats, 0); assert.equal(uploads, 0);
  const text = 'tôi muốn đặt xe vào ngày mai';
  recognizers[0].onspeechstart(); recognizers[0].onresult({ results: [[{ transcript: text, confidence: 0.99 }]] });
  assert.deepEqual(received, [text]); assert.equal(uploads, 0); assert.equal(repeats, 0);
  await session.resume(); recognizers[1].onspeechstart(); recognizers[1].onresult({ results: [[{ transcript: '8 giờ đến 9 giờ', confidence: 0.99 }]] });
  assert.deepEqual(received, [text, '8 giờ đến 9 giờ']); assert.equal(device.acquisitions(), 2); session.stop();
});

test('a final first-turn browser result arriving after silence is kept instead of being aborted and sent to Gemini', async () => {
  const device = microphone(), native = enableFastRecognition(device), received = [], processing = [];
  let uploads = 0;
  const text = 'tôi muốn đặt xe vào ngày mai';
  const session = await verifiedVoiceSession(device, {
    transcribe: () => { uploads++; return ok({ transcript: '', needsRepeat: true }); },
    onListeningChange() {}, onTranscribingChange: (value) => processing.push(value),
    onTranscript: (value) => received.push(value), onClarification: () => assert.fail('a late clear result must not ask to repeat'), onError: (message) => assert.fail(message),
  });
  session.setLanguage('vi'); await session.start();
  native[0].stop = () => { queueMicrotask(() => { native[0].onresult({ results: [[{ transcript: text, confidence: 0.99 }]] }); native[0].onend?.(); }); };
  await device.finish();
  assert.deepEqual(received, [text]); assert.equal(uploads, 0); assert.equal(processing.at(-1), false);
  assert.equal(device.deadlines.size, 0); session.stop();
});

test('startup timeout still records the first real utterance using Gemini without an empty failed turn', async () => {
  const device = microphone(), received = []; let uploads = 0;
  device.browser.SpeechRecognition = class { start() {} stop() {} abort() {} };
  const session = await verifiedVoiceSession(device, {
    transcribe: async (audio) => { uploads++; assert.equal(audio, 'dXNlci1hdWRpbw=='); return ok({ transcript: 'tôi muốn đặt xe vào ngày mai', language: 'vi' }); },
    onListeningChange() {}, onTranscript: (text) => received.push(text), onClarification: () => assert.fail('startup is not unclear speech'), onError: (message) => assert.fail(message),
  });
  const start = session.start(); await tick(); [...device.deadlines.values()][0](); await start;
  await device.finish(); assert.equal(uploads, 1); assert.equal(received.length, 1); session.stop();
});

test('stopping during cold recognition startup cancels readiness and never starts a late recording', async () => {
  const device = microphone(); let native;
  device.browser.SpeechRecognition = class { constructor() { native = this; } start() {} stop() {} abort() {} };
  const session = await verifiedVoiceSession(device, {
    onListeningChange() {}, onTranscript: () => assert.fail('cancelled startup cannot submit'), onError: (message) => assert.fail(message),
  });
  const start = session.start(); await tick(); session.stop(); await start; native.onaudiostart();
  assert.ok(!device.events.includes('record')); assert.equal(device.deadlines.size, 0);
});

test('isolated microphone warmup noise resumes listening without a cloud upload or a repeat prompt', async () => {
  const device = microphone(); let uploads = 0, repeats = 0;
  const session = createAutoLanguageVoiceSession(device.browser, {
    transcribe: () => { uploads++; }, onClarification: () => repeats++, onListeningChange() {}, onTranscript() {}, onError: (message) => assert.fail(message),
  });
  await session.start(); device.sample(0.04); device.sample(0); await device.stopRecording();
  assert.equal(uploads, 0); assert.equal(repeats, 0); assert.equal(device.events.filter((value) => value === 'record').length, 2); session.stop();
});

test('a recognizer that never supplies final text falls back once and ignores a late duplicate', async () => {
  const device = microphone(), native = enableFastRecognition(device), received = []; let uploads = 0;
  const session = await verifiedVoiceSession(device, {
    transcribe: async () => { uploads++; return ok({ transcript: 'tôi muốn đặt xe', language: 'vi' }); },
    onListeningChange() {}, onTranscript: (text) => received.push(text), onError: (message) => assert.fail(message),
  });
  session.setLanguage('vi'); await session.start(); native[0].stop = () => {};
  const finish = device.finish(); await tick(); [...device.deadlines.values()][0](); await finish;
  native[0].onresult({ results: [[{ transcript: 'xác nhận đặt chỗ', confidence: 0.99 }]] });
  assert.equal(uploads, 1); assert.deepEqual(received, ['tôi muốn đặt xe']); session.stop();
});

test('resume cannot open a duplicate microphone while the first final result is still pending', async () => {
  const device = microphone(), native = enableFastRecognition(device); let uploads = 0;
  const session = await verifiedVoiceSession(device, {
    transcribe: async () => { uploads++; return ok({ transcript: 'tôi muốn đặt xe', language: 'vi' }); },
    onListeningChange() {}, onTranscript() {}, onError: (message) => assert.fail(message),
  });
  session.setLanguage('vi'); await session.start(); native[0].stop = () => {};
  const finish = device.finish(); await tick(); await session.resume();
  assert.equal(native.length, 1); assert.equal(device.events.filter((value) => value === 'record').length, 1);
  [...device.deadlines.values()][0](); await finish;
  assert.equal(uploads, 1); await session.resume(); assert.equal(native.length, 2); session.stop();
});

test('pausing while final text is pending allows a clean restart and discards the old result', async () => {
  const device = microphone(), native = enableFastRecognition(device), received = [];
  const session = await verifiedVoiceSession(device, {
    transcribe: () => assert.fail('cancelled first turn must not upload'), onListeningChange() {},
    onTranscript: (text) => received.push(text), onError: (message) => assert.fail(message),
  });
  session.setLanguage('vi'); await session.start(); native[0].stop = () => {};
  const finish = device.finish(); await tick(); session.pause(); await finish;
  await session.resume(); native[0].onresult({ results: [[{ transcript: 'xác nhận đặt chỗ', confidence: 0.99 }]] });
  native[1].onspeechstart(); native[1].onresult({ results: [[{ transcript: 'tôi muốn đặt xe', confidence: 0.99 }]] });
  assert.deepEqual(received, ['tôi muốn đặt xe']); session.stop();
});

test('English UI cannot select English speech recognition before the first audio language is verified', async () => {
  const device = microphone(), native = enableFastRecognition(device), received = []; let uploads = 0;
  const text = 'tôi muốn đặt xe ngày mai';
  const session = createAutoLanguageVoiceSession(device.browser, {
    transcribe: async () => { uploads++; return ok({ transcript: text, language: 'vi' }); },
    onListeningChange() {}, onTranscript: (...args) => received.push(args), onError: (message) => assert.fail(message),
  });
  session.setLanguage('en'); await session.start();
  assert.equal(native.length, 0); await device.finish();
  assert.deepEqual(received, [[text, 'vi']]); assert.equal(uploads, 1);
  session.setLanguage('en'); await session.resume(); assert.equal(native[0].lang, 'vi-VN');
  native[0].onspeechstart(); native[0].onresult({ results: [[{ transcript: 'ok', confidence: 0.99 }]] });
  assert.deepEqual(received.at(-1), ['ok', 'vi']); assert.equal(uploads, 1); session.stop();
});

test('The MM is checked against the actual audio rather than being shown as the user message', async () => {
  const device = microphone(), native = enableFastRecognition(device), received = []; let uploads = 0;
  const text = 'tôi muốn đặt xe vào ngày mai';
  const session = await verifiedVoiceSession(device, {
    transcribe: async (audio) => { uploads++; assert.equal(audio, 'dXNlci1hdWRpbw=='); return ok({ transcript: text, language: 'vi' }); },
    onListeningChange() {}, onTranscript: (...args) => received.push(args), onError: (message) => assert.fail(message),
  }, 'en');
  await session.start(); native[0].onspeechstart(); native[0].onresult({ results: [[{ transcript: 'The MM.', confidence: 0.99 }]] }); await tick();
  assert.equal(uploads, 1); assert.deepEqual(received, [[text, 'vi']]);
  await session.resume(); assert.equal(native[1].lang, 'vi-VN'); session.stop();
});

test('fast speech requires verified audio language and rejects unrelated or cross-language guesses', () => {
  assert.equal(canUseFastBookingSpeech('khi nãy book one car tomorrow', 'en'), false);
  assert.equal(canUseFastBookingSpeech('Can I book xe ngày mai', 'en'), false);
  assert.equal(canUseFastBookingSpeech('Can I book?', 'en'), true);
  assert.equal(canUseFastBookingSpeech('Could I book one car?', 'en'), true);
  assert.equal(canUseFastBookingSpeech('book a car', null), false);
  assert.equal(canUseFastBookingSpeech('The MM.', 'en'), false);
  assert.equal(canUseFastBookingSpeech('check my wallet', 'vi'), false);
  assert.equal(canUseFastBookingSpeech('tôi muốn đặt xe', 'en'), false);
  assert.equal(canUseFastBookingSpeech('tôi muốn đặt xe', 'vi'), true);
  assert.equal(canUseFastBookingSpeech('check my wallet', 'en'), true);
  assert.equal(canUseFastBookingSpeech('43A12345', 'vi'), true);
});

test('hybrid native Can I book guess is replaced only by verification of the same recording', async () => {
  const device = microphone(), native = enableFastRecognition(device), received = []; let uploads = 0;
  const session = await verifiedVoiceSession(device, {
    transcribe: async (audio, _mime, _language, options) => {
      uploads++;
      assert.equal(audio, 'dXNlci1hdWRpbw==');
      assert.deepEqual(options.contextPhrases, ['Car Wash']);
      return ok({ transcript: 'Can I book one car tomorrow?', language: 'en' });
    },
    onListeningChange() {}, onTranscript: (...args) => received.push(args), onError: (message) => assert.fail(message),
  }, 'en');
  session.setContextPhrases(['Car Wash']);
  await session.start(); native[0].onspeechstart();
  native[0].onresult({ results: [[{ transcript: 'khi nãy book one car tomorrow', confidence: 0.99 }]] });
  await tick();
  assert.equal(uploads, 1);
  assert.deepEqual(received, [['Can I book one car tomorrow?', 'en']]);
  session.stop();
});
