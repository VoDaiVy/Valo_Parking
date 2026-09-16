const AINotification = require('../../models/AINotification');

async function insertEvent({ app, deduplicationKey, ...fields }) {
  let result;
  try {
    result = await AINotification.updateOne(
      { deduplicationKey, status: 'OPEN' },
      { $setOnInsert: { ...fields, deduplicationKey, status: 'OPEN' } },
      { upsert: true }
    );
  } catch (error) {
    // A concurrent worker may have inserted the same open event first.
    if (error.code === 11000) return false;
    throw error;
  }
  if (!result.upsertedCount) return false;
  const io = app?.get?.('io');
  if (io) {
    const roles = fields.targetRoles || ['admin'];
    const payload = { id: result.upsertedId, title: fields.title, severity: fields.severity };
    if (roles.includes('admin')) io.to('valo-ai-admins').emit('ai:notification', payload);
    if (roles.includes('staff')) io.to('valo-ai-staffs').emit('ai:notification', payload);
  }
  return true;
}

async function notifyBookingPaid(booking, app) {
  if (!booking || booking.status !== 'PAID') return false;
  return insertEvent({
    app,
    deduplicationKey: `new-booking:${booking._id}`,
    notificationType: 'NEW_BOOKING', severity: 'NOTICE',
    targetRoles: ['admin'],
    title: 'Có booking mới',
    summary: `Booking xe ${booking.licensePlate} tại vị trí ${booking.parkingSlot} đã được thanh toán.`,
    entityType: 'booking', entityId: booking._id, targetRoute: `/admin/parking-lots?bookingId=${booking._id}`,
    evidence: { bookingId: booking._id, status: booking.status },
    sourceModules: ['Booking'], detectedAt: new Date(),
  });
}

function notifyBookingPaidSafely(booking, app) {
  return notifyBookingPaid(booking, app).catch((error) => {
    console.error('[VALO AI Notification] NEW_BOOKING:', error);
    return false;
  });
}

async function notifyBookingCancelled(booking, app) {
  if (!booking || booking.status !== 'CANCELLED') return false;
  return insertEvent({
    app,
    deduplicationKey: `booking-cancelled:${booking._id}`,
    notificationType: 'BOOKING_CANCELLED', severity: 'NOTICE',
    targetRoles: ['admin', 'staff'],
    title: `Booking bị hủy`,
    summary: `Booking của xe ${booking.licensePlate} tại vị trí ${booking.parkingSlot} đã bị hủy.`,
    entityType: 'booking', entityId: booking._id, targetRoute: `/admin/parking-lots?bookingId=${booking._id}`,
    evidence: { bookingId: booking._id, status: booking.status },
    sourceModules: ['Booking'], detectedAt: new Date(),
  });
}

function notifyBookingCancelledSafely(booking, app) {
  return notifyBookingCancelled(booking, app).catch((error) => {
    console.error('[VALO AI Notification] BOOKING_CANCELLED:', error);
    return false;
  });
}

async function notifySubscriptionActivated(subscription, ticketPackage, app) {
  if (!subscription || subscription.status !== 'active') return false;
  return insertEvent({
    app,
    deduplicationKey: `new-subscription:${subscription._id}`,
    notificationType: 'NEW_SUBSCRIPTION', severity: 'NOTICE',
    targetRoles: ['admin'],
    title: `Đăng ký gói VIP mới`,
    summary: `Khách hàng vừa kích hoạt gói VIP ${ticketPackage?.type === 'monthly' ? 'Tháng' : 'Năm'}.`,
    entityType: 'subscription', entityId: subscription._id, targetRoute: '/admin/subscriptions',
    evidence: { subscriptionId: subscription._id, status: subscription.status },
    sourceModules: ['Subscription'], detectedAt: new Date(),
  });
}

function notifySubscriptionActivatedSafely(subscription, ticketPackage, app) {
  return notifySubscriptionActivated(subscription, ticketPackage, app).catch((error) => {
    console.error('[VALO AI Notification] NEW_SUBSCRIPTION:', error);
    return false;
  });
}

module.exports = { 
  insertEvent, 
  notifyBookingPaid, 
  notifyBookingPaidSafely,
  notifyBookingCancelled,
  notifyBookingCancelledSafely,
  notifySubscriptionActivated,
  notifySubscriptionActivatedSafely
};
