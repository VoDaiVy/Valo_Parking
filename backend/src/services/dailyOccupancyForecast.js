const mongoose = require('mongoose');
const Slot = require('../models/Slot');
const Booking = require('../models/Booking');
const Session = require('../models/Session');
const BookingHold = require('../models/BookingHold');
const { bangkokDateParts, targetDateTime, buildForecastHorizonMetadata } = require('../utils/pricingHorizon');

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const HISTORY_WEEKS = 8;
const MIN_SAMPLE_DAYS = 3;
const slotKey = (floor, code) => `${floor}:${String(code || '').trim().toUpperCase()}`;
const overlap = (row, from, until) => row.start < until && row.end > from;
const weekdayFormatter = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Bangkok', weekday: 'long' });

// Half-open intervals: departures at a timestamp precede arrivals there.
// Reference counts deduplicate records without losing a longer overlapping record.
function peakOccupancy(rows, from, until, baseline = 0) {
  const events = [];
  for (const row of rows) {
    if (!overlap(row, from, until)) continue;
    events.push({ time: Math.max(from, row.start), row, delta: 1 });
    events.push({ time: Math.min(until, row.end), row, delta: -1 });
  }
  events.sort((a, b) => a.time - b.time);
  const active = new Map();
  const walkIns = new Map();
  let peak = baseline;
  for (let i = 0; i < events.length;) {
    const time = events[i].time;
    while (i < events.length && events[i].time === time) {
      const { row, delta } = events[i++];
      for (const counts of row.walkIn ? [active, walkIns] : [active]) {
        const count = (counts.get(row.key) || 0) + delta;
        if (count) counts.set(row.key, count);
        else counts.delete(row.key);
      }
    }
    if (time < until) peak = Math.max(peak, active.size + Math.max(0, baseline - walkIns.size));
  }
  return peak;
}

const validateScope = ({ date, floorId, now }) => {
  const localDate = date || bangkokDateParts(now).date;
  const start = targetDateTime(localDate, 0);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !start || bangkokDateParts(start).date !== localDate
    || (floorId && !mongoose.isValidObjectId(floorId))) {
    throw Object.assign(new Error('Invalid forecast date or floor.'), { statusCode: 400 });
  }
  return { localDate, start };
};

function prepareOccupancy({ now, capacitySlots, maintenance, sessions, bookings, holds }) {
  const today = targetDateTime(bangkokDateParts(now).date, 0).getTime();
  const physicalKeys = new Set(capacitySlots.map(row => slotKey(row.floorId, row.slotCode)));
  const maintained = new Set(maintenance.map(row => slotKey(row.floorID, row.slotNumber)).filter(key => physicalKeys.has(key)));
  const capacity = physicalKeys.size - maintained.size;
  const usable = row => physicalKeys.has(row.key) && !maintained.has(row.key);
  const intervals = sessions.filter(row => ['active', 'completed'].includes(row.status)).map(row => ({
    key: slotKey(row.floorId, row.parkingSlot),
    start: +new Date(row.checkInTime),
    end: row.status === 'active' ? now.getTime() + 1 : +new Date(row.checkOutTime),
    completed: row.status === 'completed',
    walkIn: !row.bookingId && !['BOOKING', 'SUBSCRIPTION'].includes(row.type),
  })).filter(row => usable(row) && row.start > 0 && row.end > row.start);
  const reserved = bookings.map(row => ({
    key: slotKey(row.floorId, row.parkingSlot), start: +new Date(row.scheduledStart), end: +new Date(row.scheduledEnd),
  })).filter(usable);
  const temporary = holds.map(row => ({
    key: slotKey(row.floorId, row.slotCode), start: +new Date(row.startTime), end: +new Date(row.endTime), expiresAt: +new Date(row.expiresAt),
  })).filter(usable);
  const profiles = new Map();

  function historyFor(date) {
    const weekday = new Date(date + 7 * HOUR).getUTCDay();
    const cutoff = Math.min(today, date);
    const profileKey = `${weekday}:${cutoff}`;
    if (profiles.has(profileKey)) return profiles.get(profileKey);
    const historic = intervals.filter(row => row.completed && row.end <= cutoff);
    const daysBack = (new Date(cutoff + 7 * HOUR).getUTCDay() - weekday + 7) % 7 || 7;
    const sampleDays = Array.from({ length: HISTORY_WEEKS }, (_, index) => cutoff - (daysBack + index * 7) * DAY);
    const recordedDays = sampleDays.map(day => ({
      day, sessions: historic.filter(row => overlap(row, day, day + DAY)),
    })).filter(sample => sample.sessions.length > 0);
    const hasHistory = recordedDays.length >= MIN_SAMPLE_DAYS;
    const baseline = hasHistory ? Array.from({ length: 24 }, (_, hour) => recordedDays.reduce((sum, sample) => {
      const from = sample.day + hour * HOUR;
      return sum + peakOccupancy(sample.sessions.filter(row => row.walkIn), from, from + HOUR);
    }, 0) / recordedDays.length) : [];
    const profile = {
      hasHistory, baseline, dayCount: recordedDays.length,
      sessionCount: new Set(recordedDays.flatMap(sample => sample.sessions)).size,
    };
    profiles.set(profileKey, profile);
    return profile;
  }

  return {
    today, intervals, reserved, temporary, historyFor,
    totalCapacity: capacity, totalPhysicalCapacity: physicalKeys.size, maintenanceSlotsCount: maintained.size,
  };
}

function buildHours(start, now, prepared) {
  const { today, totalCapacity: capacity } = prepared;
  const { hasHistory, baseline } = prepared.historyFor(start);
  const findForDay = rows => rows.filter(row => overlap(row, start, start + DAY));
  const sessions = findForDay(prepared.intervals);
  const bookings = findForDay(prepared.reserved);
  const holds = findForDay(prepared.temporary);

  return Array.from({ length: 24 }, (_, hour) => {
    const from = start + hour * HOUR;
    const until = from + HOUR;
    const isPast = until <= now.getTime();
    const knownSessions = sessions.filter(row => overlap(row, from, until));
    const knownBookings = isPast ? [] : bookings.filter(row => overlap(row, from, until));
    const knownHolds = isPast ? [] : holds
      .filter(row => row.expiresAt > Math.max(now.getTime(), from))
      .map(row => ({ ...row, start: Math.max(row.start, now.getTime()), end: Math.min(row.end, row.expiresAt) }))
      .filter(row => row.end > row.start && overlap(row, from, until));
    const historicalWalkIns = hasHistory && !isPast ? Math.round(baseline[hour]) : 0;
    const occupied = Math.min(capacity, peakOccupancy([...knownSessions, ...knownBookings, ...knownHolds], from, until, historicalWalkIns));
    const score = capacity ? Math.round(occupied / capacity * 100) : null;
    const level = score >= 80 ? 'peak' : score >= 60 ? 'high' : score >= 35 ? 'moderate' : 'low';
    const label = `${String(hour).padStart(2, '0')}:00`;
    return {
      id: hour, hour, label, timeLabel: label, busynessScore: score, level,
      dataKind: isPast ? (knownSessions.length ? 'recorded' : 'known_only') : hasHistory ? 'estimated' : 'known_only',
      isPeak: Boolean(capacity && score >= 80 && (start < today || (!isPast && hasHistory))),
      estimatedOccupiedSlots: occupied, estimatedAvailableSlots: hasHistory && !isPast ? capacity - occupied : null,
      activeBookings: peakOccupancy(knownBookings, from, until),
    };
  });
}

function buildDailyOccupancyForecast({ start, now, selectedHour, forecastHorizonHours, ...inputs }) {
  const prepared = prepareOccupancy({ now, ...inputs });
  const { today, totalCapacity, totalPhysicalCapacity, maintenanceSlotsCount, reserved } = prepared;
  const localDate = bangkokDateParts(start).date;
  const { hasHistory, dayCount, sessionCount } = prepared.historyFor(+start);
  const hourlyForecast = buildHours(+start, now, prepared);
  const peakWindows = [];
  let peakStart = null;
  for (let hour = 0; hour <= 24; hour++) {
    if (hourlyForecast[hour]?.isPeak) peakStart ??= hour;
    else if (peakStart !== null) {
      peakWindows.push(`${String(peakStart).padStart(2, '0')}:00 - ${String(hour).padStart(2, '0')}:00`);
      peakStart = null;
    }
  }
  const selected = hourlyForecast[selectedHour];
  return {
    ...buildForecastHorizonMetadata({ date: localDate, hour: selectedHour, now, horizonHours: forecastHorizonHours }),
    timeframe: 'day', date: localDate, dayOfWeekName: weekdayFormatter.format(start),
    isToday: +start === today, totalCapacity, totalPhysicalCapacity, maintenanceSlotsCount,
    selectedHour, selectedIndex: selectedHour, selectedForecast: selected, selectedItem: selected,
    peakWindows, hourlyForecast, items: hourlyForecast,
    dataQuality: {
      dataSource: hasHistory ? 'historical_sessions' : 'known_intervals_only',
      usesFallbackBaseline: false, historicalDayCount: dayCount, minimumHistoricalDays: MIN_SAMPLE_DAYS,
      historicalSessionCount: sessionCount,
      scheduledBookingCount: reserved.length,
    },
  };
}

async function getOccupancyInputs({ start, end, floorId, vehicleType, now }) {
  vehicleType ??= 'car';
  if (!['car', 'electric_car', 'motorcycle', 'all'].includes(vehicleType)) {
    throw Object.assign(new Error('Invalid forecast vehicle type.'), { statusCode: 400 });
  }
  if (mongoose.connection.readyState !== 1) throw Object.assign(new Error('Forecast data is unavailable.'), { statusCode: 503 });
  const since = new Date(Math.min(start.getTime(), now.getTime()) - (HISTORY_WEEKS + 1) * 7 * DAY);
  const scope = floorId ? { floorId } : {};
  // Reuse the published hourly inventory and the same dedicated-space exclusions as booking.
  const { getGeneralBookableSlots } = require('../controllers/bookingController');
  const [inventory, maintenance, sessions, bookings, holds] = await Promise.all([
    getGeneralBookableSlots(),
    Slot.find({ ...(floorId ? { floorID: floorId } : {}), retired: { $ne: true }, status: 'maintenance' }).select('floorID slotNumber').lean(),
    Session.find({ ...scope, checkInTime: { $lt: end }, $or: [
      { status: 'completed', checkOutTime: { $gt: since } }, { status: 'active' },
    ] }).select('floorId parkingSlot status type bookingId checkInTime checkOutTime').lean(),
    Booking.find({ ...scope, status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] }, scheduledStart: { $lt: end }, scheduledEnd: { $gt: start } })
      .select('floorId parkingSlot scheduledStart scheduledEnd').lean(),
    BookingHold.find({ ...scope, status: 'active', expiresAt: { $gt: now }, startTime: { $lt: end }, endTime: { $gt: start } })
      .select('floorId slotCode startTime endTime expiresAt').lean(),
  ]);
  const capacitySlots = inventory.filter(row => {
    const type = String(row.slotType).toLowerCase();
    return vehicleType !== 'motorcycle' && (!floorId || String(row.floorId) === String(floorId))
      && (type === 'slot' || (['all', 'electric_car'].includes(vehicleType) && type === 'slot-ev'));
  });
  return { capacitySlots, maintenance, sessions, bookings, holds };
}

async function getDailyOccupancyForecast({ date, hour, selectedIndex, floorId, vehicleType, forecastHorizonHours, now = new Date() }) {
  const { start } = validateScope({ date, floorId, now });
  const currentHour = bangkokDateParts(now).hour;
  const selected = Number(hour ?? selectedIndex ?? currentHour);
  const selectedHour = Number.isInteger(selected) && selected >= 0 && selected < 24 ? selected : currentHour;
  const inputs = await getOccupancyInputs({ start, end: new Date(+start + DAY), floorId, vehicleType, now });
  return buildDailyOccupancyForecast({ start, now, ...inputs, selectedHour, forecastHorizonHours });
}

function getPeriodBounds(date, timeframe) {
  if (timeframe === 'week') return { start: targetDateTime(date, 0), dayCount: 7 };
  const [year, month] = date.split('-').map(Number);
  return {
    start: targetDateTime(`${date.slice(0, 7)}-01`, 0),
    dayCount: new Date(Date.UTC(year, month, 0)).getUTCDate(),
  };
}

function buildPeriodOccupancyForecast({ date, timeframe, now, selectedIndex, ...inputs }) {
  const { start, dayCount } = getPeriodBounds(date, timeframe);
  const prepared = prepareOccupancy({ now, ...inputs });
  const items = Array.from({ length: dayCount }, (_, id) => {
    const day = +start + id * DAY;
    const hours = buildHours(day, now, prepared);
    // Use the busiest single hour so the same space cannot stack across the day.
    const peak = hours.reduce((current, next) =>
      next.estimatedOccupiedSlots > current.estimatedOccupiedSlots ? next : current);
    return {
      ...peak, id, date: bangkokDateParts(day).date, peakHour: peak.timeLabel, estimatedAvailableSlots: null,
    };
  });
  const selected = selectedIndex == null ? NaN : Number(selectedIndex);
  const index = Number.isInteger(selected) && items[selected]
    ? selected : items.findIndex(item => item.date === date);
  const { totalCapacity, totalPhysicalCapacity, maintenanceSlotsCount } = prepared;
  return {
    timeframe, date, startDate: items[0].date, endDate: items.at(-1).date,
    totalCapacity, totalPhysicalCapacity, maintenanceSlotsCount,
    selectedIndex: index, selectedItem: items[index], items, dailyForecast: items,
    dataQuality: { dataSource: 'daily_occupancy', usesFallbackBaseline: false },
  };
}

async function getPeriodOccupancyForecast({ date, timeframe, selectedIndex, floorId, vehicleType, now = new Date() }) {
  const { localDate } = validateScope({ date, floorId, now });
  const { start, dayCount } = getPeriodBounds(localDate, timeframe);
  const inputs = await getOccupancyInputs({ start, end: new Date(+start + dayCount * DAY), floorId, vehicleType, now });
  return buildPeriodOccupancyForecast({ date: localDate, timeframe, now, selectedIndex, ...inputs });
}

module.exports = { getDailyOccupancyForecast, buildDailyOccupancyForecast, getPeriodOccupancyForecast, buildPeriodOccupancyForecast };
