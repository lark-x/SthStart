import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  testDir: fileURLToPath(new URL('../e2e', import.meta.url)),
  testMatch: ['comfy-image-experience.spec.ts', 'comfy-business-contexts.spec.ts'],
  outputDir: fileURLToPath(new URL('../../test-results/comfy', import.meta.url)),
  timeout: 60000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4373', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Creative tests mock browser responses; business context tests use an isolated temporary service.
  webServer: [{
    command: 'npx vinext dev --port 4373 --hostname 127.0.0.1', cwd: root,
    url: 'http://127.0.0.1:4373', timeout: 90000, reuseExistingServer: false,
    env: { STHSTART_SERVICE_URL: 'http://127.0.0.1:4374', STHSTART_ADMIN_TOKEN: 'comfy-ui-offline-token-0123456789' },
  }, { command: 'node --import tsx/esm scripts/testing/comfy-ui-service.ts', cwd: root,
    url: 'http://127.0.0.1:4374/api/v1/health', timeout: 60000, reuseExistingServer: false }],
});
