import { apiFetch } from './api';

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}` });
export async function bookingReceipt(bookingId, signal) {
  const result = await apiFetch(`/telegram/bookings/${encodeURIComponent(bookingId)}/receipt`, { headers: authHeaders(), signal });
  if (!result.ok) throw new Error('request_failed');
  return result.data.data || result.data;
}
export async function linkBookingReceipt(bookingId, signal) {
  const result = await apiFetch('/telegram/link-token', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ bookingId }), signal });
  if (!result.ok) throw new Error('request_failed');
  const data = result.data.data || result.data;
  return { ...data, state: 'needs_link', claimLink: data.deepLink, claimExpiresAt: data.expiresAt };
}

