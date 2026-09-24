import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingPreviewSummary, bookingSuccessSummary, routeAssistantActionReply, routeBookingReply, vipPlatePrompt } from './aiBookingConversation.js';

test('only explicit standalone confirmation can book an existing preview', () => {
  for (const message of [
    'Đặt', 'Đặt.', 'Đặt chỗ', 'Đặt đi', 'Đặt luôn', 'Đặt cho tôi',
    'OK', 'Oke', 'Okay', 'OK đặt đi', 'Ừ', 'Ừm', 'Dạ', 'Vâng', 'Có',
    'Được', 'Được rồi', 'Chốt', 'Chốt đi', 'Chỗ.', 'Làm đi', 'Tiếp tục',
    'Xác nhận đặt.', 'Tôi đồng ý', 'Xác nhận', 'Đồng ý', 'Ok đặt',
    'Được, đặt cho tôi', 'Tiến hành đặt', 'xac nhan dat',
    'Dạ, xác nhận đặt nhé', 'Tôi muốn xác nhận đặt chỗ',
  ]) {
    assert.equal(routeBookingReply('WAITING_CONFIRMATION', message), 'confirm', message);
    assert.equal(routeBookingReply('IDLE', message), 'no_preview', message);
  }
});

test('negative and mixed replies never confirm a booking', () => {
  for (const message of ['Không', 'Hủy', 'Không đặt nữa', 'Thôi', 'Hủy đặt', 'Tôi không đồng ý', 'Thôi không đặt']) {
    assert.equal(routeBookingReply('WAITING_CONFIRMATION', message), 'cancel', message);
    assert.equal(routeBookingReply('IDLE', message), 'cancel_draft', message);
  }
  for (const message of ['Tôi không xác nhận đặt', 'Xác nhận hủy booking', 'Không, tôi đồng ý', 'Ừ không đặt', 'OK nhưng đổi giờ', 'Đặt ngày mai', 'Xác nhận đặt ngày mai']) {
    assert.notEqual(routeBookingReply('WAITING_CONFIRMATION', message), 'confirm', message);
  }
  assert.equal(routeBookingReply('IDLE', 'tối'), 'interpret');
  assert.equal(routeBookingReply('IDLE', 'Thôi.'), 'cancel_draft');
});

test('vehicle actions accept natural confirmation without weakening booking confirmation', () => {
  assert.equal(routeAssistantActionReply('Đồng ý xóa xe'), 'confirm');
  assert.equal(routeAssistantActionReply('Thêm đi'), 'confirm');
  assert.equal(routeAssistantActionReply('Không xóa nữa'), 'cancel');
  assert.equal(routeAssistantActionReply('Đổi sang màu trắng'), 'interpret');
});

test('short VIP prompt asks only for a replacement plate and confirms retained schedule', () => {
  const prompt = vipPlatePrompt('43B20404');
  assert.equal(prompt, 'Xe 43B20404 có VIP. Hãy đọc hoặc nhập biển số khác; mình giữ nguyên ngày giờ.');
});

test('success response includes the assigned floor and parking slot for every booking', () => {
  const single = bookingSuccessSummary([
    { date: '2026-09-24', licensePlate: '43A12345', floorName: 'Floor 1', slotCode: 'A10' },
  ]);
  assert.match(single, /43A12345.*Floor 1.*ô A10/);
  const multiple = bookingSuccessSummary([
    { date: '2026-09-24', licensePlate: '43A12345', floorName: 'Floor 1', slotCode: 'A10' },
    { date: '2026-09-24', licensePlate: '43B20404', floorName: 'Floor 2', slotCode: 'B4' },
  ]);
  assert.equal(multiple,
    'Đặt xong 2 chỗ:\n- 24/09/2026: xe 43A12345, Floor 1, ô A10\n- 24/09/2026: xe 43B20404, Floor 2, ô B4\nQR trong My Bookings.');
  assert.equal(multiple.split('\n').length, 4);
});

test('draft changes route through interpretation and a fresh quote', () => {
  for (const message of ['Đổi thành 9h đến 10h', 'Chuyển sang tầng 3', 'Biển số 43A12345', 'Ngày mai từ 19h đến 20h', 'Tôi muốn đặt vào buổi tối', 'buổi sáng']) {
    assert.equal(routeBookingReply('WAITING_CONFIRMATION', message), 'interpret', message);
  }
});

test('summary uses actual quoted date, car, slot, time and price', () => {
  const summary = bookingPreviewSummary({
    items: [{ date: '2026-09-23', licensePlate: '43B20404', floorName: 'Floor 1', slotCode: 'B2' }],
    durationMinutes: 60, total: 20000,
  }, { startTime: '08:00', endTime: '09:00' });
  for (const fragment of ['23/09/2026', '08:00', '09:00', '43B20404', 'Floor 1', 'B2', '20.000đ', 'Xác nhận']) {
    assert.ok(summary.includes(fragment), fragment);
  }
});

test('multi-day summary names every booking day and warns before an unaffordable confirmation', () => {
  const summary = bookingPreviewSummary({
    items: [
      { date: '2026-09-26', licensePlate: '43B20404', floorName: 'Floor 1', slotCode: 'B2' },
      { date: '2026-09-27', licensePlate: '43B20404', floorName: 'Floor 2', slotCode: 'E1' },
    ], durationMinutes: 60, total: 40000, walletBalance: 10000,
  }, { startTime: '08:00', endTime: '09:00' });
  assert.match(summary, /26\/09\/2026.*27\/09\/2026/s);
  assert.match(summary, /Floor 1.*Floor 2/s);
  assert.match(summary, /Ví chưa đủ tiền/);
  assert.doesNotMatch(summary, /có muốn xác nhận/);
});

test('multiple-item confirmation lists the actual date and time of every vehicle', () => {
  const summary = bookingPreviewSummary({
    items: [
      { date: '2026-09-24', startTime: '2026-09-24T01:00:00.000Z', endTime: '2026-09-24T02:00:00.000Z', licensePlate: '43A12345', floorName: 'Floor 1', slotCode: 'C1' },
      { date: '2026-09-25', startTime: '2026-09-25T02:00:00.000Z', endTime: '2026-09-25T04:00:00.000Z', licensePlate: '47A67890', floorName: 'Floor 2', slotCode: 'D4' },
    ],
    quotes: [{ totalAmount: 10000 }, { totalAmount: 20000 }], total: 30000, walletBalance: 100000,
  });
  assert.match(summary, /43A12345: 24\/09\/2026, 08:00–09:00/);
  assert.match(summary, /47A67890: 25\/09\/2026, 09:00–11:00/);
  assert.match(summary, /Tổng 30\.000đ/);
  assert.match(summary, /xác nhận đặt 2 chỗ/i);
});

test('vehicles sharing one schedule mention the date and time only once', () => {
  const summary = bookingPreviewSummary({
    items: [
      { date: '2026-09-28', startTime: '2026-09-28T01:00:00.000Z', endTime: '2026-09-28T02:00:00.000Z', licensePlate: '43A12345', floorName: 'Tầng 1', slotCode: 'B7' },
      { date: '2026-09-28', startTime: '2026-09-28T01:00:00.000Z', endTime: '2026-09-28T02:00:00.000Z', licensePlate: '43B54321', floorName: 'Tầng 1', slotCode: 'C5' },
    ],
    quotes: [{ totalAmount: 10000 }, { totalAmount: 10000 }], total: 20000, walletBalance: 100000,
  });
  assert.equal(summary,
    '2 xe, 28/09/2026, 08:00–09:00:\n- 43A12345: Tầng 1, ô B7\n- 43B54321: Tầng 1, ô C5\nTổng 20.000đ. Xác nhận đặt 2 chỗ?');
  assert.equal((summary.match(/28\/09\/2026/g) || []).length, 1);
  assert.equal((summary.match(/08:00–09:00/g) || []).length, 1);
});
