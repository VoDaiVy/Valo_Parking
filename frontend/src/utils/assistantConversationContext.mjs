import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { getMissingBookingFields } from './aiBookingFlow.js';
import { bookingClarification } from './aiBookingClarification.js';
const { bookingClarification: backendClarification } = createRequire(import.meta.url)('../../../backend/src/services/aiBookingClarification.js');
const { parseBasicVietnameseBooking } = createRequire(import.meta.url)('../../../backend/src/services/aiBookingInterpreter.js');
import { bookingSlotSuggestions, bookingContextSummary, bookingHistoryBeforeTurn, isInformationalAssistantTurn } from './aiBookingContext.js';
import { routeBookingReply, applySlotSuggestionToDraft, applyBookingDraftField } from './aiBookingConversation.js';
import { createAiBookingSnapshot, normalizeAiBookingSession } from './aiBookingSession.js';

test('help and unknown assistant replies preserve booking mode; queued future turns never enter earlier context', () => {
  for (const intent of ['HELP', 'UNKNOWN', 'CHECK_WALLET_BALANCE', 'VIEW_BOOKING']) assert.equal(isInformationalAssistantTurn(intent), true);
  for (const intent of ['CREATE_BOOKING', 'CANCEL_BOOKING', 'MODIFY_BOOKING', 'BOOK_SERVICE']) assert.equal(isInformationalAssistantTurn(intent), false);
  const messages = [{ id: 'one', role: 'user', text: 'đặt hai xe ngày 13 đến 15' },
    { id: 'answer', role: 'assistant', text: 'Bạn muốn đỗ từ mấy giờ?' },
    { id: 'pending', role: 'assistant', text: '...', pending: true },
    { id: 'two', role: 'user', text: '7 giờ đến 8 giờ' },
    { id: 'future', role: 'user', text: 'hủy booking' }];
  const history = bookingHistoryBeforeTurn(messages, 'two');
  assert.deepEqual(history, [{ role: 'user', text: messages[0].text }, { role: 'assistant', text: messages[1].text }]);
  assert.deepEqual(bookingHistoryBeforeTurn(messages, 'missing'), []);
});

test('clarification names the exact pending field and car, and explains where to reply', () => {
  const original = { __intent: 'CREATE_BOOKING', requestedVehicleCount: 2,
    pendingLicensePlate: '43AI211', pendingReservationEditIndex: 0, pendingReservationEditField: 'biển số',
    reservationItems: [{}, { licensePlate: '43B1234' }], startDate: '2099-11-13', endDate: '2099-11-15', startTime: '08:00', endTime: '09:00' };
  for (const language of ['vi', 'en']) {
    const before = structuredClone(original);
    const message = bookingClarification('nhập lại ở đâu', original, language);
    assert.equal(message, backendClarification('nhập lại ở đâu', original, language));
    assert.match(message, /43AI211/);
    assert.match(message, language === 'vi' ? /biển số của xe 1/ : /license plate for vehicle 1/);
    assert.match(message, language === 'vi' ? /ô tin nhắn ở dưới/ : /message box at the bottom/);
    assert.deepEqual(original, before);
  }
  for (const [field, label] of [['startDate', 'ngày vào'], ['endDate', 'ngày ra'], ['startTime', 'giờ vào'], ['endTime', 'giờ ra'], ['slotCode', 'mã ô đỗ'], ['floorName', 'tầng đỗ']]) {
    const draft = { __awaitingField: field };
    const message = bookingClarification('không rõ', draft, 'vi');
    assert.ok(message.includes(label), field);
    assert.equal(message, backendClarification('không rõ', draft, 'vi'));
  }
  const guidance = bookingClarification('nhập lại ở đâu', { __intent: 'CREATE_BOOKING', startDate: '2099-11-13', endDate: '2099-11-15' }, 'vi');
  assert.match(guidance, /giờ vào/);
  assert.doesNotMatch(guidance, /chưa hiểu rõ ngày/);
  const unknown = bookingClarification('zzz', { startDate: '2099-11-13', startTime: '08:00' }, 'vi');
  assert.match(unknown, /thực hiện việc gì/);
});

test('restating screenshot schedule repairs legacy rows and history never asks known dates or times again', () => {
  const previous = { __intent: 'CREATE_BOOKING', requestedVehicleCount: 4,
    reservationItems: Array.from({ length: 4 }, () => ({})) };
  const result = parseBasicVietnameseBooking('Tôi muốn đặt 2 xe từ ngày 13 tháng 11 đến ngày 15 tháng 11 vào lúc 8 giờ đến 9 giờ.',
    '2099-11-11', previous, '07:00', 'vi');
  const snapshot = createAiBookingSnapshot({ bookingDraft: result.draft, intent: 'CREATE_BOOKING' });
  const restored = normalizeAiBookingSession(JSON.parse(JSON.stringify(snapshot))).bookingDraft;
  const missing = getMissingBookingFields(restored, [], Date.parse('2099-11-11T07:00:00+07:00'));
  assert.equal(restored.requestedVehicleCount, 2);
  assert.equal(restored.startDate, '2099-11-13');
  assert.equal(restored.endDate, '2099-11-15');
  assert.equal(restored.startTime, '08:00');
  assert.equal(restored.endTime, '09:00');
  assert.ok(missing.length > 0);
  assert.match(missing.join(' '), /biển số/);
  assert.doesNotMatch(missing.join(' '), /ngày nào|mấy giờ/);
});

const suggestions = [{ sourceIndex: 0, licensePlate: '11X12341', floorName: 'Floor 1', slotCode: 'A3' }, { sourceIndex: 1, licensePlate: '33D2132', floorName: 'Floor 1', slotCode: 'D5' }];
const draft = {
  requestedVehicleCount: 2, licensePlate: '11X12341', licensePlates: ['11X12341', '33D2132'],
  startDate: '2099-11-12', endDate: '2099-11-17', startTime: '08:00', endTime: '08:00', slotCode: 'XE-2',
  reservationItems: [{ licensePlate: '11X12341', serviceIds: ['wash'], serviceNames: ['wash'], voucherId: 'voucher-one' }, { licensePlate: '33D2132', startTime: '09:00', serviceIds: ['demo'], serviceNames: ['demo'] }],
  pendingSlotSuggestion: suggestions[0], pendingSlotSuggestions: suggestions,
  assistantContext: { pendingServiceSelection: { serviceNames: ['demo'], isRemoving: false } },
};

test('contextual approval changes both suggested slots while preserving cars, schedules, services and vouchers', () => {
  for (const text of ['ok đổi đi', 'đổi đi', 'đồng ý đổi', 'ok change them']) assert.equal(routeBookingReply('IDLE', text, { hasSlotSuggestion: true, hasBookingContext: true }), 'accept_suggestion', text);
  const original = structuredClone(draft); const next = applySlotSuggestionToDraft(draft, bookingSlotSuggestions(draft));
  assert.deepEqual(next.reservationItems.map((row) => row.slotCode), ['A3', 'D5']); assert.equal(next.slotCode, '');
  assert.equal(next.reservationItems[0].voucherId, 'voucher-one'); assert.deepEqual(next.reservationItems[1].serviceIds, ['demo']);
  assert.equal(next.reservationItems[1].startTime, '09:00'); assert.equal(next.endDate, draft.endDate);
  assert.deepEqual(next.assistantContext, draft.assistantContext); assert.equal(next.pendingSlotSuggestions, undefined); assert.deepEqual(draft, original);
});

test('references to earlier requests recall known data instead of creating a new booking or accepting it', () => {
  for (const text of ['yêu cầu ở trên', 'như đã nói', 'tiếp tục yêu cầu trước đó', 'my previous request']) assert.equal(routeBookingReply('WAITING_CONFIRMATION', text, { hasBookingContext: true, hasSlotSuggestion: true }), 'recall_context', text);
  const summary = bookingContextSummary(draft, 'vi');
  for (const value of ['11X12341', '33D2132', '2099-11-12', '2099-11-17', '09:00', 'demo', 'A3', 'D5']) assert.ok(summary.includes(value), value);
  assert.ok(summary.includes('chọn xe')); assert.ok(summary.includes('chưa xác nhận'));
});

test('reopening history preserves all slot proposals and pending service context without executing anything', () => {
  const saved = createAiBookingSnapshot({ bookingDraft: draft, intent: 'CREATE_BOOKING', messages: [{ role: 'user', text: 'thêm dịch vụ demo' }] });
  const restored = normalizeAiBookingSession(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(bookingSlotSuggestions(restored.bookingDraft), suggestions);
  assert.deepEqual(restored.bookingDraft.assistantContext, draft.assistantContext);
});

test('changing schedule invalidates old proposals; negative or mixed requests cannot silently accept slots', () => {
  const changed = applyBookingDraftField(draft, 'startTime', '10:00');
  assert.deepEqual(bookingSlotSuggestions(changed), []);
  for (const text of ['không đổi', 'đừng đổi', 'ok đổi đi nhưng xe thứ hai lúc 9h']) assert.notEqual(routeBookingReply('IDLE', text, { hasSlotSuggestion: true }), 'accept_suggestion', text);
});

test('a proposal for an unknown car never changes another car or creates a phantom vehicle', () => {
  const next = applySlotSuggestionToDraft(draft, { sourceIndex: 0, licensePlate: '44F4444', slotCode: 'A9' });
  assert.deepEqual(next.reservationItems, draft.reservationItems);
});

test('short continuation uses the existing draft rather than asking for all booking fields again', () => {
  for (const text of ['ok', 'tiếp tục', 'go ahead']) assert.equal(routeBookingReply('IDLE', text, { hasBookingContext: true }), 'continue_context');
  assert.equal(routeBookingReply('IDLE', 'ok'), 'no_preview');
});

test('approval while a service is awaiting a vehicle cannot confirm a booking or reset the conversation', () => {
  for (const phase of ['IDLE', 'WAITING_CONFIRMATION']) assert.equal(routeBookingReply(phase, 'ok', {
    hasBookingContext: true, hasPendingServiceSelection: true,
  }), 'interpret');
});
