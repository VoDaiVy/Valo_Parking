import { apiFetch } from './api';

export const MAX_VEHICLES_PER_USER = 3;

const authHeader = () => ({
  Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
});

/** GET /api/vehicles — get the user vehicle list */
export const getMyVehicles = () =>
  apiFetch('/vehicles', { headers: authHeader() });

/** POST /api/vehicles — add a new vehicle */
export const addVehicle = (data) =>
  apiFetch('/vehicles', {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify(data),
  });

/** PUT /api/vehicles/:id — update vehicle */
export const updateVehicle = (id, data) =>
  apiFetch(`/vehicles/${id}`, {
    method: 'PUT',
    headers: authHeader(),
    body: JSON.stringify(data),
  });

/** DELETE /api/vehicles/:id — delete vehicle */
export const deleteVehicle = (id) =>
  apiFetch(`/vehicles/${id}`, {
    method: 'DELETE',
    headers: authHeader(),
  });

/** PATCH /api/vehicles/:id/default — set the default vehicle */
export const setDefaultVehicle = (id) =>
  apiFetch(`/vehicles/${id}/default`, {
    method: 'PATCH',
    headers: authHeader(),
  });

/** POST /api/ai/scan-registration-card — scan vehicle registration card with AI */
export const scanRegistrationCard = (imageBase64) =>
  apiFetch('/ai/scan-registration-card', {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ image: imageBase64 }),
  });
