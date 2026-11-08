import { expect, test } from '@playwright/test';

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

async function useFixedDashboardData(page: import('@playwright/test').Page) {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route(/\/api\/admin\/workspace\/recent(?:\?|$)/, (route) => route.fulfill({ json: RECENT_WORK_FIXTURE }));
  await page.route(/\/api\/admin\/calendar(?:\?|$)/, (route) => route.fulfill({ json: CALENDAR_FIXTURE }));
}

/**
 * 截图前等载入态结束：最近工作按 limit=8 截断、近期日程按 limit=5 截断，
 * 两块列表都达到固定行数后画面高度才确定；骨架行期间 role=status 仍在无障碍树中。
 */
async function waitForDashboardSettled(page: import('@playwright/test').Page) {
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('recent-work-list').getByRole('listitem')).toHaveCount(8, { timeout: 15_000 });
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
  await page.goto('/settings/control-center');
  // 页标题改为「控制中心」；运行总览面板标题为「邻舍运行栈」。
  await waitForControlCenterLoaded(page);
  await expect(page.getByRole('tab', { name: '运行总览' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: '邻舍运行栈' })).toBeVisible();
  await expect(page.getByText('运行栈状态')).toBeVisible();
  await expect(page).toHaveScreenshot('control-center-overview.png', {
    ...screenshotOptions,
    fullPage: false,
    mask: [page.locator('[data-visual-dynamic]')],
    maskColor: '#f5f6f8',
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
  // 编辑器改为页头「新建角色档案」+「人设 / 外貌 / 资产 / LoRA」分段，不再有「编辑身份资料」浮层入口。
  await expect(page.getByRole('heading', { name: '新建角色档案', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: '人设' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('角色名称')).toBeVisible();
  await expect(page.getByRole('heading', { name: '形象资产库' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: '创作资料库', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: '文档标题与元信息' }).getByPlaceholder('无标题笔记')).toBeVisible();
  await expect(page.getByRole('region', { name: '笔记正文' }).getByPlaceholder('写下一段文字记录…')).toBeVisible();
  await expect(page.locator('.notebook-master-list .notebook-list-item')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.getByText('1 页 · 共 2 条')).toBeVisible();
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
