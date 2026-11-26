const mongoose = require('mongoose');
const Slot = require('../models/Slot');
const Booking = require('../models/Booking');
const Session = require('../models/Session');
const Vehicle = require('../models/Vehicle');
const { normalizeLicensePlate } = require('../utils/licensePlateUtils');
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
  const unscheduled = new Map();
  const expected = () => typeof baseline === 'function' ? baseline(active, unscheduled) : baseline;
  let peak = expected();
  for (let i = 0; i < events.length;) {
    const time = events[i].time;
    while (i < events.length && events[i].time === time) {
      const { row, delta } = events[i++];
      for (const counts of row.unscheduled ? [active, unscheduled] : [active]) {
        const count = (counts.get(row.key) || 0) + delta;
        if (count) counts.set(row.key, count);
        else counts.delete(row.key);
      }
    }
    if (time < until) peak = Math.max(peak, active.size + Math.max(0, expected() - unscheduled.size));
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

// Join exact identifiers only, including a booking's link to its actual session.
// Slot assignments are deliberately absent from this identity graph.
function vehicleKeys(sessions, bookings) {
  const parents = new Map();
  const root = key => {
    if (!parents.has(key)) parents.set(key, key);
    if (parents.get(key) !== key) parents.set(key, root(parents.get(key)));
    return parents.get(key);
  };
  const keys = new Map();
  for (const [kind, rows] of [['session', sessions], ['booking', bookings]]) {
    rows.forEach((row, index) => {
      const plate = normalizeLicensePlate(row.licensePlate);
      const aliases = [row.vehicleId && `vehicle:${row.vehicleId}`, plate && `plate:${plate}`,
        (kind === 'booking' ? row._id : row.bookingId) && `booking:${kind === 'booking' ? row._id : row.bookingId}`,
        `${kind}:${row._id || row.entryIdempotencyKey || index}`].filter(Boolean);
      for (const alias of aliases) parents.set(root(alias), root(aliases[0]));
      keys.set(row, aliases[0]);
    });
  }
  return row => root(keys.get(row));
}

// Merge duplicate/overlapping observations before deriving dwell-time samples.
function mergeIntervals(rows) {
  const merged = [];
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.key}:${row.floorId}:${row.vehicleType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const group of groups.values()) {
    let previous;
    for (const row of group.sort((a, b) => a.start - b.start)) {
      if (previous && row.start < previous.end) previous.end = Math.max(previous.end, row.end);
      else { previous = { ...row }; merged.push(previous); }
    }
  }
  return merged;
}

function prepareOccupancy({ now, capacitySlots, maintenance, sessions, bookings, floorId, vehicleType = 'car' }) {
  const today = targetDateTime(bangkokDateParts(now).date, 0).getTime();
  const physicalKeys = new Set(capacitySlots.map(row => slotKey(row.floorId, row.slotCode)));
  const maintained = new Set(maintenance.map(row => slotKey(row.floorID, row.slotNumber)).filter(key => physicalKeys.has(key)));
  const capacity = physicalKeys.size - maintained.size;
  const keyFor = vehicleKeys(sessions, bookings);
  const matches = row => (!floorId || String(row.floorId) === String(floorId))
    && (vehicleType === 'all' || row.vehicleType === vehicleType);
  const valid = row => Number.isFinite(row.start) && Number.isFinite(row.end) && row.start > 0 && row.end > row.start;
  const reserved = bookings.filter(row => (!row.status || ['PAID', 'ACTIVE', 'PAUSED'].includes(row.status)) && matches(row)).map(row => ({
    key: keyFor(row), bookingId: String(row._id || ''),
    start: +new Date(row.scheduledStart), end: +new Date(row.scheduledEnd),
  })).filter(valid);
  const observed = sessions.filter(row => ['active', 'completed'].includes(row.status) && matches(row)).map(row => ({
    key: keyFor(row), floorId: String(row.floorId), vehicleType: row.vehicleType,
    bookingId: row.bookingId && String(row.bookingId),
    start: +new Date(row.checkInTime),
    end: row.status === 'active' ? now.getTime() + 1 : +new Date(row.checkOutTime),
    completed: row.status === 'completed',
    // Subscription visits have no separately scheduled booking demand.
    unscheduled: !row.bookingId && row.type !== 'BOOKING',
  })).filter(valid);
  // A fixed evidence window keeps departure estimates identical across request periods.
  const dwellSamples = mergeIntervals(observed.filter(row => row.completed && row.end <= +now
    && row.start >= +now - HISTORY_WEEKS * 7 * DAY));
  let unsupportedActiveSessions = 0;
  const intervals = observed.map(row => {
    if (row.completed) return row;
    const booking = reserved.find(candidate => candidate.end > +now
      && (row.bookingId ? candidate.bookingId === row.bookingId : candidate.key === row.key && candidate.start <= +now));
    if (booking) return { ...row, end: booking.end, departureSource: 'booking' };
    const elapsed = +now - row.start;
    const durations = dwellSamples.filter(sample => sample.floorId === row.floorId && sample.vehicleType === row.vehicleType)
      .map(sample => sample.end - sample.start).filter(duration => duration > elapsed);
    if (durations.length >= MIN_SAMPLE_DAYS) {
      return { ...row, end: row.start + durations.reduce((sum, duration) => sum + duration, 0) / durations.length,
        departureSource: 'historical_dwell' };
    }
    unsupportedActiveSessions++;
    return { ...row, departureSource: 'observed_only' };
  });
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
      return sum + peakOccupancy(sample.sessions.filter(row => row.unscheduled), from, from + HOUR);
    }, 0) / recordedDays.length) : [];
    const profile = {
      hasHistory, baseline, dayCount: recordedDays.length,
      sessionCount: mergeIntervals([...new Set(recordedDays.flatMap(sample => sample.sessions))]).length,
    };
    const adjusted = new Map();
    profile.expectedDemand = (hour, active, unscheduled) => {
      // A vehicle historically using walk-in/subscription parking may book today.
      // Remove its historical contribution while its confirmed interval is active.
      const scheduledKeys = [...active.keys()].filter(key => !unscheduled.has(key)).sort();
      if (!scheduledKeys.length) return Math.round(baseline[hour]);
      const cacheKey = JSON.stringify([hour, scheduledKeys]);
      if (!adjusted.has(cacheKey)) {
        const excluded = new Set(scheduledKeys);
        adjusted.set(cacheKey, Math.round(recordedDays.reduce((sum, sample) => {
          const from = sample.day + hour * HOUR;
          return sum + peakOccupancy(sample.sessions.filter(row => row.unscheduled && !excluded.has(row.key)), from, from + HOUR);
        }, 0) / recordedDays.length));
      }
      return adjusted.get(cacheKey);
    };
    profiles.set(profileKey, profile);
    return profile;
  }

  return {
    today, intervals, reserved, historyFor, unsupportedActiveSessions,
    totalCapacity: capacity, totalPhysicalCapacity: physicalKeys.size, maintenanceSlotsCount: maintained.size,
  };
}

function buildHours(start, now, prepared) {
  const { today, totalCapacity: capacity } = prepared;
  const { hasHistory, expectedDemand } = prepared.historyFor(start);
  const findForDay = rows => rows.filter(row => overlap(row, start, start + DAY));
  const sessions = findForDay(prepared.intervals);
  const bookings = findForDay(prepared.reserved);
  const unresolved = prepared.intervals.filter(row => row.departureSource === 'observed_only');

  return Array.from({ length: 24 }, (_, hour) => {
    const from = start + hour * HOUR;
    const until = from + HOUR;
    const isPast = until <= now.getTime();
    const knownSessions = sessions.filter(row => overlap(row, from, until));
    const knownBookings = isPast ? [] : bookings.filter(row => overlap(row, from, until));
    const historicalDemand = hasHistory && !isPast ? (active, unscheduled) => expectedDemand(hour, active, unscheduled) : 0;
    const occupied = peakOccupancy([...knownSessions, ...knownBookings], from, until, historicalDemand);
    // These are independent per-bucket scenarios, not predicted checkout times
    // or an assumption that an unresolved vehicle stays for the whole horizon.
    const possiblyPresent = isPast ? [] : unresolved.map(row => ({
      ...row, start: Math.max(row.start, +now, from), end: until,
    })).filter(row => row.start < row.end);
    const possibleDemand = Math.max(occupied,
      peakOccupancy([...knownSessions, ...knownBookings, ...possiblyPresent], from, until, historicalDemand));
    const uncertainty = buildUncertainty(occupied, possibleDemand,
      new Set(possiblyPresent.map(row => row.key)).size, capacity, hasHistory && !isPast);
    const score = capacity ? Math.min(100, Math.round(occupied / capacity * 100)) : null;
    const level = score >= 80 ? 'peak' : score >= 60 ? 'high' : score >= 35 ? 'moderate' : 'low';
    const label = `${String(hour).padStart(2, '0')}:00`;
    return {
      id: hour, hour, label, timeLabel: label, busynessScore: score, level,
      dataKind: isPast ? (knownSessions.length ? 'recorded' : 'known_only') : hasHistory ? 'estimated' : 'known_only',
      isPeak: Boolean(capacity && score >= 80 && (start < today || (!isPast && hasHistory))),
      predictedVehicles: occupied,
      estimatedOccupiedSlots: occupied, estimatedAvailableSlots: uncertainty.availableSpacesRange?.min ?? null,
      uncertainty,
      activeBookings: peakOccupancy(knownBookings, from, until),
    };
  });
}

function buildUncertainty(predicted, possible, unresolvedActiveVehicles, capacity, hasAvailability) {
  return {
    unresolvedActiveVehicles,
    reason: unresolvedActiveVehicles ? 'unsupported_active_departure' : null,
    predictedVehiclesRange: { min: predicted, max: possible },
    availableSpacesRange: hasAvailability ? {
      min: Math.max(0, capacity - possible), max: Math.max(0, capacity - predicted),
    } : null,
  };
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
      countingUnit: 'vehicles', holdsIncluded: false,
      unsupportedActiveSessions: prepared.unsupportedActiveSessions,
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
  const [inventory, maintenance, sessions] = await Promise.all([
    getGeneralBookableSlots(),
    Slot.find({ ...(floorId ? { floorID: floorId } : {}), retired: { $ne: true }, status: 'maintenance' }).select('floorID slotNumber').lean(),
    Session.find({ ...scope, checkInTime: { $lt: end }, $or: [
      { status: 'completed', checkOutTime: { $gt: since } }, { status: 'active' },
    ] }).select('vehicleId licensePlate entryIdempotencyKey floorId vehicleType status type bookingId checkInTime checkOutTime').lean(),
  ]);
  const bookings = await Booking.find({ ...scope, status: { $in: ['PAID', 'ACTIVE', 'PAUSED'] }, $or: [
    { scheduledStart: { $lt: end }, scheduledEnd: { $gt: start } },
    { _id: { $in: sessions.filter(row => row.status === 'active' && row.bookingId).map(row => row.bookingId) } },
  ] }).select('vehicleId licensePlate floorId status scheduledStart scheduledEnd').lean();
  // Booking has no vehicleType snapshot. Resolve it from an actual linked session
  // or registered vehicle, never from the assigned slot's type.
  const vehicleIds = [...new Set(bookings.filter(row => row.vehicleId).map(row => String(row.vehicleId)))];
  const plates = [...new Set(bookings.map(row => normalizeLicensePlate(row.licensePlate)).filter(Boolean))];
  const vehicles = vehicleIds.length || plates.length ? await Vehicle.find({ $or: [
    { _id: { $in: vehicleIds } }, { licensePlate: { $in: plates } },
  ] }).select('licensePlate vehicleType').lean() : [];
  const typedSessions = sessions.filter(session => session.vehicleType)
    .sort((a, b) => +new Date(b.checkInTime) - +new Date(a.checkInTime));
  for (const row of bookings) {
    const linked = typedSessions.find(session => session.bookingId && String(session.bookingId) === String(row._id))
      || typedSessions.find(session => row.vehicleId && session.vehicleId && String(session.vehicleId) === String(row.vehicleId))
      || typedSessions.find(session => normalizeLicensePlate(row.licensePlate)
        && normalizeLicensePlate(session.licensePlate) === normalizeLicensePlate(row.licensePlate));
    const vehicle = vehicles.find(vehicle => (row.vehicleId && String(vehicle._id) === String(row.vehicleId))
      || (normalizeLicensePlate(row.licensePlate) && normalizeLicensePlate(vehicle.licensePlate) === normalizeLicensePlate(row.licensePlate)));
    row.vehicleType = linked?.vehicleType || vehicle?.vehicleType;
  }
  const capacitySlots = inventory.filter(row => {
    const type = String(row.slotType).toLowerCase();
    return vehicleType !== 'motorcycle' && (!floorId || String(row.floorId) === String(floorId))
      && (type === 'slot' || (['all', 'electric_car'].includes(vehicleType) && type === 'slot-ev'));
  });
  return { capacitySlots, maintenance, sessions, bookings, floorId, vehicleType };
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
    // Use peak concurrent vehicle demand, never summed hourly traffic.
    const peak = hours.reduce((current, next) =>
      next.estimatedOccupiedSlots > current.estimatedOccupiedSlots ? next : current);
    const uncertainty = buildUncertainty(peak.predictedVehicles,
      Math.max(...hours.map(hour => hour.uncertainty.predictedVehiclesRange.max)),
      Math.max(...hours.map(hour => hour.uncertainty.unresolvedActiveVehicles)),
      prepared.totalCapacity, peak.estimatedAvailableSlots !== null);
    return {
      ...peak, id, date: bangkokDateParts(day).date, peakHour: peak.timeLabel,
      uncertainty, estimatedAvailableSlots: uncertainty.availableSpacesRange?.min ?? null,
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
    dataQuality: { dataSource: 'daily_occupancy', usesFallbackBaseline: false, countingUnit: 'vehicles',
      holdsIncluded: false, unsupportedActiveSessions: prepared.unsupportedActiveSessions },
  };
}

async function getPeriodOccupancyForecast({ date, timeframe, selectedIndex, floorId, vehicleType, now = new Date() }) {
  const { localDate } = validateScope({ date, floorId, now });
  const { start, dayCount } = getPeriodBounds(localDate, timeframe);
  const inputs = await getOccupancyInputs({ start, end: new Date(+start + dayCount * DAY), floorId, vehicleType, now });
  return buildPeriodOccupancyForecast({ date: localDate, timeframe, now, selectedIndex, ...inputs });
}

module.exports = { getDailyOccupancyForecast, buildDailyOccupancyForecast, getPeriodOccupancyForecast, buildPeriodOccupancyForecast };
