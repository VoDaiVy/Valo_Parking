import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeAiBookingMessage } from './aiBookingMessages.js';

test('translates overlapping vehicle errors from bulk booking', () => {
  assert.equal(
    localizeAiBookingMessage('Vehicle 43A12345 already has another booking overlapping with this time'),
    'Xe 43A12345 đã có lượt đặt chỗ trùng khung giờ này',
  );
});

test('localizes mixed product terms in assistant chat', () => {
  assert.equal(
    localizeAiBookingMessage('Booking PAID ở Floor 2. QR trong My Bookings. 10.000 VND.'),
    'lượt đặt chỗ đã thanh toán ở Tầng 2. mã xác nhận trong trang đặt chỗ của bạn. 10.000 đồng.',
  );
});

test('unknown English server errors never leak into the chat', () => {
  assert.equal(
    localizeAiBookingMessage('Unexpected payment gateway error'),
    'Không thể hoàn tất yêu cầu đặt chỗ. Vui lòng kiểm tra thông tin và thử lại.',
  );
});

test('keeps an existing Vietnamese response intact', () => {
  assert.equal(localizeAiBookingMessage('Xe này đã có lịch trùng giờ.'), 'Xe này đã có lịch trùng giờ.');
});

test('keeps one booking item on each line after localization', () => {
  assert.equal(
    localizeAiBookingMessage('Đặt xong 2 chỗ:\n- xe 43A12345, Floor 1, ô A1\n- xe 43B54321, Floor 2, ô B2\nQR trong My Bookings.'),
    'Đặt xong 2 chỗ:\n- xe 43A12345, Tầng 1, ô A1\n- xe 43B54321, Tầng 2, ô B2\nmã xác nhận trong trang đặt chỗ của bạn.',
  );
});

test('translates common network, slot, cancellation and subscription errors', () => {
  assert.equal(localizeAiBookingMessage('Network error'), 'Lỗi kết nối mạng. Vui lòng thử lại');
  assert.equal(localizeAiBookingMessage('Slot already booked'), 'Ô đỗ đã có người đặt');
  assert.equal(localizeAiBookingMessage('Too late to cancel'), 'Đã quá thời hạn hủy lượt đặt chỗ');
  assert.equal(localizeAiBookingMessage('VIP restriction'), 'Hạn chế đối với xe có gói ưu tiên');
  assert.equal(localizeAiBookingMessage('Booking is no longer cancellable'), 'Lượt đặt chỗ không còn đủ điều kiện hủy');
  assert.equal(
    localizeAiBookingMessage('An unknown service response was returned'),
    'Không thể hoàn tất yêu cầu đặt chỗ. Vui lòng kiểm tra thông tin và thử lại.',
  );
});

test('English mode never emits Vietnamese for any Quick Booking message family', () => {
  const vietnameseMarker = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/iu;
  const messages = [
    'Mình đã ghi 12345. Hãy đọc tiếp phần còn lại của biển số.',
    'Bạn muốn bắt đầu đỗ ngày nào?',
    'Bạn muốn kết thúc lúc mấy giờ ngày 05/10/2026?',
    'Bạn muốn dùng xe nào? Hãy chọn xe hoặc cho biết biển số.',
    'Xe 2 bắt đầu đỗ lúc mấy giờ?',
    'Biển số 43A12 không hợp lệ. Hãy dùng biển ô tô hợp lệ.',
    'Khoảng thời gian chưa hợp lệ.',
    'Giờ bắt đầu ngày 05/10/2026 đã qua.',
    'Xe 43A12345 cần đặt tối thiểu 30 phút.',
    'Số dư ví chưa đủ. Cần thêm 25.000 VND.',
    'Thông tin chỗ hoặc giá đã thay đổi. Hãy xác nhận lại nếu bạn đồng ý.',
    'Đã hủy bản xem trước. Chưa có booking nào được tạo.',
    'Một thông báo tiếng Việt mới chưa có trong danh mục.',
  ];
  for (const message of messages) {
    const translated = localizeAiBookingMessage(message, 'en');
    assert.equal(vietnameseMarker.test(translated), false, `${message} -> ${translated}`);
    assert.match(translated, /[a-z]/i);
  }
  assert.equal(
    localizeAiBookingMessage('Mình đã ghi 12345. Hãy đọc tiếp phần còn lại của biển số.', 'en'),
    'I recorded 12345. Please provide the rest of the license plate.',
  );
});

test('Vietnamese mode never emits an English server response', () => {
  const englishCases = [
    'I recorded 12345. Please provide the rest of the license plate.',
    'Which floor would you like?',
    'The booking request failed because the selected slot is occupied.',
  ];
  for (const message of englishCases) {
    const localized = localizeAiBookingMessage(message, 'vi');
    assert.doesNotMatch(localized, /\b(?:which|would|please|the|selected|occupied)\b/i);
    assert.doesNotMatch(localized, /\bI(?:'\w+)?\b/);
  }
});
