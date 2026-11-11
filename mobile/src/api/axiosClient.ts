import axios, { AxiosError } from 'axios';

import { API_URL } from '../constants/env';

export type NormalizedApiError = Error & {
  status?: number;
  code?: string;
  data?: unknown;
};

let accessToken: string | null = null;

export const setAuthToken = (token: string | null) => {
  accessToken = token;
};

const getErrorMessage = (data: unknown, fallback: string) => {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;

    if (typeof record.message === 'string') {
      return record.message;
    }

    if (typeof record.error === 'string') {
      return record.error;
    }
  }

  return fallback;
};

const axiosClient = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

axiosClient.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  if (__DEV__) {
    console.log('[API Request]', config.method?.toUpperCase(), config.baseURL, config.url);
  }

  return config;
});

axiosClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const normalizedError = new Error(
      error.response
        ? getErrorMessage(error.response.data, error.message || 'Request failed')
        : `${error.message || 'Request failed'} · API: ${API_URL}`,
    ) as NormalizedApiError;

    normalizedError.status = error.response?.status;
    normalizedError.code = error.code;
    normalizedError.data = error.response?.data;

    return Promise.reject(normalizedError);
  },
);

export default axiosClient;
