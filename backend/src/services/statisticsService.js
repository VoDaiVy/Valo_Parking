const { paginateRevenueTransactions } = require('./revenueTransactionPagination');
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
const resolveModeDateRange = (filters = {}, now = new Date(), firstRevenueYear = null) => {
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

  if (mode === 'years') {
    const firstYear = Number.isInteger(firstRevenueYear)
      ? Math.min(firstRevenueYear, currentYear) : currentYear;
    return {
      startDate: startOfSpecificVietnamMonth(firstYear, 1),
      endDate: startOfSpecificVietnamMonth(currentYear + 1, 1),
      granularity: 'year',
      mode,
    };
  }

  throw Object.assign(new Error('Unsupported mode'), { statusCode: 400 });
};

/**
 * Generate zero-filled bucket labels for the given range.
 */
const generateBucketLabels = (startDate, endDate, granularity) => {
  const labels = [];
  if (granularity === 'year') {
    let year = toVietnamLocal(startDate).getUTCFullYear();
    while (startOfSpecificVietnamMonth(year, 1) < endDate) {
      labels.push(String(year));
      year += 1;
    }
  } else if (granularity === 'day') {
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
    // Retained service/cancellation fees remain income even if a service was not performed.
    const bookingRevenue = Math.max(0, grossRevenue - refundPaid - serviceRevenue);

    summary.bookingRevenue += bookingRevenue;
    summary.serviceRevenue += serviceRevenue;
    summary.refundTotal += financial.reportedRefundPaid ?? refundPaid;
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
  if (!filters.mode) return getAdminPlatformRevenueStatisticsLegacy(filters);
  const { getPackageRevenuePayments } = require('./revenuePackagePayments');
  const now = new Date();
  const finalizedStatus = { $in: ['COMPLETED', 'CANCELLED'] };
  const finalizedDate = { $ifNull: ['$completedAt', { $ifNull: ['$cancelledAt', '$updatedAt'] }] };
  const earliestRows = await Promise.all([
    [Booking, { status: finalizedStatus }, finalizedDate],
    [Subscription, { paymentStatus: 'paid' }, '$createdAt'],
    [SubscriptionRenewal, { status: 'paid' }, { $ifNull: ['$paidAt', '$createdAt'] }],
    [MembershipEntitlementRenewal, { status: 'paid' }, { $ifNull: ['$paidAt', '$createdAt'] }],
    [WalletTransaction, { type: 'TRANSFER_FEE', status: 'COMPLETED' }, '$createdAt'],
  ].map(([Model, match, date]) => Model.aggregate([
    { $match: match }, { $group: { _id: null, earliest: { $min: date } } },
  ])));
  const currentYear = toVietnamLocal(now).getUTCFullYear();
  const firstYear = earliestRows.flat().reduce((year, row) => row.earliest
    ? Math.min(year, toVietnamLocal(new Date(row.earliest)).getUTCFullYear()) : year, currentYear);
  const period = resolveModeDateRange(filters, now, firstYear);
  const { startDate, endDate, granularity } = period;
  const range = { $gte: startDate, $lt: endDate };
  const trafficGranularity = granularity === 'year' ? 'month' : granularity;
  const bucketFormat = value => value === 'year' ? '%Y' : value === 'month' ? '%Y-%m' : '%Y-%m-%d';
  const bucketKey = (date) => toVietnamLocal(new Date(date)).toISOString().slice(0, granularity === 'year' ? 4 : granularity === 'month' ? 7 : 10);
  const [bookings, packagePayments, fees, paymentRecords, entryRows, exitRows, currentlyParked, statusRows] = await Promise.all([
    Booking.find({ status: finalizedStatus, $expr: { $and: [{ $gte: [finalizedDate, startDate] }, { $lt: [finalizedDate, endDate] }] } })
      .select('status prepaidAmount paymentBreakdownSnapshot paidOverageAdjustments refundSettlements completedAt cancelledAt updatedAt').lean(),
    getPackageRevenuePayments(startDate, endDate),
    WalletTransaction.find({ type: 'TRANSFER_FEE', status: 'COMPLETED', createdAt: range }).select('amount createdAt').lean(),
    // These are individual ledger rows, never KPI totals. Package wallet debits
    // are represented by their purchase/renewal records below, exactly once.
    WalletTransaction.find({ status: 'COMPLETED', createdAt: range, $or: [
      { type: { $in: ['PAYMENT', 'REFUND'] }, refSource: { $in: BOOKING_SOURCES } },
      { type: 'TRANSFER_FEE' },
    ] }).select('type amount createdAt description refSource refSourceId status').sort({ createdAt: -1, _id: -1 }).lean(),
    Session.aggregate([{ $match: { status: { $ne: 'cancelled' }, checkInTime: range } },
      { $group: { _id: timelineDateExpression(bucketFormat(trafficGranularity), '$checkInTime'), count: { $sum: 1 } } }]),
    Session.aggregate([{ $match: { status: 'completed', checkOutTime: range } },
      { $group: { _id: timelineDateExpression(bucketFormat(trafficGranularity), '$checkOutTime'), count: { $sum: 1 } } }]),
    Session.countDocuments({ status: 'active', checkInTime: { $lte: now }, checkOutTime: null }),
    Booking.aggregate([{ $match: { scheduledStart: range } }, { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }]),
  ]);
  const bookingIds = bookings.map(booking => booking._id);
  const [financial, serviceRows] = await Promise.all([
    getBookingFinancialSummaryMap(bookings, { excludeModificationRefunds: true }),
    bookingIds.length ? BookingService.aggregate([{ $match: { bookingId: { $in: bookingIds }, status: 'done' } },
      { $group: { _id: '$bookingId', amount: { $sum: '$price' } } }]) : [],
  ]);
  const services = new Map(serviceRows.map(row => [String(row._id), Number(row.amount)]));
  const zero = () => ({ totalRevenue: 0, bookingRevenue: 0, serviceRevenue: 0, packageRevenue: 0, membershipTransferFees: 0, refunds: 0 });
  const trend = generateBucketLabels(startDate, endDate, granularity).map(label => ({ period: label, ...zero() }));
  const buckets = new Map(trend.map(row => [row.period, row]));
  let serviceBookingCount = 0;
  for (const booking of bookings) {
    const row = buckets.get(bucketKey(booking.completedAt || booking.cancelledAt || booking.updatedAt));
    const revenue = calculatePlatformBookingRevenue([booking], financial, services);
    row.bookingRevenue += revenue.bookingRevenue;
    row.serviceRevenue += revenue.serviceRevenue;
    row.refunds += revenue.refundTotal;
    serviceBookingCount += revenue.serviceBookingCount;
  }
  const packageMap = new Map();
  for (const payment of packagePayments) {
    buckets.get(bucketKey(payment.paidAt)).packageRevenue += payment.amount;
    const key = payment.packageId ? String(payment.packageId) : null;
    if (!packageMap.has(key)) packageMap.set(key, { packageId: key, packageName: payment.packageName, packageType: payment.packageType, purchaseAmount: 0, purchaseCount: 0, renewalAmount: 0, renewalCount: 0 });
    const row = packageMap.get(key);
    row[`${payment.kind}Amount`] += payment.amount;
    row[`${payment.kind}Count`] += 1;
  }
  for (const fee of fees) buckets.get(bucketKey(fee.createdAt)).membershipTransferFees += fee.amount;
  const summary = zero();
  for (const row of trend) {
    // Refunds already reduced their source; subtracting them here would double count.
    row.totalRevenue = row.bookingRevenue + row.serviceRevenue + row.packageRevenue + row.membershipTransferFees;
    for (const key of Object.keys(summary)) summary[key] += row[key];
  }
  summary.sourceCompositionTotal = summary.totalRevenue;
  const packageIds = [...packageMap.keys()].filter(Boolean);
  const docs = packageIds.length ? await TicketPackage.find({ _id: { $in: packageIds } }).select('name type isActive').lean() : [];
  const packageDocs = new Map(docs.map(doc => [String(doc._id), doc]));
  const packageBreakdown = [...packageMap.values()].map(row => ({ ...row,
    packageName: packageDocs.get(row.packageId)?.name || row.packageName || 'Archived package',
    packageType: packageDocs.get(row.packageId)?.type || row.packageType || null,
    isActive: packageDocs.get(row.packageId)?.isActive ?? false,
    totalAmount: row.purchaseAmount + row.renewalAmount,
  })).sort((left, right) => right.totalAmount - left.totalAmount);
  const entries = new Map(entryRows.map(row => [row._id, row.count]));
  const exits = new Map(exitRows.map(row => [row._id, row.count]));
  const traffic = generateBucketLabels(startDate, endDate, trafficGranularity).map(label => ({ period: label, entries: entries.get(label) || 0, exits: exits.get(label) || 0 }));
  const { recentTransactions, transactionPagination } = paginateRevenueTransactions([
    ...paymentRecords.map(row => ({ id: String(row._id), paidAt: row.createdAt, type: row.type, reference: row.refSourceId,
      description: row.description || row.refSource, amount: row.amount, status: row.status, paymentMethod: 'wallet' })),
    ...packagePayments.map(row => ({ id: row.id, paidAt: row.paidAt, type: row.kind === 'purchase' ? 'PACKAGE_PURCHASE' : 'PACKAGE_RENEWAL', reference: row.reference,
      description: packageDocs.get(String(row.packageId))?.name || 'Package payment', amount: row.amount, status: 'PAID', paymentMethod: row.paymentMethod, dateBasis: row.dateBasis })),
  ], filters.transactionPage);
  const purchases = packagePayments.filter(row => row.kind === 'purchase');
  const renewals = packagePayments.filter(row => row.kind === 'renewal');
  const sumAmounts = rows => rows.reduce((total, row) => total + row.amount, 0);
  return {
    period: { ...period, timeZone: 'Asia/Ho_Chi_Minh', endExclusive: true }, currency: 'VND',
    basis: 'net_finalized_booking_and_paid_package_revenue', summary, trend,
    traffic, trafficGranularity,
    trafficSummary: { totalEntries: traffic.reduce((total, row) => total + row.entries, 0), totalExits: traffic.reduce((total, row) => total + row.exits, 0), currentlyParked },
    statusDistribution: { completed: statusRows.find(row => row._id === 'COMPLETED')?.count || 0, cancelled: statusRows.find(row => row._id === 'CANCELLED')?.count || 0,
      totalBookings: statusRows.reduce((total, row) => total + row.count, 0), byStatus: statusRows.map(row => ({ status: row._id, count: row.count })) },
    packageBreakdown, recentTransactions, transactionPagination,
    availableYears: Array.from({ length: currentYear - firstYear + 1 }, (_, index) => firstYear + index),
    reportingNotes: {
      revenue: 'Net finalized booking income, completed services, paid packages and transfer fees. Refunds are already deducted from their booking cohort.',
      bookingDate: 'completedAt, then cancelledAt, then legacy updatedAt',
      packageDate: 'Payment timestamp; legacy records without a payment timestamp use createdAt.',
      transactions: 'Paginated recorded booking wallet payments/refunds, package payments and transfer fees, by payment date. This payment activity is distinct from finalized revenue.',
    },
    vip: { revenue: summary.packageRevenue, transactionCount: packagePayments.length, purchaseRevenue: sumAmounts(purchases), renewalRevenue: sumAmounts(renewals) },
    booking: { revenue: summary.bookingRevenue, completedCount: bookings.filter(row => row.status === 'COMPLETED').length, finalizedCount: bookings.length },
    service: { revenue: summary.serviceRevenue, completedBookingCount: serviceBookingCount },
    membershipTransferFeesDetail: { revenue: summary.membershipTransferFees, transactionCount: fees.length }, totalRevenue: summary.totalRevenue,
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
  const { bookingManagementFilter, combineBookingFilters } = require('../utils/bookingManagementFilter');
  const bookingScopeMatch = combineBookingFilters(bookingScheduleMatch, await bookingManagementFilter(filters));
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
