const Booking = require('../models/Booking');
const BookingService = require('../models/BookingService');
const Service = require('../models/Service');
const UserVoucher = require('../models/UserVoucher');

const businessError = (message, statusCode = 400, code) =>
  Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });

const withSession = (query, session) => (session ? query.session(session) : query);

const calculateDiscountedTotal = (amount, discountPercent) => Math.floor(
  Math.max(0, Number(amount) || 0) * (1 - Number(discountPercent) / 100)
);

const getVoucherStateError = (voucher, now = new Date()) => {
  if (voucher.status === 'revoked') return { message: 'Voucher was revoked after a refund', code: 'VOUCHER_REVOKED' };
  if (new Date(now).getTime() >= new Date(voucher.expiresAt).getTime()) {
    return { message: 'Voucher has expired', code: 'VOUCHER_EXPIRED' };
  }
  if (voucher.status !== 'available') {
    return { message: 'Voucher has already been used', code: 'VOUCHER_ALREADY_USED' };
  }
  return null;
};

async function loadValidVoucher({ voucherId, userId, session }) {
  const voucher = await withSession(UserVoucher.findOne({ _id: voucherId, userId }), session);
  if (!voucher) throw businessError('Voucher does not exist', 404, 'VOUCHER_NOT_FOUND');

  const now = new Date();
  const stateError = getVoucherStateError(voucher, now);
  if (stateError?.code === 'VOUCHER_EXPIRED') {
    if (voucher.status === 'available') {
      voucher.status = 'expired';
      await voucher.save(session ? { session } : undefined);
    }
    throw businessError(stateError.message, 400, stateError.code);
  }
  if (stateError) {
    throw businessError(stateError.message, 400, stateError.code);
  }
  return voucher;
}

async function previewVoucher({ voucherId, userId, amount, serviceIds = [], session }) {
  const voucher = await loadValidVoucher({ voucherId, userId, session });
  if (voucher.bookingId) {
    throw businessError('Voucher is already reserved for another booking', 400, 'VOUCHER_RESERVED');
  }

  const benefit = voucher.benefitSnapshot;
  if (!Number.isFinite(Number(amount)) || Number(amount) < 0) throw businessError('Invalid booking amount');
  if (Number(amount) < Number(benefit.minimumAmount || 0)) {
    throw businessError(`Minimum booking amount is ${benefit.minimumAmount} VND`, 400, 'VOUCHER_MINIMUM_AMOUNT');
  }
  if (benefit.type === 'FIXED_DISCOUNT') {
    const voucherDiscount = Math.min(Number(amount), Number(benefit.discountAmount));
    return { voucher, type: benefit.type, discountedAmount: Number(amount) - voucherDiscount, voucherDiscount, freeService: null };
  }
  if (benefit.type === 'PERCENT_DISCOUNT') {
    const discountedAmount = calculateDiscountedTotal(amount, benefit.discountPercent);
    return {
      voucher,
      type: benefit.type,
      discountedAmount,
      voucherDiscount: Math.max(0, Number(amount) - discountedAmount),
      freeService: null,
    };
  }

  const service = await withSession(Service.findOne({ _id: benefit.serviceId, isActive: true }), session);
  if (!service) {
    throw businessError(
      'Service associated with voucher is unavailable',
      400,
      'VOUCHER_SERVICE_UNAVAILABLE'
    );
  }
  const includesFreeService = serviceIds.some(
    (serviceId) => String(serviceId?._id || serviceId) === String(service._id)
  );
  const serviceDiscount = includesFreeService ? Number(service.price) || 0 : 0;
  return {
    voucher,
    type: benefit.type,
    discountedAmount: Math.max(0, (Number(amount) || 0) - serviceDiscount),
    voucherDiscount: Number(service.price) || 0,
    serviceDiscount,
    freeService: service,
  };
}

async function validateAndApplyVoucher({ voucherId, booking, serviceIds = [], session }) {
  if (!booking?.userId) throw businessError('Booking owner is required');
  if (booking.paymentBreakdownSnapshot?.voucherId) {
    throw businessError('A voucher is already applied to this booking', 400, 'BOOKING_VOUCHER_EXISTS');
  }

  const preview = await previewVoucher({
    voucherId,
    userId: booking.userId,
    amount: booking.prepaidAmount,
    serviceIds,
    session,
  });
  if (preview.voucher.source === 'spending' && booking.createdAt && new Date(booking.createdAt) < preview.voucher.redeemedAt) {
    throw businessError('This reward applies to new bookings only', 400, 'VOUCHER_NEW_BOOKING_ONLY');
  }

  const reserved = await UserVoucher.findOneAndUpdate(
    {
      _id: preview.voucher._id,
      userId: booking.userId,
      status: 'available',
      bookingId: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { bookingId: booking._id } },
    { new: true, session }
  );
  if (!reserved) {
    throw businessError('Voucher is already reserved for another booking', 400, 'VOUCHER_RESERVED');
  }

  const currentSnapshot = booking.paymentBreakdownSnapshot?.toObject?.()
    || booking.paymentBreakdownSnapshot
    || {};
  booking.paymentBreakdownSnapshot = {
    ...currentSnapshot,
    voucherId: reserved._id,
    voucherDiscount: preview.voucherDiscount,
    discountedTotal: preview.discountedAmount,
  };
  booking.prepaidAmount = preview.discountedAmount;

  if (preview.freeService) {
    await BookingService.findOneAndUpdate(
      { bookingId: booking._id, serviceId: preview.freeService._id },
      {
        $set: {
          serviceName: preview.freeService.name,
          price: 0,
          timeCost: preview.freeService.timeCost || 30,
          status: 'pending',
        },
        $setOnInsert: { bookingId: booking._id, serviceId: preview.freeService._id },
      },
      { upsert: true, new: true, runValidators: true, session }
    );
  }

  return {
    discountedAmount: preview.discountedAmount,
    voucherDiscount: preview.voucherDiscount,
    voucherSnapshot: reserved.benefitSnapshot,
    freeService: preview.freeService,
  };
}

async function markVoucherUsed({ bookingId, session }) {
  const booking = await withSession(
    Booking.findById(bookingId).select('paymentBreakdownSnapshot.voucherId'),
    session
  );
  const voucherId = booking?.paymentBreakdownSnapshot?.voucherId;
  if (!voucherId) return null;

  return UserVoucher.findOneAndUpdate(
    // Honour a reservation made while valid if the payment callback arrives after expiry.
    // New reservations still require expiresAt > now; cancelled bookings release them.
    { _id: voucherId, bookingId, status: { $in: ['available', 'expired'] } },
    { $set: { status: 'used', usedAt: new Date() } },
    { new: true, session }
  );
}

async function releaseVoucherReservation({ bookingId, session }) {
  return UserVoucher.findOneAndUpdate(
    { bookingId, status: 'available' },
    { $set: { bookingId: null } },
    { new: true, session }
  );
}

module.exports = {
  calculateDiscountedTotal,
  getVoucherStateError,
  loadValidVoucher,
  markVoucherUsed,
  previewVoucher,
  releaseVoucherReservation,
  validateAndApplyVoucher,
};
