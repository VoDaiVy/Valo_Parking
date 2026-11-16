const WalletTransaction = require('../models/WalletTransaction');

const toAmount = (value) => Math.max(0, Number(value) || 0);

const calculateBookingFinancialSummary = (booking, walletRefundPaid = 0) => {
  const prepaidCollected = toAmount(booking?.prepaidAmount);
  const overageCollected = (booking?.paidOverageAdjustments || []).reduce(
    (sum, adjustment) => sum + toAmount(adjustment?.amount),
    0
  );
  const settlementExtraCollected = (booking?.refundSettlements || []).reduce(
    (sum, settlement) =>
      settlement?.payoutStatus === 'debited'
        ? sum + Math.abs(Number(settlement?.netWalletAmount) || 0)
        : sum,
    0
  );
  const settlementRefundPaid = (booking?.refundSettlements || []).reduce(
    (sum, settlement) =>
      settlement?.payoutStatus === 'credited'
        ? sum + toAmount(settlement?.netWalletAmount)
        : sum,
    0
  );
  const additionalCollected = overageCollected + settlementExtraCollected;
  const grossRevenue = prepaidCollected + additionalCollected;
  const refundPaid = toAmount(walletRefundPaid) || settlementRefundPaid;

  return {
    prepaidCollected,
    overageCollected,
    settlementExtraCollected,
    additionalCollected,
    grossRevenue,
    refundPaid,
    actualRevenue: grossRevenue - refundPaid,
  };
};

const getBookingFinancialSummaryMap = async (bookings = [], { excludeModificationRefunds = false } = {}) => {
  const bookingIds = bookings.map((booking) => booking?._id).filter(Boolean);
  if (!bookingIds.length) return new Map();

  const refundRows = await WalletTransaction.aggregate([
    {
      $match: {
        refSource: 'booking',
        refSourceId: { $in: bookingIds },
        type: 'REFUND',
        status: 'COMPLETED',
      },
    },
    {
      $group: {
        _id: '$refSourceId',
        amount: { $sum: '$amount' },
        modificationRefund: { $sum: { $cond: [
          { $regexMatch: { input: { $ifNull: ['$idempotencyKey', ''] }, regex: ':modification:' } }, '$amount', 0,
        ] } },
      },
    },
  ]);
  const refundByBookingId = new Map(refundRows.map(row => [String(row._id), row]));
  return new Map(bookings.map(booking => {
    const refunds = refundByBookingId.get(String(booking._id));
    const allRefunds = Number(refunds?.amount) || 0;
    const modificationRefund = excludeModificationRefunds ? Number(refunds?.modificationRefund) || 0 : 0;
    const financial = calculateBookingFinancialSummary(booking, allRefunds - modificationRefund);
    if (excludeModificationRefunds) financial.reportedRefundPaid = allRefunds || financial.refundPaid;
    return [String(booking._id), financial];
  }));
};

module.exports = {
  calculateBookingFinancialSummary,
  getBookingFinancialSummaryMap,
};
