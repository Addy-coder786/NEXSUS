import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { ApiErrorBody, ApiSuccess, PaginationMeta } from '@nexus/shared';
import { useAuthStore } from '@/stores/auth.store';

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
export const API_BASE = `${API_URL}/api`;

export interface ValidationDetail {
  path: string;
  message: string;
}

export class ApiClientError extends Error {
  readonly status: number | undefined;
  readonly code: string;
  readonly details: unknown;

  constructor(args: { status?: number; code: string; message: string; details?: unknown }) {
    super(args.message);
    this.name = 'ApiClientError';
    this.status = args.status;
    this.code = args.code;
    this.details = args.details;
  }

  /** Normalised validation details (path, message) when this is a VALIDATION_ERROR. */
  get validationDetails(): ValidationDetail[] {
    if (!Array.isArray(this.details)) return [];
    return this.details.flatMap((d: unknown) => {
      if (!d || typeof d !== 'object') return [];
      const rec = d as Record<string, unknown>;
      const rawPath = rec.path;
      const path = Array.isArray(rawPath)
        ? rawPath.map(String).join('.')
        : typeof rawPath === 'string'
          ? rawPath
          : '';
      const message = typeof rec.message === 'string' ? rec.message : 'Invalid value';
      return [{ path, message }];
    });
  }
}

export function isApiError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

export function getErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (isApiError(error)) return error.message || fallback;
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

/** Routes whose 401s must never trigger a refresh attempt. */
const NO_REFRESH_PATHS = ['/auth/refresh', '/auth/login', '/auth/logout', '/auth/register'];

function pathOf(config: AxiosRequestConfig | undefined): string {
  const url = config?.url ?? '';
  try {
    return new URL(url, 'http://local').pathname.replace(/^\/api/, '');
  } catch {
    return url;
  }
}

function toClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  if (axios.isAxiosError(error)) {
    const ax = error as AxiosError<ApiErrorBody>;
    const body = ax.response?.data;
    if (body && typeof body === 'object' && 'error' in body && body.error) {
      return new ApiClientError({
        status: ax.response?.status,
        code: body.error.code,
        message: body.error.message,
        details: body.error.details,
      });
    }
    if (ax.response) {
      return new ApiClientError({
        status: ax.response.status,
        code: ax.response.status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
        message: ax.message || `Request failed with status ${ax.response.status}`,
      });
    }
    return new ApiClientError({
      code: 'NETWORK_ERROR',
      message: 'Cannot reach the server. Check your connection and try again.',
    });
  }
  return new ApiClientError({
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : 'Unknown error',
  });
}

export const http: AxiosInstance = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: { Accept: 'application/json' },
  timeout: 30_000,
});

let refreshPromise: Promise<void> | null = null;

/** Dedupes concurrent refreshes behind a single in-flight request. */
export function refreshSession(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = http
      .post('/auth/refresh')
      .then(() => undefined)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

http.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    const clientError = toClientError(error);
    const config = axios.isAxiosError(error)
      ? (error.config as RetriableConfig | undefined)
      : undefined;

    if (clientError.status === 401 && config && !config._retried) {
      const path = pathOf(config);
      const isNoRefreshRoute = NO_REFRESH_PATHS.some((p) => path.startsWith(p));
      const isAuthRoute = path.startsWith('/auth/');
      const shouldRefresh =
        !isNoRefreshRoute && (clientError.code === 'TOKEN_EXPIRED' || !isAuthRoute);

      if (shouldRefresh) {
        try {
          await refreshSession();
        } catch {
          useAuthStore.getState().clear();
          throw clientError;
        }
        config._retried = true;
        return http.request(config);
      }
    }

    throw clientError;
  },
);

/** Perform a request and return the unwrapped `data` from the success envelope. */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const res = await http.request<ApiSuccess<T> | undefined>(config);
  const body = res.data;
  if (body && typeof body === 'object' && 'data' in body) return body.data;
  return undefined as T;
}

export interface Paged<T> {
  items: T[];
  meta: PaginationMeta;
}

/** Perform a request against a paginated endpoint and return items + meta. */
export async function requestPaged<T>(config: AxiosRequestConfig): Promise<Paged<T>> {
  const res = await http.request<ApiSuccess<T[]>>(config);
  const body = res.data;
  const items = Array.isArray(body?.data) ? body.data : [];
  const meta: PaginationMeta = body?.meta ?? {
    page: 1,
    limit: items.length,
    total: items.length,
    totalPages: 1,
  };
  return { items, meta };
}

export const api = {
  get: <T>(url: string, params?: Record<string, unknown>) =>
    request<T>({ method: 'GET', url, params }),
  getPaged: <T>(url: string, params?: Record<string, unknown>) =>
    requestPaged<T>({ method: 'GET', url, params }),
  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    request<T>({ method: 'POST', url, data, ...config }),
  patch: <T>(url: string, data?: unknown) => request<T>({ method: 'PATCH', url, data }),
  delete: <T = void>(url: string) => request<T>({ method: 'DELETE', url }),
};

/** Strip undefined / null / empty-string values so they are not serialised into the query string. */
export function cleanParams<T extends Record<string, unknown>>(params: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}
