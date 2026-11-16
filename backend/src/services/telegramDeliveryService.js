const Link = require('../models/TelegramLink');
const Delivery = require('../models/TelegramDelivery');
const client = require('./telegramClient');
async function enqueueBookingTicket(booking, { session } = {}) {
  if (!client.enabled() || !booking?.userId || !['PAID', 'ACTIVE', 'PAUSED'].includes(booking.status)) return null;
  const link = await Link.findOne({ userId: booking.userId, revokedAt: null, blockedAt: null, notificationsEnabled: true }).select('+phone').session(session || null);
  if (!await require('./telegramProfileService').matchesProfile(link, session)) return null;
  const pass = await require('./parkingPassService').ensureBookingPass(booking, { session });
  // Relinking must not send this booking again, including legacy link-based jobs.
  const existing = await Delivery.findOne({ bookingId: booking._id, kind: 'booking_paid',
    status: { $in: ['pending', 'processing', 'sent', 'uncertain'] } }).session(session || null);
  if (existing) return existing;
  const dedupeKey = `booking_paid:${booking._id}:${link._id}:${new Date(link.linkedAt).getTime()}`;
  return Delivery.findOneAndUpdate({ dedupeKey }, { $setOnInsert: {
    dedupeKey, kind: 'booking_paid', bookingId: booking._id, passId: pass._id,
    passVersion: pass.qrVersion || pass.credentialVersion || pass.version,
    linkId: link._id, chatId: link.chatId, telegramUserId: link.telegramUserId,
  } }, { upsert: true, new: true, session });
}
function formatTicket(ticket) {
  const escape = value => String(value ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const record = ticket.booking || ticket.session;
  const floor = record?.floorId;
  const floorLabel = floor && typeof floor === 'object'
    ? floor.name || (floor.floorNumber != null ? `Tầng ${floor.floorNumber}` : '')
    : '';
  const location = [floorLabel, record?.parkingSlot ? `Ô ${record.parkingSlot}` : ''].filter(Boolean).join(' · ') || '—';
  const date = value => value ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Saigon', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
  return [
    '<b>🅿️ VALO PARKING</b>',
    ticket.booking ? 'Vé đặt chỗ · Đã thanh toán ✅' : 'Vé gửi xe · Thanh toán khi ra bãi',
    '',
    `Biển số: <b>${escape(ticket.licensePlate || record?.licensePlate || '—')}</b>`,
    `Vị trí: <b>${escape(location)}</b>`,
    '',
    ...(ticket.booking ? [
      `Bắt đầu: <b>${escape(date(record.scheduledStart))}</b>`,
      `Kết thúc: <b>${escape(date(record.scheduledEnd))}</b>`,
    ] : [`Giờ vào: <b>${escape(date(record?.checkInTime))}</b>`]),
    `Mã vé: <code>${escape(ticket.pass._id)}</code>`,
    '',
    ...(ticket.booking ? ['<i>Phí phát sinh được xác minh khi ra bãi.</i>'] : []),
    '👇 Xuất trình QR bên dưới tại kiosk hoặc cho nhân viên để check-in/checkout.',
  ].join('\n');
}
module.exports = { enqueueBookingTicket, formatTicket };
