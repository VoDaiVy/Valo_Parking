const mongoose = require('mongoose');
const User = require('../models/User');
const VoucherTemplate = require('../models/VoucherTemplate');
const UserVoucher = require('../models/UserVoucher');
const Distribution = require('../models/VoucherDistribution');
const Notification = require('../models/Notification');
const UserNotification = require('../models/UserNotification');
const EmailJob = require('../models/RewardEmailJob');
const Service = require('../models/Service');
const { WEEK_MS } = require('./spendRewardRules');
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };

async function distribute({ templateId, userIds, requestId, createdBy, app, expiresAt }, now = new Date()) {
  if (!mongoose.isValidObjectId(templateId) || !mongoose.isValidObjectId(createdBy)) fail('Invalid template or admin');
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) fail('A valid requestId is required');
  if (!Array.isArray(userIds) || !userIds.length || userIds.length > 100 || userIds.some((id) => !mongoose.isValidObjectId(id))) fail('Choose between 1 and 100 valid recipients');
  const ids = [...new Set(userIds.map(String))].sort();
  const expiry = expiresAt ? new Date(expiresAt) : new Date(now.getTime() + WEEK_MS);
  if (Number.isNaN(expiry.getTime()) || expiry <= now) fail('Ngày hết hạn phải là thời điểm hợp lệ trong tương lai');
  const checkReplay = (existing) => {
    if (String(existing.templateId) !== String(templateId) || String(existing.createdBy) !== String(createdBy)
      || JSON.stringify(existing.userIds.map(String).sort()) !== JSON.stringify(ids)) fail('requestId is already used for a different distribution', 409);
    return existing;
  };
  const session = await mongoose.startSession();
  let result;
  let issuedNotifications = [];
  try {
    await session.withTransaction(async () => {
      issuedNotifications = [];
      const existing = await Distribution.findOne({ requestId }).session(session);
      if (existing) { result = checkReplay(existing); return; }
      const recipients = await User.find({ _id: { $in: ids }, role: 'customer', status: true }).session(session);
      if (recipients.length !== ids.length) fail('Every recipient must be an active customer');
      const template = await VoucherTemplate.findOne({ _id: templateId, isActive: true }).session(session);
      if (!template) fail('Voucher template is inactive or missing', 404);
      await template.validate();
      if (template.type === 'FREE_SERVICE' && !await Service.exists({ _id: template.serviceId, isActive: true }).session(session)) fail('Voucher service is unavailable');
      if (template.redemptionLimit != null && template.redeemedCount + ids.length > template.redemptionLimit) fail('Not enough vouchers remain for these recipients', 409);
      template.redeemedCount += ids.length;
      await template.save({ session });
      [result] = await Distribution.create([{ requestId, templateId, createdBy, userIds: ids }], { session });
      for (const userId of ids) {
        const [voucher] = await UserVoucher.create([{
          userId, templateId, source: 'manual', rewardKey: `manual:${requestId}:${userId}`,
          benefitSnapshot: { name: template.name, description: template.description, type: template.type,
            pointCost: 0, discountPercent: template.discountPercent, discountAmount: template.discountAmount,
            minimumAmount: template.minimumAmount, serviceId: template.serviceId },
          redeemedAt: now, expiresAt: expiry,
        }], { session });
        const [notification] = await Notification.create([{
          title: 'You received a voucher', content: `${template.name}. Valid until ${expiry.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}. Check My vouchers for conditions.`,
          type: 'PROMOTION', priority: 'SUCCESS', targetType: 'SINGLE_USER', targetUsers: [userId], recipientCount: 1, createdBy,
          metadata: { voucherId: String(voucher._id), deepLink: '/customer/rewards', expiresAt: voucher.expiresAt },
        }], { session });
        await UserNotification.create([{ userId, notificationId: notification._id }], { session });
        issuedNotifications.push(notification);
        await EmailJob.create([{ voucherId: voucher._id, nextAttemptAt: now }], { session });
      }
    });
    require('./rewardNotificationDelivery').publishNotifications(app, issuedNotifications);
    return result;
  } catch (error) {
    if (error.code === 11000) {
      const existing = await Distribution.findOne({ requestId });
      if (existing) return checkReplay(existing);
    }
    throw error;
  } finally { await session.endSession(); }
}
module.exports = { distribute };
