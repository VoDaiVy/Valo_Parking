import { apiFetch } from './api';

export const interpretAiBooking = (prompt, draft, today, currentTime, conversationHistory = []) => apiFetch('/ai/booking/interpret', {
  method: 'POST',
  headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
  body: JSON.stringify({ prompt, draft, today, currentTime, conversationHistory }),
});

const authorizedRequest = (path, options = {}) => apiFetch(path, {
  ...options,
  headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}`, ...(options.headers || {}) },
});

export const getLatestAiBookingSession = (language) => authorizedRequest(`/ai/booking/sessions/latest${language ? `?language=${language === 'vi' ? 'vi' : 'en'}` : ''}`);

export const localizeAiBookingReply = (text, language) => authorizedRequest('/ai/booking/localize', { method: 'POST', body: JSON.stringify({ text, language }) });
export const transcribeAiBookingVoice = (audio, mimeType, previousLanguage, { signal, contextPhrases } = {}) => authorizedRequest('/ai/booking/transcribe', { method: 'POST', signal, body: JSON.stringify({ audio, mimeType, previousLanguage, contextPhrases }) });

export const listAiBookingSessions = ({ language, search = '', page = 1 } = {}) => authorizedRequest(
  `/ai/booking/sessions?${new URLSearchParams({ ...(language ? { language } : {}), search, page: String(page) })}`
);
export const renameAiBookingSession = (sessionId, title) => authorizedRequest(`/ai/booking/sessions/${sessionId}/title`, {
  method: 'PATCH', body: JSON.stringify({ title }),
});
export const deleteAiBookingHistory = (sessionId) => authorizedRequest(`/ai/booking/sessions/${sessionId}/history`, { method: 'DELETE' });

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
