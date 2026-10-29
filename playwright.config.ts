import { defineConfig, devices } from '@playwright/test';
import { API_PORT, WEB_PORT } from './e2e/ports.mjs';

/**
 * End-to-end tests against the real API and web app. `e2e/stack.mjs` starts an in-memory
 * MongoDB, a mock Anthropic API and the API server; Vite serves the web app and proxies to it.
 */
export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/stack.mjs',
      url: `http://127.0.0.1:${API_PORT}/api/health/ready`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
    },
    {
      command: `npm run dev -w @nexus/web -- --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: { VITE_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`, VITE_API_URL: '' },
    },
  ],
});
