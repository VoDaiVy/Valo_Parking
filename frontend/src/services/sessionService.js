import { apiFetch } from './api.js';

const authHeader = () => ({
  Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
});

export const getAllSessions = () => apiFetch('/sessions', { method: 'GET', headers: authHeader() });
export const getActiveSessions = () => apiFetch('/sessions/active-status', { method: 'GET', headers: authHeader() });

export const getSessionResponseState = (response) => {
  const isAvailable = Boolean(response?.ok && response.data?.success);

  return {
    isAvailable,
    sessions: isAvailable ? (response.data.data || []) : [],
    error: isAvailable ? '' : (response?.data?.message || 'Live session data is unavailable.'),
  };
};
