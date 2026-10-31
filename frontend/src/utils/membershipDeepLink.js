export function membershipTarget(params) {
  const fields = ['entitlementId', 'subscriptionId'].filter((key) => params.has(key));
  if (!fields.length) return null;
  if (fields.length !== 1 || params.getAll(fields[0]).length !== 1) return { invalid: true };
  const id = params.get(fields[0]);
  if (!/^[a-f\d]{24}$/i.test(id)) return { invalid: true };
  return { id: id.toLowerCase(), kind: fields[0] === 'entitlementId' ? 'entitlement' : 'subscription' };
}

export function targetCardIndex(cards, target) {
  if (!target || target.invalid) return -1;
  return cards.findIndex((card) => String(target.kind === 'entitlement' ? card.entitlementId : card.sourceSubscriptionId).toLowerCase() === target.id);
}

export function highlightMembershipCard(element) {
  element.querySelector?.('button')?.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'center', behavior: 'auto' });
  element.classList.add('membership-target-highlight');
  const timer = setTimeout(() => element.classList.remove('membership-target-highlight'), 4000);
  return () => { clearTimeout(timer); element.classList.remove('membership-target-highlight'); };
}

// A close queues a target; the next route commit reveals its existing card.
// Route/data updates do not own the timer, so query cleanup cannot shorten it.
export function createMembershipHighlightController() {
  let pending = null;
  let navigation = null;
  let cleanup = null;
  const cancel = () => { cleanup?.(); cleanup = null; };
  return {
    close(target) {
      cancel();
      pending = target && !target.invalid ? { target, origin: navigation, navigation: null } : null;
    },
    update({ target, navigationKey, cards, loading, getCard }) {
      const changed = navigation !== navigationKey;
      navigation = navigationKey;
      if (target) {
        // A clock/data render may land before the close navigation commits.
        if (pending && pending.origin === navigationKey && pending.target.id === target.id && pending.target.kind === target.kind) return;
        pending = null; cancel(); return;
      }
      if (pending) {
        if (pending.navigation === null) pending.navigation = navigationKey;
        else if (pending.navigation !== navigationKey) { pending = null; cancel(); return; }
        if (loading) return;
        const element = getCard(targetCardIndex(cards, pending.target));
        pending = null;
        cancel();
        if (element) cleanup = highlightMembershipCard(element);
      } else if (changed) cancel();
    },
    dispose() { pending = null; cancel(); },
  };
}
