import { apiFetch } from './api';

const authHeader = () => ({
  Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
});

const withRange = (endpoint, range = '30d', filters = {}) =>
  `${endpoint}?${new URLSearchParams({ range, ...filters }).toString()}`;

export const getCustomerBookingStatistics = (range = '30d') =>
  apiFetch(withRange('/statistics/customer/bookings', range), {
    headers: authHeader(),
  });

export const getAdminBookingStatistics = (range = '30d', filters = {}) =>
  apiFetch(withRange('/statistics/admin/bookings', range, filters), {
    headers: authHeader(),
  });

export const getAdminSubscriptionStatistics = (range = '30d') =>
  apiFetch(withRange('/statistics/admin/subscriptions', range), {
    headers: authHeader(),
  });

export const getAdminPlatformRevenueStatistics = (range = 'all') =>
  apiFetch(withRange('/statistics/admin/platform-revenue', range), {
    headers: authHeader(),
  });

/**
 * Mode-based platform revenue for Revenue Analytics dashboard.
 * Single call for all data: summary, trend, traffic, status, packages.
 * @param {Object} params - { mode: '7d'|'month'|'quarter'|'year', year?, month?, quarter? }
 */
export const getAdminPlatformRevenueByMode = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return apiFetch(`/statistics/admin/platform-revenue?${query}`, {
    headers: authHeader(),
  });
};

const getRevenueDateRange = (range) => {
  if (range === 'all') return {};
  const endDate = new Date();
  const startDate = new Date(endDate);
  if (range === '7d') startDate.setDate(startDate.getDate() - 7);
  if (range === '30d') startDate.setDate(startDate.getDate() - 30);
  if (range === 'month') startDate.setDate(1);
  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  };
};

export const getViolationRevenueStatistics = (range = '30d') => {
  const query = new URLSearchParams(getRevenueDateRange(range)).toString();
  return apiFetch(`/revenue/violations/statistics${query ? `?${query}` : ''}`, {
    headers: authHeader(),
  });
};
