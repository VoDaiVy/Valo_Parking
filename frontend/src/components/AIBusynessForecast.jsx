import { useEffect, useId, useRef, useState } from 'react';
import { Car, CheckCircle2, Info, ParkingCircle, Sparkles } from 'lucide-react';
import { getOccupancyForecast } from '../services/aiForecastService';
import { readOccupancyChart, selectOccupancyPoint } from '../utils/occupancyChart.mjs';
import { useLanguage } from '../i18n/hooks/useLanguage';

const PERIODS = ['day', 'week', 'month'];
const COLORS = { low: 'bg-emerald-500', moderate: 'bg-yellow-400', high: 'bg-amber-500', peak: 'bg-rose-500' };
const BANNER_COLORS = { low: 'bg-emerald-500/15 text-emerald-300', moderate: 'bg-yellow-400/15 text-yellow-200', high: 'bg-amber-500/15 text-amber-300', peak: 'bg-rose-500/15 text-rose-300' };
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

export default function AIBusynessForecast({ selectedDate, selectedHour, vehicleType = 'car', floorId }) {
  const { t, language } = useLanguage();
  const detailsId = useId();
  const infoId = useId();
  const [infoOpen, setInfoOpen] = useState(false);
  const infoPointerFocus = useRef(false);
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
  const points = chart?.days ?? chart?.hours ?? [];
  const arrivals = chart?.kind === 'arrivals';
  const selectedIndex = selectedBar?.key === requestKey ? selectedBar.index
    : isRange ? data?.selectedIndex : Number(hour ?? data?.selectedHour ?? 12);
  const activeIndex = hoveredBar?.key === requestKey ? hoveredBar.index : selectedIndex;
  const active = selectOccupancyPoint(points, activeIndex);
  const formatDay = date => new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', {
    day: 'numeric', month: 'short', timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(date + 'T00:00:00+07:00'));
  const pointLabel = point => isRange ? `${formatDay(point.date)} · ${point.peakHour}` : point.timeLabel;
  const kindLabel = point => t(`forecast.${arrivals ? 'arrivals' : point.dataKind}`);
  const valueLabel = point => {
    const value = number(arrivals ? point.realDbSessions : point.busynessScore);
    return value === null ? t('forecast.unknown') : arrivals ? String(value) : `${value}%`;
  };
  const capacity = number(data?.totalCapacity);
  const vehicles = number(active?.predictedVehicles);
  const available = active?.dataKind === 'estimated' ? number(active?.estimatedAvailableSlots) : null;
  const unresolved = number(active?.uncertainty?.unresolvedActiveVehicles) ?? 0;
  const availabilityRange = active?.dataKind === 'estimated' ? active?.uncertainty?.availableSpacesRange : null;
  const rangeMin = number(availabilityRange?.min);
  const rangeMax = number(availabilityRange?.max);
  const availabilityLabel = unresolved > 0 && rangeMin !== null && rangeMax !== null
    ? rangeMin === rangeMax ? String(rangeMin) : `${rangeMin}\u2013${rangeMax}`
    : available ?? t('forecast.unknown');
  const vehicleLabel = active?.dataKind === 'recorded' ? 'observedVehicles'
    : active?.dataKind === 'known_only' ? 'knownOccupancy' : 'predictedVehicles';
  const occupancyLabel = active?.dataKind === 'recorded' ? 'observedOccupancy'
    : active?.dataKind === 'known_only' ? 'knownOccupancyRate' : 'estimatedOccupancy';
  const noCapacity = !arrivals && capacity === 0;
  const tickIndices = isRange ? (timeframe === 'week' ? [0, 3, 6] : [0, 7, 14, 21, points.length - 1]) : [0, 6, 12, 18, 23];

  useEffect(() => {
    const controller = new AbortController();
    getOccupancyForecast({ date: selectedDate, hour, vehicleType, floorId, timeframe, signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setResult({ key: requestKey, data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key: requestKey, data: null });
      });
    return () => controller.abort();
  }, [selectedDate, hour, vehicleType, floorId, timeframe, requestKey]);

  return (
    <section className="dark min-w-0 rounded-2xl bg-[#15161A] p-4 text-white sm:p-5" aria-label={t('forecast.title')} aria-busy={loading}>
      <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5 sm:flex-1">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold/15 text-yellow-700 dark:text-gold"><Sparkles size={17} /></span>
          <div className="min-w-0 break-words">
            <h4 className="text-sm font-extrabold leading-6 text-gray-900 dark:text-white">{t(arrivals ? 'forecast.arrivalsTitle' : 'forecast.title')}</h4>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              {t(isRange ? 'forecast.rangeHelp' : arrivals ? 'forecast.arrivalsHelp' : 'forecast.dayHelp')}
            </p>
          </div>
        </div>
        <div role="group" aria-label={t('forecast.period')} className="grid w-full shrink-0 grid-cols-3 gap-1 sm:w-auto">
          {PERIODS.map(value => (
            <button key={value} type="button" aria-pressed={timeframe === value} onClick={() => setTimeframe(value)}
              className={'min-h-11 min-w-0 break-words rounded-lg px-3 text-xs font-bold leading-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-500 '
                + (timeframe === value ? 'bg-gold text-black' : 'bg-transparent text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10')}>
              {t(`forecast.${value}`)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-48 animate-pulse rounded-xl bg-gray-100 motion-reduce:animate-none dark:bg-white/5" role="status"><span className="sr-only">{t('forecast.loading')}</span></div>
      ) : !chart || noCapacity ? (
        <div className="rounded-xl border border-gray-200 p-4 dark:border-white/10">
          <p className="text-sm leading-6 text-gray-500 dark:text-gray-400" role="status">
            {t(noCapacity ? 'forecast.noCapacity' : data ? 'forecast.empty' : 'forecast.error')}
          </p>
          {!noCapacity && <button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-2 min-h-11 rounded px-2 text-sm font-semibold text-yellow-800 underline focus-visible:outline-2 focus-visible:outline-gold dark:text-gold">{t('common.retry')}</button>}
        </div>
      ) : (
        <>
          {!arrivals && <dl className="mb-4 flex min-w-0 flex-wrap gap-y-2">
            {[
              ['capacity', capacity, ParkingCircle, 'text-yellow-700 dark:text-gold'],
              [vehicleLabel, vehicles, Car, 'text-orange-600 dark:text-orange-400'],
              ['estimatedAvailable', availabilityLabel, CheckCircle2, 'text-emerald-600 dark:text-emerald-400'],
            ].map(([key, value, Icon, color]) => <div key={key} className="flex min-w-0 max-w-full items-center gap-1.5 border-l border-gray-200 px-3 first:border-l-0 first:pl-0 dark:border-white/10">
              <dt className="flex min-w-0 items-center gap-1.5 break-words text-xs leading-5 text-gray-500 dark:text-gray-400"><Icon size={14} aria-hidden="true" className={'shrink-0 ' + color} />{t(`forecast.${key}`)}</dt>
              <dd className={'min-w-0 break-words text-sm font-semibold tabular-nums ' + color}>{value ?? t('forecast.unknown')}</dd>
            </div>)}
          </dl>}
          {!arrivals && data.isReferenceOnly && <p className="mb-3 rounded-xl border border-gold/30 bg-gold/10 p-3 text-xs leading-5 text-yellow-900 dark:text-yellow-200">{t('forecast.horizonHelp', { hours: data.forecastHorizonHours ?? 24 })}</p>}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-black/25">
            <p className="mb-3 text-xs font-semibold text-gray-500 dark:text-gray-400">{t(arrivals ? 'forecast.arrivalsAxis' : 'forecast.occupancyAxis')}</p>
            <div className="flex gap-2">
              <div aria-hidden="true" className="flex h-36 w-8 shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
                {[100, 75, 50, 25, 0].map(value => <span key={value}>{arrivals ? Math.round(chart.peakArrivals * value / 100) : `${value}%`}</span>)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="relative h-36">
                  <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col justify-between">{[0, 1, 2, 3, 4].map(value => <div key={value} className="border-t border-gray-200 dark:border-white/10" />)}</div>
                  <div className="relative flex h-full items-end gap-px sm:gap-1">
                    {points.map((point, index) => {
                      const value = number(arrivals ? point.realDbSessions / chart.peakArrivals * 100 : point.busynessScore);
                      const description = `${pointLabel(point)}: ${kindLabel(point)}, ${valueLabel(point)}`;
                      return <button key={point.id ?? index} type="button" aria-label={description} aria-pressed={selectedIndex === index}
                        aria-describedby={active === point ? detailsId : undefined}
                        onClick={() => { setSelectedBar({ key: requestKey, index }); setHoveredBar(null); }}
                        onFocus={() => setHoveredBar({ key: requestKey, index })} onBlur={() => setHoveredBar(null)}
                        onMouseEnter={() => setHoveredBar({ key: requestKey, index })} onMouseLeave={() => setHoveredBar(null)}
                        className="relative flex h-full min-w-0 flex-1 items-end justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-gold">
                        <span style={{ height: value === null ? '2px' : value === 0 ? '1px' : `${Math.min(100, Math.max(0, value))}%` }}
                          className={'w-full max-w-[18px] rounded-t-sm ' + (arrivals ? 'bg-sky-500' : point.dataKind === 'known_only' ? 'bg-gray-400' : COLORS[point.level] ?? 'bg-gold')
                            + (point.dataKind === 'recorded' ? ' border-t-2 border-gray-800 dark:border-white' : point.dataKind === 'estimated' ? ' border-t-2 border-dashed border-gray-800 dark:border-white' : '')
                            + (active === point ? ' ring-2 ring-yellow-600 dark:ring-gold' : ' opacity-80')} />
                      </button>;
                    })}
                  </div>
                </div>
                <div aria-hidden="true" className="mt-2 flex justify-between gap-1 text-[9px] font-medium leading-4 text-gray-500 dark:text-gray-400 sm:text-[10px]">
                  {tickIndices.map(index => points[index] && <span key={index}>{isRange ? formatDay(points[index].date) : points[index].timeLabel}</span>)}
                </div>
              </div>
            </div>
          </div>
          {active && <div aria-live="polite" id={detailsId}
            className={'mt-3 flex min-w-0 items-start gap-3 rounded-xl p-3 text-xs leading-5 ' + (arrivals ? 'bg-sky-500/15 text-sky-300' : active.dataKind === 'known_only' || number(active.busynessScore) === null ? 'bg-gray-400/15 text-gray-300' : BANNER_COLORS[active.level] ?? 'bg-gold/10 text-gold')}>
            <Car size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-2 break-words sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-bold">{!arrivals && active.dataKind !== 'known_only' && number(active.busynessScore) !== null && <>{t(`forecast.level_${active.level}`)} &middot; </>}{kindLabel(active)}</p>
                <p className="text-gray-300">{pointLabel(active)} &middot; {t(arrivals ? 'forecast.arrivals' : `forecast.${occupancyLabel}`)}: {valueLabel(active)}</p>
                {!arrivals && unresolved > 0 && <p className="mt-1 text-[11px] leading-5 text-gray-300">{t('forecast.uncertainAvailability', { count: unresolved })}</p>}
              </div>
              {!arrivals && <div className="sm:text-right">
                <p>{t('forecast.bannerAvailable')}</p>
                <p className="text-lg font-bold tabular-nums">{availabilityLabel}</p>
              </div>}
              <div className="sr-only">
                <p>{t(arrivals ? 'forecast.arrivalsDetail' : active.dataKind === 'known_only' ? 'forecast.knownHelp' : active.dataKind === 'recorded' ? 'forecast.recordedHelp' : 'forecast.estimatedHelp')}</p>
                {isRange && <p>{t('forecast.dailyPeak')}</p>}
              </div>
            </div>
          </div>}
          {!arrivals && <>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] leading-5 text-gray-600 dark:text-gray-300">
              {['low', 'moderate', 'high', 'peak'].map(level => <span key={level} className="flex items-center gap-1.5"><span className={'size-2.5 rounded-full ' + COLORS[level]} />{t(`forecast.level_${level}`)}</span>)}
              <div className="relative ml-auto shrink-0" onMouseEnter={() => setInfoOpen(true)} onMouseLeave={() => setInfoOpen(false)} onFocus={() => { if (!infoPointerFocus.current) setInfoOpen(true); infoPointerFocus.current = false; }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setInfoOpen(false); infoPointerFocus.current = false; } }}>
                <button type="button" aria-label={t('forecast.infoLabel')} aria-expanded={infoOpen} aria-controls={infoId}
                  onPointerDown={() => { infoPointerFocus.current = true; }}
                  onClick={() => setInfoOpen(value => !value)} onKeyDown={event => { if (event.key === 'Escape') setInfoOpen(false); }}
                  className="grid size-11 place-items-center rounded-lg text-gray-400 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-gold">
                  <Info size={16} aria-hidden="true" />
                </button>
                {infoOpen && <div role="tooltip" id={infoId} className="absolute bottom-full right-0 z-20 w-64 max-w-[calc(100vw-4rem)] rounded-xl bg-gray-800 p-3 text-xs leading-5 text-gray-200">
                  <p>{t('forecast.kindLegend')}</p>
                  <p className="mt-2">{t('forecast.footer')}</p>
                  <p className="mt-2">{t('forecast.disclaimer')}</p>
                </div>}
              </div>
            </div>
          </>}
        </>
      )}
    </section>
  );
}
