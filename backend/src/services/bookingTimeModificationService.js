const Booking = require('../models/Booking');
const pricingEngine = require('./pricingEngine');
const walletService = require('./walletService');
const { findActiveSlotOwnership } = require('./membershipSlotOwnershipService');

const fail = (message, statusCode = 400, code = 'BOOKING_MODIFICATION_INVALID') => {
  throw Object.assign(new Error(message), { statusCode, code });
};

const calculateModifiedBookingPrice = ({ booking, parkingPrice }) => {
  const newParkingAmount = Math.max(0, Number(parkingPrice) || 0);
  const capturedParkingAmount = booking?.paymentBreakdownSnapshot?.parkingAmount;
  const hasCapturedBreakdown = capturedParkingAmount !== null
    && capturedParkingAmount !== undefined
    && Number.isFinite(Number(capturedParkingAmount));

  // Only the parking component changes with the time range. Keep already-paid
  // services and the captured voucher benefit intact instead of repricing the
  // whole booking as if it contained parking only.
  const preservedNonParkingAmount = hasCapturedBreakdown
    ? Number(booking.prepaidAmount || 0) - Number(capturedParkingAmount)
    : 0;

  return {
    newParkingAmount,
    preservedNonParkingAmount,
    newPrice: Math.max(0, newParkingAmount + preservedNonParkingAmount),
  };
};

const quoteBookingTimeModification = async ({
  booking,
  userId,
  newStart,
  newEnd,
  now = new Date(),
  bookingSource,
}) => {
  const isAiQuickRequest = bookingSource === 'AI_QUICK';
  if (!isAiQuickRequest) fail('Not found', 404, 'AI_QUICK_BOOKING_ONLY');
  if (!booking) fail('Booking not found', 404, 'BOOKING_NOT_FOUND');
  if (!['PAID', 'ACTIVE', 'PAUSED'].includes(booking.status)) {
    fail('Booking can only be modified in PAID, ACTIVE, or PAUSED status');
  }
  if (booking.modificationCount >= 3) {
    fail('You have reached the limit of 3 modifications for this booking', 400, 'BOOKING_MODIFICATION_LIMIT');
  }
  if (booking.status === 'PAID'
    && booking.scheduledStart.getTime() - now.getTime() < 30 * 60 * 1000) {
    fail('Booking can only be modified at least 30 minutes before the original start time');
  }

  const start = booking.status === 'PAID' ? new Date(newStart) : booking.scheduledStart;
  const end = new Date(newEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) fail('Invalid booking time');
  if (booking.status === 'PAID' && start <= now) fail('New time must be in the future');

  const durationMs = end.getTime() - start.getTime();
  if (durationMs <= 0 || end <= now) fail('Invalid new end time');
  if (durationMs < 30 * 60 * 1000) fail('Thời gian đặt chỗ phải tối thiểu 30 phút.');

  const subscriptionInfo = await findActiveSlotOwnership({
    floorId: booking.floorId,
    slotCode: booking.parkingSlot,
    at: start,
  });
  if (subscriptionInfo && String(subscriptionInfo.ownerId) !== String(booking.userId)) {
    fail('This slot is registered under a fixed subscription, cannot change to this time.');
  }

  const slotOverlap = await Booking.findOne({
    _id: { $ne: booking._id },
    floorId: booking.floorId,
    parkingSlot: booking.parkingSlot,
    status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] },
    scheduledStart: { $lt: end },
    scheduledEnd: { $gt: start },
  });
  if (slotOverlap) fail(
    'This slot already has another booking during the new time frame',
    409,
    'BOOKING_SLOT_CONFLICT'
  );

  const pricing = await pricingEngine.calculatePrice(start, end);
  if (subscriptionInfo && String(subscriptionInfo.ownerId) === String(booking.userId)) {
    pricing.finalTotal = 0;
  }
  const capturedDynamicMultiplier = Number(booking.paymentBreakdownSnapshot?.dynamicMultiplier || 1);
  const repricedParkingAmount = Math.ceil(
    (pricing.finalTotal * capturedDynamicMultiplier) / 1000
  ) * 1000;
  const {
    newParkingAmount,
    preservedNonParkingAmount,
    newPrice,
  } = calculateModifiedBookingPrice({ booking, parkingPrice: repricedParkingAmount });
  const difference = newPrice - Number(booking.prepaidAmount || 0);
  const wallet = difference > 0 ? await walletService.getOrCreateWallet(userId) : null;

  return {
    start,
    end,
    durationHours: pricing.durationHours,
    newParkingAmount,
    preservedNonParkingAmount,
    newPrice,
    difference,
    extraAmount: Math.max(difference, 0),
    refundAmount: Math.max(-difference, 0),
    walletBalance: Number(wallet?.balance || 0),
    hasEnoughBalance: difference <= 0 || Number(wallet?.balance || 0) >= difference,
  };
};

module.exports = { calculateModifiedBookingPrice, quoteBookingTimeModification };
