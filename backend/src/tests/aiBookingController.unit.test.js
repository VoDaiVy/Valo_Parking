const test = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../controllers/aiBookingController');

const baseDraft = () => ({
  __intent: 'CREATE_BOOKING',
  __language: 'vi',
  requestedVehicleCount: 2,
  licensePlate: '43A11111',
  licensePlates: ['43A11111', '43A12345'],
  reservationItems: [
    {
      licensePlate: '43A11111',
      startDate: '2026-10-10', endDate: '2026-10-12',
      startTime: '08:00', endTime: '09:00',
      floorName: 'Tầng 2', slotCode: 'E8',
    },
    {
      licensePlate: '43A12345',
      startDate: '2026-10-10', endDate: '2026-10-12',
      startTime: '10:00', endTime: '11:00',
      floorName: 'Tầng 2', slotCode: 'E9',
    },
  ],
});

const interpret = async (prompt, draft) => {
  let statusCode = 200;
  let payload;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      return value;
    },
  };
  await controller.interpret({
    body: { prompt, draft, today: '2026-10-08', currentTime: '14:00' },
    user: { _id: '507f1f77bcf86cd799439011' },
  }, response);
  assert.equal(statusCode, 200);
  assert.equal(payload.success, true);
  return payload.data;
};

test('interpret API keeps the edit target and applies the exact slot correction from chat', async () => {
  const selecting = await interpret('Tôi muốn sửa', baseDraft());
  assert.equal(selecting.draft.pendingReservationEditIndex, -1);
  assert.equal(selecting.draft.pendingReservationEditField, 'target');

  const changed = await interpret('Xe số 1 đổi qua E7.', selecting.draft);
  assert.equal(changed.clarification, undefined);
  assert.equal(changed.draft.reservationItems[0].slotCode, 'E7');
  assert.equal(changed.draft.reservationItems[1].slotCode, 'E9');
  assert.deepEqual(changed.draft.reservationItems.map((item) => [
    item.licensePlate, item.startDate, item.endDate, item.startTime, item.endTime,
  ]), [
    ['43A11111', '2026-10-10', '2026-10-12', '08:00', '09:00'],
    ['43A12345', '2026-10-10', '2026-10-12', '10:00', '11:00'],
  ]);
});

test('interpret API accepts the speech transcript "Sai số một" without asking for known times', async () => {
  const selecting = await interpret('Tôi muốn sửa', baseDraft());
  const selected = await interpret('Sai số một.', selecting.draft);

  assert.equal(selected.draft.pendingReservationEditIndex, 0);
  assert.match(selected.clarification, /sửa thông tin nào.*43A11111/i);
  assert.doesNotMatch(selected.clarification, /từ mấy giờ đến mấy giờ/i);

  const changed = await interpret('Đổi qua E7.', selected.draft);
  assert.equal(changed.clarification, undefined);
  assert.equal(changed.draft.reservationItems[0].slotCode, 'E7');
  assert.equal(changed.draft.reservationItems[1].slotCode, 'E9');
});

test('interpret API changes only the named vehicle time instead of editing the vehicle account', async () => {
  const draft = {
    __intent: 'CREATE_BOOKING',
    __language: 'vi',
    requestedVehicleCount: 2,
    licensePlate: '44A11111',
    licensePlates: ['44A11111', '44B11122'],
    reservationItems: [
      {
        licensePlate: '44A11111',
        startDate: '2026-10-09', endDate: '2026-10-09',
        startTime: '07:00', endTime: '09:00', floorName: 'Tầng 2', slotCode: 'E10',
      },
      {
        licensePlate: '44B11122',
        startDate: '2026-10-09', endDate: '2026-10-09',
        startTime: '07:00', endTime: '09:00', floorName: 'Tầng 2', slotCode: 'E8',
      },
    ],
  };

  const changed = await interpret('Đổi xe 44B11122 thành từ 8 giờ đến 9 giờ.', draft);

  assert.equal(changed.assistantResult, undefined);
  assert.equal(changed.clarification, undefined);
  assert.deepEqual(changed.draft.reservationItems.map((item) => [
    item.licensePlate, item.startTime, item.endTime, item.slotCode,
  ]), [
    ['44A11111', '07:00', '09:00', 'E10'],
    ['44B11122', '08:00', '09:00', 'E8'],
  ]);
});
