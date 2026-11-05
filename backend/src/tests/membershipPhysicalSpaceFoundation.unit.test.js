// Phase 1: physical-space unit case extracted from the pinned stash test.
const test = require('node:test');
const assert = require('node:assert/strict');
const Floor = require('../models/ParkingFloor');
const Slot = require('../models/Slot');
const { validateMembershipSpace } = require('../services/membershipSpaceValidationService');
const query = (value) => ({ select() { return this; }, session() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });

test('physical space validation rejects dangling/mismatched/layout/maintenance/ownership references; permits occupied reserved space', async (t) => {
  let floor, slot;
  t.mock.method(Floor, 'findById', () => query(floor));
  t.mock.method(Slot, 'findById', () => query(slot));
  const args = { floorId: 'floor', slotId: 'slot', slotCode: 'M1', ownerId: 'owner', entitlementId: 'ent' };
  const reset = () => {
    floor = { layoutData: { elements: [{ type: 'slot', name: 'M1' }] } };
    slot = { floorID: 'floor', slotNumber: 'M1', status: 'occupied', reservedFor: 'owner', reservedByEntitlementId: 'ent' };
  };
  for (const [change, expected] of [
    [() => { floor = null; }, 'MEMBERSHIP_FLOOR_NOT_FOUND'],
    [() => { slot = null; }, 'MEMBERSHIP_SLOT_NOT_FOUND'],
    [() => { slot.floorID = 'other'; }, 'MEMBERSHIP_SPACE_MISMATCH'],
    [() => { slot.slotNumber = 'B1'; }, 'MEMBERSHIP_SPACE_MISMATCH'],
    [() => { floor.layoutData.elements = []; }, 'MEMBERSHIP_LAYOUT_SLOT_INVALID'],
    [() => { floor.layoutData.elements.push({ type: 'slot', name: 'M1' }); }, 'MEMBERSHIP_LAYOUT_SLOT_INVALID'],
    [() => { slot.status = 'maintenance'; }, 'SLOT_UNDER_MAINTENANCE'],
    [() => { slot.reservedFor = 'new-owner'; }, 'MEMBERSHIP_SPACE_OWNERSHIP_MISMATCH'],
    [() => { slot.reservedByEntitlementId = 'other'; }, 'MEMBERSHIP_SPACE_OWNERSHIP_MISMATCH'],
  ]) {
    reset(); change();
    await assert.rejects(validateMembershipSpace(args), (error) => error.code === expected && error.statusCode === 409);
  }
  reset();
  assert.equal((await validateMembershipSpace(args)).slot, slot);
});
