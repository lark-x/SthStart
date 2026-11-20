import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { isOwnedDirectory } from './global-setup';
const portal = `http://127.0.0.1:${process.env.E2E_PORTAL_PORT ?? '4273'}`;
const admin = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? '4200'}/api/v1/admin`;
const headers = {
  'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef',
};
const prefix = `共享选角-${randomUUID().slice(0, 8)}`;
const draft = {
  schemaVersion: 2,
  displayName: '林',
  originType: 'original',
  work: '隔离原创',
  summary: '港口信使',
  personaText: '主档案故事',
  speechText: '严谨',
  behaviorRules: '守信',
  dialogueExamples: [],
  aliases: [],
  appearance: { baseText: '黑发', defaultOutfitText: '常服' },
};
async function create(
  request: APIRequestContext,
  name: string,
  originType = 'original'
) {
  expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY || '')).toBe(true);
  const res = await request.post(`${admin}/characters`, {
    headers,
    data: {
      displayName: name,
      draft: { ...draft, displayName: name, originType },
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}
async function open(page: Page, request: APIRequestContext) {
  expect(
    (
      await request.post(`${portal}/api/auth/admin-session`, {
        headers: { origin: portal },
      })
    ).ok()
  ).toBe(true);
  await page.goto('/apps/activities/new');
  await expect(page.locator('.shell-root')).toHaveAttribute(
    'data-client-ready',
    'true'
  );
  await page
    .getByRole('tab', { name: '挑选角色与题材生成', exact: true })
    .click();
}
async function search(page: Page, name: string) {
  // 角色筛选的搜索框是 type=search（P1 迁到页面原型后），读屏角色为 searchbox。
  await page.getByRole('searchbox', { name: '搜索角色', exact: true }).fill(name);
  await expect(
    page.getByRole('status').filter({ hasText: '正在更新角色列表' })
  ).toHaveCount(0);
}

test('original stage, form and text-only costume reach the actual activity actor', async ({
  page,
  request,
}, testInfo) => {
  const noStageName = `${prefix}-尚无阶段`;
  const stageName = `${prefix}-有阶段信使`;
  const unready = await create(request, noStageName);
  const ready = await create(request, stageName);
  const apply = await request.post(
    `${admin}/characters/${ready.id}/apply-upstream`,
    {
      headers,
      data: {
        draft: ready.draft,
        expectedDraftRevision: ready.draftRevision,
        applyTextFields: {},
        selectedVariants: [
          {
            id: 'sp',
            name: '觉醒SP',
            classification: 'variant',
            variantKind: 'sp',
            outfitDescription: '金色装甲',
            loreStory: '觉醒形态故事',
            selected: true,
            source: '测试',
          },
        ],
        selectedSkins: [
          {
            id: 'winter',
            name: '雪山冬衣',
            classification: 'skin',
            outfitDescription: '雪白冬衣',
            loreStory: '雪山纪念故事',
            selected: true,
            source: '测试',
          },
        ],
      },
    }
  );
  expect(apply.ok(), await apply.text()).toBe(true);
  const detail = await (
    await request.get(`${admin}/characters/${ready.id}`, { headers })
  ).json();
  const published = await request.post(
    `${admin}/characters/${ready.id}/publish`,
    {
      headers,
      data: {
        expectedDraftRevision: detail.draftRevision,
        versionLabel: '远行之前',
      },
    }
  );
  expect(published.ok(), await published.text()).toBe(true);
  let originalPublishRequests = 0;
  page.on('request', (req) => {
    if (req.url().includes(`/characters/${unready.id}/publish`))
      originalPublishRequests++;
  });
  await open(page, request);
  await search(page, noStageName);
  await expect(
    page.getByRole('link', { name: '前往保存阶段', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '选择角色', exact: true })
  ).toHaveCount(0);
  expect(originalPublishRequests).toBe(0);
  await search(page, stageName);
  await page.getByRole('button', { name: '选择角色', exact: true }).click();
  await expect(
    page.getByRole('combobox', {
      name: `选择 ${stageName} 的阶段`,
      exact: true,
    })
  ).toContainText('远行之前');
  await page
    .getByRole('combobox', { name: `选择 ${stageName} 的形态`, exact: true })
    .selectOption({ label: '觉醒SP' });
  await page
    .getByRole('combobox', { name: `选择 ${stageName} 的服装`, exact: true })
    .selectOption({ label: '皮肤 · 雪山冬衣' });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth
      )
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`picker-${width}.png`),
      fullPage: true,
    });
  }
  await page
    .getByRole('textbox', { name: '漫剧工程名称', exact: false })
    .fill('隔离选角制作');
  const responsePromise = page.waitForResponse(
    (res) =>
      res.url().endsWith('/api/admin/activities') &&
      res.request().method() === 'POST'
  );
  await page
    .getByRole('button', { name: '创建四幕分镜工程', exact: true })
    .click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBe(true);
  const created = await response.json();
  const activity = await (
    await request.get(`${admin}/activities/${created.activity.id}`, { headers })
  ).json();
  const content =
    activity.currentContentRevision?.document ||
    activity.currentContentRevision?.content ||
    activity.draft?.document ||
    activity.draft?.content;
  await page.screenshot({
    path: testInfo.outputPath('activity-created.png'),
    fullPage: true,
  });
  expect(content, JSON.stringify(activity)).toBeTruthy();
  const actor = content.actors[0];
  expect(actor.sourceVariantId).toBeTruthy();
  expect(actor.sourceCostumeAssetId).toBeTruthy();
  expect(actor.outfitDescription).toBe('雪白冬衣');
  expect(actor.persona.personaText).toContain('觉醒形态故事');
  expect(actor.persona.personaText).toContain('雪山纪念故事');
});

test('all cast uses folded family switching and library controls remain operable at touch width', async ({
  page,
  request,
}, testInfo) => {
  const work = await request.put(`${admin}/characters/works`, {
    headers,
    data: { name: '隔离原创', workNature: 'canon' },
  });
  expect(work.ok(), await work.text()).toBe(true);
  const rootName = `${prefix}-同源原作`;
  const auName = `${prefix}-同源AU`;
  const root = await create(request, rootName, 'ip');
  const fork = await request.post(
    `${admin}/characters/${root.id}/fork-derivative`,
    {
      headers,
      data: {
        targetWork: '隔离AU',
        parentWork: '隔离原创',
        displayName: auName,
      },
    }
  );
  expect(fork.ok(), await fork.text()).toBe(true);
  const derivative = (await fork.json()).character;
  await open(page, request);
  await expect(
    page.getByRole('combobox', {
      name: `切换 ${rootName} 的同源成员`,
      exact: true,
    })
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: `切换 ${rootName} 的同源成员`, exact: true })
    .selectOption(derivative.id);
  await expect(page.getByText(auName, { exact: true })).toBeVisible();
  await page
    .locator(`[data-character-family="${root.id}"]`)
    .getByRole('button', { name: '选择角色', exact: true })
    .click();
  await expect(
    page.getByRole('group', { name: '已选角色', exact: true })
  ).toContainText(auName);
  await page.goto('/apps/characters');
  await expect(page.locator('.shell-root')).toHaveAttribute(
    'data-client-ready',
    'true'
  );
  // 「只看头像」并入角色库的展示方式切换（卡片 / 头像）。
  await page.getByRole('group', { name: '展示模式', exact: true }).getByRole('button', { name: '头像', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const favorite = page.getByRole('button', {
    name: `收藏 ${rootName}`,
    exact: true,
  });
  await expect(favorite).toBeVisible();
  expect(
    Number(await favorite.evaluate((el) => getComputedStyle(el).opacity))
  ).toBeGreaterThan(0);
  await page.getByRole('button', { name: '更多角色操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '作品与别名', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '作品目录', exact: true });
  await dialog
    .getByRole('button', { name: '新建作品 · 清空表单', exact: true })
    .click();
  await expect(
    dialog.getByRole('textbox', { name: '标准名称', exact: true })
  ).toHaveValue('');
  await expect(dialog.getByRole('textbox', { name: '别名（逗号分隔）', exact: true })).toBeHidden();
  const directoryName = `${prefix}-空作品目录`;
  await dialog.getByRole('textbox', { name: '标准名称', exact: true }).fill(directoryName);
  await dialog.getByRole('button', { name: '新建作品', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: '选择已有作品', exact: true })).toHaveValue(directoryName);
  await expect(dialog.getByRole('button', { name: '保存作品修改', exact: true })).toBeVisible();
  await dialog.locator('summary', { hasText: '更多信息（可选）' }).click();
  await dialog.getByRole('textbox', { name: '别名（逗号分隔）', exact: true }).fill(`别名保存验证-${prefix}`);
  await dialog.getByRole('button', { name: '保存作品修改', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '保存作品修改', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '新建作品 · 清空表单', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: '标准名称', exact: true })).toHaveValue('');
  await expect(dialog.getByRole('textbox', { name: '别名（逗号分隔）', exact: true })).toHaveValue('');
  await dialog.getByRole('combobox', { name: '选择已有作品', exact: true }).selectOption(directoryName);
  await expect(dialog.getByRole('textbox', { name: '别名（逗号分隔）', exact: true })).toHaveValue(`别名保存验证-${prefix}`);
  await page.screenshot({
    path: testInfo.outputPath('works-390.png'),
    fullPage: true,
  });
});
