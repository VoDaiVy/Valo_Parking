import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isOutOfScopeInquiry,
  isVipInquiry,
  routeBookingReply,
} from './aiBookingConversation.js';
import { detectDirectParkingLookup } from './aiParkingLookup.js';
import { sanitizeAiBookingPreview } from './aiBookingSession.js';

test('mixed booking and service sentence reaches the interpreter intact', () => {
  assert.equal(routeBookingReply(
    'IDLE',
    'tôi muốn đặt xe từ ngày 1 đến ngày 10/11 cho xe 43D21211 từ 10h đến 11h và thêm dịch vụ demo',
  ), 'interpret');
});

test('booking cancellation action is not mistaken for a policy question', () => {
  assert.equal(routeBookingReply('IDLE', 'hủy booking ngày mai'), 'interpret');
  assert.equal(routeBookingReply('IDLE', 'hủy booking có mất phí không'), 'interpret');
});

test('active vehicle fee lookup is not replaced by the generic price table', () => {
  assert.equal(routeBookingReply('IDLE', 'phí đỗ xe 43D21211 hiện tại bao nhiêu'), 'interpret');
  assert.equal(routeBookingReply('IDLE', 'bảng giá đỗ xe'), 'pricing_info');
});

test('a negative correction edits the preview instead of cancelling it', () => {
  assert.equal(routeBookingReply('WAITING_CONFIRMATION', 'không, đổi giờ ra 12h'), 'interpret');
  assert.equal(routeBookingReply('WAITING_CONFIRMATION', 'hủy'), 'cancel');
});

test('package questions take priority even while a booking awaits confirmation', () => {
  const messages = [
    'Xem các gói.',
    'Cho tôi xem những gói VIP',
    'Có gói tháng không?',
    'Mở bảng giá gói',
    'Show available packages',
    'Do you have a monthly pass?',
  ];
  for (const message of messages) {
    assert.equal(isVipInquiry(message), true, message);
    assert.equal(routeBookingReply('WAITING_CONFIRMATION', message), 'view_vip_packages', message);
  }
});

test('informational detours remain available while a preview is open', () => {
  const cases = [
    ['bảng giá đỗ xe', 'pricing_info'],
    ['có những dịch vụ nào?', 'service_info'],
    ['khi nào bãi đông xe?', 'peak_times_info'],
    ['bạn có thể làm được gì?', 'help'],
    ['xin chào', 'greeting'],
    ['cảm ơn bạn', 'thanks'],
  ];
  for (const [message, expected] of cases) {
    assert.equal(routeBookingReply('WAITING_CONFIRMATION', message), expected, message);
  }
});

test('clearly unrelated questions receive the scoped assistant reminder', () => {
  const messages = [
    'Hôm nay thời tiết có mưa không?',
    'Tỷ số bóng đá hôm nay thế nào?',
    'Kể chuyện cười cho tôi',
    'Giải phương trình này giúp tôi',
    'What is the weather forecast?',
  ];
  for (const message of messages) {
    assert.equal(isOutOfScopeInquiry(message), true, message);
    assert.equal(routeBookingReply('WAITING_CONFIRMATION', message), 'out_of_scope', message);
  }
});

test('valid booking changes are not rejected as unrelated questions', () => {
  const messages = [
    'thêm dịch vụ demo',
    'đổi ngày sang ngày mai',
    'cho xe 43D21211',
    'từ 10h đến 11h',
    'chọn ô H5 tầng 2',
  ];
  for (const message of messages) {
    assert.equal(isOutOfScopeInquiry(message), false, message);
    assert.equal(routeBookingReply('WAITING_CONFIRMATION', message), 'interpret', message);
  }
  assert.equal(routeBookingReply('WAITING_CONFIRMATION', 'Đặt'), 'confirm');
});

test('a pending preview does not block other supported parking requests', () => {
  const messages = [
    'ví của tôi còn bao nhiêu?',
    'xe của tôi đang ở đâu?',
    'xem booking sắp tới',
    'chính sách hủy booking thế nào?',
    'liệt kê các xe của tôi',
    '43D21211',
  ];
  for (const message of messages) {
    assert.equal(routeBookingReply('WAITING_CONFIRMATION', message), 'interpret', message);
  }
});

test('scheduled availability bypasses live-map shortcuts', () => {
  assert.equal(detectDirectParkingLookup('ngày mai còn chỗ trống không'), null);
  assert.equal(detectDirectParkingLookup('ô E7 ngày mai có trống không'), null);
  assert.equal(detectDirectParkingLookup('bây giờ còn chỗ trống không').intent, 'CHECK_PARKING_AVAILABILITY');
});

test('resumable preview keeps wallet and VIP quote metadata', () => {
  const preview = sanitizeAiBookingPreview({
    items: [{ licensePlate: '43D21211' }], total: 100000,
    walletBalance: 25000, suggestVipPackage: true,
  });
  assert.equal(preview.walletBalance, 25000);
  assert.equal(preview.suggestVipPackage, true);
});
