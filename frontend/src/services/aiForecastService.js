import { apiFetch } from './api';

/**
 * Fetch AI occupancy & demand forecast
 * @param {Object} params
 * @param {string} [params.date] - YYYY-MM-DD
 * @param {number} [params.hour] - 0 to 23
 * @param {string} [params.vehicleType] - 'car' | 'motorcycle' | 'electric_car'
 * @param {string} [params.floorId] - Target floor ID
 * @param {string} [params.timeframe] - 'day' | 'week' | 'month' | 'year'
 * @param {number} [params.selectedIndex] - Selected index
 */
export async function getOccupancyForecast({
  date,
  hour,
  vehicleType,
  floorId,
  timeframe = 'day',
  selectedIndex,
} = {}) {
  const query = new URLSearchParams();
  if (date) query.set('date', date);
  if (hour !== undefined && hour !== null) query.set('hour', String(hour));
  if (vehicleType) query.set('vehicleType', vehicleType);
  if (floorId) query.set('floorId', floorId);
  if (timeframe) query.set('timeframe', timeframe);
  if (selectedIndex !== undefined && selectedIndex !== null) {
    query.set('selectedIndex', String(selectedIndex));
  }

  const res = await apiFetch(`/ai/occupancy-forecast?${query.toString()}`);
  if (!res.ok) {
    throw new Error(res.data?.message || 'Failed to fetch occupancy forecast');
  }
  return res.data?.data || res.data;
}
