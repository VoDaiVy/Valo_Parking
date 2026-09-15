const { randomUUID } = require('crypto');
const WalletTransaction = require('../../models/WalletTransaction');
const Booking = require('../../models/Booking');
const AIMonitorLease = require('../../models/AIMonitorLease');
const { insertEvent } = require('./notificationEvents');

const INTERVAL_MS = 60000;
const OVERLAP_MS = 15 * 60000;

async function processRefundTransaction(transaction, booking, app) {
  if (transaction?.type !== 'REFUND' || transaction.status !== 'COMPLETED' || transaction.refSource !== 'booking') return false;
  const credited = booking?.refundSettlements?.some((settlement) =>
    settlement.payoutStatus === 'credited' && String(settlement.walletTransactionId) === String(transaction._id)
  );
  if (!credited) return false;
  return insertEvent({
    app, deduplicationKey: `refund-completed:${transaction._id}`,
    notificationType: 'REFUND_COMPLETED', severity: 'NOTICE',
    title: 'Đã phát sinh giao dịch hoàn tiền',
    summary: `Đã hoàn ${Number(transaction.amount).toLocaleString('vi-VN')} đ cho booking ${transaction.refSourceId}.`,
    entityType: 'walletTransaction', entityId: transaction._id,
    targetRoute: '/admin/revenue',
    evidence: { bookingId: transaction.refSourceId, transactionId: transaction._id, amount: transaction.amount },
    sourceModules: ['WalletTransaction', 'Booking'], detectedAt: transaction.createdAt,
  });
}

async function runRefundMonitorNow({ app, since, now = new Date() } = {}) {
  const transactions = await WalletTransaction.find({
    type: 'REFUND', status: 'COMPLETED', refSource: 'booking',
    createdAt: { $gte: since, $lte: now },
  }).select('_id type status refSource refSourceId amount createdAt').sort({ createdAt: 1 }).lean();
  for (const transaction of transactions) {
    const booking = await Booking.findById(transaction.refSourceId).select('refundSettlements').lean();
    await processRefundTransaction(transaction, booking, app);
  }
  return transactions.length;
}

let timer;
function startRefundMonitor(app) {
  if (timer) return;
  const tick = async () => {
    const owner = randomUUID();
    try {
      const now = new Date();
      const baseline = await AIMonitorLease.findOneAndUpdate(
        { _id: 'refund-completed' },
        { $setOnInsert: { startedAt: now, cursorAt: now } },
        { upsert: true, new: true }
      );
      const lease = await AIMonitorLease.findOneAndUpdate(
        { _id: 'refund-completed', $or: [{ until: { $lt: now } }, { until: { $exists: false } }] },
        { $set: { owner, until: new Date(now.getTime() + 90000) } },
        { upsert: true, new: true }
      );
      if (lease?.owner !== owner) return;
      try {
        const since = new Date(Math.max(
          baseline.startedAt.getTime(), baseline.cursorAt.getTime() - OVERLAP_MS
        ));
        await runRefundMonitorNow({ app, since, now });
        await AIMonitorLease.updateOne({ _id: 'refund-completed', owner }, { $set: { cursorAt: now } });
      } finally {
        await AIMonitorLease.updateOne({ _id: 'refund-completed', owner }, { $set: { until: new Date(0) } });
      }
    } catch (error) {
      if (error.code !== 11000) console.error('[VALO AI Refund Monitor]', error);
    }
  };
  tick();
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();
}

module.exports = { processRefundTransaction, runRefundMonitorNow, startRefundMonitor };
