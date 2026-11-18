const mongoose = require('mongoose');
const Session = require('../models/Session');
const Slot = require('../models/Slot');
const Subscription = require('../models/Subscription');

const { getDailyOccupancyForecast, getPeriodOccupancyForecast } = require('./dailyOccupancyForecast');

/**
 * Baseline monthly curve: 12 months (Jan - Dec)
 */
const DEFAULT_MONTHLY_BASELINE = [
  0.55, 0.60, 0.50, 0.65, 0.70, 0.80,
  0.82, 0.75, 0.58, 0.65, 0.78, 0.88,
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const SHORT_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Helper to compute status badge & insight from busyness score
 */
function buildInsight({ label, score, availableSlots, totalSlots, periodType = 'hour' }) {
  if (score >= 80) {
    return {
      badgeText: '🔥 Peak Period - High Demand',
      badgeType: 'danger',
      message: `${label} has ~${score}% occupancy (~${availableSlots}/${totalSlots} slots remaining). Booking in advance is strongly recommended!`,
      recommendation: 'Reserve early to secure your spot.',
      estimatedWaitTimeMinutes: 5,
    };
  }
  if (score >= 60) {
    return {
      badgeText: '⚠️ Busy - Slots Decreasing Fast',
      badgeType: 'warning',
      message: `${label} has ~${score}% occupancy (~${availableSlots}/${totalSlots} slots available).`,
      recommendation: 'Consider booking ahead or arriving 10 minutes earlier.',
      estimatedWaitTimeMinutes: 2,
    };
  }
  if (score >= 35) {
    return {
      badgeText: '✨ Moderate - Normal Availability',
      badgeType: 'info',
      message: `${label} has ~${score}% occupancy (~${availableSlots}/${totalSlots} slots available). Easy parking.`,
      recommendation: 'Normal traffic, quick check-in.',
      estimatedWaitTimeMinutes: 0,
    };
  }
  return {
    badgeText: '⚡ Off-Peak - Fast & Open Parking',
    badgeType: 'success',
    message: `${label} is very quiet (~${availableSlots}/${totalSlots} slots available). Lightning-fast check-in.`,
    recommendation: 'Feel free to pick preferred spots near entrances or elevators.',
    estimatedWaitTimeMinutes: 0,
  };
}

/**
 * Main AI-powered occupancy & busyness forecast supporting 24h, Week, Month, and Year
 * @param {Object} options
 * @param {string|Date} [options.date] - Target date (YYYY-MM-DD)
 * @param {number} [options.hour] - Currently selected hour (0 - 23)
 * @param {string} [options.vehicleType] - 'car' | 'motorcycle' | 'electric_car'
 * @param {string} [options.floorId] - Optional floor ObjectId
 * @param {string} [options.timeframe] - 'day' | '24h' | 'week' | 'month' | 'year'
 * @param {number|string} [options.selectedIndex] - Selected index for the timeframe
 */
async function getOccupancyForecast({
  date,
  hour,
  vehicleType = 'car',
  floorId,
  timeframe = 'day',
  selectedIndex,
  forecastHorizonHours = 24,
} = {}) {
  const normalizedTimeframe = ['day', '24h', 'week', 'month', 'year'].includes(timeframe)
    ? timeframe === '24h'
      ? 'day'
      : timeframe
    : 'day';

  if (normalizedTimeframe === 'day') {
    return getDailyOccupancyForecast({ date, hour, vehicleType, floorId, selectedIndex, forecastHorizonHours });
  }
  if (normalizedTimeframe === 'week' || normalizedTimeframe === 'month') {
    return getPeriodOccupancyForecast({ date, timeframe: normalizedTimeframe, vehicleType, floorId, selectedIndex });
  }

  const isDbConnected = mongoose.connection.readyState === 1;
  const targetDate = date ? new Date(date) : new Date();

  // 1. Capacity & Maintenance
  let totalSlotsCount = 54;
  let maintenanceSlotsCount = 0;
  if (isDbConnected) {
    const baseFilter = {};
    if (floorId) {
      const targetFloorObjectId = mongoose.Types.ObjectId.isValid(floorId)
        ? new mongoose.Types.ObjectId(floorId)
        : floorId;
      baseFilter.floorID = targetFloorObjectId;
    }
    const count = await Slot.countDocuments(baseFilter).catch(() => 0);
    if (count > 0) totalSlotsCount = count;
    maintenanceSlotsCount = await Slot.countDocuments({
      ...baseFilter,
      status: 'maintenance',
    }).catch(() => 0);
  }

  const effectiveCapacity = Math.max(1, totalSlotsCount - maintenanceSlotsCount);

  // 2. Active Subscriptions
  let activeSubsCount = 0;
  if (isDbConnected) {
    const subFilter = {
      status: 'active',
      paymentStatus: 'paid',
      validFrom: { $lte: targetDate },
      expireAt: { $gte: targetDate },
    };
    if (floorId) {
      subFilter['slots.floorId'] = mongoose.Types.ObjectId.isValid(floorId)
        ? new mongoose.Types.ObjectId(floorId)
        : floorId;
    }
    activeSubsCount = await Subscription.countDocuments(subFilter).catch(() => 0);
  }

  // =========================================================================
  // TIMEFRAME: YEAR (12 Months: Jan -> Dec)
  // =========================================================================
  if (normalizedTimeframe === 'year') {
    const currentYear = targetDate.getFullYear();
    const currentMonthIdx = targetDate.getMonth();

    const monthlySessions = Array(12).fill(0);
    let totalYearSessions = 0;

    if (isDbConnected) {
      const sessionStats = await Session.aggregate([
        {
          $match: {
            status: { $in: ['completed', 'active'] },
            checkInTime: { $exists: true, $ne: null },
          },
        },
        {
          $project: {
            month: { $month: { date: '$checkInTime', timezone: '+07:00' } },
          },
        },
        {
          $group: {
            _id: '$month',
            count: { $sum: 1 },
          },
        },
      ]).catch(() => []);

      sessionStats.forEach((item) => {
        if (item._id >= 1 && item._id <= 12) {
          monthlySessions[item._id - 1] = item.count;
          totalYearSessions += item.count;
        }
      });
    }

    const maxMonthSessions = Math.max(1, ...monthlySessions);
    const currentSelectedIndex =
      selectedIndex !== undefined && selectedIndex !== null && !isNaN(Number(selectedIndex))
        ? Math.max(0, Math.min(11, Number(selectedIndex)))
        : currentMonthIdx;

    const items = [];
    const peakMonths = [];

    for (let m = 0; m < 12; m++) {
      let occupied = 0;
      if (totalYearSessions > 0) {
        const load = Math.round((monthlySessions[m] / maxMonthSessions) * (totalSlotsCount * 0.8));
        occupied = load + activeSubsCount;
      } else {
        occupied = Math.round(DEFAULT_MONTHLY_BASELINE[m] * totalSlotsCount);
      }

      occupied = Math.max(0, Math.min(totalSlotsCount, occupied));
      const busynessScore = Math.round((occupied / totalSlotsCount) * 100);
      const availableSlots = Math.max(0, totalSlotsCount - occupied);

      let level = 'low';
      if (busynessScore >= 80) level = 'peak';
      else if (busynessScore >= 60) level = 'high';
      else if (busynessScore >= 35) level = 'moderate';

      const isPeak = level === 'peak' || level === 'high';
      if (isPeak) peakMonths.push(SHORT_MONTH_NAMES[m]);

      items.push({
        id: m,
        label: SHORT_MONTH_NAMES[m],
        fullLabel: MONTH_NAMES[m],
        timeLabel: `${MONTH_NAMES[m]} ${currentYear}`,
        busynessScore,
        level,
        isPeak,
        isCurrent: m === currentMonthIdx,
        estimatedAvailableSlots: availableSlots,
        estimatedOccupiedSlots: occupied,
        totalSessions: monthlySessions[m],
      });
    }

    const selectedItem = items[currentSelectedIndex] || items[0];
    const insight = buildInsight({
      label: `${selectedItem.fullLabel} (${currentYear})`,
      score: selectedItem.busynessScore,
      availableSlots: selectedItem.estimatedAvailableSlots,
      totalSlots: totalSlotsCount,
      periodType: 'month',
    });

    return {
      timeframe: 'year',
      date: targetDate.toISOString().split('T')[0],
      year: currentYear,
      totalCapacity: totalSlotsCount,
      totalPhysicalCapacity: totalSlotsCount,
      maintenanceSlotsCount,
      activeSubscriptions: activeSubsCount,
      selectedIndex: currentSelectedIndex,
      selectedItem,
      insight,
      peakWindows: peakMonths.length > 0 ? [`Peak: ${peakMonths.join(', ')}`] : [],
      dataQuality: {
        dataSource: totalYearSessions > 0 ? 'historical_sessions' : 'fallback_baseline',
        usesFallbackBaseline: totalYearSessions === 0,
        historicalSessionCount: totalYearSessions,
      },
      items,
      hourlyForecast: items,
    };
  }
}

module.exports = {
  getOccupancyForecast,
};
