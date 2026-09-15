const mongoose = require('mongoose');
const Session = require('../models/Session');
const Booking = require('../models/Booking');
const Slot = require('../models/Slot');
const Subscription = require('../models/Subscription');

/**
 * Baseline hourly curve (used if DB has 0 historical sessions)
 */
const DEFAULT_HOURLY_BASELINE = [
  0.10, 0.08, 0.06, 0.06, 0.08, 0.15,
  0.35, 0.65, 0.82, 0.78, 0.60, 0.55,
  0.50, 0.52, 0.58, 0.68, 0.85, 0.90,
  0.80, 0.65, 0.45, 0.30, 0.20, 0.12,
];

/**
 * Baseline weekly curve: Mon, Tue, Wed, Thu, Fri, Sat, Sun
 */
const DEFAULT_WEEKLY_BASELINE = [0.45, 0.42, 0.50, 0.60, 0.85, 0.92, 0.75];

/**
 * Baseline monthly curve: 12 months (Jan - Dec)
 */
const DEFAULT_MONTHLY_BASELINE = [
  0.55, 0.60, 0.50, 0.65, 0.70, 0.80,
  0.82, 0.75, 0.58, 0.65, 0.78, 0.88,
];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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
} = {}) {
  const normalizedTimeframe = ['day', '24h', 'week', 'month', 'year'].includes(timeframe)
    ? timeframe === '24h'
      ? 'day'
      : timeframe
    : 'day';

  const isDbConnected = mongoose.connection.readyState === 1;
  const targetDate = date ? new Date(date) : new Date();
  const dayOfWeek = targetDate.getDay(); // 0: Sun, 1: Mon, ... 6: Sat
  const isToday = new Date().toISOString().split('T')[0] === targetDate.toISOString().split('T')[0];

  // 1. Capacity
  let totalSlotsCount = 54;
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
  }

  // 2. Active Subscriptions
  let activeSubsCount = 0;
  if (isDbConnected) {
    activeSubsCount = await Subscription.countDocuments({
      status: 'active',
      paymentStatus: 'paid',
      validFrom: { $lte: targetDate },
      expireAt: { $gte: targetDate },
    }).catch(() => 0);
  }

  // 3. Active Sessions right now
  let currentActiveSessionsCount = 0;
  if (isDbConnected && isToday) {
    currentActiveSessionsCount = await Session.countDocuments({
      status: 'active',
    }).catch(() => 0);
  }

  // =========================================================================
  // TIMEFRAME: DAY (24 Hours)
  // =========================================================================
  if (normalizedTimeframe === 'day') {
    const currentSelectedHour =
      hour !== undefined && hour !== null && !isNaN(Number(hour))
        ? Math.max(0, Math.min(23, Number(hour)))
        : selectedIndex !== undefined && selectedIndex !== null && !isNaN(Number(selectedIndex))
        ? Math.max(0, Math.min(23, Number(selectedIndex)))
        : targetDate.getHours();

    const hourlyHistoricalSessions = Array(24).fill(0);
    let totalHistoricalSessionsFound = 0;

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
            hour: { $hour: { date: '$checkInTime', timezone: '+07:00' } },
          },
        },
        {
          $group: {
            _id: '$hour',
            count: { $sum: 1 },
          },
        },
      ]).catch(() => []);

      sessionStats.forEach((item) => {
        if (item._id >= 0 && item._id < 24) {
          hourlyHistoricalSessions[item._id] = item.count;
          totalHistoricalSessionsFound += item.count;
        }
      });
    }

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const hourlyBookings = Array(24).fill(0);
    if (isDbConnected) {
      const bookings = await Booking.find({
        scheduledStart: { $lte: endOfDay },
        scheduledEnd: { $gte: startOfDay },
        status: { $in: ['PAID', 'ACTIVE', 'PAUSED', 'COMPLETED'] },
      })
        .select('scheduledStart scheduledEnd')
        .lean()
        .catch(() => []);

      bookings.forEach((b) => {
        if (b.scheduledStart) {
          const startH = Math.max(0, new Date(b.scheduledStart).getHours());
          const endH = b.scheduledEnd ? new Date(b.scheduledEnd).getHours() : startH + 1;
          for (let h = startH; h <= Math.min(23, endH); h++) {
            hourlyBookings[h] = (hourlyBookings[h] || 0) + 1;
          }
        }
      });
    }

    const maxHistoricalAtPeak = Math.max(1, ...hourlyHistoricalSessions);
    const hourlyForecast = [];
    const peakHours = [];

    for (let h = 0; h < 24; h++) {
      let occupied = 0;
      if (totalHistoricalSessionsFound > 0) {
        const historicalLoad = Math.round((hourlyHistoricalSessions[h] / maxHistoricalAtPeak) * (totalSlotsCount * 0.65));
        occupied = historicalLoad + (hourlyBookings[h] || 0) + activeSubsCount;
      } else {
        occupied = Math.round(DEFAULT_HOURLY_BASELINE[h] * totalSlotsCount + (hourlyBookings[h] || 0));
      }

      if (isToday && h === new Date().getHours() && currentActiveSessionsCount > 0) {
        occupied = Math.max(occupied, currentActiveSessionsCount + activeSubsCount);
      }

      occupied = Math.max(0, Math.min(totalSlotsCount, occupied));
      const busynessScore = Math.round((occupied / totalSlotsCount) * 100);
      const availableSlots = Math.max(0, totalSlotsCount - occupied);

      let level = 'low';
      if (busynessScore >= 80) level = 'peak';
      else if (busynessScore >= 60) level = 'high';
      else if (busynessScore >= 35) level = 'moderate';

      const isPeak = level === 'peak' || level === 'high';
      if (isPeak) peakHours.push(h);

      hourlyForecast.push({
        id: h,
        hour: h,
        label: `${String(h).padStart(2, '0')}:00`,
        timeLabel: `${String(h).padStart(2, '0')}:00`,
        busynessScore,
        level,
        isPeak,
        estimatedAvailableSlots: availableSlots,
        estimatedOccupiedSlots: occupied,
        activeBookings: hourlyBookings[h] || 0,
        realDbSessions: hourlyHistoricalSessions[h] || 0,
      });
    }

    const peakWindows = [];
    let windowStart = null;
    for (let h = 0; h < 24; h++) {
      if (hourlyForecast[h].isPeak) {
        if (windowStart === null) windowStart = h;
      } else {
        if (windowStart !== null) {
          peakWindows.push(`${String(windowStart).padStart(2, '0')}:00 - ${String(h).padStart(2, '0')}:00`);
          windowStart = null;
        }
      }
    }
    if (windowStart !== null) {
      peakWindows.push(`${String(windowStart).padStart(2, '0')}:00 - 23:59`);
    }
    const selectedForecast = hourlyForecast[currentSelectedHour] || hourlyForecast[12];
    const insight = buildInsight({
      label: `Time slot ${selectedForecast.timeLabel}`,
      score: selectedForecast.busynessScore,
      availableSlots: selectedForecast.estimatedAvailableSlots,
      totalSlots: totalSlotsCount,
      periodType: 'hour',
    });

    return {
      timeframe: 'day',
      date: targetDate.toISOString().split('T')[0],
      dayOfWeekName: DAY_NAMES[dayOfWeek],
      isToday,
      totalCapacity: totalSlotsCount,
      totalPhysicalCapacity: totalSlotsCount,
      maintenanceSlotsCount: 0,
      activeSubscriptions: activeSubsCount,
      selectedHour: currentSelectedHour,
      selectedIndex: currentSelectedHour,
      selectedForecast,
      selectedItem: selectedForecast,
      insight,
      peakWindows,
      dataQuality: {
        dataSource: totalHistoricalSessionsFound > 0 ? 'historical_sessions' : 'fallback_baseline',
        usesFallbackBaseline: totalHistoricalSessionsFound === 0,
        historicalSessionCount: totalHistoricalSessionsFound,
        scheduledBookingCount: hourlyBookings.reduce((sum, count) => sum + count, 0),
      },
      items: hourlyForecast,
      hourlyForecast,
    };
  }

  // =========================================================================
  // TIMEFRAME: WEEK (7 Days: Mon -> Sun)
  // =========================================================================
  if (normalizedTimeframe === 'week') {
    // Mongo $dayOfWeek: 1: Sun, 2: Mon, 3: Tue, 4: Wed, 5: Thu, 6: Fri, 7: Sat
    // We map to order: Mon(0), Tue(1), Wed(2), Thu(3), Fri(4), Sat(5), Sun(6)
    const dayIndexMapping = [6, 0, 1, 2, 3, 4, 5]; // Mongo dow -> our 0..6 index
    const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weekFullDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    const dayHistoricalSessions = Array(7).fill(0);
    let totalSessions = 0;

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
            dow: { $dayOfWeek: { date: '$checkInTime', timezone: '+07:00' } },
          },
        },
        {
          $group: {
            _id: '$dow',
            count: { $sum: 1 },
          },
        },
      ]).catch(() => []);

      sessionStats.forEach((item) => {
        const ourIndex = dayIndexMapping[item._id - 1];
        if (ourIndex !== undefined && ourIndex >= 0 && ourIndex < 7) {
          dayHistoricalSessions[ourIndex] += item.count;
          totalSessions += item.count;
        }
      });
    }

    const maxDaySessions = Math.max(1, ...dayHistoricalSessions);
    const todayWeekIndex = dayIndexMapping[dayOfWeek];
    const currentSelectedIndex =
      selectedIndex !== undefined && selectedIndex !== null && !isNaN(Number(selectedIndex))
        ? Math.max(0, Math.min(6, Number(selectedIndex)))
        : todayWeekIndex;

    const items = [];
    const peakDays = [];

    for (let i = 0; i < 7; i++) {
      let occupied = 0;
      if (totalSessions > 0) {
        const load = Math.round((dayHistoricalSessions[i] / maxDaySessions) * (totalSlotsCount * 0.75));
        occupied = load + activeSubsCount;
      } else {
        occupied = Math.round(DEFAULT_WEEKLY_BASELINE[i] * totalSlotsCount);
      }

      occupied = Math.max(0, Math.min(totalSlotsCount, occupied));
      const busynessScore = Math.round((occupied / totalSlotsCount) * 100);
      const availableSlots = Math.max(0, totalSlotsCount - occupied);

      let level = 'low';
      if (busynessScore >= 80) level = 'peak';
      else if (busynessScore >= 60) level = 'high';
      else if (busynessScore >= 35) level = 'moderate';

      const isPeak = level === 'peak' || level === 'high';
      if (isPeak) peakDays.push(weekDays[i]);

      items.push({
        id: i,
        label: weekDays[i],
        fullLabel: weekFullDays[i],
        timeLabel: weekDays[i],
        busynessScore,
        level,
        isPeak,
        isToday: i === todayWeekIndex,
        estimatedAvailableSlots: availableSlots,
        estimatedOccupiedSlots: occupied,
        totalSessions: dayHistoricalSessions[i],
      });
    }

    const selectedItem = items[currentSelectedIndex] || items[0];
    const insight = buildInsight({
      label: `${selectedItem.fullLabel}`,
      score: selectedItem.busynessScore,
      availableSlots: selectedItem.estimatedAvailableSlots,
      totalSlots: totalSlotsCount,
      periodType: 'day',
    });

    return {
      timeframe: 'week',
      date: targetDate.toISOString().split('T')[0],
      totalCapacity: totalSlotsCount,
      totalPhysicalCapacity: totalSlotsCount,
      maintenanceSlotsCount: 0,
      activeSubscriptions: activeSubsCount,
      selectedIndex: currentSelectedIndex,
      selectedItem,
      insight,
      peakWindows: peakDays.length > 0 ? [`Peak: ${peakDays.join(', ')}`] : [],
      dataQuality: {
        dataSource: totalSessions > 0 ? 'historical_sessions' : 'fallback_baseline',
        usesFallbackBaseline: totalSessions === 0,
        historicalSessionCount: totalSessions,
      },
      items,
      hourlyForecast: items, // for fallback compatibility
    };
  }

  // =========================================================================
  // TIMEFRAME: MONTH (4-5 Weeks)
  // =========================================================================
  if (normalizedTimeframe === 'month') {
    const currentMonth = targetDate.getMonth();
    const currentYear = targetDate.getFullYear();
    const monthName = MONTH_NAMES[currentMonth];

    const weeks = [
      { id: 0, label: 'Week 1', sub: 'Days 1-7' },
      { id: 1, label: 'Week 2', sub: 'Days 8-14' },
      { id: 2, label: 'Week 3', sub: 'Days 15-21' },
      { id: 3, label: 'Week 4', sub: 'Days 22-28' },
      { id: 4, label: 'Week 5', sub: 'Days 29+' },
    ];

    const weekSessions = Array(5).fill(0);
    let totalMonthSessions = 0;

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
            dom: { $dayOfMonth: { date: '$checkInTime', timezone: '+07:00' } },
            month: { $month: { date: '$checkInTime', timezone: '+07:00' } },
          },
        },
        {
          $match: {
            month: currentMonth + 1,
          },
        },
        {
          $group: {
            _id: '$dom',
            count: { $sum: 1 },
          },
        },
      ]).catch(() => []);

      sessionStats.forEach((item) => {
        const dom = item._id;
        const wIdx = Math.min(4, Math.floor((dom - 1) / 7));
        weekSessions[wIdx] += item.count;
        totalMonthSessions += item.count;
      });
    }

    const currentDom = targetDate.getDate();
    const currentWeekIdx = Math.min(4, Math.floor((currentDom - 1) / 7));
    const currentSelectedIndex =
      selectedIndex !== undefined && selectedIndex !== null && !isNaN(Number(selectedIndex))
        ? Math.max(0, Math.min(4, Number(selectedIndex)))
        : currentWeekIdx;

    const maxWeekSessions = Math.max(1, ...weekSessions);
    const monthBaseline = [0.55, 0.62, 0.70, 0.85, 0.78];
    const items = [];
    const peakWeeks = [];

    for (let i = 0; i < 5; i++) {
      let occupied = 0;
      if (totalMonthSessions > 0) {
        const load = Math.round((weekSessions[i] / maxWeekSessions) * (totalSlotsCount * 0.75));
        occupied = load + activeSubsCount;
      } else {
        occupied = Math.round(monthBaseline[i] * totalSlotsCount);
      }

      occupied = Math.max(0, Math.min(totalSlotsCount, occupied));
      const busynessScore = Math.round((occupied / totalSlotsCount) * 100);
      const availableSlots = Math.max(0, totalSlotsCount - occupied);

      let level = 'low';
      if (busynessScore >= 80) level = 'peak';
      else if (busynessScore >= 60) level = 'high';
      else if (busynessScore >= 35) level = 'moderate';

      const isPeak = level === 'peak' || level === 'high';
      if (isPeak) peakWeeks.push(weeks[i].label);

      items.push({
        id: i,
        label: weeks[i].label,
        subLabel: weeks[i].sub,
        timeLabel: `${weeks[i].label} (${monthName})`,
        busynessScore,
        level,
        isPeak,
        isCurrent: i === currentWeekIdx,
        estimatedAvailableSlots: availableSlots,
        estimatedOccupiedSlots: occupied,
        totalSessions: weekSessions[i],
      });
    }

    const selectedItem = items[currentSelectedIndex] || items[0];
    const insight = buildInsight({
      label: `${selectedItem.label} of ${monthName}`,
      score: selectedItem.busynessScore,
      availableSlots: selectedItem.estimatedAvailableSlots,
      totalSlots: totalSlotsCount,
      periodType: 'week',
    });

    return {
      timeframe: 'month',
      date: targetDate.toISOString().split('T')[0],
      monthName,
      year: currentYear,
      totalCapacity: totalSlotsCount,
      totalPhysicalCapacity: totalSlotsCount,
      maintenanceSlotsCount: 0,
      activeSubscriptions: activeSubsCount,
      selectedIndex: currentSelectedIndex,
      selectedItem,
      insight,
      peakWindows: peakWeeks.length > 0 ? [`Peak: ${peakWeeks.join(', ')}`] : [],
      dataQuality: {
        dataSource: totalMonthSessions > 0 ? 'historical_sessions' : 'fallback_baseline',
        usesFallbackBaseline: totalMonthSessions === 0,
        historicalSessionCount: totalMonthSessions,
      },
      items,
      hourlyForecast: items,
    };
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
      maintenanceSlotsCount: 0,
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
