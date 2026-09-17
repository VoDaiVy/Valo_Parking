const mongoose = require('mongoose');
const DynamicPricingConfig = require('../models/DynamicPricingConfig');
const PricingRule = require('../models/PricingRule');
const PricingSuggestion = require('../models/PricingSuggestion');
const PriceHistory = require('../models/PriceHistory');
const TicketPackage = require('../models/TicketPackage');
const dynamicPricingEngine = require('../services/dynamicPricingEngine');

const configFields = [
  'pricingMode',
  'isEnabled',
  'triggerThreshold',
  'rejectionCooldownMinutes',
  'suggestionExpiryMinutes',
  'forecastHorizonHours',
  'earlyBookingPromotion',
];

const validationMessage = (error) => Object.values(error.errors || {})
  .map((item) => item.message)
  .join('; ') || error.message;

const sendControllerError = (res, error) => {
  if (error?.name === 'ValidationError' || error?.name === 'CastError') {
    return res.status(400).json({ success: false, message: validationMessage(error) });
  }
  console.error('[DynamicPricing] Controller error:', error);
  return res.status(500).json({ success: false, message: 'Dynamic pricing request failed' });
};

const historyPriceType = (rule) => (rule.priceType === 'package' ? 'package' : 'hourly');

async function recordRuleChange({ rule, oldMultiplier, newMultiplier, userId }) {
  const config = await dynamicPricingEngine.getActiveConfig();
  const score = Number(config.lastEvaluatedScore) || 0;
  return PriceHistory.create({
    priceType: historyPriceType(rule),
    packageId: rule.priceType === 'package' ? rule.packageId : null,
    oldPrice: oldMultiplier,
    newPrice: newMultiplier,
    busynessScore: score,
    level: dynamicPricingEngine.levelForScore(score),
    appliedRuleId: rule._id,
    adjustmentType: 'manual',
    performedBy: userId,
  });
}

exports.getConfig = async (_req, res) => {
  try {
    const config = await dynamicPricingEngine.getActiveConfig({ create: true });
    return res.json({ success: true, data: config });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

exports.updateConfig = async (req, res) => {
  try {
    const updates = {};
    configFields.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });
    if (updates.pricingMode && !['manual', 'semi-auto', 'auto'].includes(updates.pricingMode)) {
      return res.status(400).json({
        success: false,
        message: 'pricingMode must be one of: manual, semi-auto, auto',
      });
    }
    updates.updatedBy = req.user._id;
    if (updates.pricingMode === 'manual') updates.consecutiveFailures = 0;

    const config = await DynamicPricingConfig.findOneAndUpdate(
      { isActive: true },
      { $set: updates, $setOnInsert: { isActive: true } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    return res.json({ success: true, data: config });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

exports.getRules = async (req, res) => {
  try {
    const query = {};
    if (req.query.priceType) query.priceType = req.query.priceType;
    if (req.query.packageId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.packageId)) {
        return res.status(400).json({ success: false, message: 'packageId must be a valid ObjectId' });
      }
      query.packageId = req.query.packageId;
    }
    const rules = await PricingRule.find(query).sort({ minScore: 1, createdAt: -1 });
    return res.json({ success: true, data: rules });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

exports.createRule = async (req, res) => {
  try {
    const rule = await PricingRule.create({ ...req.body, createdBy: req.user._id });
    return res.status(201).json({ success: true, data: rule });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

exports.updateRule = async (req, res) => {
  try {
    const rule = await PricingRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ success: false, message: 'Pricing rule not found' });
    const oldMultiplier = rule.multiplier;
    const allowed = ['label', 'minScore', 'maxScore', 'multiplier', 'priceType', 'packageId', 'isActive'];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) rule[field] = req.body[field];
    });
    await rule.save();
    await recordRuleChange({ rule, oldMultiplier, newMultiplier: rule.multiplier, userId: req.user._id });
    return res.json({ success: true, data: rule });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

exports.deleteRule = async (req, res) => {
  try {
    const rule = await PricingRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ success: false, message: 'Pricing rule not found' });
    await recordRuleChange({ rule, oldMultiplier: rule.multiplier, newMultiplier: 1, userId: req.user._id });
    await rule.deleteOne();
    return res.json({ success: true, message: 'Pricing rule deleted' });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

function validateCurrentQuery(query) {
  if (query.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
      return 'date must use YYYY-MM-DD format';
    }
    const parsed = new Date(`${query.date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== query.date) {
      return 'date must be a valid calendar date in YYYY-MM-DD format';
    }
  }
  if (query.hour !== undefined && (!/^\d{1,2}$/.test(String(query.hour))
      || Number(query.hour) < 0 || Number(query.hour) > 23)) {
    return 'hour must be an integer from 0 to 23';
  }
  if (query.floorId !== undefined && !mongoose.Types.ObjectId.isValid(query.floorId)) {
    return 'floorId must be a valid ObjectId';
  }
  if (query.durationMinutes !== undefined && (!/^\d+$/.test(String(query.durationMinutes))
      || Number(query.durationMinutes) <= 0)) {
    return 'durationMinutes must be a positive integer';
  }
  return null;
}

const withPriceLabel = (price) => ({
  ...price,
  ...(price.adjustedPrice < price.basePrice ? { priceLabel: 'Giá ưu đãi' } : {}),
  ...(price.adjustedPrice > price.basePrice ? { priceLabel: 'Giá cao điểm' } : {}),
});

exports.getCurrentPricing = async (req, res) => {
  const invalid = validateCurrentQuery(req.query);
  if (invalid) return res.status(400).json({ success: false, message: invalid });
  try {
    const options = {
      date: req.query.date,
      hour: req.query.hour === undefined ? undefined : Number(req.query.hour),
      floorId: req.query.floorId,
      durationMinutes: req.query.durationMinutes === undefined ? undefined : Number(req.query.durationMinutes),
    };
    const packages = await TicketPackage.find({ isActive: true }).lean();
    const hourly = await dynamicPricingEngine.getEffectivePrice({ ...options, priceType: 'hourly' });
    const sharedForecast = hourly.busynessScore === null
      ? {}
      : { busynessScore: hourly.busynessScore, level: hourly.level };
    const packagePrices = await Promise.all(packages.map(async (ticketPackage) => ({
        ...ticketPackage,
        ...withPriceLabel(await dynamicPricingEngine.getEffectivePrice({
          ...options,
          ...sharedForecast,
          priceType: 'package',
          packageId: ticketPackage._id,
          basePrice: ticketPackage.price,
        })),
      })));
    return res.json({
      success: true,
      data: { hourly: withPriceLabel(hourly), packages: packagePrices },
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

exports.getSuggestions = async (req, res) => {
  try {
    const query = {};
    if (req.query.status) {
      if (!['pending', 'approved', 'rejected', 'expired'].includes(req.query.status)) {
        return res.status(400).json({ success: false, message: 'Invalid suggestion status' });
      }
      query.status = req.query.status;
    }
    const suggestions = await PricingSuggestion.find(query)
      .populate('floorId', 'name floorNumber')
      .sort({ targetDate: -1, targetHour: -1, createdAt: -1 });
    return res.json({ success: true, data: suggestions });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

exports.approveSuggestion = async (req, res) => {
  try {
    const suggestion = await PricingSuggestion.findOneAndUpdate(
      { _id: req.params.id, status: 'pending', validUntil: { $gt: new Date() } },
      { $set: { status: 'approved', reviewedBy: req.user._id, reviewedAt: new Date() } },
      { new: true, runValidators: true }
    );
    if (!suggestion) {
      const exists = await PricingSuggestion.exists({ _id: req.params.id });
      return res.status(exists ? 409 : 404).json({
        success: false,
        message: exists ? 'Only a pending, unexpired suggestion can be approved' : 'Pricing suggestion not found',
      });
    }
    const history = await PriceHistory.create({
      priceType: suggestion.priceType,
      packageId: suggestion.packageId,
      targetDate: suggestion.targetDate,
      targetHour: suggestion.targetHour,
      floorId: suggestion.floorId,
      oldPrice: suggestion.basePrice,
      newPrice: suggestion.suggestedPrice,
      busynessScore: suggestion.busynessScore,
      level: suggestion.level,
      appliedRuleId: suggestion.appliedRuleId,
      adjustmentType: 'approved_suggestion',
      performedBy: req.user._id,
      suggestionId: suggestion._id,
    });
    await DynamicPricingConfig.updateOne(
      { isActive: true },
      { $set: { lastEvaluatedScore: suggestion.busynessScore, lastEvaluatedAt: new Date() } }
    );
    return res.json({ success: true, data: { suggestion, history } });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

exports.rejectSuggestion = async (req, res) => {
  try {
    const now = new Date();
    const suggestion = await PricingSuggestion.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' },
      { $set: { status: 'rejected', reviewedBy: req.user._id, reviewedAt: now, rejectedAt: now } },
      { new: true, runValidators: true }
    );
    if (!suggestion) {
      const exists = await PricingSuggestion.exists({ _id: req.params.id });
      return res.status(exists ? 409 : 404).json({
        success: false,
        message: exists ? 'Only a pending suggestion can be rejected' : 'Pricing suggestion not found',
      });
    }
    return res.json({ success: true, data: suggestion });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

exports.getHistory = async (req, res) => {
  try {
    const query = {};
    if (req.query.priceType) query.priceType = req.query.priceType;
    if (req.query.adjustmentType) query.adjustmentType = req.query.adjustmentType;
    if (req.query.from || req.query.to) {
      query.createdAt = {};
      if (req.query.from) query.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) query.createdAt.$lte = new Date(req.query.to);
      if (Object.values(query.createdAt).some((date) => Number.isNaN(date.getTime()))) {
        return res.status(400).json({ success: false, message: 'from and to must be valid dates' });
      }
    }
    const history = await PriceHistory.find(query).sort({ createdAt: -1 });
    return res.json({ success: true, data: history });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

exports.getStats = async (req, res) => {
  try {
    const query = {};
    if (req.query.from || req.query.to) {
      query.createdAt = {};
      if (req.query.from) query.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) query.createdAt.$lte = new Date(req.query.to);
      if (Object.values(query.createdAt).some((date) => Number.isNaN(date.getTime()))) {
        return res.status(400).json({ success: false, message: 'from and to must be valid dates' });
      }
    }
    const records = await PriceHistory.find(query).lean();
    const distributionByLevel = { low: 0, moderate: 0, high: 0, peak: 0 };
    let percentTotal = 0;
    records.forEach((record) => {
      distributionByLevel[record.level] = (distributionByLevel[record.level] || 0) + 1;
      if (record.oldPrice > 0) percentTotal += ((record.newPrice - record.oldPrice) / record.oldPrice) * 100;
    });
    return res.json({
      success: true,
      data: {
        adjustmentCount: records.length,
        averageAdjustmentPercent: records.length ? Number((percentTotal / records.length).toFixed(2)) : 0,
        distributionByLevel,
        period: { from: req.query.from || null, to: req.query.to || null },
      },
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

exports.validateCurrentQuery = validateCurrentQuery;
