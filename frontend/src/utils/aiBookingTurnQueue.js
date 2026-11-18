// Serialize dialogue turns. In-flight booking/payment operations are never
// aborted by a newer message; pending messages use the resulting context.
export function createBookingTurnQueue({ process, onStateChange = () => {}, onError = () => {} }) {
  let pending = [], running = false, disposed = false;
  let idleWaiters = [];
  const notify = () => {
    onStateChange({ running, pending: pending.length });
    if (!running && !pending.length) { idleWaiters.splice(0).forEach((resolve) => resolve()); }
  };
  const drain = async () => {
    if (running || disposed) return;
    running = true; notify();
    while (pending.length && !disposed) {
      const turn = pending.shift(); notify();
      try { await process(turn.payload); turn.resolve({ processed: true }); }
      catch (error) { try { await onError(error, turn.payload); } catch { /* A failed error presentation must not drop later turns. */ } finally { turn.resolve({ processed: false }); } }
    }
    running = false; notify();
  };
  return {
    enqueue(payload) {
      if (disposed) return Promise.resolve({ cancelled: true });
      const result = new Promise((resolve) => pending.push({ payload, resolve }));
      notify(); queueMicrotask(drain); return result;
    },
    whenIdle() { return !running && !pending.length ? Promise.resolve() : new Promise((resolve) => idleWaiters.push(resolve)); },
    get pendingCount() { return pending.length; },
    get busy() { return running || pending.length > 0; },
    clear() { pending.splice(0).forEach((turn) => turn.resolve({ cancelled: true })); notify(); },
    dispose() { disposed = true; this.clear(); },
  };
}

export function mayConfirmQueuedBooking(sent, current) {
  return sent?.ready === true && current?.ready === true
    && Boolean(sent.key) && sent.key === current.key;
}
