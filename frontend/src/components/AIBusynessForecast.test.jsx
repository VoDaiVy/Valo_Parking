import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '../i18n/locales/en.json';
import vn from '../i18n/locales/vi.json';
import AIBusynessForecast from './AIBusynessForecast';
import { readOccupancyChart, selectOccupancyPoint } from '../utils/occupancyChart.mjs';
import { getOccupancyForecast } from '../services/aiForecastService';

let language = 'en';
vi.mock('../services/aiForecastService', () => ({ getOccupancyForecast: vi.fn() }));
vi.mock('../i18n/hooks/useLanguage', () => ({ useLanguage: () => ({ language, t: (key, params = {}) => {
  const value = key.split('.').reduce((obj, part) => obj?.[part], language === 'vi' ? vn : en);
  if (typeof value !== 'string') throw new Error('Missing translation: ' + key);
  return value.replace(/{{(\w+)}}/g, (_, name) => params[name] ?? '');
} }) }));

const hours = Array.from({ length: 24 }, (_, hour) => ({
  id: hour, hour, timeLabel: `${String(hour).padStart(2, '0')}:00`, busynessScore: hour * 3,
  predictedVehicles: hour * 3, estimatedOccupiedSlots: hour * 3, estimatedAvailableSlots: 100 - hour * 3,
  dataKind: 'estimated', level: 'low',
}));
const day = { totalCapacity: 100, selectedHour: 12, dataQuality: { usesFallbackBaseline: false }, hourlyForecast: hours };
function range(timeframe) {
  return { totalCapacity: 100, timeframe, selectedIndex: 2, dataQuality: { usesFallbackBaseline: false },
    dailyForecast: Array.from({ length: timeframe === 'week' ? 7 : 30 }, (_, id) => ({ ...hours[id % 24], id,
      date: `2026-11-${String(id + 1).padStart(2, '0')}`, peakHour: '18:00', estimatedAvailableSlots: null })) };
}
const metric = label => screen.getByText(label).parentElement.querySelector('dd').textContent;
beforeEach(() => { language = 'en'; getOccupancyForecast.mockReset(); getOccupancyForecast.mockResolvedValue(day); });
afterEach(cleanup);

it('maps click, hover and keyboard details to the same bar', async () => {
  render(<AIBusynessForecast selectedDate="2026-11-24" selectedHour={4} floorId="F2" vehicleType="motorcycle" />);
  const bar = await screen.findByRole('button', { name: '08:00: Estimated, 24%' });
  expect(metric(en.forecast.predictedVehicles)).toBe('12');
  fireEvent.mouseEnter(bar);
  expect(metric(en.forecast.predictedVehicles)).toBe('24');
  expect(document.getElementById(bar.getAttribute('aria-describedby')).textContent).toContain('08:00 \u00b7 Estimated occupancy: 24%');
  fireEvent.mouseLeave(bar);
  expect(metric(en.forecast.predictedVehicles)).toBe('12');
  fireEvent.focus(bar);
  expect(metric(en.forecast.predictedVehicles)).toBe('24');
  fireEvent.click(bar);
  fireEvent.blur(bar);
  expect(metric(en.forecast.estimatedAvailable)).toBe('76');
  expect(getOccupancyForecast.mock.calls[0][0]).toMatchObject({ floorId: 'F2', vehicleType: 'motorcycle', hour: 4 });
});

it.each(['week', 'month'])('keeps %s filters and daily peak metrics aligned', async timeframe => {
  getOccupancyForecast.mockImplementation(({ timeframe }) => Promise.resolve(timeframe === 'day' ? day : range(timeframe)));
  render(<AIBusynessForecast floorId="F2" vehicleType="electric_car" />);
  await screen.findByRole('button', { name: '08:00: Estimated, 24%' });
  fireEvent.click(screen.getByRole('button', { name: en.forecast[timeframe] }));
  await waitFor(() => expect(metric(en.forecast.predictedVehicles)).toBe('6'));
  expect(metric(en.forecast.estimatedAvailable)).toBe('—');
  expect(screen.getByText(en.forecast.dailyPeak)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^4 Nov · 18:00: Estimated/ }));
  expect(metric(en.forecast.predictedVehicles)).toBe('9');
  expect(getOccupancyForecast.mock.calls.at(-1)[0]).toMatchObject({ timeframe, floorId: 'F2', vehicleType: 'electric_car', hour: undefined });
});

it.each(['known_only', 'recorded', 'estimated'])('preserves nulls and explains %s', async dataKind => {
  getOccupancyForecast.mockResolvedValue({ ...day, totalCapacity: null, hourlyForecast: hours.map(h => ({ ...h, dataKind,
    busynessScore: null, predictedVehicles: null, estimatedOccupiedSlots: null, estimatedAvailableSlots: null })) });
  render(<AIBusynessForecast />);
  await screen.findByText(en.forecast[dataKind === 'known_only' ? 'knownHelp' : dataKind === 'recorded' ? 'recordedHelp' : 'estimatedHelp']);
  expect(metric(en.forecast.capacity)).toBe('—');
  expect(metric(en.forecast[dataKind === 'known_only' ? 'knownOccupancy' : dataKind === 'recorded' ? 'observedVehicles' : 'predictedVehicles'])).toBe('—');
  expect(metric(en.forecast.estimatedAvailable)).toBe('—');
  expect(document.querySelector('[aria-live="polite"]').textContent).not.toContain('null');
});

it('shows loading, error and successful retry', async () => {
  getOccupancyForecast.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(day);
  render(<AIBusynessForecast />);
  expect(screen.getByRole('status').textContent).toBe(en.forecast.loading);
  await screen.findByText(en.forecast.error);
  fireEvent.click(screen.getByRole('button', { name: en.common.retry }));
  await screen.findByRole('button', { name: '08:00: Estimated, 24%' });
  expect(getOccupancyForecast).toHaveBeenCalledTimes(2);
});

it.each([{}, { ...day, totalCapacity: 0 }])('handles empty or zero-capacity data', async data => {
  getOccupancyForecast.mockResolvedValue(data);
  render(<AIBusynessForecast />);
  await screen.findByText(data.totalCapacity === 0 ? en.forecast.noCapacity : en.forecast.empty);
  expect(screen.queryByRole('button', { name: /08:00:/ })).toBeNull();
});

it('ignores stale responses when the floor changes', async () => {
  let resolveFirst;
  getOccupancyForecast.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValueOnce({ ...day, totalCapacity: 50 });
  const { rerender } = render(<AIBusynessForecast floorId="F1" />);
  rerender(<AIBusynessForecast floorId="F2" />);
  await waitFor(() => expect(metric(en.forecast.capacity)).toBe('50'));
  await act(async () => resolveFirst(day));
  expect(metric(en.forecast.capacity)).toBe('50');
  expect(getOccupancyForecast.mock.calls[0][0].signal.aborted).toBe(true);
});

it.each(['en', 'vi'])('renders %s labels, scale and disclaimers', async lang => {
  language = lang;
  const dictionary = lang === 'vi' ? vn : en;
  render(<AIBusynessForecast />);
  const info = await screen.findByRole('button', { name: dictionary.forecast.infoLabel });
  expect(screen.queryByText(dictionary.forecast.footer)).toBeNull();
  fireEvent.mouseEnter(info.parentElement);
  expect(screen.getByRole('tooltip').textContent).toContain(dictionary.forecast.disclaimer);
  expect(screen.getByRole('tooltip').textContent).toContain(dictionary.forecast.footer);
  fireEvent.mouseLeave(info.parentElement);
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.click(info);
  for (const value of ['0%', '25%', '50%', '75%', '100%']) expect(screen.getByText(value)).toBeTruthy();
  expect(screen.getByText(dictionary.forecast.kindLegend)).toBeTruthy();
});

it('keeps legacy arrival counts separate from occupancy', async () => {
  getOccupancyForecast.mockResolvedValue({ ...day, dataQuality: { usesFallbackBaseline: false, dataSource: 'historical_sessions' },
    hourlyForecast: hours.map(h => ({ ...h, dataKind: undefined, realDbSessions: h.hour })) });
  render(<AIBusynessForecast />);
  await screen.findByText(en.forecast.arrivalsTitle);
  expect(screen.queryByText(en.forecast.capacity)).toBeNull();
  expect(screen.queryByText('100%')).toBeNull();
  expect(screen.getByText(en.forecast.arrivalsDetail)).toBeTruthy();
});

it('opens the info tooltip on the first touch and supports keyboard dismissal', async () => {
  render(<AIBusynessForecast />);
  const info = await screen.findByRole('button', { name: en.forecast.infoLabel });
  fireEvent.pointerDown(info, { pointerType: 'touch' });
  fireEvent.focus(info);
  fireEvent.click(info);
  expect(screen.getByRole('tooltip').textContent).toContain(en.forecast.disclaimer);
  fireEvent.keyDown(info, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.blur(info);
  fireEvent.focus(info);
  expect(screen.getByRole('tooltip')).toBeTruthy();
  fireEvent.blur(info);
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('rejects fallback data and resolves invalid selections consistently', () => {
  expect(readOccupancyChart({ ...day, dataQuality: { usesFallbackBaseline: true } })).toBeNull();
  expect(readOccupancyChart({ ...range('week'), dailyForecast: [] }, 'week')).toBeNull();
  expect(selectOccupancyPoint(hours, 500)).toBe(hours[0]);
  expect(selectOccupancyPoint(hours, 3)).toBe(hours[3]);
  expect(selectOccupancyPoint([], 0)).toBeNull();
});

it.each(['en', 'vi'])('shows %s departure uncertainty and a scenario range without changing the chart', async lang => {
  language = lang;
  const dictionary = lang === 'vi' ? vn : en;
  const uncertain = { ...hours[12], predictedVehicles: 2, estimatedOccupiedSlots: 90,
    estimatedAvailableSlots: 94, busynessScore: 2,
    uncertainty: { unresolvedActiveVehicles: 4, reason: 'unsupported_active_departure',
      predictedVehiclesRange: { min: 2, max: 6 }, availableSpacesRange: { min: 94, max: 98 } } };
  getOccupancyForecast.mockResolvedValue({ ...day, hourlyForecast: hours.map(p => p.hour === 12 ? uncertain : p) });
  render(<AIBusynessForecast />);
  await waitFor(() => expect(metric(dictionary.forecast.predictedVehicles)).toBe('2'));
  expect(metric(dictionary.forecast.estimatedAvailable)).toBe('94\u201398');
  const banner = document.querySelector('[aria-live="polite"]');
  expect(banner.textContent).toContain(dictionary.forecast.uncertainAvailability.replace('{{count}}', '4'));
  expect(banner.textContent).toContain(dictionary.forecast.estimatedOccupancy);
  expect(banner.textContent).toContain('94\u201398');
  expect(screen.getAllByRole('button', { name: /:00:/ })).toHaveLength(24);
  fireEvent.mouseEnter(screen.getByRole('button', { name: new RegExp('08:00:') }));
  expect(banner.textContent).not.toContain(dictionary.forecast.uncertainAvailability.replace('{{count}}', '4'));
});

it('distinguishes recorded vehicles and observed occupancy from predictions', async () => {
  getOccupancyForecast.mockResolvedValue({ ...day, hourlyForecast: hours.map(p => ({ ...p, dataKind: 'recorded',
    predictedVehicles: 5, estimatedOccupiedSlots: 90, estimatedAvailableSlots: null })) });
  render(<AIBusynessForecast />);
  await waitFor(() => expect(metric(en.forecast.observedVehicles)).toBe('5'));
  expect(screen.queryByText(en.forecast.predictedVehicles)).toBeNull();
  expect(document.querySelector('[aria-live="polite"]').textContent).toContain(en.forecast.observedOccupancy);
  expect(metric(en.forecast.estimatedAvailable)).toBe(en.forecast.unknown);
});

it('does not promise spaces when unresolved vehicles have insufficient historical evidence', async () => {
  getOccupancyForecast.mockResolvedValue({ ...day, hourlyForecast: hours.map(p => ({ ...p, dataKind: 'known_only',
    predictedVehicles: 0, estimatedAvailableSlots: null, uncertainty: { unresolvedActiveVehicles: 4,
      predictedVehiclesRange: { min: 0, max: 4 }, availableSpacesRange: null } })) });
  render(<AIBusynessForecast />);
  await waitFor(() => expect(metric(en.forecast.knownOccupancy)).toBe('0'));
  expect(metric(en.forecast.estimatedAvailable)).toBe(en.forecast.unknown);
  expect(document.querySelector('[aria-live="polite"]').textContent).toContain(en.forecast.uncertainAvailability.replace('{{count}}', '4'));
  expect(document.querySelector('[aria-live="polite"]').textContent).toContain(en.forecast.knownOccupancyRate);
});

it('keeps raw vehicle demand above capacity while free spaces stay zero', async () => {
  getOccupancyForecast.mockResolvedValue({ ...day, hourlyForecast: hours.map(p => ({ ...p,
    predictedVehicles: 120, estimatedOccupiedSlots: 120, estimatedAvailableSlots: 0, busynessScore: 100,
    uncertainty: { unresolvedActiveVehicles: 3, predictedVehiclesRange: { min: 120, max: 123 },
      availableSpacesRange: { min: 0, max: 0 } } })) });
  render(<AIBusynessForecast />);
  await waitFor(() => expect(metric(en.forecast.predictedVehicles)).toBe('120'));
  expect(metric(en.forecast.estimatedAvailable)).toBe('0');
  expect(document.querySelector('[aria-live="polite"]').textContent).toContain('100%');
});

it.each(['week', 'month'])('keeps the %s scenario range aligned with the selected daily peak', async timeframe => {
  const period = range(timeframe);
  period.dailyForecast = period.dailyForecast.map(p => ({ ...p, estimatedAvailableSlots: 90,
    uncertainty: { unresolvedActiveVehicles: 4, predictedVehiclesRange: { min: p.predictedVehicles, max: p.predictedVehicles + 4 },
      availableSpacesRange: { min: 90, max: 94 } } }));
  getOccupancyForecast.mockImplementation(({ timeframe: requested }) => Promise.resolve(requested === 'day' ? day : period));
  render(<AIBusynessForecast />);
  await screen.findByRole('button', { name: '08:00: Estimated, 24%' });
  fireEvent.click(screen.getByRole('button', { name: en.forecast[timeframe] }));
  await waitFor(() => expect(metric(en.forecast.estimatedAvailable)).toBe('90\u201394'));
  expect(metric(en.forecast.predictedVehicles)).toBe('6');
  expect(document.querySelector('[aria-live="polite"]').textContent).toContain(en.forecast.uncertainAvailability.replace('{{count}}', '4'));
});
