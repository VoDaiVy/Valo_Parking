import { apiFetch } from './api';

export const getExplorePackages = ({ type = 'all', page = 1, limit = 12, signal } = {}) => {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (type !== 'all') query.set('type', type);
  return apiFetch(`/ticket-packages/explore?${query}`, { signal });
};
