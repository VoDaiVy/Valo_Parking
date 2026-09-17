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
    targetRoles: ['admin', 'staff'],
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
    targetRoles: ['admin', 'staff'],
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

async function notifyUserRegistered(user, app) {
  if (!user) return false;
  return insertEvent({
    app,
    deduplicationKey: `new-user:${user._id}`,
    notificationType: 'NEW_USER_REGISTERED', severity: 'NOTICE',
    targetRoles: ['admin', 'staff'],
    title: 'Khách hàng mới đăng ký',
    summary: `${user.username} vừa tạo tài khoản VALO.`,
    entityType: 'User', entityId: user._id, targetRoute: `/admin/accounts?userId=${user._id}`,
    evidence: { username: user.username, email: user.email, role: user.role, createdAt: user.createdAt },
    sourceModules: ['Auth'], detectedAt: new Date(),
  });
}

function notifyUserRegisteredSafely(user, app) {
  return notifyUserRegistered(user, app).catch((error) => {
    console.error('[VALO AI Notification] NEW_USER_REGISTERED:', error);
    return false;
  });
}

async function notifySessionCreated(session, app) {
  if (!session) return false;
  return insertEvent({
    app,
    deduplicationKey: `new-session:${session._id}`,
    notificationType: 'NEW_SESSION', severity: 'NOTICE',
    targetRoles: ['admin', 'staff'],
    title: 'Phiên đỗ xe mới',
    summary: `Xe ${session.licensePlate} vừa bắt đầu đỗ tại tầng ${session.floorId}, vị trí ${session.parkingSlot}.`,
    entityType: 'Session', entityId: session._id, targetRoute: `/admin/sessions?sessionId=${session._id}`,
    evidence: { licensePlate: session.licensePlate, floor: session.floorId, slot: session.parkingSlot, type: session.type, source: session.source, checkInTime: session.checkInTime, status: session.status },
    sourceModules: ['Session'], detectedAt: new Date(),
  });
}

function notifySessionCreatedSafely(session, app) {
  return notifySessionCreated(session, app).catch((error) => {
    console.error('[VALO AI Notification] NEW_SESSION:', error);
    return false;
  });
}

async function notifyVehiclePending(vehicle, app) {
  if (!vehicle || vehicle.status !== 'pending') return false;
  return insertEvent({
    app,
    deduplicationKey: `vehicle-pending:${vehicle._id}`,
    notificationType: 'VEHICLE_PENDING_VERIFICATION', severity: 'CRITICAL',
    targetRoles: ['admin'],
    title: 'Xe đang chờ xác minh',
    summary: `Biển số ${vehicle.licensePlate} vừa được đăng ký và cần Admin kiểm tra.`,
    entityType: 'Vehicle', entityId: vehicle._id, targetRoute: `/admin/vehicle-models?vehicleId=${vehicle._id}`,
    evidence: { licensePlate: vehicle.licensePlate, vehicleType: vehicle.vehicleType, owner: vehicle.userId, status: vehicle.status, createdAt: vehicle.createdAt },
    sourceModules: ['Vehicle'], detectedAt: new Date(),
  });
}

function notifyVehiclePendingSafely(vehicle, app) {
  return notifyVehiclePending(vehicle, app).catch((error) => {
    console.error('[VALO AI Notification] VEHICLE_PENDING_VERIFICATION:', error);
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
  notifySubscriptionActivatedSafely,
  notifyUserRegisteredSafely,
  notifySessionCreatedSafely,
  notifyVehiclePendingSafely
};
