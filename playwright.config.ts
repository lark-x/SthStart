import { defineConfig, devices } from '@playwright/test';

const testSecret = 'sthstart-e2e-secret-0123456789abcdef';
const portalPort = Number(process.env.E2E_PORTAL_PORT ?? 4273);
const servicePort = Number(process.env.E2E_SERVICE_PORT ?? 4200);
const portalUrl = `http://127.0.0.1:${portalPort}`;
const serviceUrl = `http://127.0.0.1:${servicePort}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: portalUrl, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `npx vinext start --port ${portalPort} --hostname 127.0.0.1`,
      url: portalUrl,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        PORTAL_PORT: String(portalPort),
        STHSTART_SERVICE_URL: serviceUrl,
        NEXT_PUBLIC_STHSTART_SERVICE_URL: serviceUrl,
        STHSTART_ADMIN_TOKEN: testSecret,
        STHSTART_SESSION_SECRET: `${testSecret}-session`,
        PORTAL_ORIGINS: portalUrl,
        STHSTART_PUBLIC_ORIGINS: portalUrl,
      },
    },
    {
      command: 'npm run start:service',
      url: `${serviceUrl}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        SERVICE_PORT: String(servicePort),
        PORTAL_ORIGINS: portalUrl,
        STHSTART_ADMIN_TOKEN: testSecret,
        STHSTART_SESSION_SECRET: `${testSecret}-session`,
        STHSTART_DATABASE_PATH: './data/e2e-sthstart.db',
        STHSTART_NARRATIVE_DATABASE_PATH: './data/e2e-narrative.db',
      },
    },
  ],
});
