import { apiFetch } from './api';

const authHeader = () => ({
  Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
});

export const getAllBookings = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return apiFetch(`/bookings/all${query ? `?${query}` : ''}`, {
    method: 'GET',
    headers: authHeader(),
  });
};

export const getActiveMapBookings = () => {
  return apiFetch(`/bookings/active-for-map`, {
    method: 'GET',
    headers: authHeader(),
  });
};

export const getAvailableBookingSlots = ({ startTime, endTime }) => {
  const query = new URLSearchParams({ startTime, endTime }).toString();

  return apiFetch(`/bookings/available-slots?${query}`, {
    method: 'GET',
    headers: authHeader(),
  });
};

export const getActiveHolds = () => {
  return apiFetch(`/bookings/active-holds`, {
    method: 'GET',
    headers: authHeader(),
  });
};

export const createBooking = (payload) =>
  apiFetch('/bookings', {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify(payload),
  });

export const quoteBooking = (payload) =>
  apiFetch('/bookings/quote', {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify(payload),
  });

export const createBookingHold = (payload) =>
  apiFetch('/bookings/hold', {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify(payload),
  });

export const releaseBookingHold = (holdId, payload = {}) =>
  apiFetch(`/bookings/holds/${holdId}`, {
    method: 'DELETE',
    headers: authHeader(),
    body: JSON.stringify(payload),
  });

export const quoteBulkBooking = (payload) =>
  apiFetch('/bookings/bulk/quote', {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify(payload),
  });

export const createBulkBookingHolds = (payload) =>
  apiFetch('/bookings/bulk/holds', {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify(payload),
  });

export const releaseBulkBookingHolds = (holdIds) =>
  apiFetch('/bookings/bulk/holds', {
    method: 'DELETE',
    headers: authHeader(),
    body: JSON.stringify({ holdIds }),
  });

export const createBulkBooking = (payload) =>
  apiFetch('/bookings/bulk', {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify(payload),
  });

export const getBookingOrder = (orderId) =>
  apiFetch(`/bookings/orders/${orderId}`, {
    method: 'GET',
    headers: authHeader(),
  });

export const getMyBookings = () =>
  apiFetch('/bookings/my', {
    method: 'GET',
    headers: authHeader(),
  });

export const getBookingQr = (bookingId) =>
  apiFetch(`/bookings/${bookingId}/qr`, {
    method: 'GET',
    headers: authHeader(),
  });

export const getBookingCancellationQuote = (bookingId) =>
  apiFetch(`/bookings/${bookingId}/cancel-quote`, {
    method: 'GET',
    headers: authHeader(),
  });

export const checkInBooking = (bookingId) =>
  apiFetch(`/bookings/${bookingId}/check-in`, {
    method: 'POST',
    headers: authHeader(),
  });

export const checkOutBooking = (bookingId) =>
  apiFetch(`/bookings/${bookingId}/check-out`, {
    method: 'POST',
    headers: authHeader(),
  });

export const cancelBooking = (bookingId) =>
  apiFetch(`/bookings/${bookingId}/cancel`, {
    method: 'POST',
    headers: authHeader(),
  });

export const updateBookingVehicle = (bookingId, payload) =>
  apiFetch(`/bookings/${bookingId}/vehicle`, {
    method: 'PUT',
    headers: authHeader(),
    body: JSON.stringify(payload),
  });

export const extendBooking = (bookingId, payload) =>
  apiFetch(`/bookings/${bookingId}/time`, {
    method: 'PUT',
    headers: authHeader(),
    body: JSON.stringify(payload),
  });
