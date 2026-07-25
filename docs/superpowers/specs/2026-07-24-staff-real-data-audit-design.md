# Staff Real-Data Audit Design

## Goal

Audit every route visible in the Staff console and replace operational content that is mocked, hardcoded, or derived from an incorrect source with data already persisted by the backend. The Gate A-01 panel and its sensor/camera status remain as a clearly intentional future-feature placeholder.

## Scope

The audit covers the Staff routes registered in `frontend/src/App.jsx`, including shared pages used by Staff:

- Overview dashboard
- Customer management
- Session management
- Live grid monitor
- Booking management
- Ticket packages
- Subscriptions
- Notification management and notification inbox
- Staff profile

Static presentation configuration is not fake operational data. Labels, filter choices, priority metadata, status colors, legends, empty-state copy, and permission descriptions remain local constants.

The following Gate A-01 content is explicitly excluded from real-data replacement because it represents a planned future integration:

- Manual gate control state and controls
- Gate A-01 sensor/camera status shown in Lot Diagnostics
- Gate-related action buttons

## Selected Approach

Prefer existing authenticated APIs and data already fetched by each page. Do not add a dashboard aggregation endpoint unless the existing data cannot represent a required diagnostic.

For the Overview page, derive Lot Diagnostics from database-backed floor layouts, `Slot` records, active/all `Session` records, and `Booking` records already loaded by the dashboard. This avoids duplicate requests and keeps the summary consistent with Live Grid.

## Overview Diagnostics

Lot Diagnostics will be generated deterministically from the fetched records:

1. Capacity diagnostic uses the selected floor's real slot count and real occupied-slot count, not the total number of sessions across all floors.
2. Maintenance diagnostic reports the count of real `Slot` documents whose status is `maintenance`. When available, the displayed detail uses their `maintenanceReason` and slot number.
3. Overdue-session diagnostic reports active sessions whose expected end time has passed. Expected end time is calculated from `checkInTime` plus `expectedDurationHours`; records without enough timing information are not classified as overdue.
4. Cancellation diagnostic reports bookings updated or created today with status `CANCELLED`.
5. Healthy diagnostics appear only when their corresponding database-backed condition has been evaluated successfully.
6. The Gate A-01 sensor/camera diagnostic remains unchanged as an intentional symbolic item.

Diagnostics are ordered by severity: error, warning, then healthy. Each diagnostic receives a stable key so React rendering is predictable.

## Other Staff Pages

The audit will classify every displayed value as one of:

- Database-backed operational data
- User/session identity data
- Static presentation configuration
- Intentional Gate A-01 placeholder
- Unmapped or misleading operational data

Unmapped operational values will be connected to an existing service/API where available. Direct unauthenticated requests used by Staff pages will be migrated to the shared authenticated `apiFetch` path. Existing endpoint response schemas will be normalized at the service/page boundary, and failures will render explicit error or unavailable states rather than believable zeroes or healthy statuses.

Unused legacy Staff notification components are not part of the rendered route and will not be expanded merely because they contain sample data. If an active route imports them during implementation, their sample data must be removed before completion.

## Data Flow

1. A Staff route calls a frontend service built on `apiFetch` with the access token.
2. The backend applies the existing Staff/Admin authorization policy and queries MongoDB.
3. The frontend validates the response's `ok` and `success` fields before updating state.
4. Pure mapping functions transform records into view models and diagnostics.
5. Loading, empty, and error states remain distinct; an error must never be rendered as a healthy diagnostic.

## Error Handling

- A failed source request must be surfaced with an unavailable/error message for the affected block.
- Previously loaded data may remain visible during background refresh, but it must not be relabeled as freshly synchronized.
- Invalid dates, missing optional relationships, and deleted referenced records must use safe fallback labels.
- One failed dashboard source must not erase successfully loaded results from unrelated sources.

## Testing

Implementation follows test-driven development:

- Add unit tests for pure diagnostic mapping, including capacity, maintenance, overdue sessions, cancellations, ordering, and incomplete records.
- Verify the new tests fail before production changes.
- Add or extend backend tests only when a backend contract must change.
- Run targeted tests after each change, then frontend lint/build and the backend test suite.
- Perform a final source audit for sample arrays, mocked operational values, unauthenticated Staff fetches, fake healthy statuses, and inactive route links.

## Non-Goals

- Building the Gate A-01 hardware integration
- Persisting gate state
- Redesigning Staff pages
- Replacing static UI metadata with database tables
- Refactoring unrelated Admin or Customer behavior
