import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E2E_DIRECTORY_PREFIX } from './tests/e2e/global-setup';

const testSecret = 'sthstart-e2e-secret-0123456789abcdef';
const portalPort = Number(process.env.E2E_PORTAL_PORT ?? 4273);
const servicePort = Number(process.env.E2E_SERVICE_PORT ?? 4200);
const portalUrl = `http://127.0.0.1:${portalPort}`;
const serviceUrl = `http://127.0.0.1:${servicePort}`;

/*
 * 用例每轮都会新建带随机后缀的连接、模型、活动等记录。数据库、媒体和日志全部放进
 * 本轮专用的临时目录，跑完由 tests/e2e/global-setup.ts 删除，不再写进 data/。
 * worker 进程也会载入本配置，所以目录经环境变量传下去，整轮只建一个。
 */
const dataDirectory = process.env.STHSTART_E2E_DIRECTORY || mkdtempSync(join(tmpdir(), E2E_DIRECTORY_PREFIX));
process.env.STHSTART_E2E_DIRECTORY = dataDirectory;

export default defineConfig({
  testDir: './tests/e2e',
  // 这几份依赖专用的模拟服务或独立数据目录，分别由 tests/config 下的 comfy、learning 配置运行。
  testIgnore: ['comfy-image-experience.spec.ts', 'comfy-business-contexts.spec.ts', 'learning-story.spec.ts'],
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
  globalSetup: './tests/e2e/global-setup.ts',
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
        STHSTART_DATABASE_PATH: join(dataDirectory, 'service.db'),
        STHSTART_NARRATIVE_DATABASE_PATH: join(dataDirectory, 'narrative.db'),
        STHSTART_ARTIFACT_DIR: join(dataDirectory, 'artifacts'),
        STHSTART_LOG_DIR: join(dataDirectory, 'logs'),
        STHSTART_LAN_ACCESS: 'false',
      },
    },
  ],
});
