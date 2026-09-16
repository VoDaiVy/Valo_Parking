import { apiFetch } from './api';

export const interpretAiBooking = (prompt, draft, today) => apiFetch('/ai/booking/interpret', {
  method: 'POST',
  headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
  body: JSON.stringify({ prompt, draft, today }),
});
