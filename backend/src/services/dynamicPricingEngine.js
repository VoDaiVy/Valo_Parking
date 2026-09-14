const mongoose = require('mongoose');
const DynamicPricingConfig = require('../models/DynamicPricingConfig');
const PricingRule = require('../models/PricingRule');
const PricingSuggestion = require('../models/PricingSuggestion');
const PriceHistory = require('../models/PriceHistory');
const TicketPackage = require('../models/TicketPackage');
const pricingEngine = require('./pricingEngine');
const demandForecastingService = require('./demandForecastingService');

const FORECAST_TIMEOUT_MS = 3000;
const DEFAULT_DYNAMIC_CONFIG = Object.freeze({
  pricingMode: 'manual',
  isEnabled: false,
  triggerThreshold: 10,
  rejectionCooldownMinutes: 30,
  suggestionExpiryMinutes: 60,
  lastEvaluatedScore: null,
  consecutiveFailures: 0,
});

const clampScore = (score) => Math.max(0, Math.min(100, Number(score) || 0));

const levelForScore = (score) => {
  const normalized = clampScore(score);
  if (normalized >= 80) return 'peak';
  if (normalized >= 60) return 'high';
  if (normalized >= 35) return 'moderate';
  return 'low';
};

function computeAdjustedPrice(basePrice, busynessScore, rules = []) {
  const normalizedBasePrice = Number(basePrice);
  if (!Number.isFinite(normalizedBasePrice) || normalizedBasePrice < 0) {
    throw new TypeError('basePrice must be a non-negative number');
  }

  const score = clampScore(busynessScore);
  const rule = rules.find(
    (candidate) => candidate && candidate.isActive !== false
      && score >= Number(candidate.minScore)
      && score < Number(candidate.maxScore)
  ) || null;

  if (!rule) {
    return { adjustedPrice: normalizedBasePrice, rule: null, multiplier: 1.0 };
  }

  const multiplier = Math.max(0.5, Math.min(3.0, Number(rule.multiplier) || 1));
  const minimum = normalizedBasePrice * 0.5;
  const maximum = normalizedBasePrice * 3.0;
  const clampedPrice = Math.max(minimum, Math.min(maximum, normalizedBasePrice * multiplier));
  const roundedPrice = Math.ceil(clampedPrice / 1000) * 1000;

  return {
    adjustedPrice: Math.min(maximum, Math.max(minimum, roundedPrice)),
    rule,
    multiplier,
  };
}

async function getActiveConfig({ create = false } = {}) {
  if (!create) {
    return (await DynamicPricingConfig.findOne({ isActive: true }).lean()) || DEFAULT_DYNAMIC_CONFIG;
  }

  return DynamicPricingConfig.findOneAndUpdate(
    { isActive: true },
    { $setOnInsert: { isActive: true } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

function priceForHour(config, hour) {
  const normalizedHour = Number(hour);
  const block = (config.timeBlocks || []).find(({ startHour, endHour }) => (
    endHour > startHour
      ? normalizedHour >= startHour && normalizedHour < endHour
      : normalizedHour >= startHour || normalizedHour < endHour
  ));
  return Number(block?.price) || 0;
}

async function resolveBasePrice({ date, hour, priceType, packageId, basePrice }) {
  if (Number.isFinite(Number(basePrice))) return Number(basePrice);
  if (priceType === 'package') {
    if (!mongoose.Types.ObjectId.isValid(packageId)) throw new Error('A valid packageId is required');
    const ticketPackage = await TicketPackage.findById(packageId).select('price').lean();
    if (!ticketPackage) throw new Error('Ticket package not found');
    return Number(ticketPackage.price);
  }

  const config = await pricingEngine.getActivePricingConfig();
  const requestedHour = hour === undefined || hour === null
    ? (date ? new Date(`${date}T00:00:00+07:00`).getHours() : new Date().getHours())
    : Number(hour);
  return priceForHour(config, requestedHour);
}

async function forecastWithTimeout(options) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Forecast timeout')), FORECAST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      demandForecastingService.getOccupancyForecast({ ...options, timeframe: 'day' }),
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function fallbackResult(basePrice, pricingMode = 'manual') {
  return {
    basePrice,
    adjustedPrice: basePrice,
    multiplier: 1.0,
    busynessScore: null,
    level: null,
    pricingMode,
    changePercent: 0,
    appliedRuleId: null,
  };
}

async function getEffectivePrice(options = {}) {
  let basePrice = Number(options.basePrice);
  let pricingMode = 'manual';
  try {
    basePrice = await resolveBasePrice(options);
    const config = await getActiveConfig();
    pricingMode = config.pricingMode;
    if (!config.isEnabled || config.pricingMode === 'manual') {
      return fallbackResult(basePrice, config.pricingMode);
    }

    const forecast = options.busynessScore === undefined
      ? await forecastWithTimeout({ date: options.date, hour: options.hour })
      : null;
    const selected = forecast
      ? forecast.selectedForecast || forecast.selectedItem
      : { busynessScore: options.busynessScore, level: options.level };
    const busynessScore = clampScore(selected?.busynessScore);
    const level = selected?.level || levelForScore(busynessScore);

    if (config.pricingMode === 'semi-auto' && !options.forSuggestion) {
      const now = new Date();
      const approvedSuggestion = await PricingSuggestion.findOne({
        ...targetFilter(options.priceType, options.packageId),
        status: 'approved',
        validFrom: { $lte: now },
        validUntil: { $gt: now },
      }).sort({ reviewedAt: -1, createdAt: -1 }).lean();
      if (!approvedSuggestion) {
        return {
          ...fallbackResult(basePrice, config.pricingMode),
          busynessScore,
          level,
        };
      }
      const adjustedPrice = Number(approvedSuggestion.suggestedPrice);
      return {
        basePrice,
        adjustedPrice,
        multiplier: Number(approvedSuggestion.multiplier),
        busynessScore,
        level,
        pricingMode: config.pricingMode,
        changePercent: basePrice === 0 ? 0 : Number((((adjustedPrice - basePrice) / basePrice) * 100).toFixed(2)),
        appliedRuleId: approvedSuggestion.appliedRuleId || null,
        suggestionId: approvedSuggestion._id,
      };
    }

    const query = {
      isActive: true,
      priceType: { $in: [options.priceType, 'all'] },
    };
    if (options.priceType === 'package') {
      query.$or = [{ packageId: options.packageId }, { packageId: null }];
    }
    const rules = await PricingRule.find(query).lean();
    rules.sort((left, right) => {
      const leftSpecific = String(left.packageId || '') === String(options.packageId || '') ? 1 : 0;
      const rightSpecific = String(right.packageId || '') === String(options.packageId || '') ? 1 : 0;
      return rightSpecific - leftSpecific || (left.maxScore - left.minScore) - (right.maxScore - right.minScore);
    });
    const result = computeAdjustedPrice(basePrice, busynessScore, rules);
    return {
      basePrice,
      adjustedPrice: result.adjustedPrice,
      multiplier: result.multiplier,
      busynessScore,
      level,
      pricingMode: config.pricingMode,
      changePercent: basePrice === 0 ? 0 : Number((((result.adjustedPrice - basePrice) / basePrice) * 100).toFixed(2)),
      appliedRuleId: result.rule?._id || null,
    };
  } catch (error) {
    console.error('[DynamicPricing] Forecast timeout or pricing failure:', error.message);
    return fallbackResult(Number.isFinite(basePrice) ? basePrice : 0, pricingMode);
  }
}

function targetFilter(priceType, packageId) {
  return priceType === 'package'
    ? { priceType, packageId }
    : { priceType, packageId: null };
}

async function generateSuggestion({ busynessScore, priceType, packageId, force = false }) {
  const config = await getActiveConfig({ create: true });
  if (!config.isEnabled || config.pricingMode !== 'semi-auto') return null;

  const score = clampScore(busynessScore);
  if (!force && config.lastEvaluatedScore !== null
      && Math.abs(score - config.lastEvaluatedScore) <= config.triggerThreshold) return null;

  const cooldownStart = new Date(Date.now() - config.rejectionCooldownMinutes * 60 * 1000);
  const rejected = await PricingSuggestion.exists({
    ...targetFilter(priceType, packageId),
    status: 'rejected',
    rejectedAt: { $gte: cooldownStart },
  });
  if (rejected) return null;

  const price = await getEffectivePrice({
    priceType,
    packageId,
    busynessScore: score,
    forSuggestion: true,
  });
  const now = new Date();
  const suggestion = await PricingSuggestion.create({
    ...targetFilter(priceType, packageId),
    basePrice: price.basePrice,
    suggestedPrice: price.adjustedPrice,
    multiplier: price.multiplier,
    busynessScore: score,
    level: levelForScore(score),
    appliedRuleId: price.appliedRuleId,
    reason: `Demand level ${levelForScore(score)} (${score}/100)`,
    validFrom: now,
    validUntil: new Date(now.getTime() + config.suggestionExpiryMinutes * 60 * 1000),
  });
  config.lastEvaluatedScore = score;
  config.lastEvaluatedAt = now;
  await config.save();
  return suggestion;
}

async function applyAutoAdjustment({ busynessScore, priceType, packageId, force = false }) {
  const config = await getActiveConfig({ create: true });
  if (!config.isEnabled || config.pricingMode !== 'auto') return null;
  const score = clampScore(busynessScore);
  if (!force && config.lastEvaluatedScore !== null
      && Math.abs(score - config.lastEvaluatedScore) <= config.triggerThreshold) return null;

  const price = await getEffectivePrice({ priceType, packageId, busynessScore: score });
  const history = await PriceHistory.create({
    ...targetFilter(priceType, packageId),
    oldPrice: price.basePrice,
    newPrice: price.adjustedPrice,
    busynessScore: score,
    level: price.level || levelForScore(score),
    appliedRuleId: price.appliedRuleId,
    adjustmentType: 'auto',
  });
  config.lastEvaluatedScore = score;
  config.lastEvaluatedAt = new Date();
  config.consecutiveFailures = 0;
  await config.save();
  return history;
}

module.exports = {
  FORECAST_TIMEOUT_MS,
  computeAdjustedPrice,
  getActiveConfig,
  getEffectivePrice,
  generateSuggestion,
  applyAutoAdjustment,
  levelForScore,
};
