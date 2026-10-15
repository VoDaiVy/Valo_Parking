const Service = require('../models/Service');
const UserVoucher = require('../models/UserVoucher');
const VoucherTemplate = require('../models/VoucherTemplate');

const allowedFields = [
  'name',
  'description',
  'type',
  'discountAmount',
  'minimumAmount',
  'discountPercent',
  'serviceId',
  'redemptionLimit',
  'isActive',
];

const pickUpdates = (body) => Object.fromEntries(
  allowedFields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]])
);

function validateInput(body) {
  const fail = (message) => { throw Object.assign(new Error(message), { statusCode: 400 }); };
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Invalid voucher data');
  for (const key of ['discountAmount', 'minimumAmount', 'discountPercent', 'redemptionLimit']) {
    if (body[key] !== undefined && body[key] !== null && (!Number.isSafeInteger(body[key]) || body[key] < 0 || body[key] > 1000000000)) fail(`${key} must be a non-negative whole number`);
  }
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') fail('isActive must be a boolean');
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120)) fail('Voucher name must contain 1 to 120 characters');
  if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 500)) fail('Description must not exceed 500 characters');
}

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
    validateInput(req.body);
    const template = new VoucherTemplate({ ...pickUpdates(req.body), pointCost: 0 });
    await template.validate();
    await validateActiveService(template);
    await template.save();
    await template.populate('serviceId', 'name price timeCost isActive');
    res.status(201).json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
};

exports.updateTemplate = async (req, res, next) => {
  try {
    validateInput(req.body);
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
