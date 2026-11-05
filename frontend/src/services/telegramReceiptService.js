import { apiFetch } from './api';

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}` });
const requestError = result => Object.assign(new Error(result.data?.message || 'request_failed'), { code: result.data?.code });
export async function bookingReceipt(bookingId, signal) {
  const result = await apiFetch(`/telegram/bookings/${encodeURIComponent(bookingId)}/receipt`, { headers: authHeaders(), signal });
  if (!result.ok) throw requestError(result);
  return result.data.data || result.data;
}
export async function linkBookingReceipt(bookingId, signal) {
  const result = await apiFetch('/telegram/link-token', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ bookingId }), signal });
  if (!result.ok) throw requestError(result);
  const data = result.data.data || result.data;
  return { ...data, state: data.state || 'needs_link', claimLink: data.deepLink, claimExpiresAt: data.expiresAt };
}

export const receiptRequestLocked = state => ['pending', 'queued', 'processing', 'sent', 'uncertain'].includes(state);

