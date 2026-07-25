import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;

const { getActiveSessions, getAllSessions, getSessionResponseState } = await import('./sessionService.js');

let requests;

beforeEach(() => {
  requests = [];
  globalThis.localStorage = {
    getItem: (key) => (key === 'accessToken' ? 'staff-token' : null),
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [] }),
    };
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.localStorage = originalLocalStorage;
});

test('getAllSessions requests the authenticated sessions endpoint', async () => {
  const result = await getAllSessions();

  assert.deepEqual(result, { ok: true, status: 200, data: { success: true, data: [] } });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/sessions$/);
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer staff-token');
});

test('getActiveSessions requests the authenticated active-status endpoint', async () => {
  const result = await getActiveSessions();

  assert.deepEqual(result, { ok: true, status: 200, data: { success: true, data: [] } });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/sessions\/active-status$/);
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer staff-token');
});

test('getSessionResponseState invalidates session data after an unsuccessful response', () => {
  const result = getSessionResponseState({
    ok: false,
    status: 503,
    data: { success: false, message: 'Session feed is unavailable.' },
  });

  assert.deepEqual(result, {
    isAvailable: false,
    sessions: [],
    error: 'Session feed is unavailable.',
  });
});
