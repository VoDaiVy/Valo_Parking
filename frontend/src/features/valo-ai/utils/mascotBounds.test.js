import test from 'node:test';
import assert from 'node:assert/strict';
import { mascotBounds, clampMascot, measureMascotBounds, observeMascotBounds } from './mascotBounds.js';

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
const screen = rect(0, 0, 1440, 900);
const mascot = rect(0, 0, 92, 100);

test('saved and dragged positions stay wholly inside actual content, excluding sidebar and topbar', () => {
  const bounds = mascotBounds(rect(263, 83, 1177, 817), mascot, screen);
  assert.deepEqual(clampMascot({ x: -1000, y: -1000 }, bounds), { x: 263, y: 83 });
  assert.deepEqual(clampMascot({ x: 9999, y: 9999 }, bounds), { x: 1348, y: 800 });
  assert.deepEqual(clampMascot({ x: 700, y: 450 }, bounds), { x: 700, y: 450 });
  for (const x of [-100, 0, 263, 800, 2000]) for (const y of [-80, 0, 83, 500, 1900]) {
    const next = clampMascot({ x, y }, bounds);
    assert.ok(next.x >= 263 && next.y >= 83);
    assert.ok(next.x + mascot.width <= 1440 && next.y + mascot.height <= 900);
  }
});

test('measured sizes handle sidebar expansion frames, route layout changes and differently sized mascots', () => {
  let position = { x: 72, y: 70 };
  for (const sidebarWidth of [72, 110, 170, 240, 290]) {
    position = clampMascot(position, mascotBounds(rect(sidebarWidth, 70, 1440 - sidebarWidth, 830), mascot, screen));
    assert.ok(position.x >= sidebarWidth);
  }
  const changedRoute = mascotBounds(rect(290, 126, 1150, 774), rect(0, 0, 136, 145), screen);
  assert.deepEqual(clampMascot({ x: 1500, y: 950 }, changedRoute), { x: 1304, y: 755 });
  assert.equal(clampMascot(position, changedRoute).y, 126);
});

test('content is intersected with the visible screen and undersized content cannot display a mascot', () => {
  const bounds = mascotBounds(rect(-80, -70, 2000, 1500), mascot, rect(0, 0, 380, 640));
  assert.deepEqual(clampMascot({ x: 1000, y: 1000 }, bounds), { x: 288, y: 540 });
  const tooSmall = mascotBounds(rect(240, 70, 60, 80), mascot, screen);
  assert.equal(tooSmall.fits, false);
  assert.ok(Number.isFinite(clampMascot({ x: NaN, y: Infinity }, tooSmall).x));
  assert.equal(mascotBounds(rect(240, 70, 0, 0), mascot, screen).fits, false);
});

test('DOM measurement uses current content and mascot rects and visual viewport including keyboard offsets', () => {
  const viewportWindow = { document: { documentElement: { clientWidth: 1000, clientHeight: 720 } } };
  const content = { getBoundingClientRect: () => rect(201, 91, 799, 629) };
  const anchor = { getBoundingClientRect: () => rect(500, 500, 118, 127) };
  assert.deepEqual(clampMascot({ x: 2000, y: 2000 }, measureMascotBounds(content, anchor, viewportWindow)), { x: 882, y: 593 });
  viewportWindow.visualViewport = { offsetLeft: 30, offsetTop: 100, width: 600, height: 350 };
  const measured = measureMascotBounds(content, anchor, viewportWindow);
  assert.deepEqual(clampMascot({ x: 2000, y: 2000 }, measured), { x: 512, y: 323 });
  assert.equal(measured.minY, 100);
  assert.equal(measureMascotBounds(null, anchor, viewportWindow), null);
});

test('resize, sidebar transitions, scroll and visual viewport changes revalidate and cleanup removes subscriptions', () => {
  const listeners = new Map();
  const visualListeners = new Map();
  let observed = [], disconnected = false, onMeasure;
  const viewportWindow = {
    ResizeObserver: class {
      constructor(callback) { onMeasure = callback; }
      observe(node) { observed.push(node); }
      disconnect() { disconnected = true; }
    },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { assert.equal(listeners.get(name), callback); listeners.delete(name); },
    visualViewport: {
      addEventListener: (name, callback) => visualListeners.set(name, callback),
      removeEventListener: (name, callback) => { assert.equal(visualListeners.get(name), callback); visualListeners.delete(name); },
    },
  };
  const content = {}, anchor = {};
  let revalidated = 0;
  const cleanup = observeMascotBounds(content, anchor, () => { revalidated += 1; }, viewportWindow);
  assert.deepEqual(observed, [content, anchor]);
  onMeasure(); listeners.get('resize')(); listeners.get('scroll')(); visualListeners.get('resize')(); visualListeners.get('scroll')();
  assert.equal(revalidated, 5);
  cleanup(); assert.equal(disconnected, true); assert.equal(listeners.size, 0); assert.equal(visualListeners.size, 0);
});
