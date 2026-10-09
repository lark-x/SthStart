import base from '../../playwright.config';
import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const directory = process.env.E2E_REWORK_DIRECTORY || mkdtempSync(join(tmpdir(), 'sthstart-rework-ui-'));
process.env.E2E_REWORK_DIRECTORY = directory;
process.env.E2E_REWORK_DATABASE_PATH = join(directory, 'service.db');
const servers = Array.isArray(base.webServer) ? base.webServer : base.webServer ? [base.webServer] : [];
export default defineConfig({
  ...base,
  testDir: join(projectRoot, 'tests/e2e'),
  outputDir: join(projectRoot, 'test-results'),
  testMatch: 'activity-rework.spec.ts',
  workers: 1,
  webServer: servers.map(server => ({
    ...server,
    cwd: projectRoot,
    env: {
      ...server.env,
      STHSTART_DATABASE_PATH: process.env.E2E_REWORK_DATABASE_PATH!,
      STHSTART_NARRATIVE_DATABASE_PATH: join(directory, 'narrative.db'),
      STHSTART_ARTIFACT_DIR: join(directory, 'artifacts'),
    },
  })),
});
