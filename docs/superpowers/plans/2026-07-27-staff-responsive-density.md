# Staff Responsive Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Staff dashboard unchanged at 1920x1080 while automatically reducing its desktop density on MacBook and laptop-sized CSS viewports.

**Architecture:** A small pure helper owns the Staff-only density class contract. `DashboardLayout` applies that class only for the `staff` role, while scoped media queries in `index.css` adjust the root `rem` scale and Staff shell fixed dimensions at compact desktop breakpoints. No page scaling transform, CSS zoom, resize listener, or business-logic change is introduced.

**Tech Stack:** React 19, Tailwind CSS 3, vanilla CSS media queries, Node.js built-in test runner, ESLint, Vite 8.

## Global Constraints

- Apply density changes only while `DashboardLayout` renders a Staff session.
- Preserve the existing 1920x1080 Staff appearance.
- Do not change Admin, Customer, Kiosk, backend behavior, routing, or business logic.
- Preserve existing mobile/tablet behavior below 1024px.
- Do not use `transform: scale()` or whole-page CSS `zoom`.
- Compact desktop uses 14px at viewport widths up to 1600px or heights up to 900px.
- Dense laptop uses 13px at viewport widths up to 1400px or heights up to 780px.

---

### Task 1: Define and test the Staff density contract

**Files:**
- Create: `frontend/src/layouts/staffDensity.js`
- Create: `frontend/src/layouts/staffDensity.test.js`

**Interfaces:**
- Produces: `STAFF_DENSITY_CLASS: string` and `getDashboardDensityClass(role: string | undefined): string`.
- Consumed by: `DashboardLayout.jsx` and the source-contract test.

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layouts/staffDensity.test.js`

Expected: FAIL because `staffDensity.js` does not exist.

- [ ] **Step 3: Write the minimal helper**

```js
export const STAFF_DENSITY_CLASS = 'staff-density-active';

export function getDashboardDensityClass(role) {
  return role === 'staff' ? STAFF_DENSITY_CLASS : '';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/layouts/staffDensity.test.js`

Expected: one passing test and zero failures.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/layouts/staffDensity.js frontend/src/layouts/staffDensity.test.js
git commit -m "test: define staff density contract"
```

### Task 2: Activate density in the Staff shell and add responsive tiers

**Files:**
- Modify: `frontend/src/layouts/DashboardLayout.jsx:1-5,318-400`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/layouts/staffDensity.test.js`

**Interfaces:**
- Consumes: `getDashboardDensityClass(role)` from Task 1.
- Produces: a Staff-only shell marker and media-query behavior for compact desktop and dense laptop viewports.

- [ ] **Step 1: Extend the test with source-level breakpoint assertions**

The test reads `index.css` and `DashboardLayout.jsx`, then asserts:

```js
assert.match(css, /html\.staff-density-active/);
assert.match(css, /max-width:\s*1600px/);
assert.match(css, /max-height:\s*900px/);
assert.match(css, /font-size:\s*14px/);
assert.match(css, /max-width:\s*1400px/);
assert.match(css, /max-height:\s*780px/);
assert.match(css, /font-size:\s*13px/);
assert.doesNotMatch(css, /transform:\s*scale\(/);
assert.doesNotMatch(css, /zoom\s*:/);
assert.match(layout, /getDashboardDensityClass\(role\)/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/layouts/staffDensity.test.js`

Expected: FAIL because the CSS tiers and layout integration are absent.

- [ ] **Step 3: Integrate the Staff marker**

Import `getDashboardDensityClass` in `DashboardLayout.jsx`, compute `densityClass`, and append it to the outer shell class. Add stable hook classes to the shell, sidebar, collapsed sidebar, topbar, and collapse control. Convert fixed sidebar/topbar measurements from pixel arbitrary values to equivalent `rem` values so root density changes affect them.

- [ ] **Step 4: Add scoped responsive CSS**

Append media queries that set `html.staff-density-active` to 14px in compact desktop and 13px in dense laptop. Scope shell overrides to `.staff-density-active` and keep all rules inside `min-width: 1024px` desktop conditions.

- [ ] **Step 5: Run the focused test and lint**

Run:

```bash
node --test src/layouts/staffDensity.test.js
npx eslint src/layouts/DashboardLayout.jsx src/layouts/staffDensity.js src/layouts/staffDensity.test.js
```

Expected: all tests pass and ESLint exits with code 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/layouts/DashboardLayout.jsx frontend/src/layouts/staffDensity.js frontend/src/layouts/staffDensity.test.js frontend/src/index.css
git commit -m "feat: adapt staff density for laptop viewports"
```

### Task 3: Verify regression safety and production output

**Files:**
- Verify only; no production files should change.

**Interfaces:**
- Consumes: the complete Staff responsive density implementation.
- Produces: verification evidence for test, lint, build, scope, and whitespace cleanliness.

- [ ] **Step 1: Run focused tests**

Run: `node --test src/layouts/staffDensity.test.js`

Expected: all tests pass.

- [ ] **Step 2: Run targeted lint**

Run: `npx eslint src/layouts/DashboardLayout.jsx src/layouts/staffDensity.js src/layouts/staffDensity.test.js`

Expected: exit code 0 with no errors.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: Vite completes successfully; the existing large-chunk warning is non-blocking.

- [ ] **Step 4: Audit scope and diff formatting**

Run:

```bash
git diff --check
git diff --name-only HEAD~1..HEAD
```

Expected: no whitespace errors and only Staff density layout/CSS/test files appear in the implementation commit.

- [ ] **Step 5: Perform optional browser verification**

If an interactive browser is available, inspect Staff pages at 1920x1080, 1512x982, 1440x900, and 1536x768. Confirm the large viewport stays unchanged and compact tiers reduce typography, shell dimensions, spacing, and row height without clipping or overlay misalignment.
