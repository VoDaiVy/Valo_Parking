const Notification = require('../models/Notification');
const Inbox = require('../models/UserNotification');
const { emitNotification } = require('../sockets/notificationSocket');

async function create(request, actorId, session) {
  const status = request.status;
  const labels = { in_progress: 'Service started', done: 'Service completed', cancelled: 'Service cancelled' };
  if (!labels[status]) return null;
  const reason = request.history?.at(-1)?.reason;
  const usage = status === 'in_progress' ? '1 included use has been applied.'
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
      deepLink: '/customer/membership-transfers#membership-services' },
  }], { session });
  await Inbox.create([{ userId: request.requesterId, notificationId: notification._id }], { session });
  return notification;
}

async function publish(app, notifications) {
  const io = app?.get?.('io');
  if (!io) return; // The durable inbox remains available on the next fetch.
  for (const notification of notifications.filter(Boolean)) {
    try {
      await emitNotification(io, notification.targetUsers[0], notification, { notifyAdmins: false });
    } catch (error) {
      // A delivery failure must not turn an already committed service action into an API failure.
      console.error('[MembershipServices] Realtime notification failed:', error.message);
    }
  }
}

module.exports = { create, publish };
