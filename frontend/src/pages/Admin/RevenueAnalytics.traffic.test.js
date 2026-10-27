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
const compiled = await transformWithOxc(`${utilities}\nconst useState = React.useState;\nconst WalletCards = () => null;\n${chart}\n${emptyState}`, 'TrafficTest.jsx', { jsx: { runtime: 'classic' } });
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
test('monthly traffic renders exactly two grouped bars per API bucket, including true zeros', () => {
  const traffic = Array.from({length:12}, (_,index)=>({period:`2026-${String(index+1).padStart(2,'0')}`, entries:index===8?158:0, exits:index===8?156:0}));
  const html = renderTraffic(traffic,'month');
  assert.equal(rectangles(html).length,24);
  assert.equal((html.match(/data-series="entries"/g)||[]).length,12);
  assert.equal((html.match(/data-count="158"/g)||[]).length,1);
  assert.equal((html.match(/data-count="156"/g)||[]).length,1);
  assert.match(html,/Jan 2026/); assert.match(html,/Dec 2026/);
  assert.match(html,/url\(#ra-traffic-entries\)/); assert.match(html,/url\(#ra-traffic-exits\)/);
});
test('one legacy annual point uses its real counts without interpolated months', () => {
  const html = renderTraffic([{period:'2026',entries:158,exits:156}]);
  assert.equal(rectangles(html).length,2);
  assert.match(html,/Entries: 158/); assert.match(html,/Exits: 156/);
});
test('two monthly buckets preserve all four event counts', () => {
  const html=renderTraffic([{period:'2026-01',entries:20,exits:15},{period:'2026-02',entries:30,exits:25}],'month');
  assert.equal(rectangles(html).length,4);
  for(const value of [20,15,30,25]) assert.ok(html.includes(`data-count="${value}"`));
});
test('zero and missing traffic remain different states', () => {
  for(const traffic of [[],[{period:'2026',entries:0,exits:0}]]) {
    const html=renderTraffic(traffic); assert.match(html,/No vehicle activity/); assert.equal(rectangles(html).length,0);
  }
  const html=renderTraffic([{period:'2026',entries:null,exits:0}]);
  assert.match(html,/Vehicle traffic unavailable/); assert.equal(rectangles(html).length,0);
});

test('traffic hover and focus show both actual counts; leave, blur and Escape dismiss the tooltip', () => {
  let active = null;
  const runtime = {...React, useState: () => [active, value => { active = value; }]};
  const Chart = new Function('React', 'motion', `${compiled.code}\nreturn VehicleTrafficSection;`)(runtime, motion);
  const props = {traffic:[{period:'2026-07-14',entries:5,exits:3}],trafficSummary:{totalEntries:5,totalExits:3,currentlyParked:0},granularity:'day'};
  const walk = node => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(walk)];
  const target = () => walk(Chart(props)).find(node => node.type === 'path' && node.props.onPointerEnter);
  const html = () => renderToStaticMarkup(Chart(props));
  assert.ok(!html().includes('role="tooltip"'));
  target().props.onPointerEnter();
  assert.match(html(), /role="tooltip"/);
  assert.match(html(), /2026-07-14<\/strong>/);
  assert.match(html(), /Entries<\/span><b[^>]*>5<\/b>/);
  assert.match(html(), /Exits<\/span><b[^>]*>3<\/b>/);
  target().props.onPointerLeave(); assert.ok(!html().includes('role="tooltip"'));
  target().props.onFocus(); assert.ok(html().includes('role="tooltip"'));
  target().props.onKeyDown({key:'Escape'}); assert.ok(!html().includes('role="tooltip"'));
  target().props.onFocus(); target().props.onBlur(); assert.ok(!html().includes('role="tooltip"'));
});
