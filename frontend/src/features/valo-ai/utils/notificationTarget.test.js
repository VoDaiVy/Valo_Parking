import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationTarget } from './notificationTarget.js';

test('VALO AI navigates only to known Admin notification targets', () => {
  assert.equal(notificationTarget('/admin/parking-lots'), '/admin/parking-lots');
  assert.equal(notificationTarget('/admin/bookings'), '/admin/bookings');
  assert.equal(notificationTarget('/admin/revenue'), '/admin/revenue');
  assert.equal(notificationTarget('/admin/vehicle-models?vehicleId=507f1f77bcf86cd799439011'), '/admin/vehicle-models?vehicleId=507f1f77bcf86cd799439011');
  assert.equal(notificationTarget(undefined), null);
  assert.equal(notificationTarget('/staff/bookings'), null);
  assert.equal(notificationTarget('https://example.com'), null);
});
