import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAiBookingLanguage } from './aiBookingLanguage.js';

test('client language selection follows the current utterance and short-turn context', () => {
  assert.equal(detectAiBookingLanguage('I need a parking spot tomorrow', 'vi'), 'en');
  assert.equal(detectAiBookingLanguage('Tôi cần parking ngày mai', 'en'), 'vi');
  assert.equal(detectAiBookingLanguage('43A12345', 'en'), 'en');
  assert.equal(detectAiBookingLanguage('43A12345', 'vi'), 'vi');
  assert.equal(detectAiBookingLanguage('Yes', 'vi'), 'en');
  assert.equal(detectAiBookingLanguage('Đồng ý', 'en'), 'vi');
});
