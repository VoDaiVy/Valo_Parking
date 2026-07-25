import { apiFetch } from './api';

const authHeader = () => ({
  Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
});

export const getTicketPackages = async () => {
  return apiFetch('/ticket-packages/active', {
    method: 'GET',
    headers: authHeader(),
  });
};

export const createSubscriptionPayment = async (packageId, slots) => {
  return apiFetch('/subscriptions/create-payment', {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ packageId, slots }),
  });
};

export const verifySubscriptionPayment = async (orderCode) => {
  return apiFetch('/subscriptions/verify-payment', {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ orderCode }),
  });
};

export const paySubscriptionWithWallet = async (packageId, slots) => {
  return apiFetch('/subscriptions/pay-with-wallet', {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ packageId, slots }),
  });
};

export const getMembership = async () => {
  return apiFetch('/subscriptions/membership', {
    method: 'GET',
    headers: authHeader(),
  });
};

export const getMembershipStatus = async () =>
  apiFetch('/subscriptions/membership', {
    method: 'GET',
    headers: authHeader(),
  });

export const getMembershipQr = async () =>
  apiFetch('/subscriptions/membership/qr', {
    method: 'GET',
    headers: authHeader(),
  });

export const getRenewalQuote = async (subscriptionId) =>
  apiFetch(`/subscriptions/${subscriptionId}/renew/quote`, {
    method: 'POST',
    headers: authHeader(),
  });

export const renewSubscriptionWithWallet = async (subscriptionId, idempotencyKey) =>
  apiFetch(`/subscriptions/${subscriptionId}/renew/pay-with-wallet`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ idempotencyKey }),
  });

export const createRenewalPayment = async (subscriptionId, idempotencyKey) =>
  apiFetch(`/subscriptions/${subscriptionId}/renew/create-payment`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ idempotencyKey }),
  });

export const verifyRenewalPayment = async (orderCode) =>
  apiFetch('/subscriptions/renew/verify-payment', {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ orderCode: Number(orderCode) }),
  });

export const getEntitlementRenewalQuote = async (entitlementId) =>
  apiFetch(`/subscriptions/entitlements/${entitlementId}/renew/quote`, {
    method: 'POST',
    headers: authHeader(),
  });

export const renewEntitlementWithWallet = async (entitlementId, idempotencyKey) =>
  apiFetch(`/subscriptions/entitlements/${entitlementId}/renew/pay-with-wallet`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ idempotencyKey }),
  });

export const createEntitlementRenewalPayment = async (entitlementId, idempotencyKey) =>
  apiFetch(`/subscriptions/entitlements/${entitlementId}/renew/create-payment`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ idempotencyKey }),
  });

export const verifyEntitlementRenewalPayment = async (orderCode) =>
  apiFetch('/subscriptions/entitlements/renew/verify-payment', {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ orderCode: Number(orderCode) }),
  });

export const createEntitlementTransfer = async (entitlementId, input) =>
  apiFetch(`/customer/membership-entitlements/${entitlementId}/transfers`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify(input),
  });

export const searchMembershipTransferRecipients = async (search = "", limit = 12) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (search.trim()) params.set("q", search.trim());
  return apiFetch(`/customer/membership-transfer-recipients?${params.toString()}`, {
    method: "GET",
    headers: authHeader(),
  });
};

export const getMembershipTransferMarketplace = async (filters = {}) => {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch(`/customer/membership-transfer-marketplace${suffix}`, {
    method: 'GET',
    headers: authHeader(),
  });
};

export const getMembershipTransferListing = async (transferId) =>
  apiFetch(`/customer/membership-transfer-marketplace/${transferId}`, {
    method: 'GET',
    headers: authHeader(),
  });

export const claimMembershipTransferListing = async (transferId) =>
  apiFetch(`/customer/membership-transfer-marketplace/${transferId}/claim`, {
    method: 'POST',
    headers: authHeader(),
  });

export const getMyEntitlementTransfers = async () =>
  apiFetch('/customer/membership-entitlement-transfers', {
    method: 'GET',
    headers: authHeader(),
  });

export const acceptEntitlementTransfer = async (transferId) =>
  apiFetch(`/customer/membership-entitlement-transfers/${transferId}/accept`, {
    method: 'PUT',
    headers: authHeader(),
  });

export const rejectEntitlementTransfer = async (transferId, reason = '') =>
  apiFetch(`/customer/membership-entitlement-transfers/${transferId}/reject`, {
    method: 'PUT',
    headers: authHeader(),
    body: JSON.stringify({ reason }),
  });

export const cancelEntitlementTransfer = async (transferId) =>
  apiFetch(`/customer/membership-entitlement-transfers/${transferId}/cancel`, {
    method: 'PUT',
    headers: authHeader(),
  });

export const settleEntitlementTransfer = async (transferId) =>
  apiFetch(`/customer/membership-entitlement-transfers/${transferId}/settle-wallet`, {
    method: 'POST',
    headers: authHeader(),
  });
