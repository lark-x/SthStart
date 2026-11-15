import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorldEvent, WorldEventPage } from '@sthstart/contracts';
const service = 'http://127.0.0.1:4974';
const headers = { 'x-sthstart-admin-token': 'story-worlds-isolated-e2e-admin-token-4974' };
const output = resolve('artifacts/visual-verification/story-worlds');
const api = '/api/v1/admin/story-worlds';
type Fixture = { worldId: string; branchId: string; performanceWorldId: string; performanceBranchId: string; projectId: string; calls: number };
async function fixture(request: APIRequestContext): Promise<Fixture> { return (await request.get(service + '/__fixture')).json(); }
/** 步长与配图额度收在折叠区；按需展开，不假设默认展开状态。 */
async function ensureRunStepFields(dialog: Locator) {
  const step = dialog.getByLabel('单步时长（分钟）');
  if (await step.count() === 0 || !(await step.first().isVisible())) {
    await dialog.locator('details').filter({ hasText: '步长与配图额度' }).locator('summary').click();
  }
  await expect(dialog.getByLabel('单步时长（分钟）')).toBeVisible();
}
async function auth(page: Page) {
  const session = await page.request.post('/api/auth/admin-session', { headers: { origin: 'http://127.0.0.1:4973' } });
  expect(session.ok()).toBe(true);
}
async function detail(request: APIRequestContext, f: Fixture) {
  const response = await request.get(service + api + '/' + f.worldId + '/branches/' + f.branchId, { headers });
  expect(response.ok()).toBe(true);
  return response.json();
}
test('run through shared events, reload, reading, image planning, historical branch and project adoption', async ({ page, request }) => {
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
  const f = await fixture(request);
  await auth(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/apps/story-worlds?world=' + f.worldId + '&branch=' + f.branchId);
  await expect(page.getByRole('heading', { name: '故事世界', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '运行设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '运行设置' });
  await dialog.getByLabel('推进时长（分钟）').fill('60');
  await ensureRunStepFields(dialog);
  await dialog.getByLabel('单步时长（分钟）').fill('60');
  await dialog.getByLabel('文本调用硬额度').fill('40');
  await dialog.getByRole('button', { name: '启动运行', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await detail(request, f)).run?.status, { timeout: 25000 }).toBe('completed');
  await page.reload();
  await page.getByRole('tab', { name: /故事阅读/ }).click();
  await expect(page.getByText('港口的重逢', { exact: true }).first()).toBeVisible();
  const eventResponse = await request.get(service + api + '/' + f.worldId + '/branches/' + f.branchId + '/events', { headers });
  const eventPage = await eventResponse.json() as WorldEventPage; const events = eventPage.items;
  expect(events.length).toBe(4);
  expect(events.find(e => e.participantIds.length === 2)!.perspectives).toHaveLength(2);
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: resolve(output, 'reading-desktop.png'), fullPage: true });

  const meeting = events.find(e => e.participantIds.length === 2)!;
  const meetingArticle = page.locator('article').filter({ has: page.getByRole('heading', { name: meeting.title, exact: true }) });
  await expect(meetingArticle.getByText(meeting.summary, { exact: true })).toHaveCount(1);
  for (const passage of meeting.perspectives) await expect(meetingArticle.getByText(passage.text, { exact: true })).toHaveCount(0);
  await meetingArticle.getByRole('button', { name: '林舟视角', exact: true }).click();
  await expect(meetingArticle.getByText('正在阅读「林舟」的个人视角记录', { exact: true })).toBeVisible();
  await expect(meetingArticle.getByText(meeting.perspectives.find(p => p.actorId === 'actor-0')!.text, { exact: true })).toBeVisible();
  await expect(meetingArticle.getByText(meeting.summary, { exact: true })).toHaveCount(0);
  await expect(meetingArticle.getByText(meeting.perspectives.find(p => p.actorId === 'actor-1')!.text, { exact: true })).toHaveCount(0);

  // Browser-only response fixture: no event writes and no fixture-service edits.
  // The absent participant still has a button; the recorded nonparticipant
  // author remains accessible. State/fact prose are unique for fold assertions.
  const sleepText = '苏禾在铺位上继续安睡，这一小时没有醒来。';
  const observerText = '遥音记下了值夜期间自己的安静休息。';
  const fixtureEvent: WorldEvent = { ...structuredClone(meeting), id: 'reader-missing-perspective', tick: 59, duration: 1,
    title: '夜间休息记录', summary: '夜间客观记录：两人在各自铺位休息。', participantIds: ['actor-0', 'actor-1'],
    facts: [{ id: 'reader-private-fact', content: '苏禾仍在自己的铺位休息。', knownBy: ['actor-1'], nature: 'ai' }],
    perspectives: [{ actorId: 'actor-1', text: sleepText }, { actorId: 'actor-2', text: observerText }], causeEventIds: [], storyLineIds: [],
    stateChanges: [{ actorId: 'actor-1', locationId: meeting.locationId, emotion: '测试专用：安稳休息', goals: ['天亮后再整理行李'], relationships: [], updatedTick: 60 }],
  };
  const browserEventPage: WorldEventPage = { ...eventPage, items: [...events, fixtureEvent], total: eventPage.total + 1 };
  const fixturePath = '/api/admin/story-worlds/' + f.worldId + '/branches/' + f.branchId + '/events';
  const eventRoute = (url: URL) => url.pathname === fixturePath;
  await page.route(eventRoute, async route => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.fulfill({ response, json: browserEventPage });
  });
  const fixtureResponses: { pathname: string; body: unknown }[] = [];
  for (const pathname of ['/api/admin/story-worlds', '/api/admin/story-worlds/' + f.worldId,
    '/api/admin/story-worlds/' + f.worldId + '/branches/' + f.branchId, fixturePath]) {
    const response = await page.request.get(pathname); expect(response.ok()).toBe(true);
    fixtureResponses.push({ pathname, body: pathname === fixturePath ? browserEventPage : await response.json() });
  }
  const fixtureDirectory = resolve('artifacts/story-worlds-implementation'); mkdirSync(fixtureDirectory, { recursive: true });
  writeFileSync(resolve(fixtureDirectory, 'reader-browser-fixture.json'), JSON.stringify({ worldId: f.worldId, branchId: f.branchId, responses: fixtureResponses }, null, 2));

  await page.reload(); await page.getByRole('tab', { name: /故事阅读/ }).click();
  const reader = page.locator('.sw-reader');
  const missingArticle = reader.locator('article').filter({ has: page.getByRole('heading', { name: fixtureEvent.title, exact: true }) });
  await expect(missingArticle.getByText(fixtureEvent.summary, { exact: true })).toHaveCount(1);
  for (const text of [sleepText, observerText]) await expect(missingArticle.getByText(text, { exact: true })).toHaveCount(0);
  for (const name of ['林舟', '苏禾', '遥音']) await expect(missingArticle.getByRole('button', { name: name + '视角', exact: true })).toHaveCount(1);
  // Choosing the actor filter must select that actor even without a passage.
  await reader.getByRole('button', { name: /^林舟\s+\d+$/ }).click();
  await expect(missingArticle.getByText('此事件尚未记录「林舟」的个人视角。', { exact: true })).toBeVisible();
  await expect(missingArticle.getByRole('button', { name: '林舟视角', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const text of [fixtureEvent.summary, sleepText, observerText]) await expect(missingArticle.getByText(text, { exact: true })).toHaveCount(0);
  await missingArticle.getByRole('button', { name: '切换为客观叙述', exact: true }).click();
  await expect(missingArticle.getByText(fixtureEvent.summary, { exact: true })).toHaveCount(1);
  await missingArticle.getByRole('button', { name: '遥音视角', exact: true }).click();
  await expect(missingArticle.getByText(observerText, { exact: true })).toBeVisible();
  await missingArticle.getByRole('button', { name: '苏禾视角', exact: true }).click();
  await expect(missingArticle.getByText(sleepText, { exact: true })).toBeVisible();
  await expect(missingArticle.getByText('正在阅读「苏禾」的个人视角记录', { exact: true })).toBeVisible();
  await expect(missingArticle.getByText(/第一人称/)).toHaveCount(0);
  await expect(missingArticle.getByText(fixtureEvent.summary, { exact: true })).toHaveCount(0);

  for (const section of [
    { name: /沉淀事实与认知边界/, text: fixtureEvent.facts[0].content },
    { name: /角色心理与关系演变/, text: '情绪：' + fixtureEvent.stateChanges[0].emotion },
  ]) {
    const button = missingArticle.getByRole('button', { name: section.name });
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(missingArticle.getByText(section.text, { exact: true })).toHaveCount(0);
    await button.click(); await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(missingArticle.getByText(section.text, { exact: true })).toBeVisible();
    await button.click(); await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(missingArticle.getByText(section.text, { exact: true })).toHaveCount(0);
  }
  await reader.getByRole('button', { name: /全部事件长卷/ }).click();
  await missingArticle.getByRole('button', { name: '客观叙述', exact: true }).click();
  for (const size of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await expect(meetingArticle.getByText(meeting.summary, { exact: true })).toBeVisible();
    await reader.evaluate(element => {
      for (let parent: HTMLElement | SVGElement | null = element; parent; parent = parent.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent.scrollTop = 0;
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(600);
    const dimensions = await reader.evaluate(element => ({
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      readerOverflow: element.scrollWidth - element.clientWidth,
    }));
    expect(dimensions.pageOverflow, 'page horizontal overflow at ' + size.width).toBe(0);
    expect(dimensions.readerOverflow, 'reader horizontal overflow at ' + size.width).toBe(0);
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: resolve(output, 'reader-' + size.width + '.png'), fullPage: true });
    if (size.width === 1440) {
      const theme = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, mode: document.documentElement.dataset.colorMode,
        eyeCare: document.documentElement.getAttribute('data-eye-care'), scheme: document.documentElement.style.colorScheme }));
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark-espresso'; document.documentElement.dataset.colorMode = 'dark';
        document.documentElement.style.colorScheme = 'dark'; document.documentElement.removeAttribute('data-eye-care'); });
      await page.waitForTimeout(600); await page.screenshot({ path: resolve(output, 'reader-dark.png'), fullPage: true });
      await page.evaluate(previous => {
        if (previous.theme === undefined) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = previous.theme;
        if (previous.mode === undefined) delete document.documentElement.dataset.colorMode; else document.documentElement.dataset.colorMode = previous.mode;
        if (previous.eyeCare === null) document.documentElement.removeAttribute('data-eye-care'); else document.documentElement.setAttribute('data-eye-care', previous.eyeCare);
        document.documentElement.style.colorScheme = previous.scheme;
      }, theme);
    }
  }
  await page.unroute(eventRoute); await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload(); await page.getByRole('tab', { name: /故事阅读/ }).click();
  await expect(reader.getByRole('heading', { name: fixtureEvent.title, exact: true })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  // Plan via the real UI selection panel, then assert the actual persisted task plan.
  await page.getByRole('button', { name: '港口的重逢', exact: true }).click();
  const planButton = page.getByRole('button', { name: '规划配图', exact: true }).first();
  await expect(planButton).toBeVisible();
  await planButton.click();
  const planDialog = page.getByRole('dialog', { name: /配图/ });
  await expect(planDialog).toBeVisible();
  if (!(await planDialog.getByRole('checkbox').first().isChecked())) await planDialog.getByRole('checkbox').first().check();
  await planDialog.getByRole('button', { name: /生成配图计划|规划配图|创建配图计划/ }).click();
  await expect(planDialog).not.toBeVisible();
  await expect.poll(async () => (await detail(request, f)).images.length).toBeGreaterThan(0);
  // Backend versions are also checked independently of rendering and preserved on adoption.
  await page.getByRole('button',{name:'故事世界操作',exact:true}).click();
  await page.getByRole('menuitem',{name:'从历史节点分支',exact:true}).click();
  const forkDialog=page.getByRole('dialog',{name:'新建世界分支'});
  await forkDialog.getByLabel('分支标题').fill('另一个归航日');
  await forkDialog.getByLabel('与原作的关系',{exact:true}).selectOption('adaptation');
  await forkDialog.getByLabel('分叉时刻（分钟）',{exact:true}).fill('1');
  const forkResponse=page.waitForResponse(r=>r.url().endsWith('/branches')&&r.request().method()==='POST');
  await forkDialog.getByRole('button',{name:'创建分支',exact:true}).click();
  const fork=await forkResponse;expect(fork.status()).toBe(201);
  await expect(forkDialog).not.toBeVisible();
  const forkId = (await fork.json()).id;
  const forkEvents = await request.get(service + api + '/' + f.worldId + '/branches/' + forkId + '/events', { headers });
  expect((await forkEvents.json()).items).toHaveLength(3);
  await page.goto('/apps/story-worlds?world='+f.worldId+'&branch='+f.branchId);
  await page.getByRole('tab',{name:/故事阅读/}).click();
  await page.getByRole('button', { name: '港口的重逢', exact: true }).click();
  await page.getByRole('button',{name:'采纳',exact:true}).first().click();
  const adoptDialog=page.getByRole('dialog',{name:'采纳进创作项目'});
  await adoptDialog.getByRole('combobox', { name: /^创作项目/ }).selectOption(f.projectId);
  await adoptDialog.getByLabel(/^采纳标题/).fill('归航第一章');
  // 新表单独立读取分支事件并提供预览；确认点击事件默认已选中，否则补选。
  await expect(adoptDialog.getByRole('heading', { name: '章节预览', exact: true })).toBeVisible();
  const eventCheckbox = adoptDialog.getByRole('checkbox', { name: '选择事件 港口的重逢', exact: true });
  await expect(eventCheckbox).toBeVisible();
  if (!(await eventCheckbox.isChecked())) await eventCheckbox.check();
  await expect(adoptDialog.getByText(/正文 \d+ 字符/)).toBeVisible();
  await adoptDialog.getByRole('button',{name:'绑定到当前分支',exact:true}).click();
  await expect(adoptDialog.getByText('当前绑定：本世界 · 当前分支')).toBeVisible();
  const adoptionResponse=page.waitForResponse(r=>r.url().endsWith('/adopt')&&r.request().method()==='POST');
  await adoptDialog.getByRole('button',{name:'采纳到项目',exact:true}).click();
  const adopted=await adoptionResponse;expect(adopted.status()).toBe(200);
  const record = await adopted.json();
  await page.goto('/apps/story/' + f.projectId);
  await expect(page.getByRole('textbox', { name: '条目标题', exact: true })).toHaveValue('归航第一章');
  await expect(page.getByRole('textbox', { name: '小说正文编辑', exact: true })).toHaveValue(/港口的重逢/);
  expect(record.sourceBranchId).toBe(f.branchId);

  const latestBody = '从世界采纳后继续编辑的正文。两人在港口重逢，约好稍后同行。';
  await page.getByRole('textbox', { name: '小说正文编辑', exact: true }).fill(latestBody);
  const savedDocument = page.waitForResponse(r => r.request().method() === 'PUT'
    && r.url().endsWith('/documents/' + record.documentId));
  await page.keyboard.press('Control+s');
  expect((await savedDocument).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole('textbox', { name: '小说正文编辑', exact: true })).toHaveValue(latestBody);
  await page.getByRole('button', { name: '更多项目操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '制作作品', exact: true }).click();
  const productionDialog = page.getByRole('dialog', { name: '创建制作版本' });
  await expect(productionDialog.getByRole('checkbox').first()).toBeChecked();
  await productionDialog.getByRole('button', { name: '创建制作版本', exact: true }).click();
  await page.waitForURL(url => url.pathname.startsWith('/apps/activities/'), { timeout: 20_000 });
  await expect(page.getByTestId('publication-workspace')).toBeVisible({ timeout: 20_000 });
  const activityId = page.url().split('/').at(-1)!;
  const revisionsResponse = await request.get(service + '/api/v1/admin/story/projects/' + f.projectId
    + '/entries/chapter/' + record.documentId + '/revisions', { headers });
  expect(revisionsResponse.ok()).toBe(true);
  const revisions = (await revisionsResponse.json()).items;
  expect(revisions[0].snapshot.body).toBe(latestBody);
  const readProduction = async () => {
    const r = await request.get(service + '/api/v1/admin/activities/' + activityId + '/publication', { headers });
    expect(r.ok()).toBe(true); return r.json();
  };
  expect((await readProduction()).document.source.entryRevisionIds).toContain(revisions[0].id);
  await page.getByRole('button', { name: '添加关键镜头', exact: true }).click();
  await page.getByRole('tab', { name: '2. 画面与配音', exact: true }).click();
  await page.getByRole('region', { name: '对白与配音编辑' }).getByRole('button', { name: '添加一句对白', exact: true }).click();
  await page.getByRole('textbox', { name: '第1句对白', exact: true }).fill('从港口开始的新故事。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByTestId('publication-workspace').locator('header').getByText('已保存', { exact: true })).toBeVisible();
  expect((await readProduction()).document.shots[0].utterances[0].text).toBe('从港口开始的新故事。');
  await page.reload();
  await page.getByRole('tab', { name: '2. 画面与配音', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '第1句对白', exact: true })).toHaveValue('从港口开始的新故事。');
});

test('twelve characters and one thousand events have bounded windows and usable viewport layouts', async ({ page, request }) => {
  const f = await fixture(request);
  await auth(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const windows: number[] = [];
  page.on('response', response => {
    if (response.url().includes('/events?')) void response.json().then(body => windows.push(body.items?.length ?? 0)).catch(() => {});
  });
  for (const size of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    const start = Date.now();
    await page.goto('/apps/story-worlds?world=' + f.performanceWorldId + '&branch=' + f.performanceBranchId);
    await expect(page.getByRole('heading', { name: '故事世界', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: /故事流/ }).click();
    await expect(page.locator('.react-flow')).toBeVisible();
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
    await page.waitForTimeout(600);
    const geometry = await page.evaluate(() => {
      const box = document.querySelector('.react-flow')!.getBoundingClientRect();
      const nodes = [...document.querySelectorAll('.react-flow__node')];
      return { width: document.documentElement.scrollWidth, viewport: innerWidth, nodes:nodes.length,
        intersecting:nodes.filter(n=>{const r=n.getBoundingClientRect();return r.right>box.left && r.left<box.right && r.bottom>box.top && r.top<box.bottom;}).length };
    });
    expect(geometry.width).toBeLessThanOrEqual(size.width + 1);
    expect(geometry.nodes).toBeLessThan(200);
    expect(geometry.intersecting, 'actual event nodes must intersect the clipped canvas').toBeGreaterThan(0);
    mkdirSync(output, { recursive: true });
    await page.screenshot({ path: resolve(output, 'flow-' + size.width + '.png'), fullPage: true });
    if (size.width === 1440) {
      const transform=await page.locator('.react-flow__viewport').getAttribute('style');
      await page.getByRole('button',{name:'放大',exact:true}).click();
      await expect(page.locator('.react-flow__viewport')).not.toHaveAttribute('style',transform!);
      await page.evaluate(()=>{document.documentElement.dataset.theme='dark-espresso';document.documentElement.dataset.colorMode='dark';document.documentElement.style.colorScheme='dark';document.documentElement.removeAttribute('data-eye-care');});
      await page.screenshot({path:resolve(output,'flow-dark.png'),fullPage:true});
      await page.evaluate(()=>{document.documentElement.dataset.theme='light-paper';document.documentElement.dataset.colorMode='light';document.documentElement.style.colorScheme='light';document.documentElement.dataset.eyeCare='true';});
    }
    await page.getByRole('tab', { name: /故事阅读/ }).click();
    await expect(page.getByText('港口生活片段 1', { exact: true }).first()).toBeVisible();
    if (size.width === 390) await page.screenshot({ path: resolve(output, 'reading-mobile.png'), fullPage: true });
    test.info().annotations.push({ type: 'timing', description: size.width + 'px ready and reading ' + (Date.now() - start) + 'ms' });
  }
  expect(windows.length).toBeGreaterThan(0);
  expect(windows.every(count => count <= 200)).toBe(true);
  expect(errors).toEqual([]);
});
