import { apiFetch } from './api';

const authHeader = () => ({
  Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
});

const queryString = (filters = {}) => {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (key !== 'signal' && value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  return query.toString() ? `?${query.toString()}` : '';
};

const safeRequest = async (endpoint, options = {}) => {
  try {
    const result = await apiFetch(endpoint, options);
    if (result?.status === 0) {
      console.error('[DynamicPricing] Network request failed', result.error || result.data?.message);
      return { ok: false, status: 0, data: null };
    }
    return result || { ok: false, status: 0, data: null };
  } catch (error) {
    console.error('[DynamicPricing] Request failed', error);
    return { ok: false, status: 0, data: null };
  }
};

export const getCurrentPricing = async (options = {}) => {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (options.signal) options.signal.addEventListener('abort', abortFromCaller, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    return await safeRequest(`/pricing/current${queryString(options)}`, { method: 'GET', signal: controller.signal });
  } catch (error) {
    console.error('[DynamicPricing] Current pricing failed', error);
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timeoutId);
    if (options.signal) options.signal.removeEventListener('abort', abortFromCaller);
  }
};

export const getPricingConfig = () => safeRequest('/pricing/config', {
  method: 'GET', headers: authHeader(),
});

export const updatePricingConfig = (payload) => safeRequest('/pricing/config', {
  method: 'PUT', headers: authHeader(), body: JSON.stringify(payload),
});

export const getPricingRules = (filters = {}) => safeRequest(`/pricing/rules${queryString(filters)}`, {
  method: 'GET', headers: authHeader(),
});

export const createPricingRule = (payload) => safeRequest('/pricing/rules', {
  method: 'POST', headers: authHeader(), body: JSON.stringify(payload),
});

export const updatePricingRule = (id, payload) => safeRequest(`/pricing/rules/${id}`, {
  method: 'PUT', headers: authHeader(), body: JSON.stringify(payload),
});

export const deletePricingRule = (id) => safeRequest(`/pricing/rules/${id}`, {
  method: 'DELETE', headers: authHeader(),
});

export const getSuggestions = (filters = {}) => safeRequest(`/pricing/suggestions${queryString(filters)}`, {
  method: 'GET', headers: authHeader(),
});

export const approveSuggestion = (id) => safeRequest(`/pricing/suggestions/${id}/approve`, {
  method: 'POST', headers: authHeader(),
});

export const rejectSuggestion = (id) => safeRequest(`/pricing/suggestions/${id}/reject`, {
  method: 'POST', headers: authHeader(),
});

export const getPricingHistory = (filters = {}) => safeRequest(`/pricing/history${queryString(filters)}`, {
  method: 'GET', headers: authHeader(),
});

export const getPricingStats = (filters = {}) => safeRequest(`/pricing/stats${queryString(filters)}`, {
  method: 'GET', headers: authHeader(),
});
