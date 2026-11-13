const Subscription = require('../models/Subscription');
const Violation = require('../models/Violation');
const Voucher = require('../models/UserVoucher');
const Entitlement = require('../models/MembershipSlotEntitlement');
const User = require('../models/User');
const Link = require('../models/TelegramLink');
const Delivery = require('../models/TelegramEventDelivery');
const LegacyDelivery = require('../models/TelegramDelivery');
const Notification = require('../models/Notification');
const client = require('./telegramClient');
const profile = require('./telegramProfileService');
const qr = require('./membershipQrService');
const templates = require('./telegramEventTemplates');
// Register models used by populate even when the worker is imported independently.
require('../models/Service');
require('../models/Vehicle');
require('../models/TicketPackage');
require('../models/ParkingFloor');

const KINDS = ['membership_activated', 'violation_created', 'voucher_received'];
const sources = [
  { Model: Subscription, kind: KINDS[0], userField: 'user', idField: 'subscriptionId', ready: { paymentStatus: 'paid', status: 'active' } },
  { Model: Violation, kind: KINDS[1], userField: 'userId', idField: 'violationId', ready: {} },
  { Model: Voucher, kind: KINDS[2], userField: 'userId', idField: 'voucherId', ready: {} },
];
const enabled = kind => client.enabled() && process.env[`TELEGRAM_${kind.toUpperCase()}_ENABLED`] !== 'false';

function eventUrl(path) {
  try {
    const url = new URL(path, process.env.TELEGRAM_WEB_APP_URL || process.env.CLIENT_URL);
    const host = url.hostname.toLowerCase();
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
      || host === 'localhost' || host.endsWith('.localhost') || host === '[::1]'
      || host === '0.0.0.0' || /^127\./.test(host) || !host.includes('.')) return null;
    return url.toString();
  } catch { return null; }
}

async function recipient(record) {
  const link = await Link.findOne({ _id: record.linkId, userId: record.eventUserId,
    chatId: record.chatId, telegramUserId: record.telegramUserId,
    notificationsEnabled: true, revokedAt: null, blockedAt: null }).select('+phone');
  return link && new Date(link.linkedAt) <= new Date(record.eventOccurredAt)
    && new Date(link.linkedAt).getTime() === new Date(record.recipientLinkedAt).getTime()
    && await profile.matchesProfile(link) ? link : null;
}

async function reconcile(now = new Date()) {
  if (!client.enabled()) return 0;
  const rollout = new Date(process.env.TELEGRAM_EVENTS_FROM || 'invalid');
  if (!Number.isFinite(rollout.getTime()) || rollout > now) return 0;
  if (enabled('voucher_received')) await recoverManualVoucherEvents(now, rollout);
  let count = 0;
  for (const source of sources) {
    if (!enabled(source.kind)) continue;
    const rows = await source.Model.find({ ...source.ready,
      'telegramNotification.occurredAt': { $gte: rollout, $lte: now },
      'telegramNotification.processedAt': null,
    }).sort({ 'telegramNotification.occurredAt': 1, _id: 1 }).limit(25).lean();
    for (const row of rows) {
      const userId = row[source.userField];
      const occurredAt = row.telegramNotification.occurredAt;
      const link = await Link.findOne({ userId, linkedAt: { $lte: occurredAt },
        notificationsEnabled: true, revokedAt: null, blockedAt: null }).select('+phone');
      if (link && await profile.matchesProfile(link)) {
        const dedupeKey = `${source.kind}:${row._id}`;
        const legacy = await LegacyDelivery.exists({ dedupeKey,
          status: { $in: ['pending', 'processing', 'sent', 'uncertain'] } });
        if (legacy) {
          await source.Model.updateOne({ _id: row._id, 'telegramNotification.processedAt': null },
            { $set: { 'telegramNotification.processedAt': now } });
          continue;
        }
        try {
          await Delivery.updateOne({ dedupeKey }, { $setOnInsert: {
            dedupeKey, kind: source.kind, [source.idField]: row._id, eventUserId: userId,
            eventOccurredAt: occurredAt, linkId: link._id, recipientLinkedAt: link.linkedAt,
            chatId: link.chatId, telegramUserId: link.telegramUserId,
          } }, { upsert: true, runValidators: true });
        } catch (error) {
          if (error.code !== 11000) throw error;
          // Only swallow a confirmed dedupe race, not unrelated uniqueness errors.
          if (!await Delivery.exists({ dedupeKey })) throw error;
        }
        count++;
      }
      // Mark only after durable enqueue. No link at event time means no history replay.
      // Retained on the source even after the delivery's TTL expires.
      await source.Model.updateOne({ _id: row._id, 'telegramNotification.occurredAt': occurredAt,
        'telegramNotification.processedAt': null }, { $set: { 'telegramNotification.processedAt': now } });
    }
  }
  return count;
}

// Admin distribution already persists an in-app notification atomically with the
// voucher. Use that durable event to repair recent issues from older producers,
// without relying solely on their version of the UserVoucher save middleware.
async function recoverManualVoucherEvents(now, rollout) {
  const lower = new Date(Math.max(rollout.getTime(), now.getTime() - 86400000));
  const rows = await Voucher.aggregate([
    { $match: { source: 'manual', status: 'available', expiresAt: { $gt: now },
      createdAt: { $gte: lower, $lte: now }, telegramNotification: { $exists: false } } },
    { $sort: { createdAt: 1, _id: 1 } },
    { $lookup: { from: Notification.collection.name, let: { voucherId: { $toString: '$_id' }, owner: '$userId' },
      pipeline: [{ $match: { isRevoked: { $ne: true }, $expr: { $and: [
        { $eq: ['$metadata.voucherId', '$$voucherId'] },
        { $in: ['$$owner', { $ifNull: ['$targetUsers', []] }] },
      ] } } }, { $limit: 1 }, { $project: { _id: 1 } }], as: 'issuedNotification' } },
    { $match: { 'issuedNotification.0': { $exists: true } } },
    { $limit: 25 },
    { $project: { _id: 1, createdAt: 1 } },
  ]);
  for (const voucher of rows) {
    await Voucher.updateOne({ _id: voucher._id, source: 'manual', status: 'available',
      telegramNotification: { $exists: false } }, {
      $set: { telegramNotification: { occurredAt: voucher.createdAt } },
    });
  }
}

async function currentEvent(record, now = new Date()) {
  if (!await User.exists({ _id: record.eventUserId, status: true, role: 'customer' })) return null;
  if (record.kind === 'membership_activated') {
    const subscription = await Subscription.findOne({ _id: record.subscriptionId, user: record.eventUserId,
      status: 'active', paymentStatus: 'paid', expireAt: { $gt: now } })
      .populate('ticketPackage', 'name').populate('slots.floorId', 'name floorNumber');
    if (!subscription) return null;
    const hasEntitlements = await Entitlement.exists({ sourceSubscriptionId: subscription._id });
    const spaces = hasEntitlements ? await Entitlement.find({ sourceSubscriptionId: subscription._id,
      ownerId: record.eventUserId, status: { $in: ['active', 'transfer_locked'] },
      validFrom: { $lte: now }, expireAt: { $gt: now } }).populate('floorId', 'name floorNumber').lean()
      : subscription.slots;
    if (hasEntitlements && !spaces.length) return null;
    const user = await User.findById(record.eventUserId).select('membership');
    if (!user) return null;
    // Match getMembershipQr: any current account entitlement selects the account credential.
    const accountCredential = await Entitlement.exists({ ownerId: record.eventUserId,
      status: { $in: ['active', 'transfer_locked'] }, expireAt: { $gt: now } });
    const payload = accountCredential ? qr.buildAccountMembershipQrPayload(user) : qr.buildMembershipQrPayload(subscription);
    return { text: templates.formatMembership(subscription, subscription.ticketPackage, spaces), payload };
  }
  if (record.kind === 'violation_created') {
    const violation = await Violation.findOne({ _id: record.violationId, userId: record.eventUserId, status: 'PENDING' })
      .populate('vehicleId', 'licensePlate');
    if (!violation) return null;
    // There is currently no customer violation-detail page. Use the real inbox route.
    return { text: templates.formatViolation(violation), path: '/customer/notification-inbox', button: 'Mở thông báo' };
  }
  if (record.kind === 'voucher_received') {
    const voucher = await Voucher.findOne({ _id: record.voucherId, userId: record.eventUserId,
      status: 'available', expiresAt: { $gt: now } }).populate('benefitSnapshot.serviceId', 'name');
    if (!voucher) return null;
    return { text: templates.formatVoucher(voucher), path: '/customer/rewards', button: 'Mở ví voucher' };
  }
  return null;
}

async function processDelivery(record) {
  if (!enabled(record.kind)) return { status: 'cancelled', errorCode: 'EVENT_DISABLED' };
  let event = await currentEvent(record);
  if (!event) return { status: 'cancelled', errorCode: 'EVENT_NO_LONGER_VALID' };
  if (!await recipient(record)) return { status: 'cancelled', errorCode: 'LINK_CHANGED' };
  const png = event.payload ? await require('qrcode').toBuffer(event.payload,
    { type: 'png', width: 700, margin: 4, errorCorrectionLevel: 'M' }) : null;
  // Re-read after rendering so transfers, QR rotation and revoked recipients cancel stale sends.
  const checked = await currentEvent(record);
  if (!checked || checked.payload !== event.payload) return { status: 'cancelled', errorCode: 'EVENT_CHANGED' };
  event = checked;
  if (!await recipient(record) || !await Delivery.exists({ _id: record._id, status: 'processing', leaseId: record.leaseId })) {
    return { status: 'cancelled', errorCode: 'LINK_CHANGED' };
  }
  const url = event.path && eventUrl(event.path);
  const sent = png ? await client.sendPhoto(record.chatId, png, event.text)
    : await client.sendMessage(record.chatId, event.text,
      url ? { inline_keyboard: [[{ text: event.button, url }]] } : undefined, { parseMode: 'HTML' });
  return { status: 'sent', sentAt: new Date(), messageId: sent.message_id };
}

module.exports = { KINDS, enabled, reconcile, processDelivery, eventUrl, ...templates };
