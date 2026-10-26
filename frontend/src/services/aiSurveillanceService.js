import { API_BASE } from './api';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token') || localStorage.getItem('accessToken') || '';
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

export const getViolationLogs = async (params = {}) => {
  const query = new URLSearchParams();
  if (params.floorId) query.append('floorId', params.floorId);
  if (params.status) query.append('status', params.status);
  if (params.slotCode) query.append('slotCode', params.slotCode);
  if (params.search) query.append('search', params.search);
  if (params.date) query.append('date', params.date);
  if (params.month) query.append('month', params.month);
  if (params.startDate) query.append('startDate', params.startDate);
  if (params.endDate) query.append('endDate', params.endDate);
  if (params.quickRange) query.append('quickRange', params.quickRange);
  if (params.page) query.append('page', params.page);
  if (params.limit) query.append('limit', params.limit);

  const res = await fetch(`${API_BASE}/ai/violation-logs?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  return res.json();
};

export const getSlotLogs = async (slotCode, floorId = null) => {
  const query = floorId ? `?floorId=${encodeURIComponent(floorId)}` : '';
  const res = await fetch(`${API_BASE}/ai/slot-logs/${encodeURIComponent(slotCode)}${query}`, {
    headers: getAuthHeaders(),
  });
  return res.json();
};

export const resolveViolation = async (payload) => {
  const res = await fetch(`${API_BASE}/ai/resolve-violation`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return res.json();
};

export const scanParkingSlotsApi = async (payload) => {
  const res = await fetch(`${API_BASE}/ai/scan-slots`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return res.json();
};

export const clearAllViolationsApi = async (floorId = null) => {
  const res = await fetch(`${API_BASE}/ai/clear-all-violations`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ floorId }),
  });
  return res.json();
};

export const getDriverContactInfoApi = async (plate, slotCode) => {
  const query = new URLSearchParams();
  if (plate) query.append('plate', plate);
  if (slotCode) query.append('slotCode', slotCode);
  const res = await fetch(`${API_BASE}/ai/driver-contact?${query.toString()}`, {
    headers: getAuthHeaders(),
  });
  return res.json();
};

export const sendViolationWarningEmailApi = async (payload) => {
  const res = await fetch(`${API_BASE}/ai/send-warning-email`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return res.json();
};

