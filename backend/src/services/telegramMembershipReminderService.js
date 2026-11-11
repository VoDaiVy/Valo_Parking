const Subscription = require('../models/Subscription');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Package = require('../models/TicketPackage');
const User = require('../models/User');
const Link = require('../models/TelegramLink');
const Delivery = require('../models/TelegramDelivery');
const profileService = require('./telegramProfileService');
const client = require('./telegramClient');
const { isEnabled, defaultForCurrentEnvironment } = require('../utils/featureFlags');

const DAY = 86400000;
const enabled = () => client.enabled() && isEnabled('SUBSCRIPTION_RENEWAL_ENABLED', defaultForCurrentEnvironment());
const due = (expiry, now) => new Date(expiry) > now && new Date(expiry).getTime() <= now.getTime() + 7 * DAY;

function renewalUrl(record, entitlementId) {
  try {
    const url = new URL('/customer/membership-transfers', process.env.TELEGRAM_WEB_APP_URL || process.env.CLIENT_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host === '0.0.0.0'
      || /^127\./.test(host) || !host.includes('.')) return null;
    url.searchParams.set(entitlementId ? 'renewEntitlementId' : 'renewSubscriptionId', String(entitlementId || record.subscriptionId));
    return url.toString();
  } catch { return null; }
}

async function currentMembership(record, now) {
  if (!enabled() || !due(record.membershipExpiresAt, now)) return null;
  const subscription = await Subscription.findById(record.subscriptionId).lean();
  if (!subscription || subscription.paymentStatus !== 'paid') return null;
  let packageId, slots, entitlementId, ownedSpaces;
  if (record.entitlementBased) {
    const owned = await Entitlement.find({ sourceSubscriptionId: record.subscriptionId, ownerId: record.membershipOwnerId,
      status: 'active', expireAt: record.membershipExpiresAt, validFrom: { $lte: now } }).sort({ _id: 1 }).lean();
    if (!owned.length) return null;
    packageId = owned[0].packageId;
    slots = owned.map(item => item.slotCode);
    entitlementId = owned[0]._id;
    ownedSpaces = owned;
  } else {
    if (String(subscription.user) !== String(record.membershipOwnerId) || subscription.status !== 'active'
      || new Date(subscription.validFrom) > now || new Date(subscription.expireAt).getTime() !== new Date(record.membershipExpiresAt).getTime()
      || await Entitlement.exists({ sourceSubscriptionId: subscription._id })) return null;
    packageId = subscription.ticketPackage;
    slots = (subscription.slots || []).map(item => item.slotCode);
  }
  const pkg = await Package.findById(packageId).lean();
  if (!pkg || pkg.isRenewable === false || !['monthly', 'yearly'].includes(pkg.type)) return null;
  if (!await User.exists({ _id: record.membershipOwnerId, status: true, role: 'customer' })) return null;
  const url = renewalUrl(record, entitlementId);
  const buttons = !url ? [] : ownedSpaces?.length > 1
    ? ownedSpaces.map(space => [{ text: `Gia hạn ô ${space.slotCode}`, url: renewalUrl(record, space._id) }])
    : [[{ text: 'Gia hạn gói', url }]];
  // A missing/local renewal URL must never suppress the expiry reminder itself.
  return { name: pkg.name, slots, url, buttons };
}

async function recipient(record) {
  const link = await Link.findOne({ _id: record.linkId, userId: record.membershipOwnerId, revokedAt: null,
    blockedAt: null, notificationsEnabled: true, chatId: record.chatId, telegramUserId: record.telegramUserId }).select('+phone');
  return link && !(new Date(record.recipientLinkedAt || record.createdAt) < link.linkedAt)
    && await profileService.matchesProfile(link) ? link : null;
}

async function enqueue(record, now) {
  const membership = await currentMembership(record, now);
  if (!membership) return null;
  const link = await Link.findOne({ userId: record.membershipOwnerId, revokedAt: null,
    blockedAt: null, notificationsEnabled: true }).select('+phone');
  if (!await profileService.matchesProfile(link)) return null;
  const dedupeKey = `membership_expiring:${record.subscriptionId}:${record.membershipOwnerId}:${new Date(record.membershipExpiresAt).getTime()}`;
  const fields = { ...record, kind: 'membership_expiring', dedupeKey, linkId: link._id,
    chatId: link.chatId, telegramUserId: link.telegramUserId, recipientLinkedAt: link.linkedAt };
  let delivery;
  try {
    delivery = await Delivery.findOneAndUpdate({ dedupeKey }, { $setOnInsert: fields }, { upsert: true, new: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    delivery = await Delivery.findOne({ dedupeKey });
  }
  // A new verification may recover a definitively cancelled old recipient, never a sent/uncertain message.
  if (delivery && ['cancelled', 'failed'].includes(delivery.status)
    && ['LINK_CHANGED', 'LINK_REVOKED', 'PROFILE_PHONE_CHANGED', 'BOT_BLOCKED'].includes(delivery.errorCode)
    && (delivery.attempts === 0 || (delivery.status === 'failed' && delivery.errorCode === 'BOT_BLOCKED'))
    && new Date(link.linkedAt) > new Date(delivery.recipientLinkedAt || delivery.createdAt)) {
    await Delivery.updateOne({ _id: delivery._id, status: delivery.status, errorCode: delivery.errorCode }, {
      $set: { linkId: link._id, chatId: link.chatId, telegramUserId: link.telegramUserId, status: 'pending',
        recipientLinkedAt: link.linkedAt, attempts: 0, nextAttemptAt: now }, $unset: { errorCode: 1 },
    });
  }
  return delivery;
}

async function reconcile(now = new Date()) {
  if (!enabled()) return 0;
  const window = { $gt: now, $lte: new Date(now.getTime() + 7 * DAY) };
  const groups = new Set();
  let count = 0;
  const candidates = Entitlement.find({ status: 'active', validFrom: { $lte: now }, expireAt: window })
    .select('sourceSubscriptionId ownerId expireAt').cursor();
  for await (const entitlement of candidates) {
    const key = `${entitlement.sourceSubscriptionId}:${entitlement.ownerId}:${entitlement.expireAt.getTime()}`;
    if (groups.has(key)) continue;
    groups.add(key);
    if (await enqueue({ subscriptionId: entitlement.sourceSubscriptionId, membershipOwnerId: entitlement.ownerId,
      membershipExpiresAt: entitlement.expireAt, entitlementBased: true }, now)) count++;
  }
  const legacy = Subscription.find({ status: 'active', paymentStatus: 'paid', validFrom: { $lte: now }, expireAt: window })
    .select('user expireAt').cursor();
  for await (const subscription of legacy) {
    if (await Entitlement.exists({ sourceSubscriptionId: subscription._id })) continue;
    if (await enqueue({ subscriptionId: subscription._id, membershipOwnerId: subscription.user,
      membershipExpiresAt: subscription.expireAt, entitlementBased: false }, now)) count++;
  }
  return count;
}

function formatReminder(membership, expiresAt, { now = new Date(), entitlementBased = false } = {}) {
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const expiry = new Date(expiresAt);
  const date = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Saigon', day: '2-digit', month: '2-digit', year: 'numeric' }).format(expiry);
  const time = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Saigon', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(expiry);
  const days = Math.ceil((expiry - now) / DAY);
  return [
    '⏳ <b>VALO PARKING</b>',
    'Nhắc gia hạn gói thành viên',
    '',
    `Gói dịch vụ: <b>${escape(membership.name)}</b>`,
    ...(membership.slots.length ? [`Ô đỗ: <b>${escape(membership.slots.join(', '))}</b>`] : []),
    `Thời hạn còn lại: <b>${days} ngày</b>`,
    `Hết hạn (GMT+7): <b>${date} · ${time}</b>`,
    '',
    'Vui lòng gia hạn trước thời điểm hết hạn để tiếp tục sử dụng gói và giữ vị trí đỗ xe.',
    ...(membership.buttons?.length ? [
      ...(membership.slots.length > 1 && entitlementBased ? ['Mỗi ô được gia hạn riêng. Chọn ô cần gia hạn bên dưới.'] : []),
      'Bấm nút bên dưới để xem giá và xác nhận gia hạn.',
    ] : []),
  ].join('\n');
}

async function processDelivery(record) {
  const cancelled = { status: 'cancelled', errorCode: 'MEMBERSHIP_CHANGED' };
  const now = new Date();
  let membership = await currentMembership(record, now);
  if (!membership) return cancelled;
  if (!await recipient(record)) return { status: 'cancelled', errorCode: 'LINK_CHANGED' };
  // Use the latest owned spaces for both the text and renewal links.
  membership = await currentMembership(record, new Date());
  if (!membership || !await recipient(record)) return cancelled;
  const text = formatReminder(membership, record.membershipExpiresAt, { now, entitlementBased: record.entitlementBased });
  const sent = await client.sendMessage(record.chatId, text,
    membership.buttons.length ? { inline_keyboard: membership.buttons } : undefined, { parseMode: 'HTML' });
  return { status: 'sent', sentAt: new Date(), messageId: sent.message_id };
}

module.exports = { reconcile, processDelivery, renewalUrl, due, formatReminder };
