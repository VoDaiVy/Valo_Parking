import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { scopeAdminTypography } from './adminTypography.js';

const body = (initial = null) => {
  const attrs = new Map(initial === null ? [] : [['data-valo-typography', initial]]);
  return { getAttribute: (name) => attrs.get(name) ?? null, setAttribute: (name, value) => attrs.set(name, value), removeAttribute: (name) => attrs.delete(name) };
};

test('Admin scope covers body portals and is removed on leaving Admin', () => {
  const element = body();
  const cleanup = scopeAdminTypography(element, 'admin');
  assert.equal(element.getAttribute('data-valo-typography'), 'admin');
  cleanup();
  assert.equal(element.getAttribute('data-valo-typography'), null);
});

test('Staff, Customer and public layouts do not activate Admin typography', () => {
  for (const role of ['staff', 'customer', undefined]) {
    const element = body();
    scopeAdminTypography(element, role)();
    assert.equal(element.getAttribute('data-valo-typography'), null);
  }
});

test('role transition restores previous scope before Staff or Customer rendering', () => {
  const element = body('existing');
  scopeAdminTypography(element, 'admin')();
  scopeAdminTypography(element, 'staff')();
  assert.equal(element.getAttribute('data-valo-typography'), 'existing');
});

test('all stylesheet selectors, including mobile rules, are scoped to Admin', () => {
  const css = postcss.parse(readFileSync(new URL('../styles/adminTypography.css', import.meta.url), 'utf8'));
  css.walkRules((rule) => {
    for (const selector of postcss.list.comma(rule.selector)) {
      assert.match(selector, /^body\[data-valo-typography="admin"\]/);
    }
  });
  css.walkDecls((decl) => assert.ok(!/^(?:color|background|padding|margin|width|height|display|position|transform|zoom)/.test(decl.prop), `Non-typographic property: ${decl.prop}`));
});

test('type family matches Home font loading and Tailwind without adding another font', () => {
  const global = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  const tailwind = readFileSync(new URL('../../tailwind.config.js', import.meta.url), 'utf8');
  const homeLayout = readFileSync(new URL('./MainLayout.jsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles/adminTypography.css', import.meta.url), 'utf8');
  assert.match(global, /family=Montserrat:wght@400;500;600;700;800/);
  assert.match(tailwind, /sans:\s*\["Montserrat", "sans-serif"\]/);
  assert.match(homeLayout, /font-sans/);
  assert.match(css, /--admin-font-family: Montserrat, sans-serif/);
  assert.doesNotMatch(css, /@import|@font-face/);
});
