const Service = require('../models/Service');
const UserVoucher = require('../models/UserVoucher');
const VoucherTemplate = require('../models/VoucherTemplate');
const notificationService = require('../services/notificationService');
const { broadcastNotification } = require('../sockets/notificationSocket');

const allowedFields = [
  'name',
  'description',
  'type',
  'pointCost',
  'discountPercent',
  'serviceId',
  'redemptionLimit',
  'isActive',
];

const pickUpdates = (body) => Object.fromEntries(
  allowedFields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]])
);

async function validateActiveService(template) {
  if (template.type !== 'FREE_SERVICE') return;
  const active = await Service.exists({ _id: template.serviceId, isActive: true });
  if (!active) {
    throw Object.assign(new Error('FREE_SERVICE requires an active service'), {
      statusCode: 400,
      code: 'VOUCHER_SERVICE_UNAVAILABLE',
    });
  }
}

async function notifyCustomersOfRelease(req, template) {
  const remainingText = template.redemptionLimit
    ? ` Only ${template.redemptionLimit} vouchers are available.`
    : '';
  const result = await notificationService.createForRole('customer', {
    title: `New reward: ${template.name}`,
    content: `${template.description || 'A new loyalty reward is now available.'}${remainingText}`,
    type: 'PROMOTION',
    priority: 'INFO',
    metadata: {
      deepLink: '/customer/rewards',
      voucherTemplateId: template._id,
      redemptionLimit: template.redemptionLimit,
    },
  }, req.user?._id || null);

  const io = req.app.get('io');
  if (io) broadcastNotification(io, result.notification, result.userIds);
  return result.userIds.length;
}

exports.listTemplates = async (_req, res, next) => {
  try {
    const templates = await VoucherTemplate.find()
      .populate('serviceId', 'name price timeCost isActive')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: templates });
  } catch (error) {
    next(error);
  }
};

exports.createTemplate = async (req, res, next) => {
  try {
    const template = new VoucherTemplate(pickUpdates(req.body));
    await template.validate();
    await validateActiveService(template);
    await template.save();
    await template.populate('serviceId', 'name price timeCost isActive');
    let notifiedCustomers = 0;
    let notificationWarning = null;
    if (req.body.notifyCustomers === true) {
      try {
        notifiedCustomers = await notifyCustomersOfRelease(req, template);
      } catch (notificationError) {
        notificationWarning = 'Voucher was created, but customer notifications could not be sent';
        console.error('[VoucherTemplate] Release notification failed:', notificationError.message);
      }
    }
    res.status(201).json({
      success: true,
      data: template,
      notification: { requested: req.body.notifyCustomers === true, sentTo: notifiedCustomers },
      ...(notificationWarning ? { warning: notificationWarning } : {}),
    });
  } catch (error) {
    next(error);
  }
};

exports.updateTemplate = async (req, res, next) => {
  try {
    const template = await VoucherTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: 'Voucher template not found' });
    Object.assign(template, pickUpdates(req.body));
    if (template.redemptionLimit !== null && template.redemptionLimit < template.redeemedCount) {
      return res.status(400).json({
        success: false,
        code: 'VOUCHER_LIMIT_BELOW_REDEEMED',
        message: `Redemption limit cannot be lower than ${template.redeemedCount}`,
      });
    }
    await template.validate();
    await validateActiveService(template);
    await template.save();
    await template.populate('serviceId', 'name price timeCost isActive');
    res.json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
};

exports.deactivateTemplate = async (req, res, next) => {
  try {
    const template = await VoucherTemplate.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: false } },
      { new: true, runValidators: true }
    );
    if (!template) return res.status(404).json({ success: false, message: 'Voucher template not found' });
    res.json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
};

exports.deleteTemplate = async (req, res, next) => {
  try {
    const template = await VoucherTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: 'Voucher template not found' });
    const activeVoucher = await UserVoucher.exists({ templateId: template._id, status: 'available' });
    if (activeVoucher) {
      return res.status(400).json({
        success: false,
        code: 'ACTIVE_VOUCHERS_EXIST',
        message: 'Cannot delete template with active vouchers',
      });
    }
    await template.deleteOne();
    res.json({ success: true, message: 'Voucher template deleted' });
  } catch (error) {
    next(error);
  }
};
