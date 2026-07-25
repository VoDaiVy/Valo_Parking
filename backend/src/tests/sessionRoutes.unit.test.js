const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

test('GET / requires staff or admin authorization before listing sessions', () => {
  const registrations = [];
  const router = {
    get: (path, ...handlers) => registrations.push({ method: 'get', path, handlers }),
    post: (path, ...handlers) => registrations.push({ method: 'post', path, handlers }),
  };
  const protect = () => {};
  const authorizations = [];
  const authorize = (...roles) => {
    const middleware = () => {};
    authorizations.push({ roles, middleware });
    return middleware;
  };
  const getAllSessions = () => {};
  const originalLoad = Module._load;
  const routePath = require.resolve('../routes/sessionRoutes');

  Module._load = function loadStubbedModule(request, parent, isMain) {
    if (request === 'express') return { Router: () => router };
    if (request === '../controllers/sessionController') return { getAllSessions };
    if (request === '../middlewares/authMiddleware') return { protect, authorize };
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[routePath];
    require('../routes/sessionRoutes');
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];
  }

  const route = registrations.find(({ method, path }) => method === 'get' && path === '/');
  const staffAuthorization = authorizations.find(({ roles }) =>
    JSON.stringify(roles) === JSON.stringify(['staff', 'admin'])
  );

  assert.ok(staffAuthorization, 'staff/admin authorization should be registered');
  assert.deepEqual(route.handlers, [protect, staffAuthorization.middleware, getAllSessions]);
});
