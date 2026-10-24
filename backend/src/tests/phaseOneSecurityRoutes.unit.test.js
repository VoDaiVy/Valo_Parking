const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const loadRoute = (routePath, controllers = {}) => {
  const registrations = [];
  const router = {
    get: (path, ...handlers) => registrations.push({ method: 'get', path, handlers }),
    post: (path, ...handlers) => registrations.push({ method: 'post', path, handlers }),
    put: (path, ...handlers) => registrations.push({ method: 'put', path, handlers }),
    delete: (path, ...handlers) => registrations.push({ method: 'delete', path, handlers }),
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
  const originalLoad = Module._load;
  const resolvedPath = require.resolve(routePath);

  Module._load = function loadStubbedModule(request, parent, isMain) {
    if (request === 'express') return { Router: () => router };
    if (request.includes('/controllers/')) return new Proxy(controllers, {
      get: (target, property) => target[property] || (() => {}),
    });
    if (request === '../middlewares/authMiddleware') {
      return { protect, authorize, softProtect };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[resolvedPath];
    require(routePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[resolvedPath];
  }

  return { registrations, protect, authorize, softProtect, authorizations };
};

test('AI operational mutations require staff/admin and clearing requires admin', () => {
  const result = loadRoute('../routes/aiRoutes');
  const scanSlots = result.registrations.find(({ method, path }) => method === 'post' && path === '/scan-slots');
  const clearViolations = result.registrations.find(({ method, path }) => method === 'post' && path === '/clear-all-violations');
  const staffAuth = result.authorizations.find(({ roles }) => JSON.stringify(roles) === JSON.stringify(['staff', 'admin']));
  const adminAuth = result.authorizations.find(({ roles }) => JSON.stringify(roles) === JSON.stringify(['admin']));

  assert.ok(staffAuth);
  assert.ok(adminAuth);
  assert.equal(scanSlots.handlers[0], result.protect);
  assert.equal(scanSlots.handlers[1], staffAuth.middleware);
  assert.equal(clearViolations.handlers[0], result.protect);
  assert.equal(clearViolations.handlers[1], adminAuth.middleware);
});

test('IoT commands require staff/admin while barrier status remains readable', () => {
  const result = loadRoute('../routes/iotRoutes');
  const status = result.registrations.find(({ method, path }) => method === 'get' && path === '/barrier-status');
  const open = result.registrations.find(({ method, path }) => method === 'post' && path === '/open-barrier');
  const close = result.registrations.find(({ method, path }) => method === 'post' && path === '/close-barrier');
  const staffAuth = result.authorizations.find(({ roles }) => JSON.stringify(roles) === JSON.stringify(['staff', 'admin']));

  assert.equal(status.handlers[0], result.softProtect);
  assert.equal(open.handlers[0], result.protect);
  assert.equal(open.handlers[1], staffAuth.middleware);
  assert.equal(close.handlers[0], result.protect);
  assert.ok(result.authorizations.some(({ middleware, roles }) =>
    middleware === close.handlers[1] && JSON.stringify(roles) === JSON.stringify(['staff', 'admin'])
  ));
});

test('UserDetail normalizes Vietnamese phone numbers at the data boundary', () => {
  const UserDetail = require('../models/UserDetail');
  const detail = new UserDetail({ phone: '+84 905 414 132' });
  assert.equal(detail.phone, '0905414132');
});
