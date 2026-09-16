const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('AI booking interpretation is customer-only and has no booking mutation route', () => {
  const registrations = [];
  const router = { post: (path, ...handlers) => registrations.push({ method: 'post', path, handlers }), get: (path, ...handlers) => registrations.push({ method: 'get', path, handlers }) };
  const protect = () => {};
  const authorizeCalls = [];
  const authorize = (...roles) => {
    const middleware = () => {};
    authorizeCalls.push({ roles, middleware });
    return middleware;
  };
  const interpreter = () => {};
  const originalLoad = Module._load;
  const routePath = require.resolve('../routes/aiRoutes');
  Module._load = function loadStub(request, parent, isMain) {
    if (request === 'express') return { Router: () => router };
    if (request === '../controllers/aiController') return {};
    if (request === '../controllers/aiBookingController') return { interpret: interpreter };
    if (request === '../middlewares/authMiddleware') return { protect, authorize };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[routePath];
    require('../routes/aiRoutes');
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];
  }
  const route = registrations.find((item) => item.path === '/booking/interpret');
  assert.deepEqual(authorizeCalls[0].roles, ['customer']);
  assert.deepEqual(route.handlers, [protect, authorizeCalls[0].middleware, interpreter]);
  assert.equal(registrations.some((item) => item.path.includes('booking') && item.path !== '/booking/interpret'), false);
});
