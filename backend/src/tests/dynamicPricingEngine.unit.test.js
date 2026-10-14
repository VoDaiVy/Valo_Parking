const assert = require('node:assert/strict');
const test = require('node:test');
const fc = require('fast-check');
const mongoose = require('mongoose');
const dynamicPricingEngine = require('../services/dynamicPricingEngine');
const DynamicPricingConfig = require('../models/DynamicPricingConfig');
const PricingRule = require('../models/PricingRule');
const PricingSuggestion = require('../models/PricingSuggestion');
const PriceHistory = require('../models/PriceHistory');
const pricingController = require('../controllers/pricingController');
const { buildPaymentBreakdown } = require('../services/paidBookingPolicyService');

const matchingRuleArbitrary = fc.record({
  minScore: fc.integer({ min: 0, max: 49 }),
  maxScore: fc.integer({ min: 51, max: 100 }),
  multiplier: fc.double({ min: 0.5, max: 3, noNaN: true }),
  isActive: fc.constant(true),
});

test('computeAdjustedPrice handles boundary and overlapping-rule examples', () => {
  const rules = [
    { minScore: 0, maxScore: 35, multiplier: 0.8, isActive: true, label: 'low' },
    { minScore: 35, maxScore: 80, multiplier: 1.2, isActive: true, label: 'broad' },
    { minScore: 60, maxScore: 80, multiplier: 1.5, isActive: true, label: 'overlap' },
  ];
  assert.equal(dynamicPricingEngine.computeAdjustedPrice(10000, 0, rules).adjustedPrice, 8000);
  assert.equal(dynamicPricingEngine.computeAdjustedPrice(10000, 100, rules).adjustedPrice, 10000);
  assert.equal(dynamicPricingEngine.computeAdjustedPrice(10000, 65, rules).rule.label, 'broad');
  assert.equal(dynamicPricingEngine.computeAdjustedPrice(10000, 20, []).multiplier, 1);
});

test('Feature: ai-dynamic-pricing, Property 1: adjusted price stays within 50%-300% of base price', () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 500 }).map((value) => value * 1000),
    fc.integer({ min: 0, max: 100 }),
    fc.array(matchingRuleArbitrary, { maxLength: 10 }),
    (basePrice, score, rules) => {
      const { adjustedPrice } = dynamicPricingEngine.computeAdjustedPrice(basePrice, score, rules);
      return adjustedPrice >= basePrice * 0.5 && adjustedPrice <= basePrice * 3;
    }
  ), { numRuns: 100 });
});

test('Feature: ai-dynamic-pricing, Property 2: no matching rule returns base price', () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 500000 }),
    fc.integer({ min: 50, max: 100 }),
    (basePrice, score) => {
      const result = dynamicPricingEngine.computeAdjustedPrice(basePrice, score, [
        { minScore: 0, maxScore: 40, multiplier: 2, isActive: true },
      ]);
      return result.adjustedPrice === basePrice && result.multiplier === 1 && result.rule === null;
    }
  ), { numRuns: 100 });
});

test('Feature: ai-dynamic-pricing, Property 3: adjusted hourly price is rounded to 1,000 VND', () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 500 }).map((value) => value * 1000),
    fc.integer({ min: 0, max: 99 }),
    fc.double({ min: 0.5, max: 3, noNaN: true }),
    (basePrice, score, multiplier) => {
      const { adjustedPrice } = dynamicPricingEngine.computeAdjustedPrice(basePrice, score, [
        { minScore: 0, maxScore: 100, multiplier, isActive: true },
      ]);
      return adjustedPrice % 1000 === 0;
    }
  ), { numRuns: 100 });
});

test('Feature: ai-dynamic-pricing, Property 4: PricingRule rejects multipliers outside [0.5, 3.0]', async () => {
  await fc.assert(fc.asyncProperty(
    fc.oneof(
      fc.double({ min: -100, max: 0.499999, noNaN: true }),
      fc.double({ min: 3.000001, max: 100, noNaN: true })
    ),
    async (multiplier) => {
      const rule = new PricingRule({ label: 'invalid', minScore: 0, maxScore: 10, multiplier });
      await assert.rejects(rule.validate());
    }
  ), { numRuns: 100 });
});

test('Feature: ai-dynamic-pricing, Property 5: PriceHistory survives a JSON round trip', () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 500000 }),
    fc.integer({ min: 0, max: 500000 }),
    fc.integer({ min: 0, max: 100 }),
    (oldPrice, newPrice, busynessScore) => {
      const original = new PriceHistory({
        priceType: 'hourly',
        oldPrice,
        newPrice,
        busynessScore,
        level: dynamicPricingEngine.levelForScore(busynessScore),
        adjustmentType: 'auto',
      });
      const serialized = JSON.stringify(original.toJSON());
      return JSON.stringify(JSON.parse(serialized)) === serialized;
    }
  ), { numRuns: 100 });
});

test('Feature: ai-dynamic-pricing, Property 6: approval records the suggested price in history', async () => {
  const originalFindOneAndUpdate = PricingSuggestion.findOneAndUpdate;
  const originalExists = PricingSuggestion.exists;
  const originalCreate = PriceHistory.create;
  const originalUpdateOne = DynamicPricingConfig.updateOne;
  let capturedHistory;
  PricingSuggestion.findOneAndUpdate = async ({ _id }) => ({
    _id,
    priceType: 'hourly',
    packageId: null,
    basePrice: 10000,
    suggestedPrice: 15000,
    multiplier: 1.5,
    busynessScore: 85,
    level: 'peak',
    appliedRuleId: new mongoose.Types.ObjectId(),
  });
  PricingSuggestion.exists = async () => true;
  PriceHistory.create = async (history) => {
    capturedHistory = history;
    return history;
  };
  DynamicPricingConfig.updateOne = async () => ({ acknowledged: true });
  try {
    await fc.assert(fc.asyncProperty(fc.uuid(), async (id) => {
      capturedHistory = null;
      const response = { statusCode: 200, body: null };
      const res = {
        status(code) { response.statusCode = code; return this; },
        json(body) { response.body = body; return this; },
      };
      await pricingController.approveSuggestion(
        { params: { id }, user: { _id: new mongoose.Types.ObjectId() } },
        res
      );
      return response.statusCode === 200
        && response.body.success === true
        && capturedHistory.adjustmentType === 'approved_suggestion'
        && capturedHistory.newPrice === 15000;
    }), { numRuns: 100 });
  } finally {
    PricingSuggestion.findOneAndUpdate = originalFindOneAndUpdate;
    PricingSuggestion.exists = originalExists;
    PriceHistory.create = originalCreate;
    DynamicPricingConfig.updateOne = originalUpdateOne;
  }
});

test('Feature: ai-dynamic-pricing, Property 7: rejected targets remain in cooldown', async () => {
  const originalFindOneAndUpdate = DynamicPricingConfig.findOneAndUpdate;
  const originalExists = PricingSuggestion.exists;
  DynamicPricingConfig.findOneAndUpdate = async () => ({
    isEnabled: true,
    pricingMode: 'semi-auto',
    triggerThreshold: 10,
    rejectionCooldownMinutes: 30,
    suggestionExpiryMinutes: 60,
    lastEvaluatedScore: null,
    save: async () => {},
  });
  PricingSuggestion.exists = async () => ({ _id: new mongoose.Types.ObjectId() });
  try {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 100 }), async (busynessScore) => {
      const result = await dynamicPricingEngine.generateSuggestion({
        busynessScore,
        priceType: 'hourly',
      });
      return result === null;
    }), { numRuns: 100 });
  } finally {
    DynamicPricingConfig.findOneAndUpdate = originalFindOneAndUpdate;
    PricingSuggestion.exists = originalExists;
  }
});

test('Feature: ai-dynamic-pricing, Property 9: manual mode always returns multiplier 1.0', async () => {
  const originalFindOne = DynamicPricingConfig.findOne;
  DynamicPricingConfig.findOne = () => ({
    lean: async () => ({ isEnabled: true, pricingMode: 'manual' }),
  });
  try {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 0, max: 500 }).map((value) => value * 1000),
      async (basePrice) => {
        const result = await dynamicPricingEngine.getEffectivePrice({ priceType: 'hourly', basePrice });
        return result.adjustedPrice === basePrice && result.multiplier === 1;
      }
    ), { numRuns: 100 });
  } finally {
    DynamicPricingConfig.findOne = originalFindOne;
  }
});

test('Feature: ai-dynamic-pricing, Property 8: booking snapshot preserves the quoted dynamic total', () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 500 }).map((value) => value * 1000),
    fc.constantFrom(0.5, 0.8, 1, 1.2, 1.5, 2, 3),
    fc.integer({ min: 0, max: 100 }),
    (baseTotal, multiplier, busynessScore) => {
      const adjustedTotal = Math.ceil((baseTotal * multiplier) / 1000) * 1000;
      const snapshot = buildPaymentBreakdown(
        { prepaidAmount: adjustedTotal, paymentBreakdownSnapshot: {} },
        { parkingAmount: adjustedTotal, dynamicMultiplier: multiplier, busynessScore, adjustedTotal }
      );
      return snapshot.totalAmount === adjustedTotal
        && snapshot.adjustedTotal === adjustedTotal
        && snapshot.dynamicMultiplier === multiplier
        && snapshot.busynessScore === busynessScore;
    }
  ), { numRuns: 100 });
});

test('semi-auto mode keeps base price until an approved suggestion exists', async () => {
  const originalFindOne = DynamicPricingConfig.findOne;
  const originalSuggestionFindOne = PricingSuggestion.findOne;
  DynamicPricingConfig.findOne = () => ({
    lean: async () => ({ isEnabled: true, pricingMode: 'semi-auto' }),
  });
  PricingSuggestion.findOne = () => ({
    sort: () => ({ lean: async () => null }),
  });
  try {
    const result = await dynamicPricingEngine.getEffectivePrice({
      priceType: 'hourly',
      basePrice: 10000,
      busynessScore: 90,
    });
    assert.equal(result.adjustedPrice, 10000);
    assert.equal(result.multiplier, 1);
    assert.equal(result.level, 'peak');
  } finally {
    DynamicPricingConfig.findOne = originalFindOne;
    PricingSuggestion.findOne = originalSuggestionFindOne;
  }
});

test('dynamic pricing is neutral outside the configured forecast horizon', async () => {
  const originalFindOne = DynamicPricingConfig.findOne;
  DynamicPricingConfig.findOne = () => ({
    lean: async () => ({
      isEnabled: true,
      pricingMode: 'auto',
      forecastHorizonHours: 24,
      earlyBookingPromotion: { isEnabled: false },
    }),
  });
  try {
    const result = await dynamicPricingEngine.getEffectivePrice({
      priceType: 'hourly',
      basePrice: 10000,
      date: '2099-01-01',
      hour: 10,
      durationMinutes: 60,
      floorId: new mongoose.Types.ObjectId(),
      busynessScore: 95,
    });
    assert.equal(result.multiplier, 1);
    assert.equal(result.adjustedPrice, 10000);
    assert.equal(result.isDynamicPricingEligible, false);
    assert.equal(result.pricingReason, 'OUTSIDE_FORECAST_HORIZON');
  } finally {
    DynamicPricingConfig.findOne = originalFindOne;
  }
});

test('early booking promotion remains separate from the dynamic multiplier', async () => {
  const originalFindOne = DynamicPricingConfig.findOne;
  DynamicPricingConfig.findOne = () => ({
    lean: async () => ({
      isEnabled: true,
      pricingMode: 'auto',
      forecastHorizonHours: 24,
      earlyBookingPromotion: { isEnabled: true, minimumLeadHours: 72, discountPercent: 10 },
    }),
  });
  try {
    const result = await dynamicPricingEngine.getEffectivePrice({
      priceType: 'hourly',
      basePrice: 10000,
      date: '2099-01-01',
      hour: 10,
      durationMinutes: 60,
    });
    assert.equal(result.multiplier, 1);
    assert.equal(result.promotionMultiplier, 0.9);
    assert.equal(result.effectiveMultiplier, 0.9);
    assert.equal(result.adjustedPrice, 9000);
    assert.equal(result.promotion.type, 'EARLY_BOOKING_DISCOUNT');
    const shortResult = await dynamicPricingEngine.getEffectivePrice({
      priceType: 'hourly',
      basePrice: 10000,
      date: '2099-01-01',
      hour: 10,
      durationMinutes: 30,
    });
    assert.equal(shortResult.multiplier, 1);
    assert.equal(shortResult.promotionMultiplier, 1);
    assert.equal(shortResult.adjustedPrice, 10000);
  } finally {
    DynamicPricingConfig.findOne = originalFindOne;
  }
});

test('hourly discounts require at least 60 minutes while peak surcharges remain eligible', async () => {
  const originalFindOne = DynamicPricingConfig.findOne;
  const originalRuleFind = PricingRule.find;
  DynamicPricingConfig.findOne = () => ({
    lean: async () => ({
      isEnabled: true,
      pricingMode: 'auto',
      forecastHorizonHours: 24,
      earlyBookingPromotion: { isEnabled: false },
    }),
  });
  try {
    PricingRule.find = () => ({
      lean: async () => [{ minScore: 0, maxScore: 100, multiplier: 0.8, isActive: true }],
    });
    const shortDiscount = await dynamicPricingEngine.getEffectivePrice({
      priceType: 'hourly', basePrice: 10000, busynessScore: 20, durationMinutes: 30,
    });
    const fullHourDiscount = await dynamicPricingEngine.getEffectivePrice({
      priceType: 'hourly', basePrice: 10000, busynessScore: 20, durationMinutes: 60,
    });
    assert.equal(shortDiscount.multiplier, 1);
    assert.equal(shortDiscount.adjustedPrice, 10000);
    assert.equal(shortDiscount.pricingReason, 'DISCOUNT_REQUIRES_60_MINUTES');
    assert.equal(fullHourDiscount.multiplier, 0.8);
    assert.equal(fullHourDiscount.adjustedPrice, 8000);

    PricingRule.find = () => ({
      lean: async () => [{ minScore: 0, maxScore: 100, multiplier: 1.2, isActive: true }],
    });
    const shortSurcharge = await dynamicPricingEngine.getEffectivePrice({
      priceType: 'hourly', basePrice: 10000, busynessScore: 90, durationMinutes: 30,
    });
    assert.equal(shortSurcharge.multiplier, 1.2);
    assert.equal(shortSurcharge.adjustedPrice, 12000);
  } finally {
    DynamicPricingConfig.findOne = originalFindOne;
    PricingRule.find = originalRuleFind;
  }
});

test('pricing suggestion schema requires date, hour, and floor scope', async () => {
  const suggestion = new PricingSuggestion({
    priceType: 'hourly',
    basePrice: 10000,
    suggestedPrice: 12000,
    multiplier: 1.2,
    busynessScore: 80,
    level: 'peak',
    validUntil: new Date(Date.now() + 60000),
  });
  await assert.rejects(suggestion.validate(), /targetDate|targetHour|floorId/);
});

test('pricing current query validation reports invalid date and hour', () => {
  assert.match(pricingController.validateCurrentQuery({ date: '2026-02-30' }), /valid calendar date/);
  assert.match(pricingController.validateCurrentQuery({ hour: '24' }), /0 to 23/);
  assert.match(pricingController.validateCurrentQuery({ durationMinutes: '0' }), /positive integer/);
  assert.equal(pricingController.validateCurrentQuery({ date: '2026-09-14', hour: '0' }), null);
});
