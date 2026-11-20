import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isOwnedDirectory } from './global-setup';

/*
 * C4 home and backup presentation coverage.
 *
 * Home reads real records from this run's isolated service database. Backup
 * responses are fixed fixtures and every mutating backup request is rejected:
 * these tests never create a vault, upload a snapshot or start a restore.
 */
test.use({ serviceWorkers: 'block' });

const portal = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const service = 'http://127.0.0.1:' + (process.env.E2E_SERVICE_PORT ?? 4200) + '/api/v1/admin';
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const STAMP = '2026-11-14T02:00:00.000Z';
const TARGET_ID = 'fixture-target-local';

type SeededHome = {
  projectTitle: string;
  projectId: string;
  activityTitle: string;
  activityId: string;
  noteTitle: string;
  noteId: string;
};

async function seedHome(request: APIRequestContext): Promise<SeededHome> {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
  const suffix = randomUUID().slice(0, 8);
  const create = async <T,>(path: string, data: object): Promise<T> => {
    const response = await request.post(service + path, { headers, data });
    expect(response.ok(), 'fixture: ' + path).toBe(true);
    return response.json() as Promise<T>;
  };

  const projectTitle = 'C4 首页项目-' + suffix;
  const project = await create<{ id: string }>('/story/projects', {
    title: projectTitle,
    summary: '首页最近工作使用的真实本地项目。',
  });
  await create('/story/projects/' + project.id + '/documents', {
    kind: 'chapter',
    title: '第一章 港灯',
    body: '潮声越过码头，记录被放进项目文件夹。',
  });

  const activityFixture = JSON.parse(readFileSync('packages/activity-playback/fixtures/rework_sample_v1.json', 'utf8'));
  const activityTitle = 'C4 首页活动-' + suffix;
  activityFixture.activity.title = activityTitle;
  const activity = await create<{ activity: { id: string } }>('/activities', { document: activityFixture });

  const noteTitle = 'C4 首页笔记-' + suffix;
  const note = await create<{ id: string }>('/notebook/notes', {
    title: noteTitle,
    kind: 'note',
    stage: 'reference',
    summary: '首页最近工作的真实笔记记录。',
    tags: ['C4'],
    content: [{ id: 'body', type: 'text', text: '首页应显示这条本地笔记。' }],
    knowledge: {
      schemaVersion: 1,
      nature: 'personal',
      authorship: 'handwritten',
      usage: 'reference',
      works: [],
      characters: [],
      locations: [],
      sources: [],
    },
  });

  return {
    projectTitle,
    projectId: project.id,
    activityTitle,
    activityId: activity.activity.id,
    noteTitle,
    noteId: note.id,
  };
}

function backupTarget() {
  return {
    id: TARGET_ID,
    kind: 'local_test',
    accountLabel: 'C4 隔离测试目录',
    rootPath: 'SthStart',
    vaultId: 'fixture-vault',
    connected: true,
    capabilities: { resumableUpload: true, delete: true, remoteChecksum: true, list: true },
    localDirectory: 'C:\\fixture\\backup',
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function backupSnapshot() {
  return {
    id: 'fixture-snapshot-01',
    vaultId: 'fixture-vault',
    scope: 'workspace',
    createdAt: STAMP,
    objectCount: 42,
    contentBytes: 1_048_576,
    uploadedBytes: 65_536,
    retained: false,
    publishedTargetIds: [TARGET_ID],
    missingCount: 0,
    description: '隔离 fixture：完整工作区快照。',
  };
}

function backupPlan() {
  return {
    id: 'fixture-plan-01',
    name: 'C4 每晚备份',
    scope: 'workspace',
    activityIds: [],
    works: [],
    targetIds: [TARGET_ID],
    frequency: 'daily',
    dailyTime: '03:00',
    timezone: 'Asia/Shanghai',
    nextRunAt: '2026-11-15T19:00:00.000Z',
    enabled: true,
    retainCount: 7,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function backupOverview() {
  const target = backupTarget();
  const snapshot = backupSnapshot();
  const plan = backupPlan();
  return {
    vault: {
      id: 'fixture-vault',
      formatVersion: 1,
      kdf: {
        algorithm: 'scrypt',
        salt: 'fixture-salt',
        N: 16384,
        r: 8,
        p: 1,
        keyLength: 32,
      },
      wrappedMasterKey: { algorithm: 'aes-256-gcm', nonce: 'fixture-nonce', ciphertext: 'fixture-ciphertext' },
      unlockPolicy: 'manual',
      rememberedOnDevice: false,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    unlocked: true,
    maintenance: { active: false, startedAt: null, label: null },
    targets: [target],
    plans: [plan],
    runs: [],
    snapshots: [snapshot],
    recoverable: [snapshot],
    lastRun: null,
    quarkReport: {
      status: 'unverified',
      cliPath: null,
      cliVersion: null,
      platform: 'win32',
      deleteSupported: false,
      items: [],
      notes: [],
      checkedAt: STAMP,
    },
    paths: {
      base: 'C:\\fixture\\backups',
      stagingRoot: 'C:\\fixture\\backups\\staging',
      objectDirectory: 'C:\\fixture\\backups\\objects',
      restoreRoot: 'C:\\fixture\\backups\\restore',
    },
  };
}

const RESTORE_PREVIEW = {
  preview: {
    snapshotId: 'fixture-snapshot-01',
    scope: 'workspace',
    createdAt: STAMP,
    activities: [],
    knowledgeNoteCount: 3,
    characterCount: 2,
    mediaCount: 1,
    contentBytes: 1_048_576,
    schemaVersion: 1,
    supported: true,
    exclusions: [],
    availableTargets: [TARGET_ID],
  },
};

async function installBackupRoutes(page: Page, options: { overviewFails?: boolean } = {}) {
  const requests: Array<{ method: string; path: string; body: string }> = [];

  await page.route('**/api/admin/backups/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    requests.push({ method, path, body: request.postData() ?? '' });

    if (path === '/api/admin/backups/overview' && method === 'GET') {
      if (options.overviewFails) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'fixture_unavailable', message: '备份服务暂时不可用。' }),
        });
        return;
      }
      await route.fulfill({ json: backupOverview() });
      return;
    }

    if (path === '/api/admin/backups/restore-preview' && method === 'GET') {
      await route.fulfill({ json: RESTORE_PREVIEW });
      return;
    }

    // Any write is deliberately refused before it can reach the isolated service.
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'fixture_read_only', message: '固定 fixture 不允许写备份数据。' }),
    });
  });

  return requests;
}

async function expectHydrated(page: Page) {
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
}

test.beforeEach(async ({ context }) => {
  const session = await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } });
  expect(session.ok()).toBe(true);
});

test('home recent work links the real project, activity and notebook records', async ({ page, request }) => {
  const seeded = await seedHome(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expectHydrated(page);

  await expect(page.getByRole('heading', { name: '工作台', level: 1 })).toBeVisible();
  const recent = page.getByRole('region', { name: '最近工作' });
  await expect(recent.getByRole('link', { name: /全部作品/ })).toHaveAttribute('href', '/apps/story-worlds');
  // 共享测试库里其他用例会并发写入；最近工作只取前 6 条，种子记录被挤出时重新读取一次。
  await expect(async () => {
    await page.reload();
    await expectHydrated(page);
    for (const title of [seeded.projectTitle, seeded.activityTitle, seeded.noteTitle]) {
      await expect(recent.getByRole('link', { name: new RegExp(title) })).toBeVisible({ timeout: 3_000 });
    }
  }).toPass({ timeout: 30_000 });

  const projectRow = recent.getByRole('link', { name: new RegExp(seeded.projectTitle) });
  const activityRow = recent.getByRole('link', { name: new RegExp(seeded.activityTitle) });
  const noteRow = recent.getByRole('link', { name: new RegExp(seeded.noteTitle) });
  await expect(projectRow).toHaveAttribute('href', '/apps/projects/' + seeded.projectId);
  await expect(activityRow).toHaveAttribute('href', '/apps/activities/' + seeded.activityId);
  await expect(noteRow).toHaveAttribute('href', '/apps/notebook/' + seeded.noteId);

  // The row's visible label carries the title, type and update time as one link name.
  await expect(projectRow).toContainText('项目');
  await expect(activityRow).toContainText('活动');
  await expect(noteRow).toContainText('笔记');
  await expect(projectRow.locator('time')).toHaveCount(1);

  // Keyboard focus reaches a real row, and Enter follows the same link.
  await projectRow.focus();
  await expect(projectRow).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp('/apps/projects/' + seeded.projectId + '$'));
});

test('home quick create exposes named actions, focus and the mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expectHydrated(page);

  const trigger = page.getByRole('button', { name: '新建创作', exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const menu = page.getByRole('menu', { name: '新建创作', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /新建作品/ })).toHaveAttribute('href', '/apps/story-worlds/new');
  await expect(menu.getByRole('menuitem', { name: /新建创作笔记/ })).toHaveAttribute('href', '/apps/notebook/new');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  const modules = page.getByRole('navigation', { name: '创作模块' });
  for (const [label, href] of [
    ['作品', '/apps/story-worlds'],
    ['角色库', '/apps/characters'],
    ['资料库', '/apps/resources'],
    ['媒体库', '/apps/media'],
  ] as const) {
    await expect(modules.getByRole('link', { name: new RegExp('^' + label) })).toHaveAttribute('href', href);
  }

  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
  await expect(page.getByRole('region', { name: '最近工作' })).toBeVisible();
  await expect(page.getByRole('region', { name: '近期日程' })).toBeVisible();
});

test('backup read failure is named and leaves the remaining settings tabs reachable', async ({ page }) => {
  await installBackupRoutes(page, { overviewFails: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/backups');
  await expectHydrated(page);

  await expect(page.getByRole('heading', { name: '云备份', level: 1 })).toBeVisible();
  const failure = page.getByRole('alert').filter({ hasText: '无法读取备份状态' });
  await expect(failure).toBeVisible();
  await expect(failure).toContainText('备份服务暂时不可用。');
  await expect(page.getByRole('button', { name: '立即备份', exact: true })).toBeEnabled();

  const settingsNav = page.getByRole('navigation', { name: '设置中心二级导航' });
  await expect(settingsNav.getByRole('link', { name: '数据备份' })).toHaveAttribute('aria-current', 'page');
  for (const label of ['模型与连接', '生成方案', '运行诊断', '调用记录', '数据备份']) {
    const link = settingsNav.getByRole('link', { name: label, exact: true });
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeInViewport();
  }

  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
});

test('backup history names the target and requires explicit workspace replacement confirmation', async ({ page }) => {
  const requests = await installBackupRoutes(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/settings/backups?tab=history');
  await expectHydrated(page);

  const tabs = page.getByRole('tablist', { name: '云备份分区' });
  await expect(tabs.getByRole('tab', { name: '备份历史' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: '备份版本', exact: true })).toBeVisible();
  await expect(page.getByText('1 个目标可恢复', { exact: true })).toBeVisible();

  const restoreTrigger = page.getByRole('button', { name: '从「C4 隔离测试目录」恢复', exact: true });
  await expect(restoreTrigger).toBeEnabled();
  await restoreTrigger.focus();
  await expect(restoreTrigger).toBeFocused();
  await restoreTrigger.click();

  const dialog = page.getByRole('dialog', { name: '恢复预览', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('范围：完整工作区');
  await expect(dialog).toContainText('来自「C4 隔离测试目录」');
  await expect(dialog.getByText('会替换当前工作区', { exact: true })).toBeVisible();

  const start = dialog.getByRole('button', { name: '开始恢复', exact: true });
  const confirmation = dialog.getByRole('checkbox', { name: '我确认要用这个版本替换当前工作区', exact: true });
  await expect(start).toBeDisabled();
  await expect(confirmation).not.toBeChecked();
  await confirmation.check();
  await expect(start).toBeEnabled();

  // Escape closes only the restore dialog and returns focus to its trigger.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(restoreTrigger).toBeFocused();

  const writes = requests.filter((entry) => entry.method !== 'GET');
  expect(writes, 'no backup mutation may be sent').toEqual([]);
});

test('backup plans expose labelled fields and cancel destructive deletion with focus returned', async ({ page }) => {
  const requests = await installBackupRoutes(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/settings/backups?tab=plans');
  await expectHydrated(page);

  const tabs = page.getByRole('tablist', { name: '云备份分区' });
  await tabs.getByRole('tab', { name: '备份计划' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: '备份历史' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.getByRole('tab', { name: '备份计划' })).toHaveAttribute('aria-selected', 'true');

  await expect(page.getByRole('heading', { name: '备份计划', exact: true })).toBeVisible();
  await expect(page.getByText('C4 每晚备份', { exact: true })).toBeVisible();
  await expect(page.getByText('已启用', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '名称' })).toHaveValue('云备份计划');
  await expect(page.getByRole('checkbox', { name: 'C4 隔离测试目录' })).toBeChecked();

  const deleteTrigger = page.getByRole('button', { name: '删除', exact: true });
  await deleteTrigger.click();
  const confirm = page.getByRole('dialog', { name: '删除备份计划“C4 每晚备份”', exact: true });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('云端已有的备份版本不会被删除');
  const cancel = confirm.getByRole('button', { name: '取消', exact: true });
  await expect(cancel).toBeFocused();
  await cancel.click();
  await expect(confirm).toBeHidden();
  await expect(deleteTrigger).toBeFocused();

  const writes = requests.filter((entry) => entry.method !== 'GET');
  expect(writes, 'cancelled deletion must not be sent').toEqual([]);
});
