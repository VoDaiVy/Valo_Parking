# Staff Real-Data Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace misleading Staff dashboard diagnostics with database-derived values and make Staff session reads use the authenticated API path while preserving Gate A-01 as a symbolic future feature.

**Architecture:** Extract pure Staff dashboard selectors into a tested utility so floor occupancy, maintenance, overdue sessions, and cancellations are computed deterministically from existing MongoDB-backed API responses. Add a focused session service on top of `apiFetch`, consume it from all Staff pages, and protect the backend all-sessions endpoint for Staff/Admin.

**Tech Stack:** React 19, Vite ES modules, Node.js built-in test runner, Express 5, Mongoose 8.

## Global Constraints

- Gate A-01 manual controls, action buttons, and sensor/camera diagnostic remain unchanged as an intentional future-feature placeholder.
- Operational diagnostics must come from floor, slot, session, and booking records returned by existing APIs.
- Loading, unavailable, and error states must not be rendered as healthy data.
- Preserve the user's existing `frontend/.env` modification.
- Do not add dependencies or redesign Staff pages.

---

### Task 1: Database-backed Lot Diagnostics

**Files:**
- Create: `frontend/src/utils/staffDashboardDiagnostics.js`
- Create: `frontend/src/utils/staffDashboardDiagnostics.test.js`
- Modify: `frontend/src/pages/Staff/Dashboard.jsx`

**Interfaces:**
- Consumes: floor `_id`, layout slot names, `Slot.floorID/status/maintenanceReason`, `Session.floorId/parkingSlot/status/checkInTime/expectedDurationHours`, and `Booking.floorId/status/updatedAt/createdAt`.
- Produces: `buildStaffDashboardMetrics({ floors, dbSlots, sessions, bookings, now })` returning `{ totalSlots, activeFloor, activeFloorSlots, vehiclesInside, cancellationsToday, recentBookings, occupancyRate, maintenanceSlots, overdueSessions }`.

- [ ] **Step 1: Write the failing selector tests**

Create tests with `node:test` and `node:assert/strict` covering these exact behaviors:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStaffDashboardMetrics } from './staffDashboardDiagnostics.js';

const floor = {
  _id: 'floor-1',
  name: 'Floor 1',
  layoutData: { elements: [
    { id: 'slot-a1', name: 'A1', type: 'slot' },
    { id: 'slot-a2', name: 'A2', type: 'slot' },
  ] },
};

test('calculates active-floor occupancy from matching active sessions', () => {
  const result = buildStaffDashboardMetrics({
    floors: [floor, { ...floor, _id: 'floor-2', name: 'Floor 2' }],
    dbSlots: [],
    sessions: [
      { status: 'active', floorId: 'floor-1', parkingSlot: 'A1' },
      { status: 'active', floorId: 'floor-2', parkingSlot: 'A2' },
    ],
    bookings: [],
    now: new Date('2026-07-24T12:00:00.000Z'),
  });
  assert.equal(result.vehiclesInside, 2);
  assert.equal(result.occupancyRate, 50);
});

test('returns real maintenance slots and reasons for the active floor', () => {
  const result = buildStaffDashboardMetrics({
    floors: [floor],
    dbSlots: [
      { slotNumber: 'A2', floorID: 'floor-1', status: 'maintenance', maintenanceReason: 'Camera calibration' },
      { slotNumber: 'B1', floorID: 'floor-2', status: 'maintenance', maintenanceReason: 'Ignore other floor' },
    ],
    sessions: [], bookings: [], now: new Date('2026-07-24T12:00:00.000Z'),
  });
  assert.deepEqual(result.maintenanceSlots.map(({ slotNumber, maintenanceReason }) => ({ slotNumber, maintenanceReason })), [
    { slotNumber: 'A2', maintenanceReason: 'Camera calibration' },
  ]);
});

test('detects overdue active sessions only when timing data is complete', () => {
  const result = buildStaffDashboardMetrics({
    floors: [floor], dbSlots: [], bookings: [],
    sessions: [
      { _id: 'late', status: 'active', floorId: 'floor-1', parkingSlot: 'A1', checkInTime: '2026-07-24T08:00:00.000Z', expectedDurationHours: 2 },
      { _id: 'future', status: 'active', floorId: 'floor-1', parkingSlot: 'A2', checkInTime: '2026-07-24T11:00:00.000Z', expectedDurationHours: 2 },
      { _id: 'unknown', status: 'active', floorId: 'floor-1', parkingSlot: 'A2' },
    ],
    now: new Date('2026-07-24T12:00:00.000Z'),
  });
  assert.deepEqual(result.overdueSessions.map((session) => session._id), ['late']);
});

test('counts only cancellations from the current day and sorts recent bookings newest first', () => {
  const bookings = [
    { _id: 'old', status: 'CANCELLED', updatedAt: '2026-07-23T23:59:59.000Z' },
    { _id: 'new', status: 'CANCELLED', updatedAt: '2026-07-24T11:00:00.000Z' },
    { _id: 'latest', status: 'COMPLETED', createdAt: '2026-07-24T11:30:00.000Z' },
  ];
  const result = buildStaffDashboardMetrics({ floors: [floor], dbSlots: [], sessions: [], bookings, now: new Date('2026-07-24T12:00:00.000Z') });
  assert.equal(result.cancellationsToday, 1);
  assert.deepEqual(result.recentBookings.map((booking) => booking._id), ['latest', 'new', 'old']);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test src/utils/staffDashboardDiagnostics.test.js` from `frontend`.

Expected: FAIL because `staffDashboardDiagnostics.js` does not exist.

- [ ] **Step 3: Implement the pure selector**

Implement these rules:

```js
const objectId = (value) => String(value?._id || value || '');
const isActive = (session) => String(session?.status || '').toLowerCase() === 'active';
const sameCalendarDay = (value, now) => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) &&
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
};
```

Use the first configured floor as `activeFloor`, filter layout elements whose type starts with `slot`, count all active sessions globally for `vehiclesInside`, count unique active-floor slot names for `occupancyRate`, filter maintenance and overdue records to the active floor, count current-day cancellations, and sort five recent bookings newest-first by `createdAt || scheduledStart || updatedAt`.

- [ ] **Step 4: Run selector tests and verify GREEN**

Run: `node --test src/utils/staffDashboardDiagnostics.test.js` from `frontend`.

Expected: 4 tests pass, 0 fail.

- [ ] **Step 5: Integrate metrics and diagnostics into Overview**

Import `buildStaffDashboardMetrics`, replace the current inline metrics `useMemo`, and render database-derived diagnostic pills before the preserved Gate pill:

```jsx
{maintenanceSlots.length > 0 && (
  <AlertPill
    icon={<Wrench size={16} className="text-orange-400" />}
    text={`${maintenanceSlots.length} slot(s) under maintenance: ${maintenanceSlots.map((slot) => `${slot.slotNumber}${slot.maintenanceReason ? ` (${slot.maintenanceReason})` : ''}`).join(', ')}`}
    time="Database status" level="warn"
  />
)}
{overdueSessions.length > 0 && (
  <AlertPill
    icon={<AlertTriangle size={16} className="text-red-400" />}
    text={`${overdueSessions.length} active session(s) exceeded their expected duration.`}
    time="Requires attention" level="error"
  />
)}
```

Keep the capacity and cancellation pills driven by the new selector. Keep the Gate A-01 sensor/camera pill byte-for-byte in behavior and copy.

- [ ] **Step 6: Verify Task 1**

Run from `frontend`:

```powershell
node --test src/utils/staffDashboardDiagnostics.test.js
npx.cmd eslint src/utils/staffDashboardDiagnostics.js src/utils/staffDashboardDiagnostics.test.js src/pages/Staff/Dashboard.jsx
```

Expected: all tests pass and ESLint exits 0.

- [ ] **Step 7: Commit Task 1**

```powershell
git add frontend/src/utils/staffDashboardDiagnostics.js frontend/src/utils/staffDashboardDiagnostics.test.js frontend/src/pages/Staff/Dashboard.jsx
git commit -m "fix: use real staff dashboard diagnostics"
```

---

### Task 2: Authenticated Staff Session Data

**Files:**
- Create: `frontend/src/services/sessionService.js`
- Create: `frontend/src/services/sessionService.test.js`
- Modify: `frontend/src/pages/Staff/Dashboard.jsx`
- Modify: `frontend/src/pages/Staff/SessionManagement.jsx`
- Modify: `frontend/src/pages/Staff/LiveGridMonitor.jsx`
- Modify: `backend/src/routes/sessionRoutes.js`
- Test: `backend/src/tests/sessionRoutes.unit.test.js`

**Interfaces:**
- Produces: `getAllSessions()` and `getActiveSessions()` returning the standard `{ ok, status, data }` result from `apiFetch`.
- Backend contract: `GET /api/sessions` is limited to authenticated `staff` and `admin`; `GET /api/sessions/active-status` remains available to existing kiosk/map consumers.

- [ ] **Step 1: Write failing frontend service tests**

Stub `globalThis.fetch` and a minimal `globalThis.localStorage`, call both service functions, and assert requests target `/sessions` and `/sessions/active-status` with `Authorization: Bearer staff-token`.

- [ ] **Step 2: Run frontend service tests and verify RED**

Run: `node --test src/services/sessionService.test.js` from `frontend`.

Expected: FAIL because `sessionService.js` does not exist.

- [ ] **Step 3: Implement the session service**

```js
import { apiFetch } from './api';

const authHeader = () => ({
  Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
});

export const getAllSessions = () => apiFetch('/sessions', { method: 'GET', headers: authHeader() });
export const getActiveSessions = () => apiFetch('/sessions/active-status', { method: 'GET', headers: authHeader() });
```

- [ ] **Step 4: Add failing backend route authorization test**

Create a route wiring unit test that stubs `protect`, `authorize`, and `sessionController.getAllSessions`, loads `sessionRoutes.js`, and asserts the `/` GET layer contains `protect`, `authorize('staff', 'admin')`, then the controller.

- [ ] **Step 5: Run backend route test and verify RED**

Run: `node --test src/tests/sessionRoutes.unit.test.js` from `backend`.

Expected: FAIL because the `/` route currently registers only the controller.

- [ ] **Step 6: Protect the backend all-sessions route**

Change the route to:

```js
router.get('/', protect, authorize('staff', 'admin'), sessionController.getAllSessions);
```

- [ ] **Step 7: Replace Staff direct session fetches**

- Dashboard: replace `API_BASE`/raw `fetch` with `getAllSessions()` and validate `sessionsRes.ok && sessionsRes.data?.success`.
- Session Management: use `getAllSessions()`, add a visible `error` state, and never convert a failed request into an empty successful table.
- Live Grid Monitor: replace the inline `apiFetch('/sessions/active-status')` call with `getActiveSessions()`.

- [ ] **Step 8: Verify Task 2**

Run:

```powershell
Set-Location frontend
node --test src/services/sessionService.test.js src/utils/staffDashboardDiagnostics.test.js
npx.cmd eslint src/services/sessionService.js src/services/sessionService.test.js src/pages/Staff/Dashboard.jsx src/pages/Staff/SessionManagement.jsx src/pages/Staff/LiveGridMonitor.jsx
Set-Location ../backend
node --test src/tests/sessionRoutes.unit.test.js
```

Expected: all tests pass and ESLint exits 0.

- [ ] **Step 9: Commit Task 2**

```powershell
git add frontend/src/services/sessionService.js frontend/src/services/sessionService.test.js frontend/src/pages/Staff/Dashboard.jsx frontend/src/pages/Staff/SessionManagement.jsx frontend/src/pages/Staff/LiveGridMonitor.jsx backend/src/routes/sessionRoutes.js backend/src/tests/sessionRoutes.unit.test.js
git commit -m "fix: authenticate staff session data"
```

---

### Task 3: Full Staff Fake-Data Audit and Verification

**Files:**
- Inspect: `frontend/src/App.jsx`
- Inspect: `frontend/src/layouts/DashboardLayout.jsx`
- Inspect: `frontend/src/pages/Staff/**/*.jsx`
- Inspect: `frontend/src/pages/Admin/SubscriptionManagement.jsx`
- Inspect: `frontend/src/pages/Admin/TicketPackages.jsx`
- Inspect: `frontend/src/pages/Customer/CustomerNotifications.jsx`

**Interfaces:**
- Consumes: all active Staff routes from `frontend/src/App.jsx` and sidebar entries from `frontend/src/layouts/DashboardLayout.jsx`.
- Produces: an evidence-backed audit with no active non-Gate operational sample arrays, fake healthy statuses, or unauthenticated Staff data reads.

- [ ] **Step 1: Run the source audit**

Run:

```powershell
rg -n "mock|dummy|sampleCustomers|Math\.random|operating normally|System verified|const\s+\w+\s*=\s*\[" frontend/src/pages/Staff frontend/src/pages/Admin/SubscriptionManagement.jsx frontend/src/pages/Admin/TicketPackages.jsx frontend/src/pages/Customer/CustomerNotifications.jsx
rg -n "fetch\(|API_BASE" frontend/src/pages/Staff
```

Classify each hit under the Global Constraints. Gate A-01 hits and unused legacy notification modules are allowed; active non-Gate operational sample data is not.

- [ ] **Step 2: Verify every audit hit against active imports and API sources**

Confirm that `sampleCustomers` exists only in the unused legacy `pages/Staff/notifications/ComposeForm.jsx`, that the active notification route renders the API-backed `pages/Staff/NotificationManagement.jsx`, and that every remaining array hit is presentation metadata or a filter list. Confirm all direct Staff session reads were removed in Task 2. No production edit is required when these checks hold.

- [ ] **Step 3: Run complete verification**

Run:

```powershell
Set-Location frontend
node --test src/utils/*.test.js src/services/*.test.js
npm.cmd run lint
npm.cmd run build
Set-Location ../backend
npm.cmd test
```

Expected: test suites, lint, and build exit 0. Any pre-existing failure must be reported with its exact command and output instead of being hidden.

- [ ] **Step 4: Review the final diff**

Run:

```powershell
git diff --check
git status --short
git diff -- frontend/src/pages/Staff frontend/src/services backend/src/routes backend/src/tests
```

Confirm `frontend/.env` is not staged or modified by this implementation.
