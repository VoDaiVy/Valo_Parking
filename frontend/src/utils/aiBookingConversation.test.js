import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBookingDraftField, applyMapSlotSelectionToDraft, applySingleVehicleSelectionToDraft, applySlotSuggestionToDraft, bookingPreviewSummary, bookingSuccessSummary, resolveContextualVehicleReply, routeAssistantActionReply, routeBookingReply, vipPlatePrompt } from './aiBookingConversation.js';

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

test('selecting an available map slot replaces the stale floor and slot in a single-vehicle draft', () => {
  const result = applyMapSlotSelectionToDraft({
    floorName: 'Floor 2', slotCode: 'A-015',
    pendingSlotSuggestion: { floorName: 'Floor 3', slotCode: 'B2' },
    reservationItems: [{ licensePlate: '43A12345', floorName: 'Floor 2', slotCode: 'A-015' }],
  }, { floorName: 'Floor 1', slotCode: 'e7' });
  assert.equal(result.floorName, 'Floor 1');
  assert.equal(result.slotCode, 'E7');
  assert.equal(result.zoneName, '');
  assert.equal(result.pendingSlotSuggestion, undefined);
  assert.deepEqual(
    [result.reservationItems[0].floorName, result.reservationItems[0].slotCode],
    ['Floor 1', 'E7'],
  );
});

test('map selection assigns separate slots to the selected vehicle in a multi-vehicle draft', () => {
  const draft = {
    requestedVehicleCount: 2,
    licensePlates: ['43A12345', '43B20404'],
    startDate: '2099-01-15', endDate: '2099-01-15', startTime: '08:00', endTime: '09:00',
  };
  const first = applyMapSlotSelectionToDraft(draft, {
    sourceIndex: 0, floorName: 'Floor 1', slotCode: 'A1',
  });
  const second = applyMapSlotSelectionToDraft(first, {
    sourceIndex: 1, floorName: 'Floor 2', slotCode: 'B2',
  });
  assert.deepEqual(second.reservationItems.map((item) => [item.licensePlate, item.floorName, item.slotCode]), [
    ['43A12345', 'Floor 1', 'A1'],
    ['43B20404', 'Floor 2', 'B2'],
  ]);
  assert.equal(second.slotCode, '');
});

test('switching a multi-vehicle draft to one vehicle removes stale reservation items', () => {
  const result = applySingleVehicleSelectionToDraft({
    requestedVehicleCount: 2,
    licensePlates: ['43A12345', '43B20404'],
    blockedVipPlate: '43B20404',
    reservationItems: [
      { licensePlate: '43A12345', startDate: '2099-01-15' },
      { licensePlate: '43B20404', startDate: '2099-01-16' },
    ],
  }, { _id: 'vehicle-3', licensePlate: '43C34567' });
  assert.equal(result.requestedVehicleCount, 1);
  assert.equal(result.licensePlate, '43C34567');
  assert.equal(result.reservationItems.length, 1);
  assert.equal(result.reservationItems[0].licensePlate, '43C34567');
  assert.equal(result.blockedVipPlate, '');
});

test('changing a shared floor clears stale slots in root and reservation items', () => {
  const result = applyBookingDraftField({
    floorName: 'Floor 2', slotCode: 'A-015',
    reservationItems: [{ floorName: 'Floor 2', zoneName: 'A', slotCode: 'A-015' }],
  }, 'floorName', 'Floor 1');
  assert.deepEqual([result.floorName, result.slotCode], ['Floor 1', '']);
  assert.deepEqual(
    [result.reservationItems[0].floorName, result.reservationItems[0].zoneName, result.reservationItems[0].slotCode],
    ['Floor 1', '', ''],
  );
});

test('editing one vehicle schedule preserves the other vehicle schedule', () => {
  const result = applyBookingDraftField({
    requestedVehicleCount: 2,
    licensePlates: ['43A12345', '43B20404'],
    startDate: '2099-01-15', endDate: '2099-01-15', startTime: '08:00', endTime: '09:00',
    reservationItems: [
      { licensePlate: '43A12345', startDate: '2099-01-15', endDate: '2099-01-15', startTime: '08:00', endTime: '09:00' },
      { licensePlate: '43B20404', startDate: '2099-01-15', endDate: '2099-01-15', startTime: '08:00', endTime: '09:00' },
    ],
  }, 'startTime', '10:00', { sourceIndex: 1 });
  assert.equal(result.reservationItems[0].startTime, '08:00');
  assert.equal(result.reservationItems[1].startTime, '10:00');
  assert.equal(result.startTime, '');
});

test('top-up and QR requests are routed to payment while a booking preview is waiting', () => {
  for (const message of [
    'Nạp thêm.', 'Nạp tiền', 'Nạp ví', 'Tôi muốn nạp thêm', 'Thêm tiền',
    'Thanh toán', 'Thanh toán bằng QR', 'Quét mã QR', 'Hiện mã QR',
    'Cho tôi mã QR', 'QR', 'Top up', 'Chuyển khoản',
  ]) {
    assert.equal(routeBookingReply('WAITING_CONFIRMATION', message), 'top_up', message);
    assert.equal(routeBookingReply('IDLE', message), 'interpret', message);
  }
  assert.notEqual(routeBookingReply('WAITING_CONFIRMATION', 'Không nạp thêm'), 'top_up');
  assert.equal(routeBookingReply('WAITING_CONFIRMATION', 'Nạp thêm nhưng đổi giờ'), 'interpret');
});

test('English confirmation, cancellation, correction, and top-up phrases route safely', () => {
  for (const message of ['Yes', 'Confirm booking', 'Book it', 'Go ahead', 'Looks good']) {
    assert.equal(routeBookingReply('WAITING_CONFIRMATION', message), 'confirm', message);
  }
  for (const message of ['No', 'Cancel it', 'Never mind', 'Do not book']) {
    assert.equal(routeBookingReply('WAITING_CONFIRMATION', message), 'cancel', message);
  }
  for (const message of ['Top up wallet', 'Show QR code', 'Pay by QR']) {
    assert.equal(routeBookingReply('WAITING_CONFIRMATION', message), 'top_up', message);
  }
  assert.equal(routeBookingReply('WAITING_CONFIRMATION', 'Change the time to 9 AM'), 'interpret');
  assert.notEqual(routeBookingReply('WAITING_CONFIRMATION', 'No, go ahead'), 'confirm');
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
  for (const message of ['Đổi thành 9h đến 10h', 'Chuyển sang tầng 3', 'Xe số 1 đổi qua E7', 'Biển số 43A12345', 'Ngày mai từ 19h đến 20h', 'Tôi muốn đặt vào buổi tối', 'buổi sáng']) {
    assert.equal(routeBookingReply('WAITING_CONFIRMATION', message), 'interpret', message);
  }
});

test('summary uses actual quoted date, car, slot, time and price', () => {
  const summary = bookingPreviewSummary({
    items: [{ date: '2026-09-23', licensePlate: '43B20404', floorName: 'Floor 1', slotCode: 'B2' }],
    durationMinutes: 60, total: 20000,
  }, { startTime: '08:00', endTime: '09:00' });
  for (const fragment of ['23/09/2026', '08:00', '09:00', '43B20404', 'Floor 1', 'B2', '20.000đ']) {
    assert.ok(summary.includes(fragment), fragment);
  }
  assert.match(summary, /xác nhận/i);
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
  assert.match(summary, /43A12345: 24\/09\/2026 08:00 đến 24\/09\/2026 09:00/);
  assert.match(summary, /47A67890: 25\/09\/2026 09:00 đến 25\/09\/2026 11:00/);
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
    '2 xe, 28/09/2026 08:00 đến 28/09/2026 09:00:\n- 43A12345: Tầng 1, ô B7\n- 43B54321: Tầng 1, ô C5\nTổng 20.000đ. Xác nhận đặt 2 chỗ?');
  assert.equal((summary.match(/28\/09\/2026/g) || []).length, 2);
  assert.equal((summary.match(/08:00/g) || []).length, 1);
});

test('English preview and success summaries contain no Vietnamese fragments', () => {
  const preview = {
    total: 25000, walletBalance: 100000,
    items: [{
      licensePlate: '43A12345', floorName: 'Tầng 2', slotCode: 'E9',
      startTime: '2026-10-05T01:00:00.000Z', endTime: '2026-10-05T02:00:00.000Z',
    }],
  };
  const summary = bookingPreviewSummary(preview, {}, 'en');
  const success = bookingSuccessSummary(preview.items, 'en');
  assert.match(summary, /Vehicle 43A12345/);
  assert.match(summary, /Floor 2, slot E9/);
  assert.match(success, /Booking completed/);
  assert.doesNotMatch(`${summary} ${success}`, /\b(?:Xe|Tầng|ô|đặt|chỗ|ngày|giờ)\b/iu);
});

test('a confirmation accepts an offered alternative slot only when one is pending', () => {
  assert.equal(routeBookingReply('IDLE', 'Ok', { hasSlotSuggestion: true }), 'accept_suggestion');
  assert.equal(routeBookingReply('IDLE', 'Lấy ô gợi ý', { hasSlotSuggestion: true }), 'accept_suggestion');
  assert.equal(routeBookingReply('IDLE', 'Use the suggested slot', { hasSlotSuggestion: true }), 'accept_suggestion');
  assert.equal(routeBookingReply('IDLE', 'Ok'), 'no_preview');
});

test('short ordinal and other-car answers resolve against approved registered vehicles', () => {
  const vehicles = [
    { status: 'approved', licensePlate: '43A12345' },
    { status: 'approved', licensePlate: '43B20404' },
    { status: 'pending', licensePlate: '43C99999' },
  ];
  assert.equal(resolveContextualVehicleReply('The second one', vehicles, {}, 'en'), 'License plate 43B20404');
  assert.equal(resolveContextualVehicleReply('xe thứ hai', vehicles, {}, 'vi'), 'Biển số 43B20404');
  assert.equal(resolveContextualVehicleReply('the other car', vehicles, { licensePlate: '43A12345' }, 'en'), 'License plate 43B20404');
  assert.equal(resolveContextualVehicleReply('the other car', [...vehicles, { status: 'approved', licensePlate: '43D88888' }], {}, 'en'), 'the other car');
  assert.equal(resolveContextualVehicleReply('xe 1', vehicles, {
    pendingReservationEditIndex: -1, pendingReservationEditField: 'target',
  }, 'vi'), 'xe 1');
  assert.equal(resolveContextualVehicleReply('The first one', vehicles, {
    pendingReservationEditIndex: -1, pendingReservationEditField: 'target',
  }, 'en'), 'The first one');
});

test('a slot suggestion updates only the affected reservation item', () => {
  const draft = {
    pendingSlotSuggestion: { sourceIndex: 1, floorName: 'Floor 2', slotCode: 'C3' },
    requestedVehicleCount: 2,
    reservationItems: [
      { licensePlate: '43A12345', slotCode: 'A1' },
      { licensePlate: '43B20404', slotCode: 'B2' },
    ],
  };
  const result = applySlotSuggestionToDraft(draft, draft.pendingSlotSuggestion);
  assert.equal(result.pendingSlotSuggestion, undefined);
  assert.deepEqual(result.reservationItems, [
    { licensePlate: '43A12345', slotCode: 'A1', startDate: '', endDate: '', startTime: '', endTime: '', floorName: '', zoneName: '' },
    { licensePlate: '43B20404', slotCode: 'C3', startDate: '', endDate: '', startTime: '', endTime: '', floorName: 'Floor 2', zoneName: '' },
  ]);
});

test('a multi-vehicle shared draft becomes source-aware before applying a suggestion', () => {
  const draft = {
    requestedVehicleCount: 2,
    licensePlates: ['43A12345', '43B20404'],
    startDate: '2026-10-10', endDate: '2026-10-10', startTime: '08:00', endTime: '09:00',
    floorName: 'Floor 9',
  };
  const result = applySlotSuggestionToDraft(draft, { sourceIndex: 0, floorName: 'Floor 1', slotCode: 'B2' });
  assert.equal(result.reservationItems[0].slotCode, 'B2');
  assert.equal(result.reservationItems[0].floorName, 'Floor 1');
  assert.equal(result.reservationItems[1].slotCode, '');
  assert.equal(result.reservationItems[1].floorName, 'Floor 9');
});
