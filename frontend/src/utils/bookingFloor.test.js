import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFloorLookup, getBookingFloorLabel } from './bookingFloor.js';

const floors = buildFloorLookup([
  { _id: 'floor-1', name: 'Floor 1', floorNumber: 1 },
  { _id: 'floor-2', name: 'Floor 2', floorNumber: 2 },
]);

test('My Bookings resolves a raw floor ID using the current floor list', () => {
  assert.equal(getBookingFloorLabel({ floorId: 'floor-2', parkingSlot: 'E1' }, floors), 'Floor 2');
});

test('My Bookings still displays a populated floor when the floor list is unavailable', () => {
  assert.equal(getBookingFloorLabel({ floorId: { _id: 'floor-1', name: 'Floor 1', floorNumber: 1 } }), 'Floor 1');
});

test('a generic floor name uses its floor number', () => {
  assert.equal(getBookingFloorLabel({ floorId: { _id: 'floor-2', name: 'Floor', floorNumber: 2 } }), 'Floor 2');
});
