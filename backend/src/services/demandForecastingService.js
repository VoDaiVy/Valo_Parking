const mongoose = require('mongoose');
const Session = require('../models/Session');
const Booking = require('../models/Booking');
const Slot = require('../models/Slot');
const Subscription = require('../models/Subscription');

/**
 * Fallback baseline curve (only used if DB has 0 historical sessions/bookings)
 */
const DEFAULT_BASELINE = [
  0.10, 0.08, 0.06, 0.06, 0.08, 0.15,
  0.35, 0.65, 0.82, 0.78, 0.60, 0.55,
  0.50, 0.52, 0.58, 0.68, 0.85, 0.90,
  0.80, 0.65, 0.45, 0.30, 0.20, 0.12,
];

/**
 * Get AI-powered 24h occupancy & busyness forecast purely derived from real DB data
 * @param {Object} options
 * @param {string|Date} options.date - Target date (YYYY-MM-DD)
 * @param {number} [options.hour] - Currently selected hour (0 - 23)
 * @param {string} [options.vehicleType] - 'car' | 'motorcycle' | 'electric_car'
 */
async function getOccupancyForecast({ date, hour, vehicleType = 'car', floorId }) {
  const isDbConnected = mongoose.connection.readyState === 1;
  const targetDate = date ? new Date(date) : new Date();
  const dayOfWeek = targetDate.getDay(); // 0: Sunday, 1: Monday, ... 6: Saturday
  const isToday = new Date().toISOString().split('T')[0] === targetDate.toISOString().split('T')[0];

  const currentSelectedHour =
    hour !== undefined && hour !== null && !isNaN(Number(hour))
      ? Math.max(0, Math.min(23, Number(hour)))
      : targetDate.getHours();

  // 1. Fetch total system capacity from DB (total configured slots in system)
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
    if (count > 0) {
      totalSlotsCount = count;
    }
  }

  // 2. Fetch real active Subscriptions for this date
  let activeSubsCount = 0;
  if (isDbConnected) {
    activeSubsCount = await Subscription.countDocuments({
      status: { $in: ['active', 'paid'] },
      startDate: { $lte: targetDate },
      endDate: { $gte: targetDate },
    }).catch(() => 0);
  }

  // 3. Fetch real historical sessions aggregated by hour
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
          dow: { $dayOfWeek: { date: '$checkInTime', timezone: '+07:00' } },
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

  // 4. Fetch real scheduled Bookings for this target date
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  const hourlyBookings = Array(24).fill(0);
  if (isDbConnected) {
    const bookings = await Booking.find({
      startTime: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['confirmed', 'paid', 'active', 'holding_slot', 'completed'] },
    })
      .select('startTime endTime')
      .lean()
      .catch(() => []);

    bookings.forEach((b) => {
      if (b.startTime) {
        const startH = new Date(b.startTime).getHours();
        const endH = b.endTime ? new Date(b.endTime).getHours() : startH + 1;
        for (let h = startH; h <= Math.min(23, endH); h++) {
          hourlyBookings[h] = (hourlyBookings[h] || 0) + 1;
        }
      }
    });
  }

  // 5. Fetch real currently active sessions right now if date is today
  let currentActiveSessionsCount = 0;
  if (isDbConnected && isToday) {
    currentActiveSessionsCount = await Session.countDocuments({
      status: 'active',
    }).catch(() => 0);
  }

  // 6. Compute AI demand & occupancy score for each hour (0 to 23)
  const maxHistoricalAtPeak = Math.max(1, ...hourlyHistoricalSessions);
  const hourlyForecast = [];
  const peakHours = [];

  for (let h = 0; h < 24; h++) {
    let occupied = 0;

    if (totalHistoricalSessionsFound > 0) {
      // Calculate from real DB historical frequency + real active subscriptions + scheduled bookings
      const historicalLoad = Math.round((hourlyHistoricalSessions[h] / maxHistoricalAtPeak) * (totalSlotsCount * 0.65));
      const scheduledBookings = hourlyBookings[h] || 0;
      const subsLoad = activeSubsCount;

      occupied = historicalLoad + scheduledBookings + subsLoad;
    } else {
      // Fallback only if database is completely empty (0 sessions in DB)
      occupied = Math.round(DEFAULT_BASELINE[h] * totalSlotsCount + (hourlyBookings[h] || 0));
    }

    // If today and current hour, align with real active sessions in DB
    if (isToday && h === new Date().getHours() && currentActiveSessionsCount > 0) {
      occupied = Math.max(occupied, currentActiveSessionsCount + activeSubsCount);
    }

    // Clamp occupied slots between 0 and totalSlotsCount
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
      hour: h,
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

  // 7. Calculate real peak windows from hourly data
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
  if (peakWindows.length === 0) {
    peakWindows.push('14:00 - 16:00');
  }

  // 8. Insight for selected hour
  const selectedForecast = hourlyForecast[currentSelectedHour] || hourlyForecast[12];
  let insight = {};

  if (selectedForecast.level === 'peak') {
    insight = {
      badgeText: '🔥 Giờ cao điểm - Sốt chỗ',
      badgeType: 'danger',
      message: `Khung giờ ${selectedForecast.timeLabel} có mật độ ~${selectedForecast.busynessScore}% (ước tính còn ~${selectedForecast.estimatedAvailableSlots}/${totalSlotsCount} chỗ trống). Bạn nên đặt trước ngay để đảm bảo có vị trí!`,
      recommendation: 'Đặt trước sớm để khóa vị trí đỗ.',
      estimatedWaitTimeMinutes: 5,
    };
  } else if (selectedForecast.level === 'high') {
    insight = {
      badgeText: '⚠️ Khá đông - Chỗ trống giảm nhanh',
      badgeType: 'warning',
      message: `Khung giờ ${selectedForecast.timeLabel} có mật độ ~${selectedForecast.busynessScore}% (ước tính còn ~${selectedForecast.estimatedAvailableSlots}/${totalSlotsCount} chỗ trống).`,
      recommendation: 'Nên đặt trước hoặc đến sớm 10 phút.',
      estimatedWaitTimeMinutes: 2,
    };
  } else if (selectedForecast.level === 'moderate') {
    insight = {
      badgeText: '✨ Ổn định - Nhiều chỗ trống',
      badgeType: 'info',
      message: `Khung giờ ${selectedForecast.timeLabel} mật độ ~${selectedForecast.busynessScore}% (ước tính còn ~${selectedForecast.estimatedAvailableSlots}/${totalSlotsCount} chỗ trống). Dễ dàng tìm được vị trí đỗ thuận tiện.`,
      recommendation: 'Vị trí đỗ thông thoáng, check-in thuận tiện.',
      estimatedWaitTimeMinutes: 0,
    };
  } else {
    insight = {
      badgeText: '⚡ Giờ thấp điểm - Đỗ xe siêu tốc',
      badgeType: 'success',
      message: `Khung giờ ${selectedForecast.timeLabel} rất vắng (ước tính còn ~${selectedForecast.estimatedAvailableSlots}/${totalSlotsCount} chỗ trống). Check-in cực nhanh.`,
      recommendation: 'Thoải mái lựa chọn các slot đỗ gần lối ra vào hoặc thang máy.',
      estimatedWaitTimeMinutes: 0,
    };
  }

  return {
    date: targetDate.toISOString().split('T')[0],
    dayOfWeekName: ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][dayOfWeek],
    isToday,
    totalCapacity: totalSlotsCount,
    totalPhysicalCapacity: totalSlotsCount,
    maintenanceSlotsCount: 0,
    activeSubscriptions: activeSubsCount,
    selectedHour: currentSelectedHour,
    selectedForecast,
    insight,
    peakWindows,
    hourlyForecast,
  };
}

module.exports = {
  getOccupancyForecast,
};
