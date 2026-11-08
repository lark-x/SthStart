import base from '../../playwright.config';
import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
// 默认沿用主配置本轮的临时目录，跑完一起删除；显式给出 E2E_REWORK_DIRECTORY 时保留供排查。
const directory = process.env.E2E_REWORK_DIRECTORY || process.env.STHSTART_E2E_DIRECTORY!;
process.env.E2E_REWORK_DIRECTORY = directory;
process.env.E2E_REWORK_DATABASE_PATH = join(directory, 'service.db');
const servers = Array.isArray(base.webServer) ? base.webServer : base.webServer ? [base.webServer] : [];
export default defineConfig({
  ...base,
  testDir: join(projectRoot, 'tests/e2e'),
  outputDir: join(projectRoot, 'test-results'),
  testMatch: 'activity-rework.spec.ts',
  workers: 1,
  globalSetup: join(projectRoot, 'tests/e2e/global-setup.ts'),
  webServer: servers.map(server => ({
    ...server,
    cwd: projectRoot,
    env: {
      ...server.env,
      STHSTART_DATABASE_PATH: process.env.E2E_REWORK_DATABASE_PATH!,
      STHSTART_NARRATIVE_DATABASE_PATH: join(directory, 'narrative.db'),
      STHSTART_ARTIFACT_DIR: join(directory, 'artifacts'),
      STHSTART_LOG_DIR: join(directory, 'logs'),
    },
  })),
});
