import { defineConfig, devices } from '@playwright/test';

const testSecret = 'sthstart-e2e-secret-0123456789abcdef';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run start:local', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI, timeout: 60_000,
    env: {
      ...process.env,
      STHSTART_ADMIN_TOKEN: testSecret,
      STHSTART_SESSION_SECRET: `${testSecret}-session`,
      STHSTART_DATABASE_PATH: './data/e2e-sthstart.db',
      STHSTART_NARRATIVE_DATABASE_PATH: './data/e2e-narrative.db',
    },
  },
});
