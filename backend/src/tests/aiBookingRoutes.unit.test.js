const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('AI booking interpretation and session routes are customer-only', () => {
  const registrations = [];
  const router = Object.fromEntries(['post', 'get', 'put', 'delete'].map((method) => [
    method,
    (path, ...handlers) => registrations.push({ method, path, handlers }),
  ]));
  const protect = () => {};
  const authorizeCalls = [];
  const authorize = (...roles) => {
    const middleware = () => {};
    authorizeCalls.push({ roles, middleware });
    return middleware;
  };
  const controller = {
    interpret: () => {}, getLatestSession: () => {}, getSession: () => {}, createSession: () => {},
    appendMessages: () => {}, updateSession: () => {}, completeSession: () => {}, discardSession: () => {},
  };
  const originalLoad = Module._load;
  const routePath = require.resolve('../routes/aiRoutes');
  Module._load = function loadStub(request, parent, isMain) {
    if (request === 'express') return { Router: () => router };
    if (request === '../controllers/aiController') return {};
    if (request === '../controllers/aiBookingController') return controller;
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
  assert.deepEqual(route.handlers, [protect, authorizeCalls[0].middleware, controller.interpret]);
  assert.deepEqual(registrations.map(({ method, path }) => `${method.toUpperCase()} ${path}`).filter((item) => item.includes('/booking/')), [
    'POST /booking/interpret',
    'GET /booking/sessions/latest',
    'GET /booking/sessions/:sessionId',
    'POST /booking/sessions',
    'POST /booking/sessions/:sessionId/messages',
    'PUT /booking/sessions/:sessionId',
    'POST /booking/sessions/:sessionId/complete',
    'DELETE /booking/sessions/:sessionId',
  ]);
  assert.equal(authorizeCalls.length, 8);
  for (const registration of registrations.filter((item) => item.path.startsWith('/booking/'))) {
    assert.equal(registration.handlers[0], protect);
    assert.deepEqual(authorizeCalls.shift().roles, ['customer']);
  }
});
