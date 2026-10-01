const PricingConfig = require('../models/PricingConfig');

// Mức giá dự phòng (Fallback) nếu DB trống
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

const hourInBlock = (hour, startHour, duration = 12) => {
  const normalized = ((hour - startHour) % 24 + 24) % 24;
  return normalized < duration;
};

function resolvePricingBlocks(config = DEFAULT_CONFIG) {
  const baseBlocks = config.timeBlocks?.length ? config.timeBlocks : DEFAULT_CONFIG.timeBlocks;
  const dayNight = config.dayNightPricing || DEFAULT_CONFIG.dayNightPricing;
  const normalizeOverride = (key, value, fallback) => ({
    key,
    isActive: value?.isActive === true,
    startHour: Number(value?.startHour ?? fallback.startHour),
    price: Number(value?.price ?? fallback.price),
  });
  const overrides = [
    normalizeOverride('day', dayNight.day, DEFAULT_CONFIG.dayNightPricing.day),
    normalizeOverride('night', dayNight.night, DEFAULT_CONFIG.dayNightPricing.night),
  ];

  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const baseIndex = baseBlocks.findIndex((block) => block.startHour < block.endHour
      ? hour >= block.startHour && hour < block.endHour
      : hour >= block.startHour || hour < block.endHour);
    const baseBlock = baseBlocks[baseIndex] || DEFAULT_CONFIG.timeBlocks[0];
    const override = overrides.find((block) => block.isActive && hourInBlock(hour, Number(block.startHour), 12));
    return override
      ? { price: Number(override.price) || 0, source: `day-night:${override.key}`, label: override.key }
      : { price: Number(baseBlock.price) || 0, source: `time-block:${baseIndex}`, label: null };
  });

  const runs = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const current = hourly[hour];
    const previous = runs[runs.length - 1];
    if (previous && previous.source === current.source && previous.price === current.price) {
      previous.endHour = hour + 1;
    } else {
      runs.push({ startHour: hour, endHour: hour + 1, ...current });
    }
  }

  if (runs.length > 1) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (first.source === last.source && first.price === last.price) {
      runs[0] = { ...first, startHour: last.startHour };
      runs.pop();
    }
  }
  return runs;
}

const dateKey = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

function findPricePolicy(policies, localDate) {
  const key = dateKey(localDate);
  const matches = (Array.isArray(policies) ? policies : []).filter((policy) => {
    if (!policy?.isActive) return false;
    if (policy.scope === 'weekday') return (policy.daysOfWeek || []).includes(localDate.getUTCDay());
    if (policy.scope === 'month') return (policy.months || []).includes(localDate.getUTCMonth() + 1);
    if (policy.scope === 'date_range') return policy.startDate && policy.endDate && key >= policy.startDate && key <= policy.endDate;
    return false;
  });
  const specificity = { date_range: 3, month: 2, weekday: 1 };
  return matches.sort((left, right) =>
    Number(right.priority || 0) - Number(left.priority || 0)
    || specificity[right.scope] - specificity[left.scope]
  )[0] || null;
}

function applyPricePolicy(price, policy) {
  if (!policy) return Number(price) || 0;
  const adjusted = Math.max(0, (Number(price) || 0) * (1 + Number(policy.adjustmentPercent || 0) / 100));
  return Math.ceil(adjusted / 1000) * 1000;
}

/**
 * Lấy cấu hình giá mới nhất từ database
 */
async function getActivePricingConfig() {
  try {
    const config = await PricingConfig.findOne({ isActive: true }).sort({ createdAt: -1 });
    return config || DEFAULT_CONFIG;
  } catch (error) {
    console.error('Error fetching pricing config:', error);
    return DEFAULT_CONFIG;
  }
}

/**
 * Tính toán phí đỗ xe thực tế dựa vào check-in/out
 * @param {Date} checkIn
 * @param {Date} checkOut
 * @param {Boolean} includeSessionFee - Tham số giữ lại để tương thích, nhưng không còn dùng trong logic khối.
 * @param {Object} [config]
 */
async function calculatePrice(checkIn, checkOut, includeSessionFee = true, config = null) {
  if (!config) {
    config = await getActivePricingConfig();
  }
  const blocks = resolvePricingBlocks(config);

  const start = new Date(checkIn);
  const end = new Date(checkOut);
  
  if (start >= end) {
    return { finalTotal: 0, rawTotal: 0, durationHours: 0 };
  }

  const shiftMs = 7 * 60 * 60 * 1000;
  const startVn = new Date(start.getTime() + shiftMs);
  const endVn = new Date(end.getTime() + shiftMs);

  // Lặp qua các ngày đỗ xe, bắt đầu từ 1 ngày trước ngày checkIn để bắt các block vắt qua đêm
  const startOfDay = new Date(startVn);
  startOfDay.setUTCHours(0, 0, 0, 0);
  startOfDay.setUTCDate(startOfDay.getUTCDate() - 1);
  
  const endOfDay = new Date(endVn);
  endOfDay.setUTCHours(23, 59, 59, 999);
  
  let rawTotal = 0;
  let baseRawTotal = 0;
  const appliedPolicies = new Map();
  
  for (let d = new Date(startOfDay); d <= endOfDay; d.setUTCDate(d.getUTCDate() + 1)) {
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const date = d.getUTCDate();
    
    for (const block of blocks) {
      let blockStart = new Date(Date.UTC(year, month, date, block.startHour, 0, 0, 0));
      let blockEnd = new Date(Date.UTC(year, month, date, block.endHour, 0, 0, 0));
      
      // Nếu endHour <= startHour (VD: 22h -> 7h), tức là block kết thúc vào ngày hôm sau
      if (block.endHour <= block.startHour) {
        blockEnd.setUTCDate(blockEnd.getUTCDate() + 1);
      }
      
      // Điều kiện overlap: start < blockEnd && end > blockStart
      if (startVn < blockEnd && endVn > blockStart) {
        const policy = findPricePolicy(config.pricePolicies, d);
        baseRawTotal += block.price;
        rawTotal += applyPricePolicy(block.price, policy);
        if (policy) appliedPolicies.set(String(policy._id || policy.name), {
          name: policy.name,
          scope: policy.scope,
          adjustmentPercent: policy.adjustmentPercent,
        });
      }
    }
  }

  const durationHours = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60));
  let finalTotal = rawTotal;
  let capApplied = 'NONE';
  
  // Áp dụng trần giá (Price Caps)
  if (durationHours <= 12 && rawTotal > config.cap12h) {
    finalTotal = config.cap12h;
    capApplied = 'CAP_12H';
  } else if (durationHours <= 24 && rawTotal > config.cap24h) {
    finalTotal = config.cap24h;
    capApplied = 'CAP_24H';
  } else if (durationHours > 24) {
    const fullDays = Math.floor(durationHours / 24);
    const maxAllowed = fullDays * config.cap24h + config.cap24h;
    if (rawTotal > maxAllowed) {
      finalTotal = maxAllowed;
      capApplied = 'CAP_MULTI_DAY';
    }
  }
  
  return {
    durationHours,
    rawTotal,
    baseRawTotal,
    appliedPolicies: [...appliedPolicies.values()],
    capApplied,
    finalTotal,
  };
}

/**
 * Tính toán phí đỗ xe cho một tập hợp các khoảng thời gian (intervals).
 * Giải quyết vấn đề block bị tính trùng khi user ra vào nhiều lần trong cùng một block.
 * @param {Array<{start: Date|string, end: Date|string}>} intervals 
 * @param {Object} [config] 
 */
async function calculateTotalForIntervals(intervals, config = null) {
  if (!config) {
    config = await getActivePricingConfig();
  }
  const blocks = resolvePricingBlocks(config);

  if (!intervals || intervals.length === 0) {
    return { finalTotal: 0, rawTotal: 0, durationHours: 0 };
  }

  // Chuyển đổi và chuẩn hóa intervals
  let validIntervals = intervals.map(i => ({
    start: new Date(i.start),
    end: new Date(i.end)
  })).filter(i => i.start < i.end);

  if (validIntervals.length === 0) {
    return { finalTotal: 0, rawTotal: 0, durationHours: 0 };
  }

  // Tìm giới hạn thời gian (earliest start, latest end) để lặp theo ngày
  let earliestStart = validIntervals[0].start;
  let latestEnd = validIntervals[0].end;
  let totalDurationMs = 0;

  // Gộp các interval bị trùng lặp (nếu có)
  validIntervals.sort((a, b) => a.start - b.start);
  const mergedIntervals = [validIntervals[0]];
  
  for (let i = 1; i < validIntervals.length; i++) {
    const curr = validIntervals[i];
    const prev = mergedIntervals[mergedIntervals.length - 1];
    if (curr.start <= prev.end) {
      prev.end = new Date(Math.max(prev.end, curr.end));
    } else {
      mergedIntervals.push(curr);
    }
  }

  for (const iv of mergedIntervals) {
    totalDurationMs += (iv.end - iv.start);
    if (iv.start < earliestStart) earliestStart = iv.start;
    if (iv.end > latestEnd) latestEnd = iv.end;
  }

  const shiftMs = 7 * 60 * 60 * 1000;
  const startOfDay = new Date(earliestStart.getTime() + shiftMs);
  startOfDay.setUTCHours(0, 0, 0, 0);
  startOfDay.setUTCDate(startOfDay.getUTCDate() - 1);
  
  const endOfDay = new Date(latestEnd.getTime() + shiftMs);
  endOfDay.setUTCHours(23, 59, 59, 999);
  
  let rawTotal = 0;
  let baseRawTotal = 0;
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
      
      // Kiểm tra xem có BẤT KỲ interval nào overlap với block này không
      const isOverlap = mergedIntervals.some(iv => {
        const ivStartVn = new Date(iv.start.getTime() + shiftMs);
        const ivEndVn = new Date(iv.end.getTime() + shiftMs);
        return ivStartVn < blockEnd && ivEndVn > blockStart;
      });
      if (isOverlap) {
        const policy = findPricePolicy(config.pricePolicies, d);
        baseRawTotal += block.price;
        rawTotal += applyPricePolicy(block.price, policy);
        if (policy) appliedPolicies.set(String(policy._id || policy.name), {
          name: policy.name,
          scope: policy.scope,
          adjustmentPercent: policy.adjustmentPercent,
        });
      }
    }
  }

  const durationHours = Math.ceil(totalDurationMs / (1000 * 60 * 60));
  let finalTotal = rawTotal;
  let capApplied = 'NONE';
  
  // Áp dụng trần giá (Price Caps)
  if (durationHours <= 12 && rawTotal > config.cap12h) {
    finalTotal = config.cap12h;
    capApplied = 'CAP_12H';
  } else if (durationHours <= 24 && rawTotal > config.cap24h) {
    finalTotal = config.cap24h;
    capApplied = 'CAP_24H';
  } else if (durationHours > 24) {
    const fullDays = Math.floor(durationHours / 24);
    const maxAllowed = fullDays * config.cap24h + config.cap24h;
    if (rawTotal > maxAllowed) {
      finalTotal = maxAllowed;
      capApplied = 'CAP_MULTI_DAY';
    }
  }
  
  return {
    durationHours,
    rawTotal,
    baseRawTotal,
    appliedPolicies: [...appliedPolicies.values()],
    capApplied,
    finalTotal,
  };
}

module.exports = { calculatePrice, getActivePricingConfig, calculateTotalForIntervals, findPricePolicy, applyPricePolicy, resolvePricingBlocks };
