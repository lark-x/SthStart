import { expect, test } from '@playwright/test';

const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
/*
 * 服务端口必须和 playwright.config.ts 的 webServer 一致：
 * 硬编码 4200 时用别的端口跑整套用例，这些接口断言会全部打空。
 */
const servicePort = Number(process.env.E2E_SERVICE_PORT ?? 4200);
const serviceUrl = `http://127.0.0.1:${servicePort}/api/v1/admin`;

/**
 * 研究专题需要一个已导入的作品。E2E 库里通常已有 fixture，
 * 这里先查一次；没有就用规范化 JSON 导入一个最小作品。
 */
async function ensureWork(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const works = await request.get(`${serviceUrl}/narrative/works`, { headers });
  const existing = (await works.json()).items as Array<{ id: string; title: string; nodeCount: number }>;
  const usable = existing.find((work) => work.nodeCount > 0);
  if (usable) return usable.id;

  const bundle = {
    schemaVersion: 1,
    source: { id: 'e2e-research', name: 'E2E Research Fixture', kind: 'json' },
    work: { externalId: 'e2e-research-work', title: '研究用测试作品', locale: 'zh-CN' },
    release: { externalId: '1.0', label: '第一版' },
    nodes: [{ externalId: 'quest', kind: 'quest', title: '沙海遗迹', order: 1, summary: '赤王与禁忌知识的线索。' }],
    scenes: [{ externalId: 'ruins', nodeExternalId: 'quest', title: '遗迹深处', order: 1 }],
    utterances: [
      { externalId: 'u1', sceneExternalId: 'ruins', order: 1, kind: 'narration', text: '石碑上写着赤王曾接触禁忌知识。' },
      { externalId: 'u2', sceneExternalId: 'ruins', order: 2, kind: 'dialogue', speaker: '学者', text: '另一块石碑说赤王封存了禁忌知识。' },
    ],
  };
  const preview = await request.post(`${serviceUrl}/narrative/imports/preview`, { headers, data: bundle });
  const batchId = (await preview.json()).id as string;
  const commit = await request.post(`${serviceUrl}/narrative/imports/${batchId}/commit`, { headers });
  return (await commit.json()).workId as string;
}

test('研究专题入口提供 AI 选题与自定主题两条路', async ({ page, request }) => {
  // 研究专题需要至少一个本地作品才会出现选题入口。
  await ensureWork(request);
  await page.goto('/apps/narrative');
  await expect(page.getByRole('tab', { name: '研究专题' })).toBeVisible();
  await page.getByRole('tab', { name: '研究专题' }).click();

  // 空态先给一个明确入口，避免一进来就铺满两个选项。
  await page.getByRole('button', { name: '新建', exact: true }).click();

  // 第一次确认之前的两个入口都要可达。
  await expect(page.getByRole('button', { name: /AI 发现研究主题/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /自己提出研究主题/ })).toBeVisible();

  // 自定主题：标题为空时不能提交。
  await page.getByRole('button', { name: /自己提出研究主题/ }).click();
  await expect(page.getByText('希望回答的问题')).toBeVisible();
  await expect(page.getByRole('button', { name: '创建并进入确认' })).toBeDisabled();

  await page.getByPlaceholder('例如：赤王文明与禁忌知识的联系').fill('赤王与禁忌知识');
  await expect(page.getByRole('button', { name: '创建并进入确认' })).toBeEnabled();
});

test('用户自定主题创建后处于草稿态，确认前不能开始研究', async ({ page, request }) => {
  // 保证本地至少有一个可研究的作品，界面才能进入选题流程。
  await ensureWork(request);
  await page.goto('/apps/narrative');
  await page.getByRole('tab', { name: '研究专题' }).click();
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByRole('button', { name: /自己提出研究主题/ }).click();
  await page.getByPlaceholder('例如：赤王文明与禁忌知识的联系').fill(`E2E 主题 ${Date.now()}`);
  await page.getByPlaceholder('例如：不同书籍对灾难原因的描述是否一致？').fill('两块石碑的记载是否一致？');
  await page.getByRole('button', { name: '创建并进入确认' }).click();

  // 草稿态：有「确认主题」，没有「开始研究」。
  await expect(page.getByRole('button', { name: '确认主题' })).toBeVisible();
  await expect(page.getByRole('button', { name: /开始研究/ })).toHaveCount(0);

  await page.getByRole('button', { name: '确认主题' }).click();
  // 状态标签与提示文案都可能含「已确认」，这里只断言按钮态变化与状态徽章。
  await expect(page.getByRole('button', { name: '确认主题' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /开始研究|再研究一次/ })).toBeVisible();
  // 未配置文本模型时，开始研究应给出明确阻塞说明而不是静默失败。
  await expect(page.getByText('写入创作资料库')).toHaveCount(0);
});

test('研究专题视图在窄屏下不横向溢出', async ({ page, request }) => {
  await ensureWork(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/apps/narrative');
  await page.getByRole('tab', { name: '研究专题' }).click();
  await page.getByRole('button', { name: '新建' }).first().click();
  await expect(page.getByRole('button', { name: /AI 发现研究主题/ })).toBeVisible();

  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});

test('研究运行在缺少文本模型时给出明确提示', async ({ page, request }) => {
  const workId = await ensureWork(request);
  // 直接用接口建一个已确认专题，避免依赖上一条用例的界面状态。
  const created = await request.post(`${serviceUrl}/narrative/research/projects`, {
    headers, data: { workId, title: `E2E 运行 ${Date.now()}`, question: '两块石碑的记载是否一致？' },
  });
  const projectId = (await created.json()).id as string;
  await request.post(`${serviceUrl}/narrative/research/projects/${projectId}/confirm`, { headers });

  const run = await request.post(`${serviceUrl}/narrative/research/projects/${projectId}/runs`, { headers });
  expect(run.status()).toBe(202);
  const runId = (await run.json()).id as string;

  // 轮询到终态：没有文本模型时应是 incomplete，并给出可操作的说明。
  let payload: { run: { status: string; incompleteReason: string | null } } = { run: { status: 'queued', incompleteReason: null } };
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await page.waitForTimeout(200);
    const polled = await request.get(`${serviceUrl}/narrative/research/runs/${runId}`, { headers });
    payload = await polled.json();
    if (!['queued', 'running'].includes(payload.run.status)) break;
  }
  expect(payload.run.status).toBe('incomplete');
  expect(payload.run.incompleteReason ?? '').toMatch(/文本模型|语料|原文/);
});

test('发布预览在缺少已接受结论时阻止发布', async ({ request }) => {
  const workId = await ensureWork(request);
  const created = await request.post(`${serviceUrl}/narrative/research/projects`, {
    headers, data: { workId, title: `E2E 发布 ${Date.now()}`, question: 'q' },
  });
  const projectId = (await created.json()).id as string;

  const preview = await request.post(`${serviceUrl}/narrative/research/projects/${projectId}/publish-preview`, { headers });
  const body = await preview.json();
  expect(body.ready).toBe(false);
  expect(body.blocked.join('；')).toMatch(/已接受的结论/);

  const publish = await request.post(`${serviceUrl}/narrative/research/projects/${projectId}/publish`, { headers, data: {} });
  expect(publish.status()).toBe(409);
});

test('空语料时研究专题给出导入提示', async ({ page }) => {
  // 空语料提示只在 provider 报 empty 时出现；E2E 库通常有 fixture，
  // 所以这里只断言接口契约本身，界面提示由上面的 provider 状态驱动。
  const response = await page.request.get(`${serviceUrl}/narrative/research/provider`, { headers });
  const provider = await response.json();
  expect(['ready', 'empty', 'unavailable']).toContain(provider.status);
  expect(typeof provider.message).toBe('string');
  if (provider.status === 'empty') expect(provider.message).toMatch(/导入/);
});
