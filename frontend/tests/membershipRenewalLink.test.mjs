import test from 'node:test';
import assert from 'node:assert/strict';
import { membershipRenewalTarget } from '../src/utils/membershipRenewalLink.js';

const subscriptionId = 'a'.repeat(24), entitlementId = 'b'.repeat(24);
const membership = { status: 'active', subscriptionId, reservedSlots: [{ entitlementId, status: 'active' }] };
test('Telegram link selects only an active owned entitlement', () => {
  assert.deepEqual(membershipRenewalTarget(new URLSearchParams({ renewEntitlementId: entitlementId }), membership), { kind: 'entitlement', id: entitlementId });
  for (const id of ['c'.repeat(24), 'not-an-id']) {
    assert.equal(membershipRenewalTarget(new URLSearchParams({ renewEntitlementId: id }), membership), null);
  }
  assert.equal(membershipRenewalTarget(new URLSearchParams({ renewEntitlementId: entitlementId }), { ...membership, status: 'expired' }), null);
  assert.equal(membershipRenewalTarget(new URLSearchParams({ renewEntitlementId: entitlementId }), { ...membership, reservedSlots: [{ entitlementId, status: 'transfer_locked' }] }), null);
});
test('legacy renewal links match subscription owner and never route entitlement subscriptions to legacy renewal', () => {
  const params = new URLSearchParams({ renewSubscriptionId: subscriptionId });
  assert.deepEqual(membershipRenewalTarget(params, { ...membership, reservedSlots: [] }), { kind: 'subscription', id: subscriptionId });
  assert.equal(membershipRenewalTarget(params, membership), null);
  assert.equal(membershipRenewalTarget(params, { ...membership, subscriptionId: 'c'.repeat(24), reservedSlots: [] }), null);
  params.set('renewEntitlementId', entitlementId);
  assert.equal(membershipRenewalTarget(params, membership), null);
  assert.equal(membershipRenewalTarget(new URLSearchParams(), membership), null);
});
