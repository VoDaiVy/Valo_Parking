const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

test('available slots permits staff while customer booking routes stay customer/admin-only', () => {
  const registrations = [];
  const router = {
    delete: (path, ...handlers) => registrations.push({ method: 'delete', path, handlers }),
    get: (path, ...handlers) => registrations.push({ method: 'get', path, handlers }),
    post: (path, ...handlers) => registrations.push({ method: 'post', path, handlers }),
    put: (path, ...handlers) => registrations.push({ method: 'put', path, handlers }),
    use: (...handlers) => registrations.push({ method: 'use', handlers }),
  };
  const protect = () => {};
  const authorizations = [];
  const authorize = (...roles) => {
    const middleware = () => {};
    authorizations.push({ roles, middleware });
    return middleware;
  };
  const softProtect = () => {};
  const controllers = new Proxy({}, {
    get: (target, property) => {
      if (!target[property]) target[property] = () => {};
      return target[property];
    },
  });
  const requirePolicyAcceptance = () => () => {};
  const originalLoad = Module._load;
  const routePath = require.resolve('../routes/bookingRoutes');

  Module._load = function loadStubbedModule(request, parent, isMain) {
    if (request === 'express') return { Router: () => router };
    if (request === '../controllers/bookingController') return controllers;
    if (request === '../middlewares/authMiddleware') {
      return { protect, authorize, softProtect };
    }
    if (request === '../middlewares/policyAcceptanceMiddleware') {
      return { requirePolicyAcceptance };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[routePath];
    require('../routes/bookingRoutes');
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];
  }

  const staffAuthorization = authorizations.find(({ roles }) =>
    JSON.stringify(roles) === JSON.stringify(['customer', 'staff', 'admin'])
  );
  const customerAuthorization = authorizations.find(({ roles }) =>
    JSON.stringify(roles) === JSON.stringify(['customer', 'admin'])
  );
  const availableSlotsIndex = registrations.findIndex(
    ({ method, path }) => method === 'get' && path === '/available-slots'
  );
  const availableSlots = registrations[availableSlotsIndex];
  const customerAuthorizationIndex = registrations.findIndex(
    ({ method, handlers }) => method === 'use' && handlers[0] === customerAuthorization?.middleware
  );
  const myBookingsIndex = registrations.findIndex(
    ({ method, path }) => method === 'get' && path === '/my'
  );

  assert.ok(staffAuthorization, 'customer/staff/admin authorization should be registered');
  assert.ok(customerAuthorization, 'customer/admin authorization should remain registered');
  assert.deepEqual(availableSlots.handlers, [
    protect,
    staffAuthorization.middleware,
    controllers.getAvailableSlots,
  ]);
  assert.ok(
    availableSlotsIndex < customerAuthorizationIndex,
    'available slots must be registered before customer-only middleware'
  );
  assert.ok(
    myBookingsIndex > customerAuthorizationIndex,
    'customer booking routes must remain behind customer/admin middleware'
  );
});
