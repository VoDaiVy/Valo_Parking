import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentPricing } from '../services/pricingService';

export const computeAdjustedTotal = (usageAmount, multiplier = 1) => {
  const amount = Math.max(0, Number(usageAmount) || 0);
  const factor = Number.isFinite(Number(multiplier)) ? Number(multiplier) : 1;
  return Math.floor((amount * factor) / 1000) * 1000;
};

const dateParts = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return {};
  const pad = (part) => String(part).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    hour: date.getHours(),
  };
};

export function useDynamicPricing(startTime, endTime) {
  const [state, setState] = useState({
    multiplier: 1,
    busynessScore: null,
    level: null,
    priceLabel: null,
    loading: false,
    error: false,
  });
  const debounceRef = useRef(null);
  const controllerRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (controllerRef.current) controllerRef.current.abort();

    if (!startTime || !endTime || new Date(startTime) >= new Date(endTime)) {
      const resetTimer = setTimeout(() => {
        setState({ multiplier: 1, busynessScore: null, level: null, priceLabel: null, loading: false, error: false });
      }, 0);
      return () => clearTimeout(resetTimer);
    }

    let active = true;
    const loadingTimer = setTimeout(() => {
      if (active) setState((current) => ({ ...current, multiplier: 1, priceLabel: null, loading: true, error: false }));
    }, 0);
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      controllerRef.current = controller;
      const result = await getCurrentPricing({ ...dateParts(startTime), signal: controller.signal });
      if (!active || controller.signal.aborted) return;
      const hourly = result.ok ? result.data?.data?.hourly : null;
      if (!hourly) {
        setState({ multiplier: 1, busynessScore: null, level: null, priceLabel: null, loading: false, error: true });
        return;
      }
      setState({
        multiplier: Number(hourly.multiplier) || 1,
        busynessScore: hourly.busynessScore ?? null,
        level: hourly.level ?? null,
        priceLabel: hourly.priceLabel ?? null,
        loading: false,
        error: false,
      });
    }, 300);

    return () => {
      active = false;
      clearTimeout(loadingTimer);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (controllerRef.current) controllerRef.current.abort();
    };
  }, [startTime, endTime]);

  const calculate = useCallback(
    (usageAmount) => computeAdjustedTotal(usageAmount, state.multiplier),
    [state.multiplier]
  );

  return { ...state, computeAdjustedTotal: calculate };
}
