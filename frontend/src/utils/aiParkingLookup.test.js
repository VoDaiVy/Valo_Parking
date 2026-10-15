import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingStatusReply, detectDirectParkingLookup, parkingAvailabilityReply, parkingStatusReply, slotStatusReply } from './aiParkingLookup.js';

test('phân biệt câu hỏi xe đang đỗ với câu hỏi booking', () => {
  assert.deepEqual(detectDirectParkingLookup('Xe 43A12345 có đỗ chưa?]'), {
    intent: 'CHECK_VEHICLE_PARKING_STATUS', licensePlate: '43A12345',
  });
  assert.deepEqual(detectDirectParkingLookup('xe 43a-12345 đã đặt chưa?'), {
    intent: 'CHECK_BOOKING_STATUS', licensePlate: '43A12345',
  });
  for (const message of [
    'xe 43A12345 đã đặt ngày nào chưa',
    'xe 43A12345 đã đặt chỗ ngày nào chưa?',
    '43A12345 đặt lúc nào?',
    'khi nào đã đặt xe 43A12345',
  ]) {
    assert.equal(detectDirectParkingLookup(message)?.intent, 'CHECK_BOOKING_STATUS', message);
  }
  assert.equal(detectDirectParkingLookup('Đặt xe 43A12345 ngày mai từ 8 đến 9 giờ'), null);
  assert.equal(detectDirectParkingLookup('Tôi muốn đặt chỗ ngày mai'), null);
  for (const message of [
    'Tôi có lịch đặt chưa?',
    'Cho xem booking gần nhất',
    'xe 43A12345 còn ở trong bãi không?',
    'xe 43A12345 vào bãi chưa?',
    'xe 41A12345 đã có bãi đỗ chưa',
    'xe 41A12345 đã có chỗ đỗ chưa?',
    'xe 41A12345 đã được xếp ô đỗ chưa?',
    '43A12345 đã có ô đỗ ngày nào chưa?',
    '43A12345 đã có chỗ đỗ ở tầng nào chưa?',
    'xe 43A12345 đã được xếp ô nào chưa?',
  ]) assert.ok(detectDirectParkingLookup(message), message);

  for (const message of [
    'Đặt chỗ cho xe 41A12345 ngày mai',
    'Tôi muốn đặt bãi đỗ cho xe 41A12345',
    'Giúp tôi đặt ô đỗ từ 8 giờ đến 9 giờ',
  ]) assert.equal(detectDirectParkingLookup(message), null, message);
});

test('trả lời trạng thái đỗ từ lịch sử của đúng tài khoản', () => {
  const response = { ok: true, data: { success: true, data: [
    { licensePlate: '43A12345', status: 'active', parkingSlot: 'B7', checkInTime: '2026-09-24T01:00:00.000Z' },
  ] } };
  assert.match(parkingStatusReply(response, '43A12345'), /đang ở trong bãi.*B7/);
  assert.match(parkingStatusReply(response, '43B54321'), /Không tìm thấy lượt đỗ/);
});

test('trả lời booking gần nhất và không nhầm thành tạo booking', () => {
  const response = { ok: true, data: { success: true, data: [
    { licensePlate: '43A12345', status: 'PAID', parkingSlot: 'C2', scheduledStart: '2026-09-25T01:00:00.000Z' },
  ] } };
  assert.match(bookingStatusReply(response, '43A12345'), /đã đặt.*C2/);
  assert.match(bookingStatusReply(response, '43B54321'), /chưa có booking/);
});

test('phân biệt chỗ trống toàn bãi, theo tầng và trạng thái từng ô', () => {
  assert.deepEqual(detectDirectParkingLookup('Toàn bãi còn bao nhiêu chỗ trống?'), {
    intent: 'CHECK_PARKING_AVAILABILITY', floorName: '',
  });
  assert.deepEqual(detectDirectParkingLookup('Tầng 2 còn ô nào trống không?'), {
    intent: 'CHECK_PARKING_AVAILABILITY', floorName: '2',
  });
  assert.deepEqual(detectDirectParkingLookup('Ô A10 tầng 2 có trống không?'), {
    intent: 'CHECK_SLOT_STATUS', slotCode: 'A10', floorName: '2',
  });
  assert.deepEqual(detectDirectParkingLookup('A10 đang được dùng không?'), {
    intent: 'CHECK_SLOT_STATUS', slotCode: 'A10', floorName: '',
  });
  assert.equal(detectDirectParkingLookup('43A12345 đã có ô đỗ ngày nào chưa?')?.intent, 'CHECK_BOOKING_STATUS');
});

test('trả lời số chỗ toàn bãi, từng tầng và trạng thái ô từ bản đồ trực tiếp', () => {
  const response = { ok: true, data: { success: true, data: [
    { id: 'A10', floorName: 'Floor 1', status: 'available' },
    { id: 'A11', floorName: 'Floor 1', status: 'occupied' },
    { id: 'A10', floorName: 'Floor 2', status: 'reserved' },
    { id: 'B7', floorName: 'Floor 2', status: 'available' },
  ] } };
  assert.match(parkingAvailabilityReply(response), /Toàn bãi còn 2\/4.*Floor 1: 1\/2.*Floor 2: 1\/2/);
  assert.match(parkingAvailabilityReply(response, '2'), /Tầng 2 còn 1\/2.*B7/);
  assert.match(slotStatusReply(response, 'A10'), /Có nhiều ô A10/);
  assert.match(slotStatusReply(response, 'A10', '2'), /Floor 2.*đã được đặt/);
});
