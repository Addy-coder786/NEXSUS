import './health.env';
import { envSchema, productionChecks } from '../src/config/env';
import { api, createTestUser } from './helpers';

describe('health endpoints', () => {
  it('reports liveness and readiness without auth', async () => {
    const live = await api().get('/api/health');
    expect(live.status).toBe(200);
    expect(live.body.data.status).toBe('ok');

    const ready = await api().get('/api/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.data).toEqual({ status: 'ready', checks: { mongo: true, redis: null } });
  });

  it('serves Prometheus metrics only with the bearer token', async () => {
    const user = await createTestUser();
    await api().get('/api/users/me').set('Cookie', user.cookie);

    expect((await api().get('/api/metrics')).status).toBe(401);
    expect((await api().get('/api/metrics').set('Authorization', 'Bearer wrong-token-wrong-token')).status).toBe(401);
    const res = await api().get('/api/metrics').set('Authorization', 'Bearer metrics-token-for-tests-0001');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('nexus_http_requests_total{method="GET",route="/api/users/me",status="2xx"}');
    expect(res.text).toContain('nexus_mongo_connected 1');
  });
});

describe('production configuration checks', () => {
  const base = {
    NODE_ENV: 'production',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    ENCRYPTION_KEY: 'c'.repeat(64),
    CLIENT_URL: 'https://app.example.com',
  };
  const parse = (overrides: Record<string, string | undefined>) => envSchema.superRefine(productionChecks).safeParse({ ...base, ...overrides });
  const paths = (r: ReturnType<typeof parse>) => (r.success ? [] : r.error.issues.map((i) => i.path.join('.')));

  it('accepts a sound production config, including a localhost deployment over http', () => {
    expect(parse({}).success).toBe(true);
    expect(parse({ CLIENT_URL: 'http://localhost:8080' }).success).toBe(true);
  });

  it('rejects missing encryption, plain http and example or shared secrets', () => {
    expect(paths(parse({ ENCRYPTION_KEY: undefined }))).toContain('ENCRYPTION_KEY');
    expect(paths(parse({ CLIENT_URL: 'http://app.example.com' }))).toContain('CLIENT_URL');
    expect(paths(parse({ JWT_ACCESS_SECRET: 'change-me-to-a-long-random-string-at-least-32-chars' }))).toContain('JWT_ACCESS_SECRET');
    expect(paths(parse({ JWT_REFRESH_SECRET: 'a'.repeat(48) }))).toContain('JWT_REFRESH_SECRET');
  });
});
