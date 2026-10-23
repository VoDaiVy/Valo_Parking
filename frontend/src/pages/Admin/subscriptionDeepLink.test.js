import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubscriptionLookup, highlightSubscriptionCard, includeLinkedSubscription } from './subscriptionDeepLink.js';
const id = '507f1f77bcf86cd799439011';
const otherId = '507f1f77bcf86cd799439012';
const owner = { _id: 'original', username: 'Same user', email: 'same@example.com' };
const subscription = { _id: id, user: owner, originalUser: owner, currentOwners: [{ _id: 'new-owner', username: 'New owner' }], ticketPackage: { name: 'VIP package' } };
const success = (data) => ({ ok: true, status: 200, data: { success: true, data } });
const deferred = () => { let finish; const promise = new Promise((resolve) => { finish = resolve; }); return { promise, finish }; };

test('fresh lookup finds exact subscription among multiple subscriptions of the same user, independent of filters', async () => {
  let state;
  const request = deferred();
  const lookup = createSubscriptionLookup(() => request.promise, (next) => { state = next; });
  const pending = lookup.load(id);
  assert.equal(state.status, 'loading');
  assert.equal(state.subscription, undefined);
  request.finish(success([{ ...subscription, _id: otherId }, subscription]));
  await pending;
  assert.equal(state.subscription, subscription);
  assert.equal(state.subscription.originalUser, owner);
  assert.equal(state.subscription.currentOwners[0]._id, 'new-owner');
});

test('refresh with ID rechecks the backend and a deleted record never reuses the previous snapshot', async () => {
  let response = success([subscription]); let state;
  const lookup = createSubscriptionLookup(async () => response, (next) => { state = next; });
  await lookup.load(id);
  assert.equal(state.status, 'ready');
  response = success([]);
  const pending = lookup.load(id);
  assert.equal(state.subscription, undefined);
  await pending;
  assert.equal(state.status, 'missing');
});

test('API, network and malformed responses remain separate from not found', async () => {
  for (const [request, expected] of [
    [async () => ({ ok: false, status: 500 }), 'error'],
    [async () => ({ ok: false, status: 403 }), 'unavailable'],
    [async () => ({ ok: true, data: { success: true } }), 'error'],
    [async () => { throw new Error('offline'); }, 'error'],
  ]) {
    let state;
    await createSubscriptionLookup(request, (next) => { state = next; }).load(id);
    assert.equal(state.status, expected);
    assert.equal(state.subscription, undefined);
  }
});

test('only latest ID response is applied, even if an older request finishes later', async () => {
  const old = deferred(); let state;
  const queue = [old.promise, Promise.resolve(success([{ ...subscription, _id: otherId }]))];
  const lookup = createSubscriptionLookup(() => queue.shift(), (next) => { state = next; });
  const pending = lookup.load(id);
  await lookup.load(otherId);
  old.finish(success([subscription])); await pending;
  assert.equal(state.subscription._id, otherId);
});

test('unmount/query change cancels pending publication; invalid IDs are not sent to the API', async () => {
  const request = deferred(); const states = [];
  const lookup = createSubscriptionLookup(() => request.promise, (next) => states.push(next));
  const pending = lookup.load(id); lookup.cancel(); request.finish(success([subscription])); await pending;
  assert.equal(states.length, 1);
  let state;
  await createSubscriptionLookup(() => assert.fail('invalid ID request'), (next) => { state = next; }).load('invalid');
  assert.equal(state.status, 'missing');
});

test('target bypasses search and filters by exact ID without adding a duplicate card', () => {
  const other = { ...subscription, _id: otherId };
  const all = [other, subscription];
  assert.deepEqual(includeLinkedSubscription([], all, id), [subscription]);
  assert.deepEqual(includeLinkedSubscription([other], all, id), all);
  assert.deepEqual(includeLinkedSubscription(all, all, id), all);
  assert.deepEqual(includeLinkedSubscription([], all, otherId), [other]);
  const filtered = [other];
  assert.equal(includeLinkedSubscription(filtered, all, null), filtered);
});

const highlightHarness = () => {
  const frames = new Map(); const timers = new Map(); let counter = 0;
  return {
    frames, timers,
    options: {
      frame(fn) { const key = ++counter; frames.set(key, fn); return key; },
      cancelFrame(key) { frames.delete(key); },
      timer(fn, duration) { const key = ++counter; timers.set(key, { fn, duration }); return key; },
      cancelTimer(key) { timers.delete(key); },
    },
    runFrame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((fn) => fn()); },
  };
};
const cardFixture = () => {
  const classes = new Set(); const scrolls = [];
  return { classes, scrolls, classList: { add: (...values) => values.forEach((value) => classes.add(value)), remove: (...values) => values.forEach((value) => classes.delete(value)) }, scrollIntoView: (options) => scrolls.push(options) };
};

test('verified list card scrolls to center and gets gold border/glow for exactly four seconds', () => {
  const card = cardFixture(); const harness = highlightHarness();
  const cleanup = highlightSubscriptionCard(card, harness.options);
  assert.equal(card.scrolls.length, 0);
  harness.runFrame();
  assert.deepEqual(card.scrolls, [{ block: 'center', behavior: 'smooth' }]);
  assert.ok(card.classes.has('!border-yellow-400'));
  assert.equal(card.classes.size, 2);
  const timeout = [...harness.timers.values()][0];
  assert.equal(timeout.duration, 4000);
  timeout.fn();
  assert.equal(card.classes.size, 0);
  cleanup();
});

test('query change cancels old scroll/timer and only the new card remains highlighted', () => {
  const oldCard = cardFixture(); const nextCard = cardFixture(); const harness = highlightHarness();
  const cancelPending = highlightSubscriptionCard(oldCard, harness.options);
  cancelPending(); harness.runFrame();
  assert.equal(oldCard.scrolls.length, 0);
  const cancelOld = highlightSubscriptionCard(oldCard, harness.options);
  harness.runFrame(); assert.equal(oldCard.classes.size, 2);
  cancelOld();
  const cancelNext = highlightSubscriptionCard(nextCard, { ...harness.options, reducedMotion: true });
  harness.runFrame();
  assert.equal(oldCard.classes.size, 0);
  assert.equal(nextCard.classes.size, 2);
  assert.equal(nextCard.scrolls[0].behavior, 'auto');
  assert.equal(harness.timers.size, 1);
  cancelNext(); assert.equal(harness.timers.size, 0);
});
