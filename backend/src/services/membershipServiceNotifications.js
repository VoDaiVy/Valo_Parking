const Notification = require('../models/Notification');
const Inbox = require('../models/UserNotification');
const { emitNotification } = require('../sockets/notificationSocket');

async function create(request, actorId, session) {
  const status = request.status;
  const labels = { pending: 'Service requested', in_progress: 'Service started', done: 'Service completed', cancelled: 'Service cancelled' };
  if (!labels[status]) return null;
  const reason = request.history?.at(-1)?.reason;
  const usage = status === 'pending' ? '1 included use has been reserved.' : status === 'in_progress' ? '1 included use has been applied.'
    : status === 'cancelled' ? '1 included use has been returned to its original service period.'
      : 'No additional included use has been deducted.';
  const [notification] = await Notification.create([{
    title: labels[status],
    content: `${request.serviceName} · ${request.licensePlate} · Space ${request.slotCode}. ${usage}${status === 'cancelled' && reason ? ` Reason: ${reason}` : ''}`,
    type: 'PARKING', priority: status === 'done' ? 'SUCCESS' : status === 'cancelled' ? 'WARNING' : 'INFO',
    targetType: 'SINGLE_USER', targetUsers: [request.requesterId], recipientCount: 1, createdBy: actorId,
    metadata: { eventType: 'MEMBERSHIP_SERVICE_STATUS_CHANGED', serviceRequestId: String(request._id),
      sessionId: request.sessionId ? String(request.sessionId) : null, serviceStatus: status,
      serviceName: request.serviceName, licensePlate: request.licensePlate, slotCode: request.slotCode,
      deepLink: request.accountingMode === 'customer_reserved' ? `/customer/history?sessionId=${request.sessionId}` : '/customer/membership-transfers#membership-services' },
  }], { session });
  await Inbox.create([{ userId: request.requesterId, notificationId: notification._id }], { session });
  return notification;
}

async function publish(app, notifications) {
  const io = app?.get?.('io');
  if (!io) return; // The durable inbox remains available on the next fetch.
  for (const notification of notifications.filter(Boolean)) {
    try {
      for (const userId of notification.targetUsers) await emitNotification(io, userId, notification, { notifyAdmins: false });
    } catch (error) {
      // A delivery failure must not turn an already committed service action into an API failure.
      console.error('[MembershipServices] Realtime notification failed:', error.message);
    }
  }
}

async function createStaff(request, actorId, session) {
  const recipients = await require('../models/User').find({ role: { $in: ['staff', 'admin'] }, status: true }).select('_id').session(session);
  if (!recipients.length) return null;
  const [notification] = await Notification.create([{
    title: request.status === 'pending' ? 'Membership service requested' : 'Membership service updated',
    content: `${request.serviceName} · ${request.licensePlate} · Space ${request.slotCode}: ${request.status}`,
    type: 'PARKING', priority: 'INFO', targetType: 'MULTI_USER', targetUsers: recipients.map((r) => r._id),
    recipientCount: recipients.length, createdBy: actorId,
    metadata: { eventType: 'MEMBERSHIP_SERVICE_REQUESTED', sessionId: String(request.sessionId), serviceRequestId: String(request._id),
      deepLink: `/staff/membership-services?sessionId=${request.sessionId}&requestId=${request._id}` },
  }], { session });
  await Inbox.insertMany(recipients.map((r) => ({ userId: r._id, notificationId: notification._id })), { session });
  return notification;
}
module.exports = { create, createStaff, publish };
