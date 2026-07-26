const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Session = require('../models/Session');
const WalletTransaction = require('../models/WalletTransaction');
const pricingEngine = require('./pricingEngine');
const walletService = require('./walletService');
const { cloneLegacyRefundRule } = require('./refundLegacyDefaults');
const {
  applyMinimumBillableMinutes,
  calculateCancellationRefund,
  calculateEarlyCheckoutRefund,
  calculateNoShowRefund,
  normalizeRule,
} = require('./refundEngine');

const getRefundEngineMode = () => {
  const mode = String(process.env.REFUND_ENGINE_MODE || 'active').toLowerCase();
  return ['legacy', 'shadow', 'active'].includes(mode) ? mode : 'active';
};

const getSnapshotRule = (booking) =>
  normalizeRule(booking.refundPolicySnapshot?.rule || cloneLegacyRefundRule());

const getSettlementRule = (booking) =>
  getRefundEngineMode() === 'active'
    ? getSnapshotRule(booking)
    : normalizeRule(cloneLegacyRefundRule());

const attachShadowComparison = (eventType, selected, candidate) => {
  if (getRefundEngineMode() !== 'shadow') return selected;

  const comparison = {
    eventType,
    legacyRefundAmount: selected.refundAmount || 0,
    candidateRefundAmount: candidate.refundAmount || 0,
    legacyExtraAmount: selected.extraAmount || 0,
    candidateExtraAmount: candidate.extraAmount || 0,
  };
  console.info('[RefundEngine:shadow]', comparison);
  return { ...selected, shadowComparison: comparison };
};

const getPaymentBreakdown = (booking) => {
  const paidTotal = Math.max(0, Math.floor(Number(booking.prepaidAmount) || 0));
  const snapshot = booking.paymentBreakdownSnapshot;

  if (!snapshot?.source) {
    return {
      parkingAmount: paidTotal,
      serviceAmount: 0,
      totalAmount: paidTotal,
      source: 'legacy-derived',
    };
  }

  const serviceAmount = Math.min(
    Math.max(0, Math.floor(Number(snapshot.serviceAmount) || 0)),
    paidTotal
  );
  const parkingAmount = Math.min(
    Math.max(0, Math.floor(Number(snapshot.parkingAmount) || 0)),
    paidTotal - serviceAmount
  );

  return { parkingAmount, serviceAmount, totalAmount: paidTotal, source: snapshot.source };
};

const getPriorKioskExtraPaid = async (booking) => {
  if (booking.paidOverageAdjustments?.length) {
    return booking.paidOverageAdjustments.reduce(
      (sum, adjustment) => sum + Math.max(0, Number(adjustment.amount) || 0),
      0
    );
  }

  const escapedBookingId = String(booking._id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rows = await WalletTransaction.aggregate([
    {
      $match: {
        type: 'PAYMENT',
        status: 'COMPLETED',
        idempotencyKey: {
          $regex: `^booking:${escapedBookingId}:session:.*:kiosk-extra$`,
        },
      },
    },
    { $group: { _id: null, amount: { $sum: '$amount' } } },
  ]);
  return Math.max(0, Math.floor(Number(rows[0]?.amount) || 0));
};

const quoteCancellation = async (booking, asOf = new Date()) => {
  const breakdown = getPaymentBreakdown(booking);
  const minutesBeforeStart = Math.floor(
    (new Date(booking.scheduledStart).getTime() - new Date(asOf).getTime()) / 60000
  );

  const input = {
    minutesBeforeStart,
    parkingAmount: breakdown.parkingAmount,
    paidTotal: breakdown.totalAmount,
  };
  const selected = calculateCancellationRefund({
    ...input,
    rule: getSettlementRule(booking),
  });
  const candidate = calculateCancellationRefund({
    ...input,
    rule: getSnapshotRule(booking),
  });
  return attachShadowComparison('cancellation', selected, candidate);
};

const quoteNoShow = async (booking) => {
  const breakdown = getPaymentBreakdown(booking);
  const input = {
    parkingAmount: breakdown.parkingAmount,
    paidTotal: breakdown.totalAmount,
  };
  const selected = calculateNoShowRefund({ ...input, rule: getSettlementRule(booking) });
  const candidate = calculateNoShowRefund({ ...input, rule: getSnapshotRule(booking) });
  return attachShadowComparison('no_show', selected, candidate);
};

const quoteEarlyCheckout = async (booking, currentSession, asOf = new Date()) => {
  const breakdown = getPaymentBreakdown(booking);
  const previousSessionFilter = {
    bookingId: booking._id,
    status: 'completed',
  };
  if (currentSession?._id) {
    previousSessionFilter._id = { $ne: currentSession._id };
  }
  const [previousSessions, priorKioskExtraPaid] = await Promise.all([
    Session.find(previousSessionFilter)
      .select('checkInTime checkOutTime')
      .lean(),
    getPriorKioskExtraPaid(booking),
  ]);

  const intervals = previousSessions
    .filter((item) => item.checkInTime && item.checkOutTime)
    .map((item) => ({ start: item.checkInTime, end: item.checkOutTime }));
  if (currentSession?.checkInTime) {
    intervals.push({ start: currentSession.checkInTime, end: asOf });
  }

  const calculateForRule = async (rule) => {
    const billableIntervals = applyMinimumBillableMinutes(
      intervals,
      rule.minimumBillableMinutes,
      asOf
    );
    const pricing = await pricingEngine.calculateTotalForIntervals(billableIntervals);
    const calculation = calculateEarlyCheckoutRefund({
      rule,
      parkingAmount: breakdown.parkingAmount,
      paidTotal: breakdown.totalAmount,
      actualParkingCharge: pricing.finalTotal,
    });

    return {
      ...calculation,
      extraAmount: Math.max(0, calculation.extraAmount - priorKioskExtraPaid),
      priorKioskExtraPaid,
      pricingBreakdown: pricing,
      billableIntervals,
    };
  };

  const selected = await calculateForRule(getSettlementRule(booking));
  if (getRefundEngineMode() !== 'shadow') return selected;

  const candidate = await calculateForRule(getSnapshotRule(booking));
  return attachShadowComparison('early_checkout', selected, candidate);
};

const settleBookingEvent = async ({
  bookingId,
  eventKey,
  eventType,
  calculation,
  description,
  applyState,
  settleExtraWithWallet = true,
  walletNetAmount,
  session: existingSession,
}) => {
  const mongoSession = existingSession || await mongoose.startSession();
  if (!existingSession) mongoSession.startTransaction();

  try {
    const booking = await Booking.findById(bookingId).session(mongoSession);
    if (!booking) {
      throw Object.assign(new Error('Booking not found'), { statusCode: 404 });
    }

    const existing = booking.refundSettlements?.find(
      (settlement) => settlement.eventKey === eventKey
    );
    if (existing) {
      await mongoSession.abortTransaction();
      return { booking, settlement: existing, alreadyProcessed: true };
    }

    let walletTransactionId = null;
    let payoutStatus = 'not_required';
    let suppressionReason = null;
    const refundAmount = Math.max(0, Math.floor(Number(calculation.refundAmount) || 0));
    const extraAmount =
      settleExtraWithWallet
        ? Math.max(0, Math.floor(Number(calculation.extraAmount) || 0))
        : 0;
    const resolvedNetWalletAmount =
      walletNetAmount === undefined
        ? refundAmount - extraAmount
        : Math.floor(Number(walletNetAmount) || 0);

    if (resolvedNetWalletAmount >= 1000 && booking.userId) {
      const credited = await walletService.creditWallet(
        booking.userId,
        resolvedNetWalletAmount,
        'REFUND',
        description,
        {
          refSource: 'booking',
          refSourceId: booking._id,
          idempotencyKey: eventKey,
          session: mongoSession,
        }
      );
      walletTransactionId = credited.transaction?._id || null;
      payoutStatus = 'credited';
    } else if (resolvedNetWalletAmount <= -1000 && booking.userId) {
      const debited = await walletService.debitWallet(
        booking.userId,
        Math.abs(resolvedNetWalletAmount),
        description,
        {
          refSource: 'booking',
          refSourceId: booking._id,
          idempotencyKey: eventKey,
          session: mongoSession,
        }
      );
      walletTransactionId = debited.transaction?._id || null;
      payoutStatus = 'debited';
    } else if (resolvedNetWalletAmount !== 0) {
      payoutStatus = 'suppressed';
      suppressionReason = booking.userId
        ? 'below_wallet_transaction_minimum'
        : 'booking_has_no_wallet_owner';
    }

    if (applyState) {
      await applyState({ booking, session: mongoSession });
    }

    const settlement = {
      eventKey,
      eventType,
      refundAmount: calculation.refundAmount || 0,
      extraAmount: calculation.extraAmount || 0,
      netWalletAmount: resolvedNetWalletAmount,
      feeAmount: calculation.feeAmount || 0,
      refundableServiceAmount: calculation.refundableServiceAmount || 0,
      calculationVersion: calculation.calculationVersion || 'refund-engine-v1',
      payoutStatus,
      suppressionReason,
      walletTransactionId,
      settledAt: new Date(),
    };
    booking.refundSettlements.push(settlement);
    await booking.save({ session: mongoSession });
    if (!existingSession) await mongoSession.commitTransaction();

    return { booking, settlement, alreadyProcessed: false };
  } catch (error) {
    if (!existingSession) await mongoSession.abortTransaction();
    throw error;
  } finally {
    if (!existingSession) await mongoSession.endSession();
  }
};

module.exports = {
  getRefundEngineMode,
  getPaymentBreakdown,
  quoteCancellation,
  quoteEarlyCheckout,
  quoteNoShow,
  settleBookingEvent,
};
