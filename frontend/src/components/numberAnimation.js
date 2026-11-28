import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

export const defaultFormatter = (value) => Math.round(value).toLocaleString('vi-VN');

// Keep formatting out of the animation dependencies: inline formatters must not restart it.
export function useCountUp(value, { duration = 650, formatter = defaultFormatter } = {}) {
  const reducedMotion = useReducedMotion();
  const target = Number(value);
  const safeTarget = Number.isFinite(target) ? target : 0;
  const [frame, setFrame] = useState({ target: safeTarget, progress: 0 });
  useEffect(() => {
    if (reducedMotion || duration <= 0) return undefined;
    let frameId;
    let start;
    const tick = (timestamp) => {
      start ??= timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      setFrame({ target: safeTarget, progress });
      if (progress < 1) frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [safeTarget, duration, reducedMotion]);
  const progress = reducedMotion || duration <= 0 ? 1 : frame.target === safeTarget ? frame.progress : 0;
  return formatter(safeTarget * (1 - (1 - progress) ** 3));
}

// Only accept a single number with an optional currency/percent unit, never dates or ranges.
export function parseAnimatedNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? { target: value, format: (n) => Math.round(n) } : null;
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\s*(?:[\u20ab$\u20ac\u00a3]\s*)?)(-?\d[\d.,\s\u00a0]*?)(\s*(?:VND|VN\u0110|USD|EUR|\u20ab|\u0111|%|k|K|M|B)?\s*)$/u);
  if (!match) return null;
  const [, prefix, numeric, suffix] = match;
  const compact = numeric.replace(/[\s\u00a0]/g, '');
  const grouped = /^-?\d{1,3}([.,])\d{3}(?:\1\d{3})*$/.test(compact);
  let decimal = '';
  if (!grouped && /[.,]/.test(compact)) decimal = compact.includes(',') && compact.includes('.') ? (compact.lastIndexOf(',') > compact.lastIndexOf('.') ? ',' : '.') : (compact.includes(',') ? ',' : '.');
  const parts = decimal ? compact.split(decimal) : [compact];
  if (parts.length > 2 || (decimal && !/^\d{1,2}$/.test(parts[1]))) return null;
  const target = Number(decimal ? `${parts[0].replace(/[.,]/g, '')}.${parts[1]}` : compact.replace(/[.,]/g, ''));
  if (!Number.isFinite(target)) return null;
  const digits = decimal ? parts[1].length : 0;
  const grouping = grouped ? compact.match(/[.,]/)[0] : decimal ? parts[0].match(/[.,]/)?.[0] : undefined;
  return { target, format: (n) => {
    const [whole, fraction] = (digits ? n.toFixed(digits) : String(Math.round(n))).split('.');
    const formatted = grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, grouping) : whole;
    return `${prefix}${formatted}${digits ? decimal + fraction : ''}${suffix}`;
  } };
}
