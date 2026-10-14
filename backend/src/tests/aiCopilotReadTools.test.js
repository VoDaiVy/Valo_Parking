const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const User = require('../models/User');
const Vehicle = require('../models/Vehicle');
const readTools = require('../services/aiCopilot/readTools');

test('AI Copilot Read Tools - Pagination and Semantics', async (t) => {
  t.afterEach(() => {
    test.mock.restoreAll();
  });

  await t.test('search_users with staff role limits to 10 but returns total 18', async () => {
    // Mock User.find to return a chainable object
    const items = Array.from({ length: 10 }, (_, i) => ({ _id: `id${i}`, username: `customer${i}`, role: 'customer' }));
    
    test.mock.method(User, 'find', (filter) => {
      assert.strictEqual(filter.role, 'customer', 'Should force role: customer for staff');
      return {
        sort: () => ({
          limit: (limitNum) => ({
            select: () => ({
              lean: async () => items.slice(0, limitNum)
            })
          })
        })
      };
    });
    test.mock.method(User, 'countDocuments', async (filter) => {
      assert.strictEqual(filter.role, 'customer', 'Count should use the same filter');
      return 18;
    });

    const result = await readTools.searchUsers({}, 'staff');
    assert.strictEqual(result.items.length, 10);
    assert.strictEqual(result.total, 18);
    assert.strictEqual(result.returned, 10);
    assert.strictEqual(result.limit, 10);
  });

  await t.test('searchUsers with staff role and role: "admin" override STILL isolates customers', async () => {
    test.mock.method(User, 'find', (filter) => {
      assert.strictEqual(filter.role, 'customer', 'Should ignore admin role request and force customer');
      return {
        sort: () => ({
          limit: () => ({
            select: () => ({
              lean: async () => []
            })
          })
        })
      };
    });
    test.mock.method(User, 'countDocuments', async () => 18);

    const result = await readTools.searchUsers({ role: 'admin' }, 'staff');
    assert.strictEqual(result.total, 18);
  });

  await t.test('searchUsers with admin role can fetch admins', async () => {
    test.mock.method(User, 'find', (filter) => {
      assert.strictEqual(filter.role, 'admin', 'Admin can search for admins');
      return {
        sort: () => ({
          limit: () => ({
            select: () => ({
              lean: async () => [{ role: 'admin' }, { role: 'admin' }]
            })
          })
        })
      };
    });
    test.mock.method(User, 'countDocuments', async () => 2);

    const result = await readTools.searchUsers({ role: 'admin' }, 'admin');
    assert.strictEqual(result.total, 2);
  });

  await t.test('searchVehicles with staff role isolates customer vehicles', async () => {
    test.mock.method(User, 'distinct', async (field, filter) => {
      assert.strictEqual(field, '_id');
      assert.strictEqual(filter.role, 'customer');
      return ['customer_id_1', 'customer_id_2'];
    });
    
    test.mock.method(Vehicle, 'find', (filter) => {
      assert.ok(filter.owner.$in.includes('customer_id_1'), 'Should filter by customer ids');
      return {
        sort: () => ({
          limit: () => ({
            select: () => ({
              populate: () => ({
                lean: async () => [
                  { owner: { role: 'customer' } },
                  { owner: { role: 'customer' } }
                ]
              })
            })
          })
        })
      };
    });
    test.mock.method(Vehicle, 'countDocuments', async () => 2);

    const result = await readTools.searchVehicles({}, 'staff');
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.total, 2);
  });
  await t.test('searchBookings applies dateType overlap by default', async () => {
    const Booking = require('../models/Booking');
    let capturedFilter = {};
    test.mock.method(Booking, 'find', (filter) => {
      capturedFilter = filter;
      return { sort: () => ({ limit: () => ({ select: () => ({ populate: () => ({ populate: () => ({ populate: () => ({ lean: async () => [] }) }) }) }) }) }) };
    });
    test.mock.method(Booking, 'countDocuments', async () => 0);

    // Overlap: start is 2026-09-17 00:00:00 (local), end is 2026-09-17 23:59:59 (local)
    await readTools.searchBookings({ startDate: '2026-09-17', endDate: '2026-09-17' });
    assert.ok(capturedFilter.scheduledStart.$lte);
    assert.ok(capturedFilter.scheduledEnd.$gte);
    
    // Test that the filter handles interval overlap correctly
    assert.equal(capturedFilter.scheduledStart.$lte.toISOString(), '2026-09-17T16:59:59.999Z');
    assert.equal(capturedFilter.scheduledEnd.$gte.toISOString(), '2026-09-16T17:00:00.000Z');
  });

  await t.test('searchBookings applies dateType start and create correctly', async () => {
    const Booking = require('../models/Booking');
    let capturedFilter = {};
    test.mock.method(Booking, 'find', (filter) => {
      capturedFilter = filter;
      return { sort: () => ({ limit: () => ({ select: () => ({ populate: () => ({ populate: () => ({ populate: () => ({ lean: async () => [] }) }) }) }) }) }) };
    });
    test.mock.method(Booking, 'countDocuments', async () => 0);

    await readTools.searchBookings({ startDate: '2026-09-17', endDate: '2026-09-17', dateType: 'start' });
    assert.ok(capturedFilter.scheduledStart.$gte);
    assert.ok(capturedFilter.scheduledStart.$lte);
    assert.equal(capturedFilter.scheduledEnd, undefined);

    await readTools.searchBookings({ startDate: '2026-09-17', endDate: '2026-09-17', dateType: 'create' });
    assert.ok(capturedFilter.createdAt.$gte);
    assert.ok(capturedFilter.createdAt.$lte);
    assert.equal(capturedFilter.scheduledStart, undefined);
  });
});
