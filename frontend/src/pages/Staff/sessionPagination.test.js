import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SESSION_PAGE_SIZE,
  filterAndSortSessions,
  getPaginationPages,
  paginateSessions,
} from './sessionPagination.js';

const sessions = Array.from({ length: 32 }, (_, index) => ({
  _id: `session-${index + 1}`,
  licensePlate: `PLATE-${index + 1}`,
}));

test('returns at most 15 session records for the requested page', () => {
  const result = paginateSessions(sessions, 2);

  assert.equal(SESSION_PAGE_SIZE, 15);
  assert.equal(result.currentPage, 2);
  assert.equal(result.totalPages, 3);
  assert.equal(result.startIndex, 15);
  assert.equal(result.endIndex, 30);
  assert.deepEqual(
    result.items.map((session) => session._id),
    sessions.slice(15, 30).map((session) => session._id),
  );
});

test('clamps an out-of-range page after the session list shrinks', () => {
  const result = paginateSessions(sessions.slice(0, 4), 99);

  assert.equal(result.currentPage, 1);
  assert.equal(result.totalPages, 1);
  assert.equal(result.startIndex, 0);
  assert.equal(result.endIndex, 4);
  assert.equal(result.items.length, 4);
});

test('keeps an empty session list on a stable first page', () => {
  assert.deepEqual(paginateSessions([], 3), {
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    startIndex: 0,
    endIndex: 0,
    items: [],
  });
});

test('builds compact page controls for long result sets', () => {
  assert.deepEqual(getPaginationPages(5, 10), [
    1,
    'ellipsis-start',
    4,
    5,
    6,
    'ellipsis-end',
    10,
  ]);
  assert.deepEqual(getPaginationPages(2, 4), [1, 2, 3, 4]);
});

const filterSessions = [
  {
    _id: 'new-active',
    licensePlate: '43B20409',
    phone: '0888888888',
    status: 'active',
    checkInTime: '2026-07-24T08:00:00.000Z',
    totalPrice: 0,
  },
  {
    _id: 'middle-completed',
    licensePlate: '93A28987',
    phone: '0904555791',
    status: 'completed',
    checkInTime: '2026-07-23T08:00:00.000Z',
    totalPrice: 50000,
  },
  {
    _id: 'old-cancelled',
    licensePlate: '30A12345',
    phone: null,
    status: 'cancelled',
    checkInTime: '2026-07-21T08:00:00.000Z',
    totalPrice: 20000,
  },
];

test('searches sessions by license plate or phone without case sensitivity', () => {
  assert.deepEqual(
    filterAndSortSessions(filterSessions, { searchQuery: '93a28' }).map((session) => session._id),
    ['middle-completed'],
  );
  assert.deepEqual(
    filterAndSortSessions(filterSessions, { searchQuery: '888888' }).map((session) => session._id),
    ['new-active'],
  );
});

test('filters sessions by status', () => {
  assert.deepEqual(
    filterAndSortSessions(filterSessions, { status: 'completed' }).map((session) => session._id),
    ['middle-completed'],
  );
  assert.equal(filterAndSortSessions(filterSessions, { status: 'all' }).length, 3);
});

test('sorts sessions by newest, oldest, highest price, or lowest price', () => {
  const getIds = (sortBy) => filterAndSortSessions(filterSessions, { sortBy }).map((session) => session._id);

  assert.deepEqual(getIds('newest'), ['new-active', 'middle-completed', 'old-cancelled']);
  assert.deepEqual(getIds('oldest'), ['old-cancelled', 'middle-completed', 'new-active']);
  assert.deepEqual(getIds('price-high'), ['middle-completed', 'old-cancelled', 'new-active']);
  assert.deepEqual(getIds('price-low'), ['new-active', 'old-cancelled', 'middle-completed']);
});
