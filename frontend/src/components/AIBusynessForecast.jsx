import { useEffect, useState } from 'react';
import { AlertTriangle, Info, Sparkles, TrendingUp } from 'lucide-react';
import { getOccupancyForecast } from '../services/aiForecastService';
import { readOccupancyChart } from '../utils/occupancyChart.mjs';

const PERIODS = [['day', '24 hours'], ['week', '7 days'], ['month', '1 month']];
const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
const formatDay = date => DAY_FORMAT.format(new Date(date + 'T00:00:00+07:00'));
const HOUR_TICKS = ['00:00', '06:00', '12:00', '18:00', '23:00'];
const LEGEND = [
  ['bg-emerald-500', 'Low (<35%)'], ['bg-yellow-400', 'Moderate'],
  ['bg-amber-500', 'High'], ['bg-rose-500', 'Peak (≥80%)'],
];
const TONES = {
  info: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300',
  high: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300',
  peak: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300',
  low: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300',
};

function describePoint(point, isRange, historicalArrivals) {
  if (historicalArrivals) return {
    title: 'Recorded vehicle arrivals',
    detail: point.realDbSessions + ' arrivals recorded in the available history',
  };
  if (point.dataKind === 'known_only') return {
    title: 'Confirmed activity only',
    detail: point.estimatedOccupiedSlots + ' spaces with a recorded session, booking or hold. There is not enough history to estimate availability.',
  };
  if (point.dataKind === 'recorded') return {
    title: isRange ? 'Highest recorded hourly occupancy' : 'Recorded occupancy',
    detail: point.estimatedOccupiedSlots + ' spaces had a recorded session during this hour',
  };
  return {
    title: isRange ? 'Estimated peak occupancy' : { peak: 'Peak demand', high: 'Busy', moderate: 'Moderate demand', low: 'Off-peak' }[point.level],
    detail: 'About ' + point.busynessScore + '% of eligible spaces may be in use or reserved. Check your exact times for availability.',
  };
}

export default function AIBusynessForecast({ selectedDate, selectedHour, vehicleType = 'car', floorId }) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [timeframe, setTimeframe] = useState('day');
  const [hoveredBar, setHoveredBar] = useState(null);
  const [selectedBar, setSelectedBar] = useState(null);
  const isRange = timeframe !== 'day';
  const hour = isRange ? undefined : selectedHour;
  const requestKey = JSON.stringify([selectedDate, hour, vehicleType, floorId, timeframe, attempt]);
  const loading = result?.key !== requestKey;
  const data = loading ? null : result.data;
  const chart = readOccupancyChart(data, timeframe);
  const points = chart?.days ?? chart?.hours;
  const historicalArrivals = chart?.kind === 'arrivals';
  const hoveredIndex = hoveredBar?.key === requestKey ? hoveredBar.index : null;
  const defaultIndex = isRange ? data?.selectedIndex : Number(hour ?? data?.selectedHour ?? 12);
  const selectedIndex = selectedBar?.key === requestKey ? selectedBar.index : defaultIndex;
  const activeIndex = hoveredIndex ?? selectedIndex;
  const active = points?.[activeIndex] ?? points?.[0];
  const activeLabel = active && (isRange ? formatDay(active.date) + ' · ' + active.peakHour : active.timeLabel);
  const insight = active && describePoint(active, isRange, historicalArrivals);
  const recordedDay = points?.every(point => point.dataKind === 'recorded');
  const ticks = isRange && points
    ? (timeframe === 'week' ? points : [points[0], points[7], points[14], points[21], points.at(-1)]).map(point => formatDay(point.date))
    : HOUR_TICKS;
  const legend = points?.some(point => point.dataKind === 'known_only')
    ? [...LEGEND, ['bg-gray-400', 'Known activity']] : LEGEND;

  useEffect(() => {
    const controller = new AbortController();
    getOccupancyForecast({ date: selectedDate, hour, vehicleType, floorId, timeframe, signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setResult({ key: requestKey, data });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        console.warn('[AI Forecast] Failed to fetch forecast:', error);
        setResult({ key: requestKey, data: null });
      });
    return () => controller.abort();
  }, [selectedDate, hour, vehicleType, floorId, timeframe, requestKey]);

  const subtitle = () => {
    if (isRange) return formatDay(points[0].date) + ' – ' + formatDay(points.at(-1).date)
      + '. Each bar shows the busiest hour of the day. Forecasts are for planning.';
    if (historicalArrivals) return 'Recorded check-ins by hour (Vietnam time). A current occupancy estimate is unavailable.';
    const date = (data.dayOfWeekName ? data.dayOfWeekName + ', ' : '') + (data.date ? formatDay(data.date) : '') + '. ';
    if (recordedDay) return date + 'Recorded sessions on spaces in the current hourly inventory.';
    if (data.dataQuality?.dataSource === 'historical_sessions') {
      return date + 'Estimate from ' + data.dataQuality.historicalDayCount + ' recent matching weekdays and current reservations.';
    }
    return date + 'Limited history. Showing recorded sessions, bookings and holds only.';
  };

  return (
    <section className="relative min-w-0 overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#15161A] sm:p-5" aria-label="Occupancy forecast">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-gold/15 text-yellow-700 dark:text-gold"><Sparkles size={16} /></span>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-extrabold text-gray-900 dark:text-white">
              {historicalArrivals ? 'Historical vehicle arrivals' : 'AI Occupancy & Peak Times Forecast'}
            </h4>
            {chart && (
              <p className="mt-0.5 truncate text-xs font-medium text-gray-500 dark:text-gray-400" title={subtitle()}>
                {subtitle()}
              </p>
            )}
          </div>
        </div>
        <div role="group" aria-label="Forecast period" className="flex shrink-0 gap-1 rounded-lg border border-gray-200 p-1 dark:border-white/15">
          {PERIODS.map(([value, text]) => (
            <button key={value} type="button" aria-pressed={timeframe === value} onClick={() => setTimeframe(value)}
              className={'whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-500 '
                + (timeframe === value ? 'bg-gold text-charcoal' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10')}>
              {text}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-28 animate-pulse rounded-xl bg-gray-100 dark:bg-white/5" role="status"><span className="sr-only">Loading forecast</span></div>
      ) : !chart ? (
        <div className="rounded-xl border border-gray-200 p-4 dark:border-white/10">
          <p className="text-sm text-gray-500 dark:text-gray-400" role="status">
            {data ? 'No recorded data is available for this selection.' : 'Occupancy data is temporarily unavailable.'} Check the booking map for availability.
          </p>
          <button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-2 text-sm font-semibold text-yellow-800 underline dark:text-gold">Retry</button>
        </div>
      ) : !historicalArrivals && !data.totalCapacity ? (
        <p className="rounded-xl border border-gray-200 p-4 text-sm text-gray-500 dark:border-white/10" role="status">
          There are no eligible hourly spaces for this vehicle type and floor.
        </p>
      ) : (
        <>
          {!historicalArrivals && !isRange && data.peakWindows?.length > 0 && (
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
              <TrendingUp size={13} /> {recordedDay ? 'Recorded peaks' : 'Peak hours'} · {data.peakWindows.join(' & ')}
            </div>
          )}
          {!historicalArrivals && !isRange && !recordedDay && data.isReferenceOnly && (
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-300/40 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
              <AlertTriangle size={15} className="shrink-0" />
              <span>This date is outside the {data.forecastHorizonHours || 24}-hour forecast horizon. Use the chart for planning.</span>
            </div>
          )}
          <div className="mb-3.5 rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-white/5 dark:bg-black/30 sm:p-4">
            <div className="flex h-24 items-end justify-between gap-1 px-1 pt-1 sm:h-28">
              {points.map((point, index) => {
                const label = isRange ? formatDay(point.date) + ', ' + point.peakHour : point.timeLabel;
                const value = historicalArrivals ? point.realDbSessions / chart.peakArrivals * 100 : point.busynessScore;
                const description = historicalArrivals ? point.realDbSessions + ' recorded arrivals'
                  : point.dataKind === 'known_only' ? point.estimatedOccupiedSlots + ' spaces with known activity'
                  : point.busynessScore + '% ' + point.dataKind;
                const color = historicalArrivals ? 'bg-sky-500' : point.dataKind === 'known_only' ? 'bg-gray-400'
                  : LEGEND[{ low: 0, moderate: 1, high: 2, peak: 3 }[point.level]]?.[0];
                return (
                  <button key={point.id} type="button" aria-label={label + ': ' + description} title={label + ': ' + description}
                    aria-pressed={selectedIndex === index}
                    onClick={() => setSelectedBar({ key: requestKey, index })}
                    onMouseEnter={() => setHoveredBar({ key: requestKey, index })}
                    onMouseLeave={() => setHoveredBar(null)}
                    className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-sm focus-visible:outline-2 focus-visible:outline-gold">
                    <span style={{ height: Math.max(4, value || 0) + '%' }}
                      className={'w-full max-w-[18px] rounded-t-md ' + color + (active === point ? ' ring-1 ring-gold' : ' opacity-85')} />
                  </button>
                );
              })}
            </div>
            <div className="mt-2.5 flex justify-between gap-1 border-t border-gray-200/60 px-1 pt-1.5 text-[10px] font-bold text-gray-500 dark:border-white/5 dark:text-gray-400">
              {ticks.map(label => <span key={label}>{label}</span>)}
            </div>
          </div>
          {insight && (
            <div className={'flex flex-col justify-between gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center '
              + ((active.dataKind === 'estimated' && TONES[active.level]) || TONES.info)}>
              <div className="flex min-w-0 items-start gap-3">
                <Info size={18} className="mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-extrabold">{insight.title}</p>
                  <p className="mt-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">{activeLabel} · {insight.detail}</p>
                </div>
              </div>
              {!historicalArrivals && !isRange && active.estimatedAvailableSlots != null && (
                <p className="shrink-0 text-xs font-semibold text-gray-500 dark:text-gray-400">Estimated available <strong className="ml-1 text-yellow-700 dark:text-gold">~{active.estimatedAvailableSlots} / {data.totalCapacity} slots</strong></p>
              )}
            </div>
          )}
          {!historicalArrivals && (
            <div className="mt-4 flex flex-wrap gap-x-3 gap-y-2 px-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
              {legend.map(([color, name]) => <span key={name} className="flex items-center gap-1.5"><span className={'size-2.5 rounded-full ' + color} />{name}</span>)}
            </div>
          )}
        </>
      )}
    </section>
  );
}
