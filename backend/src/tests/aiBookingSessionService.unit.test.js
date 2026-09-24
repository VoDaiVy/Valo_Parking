const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const loadService = (model) => {
  const originalLoad = Module._load;
  const servicePath = require.resolve('../services/aiBookingSessionService');
  Module._load = function loadStub(request, parent, isMain) {
    if (request === '../models/AiBookingSession') return model;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[servicePath];
    return require('../services/aiBookingSessionService');
  } finally {
    Module._load = originalLoad;
    delete require.cache[servicePath];
  }
};

test('AI booking progress resumes at the first missing booking field', () => {
  const service = loadService({});
  assert.deepEqual(service.deriveSessionProgress({ bookingDraft: {} }), {
    currentStep: 'COLLECT_DATE', completionPercent: 10,
  });
  assert.deepEqual(service.deriveSessionProgress({ bookingDraft: { startDate: '2026-09-25' } }), {
    currentStep: 'COLLECT_TIME', completionPercent: 30,
  });
  assert.deepEqual(service.deriveSessionProgress({
    bookingDraft: { startDate: '2026-09-25', startTime: '08:00', endTime: '09:00', requestedVehicleCount: 2, licensePlates: ['43A12345'] },
  }), { currentStep: 'SELECT_VEHICLE', completionPercent: 50 });
  assert.deepEqual(service.deriveSessionProgress({
    bookingDraft: { startDate: '2026-09-25', startTime: '08:00', endTime: '09:00', licensePlate: '43A12345' },
    phase: 'WAITING_CONFIRMATION',
  }), { currentStep: 'CONFIRM_BOOKING', completionPercent: 90 });
});

test('snapshot keeps only recent valid messages and derives its summary', () => {
  const service = loadService({});
  const messages = Array.from({ length: 105 }, (_, index) => ({ role: index % 2 ? 'user' : 'assistant', text: `Tin ${index}` }));
  const snapshot = service.normalizeSnapshot({
    bookingDraft: { startDate: '2026-09-25', startTime: '08:00', endTime: '10:00', licensePlate: '43A-12345' },
    phase: 'WAITING_CONFIRMATION', messages,
  });
  assert.equal(snapshot.messages.length, 100);
  assert.equal(snapshot.messages[0].content, 'Tin 5');
  assert.equal(snapshot.currentStep, 'CONFIRM_BOOKING');
  assert.deepEqual(snapshot.summary.vehicles, ['43A12345']);
  assert.equal(snapshot.summary.time, '08:00 - 10:00');
});

test('session lookup always scopes the id to the authenticated owner', async () => {
  const queries = [];
  const model = {
    updateMany: async () => {},
    findOne: (query) => { queries.push(query); return Promise.resolve({ _id: query._id, userId: query.userId }); },
  };
  const service = loadService(model);
  await service.getSession('owner-a', 'session-1');
  assert.deepEqual(queries[0], { _id: 'session-1', userId: 'owner-a' });
});

test('latest completed or cancelled session does not resurrect an older draft card', async () => {
  const model = {
    updateMany: async () => {},
    findOne: () => ({ sort: async () => ({ status: 'COMPLETED' }) }),
  };
  const service = loadService(model);
  assert.equal(await service.getLatestSession('owner-a'), null);
});

test('stale active sessions are marked expired without deleting their messages', async () => {
  let update;
  const model = {
    updateMany: async (query, operation) => { update = { query, operation }; },
  };
  const service = loadService(model);
  const now = new Date('2026-09-24T08:30:00.000Z');
  await service.expireStaleSessions('owner-a', now);
  assert.deepEqual(update.query, {
    userId: 'owner-a', status: { $in: ['DRAFT', 'ACTIVE'] }, expiresAt: { $lte: now },
  });
  assert.deepEqual(update.operation, { $set: { status: 'EXPIRED' } });
});
