const DEFAULT_CONFIG = {
  timeBlocks: [
    { startHour: 7, endHour: 12, price: 10000 },
    { startHour: 12, endHour: 17, price: 10000 },
    { startHour: 17, endHour: 22, price: 20000 },
    { startHour: 22, endHour: 7, price: 25000 }
  ],
  cap12h: 100000,
  cap24h: 180000,
  dayNightPricing: {
    day: { isActive: false, startHour: 6, price: 50000 },
    night: { isActive: false, startHour: 18, price: 70000 },
  },
  pricePolicies: [],
};

const hourInBlock = (hour, startHour) => (((hour - startHour) % 24 + 24) % 24) < 12;

const resolvePricingBlocks = (config) => {
  const baseBlocks = config.timeBlocks?.length ? config.timeBlocks : DEFAULT_CONFIG.timeBlocks;
  const dayNight = config.dayNightPricing || DEFAULT_CONFIG.dayNightPricing;
  const overrides = [
    { key: 'day', ...(dayNight.day || DEFAULT_CONFIG.dayNightPricing.day) },
    { key: 'night', ...(dayNight.night || DEFAULT_CONFIG.dayNightPricing.night) },
  ];
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const baseIndex = baseBlocks.findIndex((block) => block.startHour < block.endHour
      ? hour >= block.startHour && hour < block.endHour
      : hour >= block.startHour || hour < block.endHour);
    const baseBlock = baseBlocks[baseIndex] || DEFAULT_CONFIG.timeBlocks[0];
    const override = overrides.find((block) => block.isActive && hourInBlock(hour, Number(block.startHour)));
    return override
      ? { price: Number(override.price) || 0, source: `day-night:${override.key}` }
      : { price: Number(baseBlock.price) || 0, source: `time-block:${baseIndex}` };
  });
  const runs = [];
  hourly.forEach((current, hour) => {
    const previous = runs[runs.length - 1];
    if (previous && previous.source === current.source && previous.price === current.price) previous.endHour = hour + 1;
    else runs.push({ startHour: hour, endHour: hour + 1, ...current });
  });
  if (runs.length > 1) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (first.source === last.source && first.price === last.price) {
      runs[0] = { ...first, startHour: last.startHour };
      runs.pop();
    }
  }
  return runs;
};

const dateKey = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

const findPricePolicy = (policies, date) => {
  const key = dateKey(date);
  const specificity = { date_range: 3, month: 2, weekday: 1 };
  return (policies || []).filter((policy) => {
    if (!policy?.isActive) return false;
    if (policy.scope === 'weekday') return (policy.daysOfWeek || []).includes(date.getUTCDay());
    if (policy.scope === 'month') return (policy.months || []).includes(date.getUTCMonth() + 1);
    return policy.scope === 'date_range' && key >= policy.startDate && key <= policy.endDate;
  }).sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0)
    || specificity[right.scope] - specificity[left.scope])[0] || null;
};

export const calculateBookingPrice = (startTime, endTime, options = {}) => {
  const config = options.config || DEFAULT_CONFIG;
  const blocks = resolvePricingBlocks(config);
  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return {
      usageAmount: 0,
      totalAmount: 0,
      paidHours: 0,
      capApplied: false,
    };
  }

  const shiftMs = 7 * 60 * 60 * 1000;
  const startVn = new Date(start.getTime() + shiftMs);
  const endVn = new Date(end.getTime() + shiftMs);

  const startOfDay = new Date(startVn);
  startOfDay.setUTCHours(0, 0, 0, 0);
  startOfDay.setUTCDate(startOfDay.getUTCDate() - 1);

  const endOfDay = new Date(endVn);
  endOfDay.setUTCHours(23, 59, 59, 999);

  let rawTotal = 0;
  const appliedPolicies = new Map();

  for (let d = new Date(startOfDay); d <= endOfDay; d.setUTCDate(d.getUTCDate() + 1)) {
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const date = d.getUTCDate();

    for (const block of blocks) {
      let blockStart = new Date(Date.UTC(year, month, date, block.startHour, 0, 0, 0));
      let blockEnd = new Date(Date.UTC(year, month, date, block.endHour, 0, 0, 0));

      if (block.endHour <= block.startHour) {
        blockEnd.setUTCDate(blockEnd.getUTCDate() + 1);
      }

      if (startVn < blockEnd && endVn > blockStart) {
        const policy = findPricePolicy(config.pricePolicies, d);
        const adjusted = policy
          ? Math.ceil(Math.max(0, block.price * (1 + Number(policy.adjustmentPercent || 0) / 100)) / 1000) * 1000
          : block.price;
        rawTotal += adjusted;
        if (policy) appliedPolicies.set(String(policy._id || policy.name), policy);
      }
    }
  }

  const durationHours = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60));
  let finalTotal = rawTotal;
  let capApplied = false;

  if (durationHours <= 12 && rawTotal > config.cap12h) {
    finalTotal = config.cap12h;
    capApplied = true;
  } else if (durationHours <= 24 && rawTotal > config.cap24h) {
    finalTotal = config.cap24h;
    capApplied = true;
  } else if (durationHours > 24) {
    const fullDays = Math.floor(durationHours / 24);
    const maxAllowed = fullDays * config.cap24h + config.cap24h;
    if (rawTotal > maxAllowed) {
      finalTotal = maxAllowed;
      capApplied = true;
    }
  }

  return {
    usageAmount: finalTotal,
    totalAmount: options.waiveOpeningFee ? 0 : finalTotal,
    durationMinutes: Math.ceil((end.getTime() - start.getTime()) / 60000),
    paidHours: durationHours,
    capApplied,
    appliedPolicies: [...appliedPolicies.values()],
  };
};
