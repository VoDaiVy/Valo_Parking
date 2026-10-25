import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Toaster } from 'react-hot-toast';
import { scopeStaffTypography } from './staffTypography.js';
import { scopeAdminTypography } from './adminTypography.js';

const attribute = 'data-valo-typography';
const body = (initial = null) => {
  const attrs = new Map(initial === null ? [] : [[attribute, initial]]);
  return { getAttribute: (name) => attrs.get(name) ?? null, setAttribute: (name, value) => attrs.set(name, value), removeAttribute: (name) => attrs.delete(name) };
};
const source = readFileSync(new URL('../styles/staffTypography.css', import.meta.url), 'utf8');

test('Staff scope activates for portals and restores prior attributes on cleanup', () => {
  for (const initial of [null, 'existing']) {
    const element = body(initial);
    const cleanup = scopeStaffTypography(element, 'staff');
    assert.equal(element.getAttribute(attribute), 'staff');
    cleanup();
    assert.equal(element.getAttribute(attribute), initial);
  }
});
test('Staff/Admin/Customer role transitions isolate styles and clean up scopes', () => {
  const element = body();
  for (const role of ['staff', 'admin', 'customer', undefined, 'staff']) {
    const cleanups = [scopeAdminTypography(element, role), scopeStaffTypography(element, role)];
    assert.equal(element.getAttribute(attribute), ['staff', 'admin'].includes(role) ? role : null);
    cleanups.forEach((cleanup) => cleanup());
    assert.equal(element.getAttribute(attribute), null);
  }
});
test('Neutral palette with emerald accents and Montserrat hierarchy are Staff scoped, including media rules', () => {
  const css = postcss.parse(source);
  css.walkRules((rule) => postcss.list.comma(rule.selector).forEach((selector) => assert.match(selector, /^body\[data-valo-typography="staff"\]/)));
  const tokens = new Map();
  css.walkDecls((decl) => { tokens.set(decl.prop, decl.value); assert.ok(!decl.important); });
  for (const [token, value] of Object.entries({
    '--staff-bg': '#080B0F', '--staff-surface': '#0D1117', '--staff-surface-raised': '#111820',
    '--staff-primary': '#10B981', '--staff-primary-hover': '#54E3B0', '--staff-accent': '#10B981',
    '--staff-text-primary': '#F5F7FA', '--staff-text-secondary': '#9AADC0', '--staff-border': '#222D36',
    '--staff-font-family': 'Montserrat, sans-serif', '--staff-text-page': '30px', '--staff-text-kpi': '24px',
  })) assert.equal(tokens.get(token), value);
  assert.notEqual(tokens.get('--staff-warning'), tokens.get('--staff-available'));
  assert.notEqual(tokens.get('--staff-occupied'), tokens.get('--staff-available'));
  assert.notEqual(tokens.get('--staff-maintenance'), tokens.get('--staff-available'));
  assert.ok(source.includes('prefers-reduced-motion: reduce'));
  assert.doesNotMatch(source, /@import|@font-face|!important/);
});

test('Staff background rules leave the real floating Dashboard toaster transparent', () => {
  const html = renderToStaticMarkup(React.createElement(Toaster, { position: 'top-right' }));
  assert.ok(html.includes('data-rht-toaster='));
  assert.ok(html.includes('position:fixed'));
  assert.ok(html.includes('pointer-events:none'));
  assert.ok(!html.includes('class='));
  const attributes = { 'data-rht-toaster': html.match(/data-rht-toaster="([^"]*)"/)?.[1] };
  // Match a selector's final compound against the actual classless toast root.
  // Exclude unrelated ancestor classes; no Dashboard background may reach it.
  const matchesToast = (selector) => {
    const nodes = selector.nodes;
    const lastCombinator = nodes.findLastIndex((node) => node.type === 'combinator');
    const ancestorClasses = nodes.slice(0, lastCombinator).filter((node) => node.type === 'class');
    if (ancestorClasses.some((node) => !['staff-dashboard-shell', 'dashboard-page-content'].includes(node.value))) return false;
    return nodes.slice(lastCombinator + 1).every((node) => {
      if (node.type === 'universal') return true;
      if (node.type === 'tag') return node.value === 'div';
      if (node.type === 'class' || node.type === 'id') return false;
      if (node.type === 'attribute') return Object.hasOwn(attributes, node.attribute) && (!node.operator || attributes[node.attribute] === node.value);
      if (node.type === 'pseudo' && [':where', ':is'].includes(node.value)) return node.nodes.some(matchesToast);
      if (node.type === 'pseudo' && node.value === ':not') return !node.nodes.some(matchesToast);
      throw new Error(`Unrecognized toast selector constraint: ${node.toString()}`);
    });
  };
  const oldBlanketSelector = selectorParser().astSync('body[data-valo-typography="staff"] .dashboard-page-content > *').first;
  assert.equal(matchesToast(oldBlanketSelector), true, 'Regression guard must detect the original opaque-overlay selector');
  for (const path of ['../styles/staffTypography.css', '../pages/Staff/components/staffDashboard.css']) {
    postcss.parse(readFileSync(new URL(path, import.meta.url), 'utf8')).walkRules((rule) => {
      if (!rule.nodes.some((node) => node.type === 'decl' && ['background', 'background-color', 'background-image'].includes(node.prop))) return;
      selectorParser((root) => root.each((selector) => {
        assert.ok(!matchesToast(selector), `Opaque background can reach the Dashboard toast overlay: ${selector}`);
      })).processSync(rule.selector);
    });
  }
});
