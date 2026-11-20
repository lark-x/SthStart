import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { McpSource, McpSourceSave, McpTransport } from '@sthstart/contracts';

const portal = `http://127.0.0.1:${process.env.E2E_PORTAL_PORT ?? 4273}`;
const screenshotDirectory = resolve('artifacts/visual-verification/mcp-sources');
const now = '2026-11-19T08:00:00.000Z';

test.use({
  serviceWorkers: 'block',
  deviceScaleFactor: 2,
});

type DiscoverPayload = {
  sourceId?: string;
  url: string;
  transport?: McpTransport;
  authMode?: McpSourceSave['authMode'];
  authHeaderName?: string;
  secret?: string;
  timeoutMs?: number;
};

type McpRouteState = {
  sources: McpSource[];
  createPayload: McpSourceSave | null;
  updatePayload: McpSourceSave | null;
  discoverPayloads: DiscoverPayload[];
  testedIds: string[];
  statusPayloads: Array<{ id: string; status: 'enabled' | 'disabled' }>;
};

function fixtureSources(): McpSource[] {
  return [
    {
      id: 'akasha-story',
      name: '虚空终端 Story MCP',
      url: 'https://mcp.example.com/akasha',
      authMode: 'bearer',
      credentialAccount: 'mcp-source:akasha-story',
      applicableWorks: ['原神', '崩坏：星穹铁道'],
      universal: false,
      purpose: '检索剧情原文、角色资料与关键地点。',
      allowedTools: ['search_story', 'read_scene'],
      discoveredTools: [
        { name: 'search_story', description: '按作品和关键词检索剧情原文。' },
        { name: 'read_scene', description: '读取指定章节的完整对白与旁白。' },
        { name: 'search_character', description: '检索角色档案与别名。' },
      ],
      timeoutMs: 45_000,
      status: 'enabled',
      hasCredential: true,
      credentialSource: 'keyring',
      lastTestResult: {
        ok: true,
        message: 'SthStart Story 1.2 已连接，发现 3 个工具',
        transport: 'auto',
        testedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'archive-sse',
      name: '档案终端',
      url: 'https://archive.example.com/sse',
      transport: 'sse',
      authMode: 'header',
      authHeaderName: 'X-Archive-Key',
      credentialAccount: 'mcp-source:archive-sse',
      applicableWorks: ['原创项目'],
      universal: false,
      purpose: '读取旧版档案服务中的场景与人物记录。',
      allowedTools: ['archive_search'],
      discoveredTools: [
        { name: 'archive_search', description: '检索归档摘要与来源引用。' },
      ],
      timeoutMs: 60_000,
      status: 'enabled',
      hasCredential: false,
      lastTestResult: {
        ok: false,
        message: 'mcp_connect_failed: 认证请求头尚未配置',
        transport: 'sse',
        testedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'local-streamable',
      name: '本地兼容接口',
      url: 'http://127.0.0.1:8765/mcp',
      transport: 'streamable-http',
      authMode: 'none',
      applicableWorks: [],
      universal: true,
      purpose: '本地开发与协议兼容检查。',
      allowedTools: [],
      discoveredTools: [],
      timeoutMs: 30_000,
      status: 'disabled',
      hasCredential: false,
      lastTestResult: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function sourceFromPayload(
  payload: McpSourceSave,
  existing?: McpSource,
): McpSource {
  const id = existing?.id
    ?? payload.id
    ?? `mcp-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const timestamp = new Date().toISOString();
  return {
    id,
    name: payload.name,
    url: payload.url,
    transport: payload.transport ?? existing?.transport ?? 'auto',
    authMode: payload.authMode,
    authHeaderName: payload.authHeaderName,
    credentialAccount: payload.authMode === 'none'
      ? undefined
      : (existing?.credentialAccount ?? `mcp-source:${id}`),
    applicableWorks: payload.applicableWorks,
    universal: payload.universal ?? existing?.universal ?? false,
    purpose: payload.purpose ?? existing?.purpose ?? '',
    allowedTools: payload.allowedTools ?? existing?.allowedTools ?? [],
    discoveredTools: existing?.discoveredTools ?? [],
    timeoutMs: payload.timeoutMs ?? existing?.timeoutMs ?? 45_000,
    status: payload.status ?? existing?.status ?? 'enabled',
    hasCredential: Boolean(payload.secret) || Boolean(existing?.hasCredential),
    credentialSource: payload.secret ? 'keyring' : existing?.credentialSource,
    lastTestResult: existing?.lastTestResult ?? null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

async function installMcpRoutes(page: Page): Promise<McpRouteState> {
  const state: McpRouteState = {
    sources: fixtureSources(),
    createPayload: null,
    updatePayload: null,
    discoverPayloads: [],
    testedIds: [],
    statusPayloads: [],
  };

  await page.route('**/api/admin/mcp-sources**', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/\/+$/, '');
    const segments = path.split('/');

    if (method === 'GET' && path.endsWith('/mcp-sources')) {
      await route.fulfill({ json: { items: state.sources } });
      return;
    }

    if (method === 'POST' && path.endsWith('/mcp-sources/discover')) {
      const payload = request.postDataJSON() as DiscoverPayload;
      state.discoverPayloads.push(payload);
      await route.fulfill({
        json: {
          ok: true,
          message: 'MCP 服务已连接，发现 2 个工具',
          tools: [
            { name: 'search_archive', description: '检索档案摘要。' },
            { name: 'read_archive', description: '读取档案正文。' },
          ],
          serverInfo: { name: 'Archive Fixture', version: '2.0.0' },
          transport: payload.transport ?? 'auto',
          testedAt: now,
        },
      });
      return;
    }

    if (method === 'POST' && path.endsWith('/test')) {
      const id = decodeURIComponent(segments.at(-2) ?? '');
      const source = state.sources.find((item) => item.id === id);
      if (!source) {
        await route.fulfill({ status: 404, json: { error: 'mcp_source_not_found' } });
        return;
      }
      state.testedIds.push(id);
      const result = {
        ok: true,
        message: '连接测试通过，发现 3 个工具',
        tools: source.discoveredTools ?? [],
        serverInfo: { name: 'Connection Fixture', version: '1.0.0' },
        transport: source.transport ?? 'auto',
        testedAt: now,
      };
      source.lastTestResult = {
        ok: true,
        message: result.message,
        transport: result.transport,
        testedAt: result.testedAt,
      };
      await route.fulfill({ json: result });
      return;
    }

    if (method === 'PATCH' && path.endsWith('/status')) {
      const id = decodeURIComponent(segments.at(-2) ?? '');
      const source = state.sources.find((item) => item.id === id);
      const body = request.postDataJSON() as { status?: 'enabled' | 'disabled' };
      if (!source) {
        await route.fulfill({ status: 404, json: { error: 'mcp_source_not_found' } });
        return;
      }
      source.status = body.status === 'disabled' ? 'disabled' : 'enabled';
      source.updatedAt = new Date().toISOString();
      state.statusPayloads.push({ id, status: source.status });
      await route.fulfill({ json: source });
      return;
    }

    if (method === 'POST' && path.endsWith('/mcp-sources')) {
      const payload = request.postDataJSON() as McpSourceSave;
      state.createPayload = payload;
      const source = sourceFromPayload(payload);
      state.sources = [source, ...state.sources];
      await route.fulfill({
        status: 201,
        json: { source, secretStored: true, warning: null },
      });
      return;
    }

    if (method === 'PUT') {
      const id = decodeURIComponent(segments.at(-1) ?? '');
      const index = state.sources.findIndex((item) => item.id === id);
      if (index < 0) {
        await route.fulfill({ status: 404, json: { error: 'mcp_source_not_found' } });
        return;
      }
      const payload = request.postDataJSON() as McpSourceSave;
      state.updatePayload = payload;
      const source = sourceFromPayload(payload, state.sources[index]);
      state.sources[index] = source;
      await route.fulfill({ json: { source, secretStored: true, warning: null } });
      return;
    }

    if (method === 'DELETE') {
      const id = decodeURIComponent(segments.at(-1) ?? '');
      state.sources = state.sources.filter((item) => item.id !== id);
      await route.fulfill({ json: { ok: true } });
      return;
    }

    await route.fulfill({
      status: 501,
      json: { error: 'unexpected_fixture_request', method, path },
    });
  });

  return state;
}

async function authenticate(context: BrowserContext) {
  expect(new URL(portal).port).not.toBe('9320');
  const response = await context.request.post(`${portal}/api/auth/admin-session`, {
    headers: { origin: portal },
  });
  expect(response.ok()).toBe(true);
}

async function openManager(page: Page) {
  await page.goto('/apps/resources?view=sources');
  await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
  const heading = page.getByRole('heading', { name: 'MCP 连接', exact: true });
  await expect(heading).toBeVisible();
  const manager = page.locator('section').filter({ has: heading }).first();
  await expect(manager).toBeVisible();
  return manager;
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
}

test.describe('MCP source management', () => {
  test('lists mixed transports and captures desktop and phone screenshots', async ({ page, context }) => {
    test.setTimeout(120_000);
    const state = await installMcpRoutes(page);
    await authenticate(context);
    await context.addInitScript(() => {
      localStorage.setItem('sthstart_theme_id', 'light-paper');
      localStorage.setItem('sthstart_ui_skin', 'default');
    });
    const manager = await openManager(page);

    await expect(manager.getByRole('article')).toHaveCount(3);
    const legacyAuto = manager.getByRole('article', { name: '虚空终端 Story MCP', exact: true });
    const legacySse = manager.getByRole('article', { name: '档案终端', exact: true });
    const streamable = manager.getByRole('article', { name: '本地兼容接口', exact: true });
    await expect(legacyAuto).toHaveAttribute('data-transport', 'auto');
    await expect(legacyAuto.getByText('自动', { exact: true })).toBeVisible();
    await expect(legacySse.getByText('SSE', { exact: true })).toBeVisible();
    await expect(streamable.getByText('Streamable HTTP', { exact: true }).first()).toBeVisible();
    await expect(legacyAuto.getByText(/已存凭据/)).toBeVisible();
    await expect(legacySse.getByText(/未存凭据/)).toBeVisible();
    await expect(manager.getByText('3 个接口', { exact: true })).toBeVisible();
    await expect(manager.getByText('2 个已启用', { exact: true })).toBeVisible();

    const search = manager.getByRole('searchbox', { name: '搜索 MCP 连接', exact: true });
    await search.fill('SSE');
    await expect(manager.getByRole('article')).toHaveCount(1);
    await expect(legacySse).toBeVisible();
    await manager.getByRole('button', { name: '清除筛选', exact: true }).click();
    await expect(manager.getByRole('article')).toHaveCount(3);

    mkdirSync(screenshotDirectory, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(450);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: resolve(screenshotDirectory, 'mcp-sources-1440.png'),
      fullPage: true,
      animations: 'disabled',
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'MCP 连接', exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(450);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: resolve(screenshotDirectory, 'mcp-sources-390.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.locator('.resources-sources-container').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.waitForTimeout(200);
    await page.screenshot({
      path: resolve(screenshotDirectory, 'mcp-sources-390-actions.png'),
      animations: 'disabled',
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await legacyAuto.getByRole('button', { name: '测试连接 虚空终端 Story MCP', exact: true }).click();
    await expect.poll(() => state.testedIds).toContain('akasha-story');
    await expect(legacyAuto.getByText('连接正常', { exact: true })).toBeVisible();

    await legacyAuto.getByRole('button', { name: '停用 虚空终端 Story MCP', exact: true }).click();
    await expect.poll(() => state.statusPayloads.at(-1)?.status).toBe('disabled');
    expect(state.statusPayloads.at(-1)).toEqual({
      id: 'akasha-story',
      status: 'disabled',
    });
    await expect(legacyAuto.getByRole('button', { name: '启用 虚空终端 Story MCP', exact: true })).toBeVisible();
  });

  test('edits an existing connection without exposing or dropping its saved credential', async ({ page, context }) => {
    test.setTimeout(60_000);
    const state = await installMcpRoutes(page);
    await authenticate(context);
    await page.setViewportSize({ width: 1440, height: 900 });
    const manager = await openManager(page);
    const sourceCard = manager.getByRole('article', { name: '虚空终端 Story MCP', exact: true });

    await sourceCard.getByRole('button', { name: '编辑 虚空终端 Story MCP', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '编辑 MCP 连接', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: /^连接名称/ })).toHaveValue('虚空终端 Story MCP');
    await expect(dialog.getByRole('textbox', { name: /^接口地址/ })).toHaveValue('https://mcp.example.com/akasha');
    await expect(dialog.getByRole('radio', { name: /自动检测/ })).toBeChecked();
    await expect(dialog.getByText(/已安全保存凭据。留空将继续使用现有值。/)).toBeVisible();
    await expect(dialog.getByLabel('访问 Token', { exact: true })).toHaveValue('');
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDirectory, 'mcp-sources-editor-1440.png'),
      animations: 'disabled',
    });

    await dialog.getByRole('radio', { name: /^旧式 SSE/ }).check();
    await dialog.getByRole('spinbutton', { name: /^连接超时/ }).fill('30000');
    await dialog.getByLabel('用途说明', { exact: true }).fill('更新后的剧情与角色资料检索。');
    const readScene = dialog.getByRole('button', { name: '允许调用 read_scene', exact: true });
    await expect(readScene).toHaveAttribute('aria-pressed', 'true');
    await readScene.click();
    await expect(readScene).toHaveAttribute('aria-pressed', 'false');
    await dialog.getByRole('switch', { name: '启用此连接', exact: true }).uncheck();
    await dialog.getByRole('button', { name: '保存更改', exact: true }).click();

    await expect(dialog).not.toBeVisible();
    expect(state.updatePayload).toMatchObject({
      id: 'akasha-story',
      name: '虚空终端 Story MCP',
      url: 'https://mcp.example.com/akasha',
      transport: 'sse',
      authMode: 'bearer',
      purpose: '更新后的剧情与角色资料检索。',
      allowedTools: ['search_story'],
      timeoutMs: 30_000,
      status: 'disabled',
    });
    expect(state.updatePayload).not.toHaveProperty('secret');
    await expect(sourceCard).toHaveAttribute('data-transport', 'sse');
    await expect(sourceCard.getByText('已停用', { exact: true })).toBeVisible();
    await expect(sourceCard.getByText('已存凭据', { exact: false })).toBeVisible();
  });

  test('creates an SSE connection, discovers tools and persists the chosen permissions', async ({ page, context }) => {
    test.setTimeout(90_000);
    const state = await installMcpRoutes(page);
    await authenticate(context);
    const manager = await openManager(page);

    await manager.getByRole('button', { name: '新增连接', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新增 MCP 连接', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /自动检测/ })).toBeChecked();

    await dialog.getByRole('textbox', { name: /^连接名称/ }).fill('研究档案库');
    await dialog.getByRole('textbox', { name: /^接口地址/ }).fill('https://research.example.com/sse');
    await dialog.getByRole('radio', { name: /^旧式 SSE/ }).check();
    await dialog.getByLabel('认证方式', { exact: true }).selectOption('header');
    await dialog.getByRole('textbox', { name: /^认证请求头(?: （必填）)?$/ }).fill('X-Research-Key');
    await dialog.getByLabel('认证请求头值', { exact: true }).fill('fixture-research-credential');
    await dialog.getByLabel('用途说明', { exact: true }).fill('检索研究档案与来源引用。');
    await dialog.getByLabel('适用作品', { exact: true }).fill('原创项目、资料研究');

    await dialog.getByRole('button', { name: '测试并发现工具', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '允许调用 search_archive', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '允许调用 read_archive', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '允许调用 search_archive', exact: true }).click();
    await dialog.getByRole('button', { name: '允许调用 read_archive', exact: true }).click();
    await dialog.getByRole('button', { name: '创建连接', exact: true }).click();

    await expect(dialog).not.toBeVisible();
    expect(state.discoverPayloads).toHaveLength(1);
    expect(state.discoverPayloads[0]).toMatchObject({
      url: 'https://research.example.com/sse',
      transport: 'sse',
      authMode: 'header',
      authHeaderName: 'X-Research-Key',
      secret: 'fixture-research-credential',
      timeoutMs: 45_000,
    });
    expect(state.createPayload).toMatchObject({
      name: '研究档案库',
      url: 'https://research.example.com/sse',
      transport: 'sse',
      authMode: 'header',
      authHeaderName: 'X-Research-Key',
      secret: 'fixture-research-credential',
      applicableWorks: ['原创项目', '资料研究'],
      allowedTools: ['search_archive', 'read_archive'],
      status: 'enabled',
    });

    const created = manager.getByRole('article', { name: '研究档案库', exact: true });
    await expect(created).toBeVisible();
    await expect(created).toHaveAttribute('data-transport', 'sse');
    await expect(created.getByText('2 个工具可调用', { exact: true })).toBeVisible();
    await expect(created.getByText('已存凭据', { exact: false })).toBeVisible();
  });
});
