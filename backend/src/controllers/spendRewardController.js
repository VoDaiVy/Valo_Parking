const service = require('../services/spendRewardService');
const Month = require('../models/SpendRewardMonth');
const UserVoucher = require('../models/UserVoucher');
const EmailJob = require('../models/RewardEmailJob');
const { monthOf } = require('../services/spendRewardRules');
const { validateVoucherExpiryChange } = require('../services/voucherService');
const autoAndManual = { source: { $in: ['spending', 'welcome', 'manual'] } };
async function getTierUsage(month) {
  const counts = await UserVoucher.aggregate([
    { $match: { source: 'spending', rewardMonth: month } },
    { $group: { _id: '$rewardThreshold', issued: { $sum: 1 } } },
  ]);
  return Object.fromEntries(counts.map(({ _id, issued }) => [_id, issued]));
}
const endpoint = (work) => async (req, res, next) => {
  try { res.json({ success: true, data: await work(req) }); } catch (error) { next(error); }
};
exports.getProgram = endpoint(async () => {
  const program = await service.getProgram();
  const month = monthOf(new Date());
  const tierUsage = await getTierUsage(month);
  const issued = await UserVoucher.countDocuments(autoAndManual);
  const used = await UserVoucher.countDocuments({ ...autoAndManual, status: 'used' });
  const available = await UserVoucher.countDocuments({ ...autoAndManual, status: 'available', expiresAt: { $gt: new Date() }, usedAt: null });
  const expired = await UserVoucher.countDocuments({ ...autoAndManual, status: 'expired' });
  const pendingEmails = await EmailJob.countDocuments({ status: { $in: ['pending', 'sending'] } });
  const retryingEmails = await EmailJob.countDocuments({ status: 'pending', attempts: { $gt: 0 } });
  const vouchers = await UserVoucher.find(autoAndManual)
    .populate('userId', 'username email').sort({ redeemedAt: -1 }).limit(100).lean();
  return { program, month, tierUsage, stats: { issued, used, available, expired, pendingEmails, retryingEmails }, vouchers };
});

exports.updateVoucherExpiry = endpoint(async (req) => {
  const raw = req.body?.expiresAt;
  const current = await UserVoucher.findById(req.params.voucherId);
  if (!current) throw Object.assign(new Error('Voucher not found'), { statusCode: 404 });
  const expiresAt = validateVoucherExpiryChange(current, raw);
  const changedAt = new Date();
  if (!raw || Number.isNaN(expiresAt.getTime())) throw Object.assign(new Error('Ngày hết hạn không hợp lệ'), { statusCode: 400 });
  if (expiresAt <= new Date()) throw Object.assign(new Error('Ngày hết hạn phải ở tương lai'), { statusCode: 400 });
  const voucher = await UserVoucher.findOneAndUpdate(
    { _id: current._id, expiresAt: current.expiresAt, status: { $in: ['available', 'expired'] }, usedAt: null, bookingId: null },
    { $set: { expiresAt, status: 'available' }, $inc: { expiryChangeCount: 1 }, $push: { expiryHistory: { $each: [{ from: current.expiresAt, to: expiresAt, changedAt, changedBy: req.user._id }], $slice: -20 } } }, { new: true, runValidators: true },
  ).populate('userId', 'username email');
  if (!voucher) throw Object.assign(new Error('Chỉ voucher chưa dùng hoặc đã hết hạn mới được chỉnh sửa'), { statusCode: 400 });
  return voucher;
});
exports.saveProgram = endpoint((req) => service.saveProgram(req.body));
exports.searchRecipients = endpoint(async (req) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 2 || query.length > 100) throw Object.assign(new Error('Search must contain 2 to 100 characters'), { statusCode: 400 });
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return require('../models/User').find({ role: 'customer', status: true,
    $or: [{ username: { $regex: escaped, $options: 'i' } }, { email: { $regex: escaped, $options: 'i' } }],
  }).select('_id username email role').sort({ username: 1 }).limit(20).lean();
});
exports.getProgress = endpoint(async (req) => {
  const program = await service.getProgram();
  const month = monthOf(new Date());
  const state = await Month.findOne({ userId: req.user._id, month }).lean();
  const tierUsage = program.tiers.some((tier) => tier.recipientLimit != null) ? await getTierUsage(month) : {};
  const tiers = program.tiers.map((tier) => ({
    ...tier.toObject(),
    remainingRecipients: tier.recipientLimit == null ? null : Math.max(0, tier.recipientLimit - (tierUsage[tier.threshold] || 0)),
  }));
  return { month, total: state?.total || 0, highestAwardedThreshold: state?.highestAwardedThreshold || 0, enabled: program.enabled, tiers, validityDays: program.validityDays || 7 };
});
exports.getLeaderboard = endpoint((req) => require('../services/quarterlyLeaderboardService').getLeaderboard({
  quarter: req.query.quarter,
}));
exports.distribute = endpoint((req) => require('../services/voucherDistributionService').distribute({
  templateId: req.params.id, userIds: req.body?.userIds, requestId: req.body?.requestId, expiresAt: req.body?.expiresAt, createdBy: req.user._id, app: req.app,
}));
