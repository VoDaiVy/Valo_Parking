import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiBookingRecognition } from './aiBookingVoice.js';

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
