// Offers are derived from the authenticated voucher inventory and the real
// booking quote endpoint. This helper neither reserves nor consumes a voucher.
const idOf = (value) => String(value?._id || value || '');
export const hasAiBookingVoucher = (draft = {}, preview) => Boolean(draft.voucherId
  || draft.reservationItems?.some((item) => item.voucherId)
  || preview?.items?.some((item) => item.voucherId));

export function applyAiVoucherToDraft(draft, offer) {
  return {
    ...draft, voucherId: offer.voucherId, voucherName: offer.voucherName,
    ...(draft.reservationItems?.length ? { reservationItems: draft.reservationItems.map((item, index) => index === 0
      ? { ...item, voucherId: offer.voucherId, voucherName: offer.voucherName } : item) } : {}),
  };
}

export async function findAiBookingVoucherOffer(preview, draft, gateway, { vouchers, now = Date.now() } = {}) {
  if (!preview?.items?.length || hasAiBookingVoucher(draft, preview)) return null;
  if (!vouchers) {
    const response = await gateway.getMyVouchers('available');
    if (!response.ok || !Array.isArray(response.data?.data)) return null;
    vouchers = response.data.data;
  }
  const amount = Number(preview.quotes?.[0]?.totalAmount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const firstServices = preview.items[0].serviceIds || [];
  const candidates = vouchers.filter((voucher) => {
    const benefit = voucher.benefitSnapshot || {};
    if (!voucher._id || voucher.status !== 'available' || voucher.bookingId
      || !(Date.parse(voucher.expiresAt) > now) || Number(benefit.minimumAmount || 0) > amount) return false;
    if (benefit.type === 'FREE_SERVICE') return firstServices.some((id) => idOf(id) === idOf(benefit.serviceId));
    return benefit.type === 'PERCENT_DISCOUNT' ? Number(benefit.discountPercent) > 0
      : benefit.type === 'FIXED_DISCOUNT' && Number(benefit.discountAmount) > 0;
  }).sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
  for (const voucher of candidates) {
    const voucherId = idOf(voucher._id);
    const items = preview.items.map((item, index) => index === 0 ? { ...item, voucherId } : { ...item });
    const response = await gateway.quoteBulkBooking({ bookingSource: 'AI_QUICK', items });
    const quote = response.data?.data;
    if (!response.ok || !quote || quote.itemErrors?.length || quote.items?.length !== items.length) continue;
    const firstQuote = quote.items.find((item) => item.clientItemId === items[0].clientItemId);
    const discount = Number(firstQuote?.voucherDiscount);
    const total = Number(quote.grandTotal);
    if (!Number.isFinite(discount) || discount <= 0 || !Number.isFinite(total) || total < 0
      || idOf(firstQuote?.voucherId) !== voucherId || total + discount !== Number(preview.total)) continue;
    return { type: 'APPLY_VOUCHER', voucherId, voucherName: voucher.benefitSnapshot?.name || 'Voucher', discount, total, expiresAt: voucher.expiresAt };
  }
  return null;
}

export function aiVoucherOfferMessage(offer, language = 'vi', count = 1) {
  const money = (amount) => `${Number(amount).toLocaleString(language === 'en' ? 'en-US' : 'vi-VN')} VND`;
  return language === 'en'
    ? `You can use “${offer.voucherName}” to save ${money(offer.discount)}${count > 1 ? ' on the first vehicle' : ''}; the new total is ${money(offer.total)}. Would you like to apply this voucher? This only selects the discount; it does not confirm the booking.`
    : `Bạn có thể dùng “${offer.voucherName}” để giảm ${money(offer.discount)}${count > 1 ? ' cho xe đầu tiên' : ''}, tổng còn ${money(offer.total)}. Bạn có muốn dùng mã này không? Thao tác này chỉ chọn mã giảm giá, chưa xác nhận đặt chỗ.`;
}

export function routeAiVoucherOfferReply(message) {
  const text = String(message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
  if (/^(?:(?:toi|minh)\s+)?(?:khong|thoi|khong dung|khong can|khong ap dung|bo qua|de sau|no|no thanks|not now|skip|dont use it|do not use it)(?:\s+(?:ma|voucher|di|nhe|nha))?$/.test(text)) return 'decline';
  if (/^(?:(?:toi|minh)\s+)?(?:co|ok|oke|okay|dong y|duoc|dung|dung luon|dung di|ap dung|ap dung luon|yes|yes please|apply it|use it|go ahead)(?:\s+(?:ma nay|voucher|di|nhe|nha))?$/.test(text)) return 'accept';
  return 'other';
}
