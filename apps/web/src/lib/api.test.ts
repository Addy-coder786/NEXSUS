import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, api, http } from './api';
import { useAuthStore } from '@/stores/auth.store';

type Handler = (config: InternalAxiosRequestConfig, callIndex: number) => { status: number; body: unknown };

function pathOf(config: InternalAxiosRequestConfig): string {
  return (config.url ?? '').replace(/^.*\/api/, '');
}

/** Installs a fake adapter; `routes` maps a path to a handler that may vary by call index. */
function installAdapter(routes: Record<string, Handler>) {
  const calls: Record<string, number> = {};
  const log: string[] = [];
  const adapter: AxiosAdapter = async (config) => {
    const path = pathOf(config);
    log.push(`${config.method?.toUpperCase()} ${path}`);
    const handler = routes[path];
    if (!handler) throw new Error(`No route for ${path}`);
    const index = calls[path] ?? 0;
    calls[path] = index + 1;
    const { status, body } = handler(config, index);
    const response: AxiosResponse = { data: body, status, statusText: '', headers: {}, config };
    if (status >= 400) {
      throw new AxiosError(`Request failed with status ${status}`, 'ERR_BAD_REQUEST', config, null, response);
    }
    return response;
  };
  http.defaults.adapter = adapter;
  return { calls, log };
}

const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
const err = (status: number, code: string, message = code) => ({
  status,
  body: { success: false, error: { code, message } },
});

describe('api client', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, status: 'authed' });
  });

  it('unwraps the success envelope', async () => {
    installAdapter({ '/workspaces': () => ok([{ id: '1' }]) });
    await expect(api.get('/workspaces')).resolves.toEqual([{ id: '1' }]);
  });

  it('converts error envelopes into ApiClientError', async () => {
    installAdapter({ '/projects/x': () => err(404, 'NOT_FOUND', 'Project not found') });
    const error = await api.get('/projects/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'Project not found' });
  });

  it('refreshes once for concurrent 401s and retries both requests', async () => {
    let refreshed = false;
    const { calls, log } = installAdapter({
      '/tasks/a': () => (refreshed ? ok({ id: 'a' }) : err(401, 'TOKEN_EXPIRED')),
      '/tasks/b': () => (refreshed ? ok({ id: 'b' }) : err(401, 'TOKEN_EXPIRED')),
      '/auth/refresh': () => {
        refreshed = true;
        return ok({ user: { id: 'u' } });
      },
    });

    const [a, b] = await Promise.all([api.get<{ id: string }>('/tasks/a'), api.get<{ id: string }>('/tasks/b')]);

    expect(a).toEqual({ id: 'a' });
    expect(b).toEqual({ id: 'b' });
    expect(calls['/auth/refresh']).toBe(1);
    expect(calls['/tasks/a']).toBe(2);
    expect(calls['/tasks/b']).toBe(2);
    expect(log.filter((l) => l.includes('/auth/refresh'))).toHaveLength(1);
  });

  it('clears the auth store and rejects when the refresh itself fails', async () => {
    const { calls } = installAdapter({
      '/tasks/a': () => err(401, 'TOKEN_EXPIRED'),
      '/auth/refresh': () => err(401, 'TOKEN_INVALID'),
    });
    const error = await api.get('/tasks/a').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 401, code: 'TOKEN_EXPIRED' });
    expect(calls['/auth/refresh']).toBe(1);
    expect(calls['/tasks/a']).toBe(1);
    expect(useAuthStore.getState().status).toBe('anon');
  });

  it('never tries to refresh for login or refresh routes', async () => {
    const { calls } = installAdapter({
      '/auth/login': () => err(401, 'UNAUTHORIZED', 'Invalid credentials'),
      '/auth/refresh': () => err(401, 'TOKEN_INVALID'),
    });
    await expect(api.post('/auth/login', {})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(api.post('/auth/refresh')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
    expect(calls['/auth/login']).toBe(1);
    expect(calls['/auth/refresh']).toBe(1);
  });

  it('does not refresh for a plain 401 on /auth/me (no session), so bootstrap resolves to anon', async () => {
    const { calls } = installAdapter({
      '/auth/me': () => err(401, 'UNAUTHORIZED'),
      '/auth/refresh': () => ok({}),
    });
    await expect(api.get('/auth/me')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(calls['/auth/refresh']).toBeUndefined();
  });

  it('exposes normalised validation details', () => {
    const e = new ApiClientError({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'Invalid',
      details: [{ path: ['body', 'email'], message: 'Invalid email' }, { path: 'name', message: 'Too short' }],
    });
    expect(e.validationDetails).toEqual([
      { path: 'body.email', message: 'Invalid email' },
      { path: 'name', message: 'Too short' },
    ]);
    vi.restoreAllMocks();
  });
});
