const Session = require('../models/Session');
const Booking = require('../models/Booking');
const notifTriggers = require('./notificationTriggers');
const contractService = require('./contractService');
const bookingRefundService = require('./bookingRefundService');
const { isEnabled } = require('../utils/featureFlags');
const { emitToUser } = require('../sockets/notificationSocket');

const CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
const CONTRACT_EXPIRATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const LOW_BALANCE_THRESHOLD = 30000; // 30,000 VND
const NO_SHOW_GRACE_MS = 15 * 60 * 1000;
const CHECKIN_REMINDER_MINUTES = [15, 30];
const BOOKING_END_REMINDER_MINUTES = [5, 15, 30];

let schedulerInterval = null;
let contractSchedulerInterval = null;

function getUpcomingMilestone(targetTime, now = new Date(), milestones = []) {
  const target = new Date(targetTime);
  const current = new Date(now);
  const remainingMs = target.getTime() - current.getTime();

  if (
    Number.isNaN(target.getTime()) ||
    Number.isNaN(current.getTime()) ||
    remainingMs <= 0
  ) {
    return null;
  }

  return [...milestones]
    .sort((left, right) => left - right)
    .find((minutes) => remainingMs <= minutes * 60 * 1000) || null;
}

function toBookingNotificationDetails(booking) {
  return {
    bookingId: String(booking._id),
    slotInfo: booking.parkingSlot,
    scheduledStart: booking.scheduledStart,
    scheduledEnd: booking.scheduledEnd,
  };
}

function emitBookingChanged(app, booking) {
  if (!app || !booking?.userId) return;

  try {
    const io = app.get('io');
    if (!io) return;

    emitToUser(io, booking.userId, 'booking:changed', {
      bookingId: String(booking._id),
      status: booking.status,
      slotCode: booking.parkingSlot,
      floorId: booking.floorId ? String(booking.floorId) : null,
    });
  } catch (error) {
    console.error(
      `[ParkingScheduler] Failed to emit booking change ${booking._id}:`,
      error.message
    );
  }
}

async function isBookingScheduleCurrent(booking, status, scheduleField) {
  return Boolean(
    await Booking.exists({
      _id: booking._id,
      status,
      [scheduleField]: booking[scheduleField],
    })
  );
}

/**
 * Kiểm tra các phiên đặt chỗ (Booking) ngầm để hủy, hết hạn hoặc hoàn tất sớm
 */
async function checkBookings(app) {
  try {
    const now = new Date();

    // 1. Tự động hủy các booking PENDING VietQR quá 15 phút chưa thanh toán
    const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);
    const pendingCancelResult = await Booking.updateMany(
      {
        status: 'PENDING',
        paymentMethod: 'vietqr',
        createdAt: { $lt: fifteenMinsAgo }
      },
      { status: 'CANCELLED' }
    );
    if (pendingCancelResult.modifiedCount > 0) {
      console.log(`[ParkingScheduler] Đã tự động hủy ${pendingCancelResult.modifiedCount} đặt chỗ chờ thanh toán VietQR.`);
    }

    // 2. Nhắc check-in trước giờ bắt đầu (30/15 phút).
    // Dedup key của notification có cả bookingId, milestone và scheduledStart,
    // nên scheduler chạy mỗi phút vẫn chỉ gửi một lần cho mỗi mốc/lịch đặt.
    const upcomingCheckins = await Booking.find({
      status: 'PAID',
      userId: { $ne: null },
      scheduledStart: {
        $gt: now,
        $lte: new Date(now.getTime() + 30 * 60 * 1000),
      },
    }).lean();

    for (const booking of upcomingCheckins) {
      const milestone = getUpcomingMilestone(
        booking.scheduledStart,
        now,
        CHECKIN_REMINDER_MINUTES
      );

      if (
        milestone &&
        await isBookingScheduleCurrent(booking, 'PAID', 'scheduledStart')
      ) {
        await notifTriggers.notifyBookingCheckinReminder(
          app,
          booking.userId,
          toBookingNotificationDetails(booking),
          milestone
        );
      }
    }

    // 3. PAID -> EXPIRED khi trễ check-in từ 15 đến dưới 30 phút.
    // findOneAndUpdate kèm status guard đảm bảo chỉ một scheduler đổi trạng thái.
    const gracePeriodLimit = new Date(now.getTime() - 15 * 60 * 1000);
    const cancelPeriodLimit = new Date(now.getTime() - 30 * 60 * 1000);
    const expiredBookingCandidates = await Booking.find({
      status: 'PAID',
      scheduledStart: { $gt: cancelPeriodLimit, $lte: gracePeriodLimit }
    }).select('_id').lean();

    for (const candidate of expiredBookingCandidates) {
      const booking = await Booking.findOneAndUpdate(
        {
          _id: candidate._id,
          status: 'PAID',
          scheduledStart: { $gt: cancelPeriodLimit, $lte: gracePeriodLimit },
        },
        { $set: { status: 'EXPIRED' } },
        { new: true }
      );
      if (!booking) continue;

      console.log(`[ParkingScheduler] Đặt chỗ ${booking._id} của xe ${booking.licensePlate} đã hết hạn check-in (15 phút).`);

      if (booking.userId) {
        await notifTriggers.notifyBookingCheckinExpired(
          app,
          booking.userId,
          toBookingNotificationDetails(booking)
        );
      }
      emitBookingChanged(app, booking);
    }

    // 4. PAID/EXPIRED -> CANCELLED khi no-show từ 30 phút.
    // Cho phép PAID để tự phục hồi nếu scheduler từng dừng qua mốc EXPIRED.
    // Refund và đổi trạng thái cùng nằm trong transaction/idempotency settlement.
    const noShowBookingCandidates = await Booking.find({
      status: { $in: ['PAID', 'EXPIRED'] },
      scheduledStart: { $lte: cancelPeriodLimit }
    }).lean();

    for (const candidate of noShowBookingCandidates) {
      try {
        const refundBreakdown = await bookingRefundService.quoteNoShow(candidate);
        const result = await bookingRefundService.settleBookingEvent({
          bookingId: candidate._id,
          eventKey: `booking:${candidate._id}:no-show`,
          eventType: 'no_show',
          calculation: refundBreakdown,
          description: `Settle no-show booking ${candidate._id}`,
          applyState: async ({ booking: currentBooking }) => {
            const isStillNoShow =
              ['PAID', 'EXPIRED'].includes(currentBooking.status) &&
              new Date(currentBooking.scheduledStart).getTime() <= cancelPeriodLimit.getTime();

            if (!isStillNoShow) {
              throw Object.assign(new Error('Booking is no longer eligible for no-show cancellation'), {
                statusCode: 409,
              });
            }
            currentBooking.status = 'CANCELLED';
          },
        });
        const booking = result.booking;

        console.log(`[ParkingScheduler] Đặt chỗ ${booking._id} của xe ${booking.licensePlate} bị hủy hoàn toàn do trễ quá 30 phút.`);

        if (booking.userId) {
          await notifTriggers.notifyBookingNoShowCancelled(
            app,
            booking.userId,
            toBookingNotificationDetails(booking)
          );
        }
        emitBookingChanged(app, booking);
      } catch (error) {
        console.error(`[ParkingScheduler] Failed to settle no-show booking ${candidate._id}:`, error);
      }
    }

    // 5. Nhắc booking ACTIVE trước scheduledEnd (30/15/5 phút) và khi hết giờ.
    const activeBookingsEndingSoon = await Booking.find({
      status: 'ACTIVE',
      userId: { $ne: null },
      scheduledEnd: {
        $gt: now,
        $lte: new Date(now.getTime() + 30 * 60 * 1000),
      },
    }).lean();

    for (const booking of activeBookingsEndingSoon) {
      const milestone = getUpcomingMilestone(
        booking.scheduledEnd,
        now,
        BOOKING_END_REMINDER_MINUTES
      );

      if (
        milestone &&
        await isBookingScheduleCurrent(booking, 'ACTIVE', 'scheduledEnd')
      ) {
        await notifTriggers.notifyBookingEndingSoon(
          app,
          booking.userId,
          toBookingNotificationDetails(booking),
          milestone
        );
      }
    }

    const activeBookingsPastEnd = await Booking.find({
      status: 'ACTIVE',
      userId: { $ne: null },
      scheduledEnd: { $lte: now },
    }).lean();

    for (const booking of activeBookingsPastEnd) {
      if (await isBookingScheduleCurrent(booking, 'ACTIVE', 'scheduledEnd')) {
        await notifTriggers.notifyBookingTimeExpired(
          app,
          booking.userId,
          toBookingNotificationDetails(booking)
        );
      }
    }

    // 6. Hoàn tất Booking PAUSED nếu còn ít hơn 30 phút để quay lại.
    // Giữ nguyên refund engine/policy mới nhất của TrainAI_Vy.
    const limitTimeForPaused = new Date(now.getTime() + 30 * 60 * 1000);
    const pausedBookingsToComplete = await Booking.find({
      status: 'PAUSED',
      scheduledEnd: { $lt: limitTimeForPaused }
    }).lean();

    for (const candidate of pausedBookingsToComplete) {
      try {
        const refundBreakdown = await bookingRefundService.quoteEarlyCheckout(
          candidate,
          null,
          now
        );
        const result = await bookingRefundService.settleBookingEvent({
          bookingId: candidate._id,
          eventKey: `booking:${candidate._id}:early-checkout`,
          eventType: 'paused_completion',
          calculation: refundBreakdown,
          description: `Settle paused booking ${candidate._id}`,
          applyState: async ({ booking: currentBooking }) => {
            const isStillCompletable =
              currentBooking.status === 'PAUSED' &&
              new Date(currentBooking.scheduledEnd).getTime() < limitTimeForPaused.getTime();

            if (!isStillCompletable) {
              throw Object.assign(new Error('Booking is no longer eligible for paused completion'), {
                statusCode: 409,
              });
            }
            currentBooking.status = 'COMPLETED';
          },
        });
        const booking = result.booking;

        emitBookingChanged(app, booking);
        console.log(`[ParkingScheduler] Booking PAUSED ${booking._id} tự động chuyển sang COMPLETED do hết thời gian chờ quay lại.`);
      } catch (refundErr) {
        console.error(`[ParkingScheduler] Lỗi hoàn phí tự động cho booking PAUSED ${candidate._id}:`, refundErr.message);
      }
    }
  } catch (err) {
    console.error('[ParkingScheduler] Lỗi checkBookings:', err.message);
  }
}

async function checkActiveSessions(app) {
  try {
    const activeSessions = await Session.find({
      status: 'active',
      userId: { $ne: null }, // Only notify registered users
      expectedDurationHours: { $gt: 0 },
      type: { $ne: 'BOOKING' },
    }).lean();

    if (activeSessions.length === 0) return;

    const now = new Date();

    for (const session of activeSessions) {
      try {
        const checkInTime = new Date(session.checkInTime);
        const expectedEndTime = new Date(
          checkInTime.getTime() + session.expectedDurationHours * 60 * 60 * 1000
        );
        const remainingMs = expectedEndTime.getTime() - now.getTime();
        const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));

        const userId = session.userId.toString();
        const sessionId = session._id.toString();

        // ── Expired ──
        if (remainingMinutes <= 0) {
          await notifTriggers.notifyParkingExpired(app, userId, sessionId);
          continue;
        }

        // ── 5 minutes warning ──
        if (remainingMinutes === 5) {
          await notifTriggers.notifyParkingTimeWarning(app, userId, sessionId, 5);
          continue;
        }

        // ── 15 minutes warning ──
        if (remainingMinutes === 15) {
          await notifTriggers.notifyParkingTimeWarning(app, userId, sessionId, 15);
          continue;
        }

        // ── 30 minutes warning ──
        if (remainingMinutes === 30) {
          await notifTriggers.notifyParkingTimeWarning(app, userId, sessionId, 30);
          continue;
        }
      } catch (sessionErr) {
        console.error(
          `[ParkingScheduler] Error processing session ${session._id}:`,
          sessionErr.message
        );
      }
    }
  } catch (err) {
    console.error('[ParkingScheduler] Error checking active sessions:', err.message);
  }
}

async function checkExpiredContracts(app) {
  try {
    const expiredCount = await contractService.expireContracts(app);
    if (expiredCount > 0) {
      console.log(`[ParkingScheduler] Expired ${expiredCount} contracts.`);
    }
  } catch (err) {
    console.error('[ParkingScheduler] Error expiring contracts:', err.message);
  }
}

async function checkExpiredMembershipTransfers() {
  try {
    const {
      releaseExpiredTransferLocks,
    } = require('./membershipEntitlementTransferService');
    const releasedCount = await releaseExpiredTransferLocks(new Date());
    if (releasedCount > 0) {
      console.log(
        `[ParkingScheduler] Released ${releasedCount} expired membership transfer holds.`
      );
    }
  } catch (err) {
    console.error(
      '[ParkingScheduler] Error releasing membership transfer holds:',
      err.message
    );
  }
}

async function checkVIPSubscriptions(app) {
  try {
    const Subscription = require('../models/Subscription');
    const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
    const {
      recomputeUserMembership,
    } = require('./membershipProjectionService');
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const Slot = require('../models/Slot');
    const entitlementSubscriptions = await MembershipSlotEntitlement.distinct(
      'sourceSubscriptionId'
    );
    const expiringEntitlements = await MembershipSlotEntitlement.find({
      status: 'active',
      expireAt: { $lte: threeDaysFromNow, $gt: now },
      expireWarningSentAt: null,
    });
    for (const entitlement of expiringEntitlements) {
      notifTriggers.notifySystemMessage(app, entitlement.ownerId, {
        title: 'VIP parking space expiring',
        body: `Your VIP space ${entitlement.slotCode} expires on ${entitlement.expireAt.toLocaleDateString()}. Renew this space to keep it reserved.`,
        type: 'SYSTEM',
      }).catch((err) => console.error('Failed to send VIP entitlement warning:', err));
      entitlement.expireWarningSentAt = now;
      await entitlement.save();
    }

    const expiredEntitlements = await MembershipSlotEntitlement.find({
      status: { $in: ['active', 'transfer_locked'] },
      expireAt: { $lte: now },
    });
    const affectedUsers = new Set();
    const affectedSubscriptions = new Set();
    for (const entitlement of expiredEntitlements) {
      const updated = await MembershipSlotEntitlement.findOneAndUpdate(
        {
          _id: entitlement._id,
          status: { $in: ['active', 'transfer_locked'] },
          expireAt: { $lte: now },
        },
        { $set: { status: 'expired' } },
        { new: true }
      );
      if (!updated) continue;
      await Slot.updateOne(
        {
          _id: updated.slotId,
          reservedByEntitlementId: updated._id,
        },
        {
          $unset: {
            reservedFor: '',
            reservedBySubscriptionId: '',
            reservedByEntitlementId: '',
            reservedUntil: '',
          },
        }
      );
      affectedUsers.add(String(updated.ownerId));
      affectedSubscriptions.add(String(updated.sourceSubscriptionId));
      notifTriggers.notifySystemMessage(app, updated.ownerId, {
        title: 'VIP parking space expired',
        body: `Your VIP space ${updated.slotCode} has expired and was released.`,
        type: 'SYSTEM',
      }).catch((err) => console.error('Failed to send VIP entitlement expiry:', err));
    }
    for (const userId of affectedUsers) {
      await recomputeUserMembership(userId, { rotateQr: true, now });
    }
    for (const subscriptionId of affectedSubscriptions) {
      const remaining = await MembershipSlotEntitlement.findOne({
        sourceSubscriptionId: subscriptionId,
        status: { $in: ['active', 'transfer_locked'] },
        expireAt: { $gt: now },
      }).select('_id expireAt');
      if (!remaining) {
        await Subscription.updateOne(
          { _id: subscriptionId },
          { $set: { status: 'expired' } }
        );
      }
    }

    // 1. Send warning for subscriptions expiring in <= 3 days
    const expiringSubscriptions = await Subscription.find({
      _id: { $nin: entitlementSubscriptions },
      status: 'active',
      expireAt: { $lte: threeDaysFromNow, $gt: now },
      expireWarningSent: { $ne: true }
    });

    for (const sub of expiringSubscriptions) {
      if (sub.user) {
        notifTriggers.notifySystemMessage(app, sub.user, {
          title: 'Sắp hết hạn VIP Pass / VIP Pass Expiring',
          body: `Gói đỗ xe tháng của bạn sẽ hết hạn vào ${sub.expireAt.toLocaleDateString()}. Vui lòng gia hạn để giữ vị trí ô đỗ cố định của bạn. / Your monthly pass expires on ${sub.expireAt.toLocaleDateString()}. Please renew to keep your fixed parking slot.`,
          type: 'SYSTEM'
        }).catch(err => console.error('Failed to send VIP warning:', err));
      }
      sub.expireWarningSent = true;
      await sub.save();
      console.log(`[ParkingScheduler] Sent VIP expiration warning for subscription ${sub._id}.`);
    }

    // 2. Mark expired subscriptions
    const expiredSubscriptions = await Subscription.find({
      _id: { $nin: entitlementSubscriptions },
      status: 'active',
      expireAt: { $lte: now }
    });

    const User = require('../models/User');
    const useOwnerGuard = isEnabled(
      'SUBSCRIPTION_SLOT_OWNER_GUARD_ENABLED',
      false
    );
    for (const sub of expiredSubscriptions) {
      const expiringSubscription = useOwnerGuard
        ? await Subscription.findOneAndUpdate(
          { _id: sub._id, status: 'active', expireAt: { $lte: now } },
          { status: 'expired' },
          { new: true }
        )
        : sub;

      if (!expiringSubscription) {
        continue;
      }
      if (!useOwnerGuard) {
        expiringSubscription.status = 'expired';
        await expiringSubscription.save();
      }
      
      // Release slots
      for (const slot of expiringSubscription.slots) {
        const slotFilter = {
          floorID: slot.floorId,
          slotNumber: slot.slotCode,
        };
        if (useOwnerGuard) {
          slotFilter.reservedBySubscriptionId = expiringSubscription._id;
        }
        await Slot.updateOne(slotFilter, {
          $unset: {
            reservedFor: '',
            reservedBySubscriptionId: '',
            reservedByEntitlementId: '',
            reservedUntil: '',
          },
        });
      }

      await User.updateOne(
        {
          _id: expiringSubscription.user,
          'membership.expireAt': { $lte: now },
        },
        {
          $set: {
            'membership.isVip': false,
            'membership.expireAt': null,
            'membership.packageId': null,
          },
        }
      );
      
      if (expiringSubscription.user) {
        notifTriggers.notifySystemMessage(app, expiringSubscription.user, {
          title: 'Hết hạn VIP Pass / VIP Pass Expired',
          body: `Gói đỗ xe tháng của bạn đã hết hạn. Vị trí ô đỗ cố định đã được mở lại cho mọi người. / Your monthly pass has expired. Your fixed parking slot has been released.`,
          type: 'SYSTEM'
        }).catch(err => console.error('Failed to send VIP expired:', err));
      }
      console.log(`[ParkingScheduler] Marked subscription ${expiringSubscription._id} as expired and released slots.`);
    }

  } catch (err) {
    console.error('[ParkingScheduler] Error checking VIP subscriptions:', err.message);
  }
}

/**
 * Start the parking session scheduler
 * @param {Express.Application} app - Express app instance (for io access)
 */
function startScheduler(app) {
  if (schedulerInterval || contractSchedulerInterval) {
    console.log('[ParkingScheduler] Scheduler already running, skipping start.');
    return;
  }

  console.log(`⏰ Parking scheduler started (interval: ${CHECK_INTERVAL_MS / 1000}s)`);

  // Run immediately on start
  checkActiveSessions(app).catch((err) =>
    console.error('[ParkingScheduler] Initial check error:', err.message)
  );
  checkBookings(app).catch((err) =>
    console.error('[ParkingScheduler] Initial checkBookings error:', err.message)
  );
  checkExpiredContracts(app).catch((err) =>
    console.error('[ParkingScheduler] Initial contract expiration error:', err.message)
  );
  checkVIPSubscriptions(app).catch((err) =>
    console.error('[ParkingScheduler] Initial VIP subscription check error:', err.message)
  );
  checkExpiredMembershipTransfers().catch((err) =>
    console.error('[ParkingScheduler] Initial transfer hold check error:', err.message)
  );

  // Then run every interval
  schedulerInterval = setInterval(() => {
    checkActiveSessions(app).catch((err) =>
      console.error('[ParkingScheduler] Interval check error:', err.message)
    );
    checkBookings(app).catch((err) =>
      console.error('[ParkingScheduler] Interval checkBookings error:', err.message)
    );
    checkExpiredMembershipTransfers().catch((err) =>
      console.error('[ParkingScheduler] Transfer hold interval error:', err.message)
    );
  }, CHECK_INTERVAL_MS);

  contractSchedulerInterval = setInterval(() => {
    checkExpiredContracts(app).catch((err) =>
      console.error('[ParkingScheduler] Contract expiration interval error:', err.message)
    );
    checkVIPSubscriptions(app).catch((err) =>
      console.error('[ParkingScheduler] VIP subscription interval error:', err.message)
    );
  }, CONTRACT_EXPIRATION_INTERVAL_MS);
}

/**
 * Stop the parking session scheduler
 */
function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  if (contractSchedulerInterval) {
    clearInterval(contractSchedulerInterval);
    contractSchedulerInterval = null;
  }
  console.log('[ParkingScheduler] Scheduler stopped.');
}

module.exports = {
  startScheduler,
  stopScheduler,
  checkActiveSessions,
  checkBookings,
  checkExpiredContracts,
  checkExpiredMembershipTransfers,
  checkVIPSubscriptions,
  getUpcomingMilestone,
  LOW_BALANCE_THRESHOLD,
};
