import test from 'node:test';
import assert from 'node:assert/strict';
import * as dashboardDiagnostics from './staffDashboardDiagnostics.js';

const {
  buildStaffDashboardMetrics,
  getStaffDashboardSyncStatus,
  getStaffDashboardViewAvailability,
} = dashboardDiagnostics;

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
    { _id: 'old', status: 'CANCELLED', updatedAt: '2026-07-23T10:00:00.000Z' },
    { _id: 'new', status: 'CANCELLED', updatedAt: '2026-07-24T11:00:00.000Z' },
    { _id: 'latest', status: 'COMPLETED', createdAt: '2026-07-24T11:30:00.000Z' },
  ];
  const result = buildStaffDashboardMetrics({ floors: [floor], dbSlots: [], sessions: [], bookings, now: new Date('2026-07-24T12:00:00.000Z') });
  assert.equal(result.cancellationsToday, 1);
  assert.deepEqual(result.recentBookings.map((booking) => booking._id), ['latest', 'new', 'old']);
});

test('reports healthy diagnostics only after every operational source succeeds', () => {
  assert.deepEqual(getStaffDashboardSyncStatus({
    floors: true,
    bookings: true,
    sessions: true,
    slotsOk: true,
    revenue: true,
  }), {
    isAvailable: true,
    error: '',
    sources: {
      floors: true,
      bookings: true,
      sessions: true,
      slotsOk: true,
      revenue: true,
    },
  });
});

test('reports failed operational sources as unavailable diagnostics', () => {
  assert.deepEqual(getStaffDashboardSyncStatus({
    floors: true,
    bookings: false,
    sessions: false,
    slotsOk: true,
    revenue: true,
  }), {
    isAvailable: false,
    error: 'Booking and session data unavailable.',
    sources: {
      floors: true,
      bookings: false,
      sessions: false,
      slotsOk: true,
      revenue: true,
    },
  });
});

test('reports unavailable diagnostics when a configured floor slot source fails', () => {
  assert.deepEqual(getStaffDashboardSyncStatus({
    floors: true,
    bookings: true,
    sessions: true,
    slotsOk: false,
    revenue: true,
  }), {
    isAvailable: false,
    error: 'Slots data unavailable.',
    sources: {
      floors: true,
      bookings: true,
      sessions: true,
      slotsOk: false,
      revenue: true,
    },
  });
});

test('revenue failure makes overall sync unavailable without hiding healthy operations', () => {
  assert.equal(typeof dashboardDiagnostics.getStaffDashboardOperationalStatus, 'function');
  const { getStaffDashboardOperationalStatus } = dashboardDiagnostics;
  const sources = {
    floors: true,
    bookings: true,
    sessions: true,
    slotsOk: true,
    revenue: false,
  };

  assert.deepEqual(getStaffDashboardSyncStatus(sources), {
    isAvailable: false,
    error: 'Revenue data unavailable.',
    sources,
  });
  assert.deepEqual(getStaffDashboardOperationalStatus(sources), {
    isAvailable: true,
    error: '',
    sources: {
      floors: true,
      bookings: true,
      sessions: true,
      slotsOk: true,
    },
  });
});

test('enables every staff view when its sync sources are available', () => {
  assert.deepEqual(getStaffDashboardViewAvailability({
    floors: true,
    bookings: true,
    sessions: true,
    slotsOk: true,
  }), {
    liveGrid: true,
    activityStream: true,
    managedSlots: true,
    vehiclesInside: true,
    occupancy: true,
    cancellations: true,
  });
});

test('disables views that depend on unavailable booking or session data', () => {
  assert.deepEqual(getStaffDashboardViewAvailability({
    floors: true,
    bookings: false,
    sessions: false,
    slotsOk: true,
  }), {
    liveGrid: false,
    activityStream: false,
    managedSlots: true,
    vehiclesInside: false,
    occupancy: false,
    cancellations: false,
  });
});

test('returns a no-floor warning instead of a healthy zero-capacity diagnostic', () => {
  assert.equal(typeof dashboardDiagnostics.buildStaffLotDiagnostics, 'function');
  const { buildStaffLotDiagnostics } = dashboardDiagnostics;
  const metrics = buildStaffDashboardMetrics({
    floors: [],
    dbSlots: [],
    sessions: [],
    bookings: [],
    now: new Date('2026-07-24T12:00:00.000Z'),
  });

  const diagnostics = buildStaffLotDiagnostics({ metrics });

  assert.deepEqual(diagnostics.map(({ key, level }) => ({ key, level })), [
    { key: 'no-floor', level: 'warn' },
  ]);
  assert.equal(
    diagnostics.some(({ key }) => key === 'capacity-healthy'),
    false
  );
});

test('orders overdue before warnings and healthy capacity last', () => {
  assert.equal(typeof dashboardDiagnostics.buildStaffLotDiagnostics, 'function');
  const { buildStaffLotDiagnostics } = dashboardDiagnostics;
  const diagnostics = buildStaffLotDiagnostics({
    metrics: {
      activeFloor: floor,
      activeFloorSlots: floor.layoutData.elements,
      occupancyRate: 50,
      overdueSessions: [{ _id: 'late' }],
      maintenanceSlots: [{ slotNumber: 'A2', maintenanceReason: 'Repair' }],
      cancellationsToday: 2,
    },
  });

  assert.deepEqual(diagnostics.map(({ key }) => key), [
    'overdue',
    'maintenance',
    'cancellations',
    'capacity-healthy',
  ]);
});
