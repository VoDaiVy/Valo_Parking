import { useEffect } from 'react';
import { highlightSubscriptionCard } from './subscriptionDeepLink.js';

// This controller never renders a subscription; it locates the existing list card.
export default function SubscriptionDeepLink({ state, loading, cardRef }) {
  useEffect(() => {
    if (loading || state.status !== 'ready') return;
    return highlightSubscriptionCard(cardRef.current, {
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
  }, [state, loading, cardRef]);
  if (state.status === 'ready') return null;
  return <p role={state.status === 'loading' ? 'status' : 'alert'} className="mb-4 text-sm text-slate-400">
    {state.status === 'loading' ? 'Locating subscription...' : state.status === 'missing' ? 'Subscription not found. It may have been removed or is no longer available.' : state.status === 'unavailable' ? 'Subscription unavailable. Check your sign-in and access permissions.' : 'Unable to load the linked subscription. Please retry loading the list.'}
  </p>;
}
