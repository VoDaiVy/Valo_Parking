/**
 * Base API configuration and fetch wrapper.
 * All service files should import from here.
 */

import { clearAuthSession, notifyAuthChange } from "./authStorage.js";

export const API_BASE =
  import.meta.env?.VITE_API_BASE_URL ?? "http://localhost:5001/api";

let isRefreshing = false;
let refreshPromise = null;

/**
 * Refresh the access token using the refresh token
 */
async function refreshToken() {
  if (isRefreshing) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const refreshToken = localStorage.getItem("refreshToken");
      if (!refreshToken) {
        throw new Error("No refresh token available");
      }

      const response = await fetch(`${API_BASE}/auth/refresh-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        throw new Error("Failed to refresh token");
      }

      const data = await response.json();
      if (data.data && data.data.accessToken) {
        localStorage.setItem("accessToken", data.data.accessToken);
        notifyAuthChange();
        return data.data.accessToken;
      }
      throw new Error("No access token in response");
    } catch (error) {
      clearAuthSession();
      window.location.href = "/login";
      throw error;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Thin fetch wrapper that always resolves (never throws on HTTP errors).
 * Returns { ok, status, data } so callers can branch on `ok`.
 * Automatically refreshes token on 401 errors and retries the request.
 *
 * @param {string} endpoint  - path after API_BASE, e.g. '/auth/login'
 * @param {RequestInit} options  - standard fetch options (method, body, headers…)
 * @param {boolean} _isRetry - internal flag to prevent infinite retry loops
 * @returns {Promise<{ ok: boolean, status: number, data: any }>}
 */
export async function apiFetch(endpoint, options = {}, _isRetry = false) {
  const { headers = {}, ...rest } = options;

  let res;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, {
      headers: { "Content-Type": "application/json", ...headers },
      ...rest,
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: {
        success: false,
        message:
          "Cannot connect to the server. Please check that the backend is running.",
      },
      error,
    };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    data = {
      success: res.ok,
      message: res.ok ? "OK" : `Request failed with status ${res.status}`,
    };
  }

  // If we get a 401 and we haven't already retried, try to refresh the token
  if (res.status === 401 && !_isRetry && endpoint !== "/auth/refresh-token") {
    try {
      const newToken = await refreshToken();
      // Retry the request with the new token
      const newHeaders = { ...headers };
      if (newHeaders.Authorization) {
        newHeaders.Authorization = `Bearer ${newToken}`;
      }
      return apiFetch(endpoint, { ...options, headers: newHeaders }, true);
    } catch {
      // Refresh failed, return the original 401 response
      return { ok: res.ok, status: res.status, data };
    }
  }

  return { ok: res.ok, status: res.status, data };
}
