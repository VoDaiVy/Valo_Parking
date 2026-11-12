import { apiFetch } from "./api";

// Helper for auth headers
const getAuthHeaders = () => {
  const token = localStorage.getItem("accessToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const getAllFloors = async () => {
  return await apiFetch("/parking-floors", {
    method: "GET",
    headers: getAuthHeaders(),
  });
};

export const createFloor = async (data) => {
  return await apiFetch("/parking-floors", {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
};

export const updateFloorLayout = async (id, layoutData, revision) => {
  return await apiFetch(`/parking-floors/${id}/layout`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ layoutData, revision }),
  });
};

export const deleteFloor = async (id, data) => {
  return await apiFetch(`/parking-floors/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
};

const manageRequest = (path, method = 'GET', data) => apiFetch(`/parking-floors${path}`, {
  method, headers: getAuthHeaders(), ...(data ? { body: JSON.stringify(data) } : {}),
});
export const getManagedFloors = () => manageRequest('/manage');
export const updateFloorInfo = (id, data) => manageRequest(`/${id}`, 'PATCH', data);
export const reviewFloor = (id, revision) => manageRequest(`/${id}/review`, 'POST', { revision });
export const publishFloor = (id, data) => manageRequest(`/${id}/publish`, 'POST', data);
export const archiveFloor = (id, data) => manageRequest(`/${id}/archive`, 'POST', data);
export const updateFloorBookingPolicy = (id, data) => manageRequest(`/${id}/booking-policy`, 'POST', data);
export const discardFloorDraft = (id, revision) => manageRequest(`/${id}/draft`, 'DELETE', { revision });
export const getFloorHistory = (id) => manageRequest(`/${id}/history`);

export const getFloorSlots = async (id) => {
  return await apiFetch(`/parking-floors/${id}/slots`, {
    method: "GET",
    headers: getAuthHeaders(),
  });
};

export const getLiveMapData = async () => {
  return await apiFetch("/parking-floors/live-map", {
    method: "GET",
    headers: getAuthHeaders(),
  });
};
