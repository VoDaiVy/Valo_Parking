import { useEffect, useState, useMemo } from 'react';
import {
  Sparkles,
  TrendingUp,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { getOccupancyForecast } from '../services/aiForecastService';

export default function AIBusynessForecast({
  selectedDate,
  selectedHour,
  vehicleType = 'car',
  floorId,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hoveredHour, setHoveredHour] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const loadingTimer = setTimeout(() => {
      if (isMounted) {
        setLoading(true);
        setError(null);
      }
    }, 0);

    getOccupancyForecast({
      date: selectedDate,
      hour: selectedHour,
      vehicleType,
      floorId,
      timeframe: 'day',
    })
      .then((res) => {
        if (isMounted) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.warn('[AI Forecast] Failed to fetch forecast:', err);
          setError('Failed to load forecast');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      clearTimeout(loadingTimer);
    };
  }, [selectedDate, selectedHour, vehicleType, floorId]);

  const activeHour =
    hoveredHour !== null
      ? hoveredHour
      : selectedHour !== undefined && selectedHour !== null
      ? Number(selectedHour)
      : data?.selectedHour !== undefined
      ? data.selectedHour
      : 12;

  const activeForecast = useMemo(() => {
    if (!data?.hourlyForecast || !Array.isArray(data.hourlyForecast)) return null;
    return data.hourlyForecast.find((f) => f.hour === activeHour) || data.selectedForecast;
  }, [data, activeHour]);

  const activeInsight = useMemo(() => {
    if (!activeForecast) return data?.insight || {};
    const totalCap = data?.totalCapacity || 54;

    if (activeForecast.level === 'peak') {
      return {
        badgeText: '🔥 Peak Hours - High Demand',
        badgeType: 'danger',
        message: `Time slot ${activeForecast.timeLabel} has ~${activeForecast.busynessScore}% occupancy (~${activeForecast.estimatedAvailableSlots}/${totalCap} slots remaining). Booking in advance is recommended!`,
      };
    }
    if (activeForecast.level === 'high') {
      return {
        badgeText: '⚠️ Busy - Slots Decreasing Fast',
        badgeType: 'warning',
        message: `Time slot ${activeForecast.timeLabel} has ~${activeForecast.busynessScore}% occupancy (~${activeForecast.estimatedAvailableSlots}/${totalCap} slots available).`,
      };
    }
    if (activeForecast.level === 'moderate') {
      return {
        badgeText: '✨ Moderate - Normal Availability',
        badgeType: 'info',
        message: `Time slot ${activeForecast.timeLabel} has ~${activeForecast.busynessScore}% occupancy (~${activeForecast.estimatedAvailableSlots}/${totalCap} slots available). Easy parking.`,
      };
    }
    return {
      badgeText: '⚡ Off-Peak - Fast & Open Parking',
      badgeType: 'success',
      message: `Time slot ${activeForecast.timeLabel} is very quiet (~${activeForecast.estimatedAvailableSlots}/${totalCap} slots available). Lightning-fast check-in.`,
    };
  }, [activeForecast, data]);

  // Color mapping based on busyness score
  const getBarColor = (score, isSelected) => {
    if (score >= 80)
      return isSelected
        ? 'bg-rose-500 shadow-md shadow-rose-500/30 ring-2 ring-rose-400'
        : 'bg-rose-400/80';
    if (score >= 60)
      return isSelected
        ? 'bg-amber-500 shadow-md shadow-amber-500/30 ring-2 ring-amber-400'
        : 'bg-amber-400/80';
    if (score >= 35)
      return isSelected
        ? 'bg-yellow-400 shadow-md shadow-yellow-400/30 ring-2 ring-yellow-300'
        : 'bg-yellow-300/80';
    return isSelected
      ? 'bg-emerald-500 shadow-md shadow-emerald-500/30 ring-2 ring-emerald-400'
      : 'bg-emerald-400/80';
  };

  const getBadgeStyle = (type) => {
    switch (type) {
      case 'danger':
        return 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/40 text-rose-800 dark:text-rose-300';
      case 'warning':
        return 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-300';
      case 'success':
        return 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-300';
      default:
        return 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900/40 text-blue-800 dark:text-blue-300';
    }
  };

  if (loading && !data) {
    return (
      <div className="bg-white dark:bg-charcoal border border-gray-200 dark:border-white/10 rounded-2xl p-5 shadow-sm animate-pulse">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 rounded-full bg-gold/20" />
          <div className="h-4 w-48 bg-gray-200 dark:bg-white/10 rounded" />
        </div>
        <div className="h-28 bg-gray-100 dark:bg-white/5 rounded-xl" />
      </div>
    );
  }

  if (error || !data || !Array.isArray(data.hourlyForecast)) {
    return null;
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-[#15161A] border border-gray-200 dark:border-white/10 p-4 sm:p-5 shadow-sm dark:shadow-xl transition-colors duration-200">
      
      {/* Background ambient decorative gold glow */}
      <div className="absolute top-0 right-0 -mr-16 -mt-16 w-48 h-48 rounded-full bg-gold/10 blur-3xl pointer-events-none" />

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gold/15 dark:bg-gold/20 flex items-center justify-center text-yellow-700 dark:text-gold font-bold shadow-sm">
            <Sparkles size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-extrabold text-gray-900 dark:text-white tracking-tight">
                AI Occupancy &amp; Peak Times Forecast
              </h4>
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-gold/15 text-yellow-800 dark:text-gold border border-gold/30">
                Popular Times
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-medium">
              Forecast based on real historical traffic for {data.dayOfWeekName} ({data.date})
            </p>
          </div>
      </div>

      {/* Peak windows badge */}
        {data.peakWindows && data.peakWindows.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300">
            <TrendingUp size={13} className="text-rose-500 shrink-0" />
            <span>Peak: {data.peakWindows.join(' & ')}</span>
          </div>
        )}
      </div>

      {data.isReferenceOnly && (
        <div className="relative mb-3 flex items-start gap-2 rounded-xl border border-amber-300/40 bg-amber-50 px-3 py-2.5 text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-extrabold">Reference forecast only</p>
            <p className="mt-0.5 text-[11px] font-medium opacity-80">
              This booking is outside the {data.forecastHorizonHours || 24}-hour pricing horizon. Dynamic Pricing is not applied; the chart is for planning only.
            </p>
          </div>
        </div>
      )}

      {/* ── Read-only 24-hour forecast ── */}
      <div className="bg-gray-50 dark:bg-black/30 border border-gray-100 dark:border-white/5 rounded-xl p-3 sm:p-4 mb-3.5">
        <div className="flex items-end justify-between gap-1 h-24 sm:h-28 pt-4 px-1">
          {data.hourlyForecast.map((item) => {
            const isHovered = hoveredHour === item.hour;
            const barHeight = `${Math.max(12, item.busynessScore)}%`;

            return (
              <div
                key={item.hour}
                onMouseEnter={() => setHoveredHour(item.hour)}
                onMouseLeave={() => setHoveredHour(null)}
                aria-label={`${item.timeLabel}: ${item.busynessScore}% busy`}
                className={`relative flex h-full flex-1 cursor-default flex-col items-center justify-end transition-transform duration-150 ${
                  isHovered ? 'z-10 scale-110' : ''
                }`}
              >
                {isHovered && (
                  <div className="pointer-events-none absolute -top-9 z-20 whitespace-nowrap rounded-md bg-gray-900 px-2 py-0.5 text-[10px] font-bold text-white shadow-lg dark:bg-gold dark:text-charcoal">
                    {item.timeLabel}: {item.busynessScore}% busy
                  </div>
                )}

                <div
                  style={{ height: barHeight }}
                  className={`w-full max-w-[14px] rounded-t-md ${getBarColor(item.busynessScore, isHovered)}`}
                />

                {isHovered && (
                  <div className="absolute -bottom-1.5 h-1 w-1 rounded-full bg-gold shadow-[0_0_6px_rgba(251,191,36,0.75)]" />
                )}
              </div>
            );
          })}
        </div>

        {/* Main time markers; all 24 hourly bars remain visible above. */}
        <div className="mt-2.5 flex justify-between border-t border-gray-200/60 px-1 pt-1.5 text-[10px] font-bold text-gray-500 dark:border-white/5 dark:text-gray-400">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>23:00</span>
        </div>
      </div>

      {/* ── Active Hour AI Insight Card ── */}
      {activeForecast && (
        <div
          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border transition-all duration-200 ${getBadgeStyle(
            activeInsight.badgeType
          )}`}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 p-1.5 rounded-lg bg-white/80 dark:bg-white/10 shadow-sm shrink-0">
              {activeForecast.level === 'peak' ? (
                <ShieldAlert size={18} className="text-rose-600 dark:text-rose-400" />
              ) : activeForecast.level === 'high' ? (
                <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400" />
              ) : (
                <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-black text-sm tracking-tight">
                  {activeInsight.badgeText || `Time slot ${activeForecast.timeLabel}`}
                </span>
                <span className="text-xs font-semibold opacity-75">
                  (Occupancy ~{activeForecast.busynessScore}%)
                </span>
              </div>
              <p className="text-xs font-medium mt-0.5 leading-relaxed text-gray-700 dark:text-gray-300">
                {activeInsight.message}
              </p>
            </div>
          </div>

          {/* Quick slot availability count */}
          <div className="flex sm:flex-col items-center sm:items-end justify-between shrink-0 pl-2 border-t sm:border-t-0 sm:border-l border-gray-200/70 dark:border-white/10 pt-2 sm:pt-0">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Estimated Available</span>
            <span className="text-sm font-black text-yellow-700 dark:text-gold">
              ~{activeForecast.estimatedAvailableSlots} / {data.totalCapacity || 54} slots
            </span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-3 px-1 pt-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Low (&lt;35%)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" /> Moderate
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> Peak (&gt;80%)
          </span>
        </div>
      </div>
    </div>
  );
}
