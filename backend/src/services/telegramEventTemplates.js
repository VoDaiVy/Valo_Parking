const escape = (value, limit = 180) => String(value ?? '—').slice(0, limit)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const date = value => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short',
}).format(new Date(value));
const money = value => `${Number(value || 0).toLocaleString('vi-VN')} đ`;

function formatMembership(subscription, pkg, spaces) {
  // Keep photo captions comfortably below Telegram's 1024-character limit.
  const locations = spaces.map(space => {
    const floor = space.floorId;
    const floorName = floor?.name || (floor?.floorNumber != null ? `Tầng ${floor.floorNumber}` : '');
    return [floorName, space.slotCode].filter(Boolean).join(' / ');
  });
  return [
    '🅿️ <b>VALO PARKING</b>', '✅ <b>Membership đã được kích hoạt</b>', '',
    `Gói: <b>${escape(pkg?.name || 'Membership', 80)}</b>`,
    `Mã gói: <code>${escape(subscription._id)}</code>`,
    ...(locations.length ? [`Vị trí sử dụng: ${escape(locations.join(', '), 100)}`] : []),
    `Hiệu lực: ${escape(date(subscription.validFrom || subscription.createdAt))} → ${escape(date(subscription.expireAt))}`,
    `Thanh toán: <b>${escape(money(subscription.amount))}</b>`, '',
    'Xuất trình QR bên dưới để sử dụng membership.',
    'Vui lòng giữ riêng mã QR của bạn.',
  ].join('\n');
}

function formatViolation(violation) {
  return [
    '⚠️ <b>VALO PARKING — THÔNG BÁO VI PHẠM</b>', '',
    ...(violation.vehicleId?.licensePlate ? [`Biển số: <b>${escape(violation.vehicleId.licensePlate)}</b>`] : []),
    `Vi phạm: <b>${escape(violation.title)}</b>`,
    `Thời điểm ghi nhận: ${escape(date(violation.createdAt))}`,
    ...(violation.description ? [`Nội dung: ${escape(violation.description, 600)}`] : []),
    `Mức phạt: <b>${escape(money(violation.fineAmount))}</b>`,
    `Mã biên bản: <code>${escape(violation._id)}</code>`, '',
    'Nếu xe đang đậu sai vị trí, vui lòng di chuyển xe về đúng vị trí.',
    'Liên hệ nhân viên bãi xe để được hỗ trợ về biên bản.',
  ].join('\n');
}

function formatVoucher(voucher) {
  const benefit = voucher.benefitSnapshot;
  const discount = benefit.type === 'PERCENT_DISCOUNT' ? `Giảm ${benefit.discountPercent}%`
    : benefit.type === 'FIXED_DISCOUNT' ? `Giảm ${money(benefit.discountAmount)}`
      : `Miễn phí dịch vụ${benefit.serviceId?.name ? `: ${benefit.serviceId.name}` : ''}`;
  return [
    '🎁 <b>VALO PARKING — BẠN VỪA NHẬN VOUCHER</b>', '',
    `Voucher: <b>${escape(benefit.name)}</b>`,
    `Ưu đãi: <b>${escape(discount)}</b>`,
    ...(benefit.description ? [`Chi tiết: ${escape(benefit.description, 400)}`] : []),
    `Đơn tối thiểu: ${escape(money(benefit.minimumAmount))}`,
    `Hạn dùng: <b>${escape(date(voucher.expiresAt))}</b>`,
    `Nguồn nhận: ${voucher.source === 'manual' ? 'Quà tặng từ VALO' : voucher.source === 'spending' ? 'Thưởng chi tiêu' : 'Đổi điểm thưởng'}`, '',
    'Voucher dùng một lần. Mở ví voucher để xem điều kiện và sử dụng.',
  ].join('\n');
}

module.exports = { formatMembership, formatViolation, formatVoucher };
