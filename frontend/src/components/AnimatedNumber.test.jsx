import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AnimatedNumber from './AnimatedNumber';
import { parseAnimatedNumber } from './numberAnimation';

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('framer-motion', () => ({ useReducedMotion: () => motion.reduced }));
let frames;
let nextId;
function advance(timestamp) {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(timestamp));
  });
}
beforeEach(() => {
  frames = new Map();
  nextId = 0;
  motion.reduced = false;
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => {
    frames.set(++nextId, callback);
    return nextId;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(id => frames.delete(id)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([
  ['15.681.000 VND', 15681000], ['15,681,000 USD', 15681000],
  ['61,5%', 61.5], ['12.50%', 12.5], ['-1.250 VND', -1250],
  ['\u20ab 15.681.000', 15681000], ['15.681.000 \u0111', 15681000],
])('preserves numeric formatting for %s', (value, expected) => {
  const parsed = parseAnimatedNumber(value);
  expect(parsed?.target).toBe(expected);
  expect(parsed.format(expected)).toBe(value);
});

it.each(['28/11/2026', '2026-11-28', '12:30', '10 - 20', 'Unavailable', '...', '\u2014'])('leaves %s unchanged', value => {
  expect(parseAnimatedNumber(value)).toBeNull();
  const { container } = render(<AnimatedNumber value={value} />);
  expect(container.textContent).toBe(value);
});

it('counts up, preserves currency, finishes exactly and does not restart on unrelated rerenders', () => {
  const { container, rerender } = render(<AnimatedNumber value={1000} formatter={n => `${Math.round(n)} VND`} />);
  expect(container.textContent).toBe('0 VND');
  advance(0);
  advance(325);
  expect(container.textContent).toBe('875 VND');
  const scheduled = requestAnimationFrame.mock.calls.length;
  rerender(<AnimatedNumber value={1000} formatter={n => `${Math.round(n)} VND`} />);
  expect(requestAnimationFrame.mock.calls.length).toBe(scheduled);
  advance(650);
  expect(container.textContent).toBe('1000 VND');
  expect(frames.size).toBe(0);
});

it('animates asynchronously loaded targets and cancels pending frames on unmount', () => {
  const { container, rerender, unmount } = render(<AnimatedNumber value={0} />);
  advance(0);
  advance(650);
  rerender(<AnimatedNumber value={22} />);
  expect(container.textContent).toBe('0');
  advance(1000);
  advance(1325);
  expect(Number(container.textContent)).toBeGreaterThan(0);
  unmount();
  expect(frames.size).toBe(0);
});

it('shows final values immediately for reduced motion and disabled animation', () => {
  motion.reduced = true;
  const { container, rerender } = render(<AnimatedNumber value="61,5%" />);
  expect(container.textContent).toBe('61,5%');
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  motion.reduced = false;
  rerender(<AnimatedNumber value={123} disabled />);
  expect(container.textContent).toBe('123');
  expect(requestAnimationFrame).not.toHaveBeenCalled();
});
