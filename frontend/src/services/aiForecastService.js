import { apiFetch } from './api';

/**
 * Fetch 24h occupancy & busyness forecast from AI
 * @param {Object} params
 * @param {string} params.date - YYYY-MM-DD
 * @param {number} [params.hour] - 0 to 23
 * @param {string} [params.vehicleType] - 'car' | 'motorcycle' | 'electric_car'
 */
export async function getOccupancyForecast({ date, hour, vehicleType, floorId } = {}) {
  const query = new URLSearchParams();
  if (date) query.set('date', date);
  if (hour !== undefined && hour !== null) query.set('hour', String(hour));
  if (vehicleType) query.set('vehicleType', vehicleType);
  if (floorId) query.set('floorId', floorId);

  const res = await apiFetch(`/ai/occupancy-forecast?${query.toString()}`);
  if (!res.ok) {
    throw new Error(res.data?.message || 'Failed to fetch occupancy forecast');
  }
  return res.data?.data || res.data;
}
