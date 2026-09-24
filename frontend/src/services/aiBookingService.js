import { apiFetch } from './api';

export const interpretAiBooking = (prompt, draft, today, currentTime) => apiFetch('/ai/booking/interpret', {
  method: 'POST',
  headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
  body: JSON.stringify({ prompt, draft, today, currentTime }),
});

const authorizedRequest = (path, options = {}) => apiFetch(path, {
  ...options,
  headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}`, ...(options.headers || {}) },
});

export const getLatestAiBookingSession = () => authorizedRequest('/ai/booking/sessions/latest');

export const getAiBookingSession = (sessionId) => authorizedRequest(`/ai/booking/sessions/${sessionId}`);

export const createAiBookingSession = (snapshot) => authorizedRequest('/ai/booking/sessions', {
  method: 'POST', body: JSON.stringify(snapshot),
});

export const appendAiBookingMessages = (sessionId, messages) => authorizedRequest(`/ai/booking/sessions/${sessionId}/messages`, {
  method: 'POST', body: JSON.stringify({ messages }),
});

export const updateAiBookingSession = (sessionId, snapshot) => authorizedRequest(`/ai/booking/sessions/${sessionId}`, {
  method: 'PUT', body: JSON.stringify(snapshot),
});

export const completeAiBookingSession = (sessionId, snapshot) => authorizedRequest(`/ai/booking/sessions/${sessionId}/complete`, {
  method: 'POST', body: JSON.stringify(snapshot),
});

export const discardAiBookingSession = (sessionId) => authorizedRequest(`/ai/booking/sessions/${sessionId}`, {
  method: 'DELETE',
});
