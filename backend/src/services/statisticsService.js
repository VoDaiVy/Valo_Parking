const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const BookingService = require('../models/BookingService');
const Subscription = require('../models/Subscription');
const SubscriptionRenewal = require('../models/SubscriptionRenewal');
const MembershipEntitlementRenewal = require('../models/MembershipEntitlementRenewal');
const WalletTransaction = require('../models/WalletTransaction');
const Session = require('../models/Session');
const TicketPackage = require('../models/TicketPackage');
const {
  DAY_MS,
  VIETNAM_OFFSET_MS,
  parseVietnamCalendarDate,
  startOfVietnamDay,
  buildBookingDayOverlapMatch,
} = require('../utils/bookingDateRange');
const {
  getBookingFinancialSummaryMap,
} = require('./bookingFinancialService');
const BOOKING_SOURCES = ['booking', 'booking_order'];
const PAID_BOOKING_STATUSES = ['PAID', 'ACTIVE', 'PAUSED', 'EXPIRED', 'COMPLETED', 'CANCELLED'];

const startOfVietnamMonth = (date) => {
  const localDate = new Date(date.getTime() + VIETNAM_OFFSET_MS);
  return new Date(
    Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), 1) -
      VIETNAM_OFFSET_MS
  );
};

/* ── Vietnam timezone helpers for Revenue Analytics modes ────────────── */

const toVietnamLocal = (date) => new Date(date.getTime() + VIETNAM_OFFSET_MS);
const fromVietnamLocal = (utcDate) => new Date(utcDate.getTime() - VIETNAM_OFFSET_MS);

/**
 * Returns start of a specific Vietnam month (year, month 1-indexed).
 * e.g. startOfSpecificVietnamMonth(2026, 9) => midnight 2026-09-01 ICT in UTC.
 */
const startOfSpecificVietnamMonth = (year, month) =>
  new Date(Date.UTC(year, month - 1, 1) - VIETNAM_OFFSET_MS);

/**
 * Returns end-of-month exclusive boundary for Vietnam timezone.
 * e.g. endOfSpecificVietnamMonth(2026, 9) => midnight 2026-10-01 ICT in UTC.
 */
const endOfSpecificVietnamMonth = (year, month) =>
  new Date(Date.UTC(year, month, 1) - VIETNAM_OFFSET_MS);

/**
 * Resolve mode-based date range for Revenue Analytics.
 * All boundaries are at midnight Asia/Ho_Chi_Minh.
 * Returns { startDate, endDate, granularity, buckets }.
 * endDate is exclusive (start of next period).
 */
const resolveModeDateRange = (filters = {}, now = new Date()) => {
  const mode = filters.mode || '7d';
  const localNow = toVietnamLocal(now);
  const currentYear = localNow.getUTCFullYear();
  const currentMonth = localNow.getUTCMonth() + 1;

  if (mode === '7d') {
    // Today and 6 days before, by day
    const todayStart = startOfVietnamDay(now);
    const startDate = new Date(todayStart.getTime() - 6 * DAY_MS);
    const endDate = new Date(todayStart.getTime() + DAY_MS); // exclusive
    return { startDate, endDate, granularity: 'day', mode };
  }

  if (mode === 'month') {
    const year = filters.year ? Number(filters.year) : currentYear;
    const month = filters.month ? Number(filters.month) : currentMonth;
    const startDate = startOfSpecificVietnamMonth(year, month);
    const endDate = endOfSpecificVietnamMonth(year, month);
    return { startDate, endDate, granularity: 'day', mode };
  }

  if (mode === 'quarter') {
    const year = filters.year ? Number(filters.year) : currentYear;
    const quarter = filters.quarter ? Number(filters.quarter) : Math.ceil(currentMonth / 3);
    const startMonth = (quarter - 1) * 3 + 1;
    const startDate = startOfSpecificVietnamMonth(year, startMonth);
    const endDate = startOfSpecificVietnamMonth(year, startMonth + 3);
    return { startDate, endDate, granularity: 'month', mode };
  }

  if (mode === 'year') {
    const year = filters.year ? Number(filters.year) : currentYear;
    const startDate = startOfSpecificVietnamMonth(year, 1);
    const endDate = startOfSpecificVietnamMonth(year + 1, 1);
    return { startDate, endDate, granularity: 'month', mode };
  }

  throw Object.assign(new Error('Unsupported mode'), { statusCode: 400 });
};

/**
 * Generate zero-filled bucket labels for the given range.
 */
const generateBucketLabels = (startDate, endDate, granularity) => {
  const labels = [];
  if (granularity === 'day') {
    let cursor = new Date(startDate.getTime());
    while (cursor < endDate) {
      const local = toVietnamLocal(cursor);
      const y = local.getUTCFullYear();
      const m = String(local.getUTCMonth() + 1).padStart(2, '0');
      const d = String(local.getUTCDate()).padStart(2, '0');
      labels.push(`${y}-${m}-${d}`);
      cursor = new Date(cursor.getTime() + DAY_MS);
    }
  } else {
    // month granularity
    let cursor = new Date(startDate.getTime());
    while (cursor < endDate) {
      const local = toVietnamLocal(cursor);
      const y = local.getUTCFullYear();
      const m = String(local.getUTCMonth() + 1).padStart(2, '0');
      labels.push(`${y}-${m}`);
      // advance to next month
      cursor = fromVietnamLocal(
        new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1))
      );
    }
  }
  return labels;
};

/* ── Legacy resolveDateRange (kept for backward compatibility) ────────── */

const resolveDateRange = (filters = {}, now = new Date()) => {
  const range = filters.range || '30d';
  let startDate = null;
  let endDate = new Date(now);

  if (filters.startDate || filters.endDate) {
    startDate = filters.startDate ? new Date(filters.startDate) : null;
    endDate = filters.endDate ? new Date(filters.endDate) : endDate;
  } else if (range === 'daily') {
    startDate = filters.date
      ? parseVietnamCalendarDate(filters.date)
      : startOfVietnamDay(now);
    endDate = new Date(startDate.getTime() + DAY_MS - 1);
  } else if (range === 'today') {
    startDate = startOfVietnamDay(now);
  } else if (range === '7d') {
    startDate = new Date(now.getTime() - 7 * DAY_MS);
  } else if (range === '30d') {
    startDate = new Date(now.getTime() - 30 * DAY_MS);
  } else if (range === 'month') {
    startDate = startOfVietnamMonth(now);
  } else if (range !== 'all') {
    throw Object.assign(new Error('Unsupported statistics range'), { statusCode: 400 });
  }

  if (startDate && Number.isNaN(startDate.getTime())) {
    throw Object.assign(new Error('Invalid startDate'), { statusCode: 400 });
  }
  if (Number.isNaN(endDate.getTime())) {
    throw Object.assign(new Error('Invalid endDate'), { statusCode: 400 });
  }
  if (startDate && startDate > endDate) {
    throw Object.assign(new Error('startDate must be before endDate'), { statusCode: 400 });
  }
  if (startDate && endDate.getTime() - startDate.getTime() > 366 * DAY_MS) {
    throw Object.assign(new Error('Custom statistics range cannot exceed 366 days'), { statusCode: 400 });
  }

  return { startDate, endDate };
};

const buildCreatedAtMatch = ({ startDate, endDate }) => {
  const createdAt = { $lte: endDate };
  if (startDate) createdAt.$gte = startDate;
  return { createdAt };
};

const buildBookingScheduleMatch = ({ startDate, endDate }, range) => {
  if (!startDate) return {};

  if (range === 'today' || range === 'daily') {
    return buildBookingDayOverlapMatch({
      startDate,
      endDate: new Date(startDate.getTime() + DAY_MS - 1),
    });
  }

  const scheduledStart = { $gte: startDate };
  scheduledStart.$lt = endDate;

  return { scheduledStart };
};

const getTimelineBucket = (filters, period) => {
  const periodLength = period.startDate
    ? period.endDate.getTime() - period.startDate.getTime()
    : null;
  const useMonthlyBuckets =
    filters.range === 'all' || (periodLength !== null && periodLength > 90 * DAY_MS);
  return {
    granularity: useMonthlyBuckets ? 'month' : 'day',
    format: useMonthlyBuckets ? '%Y-%m' : '%Y-%m-%d',
  };
};

const timelineDateExpression = (format, dateField = '$createdAt') => ({
  $dateToString: {
    date: dateField,
    format,
    timezone: 'Asia/Ho_Chi_Minh',
  },
});

const zeroBookingSummary = () => ({
  totalBookings: 0,
  completedBookings: 0,
  activeBookings: 0,
  cancelledBookings: 0,
  expiredBookings: 0,
  completionRate: 0,
  scheduledHours: 0,
  bookingValue: 0,
});

const normalizeBookingSummary = (row) => {
  if (!row) return zeroBookingSummary();
  const terminal = Number(row.completedBookings || 0) +
    Number(row.cancelledBookings || 0) +
    Number(row.expiredBookings || 0);
  return {
    totalBookings: Number(row.totalBookings || 0),
    completedBookings: Number(row.completedBookings || 0),
    activeBookings: Number(row.activeBookings || 0),
    cancelledBookings: Number(row.cancelledBookings || 0),
    expiredBookings: Number(row.expiredBookings || 0),
    completionRate: terminal
      ? Math.round((Number(row.completedBookings || 0) / terminal) * 1000) / 10
      : 0,
    scheduledHours: Math.round(Number(row.scheduledHours || 0) * 10) / 10,
    bookingValue: Number(row.bookingValue || 0),
  };
};

const bookingSummaryPipeline = (match) => [
  { $match: match },
  {
    $group: {
      _id: null,
      totalBookings: { $sum: 1 },
      completedBookings: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
      activeBookings: {
        $sum: { $cond: [{ $in: ['$status', ['PAID', 'ACTIVE', 'PAUSED']] }, 1, 0] },
      },
      cancelledBookings: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
      expiredBookings: { $sum: { $cond: [{ $eq: ['$status', 'EXPIRED'] }, 1, 0] } },
      scheduledHours: { $sum: { $ifNull: ['$durationHours', 0] } },
      bookingValue: {
        $sum: {
          $cond: [
            { $in: ['$status', PAID_BOOKING_STATUSES] },
            { $ifNull: ['$prepaidAmount', 0] },
            0,
          ],
        },
      },
    },
  },
];

const walletBookingSummary = async (match) => {
  const rows = await WalletTransaction.aggregate([
    {
      $match: {
        ...match,
        status: 'COMPLETED',
        refSource: { $in: BOOKING_SOURCES },
        type: { $in: ['PAYMENT', 'REFUND'] },
      },
    },
    {
      $group: {
        _id: '$type',
        amount: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]);

  const byType = Object.fromEntries(rows.map((row) => [row._id, row]));
  const charges = Number(byType.PAYMENT?.amount || 0);
  const refunds = Number(byType.REFUND?.amount || 0);
  return {
    walletBookingCharges: charges,
    walletBookingRefunds: refunds,
    walletNetBookingSpend: charges - refunds,
    walletChargeCount: Number(byType.PAYMENT?.count || 0),
    walletRefundCount: Number(byType.REFUND?.count || 0),
  };
};

const normalizeCompletedBookingStatistics = (row) => ({
  count: Number(row?.count || 0),
  prepaidRevenue: Number(row?.prepaidRevenue || 0),
  additionalRevenue: Number(row?.additionalRevenue || 0),
  grossRevenue: Number(row?.grossRevenue || 0),
  refundPaid: Number(row?.refundPaid || 0),
  actualRevenue: Number(row?.actualRevenue || 0),
});

const buildLifecycleDateMatch = (field, fallbackField, period) => {
  if (!period.startDate) return {};
  const dateRange = { $gte: period.startDate, $lte: period.endDate };
  return {
    $or: [
      { [field]: dateRange },
      {
        [field]: null,
        [fallbackField]: dateRange,
      },
    ],
  };
};

/**
 * Build lifecycle date match for mode-based queries where endDate is exclusive.
 */
const buildLifecycleDateMatchExclusive = (field, fallbackField, startDate, endDate) => {
  const dateRange = { $gte: startDate, $lt: endDate };
  return {
    $or: [
      { [field]: dateRange },
      {
        [field]: null,
        [fallbackField]: dateRange,
      },
    ],
  };
};

const calculatePlatformBookingRevenue = (
  bookings,
  financialSummaries,
  completedServiceAmountByBooking = new Map()
) => bookings.reduce(
  (summary, booking) => {
    const bookingId = String(booking._id);
    const financial = financialSummaries.get(bookingId) || {
      prepaidCollected: 0,
      grossRevenue: 0,
      refundPaid: 0,
      actualRevenue: 0,
    };
    const grossRevenue = Math.max(
      0,
      Number(financial.grossRevenue) ||
        (Number(financial.actualRevenue) || 0) + (Number(financial.refundPaid) || 0)
    );
    const refundPaid = Math.min(
      grossRevenue,
      Math.max(0, Number(financial.refundPaid) || 0)
    );
    const snapshot = booking.paymentBreakdownSnapshot;
    const paidServiceAmount = Math.min(
      Math.max(0, Number(financial.prepaidCollected) || 0),
      Math.max(
        0,
        snapshot?.source
          ? Number(snapshot.serviceAmount) || 0
          : Number(completedServiceAmountByBooking.get(bookingId)) || 0
      )
    );
    const completedServiceAmount = Math.max(
      0,
      Number(completedServiceAmountByBooking.get(bookingId)) || 0
    );
    const grossServiceAmount = Math.min(
      paidServiceAmount,
      completedServiceAmount
    );
    const recordedServiceRefund = (booking.refundSettlements || []).reduce(
      (total, settlement) => settlement?.payoutStatus === 'credited'
        ? total + Math.max(0, Number(settlement.refundableServiceAmount) || 0)
        : total,
      0
    );
    const paidServiceRefund = Math.min(
      paidServiceAmount,
      refundPaid,
      recordedServiceRefund
    );
    const serviceRevenue = Math.max(
      0,
      grossServiceAmount - Math.min(grossServiceAmount, paidServiceRefund)
    );
    const grossBookingAmount = Math.max(0, grossRevenue - paidServiceAmount);
    const bookingRefund = Math.min(
      grossBookingAmount,
      Math.max(0, refundPaid - paidServiceRefund)
    );
    const bookingRevenue = Math.max(0, grossBookingAmount - bookingRefund);

    summary.bookingRevenue += bookingRevenue;
    summary.serviceRevenue += serviceRevenue;
    summary.refundTotal += refundPaid;
    summary.completedBookingCount += 1;
    if (grossServiceAmount > 0) summary.serviceBookingCount += 1;
    return summary;
  },
  {
    bookingRevenue: 0,
    serviceRevenue: 0,
    refundTotal: 0,
    completedBookingCount: 0,
    serviceBookingCount: 0,
  }
);

const aggregatePaidAmount = async (Model, match) => {
  const rows = await Model.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        amount: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]);
  return {
    amount: Number(rows[0]?.amount || 0),
    count: Number(rows[0]?.count || 0),
  };
};

const calculatePlatformRevenueTotal = ({
  vipRevenue = 0,
  bookingRevenue = 0,
  serviceRevenue = 0,
  membershipTransferFeeRevenue = 0,
}) =>
  Number(vipRevenue || 0) +
  Number(bookingRevenue || 0) +
  Number(serviceRevenue || 0) +
  Number(membershipTransferFeeRevenue || 0);

/* ── Enhanced platform revenue (mode-based, single source of truth) ──── */

const getAdminPlatformRevenueStatistics = async (filters = {}) => {
  // If no mode is provided, fall back to legacy behavior for backward compatibility
  if (!filters.mode) {
    return getAdminPlatformRevenueStatisticsLegacy(filters);
  }

  const now = new Date();
  const { startDate, endDate, granularity, mode } = resolveModeDateRange(filters, now);
  const bucketFormat = granularity === 'month' ? '%Y-%m' : '%Y-%m-%d';
  const bucketLabels = generateBucketLabels(startDate, endDate, granularity);

  // Build date matches for exclusive endDate
  const bookingDateMatch = buildLifecycleDateMatchExclusive(
    'completedAt', 'updatedAt', startDate, endDate
  );
  const renewalDateMatch = {
    $or: [
      { paidAt: { $gte: startDate, $lt: endDate } },
      { paidAt: null, createdAt: { $gte: startDate, $lt: endDate } },
    ],
  };
  const createdAtMatchExclusive = { createdAt: { $gte: startDate, $lt: endDate } };

  // Status Distribution: use scheduledStart for operational analytics
  const scheduledStartMatch = { scheduledStart: { $gte: startDate, $lt: endDate } };

  const [
    completedBookings,
    subscriptionPurchases,
    subscriptionRenewals,
    entitlementRenewals,
    membershipTransferFees,
    // Timeline aggregates
    bookingTimelineRows,
    serviceTimelineRows,
    subscriptionPurchaseTimelineRows,
    subscriptionRenewalTimelineRows,
    entitlementRenewalTimelineRows,
    transferFeeTimelineRows,
    // Traffic
    entryRows,
    exitRows,
    currentlyParked,
    // Status Distribution (by scheduledStart for operational analytics)
    statusDistributionRows,
    // Package breakdown
    packagePurchaseRows,
    packageSubRenewalRows,
    packageEntRenewalRows,
    // Available years
    earliestBookingYear,
    earliestSubscriptionYear,
  ] = await Promise.all([
    // Revenue: completed bookings in period
    Booking.find({ status: 'COMPLETED', ...bookingDateMatch })
      .select(
        'prepaidAmount paymentBreakdownSnapshot paidOverageAdjustments refundSettlements completedAt updatedAt'
      )
      .lean(),
    // Revenue: subscription purchases in period
    aggregatePaidAmount(Subscription, {
      paymentStatus: 'paid',
      ...createdAtMatchExclusive,
    }),
    // Revenue: subscription renewals in period
    aggregatePaidAmount(SubscriptionRenewal, {
      status: 'paid',
      ...renewalDateMatch,
    }),
    // Revenue: entitlement renewals in period
    aggregatePaidAmount(MembershipEntitlementRenewal, {
      status: 'paid',
      ...renewalDateMatch,
    }),
    // Revenue: membership transfer fees in period
    aggregatePaidAmount(WalletTransaction, {
      type: 'TRANSFER_FEE',
      status: 'COMPLETED',
      ...createdAtMatchExclusive,
    }),

    // Timeline: booking revenue per bucket (completedAt/updatedAt based)
    Booking.aggregate([
      { $match: { status: 'COMPLETED', ...bookingDateMatch } },
      {
        $group: {
          _id: timelineDateExpression(
            bucketFormat,
            { $ifNull: ['$completedAt', '$updatedAt'] }
          ),
          bookingIds: { $push: '$_id' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // Timeline: completed service amounts by bucket
    BookingService.aggregate([
      {
        $match: {
          status: 'done',
        },
      },
      {
        $lookup: {
          from: 'bookings',
          localField: 'bookingId',
          foreignField: '_id',
          as: 'booking',
          pipeline: [
            { $match: { status: 'COMPLETED', ...bookingDateMatch } },
            { $project: { completedAt: 1, updatedAt: 1 } },
          ],
        },
      },
      { $unwind: '$booking' },
      {
        $group: {
          _id: {
            bookingId: '$bookingId',
            period: timelineDateExpression(
              bucketFormat,
              { $ifNull: ['$booking.completedAt', '$booking.updatedAt'] }
            ),
          },
          amount: { $sum: '$price' },
        },
      },
    ]),
    // Timeline: subscription purchases per bucket
    Subscription.aggregate([
      { $match: { paymentStatus: 'paid', ...createdAtMatchExclusive } },
      {
        $group: {
          _id: timelineDateExpression(bucketFormat),
          amount: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // Timeline: subscription renewals per bucket
    SubscriptionRenewal.aggregate([
      { $match: { status: 'paid', ...renewalDateMatch } },
      {
        $group: {
          _id: timelineDateExpression(
            bucketFormat,
            { $ifNull: ['$paidAt', '$createdAt'] }
          ),
          amount: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // Timeline: entitlement renewals per bucket
    MembershipEntitlementRenewal.aggregate([
      { $match: { status: 'paid', ...renewalDateMatch } },
      {
        $group: {
          _id: timelineDateExpression(
            bucketFormat,
            { $ifNull: ['$paidAt', '$createdAt'] }
          ),
          amount: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // Timeline: transfer fees per bucket
    WalletTransaction.aggregate([
      { $match: { type: 'TRANSFER_FEE', status: 'COMPLETED', ...createdAtMatchExclusive } },
      {
        $group: {
          _id: timelineDateExpression(bucketFormat),
          amount: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    // Traffic: entries by checkInTime
    Session.aggregate([
      { $match: { checkInTime: { $gte: startDate, $lt: endDate } } },
      {
        $group: {
          _id: timelineDateExpression(bucketFormat, '$checkInTime'),
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // Traffic: exits by checkOutTime
    Session.aggregate([
      { $match: { checkOutTime: { $gte: startDate, $lt: endDate } } },
      {
        $group: {
          _id: timelineDateExpression(bucketFormat, '$checkOutTime'),
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // Traffic: currently parked (snapshot, no period filter)
    Session.countDocuments({ status: 'active' }),

    // Status Distribution: bookings by scheduledStart in period
    Booking.aggregate([
      { $match: scheduledStartMatch },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),

    // Package breakdown: subscription purchases by package
    Subscription.aggregate([
      { $match: { paymentStatus: 'paid', ...createdAtMatchExclusive } },
      {
        $group: {
          _id: '$ticketPackage',
          purchaseAmount: { $sum: '$amount' },
          purchaseCount: { $sum: 1 },
        },
      },
    ]),
    // Package breakdown: subscription renewals by package (via subscription lookup)
    SubscriptionRenewal.aggregate([
      { $match: { status: 'paid', ...renewalDateMatch } },
      {
        $lookup: {
          from: 'subscriptions',
          localField: 'subscriptionId',
          foreignField: '_id',
          as: 'subscription',
          pipeline: [{ $project: { ticketPackage: 1 } }],
        },
      },
      { $unwind: { path: '$subscription', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$subscription.ticketPackage',
          renewalAmount: { $sum: '$amount' },
          renewalCount: { $sum: 1 },
        },
      },
    ]),
    // Package breakdown: entitlement renewals by package (via subscription → package)
    MembershipEntitlementRenewal.aggregate([
      { $match: { status: 'paid', ...renewalDateMatch } },
      {
        $lookup: {
          from: 'subscriptions',
          localField: 'sourceSubscriptionId',
          foreignField: '_id',
          as: 'subscription',
          pipeline: [{ $project: { ticketPackage: 1 } }],
        },
      },
      { $unwind: { path: '$subscription', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$subscription.ticketPackage',
          renewalAmount: { $sum: '$amount' },
          renewalCount: { $sum: 1 },
        },
      },
    ]),

    // Available years: earliest booking
    Booking.aggregate([
      { $match: { status: 'COMPLETED' } },
      { $group: { _id: null, earliest: { $min: { $ifNull: ['$completedAt', '$updatedAt'] } } } },
    ]),
    // Available years: earliest subscription
    Subscription.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: null, earliest: { $min: '$createdAt' } } },
    ]),
  ]);

  // ── Process booking revenues ──────────────────────────────────────────
  const bookingIds = completedBookings.map((b) => b._id);
  const [financialSummaries, completedServiceRows] = await Promise.all([
    getBookingFinancialSummaryMap(completedBookings),
    bookingIds.length
      ? BookingService.aggregate([
        { $match: { bookingId: { $in: bookingIds }, status: 'done' } },
        { $group: { _id: '$bookingId', amount: { $sum: '$price' } } },
      ])
      : [],
  ]);
  const completedServiceAmountByBooking = new Map(
    completedServiceRows.map((row) => [String(row._id), Number(row.amount) || 0])
  );
  const bookingRevenueResult = calculatePlatformBookingRevenue(
    completedBookings,
    financialSummaries,
    completedServiceAmountByBooking
  );

  const bookingRevenue = bookingRevenueResult.bookingRevenue;
  const serviceRevenue = bookingRevenueResult.serviceRevenue;
  const refundTotal = bookingRevenueResult.refundTotal;
  const packageRevenue =
    subscriptionPurchases.amount +
    subscriptionRenewals.amount +
    entitlementRenewals.amount;
  const membershipTransferFeeRevenue = membershipTransferFees.amount;
  const totalRevenue = bookingRevenue + serviceRevenue + packageRevenue + membershipTransferFeeRevenue;
  const sourceCompositionTotal = totalRevenue;

  // ── Build timeline with per-bucket booking/service separation ─────────
  // We need per-bucket booking revenue. Since calculatePlatformBookingRevenue
  // does complex per-booking calculation, we approximate by proportional split
  // for timeline. But for accuracy, we compute per-bucket.
  const bookingsByBucket = new Map();
  for (const row of bookingTimelineRows) {
    bookingsByBucket.set(row._id, row.bookingIds || []);
  }

  // Build per-bucket service amounts
  const serviceByBucketAndBooking = new Map();
  for (const row of serviceTimelineRows) {
    const period = row._id.period;
    const bookingId = String(row._id.bookingId);
    if (!serviceByBucketAndBooking.has(period)) {
      serviceByBucketAndBooking.set(period, new Map());
    }
    serviceByBucketAndBooking.get(period).set(bookingId, Number(row.amount) || 0);
  }

  // Build per-bucket package revenue
  const packageByBucket = new Map();
  for (const row of subscriptionPurchaseTimelineRows) {
    packageByBucket.set(row._id, (packageByBucket.get(row._id) || 0) + Number(row.amount || 0));
  }
  for (const row of subscriptionRenewalTimelineRows) {
    packageByBucket.set(row._id, (packageByBucket.get(row._id) || 0) + Number(row.amount || 0));
  }
  for (const row of entitlementRenewalTimelineRows) {
    packageByBucket.set(row._id, (packageByBucket.get(row._id) || 0) + Number(row.amount || 0));
  }

  // Build per-bucket transfer fees
  const transferFeeByBucket = new Map();
  for (const row of transferFeeTimelineRows) {
    transferFeeByBucket.set(row._id, Number(row.amount || 0));
  }

  // Compute per-bucket booking and service revenues
  const bookingRevenueByBucket = new Map();
  const serviceRevenueByBucket = new Map();
  const refundByBucket = new Map();

  // Create a map from bookingId -> booking document for quick lookup
  const bookingDocMap = new Map(
    completedBookings.map((b) => [String(b._id), b])
  );

  for (const [period, bIds] of bookingsByBucket) {
    const bucketBookings = bIds
      .map((id) => bookingDocMap.get(String(id)))
      .filter(Boolean);
    const bucketServiceMap = serviceByBucketAndBooking.get(period) || new Map();
    const bucketResult = calculatePlatformBookingRevenue(
      bucketBookings,
      financialSummaries,
      bucketServiceMap
    );
    bookingRevenueByBucket.set(period, bucketResult.bookingRevenue);
    serviceRevenueByBucket.set(period, bucketResult.serviceRevenue);
    refundByBucket.set(period, bucketResult.refundTotal);
  }

  // Build final zero-filled trend
  const trend = bucketLabels.map((label) => ({
    period: label,
    totalRevenue:
      (bookingRevenueByBucket.get(label) || 0) +
      (serviceRevenueByBucket.get(label) || 0) +
      (packageByBucket.get(label) || 0) +
      (transferFeeByBucket.get(label) || 0),
    bookingRevenue: bookingRevenueByBucket.get(label) || 0,
    serviceRevenue: serviceRevenueByBucket.get(label) || 0,
    packageRevenue: packageByBucket.get(label) || 0,
    membershipTransferFees: transferFeeByBucket.get(label) || 0,
    refunds: refundByBucket.get(label) || 0,
  }));

  // ── Traffic ────────────────────────────────────────────────────────────
  const entryByBucket = new Map(entryRows.map((r) => [r._id, r.count]));
  const exitByBucket = new Map(exitRows.map((r) => [r._id, r.count]));

  const traffic = bucketLabels.map((label) => ({
    period: label,
    entries: entryByBucket.get(label) || 0,
    exits: exitByBucket.get(label) || 0,
  }));

  const totalEntries = traffic.reduce((s, p) => s + p.entries, 0);
  const totalExits = traffic.reduce((s, p) => s + p.exits, 0);

  // ── Status Distribution ───────────────────────────────────────────────
  const statusMap = new Map(
    statusDistributionRows.map((r) => [r._id, r.count])
  );
  const totalBookings =
    (statusMap.get('COMPLETED') || 0) +
    (statusMap.get('CANCELLED') || 0) +
    (statusMap.get('PAID') || 0) +
    (statusMap.get('ACTIVE') || 0) +
    (statusMap.get('PAUSED') || 0) +
    (statusMap.get('EXPIRED') || 0) +
    (statusMap.get('PENDING') || 0);
  const statusDistribution = {
    completed: statusMap.get('COMPLETED') || 0,
    cancelled: statusMap.get('CANCELLED') || 0,
    totalBookings,
    byStatus: statusDistributionRows.map((r) => ({
      status: r._id,
      count: r.count,
    })),
  };

  // ── Package breakdown ─────────────────────────────────────────────────
  // Merge purchases + sub renewals + entitlement renewals by packageId
  const packageMap = new Map();
  const ensurePackage = (pkgId) => {
    const key = pkgId ? String(pkgId) : '__unknown__';
    if (!packageMap.has(key)) {
      packageMap.set(key, {
        packageId: pkgId ? String(pkgId) : null,
        purchaseAmount: 0,
        purchaseCount: 0,
        renewalAmount: 0,
        renewalCount: 0,
      });
    }
    return packageMap.get(key);
  };
  for (const row of packagePurchaseRows) {
    const pkg = ensurePackage(row._id);
    pkg.purchaseAmount += Number(row.purchaseAmount || 0);
    pkg.purchaseCount += Number(row.purchaseCount || 0);
  }
  for (const row of packageSubRenewalRows) {
    const pkg = ensurePackage(row._id);
    pkg.renewalAmount += Number(row.renewalAmount || 0);
    pkg.renewalCount += Number(row.renewalCount || 0);
  }
  for (const row of packageEntRenewalRows) {
    const pkg = ensurePackage(row._id);
    pkg.renewalAmount += Number(row.renewalAmount || 0);
    pkg.renewalCount += Number(row.renewalCount || 0);
  }

  // Lookup package names (including archived)
  const packageIds = [...packageMap.values()]
    .map((p) => p.packageId)
    .filter(Boolean)
    .map((id) => {
      try { return new mongoose.Types.ObjectId(id); } catch { return null; }
    })
    .filter(Boolean);
  const packageDocs = packageIds.length
    ? await TicketPackage.find({ _id: { $in: packageIds } })
      .select('name type isActive')
      .lean()
    : [];
  const packageNameMap = new Map(
    packageDocs.map((p) => [String(p._id), p])
  );

  const packageBreakdown = [...packageMap.values()]
    .map((pkg) => {
      const doc = pkg.packageId ? packageNameMap.get(pkg.packageId) : null;
      return {
        packageId: pkg.packageId,
        packageName: doc?.name || 'Archived package',
        packageType: doc?.type || null,
        isActive: doc?.isActive ?? false,
        totalAmount: pkg.purchaseAmount + pkg.renewalAmount,
        purchaseAmount: pkg.purchaseAmount,
        purchaseCount: pkg.purchaseCount,
        renewalAmount: pkg.renewalAmount,
        renewalCount: pkg.renewalCount,
      };
    })
    .sort((a, b) => b.totalAmount - a.totalAmount);

  // ── Available years ───────────────────────────────────────────────────
  const earliestDates = [
    earliestBookingYear[0]?.earliest,
    earliestSubscriptionYear[0]?.earliest,
  ].filter(Boolean);
  const currentYearVN = toVietnamLocal(now).getUTCFullYear();
  let minYear = currentYearVN;
  for (const d of earliestDates) {
    const y = toVietnamLocal(new Date(d)).getUTCFullYear();
    if (y < minYear) minYear = y;
  }
  const availableYears = [];
  for (let y = minYear; y <= currentYearVN; y++) {
    availableYears.push(y);
  }

  return {
    period: { startDate, endDate, mode, granularity },
    currency: 'VND',
    basis: 'realized_completed_revenue',
    summary: {
      totalRevenue,
      bookingRevenue,
      serviceRevenue,
      packageRevenue,
      membershipTransferFees: membershipTransferFeeRevenue,
      refunds: refundTotal,
      sourceCompositionTotal,
    },
    trend,
    traffic,
    trafficSummary: {
      totalEntries,
      totalExits,
      currentlyParked,
    },
    statusDistribution,
    packageBreakdown,
    availableYears,
    // Legacy fields for backward compatibility
    vip: {
      revenue: packageRevenue,
      transactionCount:
        subscriptionPurchases.count +
        subscriptionRenewals.count +
        entitlementRenewals.count,
      purchaseRevenue: subscriptionPurchases.amount,
      renewalRevenue: subscriptionRenewals.amount + entitlementRenewals.amount,
    },
    booking: {
      revenue: bookingRevenue,
      completedCount: bookingRevenueResult.completedBookingCount,
    },
    service: {
      revenue: serviceRevenue,
      completedBookingCount: bookingRevenueResult.serviceBookingCount,
    },
    membershipTransferFeesDetail: {
      revenue: membershipTransferFeeRevenue,
      transactionCount: membershipTransferFees.count,
    },
    totalRevenue,
  };
};

/* ── Legacy platform revenue (backward compat for Staff Dashboard) ──── */

const getAdminPlatformRevenueStatisticsLegacy = async (filters = {}) => {
  const period = resolveDateRange({ range: 'all', ...filters });
  const bookingDateMatch = buildLifecycleDateMatch(
    'completedAt',
    'updatedAt',
    period
  );
  const renewalDateMatch = buildLifecycleDateMatch('paidAt', 'createdAt', period);
  const subscriptionDateMatch = period.startDate
    ? buildCreatedAtMatch(period)
    : {};

  const [
    completedBookings,
    subscriptionPurchases,
    subscriptionRenewals,
    entitlementRenewals,
    membershipTransferFees,
  ] = await Promise.all([
    Booking.find({ status: 'COMPLETED', ...bookingDateMatch })
      .select(
        'prepaidAmount paymentBreakdownSnapshot paidOverageAdjustments refundSettlements completedAt updatedAt'
      )
      .lean(),
    aggregatePaidAmount(Subscription, {
      paymentStatus: 'paid',
      ...subscriptionDateMatch,
    }),
    aggregatePaidAmount(SubscriptionRenewal, {
      status: 'paid',
      ...renewalDateMatch,
    }),
    aggregatePaidAmount(MembershipEntitlementRenewal, {
      status: 'paid',
      ...renewalDateMatch,
    }),
    aggregatePaidAmount(WalletTransaction, {
      type: 'TRANSFER_FEE',
      status: 'COMPLETED',
      ...buildCreatedAtMatch(period),
    }),
  ]);

  const bookingIds = completedBookings.map((booking) => booking._id);
  const [financialSummaries, completedServiceRows] = await Promise.all([
    getBookingFinancialSummaryMap(completedBookings),
    bookingIds.length
      ? BookingService.aggregate([
        {
          $match: {
            bookingId: { $in: bookingIds },
            status: 'done',
          },
        },
        {
          $group: {
            _id: '$bookingId',
            amount: { $sum: '$price' },
          },
        },
      ])
      : [],
  ]);
  const completedServiceAmountByBooking = new Map(
    completedServiceRows.map((row) => [String(row._id), Number(row.amount) || 0])
  );
  const bookingRevenueResult = calculatePlatformBookingRevenue(
    completedBookings,
    financialSummaries,
    completedServiceAmountByBooking
  );
  const vipRevenue =
    subscriptionPurchases.amount +
    subscriptionRenewals.amount +
    entitlementRenewals.amount;
  const vipTransactionCount =
    subscriptionPurchases.count +
    subscriptionRenewals.count +
    entitlementRenewals.count;
  const totalRevenue = calculatePlatformRevenueTotal({
    vipRevenue,
    bookingRevenue: bookingRevenueResult.bookingRevenue,
    serviceRevenue: bookingRevenueResult.serviceRevenue,
    membershipTransferFeeRevenue: membershipTransferFees.amount,
  });

  return {
    period,
    currency: 'VND',
    basis: 'realized_completed_revenue',
    vip: {
      revenue: vipRevenue,
      transactionCount: vipTransactionCount,
      purchaseRevenue: subscriptionPurchases.amount,
      renewalRevenue:
        subscriptionRenewals.amount + entitlementRenewals.amount,
    },
    booking: {
      revenue: bookingRevenueResult.bookingRevenue,
      completedCount: bookingRevenueResult.completedBookingCount,
    },
    service: {
      revenue: bookingRevenueResult.serviceRevenue,
      completedBookingCount: bookingRevenueResult.serviceBookingCount,
    },
    membershipTransferFees: {
      revenue: membershipTransferFees.amount,
      transactionCount: membershipTransferFees.count,
    },
    totalRevenue,
  };
};

const getCompletedBookingStatistics = async (bookingMatch) => {
  const bookings = await Booking.find({
    status: 'COMPLETED',
    ...bookingMatch,
  })
    .select('prepaidAmount paidOverageAdjustments refundSettlements')
    .lean();
  const financialSummaries = await getBookingFinancialSummaryMap(bookings);

  return normalizeCompletedBookingStatistics(
    bookings.reduce(
      (summary, booking) => {
        const financial = financialSummaries.get(String(booking._id));
        summary.count += 1;
        summary.prepaidRevenue += financial.prepaidCollected;
        summary.additionalRevenue += financial.additionalCollected;
        summary.grossRevenue += financial.grossRevenue;
        summary.refundPaid += financial.refundPaid;
        summary.actualRevenue += financial.actualRevenue;
        return summary;
      },
      {
        count: 0,
        prepaidRevenue: 0,
        additionalRevenue: 0,
        grossRevenue: 0,
        refundPaid: 0,
        actualRevenue: 0,
      }
    )
  );
};

const getCustomerBookingStatistics = async (userId, filters = {}) => {
  const period = resolveDateRange(filters);
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const createdAtMatch = buildCreatedAtMatch(period);
  const bookingMatch = { userId: userObjectId, ...createdAtMatch };
  const walletMatch = { userId: userObjectId, ...createdAtMatch };

  const [bookingRows, wallet, externalRows] = await Promise.all([
    Booking.aggregate(bookingSummaryPipeline(bookingMatch)),
    walletBookingSummary(walletMatch),
    Booking.aggregate([
      {
        $match: {
          ...bookingMatch,
          paymentMethod: 'vietqr',
          status: { $in: PAID_BOOKING_STATUSES },
        },
      },
      { $group: { _id: null, amount: { $sum: '$prepaidAmount' }, count: { $sum: 1 } } },
    ]),
  ]);

  return {
    period,
    operational: normalizeBookingSummary(bookingRows[0]),
    money: {
      ...wallet,
      externalPaymentValue: Number(externalRows[0]?.amount || 0),
      externalPaymentCount: Number(externalRows[0]?.count || 0),
      financialCoverage: 'partial',
      accurateSince: null,
      note: 'Wallet totals are source-filtered. Historical PayOS totals are derived from booking records.',
    },
  };
};

const getAdminBookingStatistics = async (filters = {}) => {
  const period = resolveDateRange(filters);
  const createdAtMatch = buildCreatedAtMatch(period);
  const bookingScheduleMatch = buildBookingScheduleMatch(period, filters.range || '30d');
  const bookingScopeMatch = {
    ...bookingScheduleMatch,
    ...(filters.range !== 'all' && filters.floorId
      ? { floorId: new mongoose.Types.ObjectId(filters.floorId) }
      : {}),
  };
  const timelineBucket = getTimelineBucket(filters, period);
  const [
    bookingRows,
    wallet,
    completed,
    cancelledCount,
    availabilityRows,
    byStatus,
    byPaymentMethod,
    timelineRows,
  ] = await Promise.all([
    Booking.aggregate(bookingSummaryPipeline(bookingScopeMatch)),
    walletBookingSummary(createdAtMatch),
    getCompletedBookingStatistics(bookingScopeMatch),
    Booking.countDocuments({
      status: 'CANCELLED',
      ...bookingScopeMatch,
    }),
    Booking.aggregate([
      {
        $group: {
          _id: null,
          earliestBookingAt: { $min: '$scheduledStart' },
          latestBookingAt: { $max: '$scheduledStart' },
        },
      },
    ]),
    Booking.aggregate([
      { $match: bookingScopeMatch },
      { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$prepaidAmount' } } },
      { $sort: { count: -1 } },
    ]),
    Booking.aggregate([
      { $match: bookingScopeMatch },
      { $group: { _id: '$paymentMethod', count: { $sum: 1 }, value: { $sum: '$prepaidAmount' } } },
      { $sort: { count: -1 } },
    ]),
    WalletTransaction.aggregate([
      {
        $match: {
          ...createdAtMatch,
          status: 'COMPLETED',
          refSource: { $in: BOOKING_SOURCES },
          type: { $in: ['PAYMENT', 'REFUND'] },
        },
      },
      {
        $group: {
          _id: {
            period: timelineDateExpression(timelineBucket.format),
            type: '$type',
          },
          amount: { $sum: '$amount' },
        },
      },
      { $sort: { '_id.period': 1 } },
    ]),
  ]);

  const timelineMap = new Map();
  for (const row of timelineRows) {
    const current = timelineMap.get(row._id.period) || {
      period: row._id.period,
      bookingCharges: 0,
      bookingRefunds: 0,
    };
    if (row._id.type === 'PAYMENT') current.bookingCharges = Number(row.amount || 0);
    if (row._id.type === 'REFUND') current.bookingRefunds = Number(row.amount || 0);
    timelineMap.set(row._id.period, current);
  }

  return {
    period,
    periodBasis: 'bookingSchedule',
    operational: normalizeBookingSummary(bookingRows[0]),
    completed,
    cancelled: {
      count: Number(cancelledCount || 0),
    },
    availability: {
      earliestBookingAt: availabilityRows[0]?.earliestBookingAt || null,
      latestBookingAt: availabilityRows[0]?.latestBookingAt || null,
    },
    money: {
      ...wallet,
      financialCoverage: 'partial',
      accurateSince: null,
    },
    byStatus: byStatus.map((row) => ({
      status: row._id || 'UNKNOWN',
      count: row.count,
      value: row.value || 0,
    })),
    byPaymentMethod: byPaymentMethod.map((row) => ({
      paymentMethod: row._id || 'unknown',
      count: row.count,
      value: row.value || 0,
    })),
    timeline: {
      granularity: timelineBucket.granularity,
      points: [...timelineMap.values()],
    },
  };
};

const getAdminSubscriptionStatistics = async (filters = {}) => {
  const period = resolveDateRange(filters);
  const createdAtMatch = buildCreatedAtMatch(period);
  const timelineBucket = getTimelineBucket(filters, period);
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * DAY_MS);

  const [
    periodSummaryRows,
    currentStatusRows,
    packageRows,
    renewals,
    purchaseTimelineRows,
    renewalTimelineRows,
    expiringCount,
    activeSlotRows,
  ] = await Promise.all([
    Subscription.aggregate([
      { $match: createdAtMatch },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          amount: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$amount', 0] },
          },
        },
      },
    ]),
    Subscription.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]),
    Subscription.aggregate([
      { $match: { ...createdAtMatch, paymentStatus: 'paid' } },
      {
        $group: {
          _id: '$ticketPackage',
          sold: { $sum: 1 },
          amount: { $sum: '$amount' },
          slots: { $sum: { $size: { $ifNull: ['$slots', []] } } },
        },
      },
      {
        $lookup: {
          from: 'ticketpackages',
          localField: '_id',
          foreignField: '_id',
          as: 'package',
        },
      },
      { $unwind: { path: '$package', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          packageId: '$_id',
          packageName: '$package.name',
          packageType: '$package.type',
          sold: 1,
          amount: 1,
          slots: 1,
        },
      },
      { $sort: { amount: -1 } },
    ]),
    SubscriptionRenewal.aggregate([
      { $match: { ...createdAtMatch, status: 'paid' } },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]),
    Subscription.aggregate([
      { $match: { ...createdAtMatch, paymentStatus: 'paid' } },
      {
        $group: {
          _id: timelineDateExpression(timelineBucket.format),
          amount: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    SubscriptionRenewal.aggregate([
      { $match: { ...createdAtMatch, status: 'paid' } },
      {
        $group: {
          _id: timelineDateExpression(
            timelineBucket.format,
            { $ifNull: ['$paidAt', '$createdAt'] }
          ),
          amount: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Subscription.countDocuments({
      status: 'active',
      paymentStatus: 'paid',
      expireAt: { $gt: now, $lte: sevenDaysFromNow },
    }),
    Subscription.aggregate([
      { $match: { status: 'active', paymentStatus: 'paid', expireAt: { $gt: now } } },
      {
        $group: {
          _id: null,
          activeSubscriptions: { $sum: 1 },
          reservedSlots: { $sum: { $size: { $ifNull: ['$slots', []] } } },
        },
      },
    ]),
  ]);

  const currentStatus = Object.fromEntries(
    currentStatusRows.map((row) => [row._id, row])
  );
  const sold = periodSummaryRows.reduce((sum, row) => sum + row.count, 0);
  const grossAmount = periodSummaryRows.reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );
  const renewalCount = Number(renewals[0]?.count || 0);
  const eligibleRenewals = Number(currentStatus.expired?.count || 0) + renewalCount;
  const timelineMap = new Map();
  for (const row of purchaseTimelineRows) {
    timelineMap.set(row._id, {
      period: row._id,
      packageSales: Number(row.amount || 0),
      renewalSales: 0,
    });
  }
  for (const row of renewalTimelineRows) {
    const current = timelineMap.get(row._id) || {
      period: row._id,
      packageSales: 0,
      renewalSales: 0,
    };
    current.renewalSales = Number(row.amount || 0);
    timelineMap.set(row._id, current);
  }

  return {
    period,
    summary: {
      sold,
      active: Number(currentStatus.active?.count || 0),
      pending: Number(currentStatus.pending?.count || 0),
      expired: Number(currentStatus.expired?.count || 0),
      cancelled: Number(currentStatus.cancelled?.count || 0),
      failed: Number(currentStatus.failed?.count || 0),
      expiringWithin7Days: expiringCount,
      grossAmount,
      renewalCount,
      renewalAmount: Number(renewals[0]?.amount || 0),
      renewalRate: eligibleRenewals
        ? Math.round((renewalCount / eligibleRenewals) * 1000) / 10
        : 0,
      activeReservedSlots: Number(activeSlotRows[0]?.reservedSlots || 0),
      averageSlotsPerActiveSubscription: Number(activeSlotRows[0]?.activeSubscriptions || 0)
        ? Math.round(
          (Number(activeSlotRows[0]?.reservedSlots || 0) /
            Number(activeSlotRows[0]?.activeSubscriptions || 1)) * 10
        ) / 10
        : 0,
    },
    byPackage: packageRows,
    timeline: {
      granularity: timelineBucket.granularity,
      points: [...timelineMap.values()].sort((left, right) =>
        left.period.localeCompare(right.period)
      ),
    },
    financialCoverage: renewalCount ? 'partial' : 'partial',
  };
};

module.exports = {
  getCustomerBookingStatistics,
  getAdminBookingStatistics,
  getAdminSubscriptionStatistics,
  getAdminPlatformRevenueStatistics,
  _private: {
    resolveDateRange,
    resolveModeDateRange,
    generateBucketLabels,
    parseVietnamCalendarDate,
    normalizeBookingSummary,
    buildCreatedAtMatch,
    buildBookingScheduleMatch,
    getTimelineBucket,
    normalizeCompletedBookingStatistics,
    buildLifecycleDateMatch,
    buildLifecycleDateMatchExclusive,
    calculatePlatformBookingRevenue,
    calculatePlatformRevenueTotal,
    startOfSpecificVietnamMonth,
    endOfSpecificVietnamMonth,
    toVietnamLocal,
  },
};
