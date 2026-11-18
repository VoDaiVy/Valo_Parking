import test from 'node:test';
import assert from 'node:assert/strict';
import { findAiBookingVoucherOffer, applyAiVoucherToDraft, routeAiVoucherOfferReply, isAiVoucherOfferCurrent, aiVoucherOfferMessage, aiVoucherEligibilityMessage, clarifyAiVoucherOffer } from './aiBookingVouchers.js';
import { prepareAiBooking, confirmAiBooking, checkAiAvailability, aiAvailabilityReply } from './aiBookingFlow.js';
import { detectDirectParkingLookup, parkingAvailabilityReply, slotStatusReply } from './aiParkingLookup.js';
import { bookingPreviewSummary, routeBookingReply } from './aiBookingConversation.js';
import { prepareAiBookingReply } from './aiBookingMessages.js';
import { activeAiBookingServices, hasAiBookingServices, createAiBookingServiceOffer, isAiBookingServiceOfferCurrent, withAiBookingServiceOffer, routeAiBookingServiceOfferReply, resolveAiBookingServiceNameReply, aiBookingServiceOfferMessage } from './aiBookingServices.js';
const ok = (data) => ({ ok: true, data: { success: true, data } });
const now = Date.parse('2026-11-11T00:00:00Z');
const code = (overrides = {}) => ({ _id: 'unit-voucher', status: 'available', bookingId: null, expiresAt: '2099-12-01', benefitSnapshot: { name: 'Unit discount', type: 'FIXED_DISCOUNT', minimumAmount: 10000, discountAmount: 5000 }, ...overrides });
const preview = { items: [{ clientItemId: 'car-1', licensePlate: '33C3333', serviceIds: [] }, { clientItemId: 'car-2', licensePlate: '44F4444', serviceIds: [] }], quotes: [{ totalAmount: 20000 }, { totalAmount: 20000 }], total: 40000, walletBalance: 50000 };
const serviceCatalog = [{ _id: 'test-wash', name: 'Car wash', price: 20000, isActive: true }];

test('a real active catalog offers optional services before booking confirmation without changing the quote', () => {
  const booking = { licensePlate: '33C3333', startDate: '2099-11-20', startTime: '07:00', endTime: '08:00' };
  const before = structuredClone({ booking, preview });
  const offer = createAiBookingServiceOffer(preview, booking, serviceCatalog, 'preview-1');
  assert.deepEqual(offer, { status: 'offered', previewKey: 'preview-1', serviceIds: ['test-wash'] });
  const updated = withAiBookingServiceOffer(booking, offer);
  assert.equal(updated.assistantContext.serviceOffer, offer);
  assert.deepEqual({ booking, preview }, before);
  for (const language of ['vi', 'en']) {
    const summary = bookingPreviewSummary(preview, booking, language, { askConfirmation: false });
    const question = aiBookingServiceOfferMessage(language);
    assert.doesNotMatch(summary, /xác nhận|confirm this booking/);
    assert.match(question, language === 'vi' ? /muốn dùng thêm dịch vụ/ : /add any VALO/);
    assert.equal(prepareAiBookingReply(question, language).needsTranslation, false);
    assert.equal(prepareAiBookingReply(aiBookingServiceOfferMessage(language, { selecting: true }), language).needsTranslation, false);
  }
});

test('service consent is separate from booking confirmation, cancellation and choosing a named service', () => {
  for (const text of ['có', 'đồng ý', 'ok', 'vâng có', 'có nhé', 'yes', 'yes please', 'sure']) assert.equal(routeAiBookingServiceOfferReply(text), 'accept', text);
  for (const text of ['không', 'không cần', 'không thêm dịch vụ', 'không cần thêm dịch vụ', 'không thêm dịch vụ nữa', 'bỏ qua', 'no', 'no thanks', 'skip services']) assert.equal(routeAiBookingServiceOfferReply(text), 'decline', text);
  for (const text of ['đặt', 'xác nhận đặt chỗ', 'book it', 'hủy đặt chỗ', 'thêm dịch vụ demo', 'yes change the arrival time to 10h', 'đổi sang ngày mai', 'zzz']) assert.equal(routeAiBookingServiceOfferReply(text), 'other', text);
  assert.doesNotMatch(aiBookingServiceOfferMessage('vi', { selecting: true }), /đã thêm|thành công/);
});

test('declining services preserves booking facts and prevents repeated offers', () => {
  const booking = { licensePlates: ['33C3333', '44F4444'], requestedVehicleCount: 2,
    reservationItems: [{ licensePlate: '33C3333', startTime: '07:00', endTime: '08:00', voucherId: 'kept' },
      { licensePlate: '44F4444', startTime: '10:00', endTime: '12:00' }], assistantContext: { declinedVoucherIds: ['old'] } };
  const updated = withAiBookingServiceOffer(booking, { status: 'declined' });
  assert.deepEqual(updated.reservationItems, booking.reservationItems);
  assert.deepEqual(updated.assistantContext.declinedVoucherIds, ['old']);
  assert.equal(createAiBookingServiceOffer(preview, updated, serviceCatalog, 'new-preview'), null);
  assert.equal(booking.assistantContext.serviceOffer, undefined);
});

test('selected services and unavailable catalogs never produce another optional-services question', () => {
  for (const booking of [{ serviceIds: ['test-wash'] }, { reservationItems: [{ serviceIds: [] }, { serviceIds: ['test-wash'] }] }]) {
    assert.equal(hasAiBookingServices(preview, booking), true);
    assert.equal(createAiBookingServiceOffer(preview, booking, serviceCatalog, 'key'), null);
  }
  for (const catalog of [[], null, [{ ...serviceCatalog[0], isActive: false }], [{ ...serviceCatalog[0], price: -1 }], [{ name: 'Missing data' }]]) {
    assert.equal(createAiBookingServiceOffer(preview, {}, catalog, 'key'), null);
  }
  assert.equal(activeAiBookingServices([...serviceCatalog, ...serviceCatalog]).length, 1);
  assert.equal(activeAiBookingServices([{ ...serviceCatalog[0], price: 0 }]).length, 1);
});

test('voucher consent is asked first and services are offered after the voucher decision', () => {
  assert.equal(createAiBookingServiceOffer(preview, {}, serviceCatalog, 'key', { pendingVoucher: true }), null);
  const afterVoucher = createAiBookingServiceOffer(preview, { voucherId: 'chosen-voucher' }, serviceCatalog, 'key');
  assert.ok(afterVoucher);
  assert.equal(afterVoucher.status, 'offered');
});

test('service offers follow the current preview and restored stale keys cannot intercept a reply', () => {
  const offer = createAiBookingServiceOffer(preview, {}, serviceCatalog, 'old-key');
  assert.equal(isAiBookingServiceOfferCurrent(offer, preview, 'old-key'), true);
  assert.equal(isAiBookingServiceOfferCurrent(offer, preview, 'new-key'), false);
  assert.equal(isAiBookingServiceOfferCurrent(offer, null, 'old-key'), false);
  const updated = createAiBookingServiceOffer(preview, withAiBookingServiceOffer({}, { ...offer, status: 'selecting' }), serviceCatalog, 'new-key');
  assert.equal(updated.previewKey, 'new-key');
  assert.equal(updated.status, 'selecting');
  assert.equal(isAiBookingServiceOfferCurrent({ ...updated, status: 'declined' }, preview, 'new-key'), false);
});

test('a bare service name resolves only against the services currently offered and never guesses an item', () => {
  const offer = { status: 'selecting', serviceIds: ['test-wash'] };
  assert.equal(resolveAiBookingServiceNameReply('car wash', offer, serviceCatalog), serviceCatalog[0]);
  assert.equal(resolveAiBookingServiceNameReply('CAR WASH!', offer, serviceCatalog), serviceCatalog[0]);
  for (const text of ['wash', 'đổi giờ ra 10h', 'unknown service']) assert.equal(resolveAiBookingServiceNameReply(text, offer, serviceCatalog), null);
  assert.equal(resolveAiBookingServiceNameReply('car wash', { ...offer, status: 'declined' }, serviceCatalog), null);
  assert.equal(resolveAiBookingServiceNameReply('car wash', offer, [{ ...serviceCatalog[0], isActive: false }]), null);
  assert.equal(resolveAiBookingServiceNameReply('car wash', { ...offer, serviceIds: ['test-wash', 'second'] }, [...serviceCatalog, { ...serviceCatalog[0], _id: 'second' }]), null);
});
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

test('live parking replies distinguish a full floor, a missing floor and a full car park', () => {
  const response = ok([
    { id: 'B2', floorName: 'Floor 1', status: 'occupied', type: 'standard' },
    { id: 'E1', floorName: 'Floor 1', status: 'available', type: 'ev' },
    { id: 'C3', floorName: 'Floor 2', status: 'available', type: 'standard' },
    { id: 'D2', floorName: 'Floor 2', status: 'available', type: 'standard', acceptsBookings: false },
  ]);
  assert.match(parkingAvailabilityReply(response, '1'), /không còn chỗ phù hợp.*C3/);
  assert.match(parkingAvailabilityReply(response, '1', { electricCar: true }), /còn 1 chỗ phù hợp.*E1/);
  assert.match(parkingAvailabilityReply(response, '3'), /Không tìm thấy.*Tầng 3/);
  assert.match(parkingAvailabilityReply(ok(response.data.data.slice(0, 2)), '', { language: 'en' }), /no suitable spaces available right now/);
  assert.equal(detectDirectParkingLookup('bãi đỗ full chưa').intent, 'CHECK_PARKING_AVAILABILITY');
  for (const question of ['bãi đỗ 20/11 còn chỗ không', 'ô B2 còn trống lúc 08:30 không', 'is slot B2 available tomorrow from 8 am to 9 am']) {
    assert.equal(detectDirectParkingLookup(question), null, question);
  }
});

test('a live slot lookup reports the specific reason and asks for a floor if the code is ambiguous', () => {
  const rows = ['held', 'booked', 'dedicated', 'maintenance', 'occupied'].map((availabilityReason, index) => ({
    id: 'B-2', floorNumber: index + 1, floorName: `Floor ${index + 1}`, status: 'reserved', availabilityReason,
  }));
  assert.match(slotStatusReply(ok(rows), 'B2'), /kiểm tra tầng nào/);
  for (const [index, reason] of ['giữ tạm', 'có lượt đặt', 'dành riêng', 'bảo trì', 'có xe đỗ'].entries()) {
    assert.ok(slotStatusReply(ok(rows), 'B2', String(index + 1)).includes(reason));
  }
});

test('the live availability reply counts only the available spaces shown in the requested floor', () => {
  const response = ok([
    { id: 'B1', floorNumber: 1, status: 'booked', availabilityReason: 'available' },
    { id: 'D1', floorNumber: 1, status: 'available', availabilityReason: 'booked' },
    { id: 'D2', floorNumber: 1, status: 'available', availabilityReason: 'held' },
    { id: 'D3', floorNumber: 1, status: 'available', availabilityReason: 'closed' },
    { id: 'D4', floorNumber: 1, status: 'available', availabilityReason: 'available', retired: true },
    { id: 'D5', floorNumber: 1, status: 'available', availabilityReason: 'available' },
    { id: 'D6', floorNumber: 2, status: 'available', availabilityReason: 'available' },
  ]);
  assert.equal(parkingAvailabilityReply(response, '1'), 'Tầng 1 hiện còn 2 chỗ phù hợp. B1, D5.');
  assert.match(slotStatusReply(response, 'B1', '1'), /đang trống/);
  assert.match(slotStatusReply(response, 'D1', '1'), /đã có lượt đặt/);
});

test('an unbookable requested space is explained for the exact interval with a verified alternative', async () => {
  const requested = { ...draft, slotCode: 'B2', floorName: 'Floor 1', __language: 'vi' };
  const available = { floorId: 'floor-2', floorName: 'Floor 2', slotCode: 'C3', slotType: 'SLOT' };
  const target = { floorId: 'floor-1', floorName: 'Floor 1', slotCode: 'B2', slotType: 'SLOT' };
  for (const [reason, expected] of [['MAINTENANCE', 'bảo trì'], ['BOOKED', 'trùng giờ'], ['HELD', 'giữ tạm'], ['OCCUPIED', 'đang có xe'], ['VIP_PACKAGE_REQUIRED', 'dành riêng']]) {
    const gateway = { getAvailableBookingSlots: async (query) => {
      assert.equal(query.startTime, '2099-11-20T00:00:00.000Z');
      assert.equal(query.endTime, '2099-11-20T01:00:00.000Z');
      return ok({ slots: [available], unavailableSlots: [{ ...target, reason }] });
    } };
    const { availability } = await checkAiAvailability(requested, gateway, now);
    const reply = aiAvailabilityReply(availability, 'vi');
    assert.ok(reply.includes(expected));
    assert.ok(reply.includes('07:00') && reply.includes('08:00') && reply.includes('C3'));
    assert.equal(availability[0].count, 0);
  }
  const { availability } = await checkAiAvailability(requested, {
    getAvailableBookingSlots: async () => ok({ slots: [available, { ...target, slotType: 'SLOT-EV' }] }),
  }, now);
  assert.match(aiAvailabilityReply(availability, 'en'), /B2 is incompatible.*C3/);
});

test('full and partially available parking areas stop booking before pricing or holds', async () => {
  const { gateway, quoteCount } = bookingGateway();
  gateway.getAvailableBookingSlots = async () => ok({ slots: [] });
  const full = await prepareAiBooking(draft, gateway, [], now);
  assert.equal(full.conflicts.length, 1);
  assert.match(full.conflicts[0], /Bãi đã hết chỗ.*07:00.*08:00/);
  const { availability } = await checkAiAvailability(draft, gateway, now);
  assert.match(aiAvailabilityReply(availability, 'vi'), /Bãi không còn chỗ phù hợp.*07:00.*08:00/);
  gateway.getAvailableBookingSlots = async () => ok({ slots: [
    { floorId: 'floor-1', floorName: 'Floor 1', slotCode: 'A1', slotType: 'SLOT' },
    { floorId: 'floor-2', floorName: 'Floor 2', slotCode: 'C3', slotType: 'SLOT' },
  ] });
  const partlyFull = await prepareAiBooking({ ...draft, floorName: 'Floor 1' }, gateway, [], now);
  assert.match(partlyFull.conflicts[0], /Chỉ còn 1 chỗ phù hợp tại Floor 1.*chưa đủ cho 2 xe/);
  assert.equal(quoteCount(), 0);
  gateway.getAvailableBookingSlots = async () => ok({});
  await assert.rejects(prepareAiBooking(draft, gateway, [], now), /Chưa tải được dữ liệu/);
});

test('a short Vietnamese booking confirmation is valid only against the current ready preview', () => {
  assert.equal(routeBookingReply('WAITING_CONFIRMATION', 'đặt'), 'confirm');
  assert.equal(routeBookingReply('IDLE', 'đặt'), 'no_preview');
  assert.equal(routeBookingReply('WAITING_CONFIRMATION', 'đặt', { hasPendingServiceSelection: true }), 'interpret');
});

test('generic requests for parking are interpreted rather than treated as confirmation or slot selection', () => {
  for (const phase of ['IDLE', 'WAITING_CONFIRMATION']) {
    for (const text of ['tôi muốn đặt 1 bãi đỗ vào ngày mai', 'tôi muốn đặt 1 ô đỗ cho xe 11A11111', 'đặt một chỗ đỗ ngày mai lúc 4h đến 5h tối', 'tôi muốn đặt 1 ô đỗ ngay bây giờ', 'đặt 1 ô', 'đổi ô sang A1']) {
      assert.equal(routeBookingReply(phase, text), 'interpret', `${phase}: ${text}`);
    }
  }
});

test('policy and slot errors stay readable in Vietnamese without calling a translation service', () => {
  for (const [source, expected] of [
    ['Please accept the latest required policies before continuing.', /chấp nhận.*chính sách/],
    ['This slot is temporarily held. Please select another slot.', /giữ chỗ tạm thời/],
    ['This slot is currently occupied by another vehicle', /đang có xe/],
    ['This slot is already booked. Please select another slot.', /đã có người đặt/],
    ['The booking item being edited no longer has a valid hold.', /không còn hiệu lực/],
    ['Cannot connect to the server. Please check that the backend is running.', /Không thể kết nối/],
  ]) {
    const reply = prepareAiBookingReply(source, 'vi');
    assert.equal(reply.needsTranslation, false, source);
    assert.match(reply.text, expected, source);
    assert.doesNotMatch(reply.text, /Chưa thể tải|thành công/);
  }
  assert.equal(prepareAiBookingReply('Please accept the latest required policies before continuing.', 'en').text,
    'Please accept the latest required policies before continuing.');
  assert.equal(prepareAiBookingReply('Please verify the newly introduced requirement with support.', 'vi').needsTranslation, true);
});
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

test('confirming two vehicles keeps their different schedules and creates exactly one bulk request', async () => {
  const { gateway } = bookingGateway();
  const edited = { ...draft, reservationItems: draft.licensePlates.map((licensePlate, index) => ({
    licensePlate, startDate: draft.startDate, endDate: draft.endDate,
    startTime: index === 0 ? '10:00' : '08:00', endTime: index === 0 ? '12:00' : '09:00', serviceIds: [],
  })) };
  const checked = await prepareAiBooking(edited, gateway, [], now);
  const holds = [];
  const bookings = [];
  gateway.createBookingHold = async item => { holds.push(item); return ok({ _id: `test-hold-${holds.length}` }); };
  gateway.createBulkBooking = async payload => { bookings.push(payload); return ok({ bookings: payload.items }); };
  gateway.releaseBookingHold = async () => assert.fail('successful confirmation must not release its holds');
  const result = await confirmAiBooking(checked, edited, gateway, [], 'test-confirm-key');
  assert.ok(result.success);
  assert.equal(holds.length, 2);
  assert.equal(bookings.length, 1);
  assert.equal(bookings[0].idempotencyKey, 'test-confirm-key');
  assert.deepEqual(bookings[0].items.map(item => [item.licensePlate, item.startTime, item.endTime]), checked.items.map(item => [item.licensePlate, item.startTime, item.endTime]));
});

test('policy rejection during confirmation preserves its reason and never creates a booking', async () => {
  const { gateway } = bookingGateway();
  const checked = await prepareAiBooking(draft, gateway, [], now);
  gateway.createBookingHold = async () => ({ ok: false, status: 403, data: {
    code: 'POLICY_ACCEPTANCE_REQUIRED', message: 'Please accept the latest required policies before continuing.',
    data: { missingPolicies: [{ id: 'test-policy' }] },
  } });
  gateway.createBulkBooking = async () => assert.fail('policy rejection must block creation');
  await assert.rejects(confirmAiBooking(checked, draft, gateway, [], 'test-confirm-key'), error => {
    assert.equal(error.responseData.code, 'POLICY_ACCEPTANCE_REQUIRED');
    assert.equal(error.responseData.data.missingPolicies.length, 1);
    const reply = prepareAiBookingReply(error.message, 'vi');
    assert.equal(reply.needsTranslation, false);
    assert.match(reply.text, /chấp nhận.*chính sách/);
    return true;
  });
});
test('duplicate or missing plates do not silently reduce the requested car count', async () => {
  const { gateway, quoteCount } = bookingGateway();
  const result = await prepareAiBooking({ ...draft, licensePlates: ['33C3333', '33C3333'] }, gateway, [], now);
  assert.ok(result.missing?.length); assert.equal(quoteCount(), 0);
});

test('a departure below the minimum explains the actual duration and earliest allowed endpoint', async () => {
  for (const [startTime, endTime, earliest, date] of [
    ['22:45', '23:00', '23:15', '20/11/2099'],
    ['23:45', '00:00', '00:15', '21/11/2099'],
  ]) {
    const { gateway, quoteCount } = bookingGateway();
    const booking = { __language: 'vi', requestedVehicleCount: 1, licensePlate: '11A11111', startDate: '2099-11-20',
      endDate: endTime === '00:00' ? '2099-11-21' : '2099-11-20', startTime, endTime };
    await assert.rejects(prepareAiBooking(booking, gateway, [], now), error => {
      assert.match(error.message, /15 phút/);
      assert.match(error.message, /tối thiểu 30 phút/);
      assert.ok(error.message.includes(earliest));
      assert.ok(error.message.includes(date));
      return true;
    });
    assert.equal(quoteCount(), 0);
  }
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
