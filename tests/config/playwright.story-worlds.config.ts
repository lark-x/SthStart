import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const env = { ...process.env, STHSTART_SERVICE_URL: 'http://127.0.0.1:4974', NEXT_PUBLIC_STHSTART_SERVICE_URL: 'http://127.0.0.1:4974',
  STHSTART_ADMIN_TOKEN: 'story-worlds-isolated-e2e-admin-token-4974', STHSTART_SESSION_SECRET: 'story-worlds-isolated-e2e-session-token-4973',
  PORTAL_ORIGINS: 'http://127.0.0.1:4973', STHSTART_PUBLIC_ORIGINS: 'http://127.0.0.1:4973' };
export default defineConfig({
  testDir: fileURLToPath(new URL('../e2e', import.meta.url)), testMatch: ['story-worlds.spec.ts', 'story-worlds-extended.spec.ts', 'story-worlds-source-updates.spec.ts'], workers: 1,
  outputDir: fileURLToPath(new URL('../../test-results/story-worlds', import.meta.url)), timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:4973', trace: 'retain-on-failure', deviceScaleFactor: 2 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 2 } }],
  webServer: [
    { command: 'npx vinext start --port 4973 --hostname 127.0.0.1', cwd: root, url: 'http://127.0.0.1:4973', env, reuseExistingServer: false, timeout: 60000 },
    { command: 'node --import tsx/esm scripts/testing/story-worlds-service.ts', cwd: root, url: 'http://127.0.0.1:4974/api/v1/health', env, reuseExistingServer: false, timeout: 60000 },
  ],
});
