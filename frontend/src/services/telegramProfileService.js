import { apiFetch } from './api';

async function request(path, options = {}, signal) {
  const result = await apiFetch(`/telegram/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}` },
    signal,
  });
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  if (!result.ok || result.data?.success === false) {
    throw Object.assign(new Error(result.data?.message || 'Unable to update Telegram. Please try again.'), {
      code: result.data?.code,
      status: result.status,
    });
  }
  return result.data?.data || result.data;
}

export const getTelegramProfile = signal => request('link', {}, signal);
export const createTelegramProfileLink = signal => request('link-token', { method: 'POST', body: '{}' }, signal);
export const setTelegramNotifications = (notificationsEnabled, signal) => request('preferences', {
  method: 'PATCH', body: JSON.stringify({ notificationsEnabled }),
}, signal);
export const unlinkTelegramProfile = signal => request('link', { method: 'DELETE' }, signal);
