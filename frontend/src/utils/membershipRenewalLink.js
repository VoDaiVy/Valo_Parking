// Query parameters only select an already-owned membership; quote/payment APIs still authorize it.
export function membershipRenewalTarget(params, membership) {
  if (membership?.status !== 'active') return null;
  const entitlementId = params.get('renewEntitlementId');
  const subscriptionId = params.get('renewSubscriptionId');
  if (Boolean(entitlementId) === Boolean(subscriptionId)) return null;
  const id = entitlementId || subscriptionId;
  if (!/^[a-f\d]{24}$/i.test(id)) return null;
  if (entitlementId) {
    const owned = membership.reservedSlots?.find(slot => String(slot.entitlementId) === id && slot.status === 'active');
    return owned ? { kind: 'entitlement', id } : null;
  }
  return String(membership.subscriptionId) === id && !membership.reservedSlots?.some(slot => slot.entitlementId)
    ? { kind: 'subscription', id } : null;
}
