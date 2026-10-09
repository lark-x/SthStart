import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

const directory = mkdtempSync(join(tmpdir(), 'sthstart-browser-learning-'));
process.env.STHSTART_LEARNING_E2E_DIRECTORY = directory;
const portalPort = process.env.E2E_PORTAL_PORT ?? '4873';
const servicePort = process.env.E2E_SERVICE_PORT ?? '4800';
process.env.E2E_PORTAL_PORT = portalPort;
process.env.E2E_SERVICE_PORT = servicePort;
const portalUrl = `http://127.0.0.1:${portalPort}`;
const serviceUrl = `http://127.0.0.1:${servicePort}`;
const token = 'sthstart-e2e-secret-0123456789abcdef';
const env = { ...process.env, PORTAL_PORT: portalPort, SERVICE_PORT: servicePort,
  STHSTART_SERVICE_URL: serviceUrl, NEXT_PUBLIC_STHSTART_SERVICE_URL: serviceUrl,
  PORTAL_ORIGINS: portalUrl, STHSTART_PUBLIC_ORIGINS: portalUrl,
  STHSTART_ADMIN_TOKEN: token, STHSTART_SESSION_SECRET: `${token}-session`,
  STHSTART_DATABASE_PATH: join(directory, 'service.db'), STHSTART_NARRATIVE_DATABASE_PATH: join(directory, 'narrative.db'),
  STHSTART_ARTIFACT_DIR: join(directory, 'media'), STHSTART_LOG_DIR: join(directory, 'logs'),
  STHSTART_LAN_ACCESS: 'false' };

export default defineConfig({
  testDir: join(projectRoot, 'tests/e2e'), testMatch: 'learning-story.spec.ts', workers: 1, retries: 0, timeout: 45000,
  outputDir: join(projectRoot, 'test-results/learning'), reporter: [['list'], ['html', { outputFolder: join(projectRoot, 'playwright-report/learning'), open: 'never' }]],
  use: { baseURL: portalUrl, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { cwd: projectRoot, command: `npx vinext start --port ${portalPort} --hostname 127.0.0.1`, url: portalUrl, env, reuseExistingServer: false, timeout: 60000 },
    { cwd: projectRoot, command: 'node --import tsx/esm apps/service/src/start.ts', url: `${serviceUrl}/api/v1/health`, env, reuseExistingServer: false, timeout: 60000 },
  ],
  globalTeardown: join(projectRoot, 'tests/e2e/learning-teardown.ts'),
});
