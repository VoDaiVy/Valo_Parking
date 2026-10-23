const Link = require('../models/TelegramLink');
const Delivery = require('../models/TelegramDelivery');
const client = require('./telegramClient');
async function enqueueBookingTicket(booking, { session } = {}) {
  if (!client.enabled() || !booking?.userId || !['PAID', 'ACTIVE', 'PAUSED'].includes(booking.status)) return null;
  const link = await Link.findOne({ userId: booking.userId, revokedAt: null, blockedAt: null, notificationsEnabled: true }).session(session || null);
  if (!link) return null;
  const pass = await require('./parkingPassService').ensureBookingPass(booking, { session });
  const dedupeKey = `booking_paid:${booking._id}:${link._id}:${new Date(link.linkedAt).getTime()}`;
  return Delivery.findOneAndUpdate({ dedupeKey }, { $setOnInsert: {
    dedupeKey, kind: 'booking_paid', bookingId: booking._id, passId: pass._id,
    passVersion: pass.qrVersion || pass.credentialVersion || pass.version,
    linkId: link._id, chatId: link.chatId, telegramUserId: link.telegramUserId,
  } }, { upsert: true, new: true, session });
}
function formatTicket(ticket) {
  const record = ticket.booking || ticket.session;
  const floor = record?.floorId;
  const floorLabel = floor && typeof floor === 'object'
    ? floor.name || (floor.floorNumber != null ? `Tầng ${floor.floorNumber}` : '')
    : '';
  const location = [floorLabel, record?.parkingSlot ? `Ô ${record.parkingSlot}` : ''].filter(Boolean).join(' · ') || '—';
  const date = value => value ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Saigon', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
  return [`🅿️ VALO PARKING — Vé gửi xe`, `Mã vé: ${ticket.pass._id}`, `Biển số: ${ticket.licensePlate || record?.licensePlate || '—'}`,
    `Vị trí: ${location}`, ticket.booking ? `Thời gian: ${date(record.scheduledStart)} – ${date(record.scheduledEnd)}` : `Giờ vào: ${date(record?.checkInTime)}`,
    ticket.booking ? 'Booking đã thanh toán. Phí phát sinh được xác minh khi ra bãi.' : 'Thanh toán khi ra bãi.',
    'Xuất trình cùng QR này tại kiosk hoặc cho nhân viên để check-in/checkout.'].join('\n');
}
module.exports = { enqueueBookingTicket, formatTicket };
