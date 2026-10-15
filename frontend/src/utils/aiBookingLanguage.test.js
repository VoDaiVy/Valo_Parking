import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAiBookingLanguage, inferAiBookingConversationLanguage } from './aiBookingLanguage.js';

test('client language selection follows the current utterance and short-turn context', () => {
  assert.equal(detectAiBookingLanguage('I need a parking spot tomorrow', 'vi'), 'en');
  assert.equal(detectAiBookingLanguage('Tôi cần parking ngày mai', 'en'), 'vi');
  assert.equal(detectAiBookingLanguage('43A12345', 'en'), 'en');
  assert.equal(detectAiBookingLanguage('43A12345', 'vi'), 'vi');
  assert.equal(detectAiBookingLanguage('Yes', 'vi'), 'en');
  assert.equal(detectAiBookingLanguage('Đồng ý', 'en'), 'vi');
});

test('restored voice sessions keep their explicit or conversational language', () => {
  assert.equal(inferAiBookingConversationLanguage({ __language: 'en' }, [
    { role: 'assistant', content: 'Xin chào' },
  ]), 'en');
  assert.equal(inferAiBookingConversationLanguage({}, [
    { role: 'assistant', content: 'Hello! I can book a parking space.' },
  ]), 'en');
  assert.equal(inferAiBookingConversationLanguage({}, [
    { role: 'assistant', content: 'Hello! I can book a parking space.' },
    { role: 'user', content: 'Tôi muốn đặt chỗ ngày mai' },
  ]), 'vi');
});
