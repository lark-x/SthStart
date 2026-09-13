import { defineConfig, devices } from '@playwright/test';

const testSecret = 'sthstart-e2e-secret-0123456789abcdef';
const portalPort = Number(process.env.E2E_PORTAL_PORT ?? 4273);
const servicePort = Number(process.env.E2E_SERVICE_PORT ?? 4200);
const portalUrl = `http://127.0.0.1:${portalPort}`;
const serviceUrl = `http://127.0.0.1:${servicePort}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  /*
   * 整套用例共用一个 portal 进程和一个 service 进程。默认按 CPU 一半（本机 20 核 → 10）
   * 并发时，多个浏览器同时做 SSR 与写库会把单进程后端压满，表现为「每轮只挂一条、
   * 且每次不是同一条」的假缺陷（创建活动拿不到详情路由、控制中心输入读不回、
   * 公共服务列表来不及刷新等）。降到 4 后全量稳定全绿，总时长没有变长（约 1.3 分钟），
   * 因为瓶颈本来就在后端而不是并行度。断言强度不变，只是不再让后端过载。
   */
  workers: 4,
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
