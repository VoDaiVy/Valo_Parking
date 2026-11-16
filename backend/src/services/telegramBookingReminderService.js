const Booking = require('../models/Booking');
const Session = require('../models/Session');
const User = require('../models/User');
const Link = require('../models/TelegramLink');
const Delivery = require('../models/TelegramDelivery');
const client = require('./telegramClient');
const profile = require('./telegramProfileService');

const MINUTE = 60000;
const KIND = 'booking_checkin_last_call';

// Matches parkingPassService: first check-in closes at start + 30 minutes or scheduledEnd, whichever is earlier.
function checkinDeadline(booking) {
  return new Date(Math.min(new Date(booking.scheduledStart).getTime() + 30 * MINUTE, new Date(booking.scheduledEnd).getTime()));
}
function shouldRemind(booking, now = new Date()) {
  const remaining = checkinDeadline(booking) - now;
  const warningAt = new Date(booking.scheduledStart).getTime() + 15 * MINUTE;
  return ['PAID', 'EXPIRED'].includes(booking.status) && now.getTime() >= warningAt
    && remaining > 0 && remaining <= 15 * MINUTE;
}
async function currentBooking(record, now) {
  if (!client.enabled()) return null;
  const booking = await Booking.findOne({ _id: record.bookingId, userId: record.bookingUserId,
    scheduledStart: record.bookingScheduledStart, scheduledEnd: record.bookingScheduledEnd,
    status: { $in: ['PAID', 'EXPIRED'] } }).populate('floorId', 'name floorNumber');
  if (!booking || !shouldRemind(booking, now) || await Session.exists({ bookingId: booking._id })) return null;
  if (!await User.exists({ _id: booking.userId, status: true, role: 'customer' })) return null;
  return booking;
}
async function recipient(record) {
  const link = await Link.findOne({ _id: record.linkId, userId: record.bookingUserId, chatId: record.chatId,
    telegramUserId: record.telegramUserId, revokedAt: null, blockedAt: null, notificationsEnabled: true }).select('+phone');
  return link && !(new Date(record.recipientLinkedAt || record.createdAt) < link.linkedAt)
    && await profile.matchesProfile(link) ? link : null;
}
async function enqueue(booking, now) {
  const record = { kind: KIND, bookingId: booking._id, bookingUserId: booking.userId,
    bookingScheduledStart: booking.scheduledStart, bookingScheduledEnd: booking.scheduledEnd };
  if (!await currentBooking(record, now)) return null;
  const link = await Link.findOne({ userId: booking.userId, revokedAt: null, blockedAt: null, notificationsEnabled: true }).select('+phone');
  if (!await profile.matchesProfile(link)) return null;
  const dedupeKey = `${KIND}:${booking._id}:${new Date(booking.scheduledStart).getTime()}:${new Date(booking.scheduledEnd).getTime()}`;
  const fields = { ...record, dedupeKey, linkId: link._id, chatId: link.chatId,
    telegramUserId: link.telegramUserId, recipientLinkedAt: link.linkedAt };
  let job;
  try {
    job = await Delivery.findOneAndUpdate({ dedupeKey }, { $setOnInsert: fields }, { upsert: true, new: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    job = await Delivery.findOne({ dedupeKey });
  }
  if (job && ['failed', 'cancelled'].includes(job.status)
    && ['LINK_CHANGED', 'LINK_REVOKED', 'PROFILE_PHONE_CHANGED', 'BOT_BLOCKED'].includes(job.errorCode)
    && (job.attempts === 0 || (job.status === 'failed' && job.errorCode === 'BOT_BLOCKED'))
    && new Date(link.linkedAt) > new Date(job.recipientLinkedAt || job.createdAt)) {
    await Delivery.updateOne({ _id: job._id, status: job.status, errorCode: job.errorCode }, {
      $set: { linkId: link._id, chatId: link.chatId, telegramUserId: link.telegramUserId, recipientLinkedAt: link.linkedAt,
        status: 'pending', attempts: 0, nextAttemptAt: now }, $unset: { errorCode: 1 },
    });
  }
  return job;
}
async function reconcile(now = new Date()) {
  if (!client.enabled()) return 0;
  const candidates = Booking.find({ userId: { $ne: null }, status: { $in: ['PAID', 'EXPIRED'] },
    scheduledStart: { $gt: new Date(now.getTime() - 30 * MINUTE), $lte: new Date(now.getTime() - 15 * MINUTE) }, scheduledEnd: { $gt: now } }).cursor();
  let count = 0;
  for await (const booking of candidates) {
    if (shouldRemind(booking, now) && await enqueue(booking, now)) count++;
  }
  return count;
}
function formatReminder(booking, now = new Date()) {
  const escape = value => String(value ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const deadline = checkinDeadline(booking);
  const date = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Saigon', day: '2-digit', month: '2-digit', year: 'numeric' }).format(deadline);
  const time = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Saigon', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(deadline);
  const remaining = Math.ceil((deadline - now) / MINUTE);
  const floor = booking.floorId;
  const floorName = floor?.name || (floor?.floorNumber != null ? `Tầng ${floor.floorNumber}` : '');
  const location = [floorName, booking.parkingSlot ? `Ô ${booking.parkingSlot}` : ''].filter(Boolean).join(' · ');
  return [
    '⚠️ <b>VALO PARKING</b>', 'Cảnh báo trễ check-in', '',
    `Biển số: <b>${escape(booking.licensePlate)}</b>`,
    ...(location ? [`Vị trí: <b>${escape(location)}</b>`] : []),
    `Thời gian còn lại: <b>${remaining} phút</b>`,
    `Hạn check-in (GMT+7): <b>${date} · ${time}</b>`, '',
    'Bạn chưa check-in. Vui lòng đến bãi và xuất trình mã QR trước thời hạn trên.', '',
    '<b>Sau thời hạn này, booking hết hạn check-in và mã QR không còn hiệu lực để vào bãi.</b>',
  ].join('\n');
}
async function processDelivery(record) {
  const cancelled = { status: 'cancelled', errorCode: 'BOOKING_CHANGED' };
  if (!await currentBooking(record, new Date())) return cancelled;
  if (!await recipient(record)) return { status: 'cancelled', errorCode: 'LINK_CHANGED' };
  const booking = await currentBooking(record, new Date());
  if (!booking || !await recipient(record)) return cancelled;
  // A check-in may have committed while the final recipient/phone lookup was in flight.
  if (!await Booking.exists({ _id: record.bookingId, userId: record.bookingUserId,
    scheduledStart: record.bookingScheduledStart, scheduledEnd: record.bookingScheduledEnd,
    status: { $in: ['PAID', 'EXPIRED'] } }) || await Session.exists({ bookingId: record.bookingId })) return cancelled;
  const now = new Date();
  if (!shouldRemind(booking, now)) return cancelled;
  const sent = await client.sendMessage(record.chatId, formatReminder(booking, now), undefined, { parseMode: 'HTML' });
  return { status: 'sent', sentAt: new Date(), messageId: sent.message_id };
}
module.exports = { reconcile, processDelivery, checkinDeadline, shouldRemind, formatReminder };
