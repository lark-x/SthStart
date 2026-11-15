import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const portal = 'http://127.0.0.1:4983';
const service = 'http://127.0.0.1:4984';
const env = {
  ...process.env,
  PORTAL_PORT: '4983',
  SERVICE_PORT: '4984',
  STHSTART_SERVICE_URL: service,
  NEXT_PUBLIC_STHSTART_SERVICE_URL: service,
  STHSTART_ADMIN_TOKEN: 'story-worlds-isolated-e2e-admin-token-4974',
  STHSTART_SESSION_SECRET: 'story-worlds-isolated-e2e-session-token-4973',
  PORTAL_ORIGINS: portal,
  STHSTART_PUBLIC_ORIGINS: portal,
};

export default defineConfig({
  testDir: fileURLToPath(new URL('../e2e', import.meta.url)),
  testMatch: ['world-authoring.spec.ts', 'shell-layout.spec.ts'],
  workers: 1,
  outputDir: fileURLToPath(new URL('../../test-results/world-authoring', import.meta.url)),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: portal,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    deviceScaleFactor: 2,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 2 } },
    ...(process.env.STHSTART_E2E_WEBKIT === '1'
      ? [{ name: 'webkit', use: { ...devices['Desktop Safari'], deviceScaleFactor: 2 } }]
      : []),
  ],
  webServer: [
    {
      command: 'npx vinext start --port 4983 --hostname 127.0.0.1',
      cwd: root,
      url: portal,
      env,
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: 'node --import tsx/esm scripts/testing/world-authoring-service.ts',
      cwd: root,
      url: `${service}/api/v1/health`,
      env,
      reuseExistingServer: false,
      timeout: 90_000,
    },
  ],
});
