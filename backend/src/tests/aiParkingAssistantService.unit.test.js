const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAssistantRequest } = require('../services/aiParkingAssistantService');

const parse = (prompt, draft = {}) => parseAssistantRequest({
  prompt, draft, today: '2026-09-24', currentTime: '10:00',
});

const cases = [
  ['Xe tôi đã vào bãi chưa?', 'CHECK_VEHICLE_PARKING_STATUS'],
  ['Xe tôi đang ở đâu?', 'CHECK_VEHICLE_LOCATION'],
  ['Xe tôi vào bãi lúc mấy giờ?', 'CHECK_VEHICLE_ENTRY_TIME'],
  ['Xe này ra bãi lúc mấy giờ?', 'CHECK_VEHICLE_EXIT_TIME'],
  ['Xe tôi đã đỗ bao lâu?', 'CHECK_VEHICLE_DURATION'],
  ['Phí đỗ hiện tại bao nhiêu?', 'CHECK_PARKING_FEE'],
  ['Booking hôm nay của tôi là gì?', 'CHECK_UPCOMING_BOOKING'],
  ['Cho tôi xem booking sắp tới', 'CHECK_UPCOMING_BOOKING'],
  ['Còn chỗ ở tầng 2 không?', 'CHECK_PARKING_AVAILABILITY'],
  ['Ô A10 có trống không?', 'CHECK_SLOT_STATUS'],
  ['Ví tôi còn bao nhiêu tiền?', 'CHECK_WALLET_BALANCE'],
  ['Booking này đã thanh toán chưa?', 'CHECK_PAYMENT_STATUS'],
  ['Cho tôi xem giao dịch gần đây', 'CHECK_TRANSACTION_HISTORY'],
  ['Tôi có những xe nào?', 'LIST_MY_VEHICLES'],
  ['Thêm xe 43A12345', 'ADD_VEHICLE'],
  ['Đổi tên xe 43A12345 thành xe gia đình', 'UPDATE_VEHICLE'],
  ['Xóa xe 43A12345', 'REMOVE_VEHICLE'],
  ['Có dịch vụ gì?', 'CHECK_SERVICES'],
  ['Đặt dịch vụ rửa xe', 'BOOK_SERVICE'],
  ['Quy định hoàn tiền là gì?', 'CHECK_PARKING_POLICY'],
];

for (const [prompt, expected] of cases) {
  test(`nhận diện: ${prompt}`, () => {
    const result = parse(prompt);
    assert.ok(result, 'phải nhận diện được yêu cầu');
    assert.ok(result.intents.includes(expected), `${result.intents.join(', ')} phải chứa ${expected}`);
  });
}

const conversationalCases = [
  // Trạng thái, vị trí và thời gian của xe
  ['Xe 43A12345 có đang ở trong bãi không?', 'CHECK_VEHICLE_PARKING_STATUS'],
  ['Xe 43A12345 vào bãi chưa?', 'CHECK_VEHICLE_PARKING_STATUS'],
  ['Xe 43A12345 còn ở bãi không?', 'CHECK_VEHICLE_PARKING_STATUS'],
  ['43A12345 đến bãi khi nào?', 'CHECK_VEHICLE_ENTRY_TIME'],
  ['Lúc nào xe 43A12345 check in?', 'CHECK_VEHICLE_ENTRY_TIME'],
  ['Xe 43A12345 đã lấy xe chưa?', 'CHECK_VEHICLE_EXIT_TIME'],
  ['Xe 43A12345 rời bãi lúc nào?', 'CHECK_VEHICLE_EXIT_TIME'],
  ['Xe 43A12345 đang ở tầng nào?', 'CHECK_VEHICLE_LOCATION'],
  ['Tìm vị trí xe 43A12345', 'CHECK_VEHICLE_LOCATION'],
  ['Xe 43A12345 đã gửi được mấy tiếng?', 'CHECK_VEHICLE_DURATION'],
  ['43A12345 ở trong bãi bao lâu rồi?', 'CHECK_VEHICLE_DURATION'],
  ['Xe 43A12345 tới giờ hết bao nhiêu tiền?', 'CHECK_PARKING_FEE'],
  ['Tạm tính phí xe 43A12345 bao nhiêu?', 'CHECK_PARKING_FEE'],

  // Booking và thanh toán
  ['Xe 43A12345 đã đặt ngày nào chưa?', 'CHECK_BOOKING_STATUS'],
  ['43A12345 đặt lúc nào?', 'CHECK_BOOKING_STATUS'],
  ['Tôi có lịch đặt chưa?', 'CHECK_BOOKING_STATUS'],
  ['Cho xem booking gần nhất', 'CHECK_BOOKING_STATUS'],
  ['Xe 41A12345 đã có bãi đỗ chưa?', 'CHECK_BOOKING_STATUS'],
  ['Xe 41A12345 đã có chỗ đỗ chưa?', 'CHECK_BOOKING_STATUS'],
  ['Xe 41A12345 đã được xếp ô đỗ chưa?', 'CHECK_BOOKING_STATUS'],
  ['43A12345 đã có ô đỗ ngày nào chưa?', 'CHECK_BOOKING_STATUS'],
  ['43A12345 đã có chỗ đỗ ở tầng nào chưa?', 'CHECK_BOOKING_STATUS'],
  ['Xe 43A12345 đã được xếp ô nào chưa?', 'CHECK_BOOKING_STATUS'],
  ['Hôm nay tôi có lịch đặt không?', 'CHECK_UPCOMING_BOOKING'],
  ['Lịch đỗ kế tiếp của tôi', 'CHECK_UPCOMING_BOOKING'],
  ['Đơn đặt chỗ này còn nợ không?', 'CHECK_PAYMENT_STATUS'],
  ['Booking đó cần thanh toán không?', 'CHECK_PAYMENT_STATUS'],

  // Chỗ trống và ô đỗ
  ['Bãi xe đầy chưa?', 'CHECK_PARKING_AVAILABILITY'],
  ['Hầm còn chỗ không?', 'CHECK_PARKING_AVAILABILITY'],
  ['Tầng 2 còn ô nào không?', 'CHECK_PARKING_AVAILABILITY'],
  ['Bây giờ có thể đỗ xe không?', 'CHECK_PARKING_AVAILABILITY'],
  ['Ô B7 có ai đỗ chưa?', 'CHECK_SLOT_STATUS'],
  ['Slot C2 đang được dùng không?', 'CHECK_SLOT_STATUS'],

  // Ví, giao dịch, xe, dịch vụ, chính sách và trợ giúp
  ['Kiểm tra số dư ví cho tôi', 'CHECK_WALLET_BALANCE'],
  ['Ví còn đủ tiền không?', 'CHECK_WALLET_BALANCE'],
  ['Lần gần nhất ví bị trừ tiền là khi nào?', 'CHECK_TRANSACTION_HISTORY'],
  ['Cho xem biến động số dư', 'CHECK_TRANSACTION_HISTORY'],
  ['Tôi đã đăng ký những biển số nào?', 'LIST_MY_VEHICLES'],
  ['Tài khoản có bao nhiêu xe?', 'LIST_MY_VEHICLES'],
  ['Bên mình có rửa xe không?', 'CHECK_SERVICES'],
  ['Rửa xe giá bao nhiêu?', 'CHECK_SERVICES'],
  ['Hủy đặt chỗ có được hoàn tiền không?', 'CHECK_PARKING_POLICY'],
  ['Được đỗ tối đa bao lâu?', 'CHECK_PARKING_POLICY'],
  ['Tôi có thể hỏi gì được?', 'HELP'],
];

for (const [prompt, expected] of conversationalCases) {
  test(`hội thoại tự nhiên: ${prompt}`, () => {
    const result = parse(prompt);
    assert.ok(result, 'phải nhận diện được câu hỏi');
    assert.equal(result.intent, expected, `${prompt} => ${result.intents.join(', ')}`);
  });
}

test('câu tạo booking vẫn đi vào luồng đặt chỗ, không bị nhận là tra cứu', () => {
  for (const prompt of [
    'Đặt xe 43A12345 ngày mai từ 8 giờ đến 9 giờ',
    'Tôi muốn đặt chỗ ngày mai',
    'Cho tôi đỗ xe lúc 8 giờ sáng',
    'Đặt 2 xe vào thứ hai tuần tới',
    'Đặt chỗ cho xe 41A12345 ngày mai',
    'Tôi muốn đặt bãi đỗ cho xe 41A12345',
    'Giúp tôi đặt ô đỗ từ 8 giờ đến 9 giờ',
  ]) assert.equal(parse(prompt), null, prompt);
});

test('nhận diện nhiều ý định trong cùng một câu', () => {
  const result = parse('Xe tôi đang ở đâu và phí đỗ hiện tại bao nhiêu?');
  assert.deepEqual(result.intents, ['CHECK_VEHICLE_LOCATION', 'CHECK_PARKING_FEE']);
});

test('câu hỏi có đỗ chưa và đã đặt chưa không bị hiểu thành tạo booking', () => {
  const parked = parse('xe 43a12345 có đỗ chưa');
  assert.equal(parked.intent, 'CHECK_VEHICLE_PARKING_STATUS');
  assert.equal(parked.entities.licensePlate, '43A12345');

  const booked = parse('xe 43a12345 đã đặt chưa');
  assert.equal(booked.intent, 'CHECK_BOOKING_STATUS');
  assert.equal(booked.entities.licensePlate, '43A12345');

  assert.equal(parse('Biển 43A-12345 có booking chưa?').intent, 'CHECK_BOOKING_STATUS');
  assert.equal(parse('Xe của tôi đang đỗ trong bãi không?').intent, 'CHECK_VEHICLE_PARKING_STATUS');
  assert.equal(parse('xe 43A12345 đã đặt ngày nào chưa').intent, 'CHECK_BOOKING_STATUS');
  assert.equal(parse('xe 43A12345 đặt lúc nào?').intent, 'CHECK_BOOKING_STATUS');
});

test('tách biển số và mã ô hợp lệ', () => {
  const vehicle = parse('Xe 43A-12345 đang ở đâu?');
  assert.equal(vehicle.entities.licensePlate, '43A12345');
  const slot = parse('Ô A-10 có trống không?');
  assert.equal(slot.entities.slotCode, 'A-10');
});

test('giữ biển số từ ngữ cảnh cho câu hỏi tiếp theo', () => {
  const result = parse('Phí hiện tại bao nhiêu?', {
    assistantContext: { licensePlate: '43B54321' },
  });
  assert.equal(result.entities.licensePlate, '43B54321');
});

test('tiếp tục thu thập dữ liệu thao tác xe trong nhiều lượt', () => {
  const result = parse('Toyota', {
    assistantContext: { pendingAction: { type: 'ADD_VEHICLE', licensePlate: '43A12345' } },
  });
  assert.equal(result.intent, 'ADD_VEHICLE');
  assert.equal(result.entities.vehicleChanges.brand, 'Toyota');
});

test('tách tên mới và biển số mới khi cập nhật xe', () => {
  const renamed = parse('Đổi tên xe 43A12345 thành xe gia đình');
  assert.equal(renamed.entities.vehicleChanges.nickname, 'xe gia đình');
  const replated = parse('Đổi biển số xe 43A12345 thành 43B54321');
  assert.equal(replated.entities.licensePlate, '43A12345');
  assert.equal(replated.entities.vehicleChanges.licensePlate, '43B54321');
});
