const mongoose = require('mongoose');
const LoyaltyAccount = require('../models/LoyaltyAccount');
const PointTransaction = require('../models/PointTransaction');
const VoucherTemplate = require('../models/VoucherTemplate');
const UserVoucher = require('../models/UserVoucher');
const notificationTriggers = require('./notificationTriggers');

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
      const loyaltyAccount = await LoyaltyAccount.findById(existing.loyaltyAccountId).session(mongoSession);
      return { loyaltyAccount, pointTransaction: existing, alreadyProcessed: true };
    }

    const account = await getOrCreateAccount(userId, mongoSession);
    const balanceBefore = account.balance;
    account.balance += points;
    await account.save({ session: mongoSession });

    const [pointTransaction] = await PointTransaction.create([{
      loyaltyAccountId: account._id,
      userId,
      type: 'EARN',
      amount: points,
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

    const account = await LoyaltyAccount.findOne({ userId }).session(mongoSession);
    if (!account) return null;
    const revokeAmount = Math.min(earnTransaction.amount, account.balance);
    const balanceBefore = account.balance;
    account.balance = Math.max(0, account.balance - revokeAmount);
    await account.save({ session: mongoSession });

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
      const template = await VoucherTemplate.findById(templateId).session(session);
      if (!template || !template.isActive) {
        throw businessError('Voucher template is not available', 400, 'VOUCHER_TEMPLATE_UNAVAILABLE');
      }

      const account = await LoyaltyAccount.findOneAndUpdate(
        { userId, balance: { $gte: template.pointCost } },
        { $inc: { balance: -template.pointCost } },
        { new: false, session }
      );
      if (!account) {
        throw businessError('Insufficient loyalty points', 400, 'INSUFFICIENT_LOYALTY_POINTS');
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
      const [pointTransaction] = await PointTransaction.create([{
        loyaltyAccountId: account._id,
        userId,
        type: 'REDEEM',
        amount: template.pointCost,
        balanceBefore: account.balance,
        balanceAfter,
        refSource: 'voucher',
        refSourceId: template._id,
      }], { session });

      account.balance = balanceAfter;
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
  runAtomic,
};
