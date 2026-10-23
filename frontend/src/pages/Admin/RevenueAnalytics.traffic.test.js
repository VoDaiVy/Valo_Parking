import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { motion } from 'framer-motion';
import { transformWithOxc } from 'vite';

// Render the real chart without mounting the authenticated page or calling APIs.
const source = fs.readFileSync(new URL('./RevenueAnalytics.jsx', import.meta.url), 'utf8');
const utilities = source.slice(source.indexOf('const MONTHS ='), source.indexOf('/* ── UI Components'));
const chart = source.slice(source.indexOf('function VehicleTrafficSection('), source.indexOf('/* ── Status Distribution'));
const emptyState = source.slice(source.indexOf('function EmptyState('), source.indexOf('function RevenueSkeleton('));
const compiled = await transformWithOxc(`${utilities}\n${chart}\n${emptyState}`, 'TrafficTest.jsx', { jsx: { runtime: 'classic' } });
const VehicleTraffic = new Function('React', 'motion', `${compiled.code}\nreturn VehicleTrafficSection;`)(React, motion);

function renderTraffic(traffic, granularity = 'year') {
  return renderToStaticMarkup(React.createElement(VehicleTraffic, {
    traffic, granularity, reduceMotion: true,
    trafficSummary: {
      totalEntries: traffic.reduce((sum, point) => sum + point.entries, 0),
      totalExits: traffic.reduce((sum, point) => sum + point.exits, 0),
      currentlyParked: 2,
    },
  }));
}

const rectangles = html => [...html.matchAll(/<rect\b[^>]*>/g)].map(match => match[0]);
test('one year of monthly traffic renders continuous green and dashed pink lines', () => {
  const traffic = Array.from({ length: 12 }, (_, index) => ({
    period: `2026-${String(index + 1).padStart(2, '0')}`,
    entries: index === 8 ? 158 : 0,
    exits: index === 8 ? 156 : 0,
  }));
  const html = renderTraffic(traffic, 'month');
  assert.equal(rectangles(html).length, 0);
  const paths = [...html.matchAll(/<path\b[^>]*stroke="(?:#34D399|#FB7185)"[^>]*>/g)].map(match => match[0]);
  assert.equal(paths.length, 2);
  assert.ok(paths.every(path => [...path.match(/\bd="([^"]+)"/)[1].matchAll(/L /g)].length === 11));
  assert.match(html, /stroke="#FB7185"[^>]*stroke-dasharray="5 3"/);
  assert.match(html, /Jan 2026/);
  assert.match(html, /Dec 2026/);
});

test('a legacy response with one annual point stays visible using point markers', () => {
  const html = renderTraffic([{ period: '2026', entries: 158, exits: 156 }]);
  assert.equal(rectangles(html).length, 0);
  assert.equal([...html.matchAll(/<circle\b/g)].length, 2);
  assert.match(html, /Entries: 158/);
  assert.match(html, /Exits: 156/);
});

test('monthly traffic keeps line charts and a single nonannual point has visible markers', () => {
  const monthly = renderTraffic([{ period: '2026-01', entries: 20, exits: 15 }, { period: '2026-02', entries: 30, exits: 25 }], 'month');
  assert.equal(rectangles(monthly).length, 0);
  assert.match(monthly, /<path[^>]+stroke="#34D399"/);
  assert.match(monthly, /<path[^>]+stroke="#FB7185"/);
  const single = renderTraffic([{ period: '2026-01', entries: 20, exits: 15 }], 'month');
  assert.equal([...single.matchAll(/<circle\b/g)].length, 2);
});

test('zero traffic keeps the empty state without fabricated activity', () => {
  for (const traffic of [[], [{ period: '2026', entries: 0, exits: 0 }]]) {
    const html = renderTraffic(traffic);
    assert.match(html, /No vehicle activity/);
    assert.equal(rectangles(html).length, 0);
  }
});
