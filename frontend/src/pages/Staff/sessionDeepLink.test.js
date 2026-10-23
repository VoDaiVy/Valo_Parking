import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionVerification, resolveSessionDeepLink, verifiedSessionForQuery } from './sessionDeepLink.js';

const sessionId = '507f1f77bcf86cd799439011';
const session = { _id: sessionId, licensePlate: '11A12345', parkingSlot: 'F10' };
const resolve = (overrides = {}) => resolveSessionDeepLink({ sessionId, sessions: [session], loading: false, error: '', ...overrides });

test('selects the exact session ID even when plate and slot repeat', () => {
  const other = { ...session, _id: '507f1f77bcf86cd799439012' };
  assert.equal(resolve({ sessions: [other, session] }).session, session);
  assert.equal(resolve({ sessionId: sessionId.toUpperCase() }).session, session);
});

test('successful response without the linked record exposes not-found fallback, including empty lists', () => {
  assert.deepEqual(resolve({ sessions: [] }), { session: null, missing: true });
  assert.equal(resolve({ sessionId: '507f1f77bcf86cd799439012' }).missing, true);
});

test('API errors and loading never report Session not found or select stale records', () => {
  assert.deepEqual(resolve({ error: 'Failed to load sessions' }), { session: null, missing: false });
  assert.deepEqual(resolve({ sessions: [], error: 'Server unavailable' }), { session: null, missing: false });
  assert.deepEqual(resolve({ loading: true }), { session: null, missing: false });
});

test('ordinary page visits do not show the deep-link fallback', () => {
  assert.deepEqual(resolve({ sessionId: null }), { session: null, missing: false });
});

const success = (sessions) => ({ ok: true, status: 200, data: { success: true, data: sessions } });
const deferred = () => {
  let finish;
  const promise = new Promise((resolve) => { finish = resolve; });
  return { promise, finish };
};

test('Admin verifies with the backend before opening, including a fresh page with sessionId', async () => {
  const request = deferred();
  let state = { status: 'idle' };
  const verifier = createSessionVerification(() => request.promise, (next) => { state = next; });
  const pending = verifier.verify('admin', sessionId, 'page-load');
  assert.equal(state.status, 'loading');
  assert.equal(verifiedSessionForQuery(state, sessionId, 'page-load'), null);
  request.finish(success([session]));
  await pending;
  assert.equal(verifiedSessionForQuery(state, sessionId, 'page-load'), session);
});

test('deleted session removes the previously verified modal instead of using a snapshot', async () => {
  let response = success([session]);
  let state;
  const verifier = createSessionVerification(async () => response, (next) => { state = next; });
  await verifier.verify('admin', sessionId, 'first');
  assert.equal(state.status, 'verified');
  response = success([]);
  const pending = verifier.verify('admin', sessionId, 'second');
  assert.equal(verifiedSessionForQuery(state, sessionId, 'second'), null);
  await pending;
  assert.equal(state.status, 'missing');
  assert.equal(verifiedSessionForQuery(state, sessionId, 'second'), null);
});

test('failed refresh clears verified data and reports error, never missing', async () => {
  let response = success([session]);
  let state;
  const verifier = createSessionVerification(async () => response, (next) => { state = next; });
  await verifier.verify('admin', sessionId, 'first');
  response = { ok: false, status: 503 };
  await verifier.verify('admin', sessionId, 'refresh');
  assert.equal(state.status, 'error');
  assert.equal(verifiedSessionForQuery(state, sessionId, 'refresh'), null);
});

test('network errors, malformed success and forbidden access are not mistaken for deleted sessions', async () => {
  for (const [request, expected] of [
    [async () => { throw new Error('offline'); }, 'error'],
    [async () => ({ ok: true, data: { success: true } }), 'error'],
    [async () => ({ ok: false, status: 403 }), 'unavailable'],
    [async () => ({ ok: false, status: 401 }), 'unavailable'],
    [async () => ({ ok: false, status: 404 }), 'error'],
  ]) {
    let state;
    await createSessionVerification(request, (next) => { state = next; }).verify('admin', sessionId);
    assert.equal(state.status, expected);
    assert.equal(state.session, null);
  }
});

test('only the latest request applies when IDs change while the older response finishes first', async () => {
  const first = deferred();
  const second = deferred();
  const other = { ...session, _id: '507f1f77bcf86cd799439012' };
  const queue = [first.promise, second.promise];
  let state;
  const verifier = createSessionVerification(() => queue.shift(), (next) => { state = next; });
  const a = verifier.verify('admin', sessionId, 'a');
  const b = verifier.verify('admin', other._id, 'b');
  first.finish(success([session]));
  await a;
  assert.equal(state.status, 'loading');
  assert.equal(state.sessionId, other._id);
  second.finish(success([other]));
  await b;
  assert.equal(verifiedSessionForQuery(state, other._id, 'b'), other);
  assert.equal(verifiedSessionForQuery(state, sessionId, 'a'), null);
});

test('a late successful response cannot reopen the previous session after the newer one is verified', async () => {
  const old = deferred();
  const other = { ...session, _id: '507f1f77bcf86cd799439012' };
  const queue = [old.promise, Promise.resolve(success([other]))];
  let state;
  const verifier = createSessionVerification(() => queue.shift(), (next) => { state = next; });
  const pending = verifier.verify('admin', sessionId, 'old');
  await verifier.verify('admin', other._id, 'new');
  old.finish(success([session]));
  await pending;
  assert.equal(verifiedSessionForQuery(state, other._id, 'new'), other);
});

test('late errors cannot overwrite a newer verified session', async () => {
  const old = deferred();
  const queue = [old.promise, Promise.resolve(success([session]))];
  let state;
  const verifier = createSessionVerification(() => queue.shift(), (next) => { state = next; });
  const pending = verifier.verify('admin', sessionId, 'old');
  await verifier.verify('admin', sessionId, 'new');
  old.finish({ ok: false, status: 503 });
  await pending;
  assert.equal(verifiedSessionForQuery(state, sessionId, 'new'), session);
});

test('navigation key hides an old modal immediately even for the same sessionId', () => {
  const state = { sessionId, requestKey: 'old', status: 'verified', session };
  assert.equal(verifiedSessionForQuery(state, sessionId, 'new'), null);
});

test('cancellation prevents results after query removal or unmount', async () => {
  const request = deferred();
  const states = [];
  const verifier = createSessionVerification(() => request.promise, (next) => states.push(next));
  const pending = verifier.verify('admin', sessionId);
  verifier.cancel();
  request.finish(success([session]));
  await pending;
  assert.deepEqual(states.map((state) => state.status), ['loading']);
});

test('Staff and visits without sessionId never request Admin verification or change modal state', async () => {
  const verifier = createSessionVerification(() => assert.fail('unexpected request'), () => assert.fail('unexpected state change'));
  await verifier.verify('staff', sessionId);
  await verifier.verify('admin', null);
});
