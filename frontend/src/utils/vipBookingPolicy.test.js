import test from 'node:test';
import assert from 'node:assert/strict';
import { getVipBookingSelection } from './vipBookingPolicy.js';

const membership = {
  isVip: true,
  packageType: 'monthly',
  expireAt: '2099-02-01T00:00:00Z',
  reservedSlots: [{ floorId: 'floor-1', slotNumber: 'A-015', expireAt: '2099-02-01T00:00:00Z' }],
};
const vehicle = { _id: 'vehicle-1', licensePlate: '43A12345', status: 'approved' };
const input = {
  membership, vehicles: [vehicle], selectedVehicle: vehicle,
  selectedSlot: { floorId: 'floor-2', slotCode: 'A-015' },
  startTime: '2099-01-15T08:00:00Z',
  endTime: '2099-01-15T09:00:00Z',
};

test('monthly VIP blocks an ordinary slot even when it shares a code with the assigned slot', () => {
  const result = getVipBookingSelection(input);
  assert.equal(result.selectedSlotIsOwnVipSlot, false);
  assert.equal(result.selectedRegisteredVehicleBlockedByVip, true);
});

test('monthly and yearly VIP accept the assigned slot on the correct floor', () => {
  for (const packageType of ['monthly', 'yearly']) {
    const result = getVipBookingSelection({
      ...input,
      membership: { ...membership, packageType },
      selectedSlot: { floorId: 'floor-1', slotCode: 'a-015' },
    });
    assert.equal(result.selectedSlotIsOwnVipSlot, true);
    assert.equal(result.selectedRegisteredVehicleBlockedByVip, false);
  }
});

test('an approved plate entered manually follows the same VIP rule', () => {
  const result = getVipBookingSelection({ ...input, selectedVehicle: null, manualPlate: '43A-123.45' });
  assert.equal(result.isRegisteredPlate, true);
  assert.equal(result.selectedRegisteredVehicleBlockedByVip, true);
});

test('a booking after membership expiry or an unapproved vehicle is not VIP-blocked', () => {
  const expired = getVipBookingSelection({ ...input, startTime: '2099-02-02T08:00:00Z' });
  assert.equal(expired.selectedRegisteredVehicleBlockedByVip, false);
  const unapproved = getVipBookingSelection({ ...input, vehicles: [{ ...vehicle, status: 'pending' }] });
  assert.equal(unapproved.selectedRegisteredVehicleBlockedByVip, false);
});

test('an entitlement expiring before the booking starts is not an assigned VIP slot for that time', () => {
  const result = getVipBookingSelection({
    ...input,
    membership: { ...membership, reservedSlots: [{ ...membership.reservedSlots[0], expireAt: '2099-01-14T00:00:00Z' }] },
    selectedSlot: { floorId: 'floor-1', slotCode: 'A-015' },
  });
  assert.equal(result.selectedSlotIsOwnVipSlot, false);
  assert.equal(result.selectedRegisteredVehicleBlockedByVip, true);
});

test('an assigned VIP slot cannot be treated as free if the stay ends after entitlement expiry', () => {
  const result = getVipBookingSelection({
    ...input,
    membership: { ...membership, reservedSlots: [{ ...membership.reservedSlots[0], expireAt: '2099-01-15T08:30:00Z' }] },
    selectedSlot: { floorId: 'floor-1', slotCode: 'A-015' },
  });
  assert.equal(result.selectedSlotIsOwnVipSlot, false);
  assert.equal(result.selectedRegisteredVehicleBlockedByVip, true);
});
