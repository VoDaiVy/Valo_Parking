const Program = require('../models/SpendRewardProgram');
const User = require('../models/User');
const UserVoucher = require('../models/UserVoucher');
const Notification = require('../models/Notification');
const UserNotification = require('../models/UserNotification');
const EmailJob = require('../models/RewardEmailJob');

// Called within the verified contact transaction after locking the user's profile.
async function issueWelcomeVoucher(userId, session, now = new Date()) {
  const program = await Program.findById('monthly').session(session);
  if (program?.welcomeEnabled === false) return null;
  const rewardKey = `welcome:${userId}`;
  if (!await User.exists({ _id: userId, role: 'customer', status: true }).session(session) ||
      await UserVoucher.exists({ rewardKey }).session(session)) return null;

  const expiresAt = new Date(now.getTime() + (program?.welcomeValidityDays ?? 30) * 86400000);
  const [voucher] = await UserVoucher.create([{
    userId, source: 'welcome', rewardKey, redeemedAt: now, expiresAt,
    benefitSnapshot: { name: 'WELCOME', type: 'FIXED_DISCOUNT', pointCost: 0, discountAmount: 3000, minimumAmount: 3000 },
  }], { session });
  const [notification] = await Notification.create([{
    title: 'Bạn đã nhận voucher WELCOME',
    content: 'Số điện thoại đã được xác minh. Voucher giảm 3.000 đồng có trong mục Ưu đãi.',
    type: 'PROMOTION', priority: 'SUCCESS', targetType: 'SINGLE_USER', targetUsers: [userId], recipientCount: 1,
    metadata: { voucherId: String(voucher._id), rewardKey, deepLink: '/customer/rewards', expiresAt },
  }], { session });
  await UserNotification.create([{ userId, notificationId: notification._id }], { session });
  await EmailJob.create([{ voucherId: voucher._id, nextAttemptAt: now }], { session });
  return voucher;
}

module.exports = { issueWelcomeVoucher };
