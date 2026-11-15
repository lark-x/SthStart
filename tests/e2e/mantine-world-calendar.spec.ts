import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

/*
 * C1 acceptance for world, narrative and calendar.
 *
 * Every admin response is mocked here, so the spec runs without a populated
 * database and never writes real content. The calendar clock is fixed so the
 * selected date and the month grid are deterministic.
 */

const THEMES = ['light-paper', 'light-zinc', 'dark-espresso', 'dark-obsidian'] as const;
const DATE_KEY = '2026-11-13';
const FIXED_NOW = new Date('2026-11-13T10:30:00+08:00');
const stamp = '2026-11-13T02:30:00.000Z';

/*
 * Every admin response in this suite is fulfilled by page.route, so the page must
 * stay outside the app's service worker. The notebook worker registers at scope '/'
 * and, once it has claimed the client, WebKit lets its fetches bypass route mocking:
 * the first calendar GET returns the mock (3 events) while the post-reload GET is
 * served from the network with real Server-Timing headers and `events: []`. That
 * produced a false "2026-11-13, 0 items" failure in all four themes, and the same
 * bypass emptied the story-world and narrative responses. Blocking the worker keeps
 * these fixtures authoritative; the real worker keeps its coverage in the offline
 * suites (offline-and-mobile.spec.ts, mantine-notebook-resources.spec.ts).
 */
test.use({ serviceWorkers: 'block' });

const CALENDAR_EVENTS = [
  { id: 'birthday-a', kind: 'birthday', date: DATE_KEY, title: '林舟的生日', characterId: 'char-a', characterName: '林舟', work: '原神', favorite: true },
  { id: 'birthday-b', kind: 'birthday', date: DATE_KEY, title: '苏禾的生日', characterId: 'char-b', characterName: '苏禾', work: '原神', favorite: false },
  { id: 'activity-a', kind: 'activity', date: DATE_KEY, title: '秋日茶会互动', activityId: 'act-a', participantCount: 3 },
  { id: 'activity-b', kind: 'activity', date: '2026-11-20', title: '港口夜航', activityId: 'act-b', participantCount: 2 },
];

const WORLD = {
  id: 'world-fixture',
  revision: 1,
  createdAt: stamp,
  updatedAt: stamp,
  title: '归航后的日常',
  summary: '围绕一次归航展开的共同生活。',
  timeLabel: '归航日',
  locations: [{ id: 'harbor', name: '港口', description: '石阶、潮汐和茶香。' }],
  actors: [
    {
      id: 'actor-0', name: '林舟', role: 'main', characterId: null, characterVersion: null,
      background: '在港口生活多年。', personality: '温和谨慎', speechStyle: '自然简洁',
      appearance: '亚麻外套', goals: ['完成日常工作'], locationId: 'harbor', referenceArtifactIds: [],
    },
    {
      id: 'actor-1', name: '苏禾', role: 'supporting', characterId: null, characterVersion: null,
      background: '刚回到港口。', personality: '安静', speechStyle: '简短',
      appearance: '深色斗篷', goals: ['整理行李'], locationId: 'harbor', referenceArtifactIds: [],
    },
  ],
  sources: [],
  lockedFacts: [],
  models: { action: null, adjudication: null, narration: null },
  visualStyle: '柔和纸感插画',
};

const BRANCHES = [
  {
    id: 'branch-main', worldId: WORLD.id, title: '归航主线', mode: 'canon-gap',
    parentBranchId: null, forkTick: 0, currentTick: 120, revision: 2, sourceRevision: 1,
    direction: '平静的生活和偶然相遇。', createdAt: stamp, updatedAt: stamp,
  },
  {
    id: 'branch-alt', worldId: WORLD.id, title: '海潮平行线', mode: 'alternate',
    parentBranchId: null, forkTick: 0, currentTick: 60, revision: 1, sourceRevision: 1,
    direction: '海潮退去后的另一条支线。', createdAt: stamp, updatedAt: stamp,
  },
];

const RUN = {
  id: 'run-fixture', worldId: WORLD.id, branchId: BRANCHES[0].id, status: 'completed',
  settings: { durationTicks: 120, stepTicks: 60, maxTextCalls: 40, maxImages: 4, autoImages: false },
  startTick: 0, targetTick: 120, completedTick: 120, textCallsUsed: 4, imagesSubmitted: 0,
  pauseReason: '', createdAt: stamp, updatedAt: stamp,
};

const EVENTS = [
  {
    id: 'event-1', worldId: WORLD.id, branchId: BRANCHES[0].id, tick: 30, duration: 0,
    title: '码头的清晨', summary: '林舟在码头整理绳索。', locationId: 'harbor', participantIds: ['actor-0'],
    facts: [], perspectives: [{ actorId: 'actor-0', text: '林舟望着潮水漫过石阶，熟悉的海风让这一天显得安静。' }],
    causeEventIds: [], storyLineIds: [], stateChanges: [], createdAt: stamp,
  },
  {
    id: 'event-2', worldId: WORLD.id, branchId: BRANCHES[0].id, tick: 90, duration: 0,
    title: '港口的重逢', summary: '两人在码头相遇，约好一起去茶室。', locationId: 'harbor', participantIds: ['actor-0', 'actor-1'],
    facts: [], perspectives: [
      { actorId: 'actor-0', text: '林舟先看见了归航的船。' },
      { actorId: 'actor-1', text: '苏禾提着行李走下舷梯。' },
    ],
    causeEventIds: [], storyLineIds: [], stateChanges: [], createdAt: stamp,
  },
];

const WORK = { id: 'work-1', title: '雨夜来信', description: '', locale: 'zh-CN', sourceName: '本地示例', nodeCount: 2 };
const NODES = [
  { id: 'chapter-1', parentId: null, kind: 'chapter', title: '序章', sortOrder: 1, summary: '' },
  { id: 'quest-1', parentId: 'chapter-1', kind: 'quest', title: '雨夜来信', sortOrder: 1, summary: '一封迟到的信。' },
];
const READING = {
  node: { id: 'quest-1', workId: WORK.id, title: '雨夜来信', summary: '一封迟到的信。', conceptArtifacts: [] },
  scenes: [{
    id: 'scene-1', title: '末班车站', summary: '', sortOrder: 1,
    utterances: [
      { id: 'line-1', kind: 'narration', speaker: null, text: '雨落在空无一人的站台。', condition: null },
      { id: 'line-2', kind: 'dialogue', speaker: '林', text: '这封信，为什么偏偏在今天寄到？', condition: null },
    ],
  }],
};
const CONNECTORS = [
  { id: 'akasha', name: '虚空终端', kind: 'mcp', status: 'ready', message: '已连接。', capabilities: ['search', 'read'] },
  { id: 'local-json', name: '本地 JSON', kind: 'json', status: 'ready', message: '可用于导入。', capabilities: ['import'] },
];
const SEARCH_RESULTS = [
  { workId: WORK.id, kind: 'utterance', refId: 'line-1', nodeId: 'quest-1', title: '旁白', excerpt: '雨落在<mark>空无一人</mark>的站台。' },
];

type FixtureState = { worldsEmpty?: boolean; eventsEmpty?: boolean; worksFail?: boolean };

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockAdmin(page: Page, state: FixtureState = {}) {
  await page.route('**/api/admin/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/admin/', '');

    if (path === 'tasks') return json(route, { items: [], activeCount: 0 });
    if (path === 'overview') {
      return json(route, {
        keyring: { available: true, backend: 'fixture', envFallback: false },
        apps: [], profiles: [], llmAssignments: [], personas: [],
      });
    }
    if (path === 'models' || path === 'purposes') return json(route, { items: [] });
    if (path === 'generation/uncertain-tasks') return json(route, { items: [], total: 0 });

    if (path === 'calendar') {
      const from = url.searchParams.get('from') ?? '';
      const to = url.searchParams.get('to') ?? '';
      let filter: Record<string, unknown> = {};
      try { filter = JSON.parse(url.searchParams.get('filter') || '{}'); } catch { filter = {}; }
      const kinds = Array.isArray(filter.kinds) ? filter.kinds as string[] : null;
      const works = Array.isArray(filter.works) ? filter.works as string[] : null;
      const query = typeof filter.q === 'string' ? filter.q : '';
      const events = CALENDAR_EVENTS.filter((event) => event.date >= from && event.date <= to)
        .filter((event) => !kinds || kinds.includes(event.kind))
        .filter((event) => !works || (event.work ? works.includes(event.work) : false))
        .filter((event) => !filter.favorite || event.favorite === true)
        .filter((event) => !query || [event.title, event.characterName, event.work].filter(Boolean).join(' ').includes(query));
      return json(route, { from, to, events });
    }

    if (path === 'characters/browse') {
      return json(route, {
        items: [], total: 0, page: 1, pageSize: 1,
        facets: {
          works: [{ name: '原神', aliases: [], mediaType: '游戏' }],
          tags: [], groups: [], interpretations: [], sources: [], birthdayMonths: [11],
        },
      });
    }

    if (path === 'story-worlds') return json(route, { items: state.worldsEmpty ? [] : [WORLD] });
    if (path === 'story-worlds/' + WORLD.id) return json(route, { world: WORLD, branches: BRANCHES });
    const branchPrefix = 'story-worlds/' + WORLD.id + '/branches/';
    if (path.startsWith(branchPrefix)) {
      const rest = path.slice(branchPrefix.length).split('/');
      if (rest.length === 1) {
        const selectedBranch = BRANCHES.find((branch) => branch.id === rest[0]) ?? BRANCHES[0];
        return json(route, {
          branch: selectedBranch, definition: {
            title: WORLD.title, summary: WORLD.summary, timeLabel: WORLD.timeLabel,
            locations: WORLD.locations, actors: WORLD.actors, sources: WORLD.sources,
            lockedFacts: WORLD.lockedFacts, models: WORLD.models, visualStyle: WORLD.visualStyle,
          },
          states: [], storyLines: [], run: RUN, interventions: [], images: [], sourceUpdatesAvailable: false,
        });
      }
      if (rest[1] === 'events') {
        if (state.eventsEmpty) return json(route, { items: [], nextCursor: null, total: 0, from: 0, to: 120, buckets: [] });
        return json(route, {
          items: EVENTS, nextCursor: null, total: EVENTS.length, from: 0, to: 120,
          buckets: [{ from: 0, to: 60, count: 1 }, { from: 60, to: 120, count: 1 }],
        });
      }
      if (rest[1] === 'memories') return json(route, { items: [] });
    }

    if (path === 'narrative/works') {
      if (state.worksFail) return json(route, { error: 'fixture_failure', message: '叙事库暂时不可用。' }, 500);
      return json(route, { items: [WORK] });
    }
    if (path === 'narrative/works/' + WORK.id + '/tree') return json(route, { items: NODES });
    if (path === 'narrative/nodes/quest-1/read') return json(route, READING);
    if (path === 'narrative/connectors') return json(route, { items: CONNECTORS });
    if (path === 'narrative/search') return json(route, { items: SEARCH_RESULTS });

    return json(route, { error: 'not_mocked', path }, 404);
  });
}

async function contrastOf(locator: Locator) {
  return locator.evaluate((node) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    const chain: string[] = [];
    for (let element: Element | null = node; element; element = element.parentElement) {
      chain.push(getComputedStyle(element).backgroundColor);
    }
    for (const color of chain.reverse()) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
    }
    const background = ctx.getImageData(0, 0, 1, 1).data;
    ctx.fillStyle = getComputedStyle(node).color;
    ctx.fillRect(0, 0, 1, 1);
    const foreground = ctx.getImageData(0, 0, 1, 1).data;
    const luminance = (pixel: Uint8ClampedArray) => [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
      const value = pixel[index] / 255;
      return sum + weight * (value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
    }, 0);
    const a = luminance(background);
    const b = luminance(foreground);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

test.describe('C1 world, narrative and calendar', () => {
  test('calendar selected date keeps event semantics and readable text in all four themes', async ({ page }, info) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await mockAdmin(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    for (const theme of THEMES) {
      await page.addInitScript((id) => { localStorage.setItem('sthstart_theme_id', id); }, theme);
      await page.goto('/apps/calendar');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('heading', { name: '角色日历' })).toBeVisible();

      const selected = page.locator('.calendar-day[aria-pressed="true"]');
      await expect(selected).toHaveAttribute('aria-label', /^2026-11-13，3 项事件$/);
      /*
       * A short desktop viewport used to clip the final week inside the panel.
       * The grid itself must end inside its visible panel, and the last day of
       * the month must be reachable without scrolling an inner overflow.
       */
      const layout = await page.evaluate(() => {
        const grid = document.querySelector('.calendar-grid');
        const panel = document.querySelector('.calendar-panel');
        const lastDay = document.querySelector('.calendar-day[aria-label^="2026-11-30"]');
        return {
          gridBottom: grid?.getBoundingClientRect().bottom ?? 0,
          panelBottom: panel?.getBoundingClientRect().bottom ?? 0,
          lastDayBottom: lastDay?.getBoundingClientRect().bottom ?? 0,
        };
      });
      expect(layout.lastDayBottom).toBeLessThanOrEqual(layout.panelBottom + 1);
      expect(layout.gridBottom).toBeLessThanOrEqual(layout.panelBottom + 1);
      expect(await contrastOf(selected.locator('.calendar-day-date')), theme + ' date number').toBeGreaterThanOrEqual(4.5);
      const eventLines = selected.locator('.calendar-day-event > span');
      expect(await eventLines.count()).toBe(3);
      for (let index = 0; index < 3; index += 1) {
        expect(await contrastOf(eventLines.nth(index)), theme + ' event line ' + index).toBeGreaterThanOrEqual(4.5);
      }

      // Keep one real dark selected-date capture for the contrast review; the
      // measured ratios above stay the assertion, this is evidence only.
      if (theme === 'dark-espresso' && process.env.STHSTART_ROUTE_MATRIX) {
        const path = info.outputPath('calendar-selected-dark-espresso.png');
        await selected.screenshot({ path, animations: 'disabled' });
        await info.attach('calendar-selected-dark-espresso', { path, contentType: 'image/png' });
      }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/apps/calendar');
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    const selected = page.locator('.calendar-day[aria-pressed="true"]');
    await expect(selected).toHaveAttribute('aria-label', /^2026-11-13，3 项事件$/);

    await page.locator('.calendar-day[aria-label^="2026-11-20"]').click();
    await expect(page.locator('.calendar-day[aria-pressed="true"]')).toHaveAttribute('aria-label', /^2026-11-20，1 项事件$/);
    await expect(page.getByText('2026-11-20', { exact: true })).toBeVisible();
    await expect(page.getByText('港口夜航', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: '仅生日', exact: true }).click();
    await expect(page.locator('.calendar-day[aria-label^="2026-11-13"]')).toHaveAttribute('aria-label', /^2026-11-13，2 项事件$/);
    await expect(page.getByText('秋日茶会互动', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '全部', exact: true }).click();
    await expect(page.locator('.calendar-day[aria-label^="2026-11-13"]')).toHaveAttribute('aria-label', /^2026-11-13，3 项事件$/);

    await page.getByRole('button', { name: '上个月', exact: true }).click();
    await expect(page.getByText('2026 年 10 月').first()).toBeVisible();
    // Month navigation keeps the selected day number, so 11-20 becomes 10-20.
    await expect(page.getByText('2026-10-20', { exact: true })).toBeVisible();
    await expect(page.getByText('这一天没有生日或活动。')).toBeVisible();

    await page.getByRole('button', { name: '今天', exact: true }).click();
    await expect(page.getByText('2026 年 11 月').first()).toBeVisible();
    await expect(page.locator('.calendar-day[aria-pressed="true"]')).toHaveAttribute('aria-label', /^2026-11-13，3 项事件$/);

    await page.getByRole('button', { name: /^筛选/ }).click();
    const filters = page.getByRole('dialog', { name: '日历筛选' });
    await expect(filters).toBeVisible();
    await expect(filters.getByRole('combobox', { name: '作品', exact: true })).toBeVisible();
    await filters.getByLabel('仅显示收藏角色相关的事件').check();
    await filters.getByRole('button', { name: '完成', exact: true }).click();
    await expect(page.locator('.calendar-day[aria-label^="2026-11-13"]')).toHaveAttribute('aria-label', /^2026-11-13，1 项事件$/);
  });

  test('world filters keep the canvas clear and return focus on narrow viewports', async ({ page }, info) => {
    await mockAdmin(page);
    for (const viewport of [{ width: 390, height: 570 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/apps/story-worlds');
      const trigger = page.getByRole('button', { name: '筛选', exact: true });
      await expect(trigger).toBeVisible();
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('combobox', { name: '选择故事世界', exact: true })).toBeHidden();
      await trigger.click();
      const filter = page.getByRole('dialog', { name: '世界与筛选', exact: true });
      await expect(filter.getByRole('combobox', { name: '选择故事世界', exact: true })).toBeVisible();
      await expect(filter.getByRole('button', { name: '关闭抽屉', exact: true })).toBeFocused();
      await expect.poll(() => filter.evaluate(element => Math.round(element.getBoundingClientRect().bottom))).toBe(viewport.height);
      await filter.getByRole('spinbutton', { name: '从', exact: true }).fill('25');
      await page.screenshot({ path: info.outputPath(`world-filters-${viewport.width}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(filter).toBeHidden();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(filter.getByRole('spinbutton', { name: '从', exact: true })).toHaveValue('25');
      await page.keyboard.press('Escape');
      await expect(filter).toBeHidden();
    }
  });

  test('empty event range shows one actionable empty state instead of layered views', async ({ page }, info) => {
    await mockAdmin(page, { eventsEmpty: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/apps/story-worlds?view=reading');
    const view = page.getByRole('region', { name: '归航主线', exact: true });
    const rangeAction = view.getByRole('button', { name: '查看全部时间', exact: true });
    const clearAction = view.getByRole('button', { name: '清除人物和故事线筛选', exact: true });
    const filter = page.getByRole('dialog', { name: '世界与筛选', exact: true });
    await view.getByRole('button', { name: '筛选', exact: true }).click();
    await filter.getByRole('spinbutton', { name: '从', exact: true }).fill('25');
    await filter.locator('.sw-actor-filter').first().click();
    await page.keyboard.press('Escape');
    await expect(filter).toBeHidden();
    for (const tab of ['故事阅读', '图像叙事', '故事流']) {
      await view.getByRole('tab', { name: new RegExp('^' + tab) }).click();
      await expect(view.getByText('这个时间窗口没有事件', { exact: true })).toHaveCount(1);
      await expect(rangeAction).toBeInViewport();
      await expect(view.locator('.sw-flow, .sw-reader')).toHaveCount(0);
    }
    await page.screenshot({ path: info.outputPath('world-empty-range-390.png'), animations: 'disabled' });
    await rangeAction.click();
    await expect(rangeAction).toHaveCount(0);
    await expect(clearAction).toBeInViewport();
    await clearAction.click();
    await expect(clearAction).toHaveCount(0);
    await expect(view.getByText('故事推进后，生成的事件会显示在这里。')).toBeVisible();
  });

  test('story world keeps empty, running and reading states on shared controls', async ({ page }) => {
    const state: FixtureState = { worldsEmpty: true };
    await mockAdmin(page, state);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/apps/story-worlds');
    await expect(page.getByText('还没有故事世界')).toBeVisible();
    await expect(page.getByRole('button', { name: '创建第一个世界' })).toBeVisible();

    state.worldsEmpty = false;
    await page.addInitScript(() => { localStorage.setItem('sthstart_theme_id', 'dark-espresso'); });
    await page.goto('/apps/story-worlds?world=' + WORLD.id + '&branch=' + BRANCHES[0].id);
    await expect(page.getByRole('heading', { name: '故事世界', exact: true })).toBeVisible();
    await expect(page.getByText('已完成', { exact: true }).first()).toBeVisible();

    const branches = page.locator('.sw-branch-row');
    await expect(branches).toHaveCount(2);
    const mainBranch = page.locator('.sw-branch-row', { hasText: '归航主线' });
    const altBranch = page.locator('.sw-branch-row', { hasText: '海潮平行线' });
    await expect(mainBranch).toHaveAttribute('aria-current', 'true');
    await altBranch.click();
    await expect(altBranch).toHaveAttribute('aria-current', 'true');
    await expect(mainBranch).not.toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('heading', { name: '海潮平行线', level: 2 })).toBeVisible();

    const actor = page.locator('.sw-actor-filter').first();
    await actor.click();
    await expect(actor).toHaveAttribute('aria-current', 'true');

    const eventRow = page.locator('.sw-event-row').filter({ hasText: '码头的清晨' }).first();
    await expect(eventRow).toBeVisible();
    await eventRow.click();
    // Selecting an event swaps the rail list for its detail panel.
    await expect(page.getByRole('heading', { name: '码头的清晨', level: 2 })).toBeVisible();
    await expect(page.getByRole('button', { name: '客观全景', exact: true })).toBeVisible();

    await page.getByRole('tab', { name: /故事阅读/ }).click();
    const reader = page.locator('.sw-reader');
    const allEvents = reader.getByRole('button', { name: /全部事件长卷/ });
    // The left rail actor filter also drives the reader, so 林舟 opens selected.
    const linzhou = reader.getByRole('button', { name: /^林舟 \d+$/ }).first();
    await expect(linzhou).toHaveAttribute('aria-pressed', 'true');
    expect(await contrastOf(linzhou), 'selected actor pill').toBeGreaterThanOrEqual(4.5);

    await allEvents.click();
    await expect(allEvents).toHaveAttribute('aria-pressed', 'true');
    await expect(linzhou).not.toHaveAttribute('aria-pressed', 'true');
    expect(await contrastOf(allEvents), 'selected reading pill').toBeGreaterThanOrEqual(4.5);

    await linzhou.click();
    await expect(linzhou).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('林舟望着潮水漫过石阶', { exact: false }).first()).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
  });

  test('narrative filters, search and failure feedback use the shared controls', async ({ page }) => {
    const state: FixtureState = {};
    await mockAdmin(page, state);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/apps/narrative');
    await expect(page.getByRole('heading', { name: '叙事档案', level: 1 })).toBeVisible();
    await expect(page.getByLabel('当前作品')).toHaveValue(WORK.id);
    await expect(page.getByText('雨落在空无一人的站台。')).toBeVisible();

    const treeNode = page.locator('.narrative-tree').getByRole('button', { name: /雨夜来信/ });
    await expect(treeNode).toHaveAttribute('aria-current', 'true');

    await page.getByRole('button', { name: '检索原文', exact: true }).click();
    const search = page.getByRole('textbox', { name: '搜索当前作品原文' });
    await search.fill('雨夜');
    await expect(page.getByText('检索结果 · 1 条')).toBeVisible();
    await expect(page.getByRole('button', { name: /^旁白 雨落在空无一人的站台。$/ })).toBeVisible();

    const importTab = page.getByRole('tab', { name: '数据源与导入' });
    await importTab.click();
    await expect(importTab).toHaveAttribute('aria-selected', 'true');
    await page.waitForURL(url => url.searchParams.get('mode') === 'import');
    await expect(page.getByText('虚空终端', { exact: true })).toBeVisible();
    await expect(page.getByText('本地 JSON', { exact: true })).toBeVisible();
    await expect(page.getByText('把来源变成可追溯的本地档案')).toBeVisible();

    await page.goBack();
    await expect(page.getByRole('tab', { name: '阅读', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(treeNode).toHaveAttribute('aria-current', 'true');
    await page.goForward();
    await expect(importTab).toHaveAttribute('aria-selected', 'true');

    state.worksFail = true;
    await page.goto('/apps/narrative');
    await expect(page.getByText('档案暂时无法读取', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: '重试读取', exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
  });
});
