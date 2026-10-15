const service = require('../services/spendRewardService');
const Month = require('../models/SpendRewardMonth');
const UserVoucher = require('../models/UserVoucher');
const EmailJob = require('../models/RewardEmailJob');
const { monthOf } = require('../services/spendRewardRules');
const endpoint = (work) => async (req, res, next) => {
  try { res.json({ success: true, data: await work(req) }); } catch (error) { next(error); }
};
exports.getProgram = endpoint(async () => {
  const program = await service.getProgram();
  const issued = await UserVoucher.countDocuments({ source: { $in: ['spending', 'manual'] } });
  const used = await UserVoucher.countDocuments({ source: { $in: ['spending', 'manual'] }, status: 'used' });
  const pendingEmails = await EmailJob.countDocuments({ status: { $in: ['pending', 'sending'] } });
  const retryingEmails = await EmailJob.countDocuments({ status: 'pending', attempts: { $gt: 0 } });
  const vouchers = await UserVoucher.find({ source: { $in: ['spending', 'manual'] } })
    .populate('userId', 'username email').sort({ redeemedAt: -1 }).limit(100).lean();
  return { program, stats: { issued, used, pendingEmails, retryingEmails }, vouchers };
});

exports.updateVoucherExpiry = endpoint(async (req) => {
  const raw = req.body?.expiresAt;
  const expiresAt = raw instanceof Date ? raw : new Date(raw);
  if (!raw || Number.isNaN(expiresAt.getTime())) throw Object.assign(new Error('Ngày hết hạn không hợp lệ'), { statusCode: 400 });
  if (expiresAt <= new Date()) throw Object.assign(new Error('Ngày hết hạn phải ở tương lai'), { statusCode: 400 });
  const voucher = await UserVoucher.findOneAndUpdate(
    { _id: req.params.voucherId, status: { $in: ['available', 'expired'] } },
    { $set: { expiresAt, status: 'available' } }, { new: true, runValidators: true },
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
  return { month, total: state?.total || 0, highestAwardedThreshold: state?.highestAwardedThreshold || 0, enabled: program.enabled, tiers: program.tiers, validityDays: program.validityDays || 7 };
});
exports.getLeaderboard = endpoint((req) => require('../services/quarterlyLeaderboardService').getLeaderboard({
  quarter: req.query.quarter,
}));
exports.distribute = endpoint((req) => require('../services/voucherDistributionService').distribute({
  templateId: req.params.id, userIds: req.body?.userIds, requestId: req.body?.requestId, expiresAt: req.body?.expiresAt, createdBy: req.user._id, app: req.app,
}));
