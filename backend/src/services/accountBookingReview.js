const Booking = require('../models/Booking');
const { getPaymentBreakdown } = require('./bookingRefundService');
const { LEGACY_REFUND_RULE } = require('./refundLegacyDefaults');
const { selectCancellationTier } = require('./refundEngine');

const REVIEW_DAYS = 30;
const NEAR_CUTOFF_MINUTES = 15;
const NEAR_CUTOFF_ORDERS = 3;
const REPEATED_CANCELLATIONS = 5;
const REVIEW_WINDOW_MS = REVIEW_DAYS * 24 * 60 * 60_000;

const meetsReviewCriteria = (orders, nearOrders) =>
  orders.size >= REPEATED_CANCELLATIONS || nearOrders.size >= NEAR_CUTOFF_ORDERS;

function updateOrderCount(counts, order, change) {
  const count = (counts.get(order) || 0) + change;
  if (count > 0) counts.set(order, count);
  else counts.delete(order);
}

function latestQualifyingCancellation(events) {
  const orders = new Map();
  const nearOrders = new Map();
  let end = 0;
  // Events arrive newest first. Each cancellation enters and leaves the window once.
  for (const event of events) {
    while (end < events.length && +event.cancelledAt - +events[end].cancelledAt <= REVIEW_WINDOW_MS) {
      const next = events[end++];
      updateOrderCount(orders, next.order, 1);
      if (next.nearCutoff) updateOrderCount(nearOrders, next.order, 1);
    }
    if (meetsReviewCriteria(orders, nearOrders)) return event.cancelledAt;
    updateOrderCount(orders, event.order, -1);
    if (event.nearCutoff) updateOrderCount(nearOrders, event.order, -1);
  }
  return null;
}

function cancellationEvidence(booking) {
  const refund = booking.refundSettlements?.find(item => item.eventType === 'cancellation');
  if (!refund || !booking.cancelledAt) return null;
  const minutesBeforeStart = refund.minutesBeforeStart ?? Math.floor((+new Date(booking.scheduledStart) - +new Date(booking.cancelledAt)) / 60_000);
  const parkingPaid = getPaymentBreakdown(booking).parkingAmount;
  const fullParkingRefund = parkingPaid > 0 && refund.payoutStatus === 'credited'
    && Number(refund.refundAmount) === parkingPaid;
  let thresholdMinutes = refund.appliedThresholdMinutes;
  let percent = refund.appliedRefundPercent;
  if (fullParkingRefund && (percent == null || thresholdMinutes == null)) {
    // Older settlements did not record the applied tier. Require the snapshot
    // and legacy tiers to agree when both would explain the credited amount.
    try {
      const legacy = selectCancellationTier(LEGACY_REFUND_RULE, minutesBeforeStart);
      const snapshot = selectCancellationTier(booking.refundPolicySnapshot?.rule || LEGACY_REFUND_RULE, minutesBeforeStart);
      const possible = [legacy, snapshot].filter(tier => tier.refundPercent === 100);
      const thresholds = new Set(possible.map(tier => tier.minimumMinutesBeforeStart));
      if (thresholds.size === 1) {
        [thresholdMinutes] = thresholds;
        percent = 100;
      }
    } catch {
      // A malformed older snapshot cannot establish a precise cutoff.
    }
  }
  const nearCutoff = Number.isFinite(minutesBeforeStart) && thresholdMinutes != null && percent === 100
    && fullParkingRefund && minutesBeforeStart >= thresholdMinutes && minutesBeforeStart - thresholdMinutes <= NEAR_CUTOFF_MINUTES;
  return {
    bookingId: booking._id, scheduledStart: booking.scheduledStart, cancelledAt: booking.cancelledAt,
    minutesBeforeStart, thresholdMinutes: thresholdMinutes ?? null,
    creditedAmount: refund.payoutStatus === 'credited' ? Number(refund.refundAmount) : 0,
    nearCutoff,
  };
}

async function getBookingReviews(userId, now = Date.now()) {
  const since = new Date(now - REVIEW_WINDOW_MS);
  const query = { status: 'CANCELLED', userId: userId || { $ne: null }, cancelledAt: { $lte: new Date(now) }, 'refundSettlements.eventType': 'cancellation' };
  const cursor = Booking.find(query)
    .select('userId bookingOrderId createdAt scheduledStart cancelledAt prepaidAmount paymentBreakdownSnapshot refundPolicySnapshot refundSettlements')
    .sort({ cancelledAt: -1 }).lean().cursor();
  const accounts = new Map();
  for await (const booking of cursor) {
    const evidence = cancellationEvidence(booking);
    if (!evidence) continue;
    const key = String(booking.userId);
    const current = accounts.get(key) || {
      userId: key, orders: new Set(), nearOrders: new Set(), allOrders: new Set(),
      allNearOrders: new Set(), events: [], samples: [],
    };
    // Bulk bookings now have an order ID. Group older bookings made in the
    // same minute conservatively so one multi-car cart is not a pattern.
    const createdMinute = booking.createdAt ? Math.floor(+new Date(booking.createdAt) / 60_000) : NaN;
    const order = String(booking.bookingOrderId || (Number.isFinite(createdMinute) ? createdMinute : booking._id));
    current.allOrders.add(order);
    if (evidence.nearCutoff) current.allNearOrders.add(order);
    current.events.push({ order, cancelledAt: evidence.cancelledAt, nearCutoff: evidence.nearCutoff });
    if (evidence.cancelledAt >= since) {
      current.orders.add(order);
      if (evidence.nearCutoff) current.nearOrders.add(order);
    }
    if (userId && current.samples.length < 6) current.samples.push(evidence);
    accounts.set(key, current);
  }
  return [...accounts.values()].map(row => ({
    userId: row.userId, cancelledOrders: row.orders.size, nearCutoffOrders: row.nearOrders.size,
    flagged: meetsReviewCriteria(row.orders, row.nearOrders),
    totalCancelledOrders: row.allOrders.size, totalNearCutoffOrders: row.allNearOrders.size,
    lastFlaggedAt: latestQualifyingCancellation(row.events),
    ...(userId ? { samples: row.samples } : {}),
  }));
}

module.exports = { cancellationEvidence, getBookingReviews, REVIEW_DAYS, NEAR_CUTOFF_MINUTES, NEAR_CUTOFF_ORDERS, REPEATED_CANCELLATIONS };
