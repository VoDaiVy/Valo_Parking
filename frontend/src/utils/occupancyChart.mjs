const OCCUPANCY_KINDS = ['recorded', 'estimated', 'known_only'];

export function readOccupancyChart(data, timeframe = 'day') {
  if (timeframe !== 'day') {
    const days = data?.dailyForecast;
    const validCount = timeframe === 'week' ? days?.length === 7 : days?.length >= 28 && days.length <= 31;
    if (data?.timeframe !== timeframe || !Array.isArray(days) || !validCount
      || data.dataQuality?.usesFallbackBaseline !== false
      || !days.every((day, index) => day?.id === index && /^\d{4}-\d{2}-\d{2}$/.test(day.date)
        && OCCUPANCY_KINDS.includes(day.dataKind))) return null;
    return { kind: 'occupancy', days };
  }

  const hours = data?.hourlyForecast;
  if (!Array.isArray(hours) || hours.length !== 24 || !hours.every((hour, index) => hour?.hour === index)) {
    return null;
  }

  if (hours.every(hour => OCCUPANCY_KINDS.includes(hour.dataKind)) && !data.dataQuality?.usesFallbackBaseline) {
    return { kind: 'occupancy', hours };
  }

  // Earlier responses exposed real arrivals alongside modeled occupancy.
  // Use only the observed counts until the API supplies occupancy intervals.
  if (data.dataQuality?.usesFallbackBaseline === false
    && data.dataQuality.dataSource === 'historical_sessions'
    && hours.every(hour => hour.dataKind == null && Number.isInteger(hour.realDbSessions) && hour.realDbSessions >= 0)) {
    const peakArrivals = Math.max(...hours.map(hour => hour.realDbSessions));
    if (peakArrivals > 0) return { kind: 'arrivals', hours, peakArrivals };
  }

  return null;
}

// Resolve every summary metric from the same chart point, never top-level summaries.
export function selectOccupancyPoint(points, index) {
  return points?.[Number.isInteger(index) ? index : 0] ?? points?.[0] ?? null;
}
