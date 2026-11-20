import { expect, test } from '@playwright/test';
import type { RuntimeOverview } from '@sthstart/contracts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// These screenshots rely on deterministic route fixtures. The real offline
// worker and an offline reload are covered in offline-and-mobile.spec.ts.
test.use({ serviceWorkers: 'block' });

let browserErrors: string[] = [];
let expectedAdminSessionProbes = 0;

test.beforeEach(({ page }) => {
  browserErrors = [];
  expectedAdminSessionProbes = 0;
  page.on('response', (response) => {
    if (response.url().includes('/api/auth/admin-session') && response.status() === 401) {
      expectedAdminSessionProbes += 1;
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    browserErrors.push(`pageerror: ${error.message}`);
  });
});

test.afterEach(() => {
  const unexpectedErrors = browserErrors.filter((message) => {
    if (message === 'console: Failed to load resource: the server responded with a status of 401 (Unauthorized)' && expectedAdminSessionProbes > 0) {
      expectedAdminSessionProbes -= 1;
      return false;
    }
    return true;
  });
  expect(unexpectedErrors, unexpectedErrors.join('\n')).toEqual([]);
});

const screenshotOptions = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  mask: undefined,
  /*
   * 工作台的运行状态条会持续轮询并触发重渲染，全量并发跑时 CPU 争用明显。
   * 默认 5 秒的“两帧一致”窗口不够，放宽到 15 秒；像素比较本身仍然生效。
   */
  timeout: 15_000,
};

/*
 * 视觉基线不能依赖测试库里的累积数据：全量并发跑时其他用例会不断新建项目、笔记与活动，
 * 最近工作行数、笔记列表条数都会随执行顺序变化，整页截图高度也就跟着漂移。
 * 这里把列表类接口拦截为固定数据，并把页面时钟固定在同一时刻，
 * 问候语、日期与「更新于」时间都只由这份固定输入决定。
 */
const FIXED_NOW = new Date('2026-10-15T10:30:00+08:00');

const RECENT_WORK_FIXTURE = {
  items: [
    { id: 'visual-story', title: '枫丹雨夜篇章', kind: 'story', updatedAt: '2026-10-15T01:20:00.000Z' },
    { id: 'visual-activity', title: '秋日茶会互动', kind: 'activity', updatedAt: '2026-10-14T09:00:00.000Z' },
    { id: 'visual-note', title: '港口城市的世界观笔记', kind: 'note', updatedAt: '2026-10-13T12:45:00.000Z' },
    { id: 'visual-character', title: '芙宁娜', kind: 'character', updatedAt: '2026-10-12T08:10:00.000Z' },
    { id: 'visual-publication', title: '第一章分镜制作', kind: 'publication', updatedAt: '2026-10-11T15:30:00.000Z' },
    { id: 'visual-story-2', title: '沙海遗迹调查', kind: 'story', updatedAt: '2026-10-10T03:05:00.000Z' },
    { id: 'visual-note-2', title: '角色口癖摘录', kind: 'note', updatedAt: '2026-10-09T11:00:00.000Z' },
    { id: 'visual-character-2', title: '那维莱特', kind: 'character', updatedAt: '2026-10-08T06:40:00.000Z' },
  ],
};

const CALENDAR_FIXTURE = {
  from: '2026-10-15',
  to: '2026-11-29',
  events: [
    { id: 'visual-birthday-1', kind: 'birthday', date: '2026-10-18', title: '芙宁娜 生日', characterName: '芙宁娜' },
    { id: 'visual-activity-1', kind: 'activity', date: '2026-10-21', title: '秋日茶会互动', participantCount: 3 },
    { id: 'visual-birthday-2', kind: 'birthday', date: '2026-10-30', title: '那维莱特 生日', characterName: '那维莱特' },
    { id: 'visual-activity-2', kind: 'activity', date: '2026-11-08', title: '第一章分镜制作', participantCount: 2 },
    { id: 'visual-activity-3', kind: 'activity', date: '2026-11-20', title: '沙海遗迹调查', participantCount: 4 },
  ],
};

const NOTEBOOK_LIST_FIXTURE = {
  items: [
    { id: 'visual-note-a', title: '港口城市的世界观笔记', kind: 'world', summary: '潮汐、码头与旧灯塔的设定。', content: [], tags: ['世界'], stage: 'reference', favorite: true, revision: 1, createdAt: '2026-10-10T08:00:00.000Z', updatedAt: '2026-10-13T12:45:00.000Z' },
    { id: 'visual-note-b', title: '角色口癖摘录', kind: 'character', summary: '对话里反复出现的语气词。', content: [], tags: ['角色'], stage: 'draft', favorite: false, revision: 1, createdAt: '2026-10-08T08:00:00.000Z', updatedAt: '2026-10-09T11:00:00.000Z' },
  ],
  total: 2,
  page: 1,
  pageSize: 50,
};

const RUNTIME_OVERVIEW_FIXTURE = {
  services: [
    { id: 'linshe', name: '邻舍核心', port: 3099, optional: false, installed: true, state: 'stopped', pid: null, startedAt: null, message: null, managed: true },
    { id: 'vector', name: '向量服务', port: 3102, optional: true, installed: true, state: 'stopped', pid: null, startedAt: null, message: null, managed: true },
  ],
  settings: { autoStart: false, autoOpenBrowser: false, useMirror: false, publicLlmEnabled: false, linsheImageViaGateway: false, comfyuiExecutable: '', extraLoraFolders: [], maibotAutostart: false, maibotBrowserMaibot: false, maibotBrowserSnowluma: false, creative: {} },
  linsheLlm: { enabled: true, textProfileId: null, textModel: null, multimodalProfileId: null, multimodalModel: null, ready: false },
  linsheHosted: { ready: false, missing: ['未绑定文本模型'], appTokenValid: true, llmTextReady: false, llmMultimodalReady: false, vectorReady: true, vectorMode: 'default', imageReady: false, imagePurpose: 'linshe-chat-image', imageWorkflowId: null, imageWorkflowVersion: null },
  logPolicy: { globalLevel: 'info', serviceLevels: {}, retentionDays: 7, maxBytes: 1024, sensitiveUntil: null, diagnosticUntil: null },
  recentErrors: 0,
  droppedLogs: 0,
} satisfies RuntimeOverview;

async function useFixedDashboardData(page: import('@playwright/test').Page) {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route(/\/api\/admin\/workspace\/recent(?:\?|$)/, (route) => route.fulfill({ json: RECENT_WORK_FIXTURE }));
  await page.route(/\/api\/admin\/calendar(?:\?|$)/, (route) => route.fulfill({ json: CALENDAR_FIXTURE }));
}

/**
 * 截图前等载入态结束：最近工作按首页的 HOME_RECENT_LIMIT（6）截断、近期日程按 limit=5 截断，
 * 两块列表都达到固定行数后画面高度才确定；骨架行期间 role=status 仍在无障碍树中。
 */
async function waitForDashboardSettled(page: import('@playwright/test').Page) {
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('recent-work-list').getByRole('listitem')).toHaveCount(6, { timeout: 15_000 });
  await expect(page.getByTestId('upcoming-schedule-list').getByRole('listitem')).toHaveCount(5, { timeout: 15_000 });
  // 模块卡数量来自真实库，内容已按 data-visual-dynamic 遮罩；这里只等它们不再是加载前的说明文案。
  await expect(page.getByRole('navigation', { name: '创作模块' }).getByRole('link')).toHaveCount(4);
  // 服务状态条先显示「正在获取服务状态」，取到结果后才稳定。
  await expect(page.getByRole('region', { name: '本地服务状态' })).not.toContainText('正在获取服务状态', { timeout: 15_000 });
}

/** 控制中心在首个 overview 返回前，会在分区内容上方插入一块加载骨架。 */
async function waitForControlCenterLoaded(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { name: '控制中心', level: 1 })).toBeVisible();
  await expect(page.getByLabel('正在加载运行控制中心')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText('服务通讯异常')).toHaveCount(0);
}

/** 页面本身不得横向溢出；失败时直接给出超宽元素，而不是只报像素差异。 */
async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth + 1) return null;
    const offenders = Array.from(document.querySelectorAll('*'))
      .filter((el) => el.getBoundingClientRect().width > doc.clientWidth + 1)
      .map((el) => `${el.tagName}.${(el.className ?? '').toString().slice(0, 60)}`)
      .slice(0, 5)
      .join(', ');
    return `${doc.scrollWidth} > ${doc.clientWidth}：${offenders}`;
  });
  expect(overflow).toBeNull();
}

/*
 * 首页已不再放「全部应用」目录：问候 + 新建入口、四个创作模块卡、最近工作与近期日程。
 * 主标题对读屏是「工作台」，可见文字是按时间生成的问候语（已遮罩）。
 */
test('portal desktop visual baseline', async ({ page }) => {
  await useFixedDashboardData(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '工作台', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近工作' })).toBeVisible();
  await waitForDashboardSettled(page);
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot('portal-desktop.png', {
    ...screenshotOptions,
    fullPage: true,
    mask: [page.locator('[data-visual-dynamic]')],
    maskColor: '#f1ece2',
  });
});

test('portal mobile visual baseline', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useFixedDashboardData(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '工作台', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近工作' })).toBeVisible();
  await waitForDashboardSettled(page);
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot('portal-mobile.png', {
    ...screenshotOptions,
    fullPage: true,
    mask: [page.locator('[data-visual-dynamic]')],
    maskColor: '#f1ece2',
  });
});

test('control center overview visual baseline', async ({ page }) => {
  await page.route(/\/api\/admin\/runtime\/overview(?:\?|$)/, (route) => route.fulfill({ json: RUNTIME_OVERVIEW_FIXTURE }));
  await page.goto('/settings/control-center');
  // 页标题改为「控制中心」；运行总览面板标题为「邻舍运行栈」。
  await waitForControlCenterLoaded(page);
  await expect(page.getByRole('tab', { name: '运行总览' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: '邻舍运行栈' })).toBeVisible();
  await expect(page.getByText('运行栈状态')).toBeVisible();
  await expect(page.getByText('未绑定文本模型', { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot('control-center-overview.png', {
    ...screenshotOptions,
    fullPage: false,
  });
});

test('control center logs visual baseline', async ({ page }) => {
  await page.goto('/settings/control-center?tab=logs');
  await waitForControlCenterLoaded(page);
  await expect(page.getByRole('tab', { name: '实时日志' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByPlaceholder('搜索日志内容…')).toBeVisible();
  await expect(page.getByText('LIVE STREAM')).toBeVisible();
  await expect(page).toHaveScreenshot('control-center-logs.png', {
    ...screenshotOptions,
    fullPage: true,
    mask: [page.locator('[data-visual-dynamic]')],
    maskColor: '#18201d',
  });
});

test('character editor visual baseline', async ({ page }) => {
  await page.goto('/apps/characters/new');
  // 新建档案保留编辑表单；人设、外貌生图与图片皮肤共用三个分段。
  await expect(page.getByRole('heading', { name: '新建角色档案', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: '人设演绎' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('角色名称')).toBeVisible();
  // 新建页已不再放「视觉预览」侧栏，改为等人设分段的最后一个字段渲染完成。
  await expect(page.getByLabel('详细人设背景')).toBeVisible();
  await expect(page).toHaveScreenshot('character-editor.png', {
    ...screenshotOptions,
    fullPage: true,
  });
});

test('notebook visual baseline', async ({ page }) => {
  // 左侧资料列表默认展开，条目来自测试库；拦截为固定两条，避免随其他用例新建的笔记漂移。
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route(/\/api\/admin\/notebook\/notes(?:\?|$)/, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: NOTEBOOK_LIST_FIXTURE }) : route.fallback());
  await page.goto('/apps/notebook/new');
  // 标题与元信息改为文档头内联编辑，旧的「编辑资料」浮层按钮已移除。
  await expect(page.getByRole('heading', { name: '创作笔记', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: '文档标题与元信息' }).getByPlaceholder('无标题笔记')).toBeVisible();
  await expect(page.getByRole('region', { name: '笔记正文' }).getByPlaceholder('写下一段文字记录…')).toBeVisible();
  await expect(page.locator('.notebook-master-list .notebook-list-item')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.getByRole('navigation', { name: '分页', exact: true })).toContainText('共 2 条');
  await expect(page).toHaveScreenshot('notebook.png', {
    ...screenshotOptions,
    fullPage: true,
  });
});

test('narrative visual baseline', async ({ page }) => {
  await page.goto('/apps/narrative');
  await page.getByRole('tab', { name: '数据源与导入' }).click();
  await expect(page.getByRole('tab', { name: '数据源与导入' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('规范化剧情 JSON 工作台')).toBeVisible();
  /*
   * 连接器来自异步查询，初始是空数组。不等待就会截到“还没有连接器卡片”的
   * 半加载状态，让基线随请求时序漂移。这里等两张卡片都渲染出来再截图。
   */
  await expect(page.getByTestId('narrative-connectors').locator('> div')).toHaveCount(2, { timeout: 15_000 });
  await expect(page).toHaveScreenshot('narrative.png', {
    ...screenshotOptions,
    fullPage: true,
  });
});

/*
 * 页面原型基线（前端视觉计划 P0）：首页、制作项目、制作工作台、角色库、作品目录、资料库、媒体库、设置，
 * 各取暖白（light-paper）与暖夜（dark-espresso）。
 *
 * 全量并发跑时其他用例会持续往共享测试库写数据，列表与计数随执行顺序漂移。这里把页面用到的
 * /api/admin/* 响应录成 HAR，回放时只读 HAR；未录到的请求才回落到真实服务。页面时钟固定在录制时刻，
 * 「x 小时前」之类的相对时间也随之固定。
 *
 * 重新录制（页面改动导致接口变化时）：
 *   STHSTART_VISUAL_RECORD=1 npx playwright test tests/e2e/visual.spec.ts -g "record page archetype fixtures"
 * 然后再用 --update-snapshots 生成截图，并在交付记录里写明原因。
 */
const FIXTURE_DIR = 'tests/e2e/visual-fixtures';
const MANIFEST_PATH = `${FIXTURE_DIR}/manifest.json`;
const RECORDING = process.env.STHSTART_VISUAL_RECORD === '1';
const ARCHETYPE_THEMES = ['light-paper', 'dark-espresso'] as const;
const servicePort = process.env.E2E_SERVICE_PORT ?? 4200;
const serviceAdmin = `http://127.0.0.1:${servicePort}/api/v1/admin`;
const portalOrigin = 'http://127.0.0.1:' + (process.env.E2E_PORTAL_PORT ?? 4273);
const serviceHeaders = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };

type ArchetypeManifest = { recordedAt: string; activityId: string };
type ArchetypePage = { id: string; heading: RegExp | string; path: (manifest: ArchetypeManifest) => string; fullPage: boolean };

const ARCHETYPE_PAGES: ArchetypePage[] = [
  { id: 'activities', heading: /.+/, path: () => '/apps/activities', fullPage: true },
  { id: 'activity-workbench', heading: /.+/, path: manifest => `/apps/activities/${manifest.activityId}`, fullPage: false },
  { id: 'characters', heading: /.+/, path: () => '/apps/characters', fullPage: true },
  { id: 'story-worlds', heading: '作品', path: () => '/apps/story-worlds', fullPage: true },
  { id: 'resources', heading: /.+/, path: () => '/apps/resources', fullPage: false },
  { id: 'media', heading: /.+/, path: () => '/apps/media', fullPage: true },
  { id: 'settings', heading: /.+/, path: () => '/settings/public-services', fullPage: true },
];

const harPath = (id: string) => `${FIXTURE_DIR}/${id}.har`;

/** 回放只按方法与 URL 匹配；去掉请求头、Cookie 和多余响应头，不把会话凭据写进仓库。 */
function scrubHar(file: string) {
  const har = JSON.parse(readFileSync(file, 'utf8')) as { log: { entries: Array<{ request: { headers: unknown[]; cookies: unknown[] }; response: { headers: Array<{ name: string; value: string }>; cookies: unknown[] } }> } };
  for (const entry of har.log.entries) {
    entry.request.headers = [];
    entry.request.cookies = [];
    entry.response.cookies = [];
    entry.response.headers = entry.response.headers.filter(header => header.name.toLowerCase() === 'content-type');
  }
  writeFileSync(file, JSON.stringify(har, null, 2) + '\n');
}

async function seedArchetypeFixtures(request: import('@playwright/test').APIRequestContext): Promise<ArchetypeManifest> {
  const create = async <T,>(path: string, data: object): Promise<T> => {
    const response = await request.post(serviceAdmin + path, { headers: serviceHeaders, data });
    expect(response.ok(), 'fixture: ' + path).toBe(true);
    return response.json();
  };
  const project = await create<{ id: string }>('/story/projects', { title: '港口来信', summary: '守灯人与末班船的故事。' });
  await create('/story/projects/' + project.id + '/documents', { kind: 'chapter', title: '海边来信', body: '潮水退去。\n\n灯塔亮起。' });
  for (const [name, work] of [['林舟', '港口来信'], ['苏禾', '港口来信'], ['遥音', '样本作品']]) {
    await create('/characters', { displayName: name, tags: ['基线'], draft: { displayName: name, work } });
  }
  await create('/notebook/notes', {
    title: '港口城市的世界观笔记', kind: 'note', stage: 'reference', summary: '潮汐、码头与旧灯塔的设定。', tags: ['世界'],
    content: [{ id: 'body', type: 'text', text: '旧灯塔每晚八点亮起。' }],
    knowledge: { schemaVersion: 1, nature: 'personal', authorship: 'handwritten', usage: 'reference', works: [], characters: [], locations: [], sources: [] },
  });
  const activity = await create<{ activity: { id: string } }>('/activities', {
    document: JSON.parse(readFileSync('packages/activity-playback/fixtures/rework_sample_v1.json', 'utf8')),
  });
  return { recordedAt: new Date().toISOString(), activityId: activity.activity.id };
}

async function preparePage(page: import('@playwright/test').Page, theme: string) {
  expect((await page.request.post('/api/auth/admin-session', { headers: { origin: portalOrigin } })).ok()).toBe(true);
  await page.addInitScript(id => { if (location.protocol === 'http:') localStorage.setItem('sthstart_theme_id', id); }, theme);
}

async function waitForArchetypeSettled(page: import('@playwright/test').Page, theme: string, heading: RegExp | string) {
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true', { timeout: 15_000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.getByRole('main').first().getByRole('heading', { level: 1, name: heading }).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await expect(page.locator('.skeleton-shimmer, [aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

test.describe('page archetype baselines', () => {
  test('record page archetype fixtures', async ({ browser, request }) => {
    test.skip(!RECORDING, 'Set STHSTART_VISUAL_RECORD=1 to re-record the archetype API fixtures.');
    test.setTimeout(240_000);
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const manifest = await seedArchetypeFixtures(request);
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
    for (const archetype of ARCHETYPE_PAGES) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      await context.routeFromHAR(harPath(archetype.id), { url: /\/api\/admin\//, update: true, updateContent: 'embed', updateMode: 'minimal' });
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date(manifest.recordedAt));
      await preparePage(page, 'light-paper');
      await page.goto(archetype.path(manifest));
      await waitForArchetypeSettled(page, 'light-paper', archetype.heading);
      await context.close();
      scrubHar(harPath(archetype.id));
    }
  });

  for (const archetype of ARCHETYPE_PAGES) {
    for (const theme of ARCHETYPE_THEMES) {
      test(`${archetype.id} ${theme} visual baseline`, async ({ page }) => {
        test.skip(RECORDING, 'Recording run only refreshes the API fixtures.');
        const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ArchetypeManifest;
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.routeFromHAR(harPath(archetype.id), { url: /\/api\/admin\//, notFound: 'fallback' });
        await page.clock.setFixedTime(new Date(manifest.recordedAt));
        await preparePage(page, theme);
        await page.goto(archetype.path(manifest));
        await waitForArchetypeSettled(page, theme, archetype.heading);
        await expectNoHorizontalOverflow(page);
        await expect(page).toHaveScreenshot(`${archetype.id}-${theme}.png`, {
          ...screenshotOptions,
          fullPage: archetype.fullPage,
          mask: [page.locator('[data-visual-dynamic]')],
        });
      });
    }
  }
});

/*
 * 风格化皮肤基线（前端视觉计划 P3）：genshin / sticker × 暖白 / 暖夜，取角色库、资料库、制作项目。
 * 皮肤 CSS 拆分（app/styles/skins/）前先生成，拆分后必须零像素差异；之后皮肤表达分级等有意改动
 * 才更新，并在交付记录写明原因。数据与页面原型基线一样来自 HAR，时钟固定。
 * 首页不放在这里：模块卡计数来自共享测试库，遮罩宽度随数字位数变化，皮肤下卡片高度也随之漂移；
 * 首页的皮肤观感由交付记录里的人工截图核对。
 */
const SKIN_IDS = ['genshin', 'sticker'] as const;
const SKIN_PAGES = [
  { id: 'characters', fixture: 'characters', path: () => '/apps/characters', fullPage: true },
  { id: 'resources', fixture: 'resources', path: () => '/apps/resources', fullPage: false },
  { id: 'activities', fixture: 'activities', path: () => '/apps/activities', fullPage: true },
];

test.describe('ui skin baselines', () => {
  for (const skin of SKIN_IDS) {
    for (const theme of ARCHETYPE_THEMES) {
      for (const skinPage of SKIN_PAGES) {
        test(`${skinPage.id} ${skin} ${theme} skin baseline`, async ({ page }) => {
          test.skip(RECORDING, 'Recording run only refreshes the API fixtures.');
          const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ArchetypeManifest;
          await page.setViewportSize({ width: 1440, height: 900 });
          await page.routeFromHAR(harPath(skinPage.fixture), { url: /\/api\/admin\//, notFound: 'fallback' });
          await page.clock.setFixedTime(new Date(manifest.recordedAt));
          await preparePage(page, theme);
          await page.addInitScript(id => { if (location.protocol === 'http:') localStorage.setItem('sthstart_ui_skin', id); }, skin);
          await page.goto(skinPage.path());
          await expect(page.locator('html')).toHaveAttribute('data-ui-skin', skin);
          await waitForArchetypeSettled(page, theme, /.+/);
          await expectNoHorizontalOverflow(page);
          await expect(page).toHaveScreenshot(`skin-${skinPage.id}-${skin}-${theme}.png`, {
            ...screenshotOptions,
            fullPage: skinPage.fullPage,
            mask: [page.locator('[data-visual-dynamic]')],
          });
        });
      }
    }
  }
});

test('portal desktop dark-espresso visual baseline', async ({ page }) => {
  await page.addInitScript(() => { if (location.protocol === 'http:') localStorage.setItem('sthstart_theme_id', 'dark-espresso'); });
  await useFixedDashboardData(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark-espresso');
  await expect(page.getByRole('heading', { name: '工作台', level: 1 })).toBeVisible();
  await waitForDashboardSettled(page);
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot('portal-desktop-dark-espresso.png', {
    ...screenshotOptions,
    fullPage: true,
    mask: [page.locator('[data-visual-dynamic]')],
  });
});
