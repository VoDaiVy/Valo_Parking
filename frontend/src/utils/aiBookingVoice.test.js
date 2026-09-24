import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAiBookingRecognition, createAiBookingSpeaker, createAiBookingVoiceSession, formatAiBookingSpeech,
  splitAiBookingSpeechSegments,
} from './aiBookingVoice.js';

test('voice input passes Vietnamese transcript to the same message handler', () => {
  class Recognition {}
  let transcript = '';
  const recognition = createAiBookingRecognition({ SpeechRecognition: Recognition }, {
    onTranscript: (value) => { transcript = value; }, onError: () => {}, onEnd: () => {},
  });
  recognition.onresult({ results: [[{ transcript: '  Đặt chỗ ngày mai từ 8h đến 10h  ' }]] });
  assert.equal(recognition.lang, 'vi-VN');
  assert.equal(transcript, 'Đặt chỗ ngày mai từ 8h đến 10h');
});

test('speaker uses Vietnamese voice and cancels stale speech before a new reply', () => {
  class Utterance { constructor(text) { this.text = text; } }
  const spoken = [];
  const events = [];
  const synthesis = {
    speak: (value) => spoken.push(value), cancel: () => events.push('cancel'),
    getVoices: () => [{ lang: 'en-US' }, { lang: 'vi-VN', name: 'Vietnamese' }],
  };
  const speaker = createAiBookingSpeaker({ speechSynthesis: synthesis, SpeechSynthesisUtterance: Utterance }, {
    onStart: () => events.push('start'), onEnd: () => events.push('end'),
  });
  speaker.speak('Xin chào');
  spoken[0].onstart();
  speaker.speak('Bạn muốn đặt chỗ?');
  spoken[0].onend();
  spoken[1].onstart();
  assert.equal(spoken[1].lang, 'vi-VN');
  assert.equal(spoken[1].voice.name, 'Vietnamese');
  assert.deepEqual(events, ['start', 'cancel', 'end', 'start']);
  speaker.cancel();
  assert.deepEqual(events.slice(-2), ['cancel', 'end']);
});

test('speaker reads booking time ranges naturally in Vietnamese', () => {
  assert.equal(
    formatAiBookingSpeech('24/09/2026, 08:00–09:00. Xe 43A54321.'),
    'ngày 24 tháng 9 năm 2026, 8 giờ đến 9 giờ. Xe 4 3 A 5 4 3 2 1.',
  );
  assert.equal(
    formatAiBookingSpeech('08:30 - 10:15'),
    '8 giờ 30 phút đến 10 giờ 15 phút',
  );

  class Utterance { constructor(text) { this.text = text; } }
  const spoken = [];
  const speaker = createAiBookingSpeaker({
    speechSynthesis: { speak: (value) => spoken.push(value), cancel: () => {}, getVoices: () => [] },
    SpeechSynthesisUtterance: Utterance,
  });
  speaker.speak('08:00–09:00');
  assert.equal(spoken[0].text, '8 giờ đến 9 giờ');
});

test('speaker localizes mixed booking terms and uses one Vietnamese utterance', () => {
  assert.deepEqual(
    splitAiBookingSpeechSegments('Xe ở Floor 2. Mã QR trong My Bookings. Xe có VIP.'),
    [{ text: 'Xe ở tầng 2. Mã quy a trong trang đặt chỗ của bạn. Xe có gói ưu tiên.', lang: 'vi-VN' }],
  );

  class Utterance { constructor(text) { this.text = text; } }
  const spoken = [];
  const events = [];
  const synthesis = {
    speak: (utterance) => spoken.push(utterance), cancel: () => {},
    getVoices: () => [{ lang: 'vi-VN', name: 'Vietnamese' }],
  };
  const speaker = createAiBookingSpeaker({ speechSynthesis: synthesis, SpeechSynthesisUtterance: Utterance }, {
    onStart: () => events.push('start'), onEnd: () => events.push('end'),
  });
  speaker.speak('Tầng hiển thị là Floor 2. Mã QR.');
  spoken[0].onstart();
  spoken[0].onend();
  assert.deepEqual(spoken.map((utterance) => [utterance.text, utterance.lang, utterance.voice.name]), [
    ['Tầng hiển thị là tầng 2. Mã quy a.', 'vi-VN', 'Vietnamese'],
  ]);
  assert.equal(spoken[0].rate, 1.18);
  assert.deepEqual(events, ['start', 'end']);
});

test('speaker localizes a complete English backend message', () => {
  assert.deepEqual(
    splitAiBookingSpeechSegments('Vehicle 43B20404 is already in a VIP subscription. Please use your VIP parking slot instead of making a new booking.'),
    [{
      text: 'Xe 4 3 B 2 0 4 0 4 đang có gói ưu tiên. Hãy dùng ô đỗ ưu tiên hoặc chọn biển số khác.',
      lang: 'vi-VN',
    }],
  );
});

test('speech formatter reads dates, money, plates and parking slots clearly', () => {
  assert.equal(
    formatAiBookingSpeech('24/09/2026, 08:30. Xe 47A67890, Floor 1, ô C12, 10.000 VND. PAID.'),
    'ngày 24 tháng 9 năm 2026, 8 giờ 30 phút. Xe 4 7 A 6 7 8 9 0, tầng 1, ô C 1 2, 10000 đồng. đã thanh toán.',
  );
});

test('speaker gracefully falls back when speech synthesis is unavailable', () => {
  assert.equal(createAiBookingSpeaker({}, {}), null);
});

test('voice permission failure is surfaced and unsupported browsers return null', () => {
  class Recognition {}
  let error = '';
  const recognition = createAiBookingRecognition({ webkitSpeechRecognition: Recognition }, {
    onTranscript: () => {}, onError: (value) => { error = value; }, onEnd: () => {},
  });
  recognition.onerror({ error: 'not-allowed' });
  assert.match(error, /cấp quyền micro/);
  assert.equal(createAiBookingRecognition({}, { onTranscript: () => {}, onError: () => {}, onEnd: () => {} }), null);
});

test('one microphone session handles multiple turns and restarts after silence without another click', async () => {
  const instances = [];
  class Recognition {
    constructor() { instances.push(this); this.stops = 0; this.aborts = 0; }
    start() { this.started = true; }
    stop() { this.stops += 1; }
    abort() { this.aborts += 1; }
  }
  const transcripts = [];
  const session = createAiBookingVoiceSession({ SpeechRecognition: Recognition }, {
    onTranscript: (text) => transcripts.push(text), onError: () => {}, onListeningChange: () => {},
  }, 0);
  session.start();
  assert.equal(instances[0].continuous, true);
  instances[0].onresult({ resultIndex: 0, results: [[{ transcript: 'Ngày mai từ 8h đến 9h' }]] });
  assert.deepEqual(transcripts, ['Ngày mai từ 8h đến 9h']);
  assert.equal(instances[0].stops, 1);
  instances[0].onend();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(instances.length, 1, 'must wait for the assistant reply');
  session.resume();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(instances.length, 2);
  instances[1].onend();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(instances.length, 3, 'silence must restart the same user session');
  instances[2].onresult({ resultIndex: 0, results: [[{ transcript: 'Xác nhận đặt' }]] });
  assert.deepEqual(transcripts, ['Ngày mai từ 8h đến 9h', 'Xác nhận đặt']);
  session.stop();
  assert.equal(session.isActive(), false);
  instances[2].onend();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(instances.length, 3);
});

test('microphone permission rejection ends the session instead of retrying forever', () => {
  let recognition;
  class Recognition { constructor() { recognition = this; } start() {} stop() {} abort() {} }
  let error = '';
  const session = createAiBookingVoiceSession({ SpeechRecognition: Recognition }, {
    onTranscript: () => {}, onError: (value) => { error = value; }, onListeningChange: () => {},
  }, 0);
  session.start();
  recognition.onerror({ error: 'not-allowed' });
  assert.equal(session.isActive(), false);
  assert.match(error, /cấp quyền micro/);
});

test('silence does not speak an error and the microphone keeps waiting', async () => {
  const instances = [];
  class Recognition { constructor() { instances.push(this); } start() {} stop() {} abort() {} }
  const errors = [];
  const session = createAiBookingVoiceSession({ SpeechRecognition: Recognition }, {
    onTranscript: () => {}, onError: (value) => errors.push(value), onListeningChange: () => {},
  }, 0);
  session.start();
  instances[0].onerror({ error: 'no-speech' });
  instances[0].onend();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(errors, []);
  assert.equal(instances.length, 2);
  session.stop();
});

test('temporary recognition network errors retry silently', async () => {
  const instances = [];
  class Recognition { constructor() { instances.push(this); } start() {} stop() {} abort() {} }
  const errors = [];
  const session = createAiBookingVoiceSession({ SpeechRecognition: Recognition }, {
    onTranscript: () => {}, onError: (value) => errors.push(value), onListeningChange: () => {},
  }, 0);
  session.start();
  instances[0].onerror({ error: 'network' });
  instances[0].onend();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(errors, []);
  assert.equal(instances.length, 2);
  session.stop();
});

test('duplicate final transcript from a restarted recognizer is submitted once', async () => {
  const instances = [];
  class Recognition { constructor() { instances.push(this); } start() {} stop() {} abort() {} }
  const transcripts = [];
  const session = createAiBookingVoiceSession({ SpeechRecognition: Recognition }, {
    onTranscript: (value) => transcripts.push(value), onError: () => {}, onListeningChange: () => {},
  }, 0);
  session.start();
  instances[0].onresult({ results: [[{ transcript: 'Xác nhận đặt' }]] });
  instances[0].onend();
  session.resume();
  await new Promise((resolve) => setTimeout(resolve, 10));
  instances[1].onresult({ results: [[{ transcript: 'Xác nhận đặt' }]] });
  assert.deepEqual(transcripts, ['Xác nhận đặt']);
  session.stop();
});
