import test from 'node:test';
import assert from 'node:assert/strict';
import { findAiBookingVoucherOffer, applyAiVoucherToDraft, routeAiVoucherOfferReply, isAiVoucherOfferCurrent, aiVoucherOfferMessage, aiVoucherEligibilityMessage, clarifyAiVoucherOffer } from './aiBookingVouchers.js';
import { prepareAiBooking, confirmAiBooking } from './aiBookingFlow.js';
import { bookingPreviewSummary, routeBookingReply } from './aiBookingConversation.js';
const ok = (data) => ({ ok: true, data: { success: true, data } });
const now = Date.parse('2026-11-11T00:00:00Z');
const code = (overrides = {}) => ({ _id: 'unit-voucher', status: 'available', bookingId: null, expiresAt: '2099-12-01', benefitSnapshot: { name: 'Unit discount', type: 'FIXED_DISCOUNT', minimumAmount: 10000, discountAmount: 5000 }, ...overrides });
const preview = { items: [{ clientItemId: 'car-1', licensePlate: '33C3333', serviceIds: [] }, { clientItemId: 'car-2', licensePlate: '44F4444', serviceIds: [] }], quotes: [{ totalAmount: 20000 }, { totalAmount: 20000 }], total: 40000, walletBalance: 50000 };
function voucherGateway(vouchers = [code()]) {
  const requests = [];
  return { requests, getMyVouchers: async () => ok(vouchers), quoteBulkBooking: async (payload) => {
    requests.push(payload); return ok({ grandTotal: 35000, itemErrors: [], items: payload.items.map((item, index) => ({ clientItemId: item.clientItemId, voucherId: item.voucherId, voucherDiscount: index === 0 ? 5000 : 0, totalAmount: index === 0 ? 15000 : 20000 })) });
  } };
}
test('eligible voucher is offered using a real quote contract, without changing the preview or applying it', async () => {
  const gateway = voucherGateway(); const original = structuredClone(preview);
  const offer = await findAiBookingVoucherOffer(preview, {}, gateway, { now });
  assert.equal(offer.voucherId, 'unit-voucher'); assert.equal(offer.discount, 5000); assert.equal(offer.total, 35000);
  assert.deepEqual(preview, original); assert.equal(gateway.requests[0].items[0].voucherId, 'unit-voucher'); assert.equal(gateway.requests[0].items[1].voucherId, undefined);
  assert.ok(aiVoucherOfferMessage(offer, 'vi', 2).includes('xe đầu tiên'));
});

test('screenshot reward explains a 50000 minimum against a 30000 quote instead of silently omitting it', async () => {
  const reward = code({ benefitSnapshot: { name: 'Monthly spending reward', type: 'FIXED_DISCOUNT', minimumAmount: 50000, discountAmount: 20000 } });
  const current = { items: [preview.items[0]], quotes: [{ totalAmount: 30000 }], total: 30000 };
  const gateway = voucherGateway([reward]);
  assert.equal(await findAiBookingVoucherOffer(current, {}, gateway, { now }), null);
  assert.equal(gateway.requests.length, 0);
  for (const language of ['vi', 'en']) {
    const message = aiVoucherEligibilityMessage(current, [reward], language, now);
    assert.match(message, /50[.,]000/);
    assert.match(message, /30[.,]000/);
    assert.match(message, /20[.,]000/);
    assert.match(message, language === 'vi' ? /chưa được áp dụng/ : /has not been applied/);
  }
  assert.equal(aiVoucherEligibilityMessage(current, [code({ expiresAt: '2020-01-01' })], 'vi', now), '');
  const eligible = { ...current, total: 50000, quotes: [{ totalAmount: 50000 }] };
  const offer = await findAiBookingVoucherOffer(eligible, {}, {
    quoteBulkBooking: async (payload) => ok({ grandTotal: 30000, items: [{ clientItemId: payload.items[0].clientItemId,
      voucherId: reward._id, voucherDiscount: 20000, totalAmount: 30000 }] }),
  }, { vouchers: [reward], now });
  assert.equal(offer.discount, 20000);
  assert.equal(offer.total, 30000);
  assert.match(aiVoucherOfferMessage(offer, 'vi'), /có muốn dùng mã này không/);
  for (const reply of ['sử dụng', 'sửa dụng', 'use it']) assert.equal(routeAiVoucherOfferReply(reply), 'accept');
});
test('no inventory, expired/reserved/revoked vouchers or unmet per-vehicle minimum produce no offer', async () => {
  for (const vouchers of [[], [code({ expiresAt: '2026-11-10' })], [code({ bookingId: 'reserved' })], [code({ status: 'revoked' })], [code({ benefitSnapshot: { type: 'FIXED_DISCOUNT', minimumAmount: 30000, discountAmount: 5000 } })]]) {
    const gateway = voucherGateway(vouchers); assert.equal(await findAiBookingVoucherOffer(preview, {}, gateway, { now }), null); assert.equal(gateway.requests.length, 0);
  }
});
test('existing or declined vouchers are not repeatedly offered and do not trigger quote requests', async () => {
  for (const draft of [{ voucherId: 'existing' }, { reservationItems: [{ voucherId: 'existing' }] }, { assistantContext: { declinedVoucherIds: ['unit-voucher'] } }]) {
    const gateway = voucherGateway(); assert.equal(await findAiBookingVoucherOffer(preview, draft, gateway, { now }), null); assert.equal(gateway.requests.length, 0);
  }
});
test('quote errors, wrong voucher ids, zero saving or a changed base price never produce a false discount offer', async () => {
  for (const data of [
    { grandTotal: 35000, itemErrors: [{ code: 'VOUCHER_EXPIRED' }], items: [] },
    { grandTotal: 35000, items: [{ clientItemId: 'car-1', voucherId: 'wrong', voucherDiscount: 5000 }, {}] },
    { grandTotal: 40000, items: [{ clientItemId: 'car-1', voucherId: 'unit-voucher', voucherDiscount: 0 }, {}] },
    { grandTotal: 45000, items: [{ clientItemId: 'car-1', voucherId: 'unit-voucher', voucherDiscount: 5000 }, {}] },
  ]) {
    const gateway = voucherGateway(); gateway.quoteBulkBooking = async () => ok(data);
    assert.equal(await findAiBookingVoucherOffer(preview, {}, gateway, { now }), null);
  }
});
test('a free service voucher is offered only when that service is already selected for the first vehicle', async () => {
  const gateway = voucherGateway([code({ benefitSnapshot: { type: 'FREE_SERVICE', serviceId: 'unit-service' } })]);
  assert.equal(await findAiBookingVoucherOffer(preview, {}, gateway, { now }), null);
  const withService = { ...preview, items: preview.items.map((item, index) => ({ ...item, serviceIds: index === 0 ? ['unit-service'] : [] })) };
  assert.ok(await findAiBookingVoucherOffer(withService, {}, gateway, { now }));
});
test('accepting or declining the offer is separate from confirming or cancelling a booking', () => {
  for (const text of ['có', 'đồng ý', 'dùng luôn', 'dùng mã', 'dùng mã này đi', 'dùng mã giảm giá', 'áp dụng mã giảm giá này', 'yes', 'apply it', 'use the voucher', 'apply this voucher']) assert.equal(routeAiVoucherOfferReply(text), 'accept', text);
  for (const text of ['không', 'không dùng mã này', 'bỏ qua', 'dừng mã', 'no thanks']) assert.equal(routeAiVoucherOfferReply(text), 'decline', text);
  for (const text of ['book it', 'xác nhận đặt chỗ', 'đổi giờ ra 10h', 'tôi có mã giảm giá không', 'zzz', 'dùng mã khác', 'dùng mã nào?']) assert.equal(routeAiVoucherOfferReply(text), 'other', text);
});

test('an ambiguous voucher answer asks a specific question without repeating the previous quote', () => {
  assert.match(clarifyAiVoucherOffer('vi'), /chưa rõ.*Bạn muốn dùng mã này không\?/);
  assert.match(clarifyAiVoucherOffer('en'), /not sure.*Would you like to apply it\?/);
  for (const language of ['vi', 'en']) assert.doesNotMatch(clarifyAiVoucherOffer(language), /VND|40[.,]000|Monthly spending reward/);
});
test('applying one code preserves each car schedule, services and other voucher selections', () => {
  const draft = { requestedVehicleCount: 2, reservationItems: [{ licensePlate: '33C3333', startTime: '07:00', serviceIds: ['wash'] }, { licensePlate: '44F4444', startTime: '09:00', serviceIds: ['charge'], voucherId: 'other-code' }] };
  const result = applyAiVoucherToDraft(draft, { voucherId: 'unit-voucher', voucherName: 'Unit discount' });
  assert.equal(result.reservationItems[0].voucherId, 'unit-voucher'); assert.equal(result.reservationItems[1].voucherId, 'other-code'); assert.equal(result.reservationItems[1].startTime, '09:00'); assert.deepEqual(result.reservationItems[0].serviceIds, ['wash']); assert.equal(draft.reservationItems[0].voucherId, undefined);
});
test('stale, expired or history-restored offer keys cannot be accepted against a different preview', () => {
  const offer = { previewKey: 'current', expiresAt: '2099-12-01' };
  assert.equal(isAiVoucherOfferCurrent(offer, preview, 'current', now), true);
  assert.equal(isAiVoucherOfferCurrent(offer, preview, 'new-price', now), false);
  assert.equal(isAiVoucherOfferCurrent(offer, null, 'current', now), false);
  assert.equal(isAiVoucherOfferCurrent({ ...offer, expiresAt: '2026-11-10' }, preview, 'current', now), false);
});
const draft = { startDate: '2099-11-20', endDate: '2099-11-20', startTime: '07:00', endTime: '08:00', licensePlates: ['33C3333', '44F4444'], requestedVehicleCount: 2 };
function bookingGateway() {
  let quotes = 0;
  const gateway = {
    getMyBookings: async () => ok([]), getAvailableBookingSlots: async () => ok({ slots: ['A1', 'A2'].map((slotCode) => ({ slotCode, floorId: 'unit-floor', floorName: 'Floor 1', slotType: 'SLOT' })) }),
    quoteBulkBooking: async ({ items }) => { quotes++; return ok({ items: items.map((item) => ({ clientItemId: item.clientItemId, totalAmount: 20000 })), grandTotal: items.length * 20000 }); }, getWalletInfo: async () => ok({ balance: 100000 }),
    createBookingHold: async () => assert.fail('must not hold a slot in a preview test'), createBulkBooking: async () => assert.fail('must not create bookings in a preview test'),
  };
  return { gateway, quoteCount: () => quotes };
}
test('multi-car booking assigns distinct slots, retains plate order and does not create bookings', async () => {
  const { gateway } = bookingGateway(); const result = await prepareAiBooking(draft, gateway, [], now);
  assert.deepEqual(result.items.map((item) => item.licensePlate), draft.licensePlates); assert.equal(new Set(result.items.map((item) => item.slotCode)).size, 2); assert.equal(result.total, 40000);
});
test('duplicate or missing plates do not silently reduce the requested car count', async () => {
  const { gateway, quoteCount } = bookingGateway();
  const result = await prepareAiBooking({ ...draft, licensePlates: ['33C3333', '33C3333'] }, gateway, [], now);
  assert.ok(result.missing?.length); assert.equal(quoteCount(), 0);
});
test('mismatched counts and duplicate voucher assignments cannot reach quote or booking writes', async () => {
  const { gateway, quoteCount } = bookingGateway();
  const mismatch = await prepareAiBooking({ ...draft, requestedVehicleCount: 1 }, gateway, [], now);
  assert.ok(mismatch.missing?.length);
  const duplicate = await prepareAiBooking({ ...draft, reservationItems: draft.licensePlates.map((licensePlate) => ({ licensePlate, voucherId: 'same-voucher' })) }, gateway, [], now);
  assert.ok(duplicate.conflicts?.length); assert.equal(quoteCount(), 0);
});
test('overlap metadata retains the actual conflicting booking schedule for later lookup', async () => {
  const { gateway, quoteCount } = bookingGateway();
  gateway.getMyBookings = async () => ok([{ _id: '111111111111111111111111', licensePlate: '33C3333', status: 'PAID', scheduledStart: '2099-11-20T00:00:00Z', scheduledEnd: '2099-11-20T02:00:00Z', parkingSlot: 'B7' }]);
  const result = await prepareAiBooking(draft, gateway, [], now);
  assert.equal(result.bookingConflicts[0].licensePlate, '33C3333'); assert.equal(result.bookingConflicts[0].conflictBooking.parkingSlot, 'B7'); assert.equal(result.bookingConflicts[0].conflictBooking.scheduledEnd, '2099-11-20T02:00:00Z'); assert.equal(quoteCount(), 0);
});
test('a multi-car voucher discount must still be reviewed and explicitly confirmed at the fresh total', async () => {
  const { gateway } = bookingGateway(); const original = await prepareAiBooking(draft, gateway, [], now);
  const withVoucher = applyAiVoucherToDraft(draft, { voucherId: 'unit-voucher', voucherName: 'Unit discount' });
  gateway.quoteBulkBooking = async ({ items }) => ok({ items: items.map((item) => ({ clientItemId: item.clientItemId, totalAmount: item.voucherId ? 15000 : 20000 })), grandTotal: 35000 });
  const result = await confirmAiBooking(original, withVoucher, gateway, [], 'same-key');
  assert.equal(result.refreshed.total, 35000); assert.equal(result.success, undefined);
});
test('discount questions pass through in every booking phase and offer summaries do not also ask to book', () => {
  for (const phase of ['IDLE', 'WAITING_CONFIRMATION']) for (const text of ['tôi còn thẻ giảm giá nào không', 'tôi có mã giảm giá không', 'Do I have any vouchers?']) assert.equal(routeBookingReply(phase, text), 'interpret', text);
  const full = { ...preview, items: preview.items.map((item) => ({ ...item, date: '2099-11-20', endDate: '2099-11-20', startTime: '2099-11-20T00:00:00Z', endTime: '2099-11-20T01:00:00Z', floorName: 'Floor 1', slotCode: 'A1' })) };
  assert.ok(!bookingPreviewSummary(full, {}, 'vi', { askConfirmation: false }).includes('xác nhận đặt chỗ không'));
});
