import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STAFF_DENSITY_CLASS,
  getDashboardDensityClass,
} from './staffDensity.js';

test('activates responsive density only for Staff dashboards', () => {
  assert.equal(STAFF_DENSITY_CLASS, 'staff-density-active');
  assert.equal(getDashboardDensityClass('staff'), STAFF_DENSITY_CLASS);
  assert.equal(getDashboardDensityClass('admin'), '');
  assert.equal(getDashboardDensityClass('customer'), '');
  assert.equal(getDashboardDensityClass(undefined), '');
});

test('defines scoped compact and dense laptop tiers without page scaling', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('./DashboardLayout.jsx', import.meta.url), 'utf8');

  assert.match(css, /html\.staff-density-active/);
  assert.match(css, /max-width:\s*1600px/);
  assert.match(css, /max-height:\s*900px/);
  assert.match(css, /font-size:\s*14px/);
  assert.match(css, /max-width:\s*1400px/);
  assert.match(css, /max-height:\s*780px/);
  assert.match(css, /font-size:\s*13px/);
  assert.doesNotMatch(css, /\.staff-density-active[^}]*\bzoom\s*:/s);
  assert.doesNotMatch(css, /\.staff-density-active[^}]*transform:\s*scale\(/s);
  assert.match(layout, /getDashboardDensityClass\(role\)/);
});
