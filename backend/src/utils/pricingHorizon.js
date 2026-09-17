const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DEFAULT_FORECAST_HORIZON_HOURS = 24;
const MAX_FORECAST_HORIZON_HOURS = 7 * 24;

function bangkokDateParts(value = new Date()) {
  const shifted = new Date(new Date(value).getTime() + BANGKOK_OFFSET_MS);
  return {
    date: `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`,
    hour: shifted.getUTCHours(),
  };
}

function targetDateTime(date, hour) {
  if (!date || hour === undefined || hour === null) return null;
  const normalizedHour = Number(hour);
  if (!Number.isInteger(normalizedHour) || normalizedHour < 0 || normalizedHour > 23) return null;
  const target = new Date(`${date}T${String(normalizedHour).padStart(2, '0')}:00:00+07:00`);
  return Number.isNaN(target.getTime()) ? null : target;
}

function getLeadTimeHours({ date, hour, now = new Date() } = {}) {
  const target = targetDateTime(date, hour);
  return target ? (target.getTime() - new Date(now).getTime()) / (60 * 60 * 1000) : null;
}

function buildForecastHorizonMetadata({ date, hour, horizonHours = DEFAULT_FORECAST_HORIZON_HOURS, now } = {}) {
  const normalizedHorizon = Math.max(1, Math.min(MAX_FORECAST_HORIZON_HOURS, Number(horizonHours) || DEFAULT_FORECAST_HORIZON_HOURS));
  const leadTimeHours = getLeadTimeHours({ date, hour, now });
  const isReferenceOnly = leadTimeHours !== null && leadTimeHours > normalizedHorizon;
  return {
    forecastHorizonHours: normalizedHorizon,
    leadTimeHours: leadTimeHours === null ? null : Number(leadTimeHours.toFixed(2)),
    isReferenceOnly,
    isDynamicPricingEligible: !isReferenceOnly,
  };
}

module.exports = {
  DEFAULT_FORECAST_HORIZON_HOURS,
  MAX_FORECAST_HORIZON_HOURS,
  bangkokDateParts,
  targetDateTime,
  getLeadTimeHours,
  buildForecastHorizonMetadata,
};
