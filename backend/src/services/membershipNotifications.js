const notificationService = require('./notificationService');
const { emitNotification } = require('../sockets/notificationSocket');
const Entitlement = require('../models/MembershipSlotEntitlement');
const Subscription = require('../models/Subscription');
const EntitlementRenewal = require('../models/MembershipEntitlementRenewal');
const SubscriptionRenewal = require('../models/SubscriptionRenewal');
const { isInRenewalWindow, renewalWindowDays } = require('../utils/membershipRenewalWindow');
const EventLog = require('../models/NotificationEventLog');
const Notification = require('../models/Notification');
const Inbox = require('../models/UserNotification');

function expiryIdentity(entity, expired = false, kind = 'entitlement') {
  const userId = String(entity.ownerId || entity.user);
  const eventType = kind === 'entitlement'
    ? (expired ? 'MEMBERSHIP_ENTITLEMENT_EXPIRED' : 'MEMBERSHIP_ENTITLEMENT_EXPIRING_SOON')
    : (expired ? 'VIP_EXPIRED' : 'VIP_EXPIRING_SOON');
  const cycle = new Date(entity.expireAt).toISOString();
  return { userId, eventType, cycle, referenceId: `${entity._id}:${eventType}:${cycle}:${userId}` };
}

async function hasValidExpiryNotification(entity, expired = false, kind = 'entitlement') {
  const { userId, eventType, cycle, referenceId } = expiryIdentity(entity, expired, kind);
  const log = await EventLog.findOne({ eventType, referenceId }).select('notificationId').lean();
  if (!log?.notificationId) return false;
  const notification = await Notification.exists({
    _id: log.notificationId, targetUsers: userId, priority: 'WARNING', isRevoked: { $ne: true },
    'metadata.eventType': eventType, 'metadata.expiryCycle': cycle,
    [`metadata.${kind === 'entitlement' ? 'entitlementId' : 'subscriptionId'}`]: String(entity._id),
  });
  // Read/dismissed records remain delivered; do not reset those flags.
  return Boolean(notification && await Inbox.exists({ userId, notificationId: log.notificationId }));
}

async function publish(app, userId, data, guard) {
  const cycle = new Date(data.expireAt).toISOString();
  const objectId = String(data.entitlementId || data.subscriptionId);
  const reference = `${objectId}:${data.eventType}:${cycle}:${userId}`;
  const notification = await notificationService.createAutoNotification(
    data.eventType, reference, userId, data.eventType,
    { ...data, expiryCycle: cycle, expireDate: new Date(data.expireAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'long', timeZone: 'Asia/Ho_Chi_Minh' }),
      deepLink: data.entitlementId
        ? `/customer/membership-transfers?entitlementId=${encodeURIComponent(data.entitlementId)}`
        : `/customer/membership-transfers?subscriptionId=${encodeURIComponent(data.subscriptionId)}` },
    { atomicMembership: true, guard },
  );
  const io = app?.get?.('io');
  if (notification && io) await emitNotification(io, userId, notification, { notifyAdmins: false });
  return true; // Includes a duplicate already persisted by the existing pipeline.
}

async function notifyExpiry(app, entity, expired = false, kind = 'entitlement') {
  try {
    const Model = kind === 'entitlement' ? Entitlement : Subscription;
    await Model.populate(entity, kind === 'entitlement'
      ? [{ path: 'packageId', select: 'name renewalWindowDays' }, { path: 'floorId', select: 'name floorNumber' }]
      : [{ path: 'ticketPackage', select: 'name renewalWindowDays' }, { path: 'slots.floorId', select: 'name floorNumber' }]);
    const floor = (value) => value?.name || (value?.floorNumber != null ? `Floor ${value.floorNumber}` : 'Floor unavailable');
    const now = new Date();
    const expiry = new Date(entity.expireAt);
    const pkg = kind === 'entitlement' ? entity.packageId : entity.ticketPackage;
    if (expired ? expiry > now : !isInRenewalWindow(expiry, pkg, now)) return false;
    const guard = async (session) => {
      const checkedAt = new Date();
      if (expired ? expiry > checkedAt : !isInRenewalWindow(expiry, pkg, checkedAt)) return false;
      // Write the same lifecycle document as renewal. Concurrent renewal
      // conflicts/retries this transaction, preventing stale-cycle reminders.
      const result = await Model.updateOne({
        _id: entity._id, [kind === 'entitlement' ? 'ownerId' : 'user']: entity.ownerId || entity.user,
        expireAt: entity.expireAt, status: expired ? 'expired' : { $in: ['active', 'transfer_locked'] },
      }, { $set: expired ? { expiryNotificationPending: false } :
        kind === 'entitlement' ? { expireWarningSentAt: now } : { expireWarningSent: true } }, { session });
      return result.matchedCount === 1;
    };
    return await publish(app, entity.ownerId || entity.user, {
      eventType: kind === 'entitlement'
        ? (expired ? 'MEMBERSHIP_ENTITLEMENT_EXPIRED' : 'MEMBERSHIP_ENTITLEMENT_EXPIRING_SOON')
        : (expired ? 'VIP_EXPIRED' : 'VIP_EXPIRING_SOON'),
      entitlementId: kind === 'entitlement' ? String(entity._id) : null,
      subscriptionId: String(entity.sourceSubscriptionId || entity._id),
      slotCode: entity.slotCode || 'your reserved spaces',
      packageName: entity.packageId?.name || entity.ticketPackage?.name || 'Membership',
      floorName: kind === 'entitlement' ? floor(entity.floorId) : (entity.slots || []).map((slot) => `${slot.slotCode} / ${floor(slot.floorId)}`).join(', ') || 'Floor unavailable',
      expireAt: entity.expireAt,
      renewalWindowDays: renewalWindowDays(pkg),
    }, guard);
  } catch (error) {
    console.error('[MembershipNotifications] Expiry notification will be retried:', error.message);
    return false;
  }
}

async function notifyRenewal(renewal, kind = 'entitlement', app = null) {
  if (renewal.status !== 'paid' || !renewal.notificationPending) return false;
  const Model = kind === 'entitlement' ? EntitlementRenewal : SubscriptionRenewal;
  try {
    const entity = kind === 'entitlement'
      ? await Entitlement.findOne({ _id: renewal.entitlementId, ownerId: renewal.userId }).select('slotCode floorId')
      : await Subscription.findOne({ _id: renewal.subscriptionId, user: renewal.userId }).select('_id');
    if (entity) {
      if (kind === 'entitlement') await Entitlement.populate(entity, { path: 'floorId', select: 'name floorNumber' });
      await publish(app, renewal.userId, {
        eventType: kind === 'entitlement' ? 'MEMBERSHIP_ENTITLEMENT_RENEWAL_SUCCESS' : 'SUBSCRIPTION_RENEWAL_SUCCESS',
        entitlementId: kind === 'entitlement' ? String(renewal.entitlementId) : null,
        subscriptionId: String(renewal.sourceSubscriptionId || renewal.subscriptionId),
        renewalId: String(renewal._id),
        slotCode: entity.slotCode || 'your reserved spaces',
        floorName: entity.floorId?.name || (entity.floorId?.floorNumber != null ? `Floor ${entity.floorId.floorNumber}` : 'Floor unavailable'),
        packageName: renewal.packageSnapshot?.name || 'Membership',
        expireAt: renewal.newExpireAt,
        renewedExpireDate: new Date(renewal.newExpireAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Ho_Chi_Minh' }),
        oldExpireAt: renewal.oldExpireAt,
        amount: renewal.amount,
      });
    }
    // Do not send old transaction data to a new owner after a transfer.
    await Model.updateOne({ _id: renewal._id, status: 'paid' }, { $set: { notificationPending: false, notificationProcessedAt: new Date() } });
    return true;
  } catch (error) {
    console.error('[MembershipNotifications] Paid renewal notification will be retried:', error.message);
    return false; // The committed renewal must never be rolled back by messaging.
  }
}

async function retryPending(app) {
  for (const [Model, kind] of [[EntitlementRenewal, 'entitlement'], [SubscriptionRenewal, 'subscription']]) {
    const rows = await Model.find({ status: 'paid', notificationPending: true }).sort({ paidAt: 1 }).limit(100);
    for (const row of rows) await notifyRenewal(row, kind, app);
  }
}

module.exports = { publish, notifyExpiry, notifyRenewal, retryPending, hasValidExpiryNotification };
