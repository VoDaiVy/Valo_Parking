import { apiFetch } from './api';

const authHeader = () => ({
  Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
});

const request = (path, options = {}) => apiFetch(path, {
  ...options,
  headers: { ...authHeader(), ...(options.headers || {}) },
});

export const getLoyaltyAccount = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/loyalty/account${query ? `?${query}` : ''}`);
};

export const getVoucherCatalog = () => request('/loyalty/templates');

export const redeemVoucher = (templateId) => request('/loyalty/redeem', {
  method: 'POST',
  body: JSON.stringify({ templateId }),
});

export const getMyVouchers = (status = '') => request(
  `/loyalty/vouchers${status ? `?status=${encodeURIComponent(status)}` : ''}`
);

export const getVoucherTemplatesAdmin = () => request('/admin/voucher-templates');
export const getSpendingProgram = () => request('/admin/voucher-templates/spending-program');
export const saveSpendingProgram = (payload) => request('/admin/voucher-templates/spending-program', { method: 'PUT', body: JSON.stringify(payload) });
export const getSpendingProgress = () => request('/loyalty/spending');
export const getQuarterlyLeaderboardAdmin = (quarter) => request(`/admin/voucher-templates/leaderboard${quarter ? `?quarter=${encodeURIComponent(quarter)}` : ''}`);
export const searchVoucherRecipients = (query) => request(`/admin/voucher-templates/recipients?q=${encodeURIComponent(query)}`);
export const distributeVouchers = (id, payload) => request(`/admin/voucher-templates/${id}/distribute`, { method: 'POST', body: JSON.stringify(payload) });
export const updateVoucherExpiry = (id, expiresAt) => request(`/admin/voucher-templates/issued/${id}/expiry`, { method: 'PATCH', body: JSON.stringify({ expiresAt }) });

export const createVoucherTemplate = (payload) => request('/admin/voucher-templates', {
  method: 'POST',
  body: JSON.stringify(payload),
});

export const updateVoucherTemplate = (id, payload) => request(`/admin/voucher-templates/${id}`, {
  method: 'PUT',
  body: JSON.stringify(payload),
});

export const deactivateVoucherTemplate = (id) => request(`/admin/voucher-templates/${id}/deactivate`, {
  method: 'PATCH',
});

export const deleteVoucherTemplate = (id) => request(`/admin/voucher-templates/${id}`, {
  method: 'DELETE',
});
