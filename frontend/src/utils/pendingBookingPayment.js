const PREFIX = 'valo_pending_booking_payment';
const TTL_MS = 60 * 60 * 1000;

const ownerId = (storage) => {
  try {
    const user = JSON.parse(storage?.getItem('valo_user') || 'null');
    return String(user?.id || user?._id || user?.email || '').trim();
  } catch {
    return '';
  }
};

const keyFor = (scope, storage) => {
  const owner = ownerId(storage);
  return owner ? `${PREFIX}:${scope}:${owner}` : '';
};

export const readPendingBookingPayment = (scope, storage = globalThis.localStorage, now = Date.now()) => {
  const key = keyFor(scope, storage);
  if (!key) return null;
  try {
    const value = JSON.parse(storage.getItem(key) || 'null');
    const createdAt = Date.parse(value?.createdAt || '');
    if (!value?.orderCode || !Number.isFinite(createdAt) || now - createdAt >= TTL_MS) {
      storage.removeItem(key);
      return null;
    }
    return value;
  } catch {
    storage.removeItem(key);
    return null;
  }
};

export const writePendingBookingPayment = (scope, payment, storage = globalThis.localStorage) => {
  const key = keyFor(scope, storage);
  if (!key || !payment?.orderCode) return false;
  try {
    storage.setItem(key, JSON.stringify({ ...payment, createdAt: payment.createdAt || new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
};

export const clearPendingBookingPayment = (scope, storage = globalThis.localStorage) => {
  const key = keyFor(scope, storage);
  if (!key) return;
  try { storage.removeItem(key); } catch { /* storage may be unavailable */ }
};
