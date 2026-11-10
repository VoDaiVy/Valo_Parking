import { apiFetch, API_BASE } from './api';

const authHeader = () => ({
  Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
});

/** GET /api/services — Get service list (public) */
export const getServices = (activeOnly = true, options = {}) =>
  apiFetch(`/services?activeOnly=${activeOnly}`, options);

/** GET /api/services/:id — Get service details (public) */
export const getServiceById = (id) =>
  apiFetch(`/services/${id}`);

/** 
 * POST /api/admin/services — Add new service (requires file upload)
 * Because this uses FormData, use native fetch instead of apiFetch because apiFetch defaults to Content-Type: application/json
 */
export const createService = async (formData) => {
  const res = await fetch(`${API_BASE}/admin/services`, {
    method: 'POST',
    headers: authHeader(),
    body: formData,
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
};

/** 
 * PUT /api/admin/services/:id — Update service
 */
export const updateService = async (id, formData) => {
  const res = await fetch(`${API_BASE}/admin/services/${id}`, {
    method: 'PUT',
    headers: authHeader(),
    body: formData,
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
};

/** DELETE /api/admin/services/:id — Delete service */
export const deleteService = (id) =>
  apiFetch(`/admin/services/${id}`, {
    method: 'DELETE',
    headers: authHeader(),
  });
