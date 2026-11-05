import test from 'node:test';
import assert from 'node:assert/strict';
import { membershipTarget, targetCardIndex, highlightMembershipCard, createMembershipHighlightController } from './membershipDeepLink.js';
const id = '507f1f77bcf86cd799439011';
const other = '507f1f77bcf86cd799439012';

test('targets reject malformed, duplicate and ambiguous IDs; preserve URL input', () => {
  for (const query of ['entitlementId=bad', 'entitlementId=', `entitlementId=${id}&subscriptionId=${other}`, `entitlementId=${id}&entitlementId=${other}`]) assert.deepEqual(membershipTarget(new URLSearchParams(query)), { invalid: true });
  const params = new URLSearchParams(`subscriptionId=${id.toUpperCase()}&tab=marketplace&keep=yes`);
  assert.deepEqual(membershipTarget(params), { id, kind: 'subscription' });
  assert.equal(params.get('keep'), 'yes');
  assert.equal(membershipTarget(new URLSearchParams('tab=marketplace')), null);
});

test('async active-list matching selects existing card only; absent records remain detail-only', () => {
  const target = { id, kind: 'entitlement' };
  assert.equal(targetCardIndex([], target), -1);
  const cards = [{ entitlementId: other, sourceSubscriptionId: id }, { entitlementId: id, sourceSubscriptionId: other }];
  assert.equal(targetCardIndex(cards, target), 1);
  assert.equal(targetCardIndex(cards, { id, kind: 'subscription' }), 0);
  assert.equal(targetCardIndex(cards, { invalid: true }), -1);
  assert.equal(cards.length, 2);
});

test('highlight scrolls existing element, expires at four seconds and cancels cleanly', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const classes = new Set(); let scrolls = 0;
  const element = { scrollIntoView(options) { assert.equal(options.block, 'center'); scrolls++; }, classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } };
  const cleanup = highlightMembershipCard(element);
  assert.equal(scrolls, 1); assert.ok(classes.has('membership-target-highlight'));
  t.mock.timers.tick(3999); assert.equal(classes.size, 1);
  t.mock.timers.tick(1); assert.equal(classes.size, 0);
  cleanup(); const cancel = highlightMembershipCard(element); cancel();
  assert.equal(classes.size, 0); t.mock.timers.tick(4000); assert.equal(classes.size, 0);
});

test('modal close starts a fresh four-second highlight, preserved across query cleanup and data renders', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = createMembershipHighlightController();
  const classes = new Set(); let scrolls = 0;
  const element = { scrollIntoView() { scrolls++; }, classList: { add: (s) => classes.add(s), remove: (s) => classes.delete(s) } };
  const target = { id, kind: 'entitlement' };
  const update = (override = {}) => controller.update({ target: null, navigationKey: 'closed', cards: [{ entitlementId: id }], loading: false, getCard: (index) => index === 0 ? element : null, ...override });
  update({ target, navigationKey: 'open' }); t.mock.timers.tick(8000);
  assert.equal(scrolls, 0); assert.equal(classes.size, 0);
  controller.close(target); assert.equal(scrolls, 0);
  update({ target, navigationKey: 'open' }); assert.equal(scrolls, 0);
  update(); assert.equal(scrolls, 1); assert.equal(classes.size, 1);
  t.mock.timers.tick(2000); update(); assert.equal(scrolls, 1); assert.equal(classes.size, 1);
  t.mock.timers.tick(1999); assert.equal(classes.size, 1);
  t.mock.timers.tick(1); assert.equal(classes.size, 0);
  controller.dispose();
});

test('highlight handles delayed cards, missing targets, navigation changes, repeats and unmount', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = createMembershipHighlightController();
  const classes = new Set(); let scrolls = 0;
  const element = { scrollIntoView() { scrolls++; }, classList: { add: (s) => classes.add(s), remove: (s) => classes.delete(s) } };
  const target = { id, kind: 'subscription' };
  const update = (override = {}) => controller.update({ target: null, navigationKey: 'closed', cards: [{ sourceSubscriptionId: id }], loading: false, getCard: (index) => index === 0 ? element : null, ...override });
  controller.close(target); update({ loading: true, cards: [] }); assert.equal(scrolls, 0);
  update(); assert.equal(scrolls, 1);
  update({ navigationKey: 'unrelated' }); assert.equal(classes.size, 0);
  update({ target, navigationKey: 'repeat-open' }); assert.equal(scrolls, 1);
  controller.close(target); update({ navigationKey: 'repeat-close' }); assert.equal(scrolls, 2);
  update({ target: { id: other, kind: 'entitlement' }, navigationKey: 'new-target' }); assert.equal(classes.size, 0);
  controller.close({ id: other, kind: 'entitlement' }); update({ cards: [] }); assert.equal(scrolls, 2);
  controller.close(target); update(); assert.equal(classes.size, 1);
  controller.dispose(); assert.equal(classes.size, 0); t.mock.timers.tick(4000); assert.equal(classes.size, 0);
});
