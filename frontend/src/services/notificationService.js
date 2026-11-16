/**
 * Notification API service — all API calls related to notifications.
 */

import { apiFetch } from './api';

/** GET /api/notifications — paginated, filtered */
export const getNotifications = ({ page = 1, limit = 20, type, isRead, search, contextRole } = {}) => {
  const params = new URLSearchParams();
  params.set('page', page);
  params.set('limit', limit);
  if (type) params.set('type', type);
  if (isRead !== undefined && isRead !== null && isRead !== '') params.set('isRead', isRead);
  if (search) params.set('search', search);
  if (contextRole) params.set('contextRole', contextRole);

  return apiFetch(`/notifications?${params.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
  });
};

/** GET /api/notifications/unread-count */
export const getUnreadCount = ({ contextRole } = {}) => {
  const params = new URLSearchParams();
  if (contextRole) params.set('contextRole', contextRole);
  
  return apiFetch(`/notifications/unread-count${contextRole ? `?${params.toString()}` : ''}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
  });
};

/** PUT /api/notifications/:id/read */
export const markAsRead = (id) =>
  apiFetch(`/notifications/${id}/read`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
  });

/** PUT /api/notifications/read-all */
export const markAllAsRead = () =>
  apiFetch('/notifications/read-all', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
  });

/** DELETE /api/notifications/:id */
export const deleteNotification = (id) =>
  apiFetch(`/notifications/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
  });

// ── Admin/Staff endpoints ──

/** POST /api/notifications */
export const createNotification = (data) =>
  apiFetch('/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
    },
    body: JSON.stringify(data),
  });

/** POST /api/notifications/internal-report */
export const sendInternalReport = (content, priority = 'INFO') =>
  apiFetch('/notifications/internal-report', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
    },
    body: JSON.stringify({ content, priority }),
  });

const incidentHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('accessToken')}` });
export const getInternalReports = ({ status, page, signal }) =>
  apiFetch(`/notifications/internal-reports?${new URLSearchParams({ status, page })}`, { headers: incidentHeaders(), signal });
export const getInternalReport = (id, signal) =>
  apiFetch(`/notifications/internal-reports/${encodeURIComponent(id)}`, { headers: incidentHeaders(), signal });
export const updateInternalReport = (id, data) =>
  apiFetch(`/notifications/internal-reports/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: incidentHeaders(), body: JSON.stringify(data),
  });

/** GET /api/notifications/admin/history */
export const getAdminHistory = ({ page = 1, limit = 20, type, priority, search } = {}) => {
  const params = new URLSearchParams();
  params.set('page', page);
  params.set('limit', limit);
  if (type) params.set('type', type);
  if (priority) params.set('priority', priority);
  if (search) params.set('search', search);

  return apiFetch(`/notifications/admin/history?${params.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
  });
};

/** PUT /api/notifications/:id/revoke */
export const revokeNotification = (id) =>
  apiFetch(`/notifications/${id}/revoke`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
  });

/** PUT /api/notifications/admin/history/:id/read */
export const markAdminHistoryAsRead = (id) =>
  apiFetch(`/notifications/admin/history/${id}/read`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
  });

/** PUT /api/notifications/admin/history/read-all */
export const markAllAdminHistoryAsRead = () =>
  apiFetch('/notifications/admin/history/read-all', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
  });

/** DELETE /api/notifications/admin/history/:id */
export const deleteAdminHistoryNotification = (id) =>
  apiFetch(`/notifications/admin/history/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
  });

// ── Auto Rules API ──

/** GET /api/notifications/admin/rules */
export const getAutoRules = () =>
  apiFetch('/notifications/admin/rules', {
    method: 'GET',
    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
  });

/** PUT /api/notifications/admin/rules/:eventKey */
export const updateAutoRule = (eventKey, data) =>
  apiFetch(`/notifications/admin/rules/${eventKey}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
    body: JSON.stringify(data),
  });

/** POST /api/notifications/admin/rules/:eventKey/test */
export const testAutoRule = (eventKey) =>
  apiFetch(`/notifications/admin/rules/${eventKey}/test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
  });
