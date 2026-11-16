const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const Slot = require('../models/Slot');
const Session = require('../models/Session');
const Booking = require('../models/Booking');
const Subscription = require('../models/Subscription');
const mongoose = require('mongoose');
const { buildPackageExpirationDate } = require('../utils/ticketPackageRules');
const { grantBenefits } = require('./membershipServiceBenefitService');
const bookingRefundService = require('./bookingRefundService');
const { recomputeUserMembership } = require('./membershipProjectionService');

const normalizeSlotCode = (value) => String(value || '').trim().toUpperCase();

const activateSubscriptionEntitlements = async (subscription, options = {}) => {
  const { session = null, rotateQr = true } = options;
  if (!session) {
    const transaction = await mongoose.startSession();
    try {
      return await transaction.withTransaction(() => activateSubscriptionEntitlements(subscription, { ...options, session: transaction }));
    } finally { await transaction.endSession(); }
  }
  const stock = require('./ticketPackageStockService');
  await stock.ensureActivation(subscription, { session, allowPaused: options.renewal === true });
  if (subscription.packageTermsSnapshot) {
    const now = new Date();
    const claimed = await Subscription.findOneAndUpdate(
      { _id: subscription._id, activatedAt: null, paymentStatus: 'paid' },
      { $set: { activatedAt: now, validFrom: now, expireAt: buildPackageExpirationDate(subscription.packageTermsSnapshot, now) } },
      { new: true, session }
    );
    const current = claimed || await Subscription.findById(subscription._id).session(session);
    if (!current?.activatedAt) throw Object.assign(new Error('Payment must succeed before activating membership.'), { statusCode: 409 });
    subscription.set(current.toObject());
  }
  const selectedSlots = subscription.slots || [];
  const unitAmount = Math.round(
    Number(subscription.amount || 0) / Math.max(1, selectedSlots.length)
  );
  const entitlements = [];

  for (const selected of selectedSlots) {
    const slotQuery = Slot.findOne({
      floorID: selected.floorId,
      slotNumber: normalizeSlotCode(selected.slotCode),
    });
    if (session) slotQuery.session(session);
    const slot = await slotQuery;
    if (!slot) {
      throw Object.assign(new Error(`Slot ${selected.slotCode} no longer exists.`), {
        code: 'SLOT_NOT_FOUND',
        statusCode: 404,
      });
    }
    if (slot.reservedFor && String(slot.reservedFor) !== String(subscription.user)) {
      throw Object.assign(new Error(`Slot ${selected.slotCode} is already reserved.`), {
        code: 'SLOT_ALREADY_RESERVED',
        statusCode: 409,
      });
    }
    if (slot.reservedBySubscriptionId && String(slot.reservedBySubscriptionId) !== String(subscription._id)) {
      throw Object.assign(new Error('This space is already reserved under another membership.'), { statusCode: 409 });
    }

    const entitlement = await MembershipSlotEntitlement.findOneAndUpdate(
      { sourceSubscriptionId: subscription._id, slotId: slot._id, transferCount: { $in: [0, null] } },
      {
        $set: {
          ownerId: subscription.user,
          floorId: selected.floorId,
          slotCode: normalizeSlotCode(selected.slotCode),
          packageId: subscription.ticketPackage,
          packageDurationSnapshot: subscription.packageDurationSnapshot || null,
          packageTermsSnapshot: subscription.packageTermsSnapshot || null,
          validFrom: subscription.validFrom || subscription.createdAt || new Date(),
          expireAt: subscription.expireAt,
          status: 'active',
          unitAmount,
        },
        $setOnInsert: { transferCount: 0 },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true, session }
    );
    if (!entitlement.lineageRootId) {
      entitlement.lineageRootId = entitlement._id;
      await entitlement.save({ session });
    }
    await grantBenefits({ entitlement, terms: subscription.packageTermsSnapshot, sourceKey: `purchase:${subscription._id}`, validFrom: subscription.validFrom, expireAt: subscription.activatedAt ? buildPackageExpirationDate(subscription.packageTermsSnapshot, subscription.activatedAt) : subscription.expireAt, session });

    const slotResult = await Slot.updateOne(
      {
        _id: slot._id,
        $and: [
          { $or: [{ reservedFor: null }, { reservedFor: subscription.user }] },
          { $or: [{ reservedBySubscriptionId: null }, { reservedBySubscriptionId: subscription._id }] },
        ],
      },
      {
        $set: {
          reservedFor: subscription.user,
          reservedBySubscriptionId: subscription._id,
          reservedByEntitlementId: entitlement._id,
          reservedUntil: subscription.expireAt,
        },
      },
      { session }
    );
    if (slotResult.matchedCount !== 1) {
      throw Object.assign(new Error(`Slot ${selected.slotCode} ownership changed.`), {
        code: 'SLOT_OWNERSHIP_CHANGED',
        statusCode: 409,
      });
    }
    
    // 1. Check if the user has an active booking session in this exact slot
    const activeSessionQuery = Session.findOne({
      userId: subscription.user,
      parkingSlot: normalizeSlotCode(selected.slotCode),
      floorId: selected.floorId,
      status: 'active',
      type: 'BOOKING',
      bookingId: { $ne: null }
    });
    if (session) activeSessionQuery.session(session);
    const activeSession = await activeSessionQuery;

    if (activeSession) {
      const activeBookingQuery = Booking.findById(activeSession.bookingId);
      if (session) activeBookingQuery.session(session);
      const activeBooking = await activeBookingQuery;

      if (activeBooking && activeBooking.status === 'ACTIVE') {
        const now = new Date();
        const refundCalculation = await bookingRefundService.quoteEarlyCheckout(activeBooking, activeSession, now);
        
        await bookingRefundService.settleBookingEvent({
          bookingId: activeBooking._id,
          eventKey: `booking:${activeBooking._id}:session:${activeSession._id}:vip-upgrade`,
          eventType: 'early_checkout',
          calculation: refundCalculation,
          description: 'Booking refunded due to VIP upgrade',
          walletNetAmount: Math.max(0, refundCalculation.refundAmount || 0),
          session, // Pass the current transaction session!
          applyState: async ({ booking: currentBooking, session: mongoSession }) => {
            currentBooking.status = 'COMPLETED';
            await Session.updateOne(
              { _id: activeSession._id },
              {
                $set: {
                  type: 'SUBSCRIPTION',
                  entitlementId: entitlement._id,
                  subscriptionId: subscription._id,
                }
              },
              { session: mongoSession }
            );
          }
        });

      const notificationService = require('./notificationService');
      const { sendCustomEmail } = require('./notificationEmailService');
      try {
        const notif = await notificationService.createForUser(
          activeSession.userId,
          {
            title: 'Booking Refunded',
            content: 'Your booking has been refunded due to VIP upgrade.',
            type: 'REFUND_SUCCESS',
            priority: 'INFO'
          },
          null,
          { session }
        );
        
        // Ensure email is sent
        sendCustomEmail(activeSession.userId, {
          title: 'Booking Refunded',
          content: 'Your booking has been fully refunded because you purchased a VIP subscription for the same slot. Your money has been returned to your Valo Wallet.',
          priority: 'INFO'
        });
      } catch (e) {
        console.error('Failed to create VIP refund notification', e);
      }
      }
    }

    // 2. Check if the user has upcoming CONFIRMED bookings in this exact slot
    const upcomingBookingsQuery = Booking.find({
      userId: subscription.user,
      parkingSlot: normalizeSlotCode(selected.slotCode),
      floorId: selected.floorId,
      status: 'CONFIRMED'
    });
    if (session) upcomingBookingsQuery.session(session);
    const upcomingBookings = await upcomingBookingsQuery;

    for (const upcomingBooking of upcomingBookings) {
      const breakdown = bookingRefundService.getPaymentBreakdown(upcomingBooking);
      const refundCalculation = {
        refundAmount: breakdown.totalAmount, // full refund
        extraAmount: 0,
        feeAmount: 0,
        refundableServiceAmount: breakdown.serviceAmount
      };
      
      await bookingRefundService.settleBookingEvent({
        bookingId: upcomingBooking._id,
        eventKey: `booking:${upcomingBooking._id}:vip-upgrade-full-refund`,
        eventType: 'cancellation',
        calculation: refundCalculation,
        description: 'Booking refunded due to VIP upgrade',
        walletNetAmount: Math.max(0, refundCalculation.refundAmount || 0),
        session,
        applyState: async ({ booking: currentBooking }) => {
          currentBooking.status = 'CANCELLED';
          currentBooking.cancellationReason = 'VIP_UPGRADE';
          currentBooking.cancelledAt = new Date();
        }
      });
      
      const notificationService = require('./notificationService');
      const { sendCustomEmail } = require('./notificationEmailService');
      try {
        await notificationService.createForUser(
          upcomingBooking.userId,
          {
            title: 'Booking Cancelled & Refunded',
            content: 'Your upcoming booking has been cancelled and fully refunded due to VIP upgrade.',
            type: 'REFUND_SUCCESS',
            priority: 'INFO'
          },
          null,
          { session }
        );
        
        sendCustomEmail(upcomingBooking.userId, {
          title: 'Booking Cancelled & Refunded',
          content: 'Your upcoming booking has been cancelled and fully refunded because you purchased a VIP subscription for the same slot. Your money has been returned to your Valo Wallet.',
          priority: 'INFO'
        });
      } catch (e) {
        console.error('Failed to create VIP refund notification', e);
      }
    }

    entitlements.push(entitlement);
  }

  await Subscription.updateOne({ _id: subscription._id }, { $set: { stockHoldUntil: null } }, { session });
  subscription.stockHoldUntil = null;
  await stock.refreshPackage(subscription.ticketPackage, { session });
  await recomputeUserMembership(subscription.user, { session, rotateQr });
  return entitlements;
};

module.exports = {
  activateSubscriptionEntitlements,
  normalizeSlotCode,
};
