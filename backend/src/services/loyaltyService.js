const mongoose = require('mongoose');
const LoyaltyAccount = require('../models/LoyaltyAccount');
const PointTransaction = require('../models/PointTransaction');
const VoucherTemplate = require('../models/VoucherTemplate');
const UserVoucher = require('../models/UserVoucher');
const notificationTriggers = require('./notificationTriggers');

const POINT_VALIDITY_DAYS = 30;
const POINT_VALIDITY_MS = POINT_VALIDITY_DAYS * 24 * 60 * 60 * 1000;

const businessError = (message, statusCode = 400, code) =>
  Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });

const calculateEarnedPoints = (amount) => {
  const normalized = Math.max(0, Number(amount) || 0);
  return Math.floor(normalized / 1000);
};

async function runAtomic(session, work) {
  if (session) return work(session);

  const ownSession = await mongoose.startSession();
  let result;
  try {
    await ownSession.withTransaction(async () => {
      result = await work(ownSession);
    });
    return result;
  } finally {
    await ownSession.endSession();
  }
}

async function getOrCreateAccount(userId, session) {
  return LoyaltyAccount.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId, balance: 0 } },
    { new: true, upsert: true, setDefaultsOnInsert: true, session }
  );
}

const consumeLots = (lots, amount) => {
  let remaining = Math.max(0, Number(amount) || 0);
  for (const lot of lots) {
    if (remaining <= 0) break;
    const consumed = Math.min(lot.remainingAmount, remaining);
    lot.remainingAmount -= consumed;
    remaining -= consumed;
  }
  return remaining;
};

async function backfillPointLots(account, session) {
  const missingLots = await PointTransaction.exists({
    loyaltyAccountId: account._id,
    type: 'EARN',
    $or: [
      { remainingAmount: null },
      { remainingAmount: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $exists: false } },
    ],
  }).session(session || null);
  if (!missingLots) return;

  const transactions = await PointTransaction.find({ loyaltyAccountId: account._id })
    .sort({ createdAt: 1, _id: 1 })
    .session(session || null)
    .lean();
  const lots = [];

  for (const transaction of transactions) {
    if (transaction.type === 'EARN') {
      const earnedAt = new Date(transaction.createdAt || Date.now());
      lots.push({
        _id: transaction._id,
        refSource: transaction.refSource,
        refSourceId: transaction.refSourceId?.toString?.() || null,
        remainingAmount: Number(transaction.amount) || 0,
        expiresAt: transaction.expiresAt || new Date(earnedAt.getTime() + POINT_VALIDITY_MS),
      });
      continue;
    }

    let amount = Number(transaction.amount) || 0;
    if (transaction.type === 'REVOKE' && transaction.refSourceId) {
      const sourceId = transaction.refSourceId.toString();
      const sourceLot = lots.find((lot) => lot.refSource === transaction.refSource
        && lot.refSourceId === sourceId);
      if (sourceLot) {
        const consumed = Math.min(sourceLot.remainingAmount, amount);
        sourceLot.remainingAmount -= consumed;
        amount -= consumed;
      }
    }
    if (['REDEEM', 'REVOKE', 'EXPIRE'].includes(transaction.type) && amount > 0) {
      consumeLots(lots, amount);
    }
  }

  const ledgerBalance = lots.reduce((total, lot) => total + lot.remainingAmount, 0);
  if (ledgerBalance > account.balance) {
    consumeLots(lots, ledgerBalance - account.balance);
  } else if (ledgerBalance < account.balance && lots.length) {
    lots[lots.length - 1].remainingAmount += account.balance - ledgerBalance;
  }

  if (lots.length) {
    await PointTransaction.bulkWrite(lots.map((lot) => ({
      updateOne: {
        filter: { _id: lot._id },
        update: { $set: { remainingAmount: lot.remainingAmount, expiresAt: lot.expiresAt } },
      },
    })), { session });
  }
}

async function expirePoints({ userId, session, now = new Date() }) {
  if (!userId) return null;
  return runAtomic(session, async (mongoSession) => {
    const account = await getOrCreateAccount(userId, mongoSession);
    await backfillPointLots(account, mongoSession);

    const expiredLots = await PointTransaction.find({
      loyaltyAccountId: account._id,
      type: 'EARN',
      remainingAmount: { $gt: 0 },
      expiresAt: { $lte: now },
    }).sort({ expiresAt: 1, createdAt: 1, _id: 1 }).session(mongoSession);

    if (!expiredLots.length) return { loyaltyAccount: account, expiredPoints: 0 };

    const lotTotal = expiredLots.reduce((total, lot) => total + lot.remainingAmount, 0);
    const expiredPoints = Math.min(lotTotal, account.balance);
    const balanceBefore = account.balance;
    account.balance = Math.max(0, balanceBefore - expiredPoints);
    await account.save({ session: mongoSession });

    await Promise.all(expiredLots.map((lot) => {
      lot.remainingAmount = 0;
      lot.expiredAt = now;
      return lot.save({ session: mongoSession });
    }));

    if (expiredPoints > 0) {
      await PointTransaction.create([{
        loyaltyAccountId: account._id,
        userId,
        type: 'EXPIRE',
        amount: expiredPoints,
        balanceBefore,
        balanceAfter: account.balance,
      }], { session: mongoSession });
    }
    return { loyaltyAccount: account, expiredPoints };
  });
}

async function expireAllPoints(now = new Date()) {
  const accounts = await LoyaltyAccount.find({ balance: { $gt: 0 } }).select('userId').lean();
  let expiredPoints = 0;
  for (const account of accounts) {
    const result = await expirePoints({ userId: account.userId, now });
    expiredPoints += result?.expiredPoints || 0;
  }
  return { accountsChecked: accounts.length, expiredPoints };
}

async function earnPoints({ userId, amount, refSource, refSourceId, session, app }) {
  const points = calculateEarnedPoints(amount);
  if (!userId || points === 0) return null;

  const result = await runAtomic(session, async (mongoSession) => {
    const existing = await PointTransaction.findOne({
      userId,
      type: 'EARN',
      refSource,
      refSourceId,
    }).session(mongoSession);
    if (existing) {
      const expiry = await expirePoints({ userId, session: mongoSession });
      const loyaltyAccount = expiry.loyaltyAccount;
      return { loyaltyAccount, pointTransaction: existing, alreadyProcessed: true };
    }

    const expiry = await expirePoints({ userId, session: mongoSession });
    const account = expiry.loyaltyAccount;
    const balanceBefore = account.balance;
    account.balance += points;
    await account.save({ session: mongoSession });

    const [pointTransaction] = await PointTransaction.create([{
      loyaltyAccountId: account._id,
      userId,
      type: 'EARN',
      amount: points,
      remainingAmount: points,
      expiresAt: new Date(Date.now() + POINT_VALIDITY_MS),
      balanceBefore,
      balanceAfter: account.balance,
      refSource,
      refSourceId,
    }], { session: mongoSession });

    return { loyaltyAccount: account, pointTransaction, alreadyProcessed: false };
  });

  if (app && result && !result.alreadyProcessed) {
    notificationTriggers.notifyLoyaltyPointsEarned(app, userId, {
      points: result.pointTransaction.amount,
      balance: result.loyaltyAccount.balance,
      refSource,
      refSourceId,
    });
  }

  return result;
}

async function revokePoints({ userId, refSource, refSourceId, session }) {
  if (!userId || !refSourceId) return null;

  return runAtomic(session, async (mongoSession) => {
    const expiry = await expirePoints({ userId, session: mongoSession });
    const earnTransaction = await PointTransaction.findOne({
      userId,
      type: 'EARN',
      refSource,
      refSourceId,
    }).session(mongoSession);
    if (!earnTransaction) return null;

    const existing = await PointTransaction.findOne({
      userId,
      type: 'REVOKE',
      refSource,
      refSourceId,
    }).session(mongoSession);
    if (existing) {
      const loyaltyAccount = await LoyaltyAccount.findById(existing.loyaltyAccountId).session(mongoSession);
      return { loyaltyAccount, pointTransaction: existing, alreadyProcessed: true };
    }

    const account = expiry.loyaltyAccount;
    if (!account) return null;
    const revokeAmount = Math.min(earnTransaction.remainingAmount || 0, account.balance);
    const balanceBefore = account.balance;
    account.balance = Math.max(0, account.balance - revokeAmount);
    await account.save({ session: mongoSession });
    earnTransaction.remainingAmount = Math.max(0, (earnTransaction.remainingAmount || 0) - revokeAmount);
    await earnTransaction.save({ session: mongoSession });

    const [pointTransaction] = await PointTransaction.create([{
      loyaltyAccountId: account._id,
      userId,
      type: 'REVOKE',
      amount: revokeAmount,
      balanceBefore,
      balanceAfter: account.balance,
      refSource,
      refSourceId,
    }], { session: mongoSession });

    return { loyaltyAccount: account, pointTransaction, alreadyProcessed: false };
  });
}

async function redeemPoints({ userId, templateId }) {
  try {
    return await runAtomic(null, async (session) => {
      const template = await VoucherTemplate.findOneAndUpdate(
        {
          _id: templateId,
          isActive: true,
          $or: [
            { redemptionLimit: null },
            { redemptionLimit: { $exists: false } },
            { $expr: { $lt: [{ $ifNull: ['$redeemedCount', 0] }, '$redemptionLimit'] } },
          ],
        },
        { $inc: { redeemedCount: 1 } },
        { new: true, session }
      );
      if (!template) {
        const existingTemplate = await VoucherTemplate.findById(templateId).session(session);
        if (existingTemplate?.isActive
          && existingTemplate.redemptionLimit !== null
          && Number(existingTemplate.redeemedCount || 0) >= existingTemplate.redemptionLimit) {
          throw businessError('This limited voucher is sold out', 409, 'VOUCHER_SOLD_OUT');
        }
        throw businessError('Voucher template is not available', 400, 'VOUCHER_TEMPLATE_UNAVAILABLE');
      }

      const expiry = await expirePoints({ userId, session });
      const account = expiry.loyaltyAccount;
      if (!account || account.balance < template.pointCost) {
        throw businessError('Insufficient loyalty points', 400, 'INSUFFICIENT_LOYALTY_POINTS');
      }

      const now = new Date();
      const lots = await PointTransaction.find({
        loyaltyAccountId: account._id,
        type: 'EARN',
        remainingAmount: { $gt: 0 },
        expiresAt: { $gt: now },
      }).sort({ expiresAt: 1, createdAt: 1, _id: 1 }).session(session);
      const availableInLots = lots.reduce((total, lot) => total + lot.remainingAmount, 0);
      if (availableInLots < template.pointCost) {
        throw businessError('Insufficient unexpired loyalty points', 400, 'INSUFFICIENT_LOYALTY_POINTS');
      }
      let remainingCost = template.pointCost;
      for (const lot of lots) {
        if (remainingCost <= 0) break;
        const consumed = Math.min(lot.remainingAmount, remainingCost);
        lot.remainingAmount -= consumed;
        remainingCost -= consumed;
        await lot.save({ session });
      }

      const redeemedAt = new Date();
      const [userVoucher] = await UserVoucher.create([{
        userId,
        templateId: template._id,
        benefitSnapshot: {
          name: template.name,
          description: template.description || '',
          type: template.type,
          pointCost: template.pointCost,
          discountPercent: template.discountPercent,
          serviceId: template.serviceId,
        },
        status: 'available',
        redeemedAt,
        expiresAt: new Date(redeemedAt.getTime() + UserVoucher.THIRTY_DAYS_MS),
      }], { session });

      const balanceAfter = account.balance - template.pointCost;
      const balanceBefore = account.balance;
      account.balance = balanceAfter;
      await account.save({ session });
      const [pointTransaction] = await PointTransaction.create([{
        loyaltyAccountId: account._id,
        userId,
        type: 'REDEEM',
        amount: template.pointCost,
        balanceBefore,
        balanceAfter,
        refSource: 'voucher',
        refSourceId: template._id,
      }], { session });

      return { loyaltyAccount: account, userVoucher, pointTransaction };
    });
  } catch (error) {
    if (error.statusCode) throw error;
    throw businessError('Redemption failed, please try again', 500, 'LOYALTY_REDEMPTION_FAILED');
  }
}

module.exports = {
  calculateEarnedPoints,
  earnPoints,
  redeemPoints,
  revokePoints,
  expirePoints,
  expireAllPoints,
  runAtomic,
  POINT_VALIDITY_DAYS,
  POINT_VALIDITY_MS,
};
