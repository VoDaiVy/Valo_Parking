import { apiFetch } from '../../../services/api';

const getBasePrefix = () => {
  try {
    const user = JSON.parse(sessionStorage.getItem('valo_user') || '{}');
    if (user.role === 'staff') return '/ai-copilot/staff';
  } catch {
    return '/ai-copilot';
  }
  return '/ai-copilot';
};

const request = (path, options = {}) => apiFetch(`${getBasePrefix()}${path}`, {
  ...options,
  headers: { Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}`, ...options.headers },
});
export const sendAIMessage = (message, conversationId) => request('/chat', { method: 'POST', body: JSON.stringify({ message, conversationId }) });
export const getAINotifications = (filter = 'all') => request(`/notifications?filter=${encodeURIComponent(filter)}`);
export const getAINotification = (id) => request(`/notifications/${encodeURIComponent(id)}`);
export const markAINotificationRead = (id) => request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
export const dismissAINotification = (id) => request(`/notifications/${encodeURIComponent(id)}/dismiss`, { method: 'PATCH' });
export const approveAIDraft = (id) => request(`/drafts/${encodeURIComponent(id)}/approve`, { method: 'POST' });
export const rejectAIDraft = (id) => request(`/drafts/${encodeURIComponent(id)}/reject`, { method: 'POST' });
