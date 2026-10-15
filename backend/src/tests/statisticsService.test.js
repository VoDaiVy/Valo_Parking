const test = require('node:test');
const assert = require('node:assert/strict');
const { _private } = require('../services/statisticsService');

test('resolveDateRange creates a bounded 30 day period', () => {
  const now = new Date('2030-03-31T12:00:00.000Z');
  const result = _private.resolveDateRange({ range: '30d' }, now);
  assert.equal(result.endDate.toISOString(), now.toISOString());
  assert.equal(
    result.startDate.toISOString(),
    new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  );
});

test('resolveDateRange rejects reversed custom dates', () => {
  assert.throws(
    () => _private.resolveDateRange({
      startDate: '2030-02-01T00:00:00.000Z',
      endDate: '2030-01-01T00:00:00.000Z',
    }),
    /startDate must be before endDate/
  );
});

test('resolveDateRange starts the month at midnight in Vietnam', () => {
  const now = new Date('2030-03-15T12:00:00.000Z');
  const result = _private.resolveDateRange({ range: 'month' }, now);
  assert.equal(result.startDate.toISOString(), '2030-02-28T17:00:00.000Z');
});

test('resolveDateRange starts today at midnight in Vietnam', () => {
  const now = new Date('2030-03-15T12:00:00.000Z');
  const result = _private.resolveDateRange({ range: 'today' }, now);
  assert.equal(result.startDate.toISOString(), '2030-03-14T17:00:00.000Z');
  assert.equal(result.endDate.toISOString(), now.toISOString());
});

test('daily range resolves the selected Vietnam calendar date', () => {
  const result = _private.resolveDateRange({
    range: 'daily',
    date: '2026-07-19',
  });

  assert.equal(result.startDate.toISOString(), '2026-07-18T17:00:00.000Z');
  assert.equal(result.endDate.toISOString(), '2026-07-19T16:59:59.999Z');
});

test('daily range rejects an invalid calendar date', () => {
  assert.throws(
    () => _private.resolveDateRange({
      range: 'daily',
      date: '2026-02-30',
    }),
    /valid calendar date/
  );
});

test('daily booking match uses the same overlap rules as Booking Management', () => {
  const period = _private.resolveDateRange({
    range: 'daily',
    date: '2026-07-20',
  });
  const result = _private.buildBookingScheduleMatch(period, 'daily');
  assert.equal(result.$or.length, 3);
  assert.equal(
    result.$or[0].scheduledStart.$gte.toISOString(),
    '2026-07-19T17:00:00.000Z'
  );
  assert.equal(
    result.$or[1].scheduledEnd.$lte.toISOString(),
    '2026-07-20T16:59:59.999Z'
  );
  assert.equal(
    result.$or[2].scheduledStart.$lte.toISOString(),
    '2026-07-19T17:00:00.000Z'
  );
});

test('today booking statistics use the full local booking schedule day', () => {
  const period = {
    startDate: new Date('2030-03-14T17:00:00.000Z'),
    endDate: new Date('2030-03-15T12:00:00.000Z'),
  };
  const result = _private.buildBookingScheduleMatch(period, 'today');

  assert.equal(result.$or.length, 3);
  assert.equal(
    result.$or[1].scheduledEnd.$lte.toISOString(),
    '2030-03-15T16:59:59.999Z'
  );
});

test('all-time booking statistics do not restrict the booking schedule', () => {
  const result = _private.buildBookingScheduleMatch({
    startDate: null,
    endDate: new Date('2030-03-15T12:00:00.000Z'),
  }, 'all');

  assert.deepEqual(result, {});
});

test('normalizeBookingSummary computes completion rate from terminal bookings', () => {
  const result = _private.normalizeBookingSummary({
    totalBookings: 12,
    completedBookings: 8,
    activeBookings: 2,
    cancelledBookings: 1,
    expiredBookings: 1,
    scheduledHours: 22.75,
    bookingValue: 500000,
  });
  assert.equal(result.completionRate, 80);
  assert.equal(result.scheduledHours, 22.8);
  assert.equal(result.bookingValue, 500000);
});

test('timeline uses daily buckets for short ranges and monthly buckets for all time', () => {
  const shortPeriod = {
    startDate: new Date('2030-03-01T00:00:00.000Z'),
    endDate: new Date('2030-03-31T00:00:00.000Z'),
  };
  assert.equal(_private.getTimelineBucket({ range: '30d' }, shortPeriod).granularity, 'day');
  assert.equal(_private.getTimelineBucket({ range: 'all' }, {
    startDate: null,
    endDate: shortPeriod.endDate,
  }).granularity, 'month');
});

test('completed revenue summary keeps gross and actual revenue separate', () => {
  const result = _private.normalizeCompletedBookingStatistics({
    count: 8,
    prepaidRevenue: 500000,
    additionalRevenue: 100000,
    grossRevenue: 600000,
    refundPaid: 40000,
    actualRevenue: 560000,
  });
  assert.deepEqual(result, {
    count: 8,
    prepaidRevenue: 500000,
    additionalRevenue: 100000,
    grossRevenue: 600000,
    refundPaid: 40000,
    actualRevenue: 560000,
  });
});

test('platform booking revenue separates parking and service without double counting', () => {
  const bookings = [
    {
      _id: 'booking-with-snapshot',
      paymentBreakdownSnapshot: {
        source: 'calculated',
        parkingAmount: 70,
        serviceAmount: 30,
        totalAmount: 100,
      },
      refundSettlements: [{
        payoutStatus: 'credited',
        refundableServiceAmount: 10,
      }],
    },
    {
      _id: 'legacy-booking',
      refundSettlements: [],
    },
  ];
  const financialSummaries = new Map([
    ['booking-with-snapshot', {
      prepaidCollected: 100,
      grossRevenue: 130,
      refundPaid: 10,
      actualRevenue: 120,
    }],
    ['legacy-booking', {
      prepaidCollected: 50,
      grossRevenue: 50,
      refundPaid: 0,
      actualRevenue: 50,
    }],
  ]);
  const completedServices = new Map([
    ['booking-with-snapshot', 30],
    ['legacy-booking', 15],
  ]);

  const result = _private.calculatePlatformBookingRevenue(
    bookings,
    financialSummaries,
    completedServices
  );

  assert.equal(result.bookingRevenue, 135);
  assert.equal(result.serviceRevenue, 35);
  assert.equal(result.completedBookingCount, 2);
  assert.equal(result.serviceBookingCount, 2);
  assert.equal(result.bookingRevenue + result.serviceRevenue, 170);
});

test('platform service revenue excludes paid services that are not completed', () => {
  const bookings = [{
    _id: 'booking-with-pending-service',
    paymentBreakdownSnapshot: {
      source: 'calculated',
      parkingAmount: 80,
      serviceAmount: 20,
      totalAmount: 100,
    },
    refundSettlements: [],
  }];
  const financialSummaries = new Map([
    ['booking-with-pending-service', {
      prepaidCollected: 100,
      grossRevenue: 100,
      refundPaid: 0,
      actualRevenue: 100,
    }],
  ]);

  const result = _private.calculatePlatformBookingRevenue(
    bookings,
    financialSummaries,
    new Map()
  );

  assert.equal(result.bookingRevenue, 80);
  assert.equal(result.serviceRevenue, 0);
  assert.equal(result.serviceBookingCount, 0);
});

test('refund is tracked separately and not double-subtracted', () => {
  const bookings = [{
    _id: 'refunded-booking',
    paymentBreakdownSnapshot: {
      source: 'calculated',
      parkingAmount: 100,
      serviceAmount: 0,
      totalAmount: 100,
    },
    refundSettlements: [{
      payoutStatus: 'credited',
      refundableServiceAmount: 0,
    }],
  }];
  const financialSummaries = new Map([
    ['refunded-booking', {
      prepaidCollected: 100,
      grossRevenue: 100,
      refundPaid: 30,
      actualRevenue: 70,
    }],
  ]);

  const result = _private.calculatePlatformBookingRevenue(
    bookings,
    financialSummaries,
    new Map()
  );

  // Booking revenue should be 70 (100 gross - 30 refund)
  assert.equal(result.bookingRevenue, 70);
  // The refund total should be tracked separately
  assert.equal(result.refundTotal, 30);
  // Both sum to gross
  assert.equal(result.bookingRevenue + result.refundTotal, 100);
});

test('platform revenue includes realized membership transfer fees exactly once', () => {
  const result = _private.calculatePlatformRevenueTotal({
    vipRevenue: 500000,
    bookingRevenue: 300000,
    serviceRevenue: 75000,
    membershipTransferFeeRevenue: 12200,
  });

  assert.equal(result, 887200);
});

test('platform revenue uses lifecycle timestamps with a legacy fallback', () => {
  const period = {
    startDate: new Date('2030-03-01T00:00:00.000Z'),
    endDate: new Date('2030-03-31T23:59:59.999Z'),
  };
  const match = _private.buildLifecycleDateMatch('completedAt', 'updatedAt', period);

  assert.equal(match.$or[0].completedAt.$gte, period.startDate);
  assert.equal(match.$or[0].completedAt.$lte, period.endDate);
  assert.equal(match.$or[1].completedAt, null);
  assert.equal(match.$or[1].updatedAt.$gte, period.startDate);
});

/* ── Mode-based Revenue Analytics tests ──────────────────────────────── */

test('resolveModeDateRange: 7d gives exactly 7 calendar days', () => {
  // 2026-09-23 01:00 ICT = 2026-09-22T18:00Z
  const now = new Date('2026-09-22T18:00:00.000Z');
  const result = _private.resolveModeDateRange({ mode: '7d' }, now);
  // Start = 6 days before start of today ICT
  // Today ICT starts at 2026-09-22T17:00Z (midnight Sep 23 ICT)
  const todayStart = new Date('2026-09-22T17:00:00.000Z');
  const expectedStart = new Date(todayStart.getTime() - 6 * 86400000);
  assert.equal(result.startDate.toISOString(), expectedStart.toISOString());
  assert.equal(result.endDate.toISOString(), new Date(todayStart.getTime() + 86400000).toISOString());
  assert.equal(result.granularity, 'day');
});

test('resolveModeDateRange: month uses full calendar month in Vietnam', () => {
  const now = new Date('2026-09-15T12:00:00.000Z');
  const result = _private.resolveModeDateRange({ mode: 'month', year: '2026', month: '9' }, now);
  // Sep 1 ICT = Aug 31 17:00 UTC
  assert.equal(result.startDate.toISOString(), '2026-08-31T17:00:00.000Z');
  // Oct 1 ICT = Sep 30 17:00 UTC
  assert.equal(result.endDate.toISOString(), '2026-09-30T17:00:00.000Z');
  assert.equal(result.granularity, 'day');
});

test('resolveModeDateRange: quarter covers exactly 3 months', () => {
  const now = new Date('2026-09-15T12:00:00.000Z');
  const result = _private.resolveModeDateRange({ mode: 'quarter', year: '2026', quarter: '3' }, now);
  // Q3 = Jul-Sep: Jul 1 ICT = Jun 30 17:00 UTC → Oct 1 ICT = Sep 30 17:00 UTC
  assert.equal(result.startDate.toISOString(), '2026-06-30T17:00:00.000Z');
  assert.equal(result.endDate.toISOString(), '2026-09-30T17:00:00.000Z');
  assert.equal(result.granularity, 'month');
});

test('resolveModeDateRange: year has all 12 months', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');
  const result = _private.resolveModeDateRange({ mode: 'year', year: '2026' }, now);
  // Jan 1 ICT = Dec 31 2025 17:00 UTC → Jan 1 2027 ICT = Dec 31 2026 17:00 UTC
  assert.equal(result.startDate.toISOString(), '2025-12-31T17:00:00.000Z');
  assert.equal(result.endDate.toISOString(), '2026-12-31T17:00:00.000Z');
  assert.equal(result.granularity, 'month');
});

test('resolveModeDateRange: leap year February has 29 days', () => {
  const now = new Date('2028-02-15T12:00:00.000Z');
  const result = _private.resolveModeDateRange({ mode: 'month', year: '2028', month: '2' }, now);
  const buckets = _private.generateBucketLabels(result.startDate, result.endDate, result.granularity);
  assert.equal(buckets.length, 29);
  assert.equal(buckets[0], '2028-02-01');
  assert.equal(buckets[28], '2028-02-29');
});

test('resolveModeDateRange: non-leap year February has 28 days', () => {
  const now = new Date('2026-02-15T12:00:00.000Z');
  const result = _private.resolveModeDateRange({ mode: 'month', year: '2026', month: '2' }, now);
  const buckets = _private.generateBucketLabels(result.startDate, result.endDate, result.granularity);
  assert.equal(buckets.length, 28);
});

test('generateBucketLabels: year mode produces exactly 12 months', () => {
  const result = _private.resolveModeDateRange({ mode: 'year', year: '2026' });
  const buckets = _private.generateBucketLabels(result.startDate, result.endDate, 'month');
  assert.equal(buckets.length, 12);
  assert.equal(buckets[0], '2026-01');
  assert.equal(buckets[11], '2026-12');
});

test('generateBucketLabels: 7d mode produces exactly 7 days', () => {
  const now = new Date('2026-09-22T18:00:00.000Z');
  const result = _private.resolveModeDateRange({ mode: '7d' }, now);
  const buckets = _private.generateBucketLabels(result.startDate, result.endDate, 'day');
  assert.equal(buckets.length, 7);
});

test('generateBucketLabels: quarter mode produces exactly 3 months', () => {
  for (let q = 1; q <= 4; q++) {
    const result = _private.resolveModeDateRange({ mode: 'quarter', year: '2026', quarter: String(q) });
    const buckets = _private.generateBucketLabels(result.startDate, result.endDate, 'month');
    assert.equal(buckets.length, 3, `Quarter ${q} should have 3 months`);
  }
});

test('buildLifecycleDateMatchExclusive uses $lt for endDate', () => {
  const start = new Date('2026-09-01T00:00:00.000Z');
  const end = new Date('2026-10-01T00:00:00.000Z');
  const match = _private.buildLifecycleDateMatchExclusive('completedAt', 'updatedAt', start, end);
  assert.equal(match.$or[0].completedAt.$gte, start);
  assert.equal(match.$or[0].completedAt.$lt, end);
  assert.equal(match.$or[1].completedAt, null);
  assert.equal(match.$or[1].updatedAt.$gte, start);
  assert.equal(match.$or[1].updatedAt.$lt, end);
});

test('startOfSpecificVietnamMonth gives correct boundary', () => {
  const result = _private.startOfSpecificVietnamMonth(2026, 9);
  // Sep 1 midnight ICT = Aug 31 17:00 UTC
  assert.equal(result.toISOString(), '2026-08-31T17:00:00.000Z');
});

test('endOfSpecificVietnamMonth gives start of next month', () => {
  const result = _private.endOfSpecificVietnamMonth(2026, 9);
  // Oct 1 midnight ICT = Sep 30 17:00 UTC
  assert.equal(result.toISOString(), '2026-09-30T17:00:00.000Z');
});

test('source sum invariant: booking + service + package + transfer = total', () => {
  // This tests the invariant at the calculatePlatformRevenueTotal level
  const bookingRev = 300000;
  const serviceRev = 75000;
  const packageRev = 500000;
  const transferFee = 12200;
  const total = _private.calculatePlatformRevenueTotal({
    vipRevenue: packageRev,
    bookingRevenue: bookingRev,
    serviceRevenue: serviceRev,
    membershipTransferFeeRevenue: transferFee,
  });
  assert.equal(total, bookingRev + serviceRev + packageRev + transferFee);
});
