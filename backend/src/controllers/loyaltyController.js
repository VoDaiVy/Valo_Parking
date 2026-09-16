const LoyaltyAccount = require('../models/LoyaltyAccount');
const PointTransaction = require('../models/PointTransaction');
const UserVoucher = require('../models/UserVoucher');
const VoucherTemplate = require('../models/VoucherTemplate');
const loyaltyService = require('../services/loyaltyService');

const pagination = (query) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

exports.getAccount = async (req, res, next) => {
  try {
    const { page, limit, skip } = pagination(req.query);
    const account = await LoyaltyAccount.findOneAndUpdate(
      { userId: req.user._id },
      { $setOnInsert: { userId: req.user._id, balance: 0 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    const [transactions, total] = await Promise.all([
      PointTransaction.find({ loyaltyAccountId: account._id })
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PointTransaction.countDocuments({ loyaltyAccountId: account._id }),
    ]);

    res.json({
      success: true,
      data: {
        account,
        transactions,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.listTemplates = async (_req, res, next) => {
  try {
    const templates = await VoucherTemplate.find({ isActive: true })
      .populate('serviceId', 'name description price timeCost imageUrl isActive')
      .sort({ pointCost: 1, createdAt: -1 })
      .lean();
    res.json({ success: true, data: templates });
  } catch (error) {
    next(error);
  }
};

exports.redeemVoucher = async (req, res, next) => {
  try {
    if (!req.body.templateId) {
      return res.status(400).json({ success: false, message: 'templateId is required' });
    }
    const result = await loyaltyService.redeemPoints({
      userId: req.user._id,
      templateId: req.body.templateId,
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.getVouchers = async (req, res, next) => {
  try {
    await UserVoucher.updateMany(
      { userId: req.user._id, status: 'available', expiresAt: { $lte: new Date() } },
      { $set: { status: 'expired' } }
    );
    const filter = { userId: req.user._id };
    if (req.query.status) {
      if (!['available', 'used', 'expired'].includes(req.query.status)) {
        return res.status(400).json({ success: false, message: 'Invalid voucher status' });
      }
      filter.status = req.query.status;
    }
    const vouchers = await UserVoucher.find(filter)
      .populate('templateId', 'name type isActive')
      .populate('benefitSnapshot.serviceId', 'name description price timeCost imageUrl isActive')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: vouchers });
  } catch (error) {
    next(error);
  }
};
