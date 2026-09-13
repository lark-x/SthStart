import { defineConfig } from '@playwright/test';
import path from 'node:path';
import baseConfig from '../../playwright.config';

/*
 * 计划 §13 第 4 条要求「代表页面同条件前后对照图」。
 *
 * 关键点：Playwright 的 webServer 会用 `vinext start` 服务 **cwd 下的 dist**，
 * 光换容器里的产物是没用的。因此这里把服务进程的工作目录做成显式输入：
 *   CAPTURE_SERVER_CWD 指向哪个检出，就截哪个构建。
 * 数据库路径强制指向主仓库的同一份 e2e 库，保证前后两次是同一份数据。
 *
 * 用法（前后各跑一次）：
 *   $env:CAPTURE_OUT='...'; $env:CAPTURE_TAG='after'
 *   $env:CAPTURE_SERVER_CWD='F:\Project\SthStart'
 *   npx playwright test --config tests/capture/playwright.config.ts
 */

// 配置以 ESM 载入，__dirname 不可用；采集命令固定从主仓库根执行。
const mainRepo = process.cwd();
const serverCwd = process.env.CAPTURE_SERVER_CWD
  ? path.resolve(process.env.CAPTURE_SERVER_CWD)
  : mainRepo;

// 前后两版共用同一份 e2e 数据库，避免「不同数据」导致的假差异。
const dataDir = path.join(mainRepo, 'data');

const baseServers = baseConfig.webServer
  ? Array.isArray(baseConfig.webServer)
    ? baseConfig.webServer
    : [baseConfig.webServer]
  : [];

export default defineConfig({
  testDir: path.resolve(mainRepo, 'tests', 'capture'),
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: baseConfig.use?.baseURL, trace: 'off' },
  projects: [{ name: 'chromium', use: { ...baseConfig.projects?.[0]?.use } }],
  /*
   * 只切换「前端构建」这一个变量：portal 进程按 CAPTURE_SERVER_CWD 走，
   * service 始终用主仓库那一个实例，前后两次共用同一份后端与同一份数据。
   */
  webServer: baseServers.map((server: (typeof baseServers)[number]) => ({
    ...server,
    cwd: typeof server.command === 'string' && server.command.includes('start:service')
      ? mainRepo
      : serverCwd,
    env: {
      ...server.env,
      STHSTART_DATABASE_PATH: path.join(dataDir, 'e2e-sthstart.db'),
      STHSTART_NARRATIVE_DATABASE_PATH: path.join(dataDir, 'e2e-narrative.db'),
    },
  })),
});
