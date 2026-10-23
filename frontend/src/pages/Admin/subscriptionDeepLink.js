export const createSubscriptionLookup = (request, publish) => {
  let generation = 0;
  return {
    cancel() { generation += 1; },
    async load(id) {
      const current = ++generation;
      publish({ status: 'loading' });
      let result;
      try {
        if (!/^[a-f\d]{24}$/i.test(id || '')) {
          result = { status: 'missing' };
        } else {
          const response = await request();
          if ([401, 403].includes(response.status)) result = { status: 'unavailable' };
          else if (!response.ok || !response.data?.success || !Array.isArray(response.data.data)) result = { status: 'error' };
          else {
            const subscription = response.data.data.find((row) => String(row._id).toLowerCase() === id.toLowerCase());
            result = subscription ? { status: 'ready', subscription, subscriptions: response.data.data } : { status: 'missing', subscriptions: response.data.data };
          }
        }
      } catch { result = { status: 'error' }; }
      if (current === generation) publish(result);
    },
  };
};

export const includeLinkedSubscription = (filtered, subscriptions, id) => {
  if (!id) return filtered;
  const visibleIds = new Set(filtered.map((row) => row._id));
  return subscriptions.filter((row) => visibleIds.has(row._id) || String(row._id).toLowerCase() === id.toLowerCase());
};

export const highlightSubscriptionCard = (card, {
  frame = requestAnimationFrame, cancelFrame = cancelAnimationFrame,
  timer = setTimeout, cancelTimer = clearTimeout, reducedMotion = false,
} = {}) => {
  if (!card) return () => {};
  const classes = ['!border-yellow-400', 'shadow-[0_0_20px_rgba(250,204,21,0.25)]'];
  let timeout;
  const scheduled = frame(() => {
    card.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
    card.classList.add(...classes);
    timeout = timer(() => card.classList.remove(...classes), 4000);
  });
  return () => { cancelFrame(scheduled); cancelTimer(timeout); card.classList.remove(...classes); };
};
