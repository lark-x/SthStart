import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const service = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT || 4200}`;
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };

test('activity opens on the current screenplay and creates scenes from a single focused action', async ({ page, request }) => {
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  document.activity.title = '简明流程验收活动';
  for (const key of ['messages', 'posts', 'comments', 'likes', 'facts', 'mediaSlots', 'stageResults']) document[key] = [];
  const response = await request.post(`${service}/api/v1/admin/activities`, { headers, data: { document } });
  expect(response.ok()).toBeTruthy();
  const { activity } = await response.json();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/apps/activities/${activity.id}?tab=script`);
  await expect(page.getByRole('heading', { name: '简明流程验收活动' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '场次导轨导航' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '本阶段还没有场次' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建场次（设定时间与地点）' })).toBeVisible();
  await expect(page.getByText('not_configured', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '新建场次（设定时间与地点）' }).click();
  await expect(page.getByRole('heading', { name: '新场次 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑场次' })).toBeVisible();
  await expect(page.getByLabel('场次标题')).toHaveCount(0);
});

test('activity workflow navigation moves to a second row until the header has enough room', async ({ page, request }) => {
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const response = await request.post(`${service}/api/v1/admin/activities`, { headers, data: { document } });
  expect(response.ok()).toBeTruthy();
  const { activity } = await response.json();

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/apps/activities/${activity.id}?tab=script`);
  const compactNavigation = page.getByRole('navigation', { name: '活动流程' });
  await expect(compactNavigation).toBeVisible();
  expect(await compactNavigation.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(52);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();

  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(page.getByRole('navigation', { name: '流水线阶段' })).toBeVisible();
  await expect(compactNavigation).not.toBeVisible();
  expect(await page.getByRole('navigation', { name: '流水线阶段' }).evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(40);
});

test('moving from editing to preview prepares the latest content once without a manual version step', async ({ page, request }) => {
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const response = await request.post(`${service}/api/v1/admin/activities`, { headers, data: { document } });
  expect(response.ok()).toBeTruthy();
  const { activity } = await response.json();
  await page.goto(`/apps/activities/${activity.id}?tab=script`);
  const message = '进入回放前自动准备这条新内容';
  await page.getByRole('button', { name: /对话台词 \(/ }).click();
  await page.getByPlaceholder('追加角色台词或剧本旁白，按回车快速添加…').fill(message);
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByRole('status').getByText('已保存')).toBeVisible({ timeout: 15_000 });
  const workflowNavigation = page.getByRole('navigation', { name: /^(流水线阶段|活动流程)$/ });
  await workflowNavigation.getByRole('button', { name: /回放预览/ }).click();
  await expect(page.getByText('回放编排与设备模拟预览')).toBeVisible();
  const read = async () => (await (await request.get(`${service}/api/v1/admin/activities/${activity.id}`, { headers })).json());
  const published = await read();
  expect(published.currentContentRevision.document.messages.some((item: { text: string }) => item.text === message)).toBeTruthy();
  const version = published.activity.headVersion;
  await workflowNavigation.getByRole('button', { name: /剧情创作/ }).click();
  await workflowNavigation.getByRole('button', { name: /回放预览/ }).click();
  await expect(page.getByText('回放编排与设备模拟预览')).toBeVisible();
  expect((await read()).activity.headVersion).toBe(version);
});

/**
* 阶段字段精简：默认只显示标题与「这一段发生什么」，
* 地点、结束条件、必须发生的行动收进「更多」，展开后仍可编辑。
*/
test('stage fields stay compact until the more section is opened', async ({ page, request }) => {
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const response = await request.post(`${service}/api/v1/admin/activities`, { headers, data: { document } });
  expect(response.ok()).toBeTruthy();
  const { activity } = await response.json();
  await page.goto(`/apps/activities/${activity.id}?tab=settings`);

  // 默认展开第一个阶段：标题与内容安排在，地点/结束条件/必须行动不在。
  await expect(page.getByLabel('阶段 1 标题')).toBeVisible();
  await expect(page.getByLabel('阶段 1 内容安排')).toBeVisible();
  await expect(page.getByText('阶段地点').first()).not.toBeVisible();
  await expect(page.getByText('阶段结束条件').first()).not.toBeVisible();

  // 展开「更多」后这些字段才出现。
  await page.getByText('更多：地点、结束条件与必须发生的行动').first().click();
  await expect(page.getByText('阶段地点').first()).toBeVisible();
  await expect(page.getByText('阶段结束条件').first()).toBeVisible();
  await expect(page.getByText('必须发生的行动').first()).toBeVisible();

  // 必须发生的行动此前没有编辑入口，这里确认能改并落到草稿。
  await page.getByRole('button', { name: '添加行动' }).first().click();
  const beat = page.getByLabel('阶段 1 必须发生的行动 1');
  await beat.fill('确认到场名单');
  await expect(beat).toHaveValue('确认到场名单');
  await expect(page.getByRole('status').getByText('已保存')).toBeVisible({ timeout: 15_000 });
  const saved = await (await request.get(`${service}/api/v1/admin/activities/${activity.id}`, { headers })).json();
  /*
   * 编辑先落在草稿上，只有保存新版本才写进内容版本；这里读草稿来验证改动确实被保存了。
   */
  const draft = await (await request.get(`${service}/api/v1/admin/activities/${activity.id}/draft`, { headers })).json();
  const beats = draft.document.stages[0].requiredBeats;
  expect(beats.some((item: { text: string }) => item.text === '确认到场名单')).toBeTruthy();
});

test('scene title and setting fields are edited in a temporary dialog before applying to the activity draft', async ({ page, request }) => {
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const stageId = document.stages[0].id;
  document.scenes = [{
    id: 'scene-compact-edit-test',
    stageId,
    title: '雪山低温萃取',
    timeText: '傍晚 18:30',
    locationText: '龙脊雪山营地',
    environment: '风雪渐起',
    orderIndex: 0,
    beats: [{
      id: 'beat-compact-edit-test',
      sceneId: 'scene-compact-edit-test',
      stageId,
      characterId: 'narrator',
      characterName: '旁白',
      action: '检查实验记录',
      dialogue: '',
      outcome: '',
      orderIndex: 0,
    }],
  }];
  const response = await request.post(`${service}/api/v1/admin/activities`, { headers, data: { document } });
  expect(response.ok()).toBeTruthy();
  const { activity } = await response.json();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/apps/activities/${activity.id}?tab=script`);

  await expect(page.getByRole('heading', { name: '雪山低温萃取' })).toBeVisible();
  await expect(page.getByLabel('场次标题')).toHaveCount(0);
  await page.getByRole('button', { name: '编辑场次' }).click();
  let dialog = page.getByRole('dialog', { name: '编辑场次' });
  await expect(dialog.getByLabel('场次标题')).toHaveValue('雪山低温萃取');
  await expect(dialog.getByLabel('时间')).toHaveValue('傍晚 18:30');

  await dialog.getByLabel('场次标题').fill('临时标题，不应保存');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  const discard = page.getByRole('dialog', { name: '放弃场次修改？' });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: '继续编辑' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('dialog', { name: '放弃场次修改？' }).getByRole('button', { name: '放弃修改' }).click();
  await expect(page.getByRole('heading', { name: '雪山低温萃取' })).toBeVisible();

  await page.getByRole('button', { name: '编辑场次' }).click();
  dialog = page.getByRole('dialog', { name: '编辑场次' });
  await dialog.getByLabel('场次标题').fill('新的场次标题');
  await dialog.getByLabel('地点').fill('营地实验桌旁');
  await dialog.getByRole('button', { name: '应用修改' }).click();

  await expect(page.getByRole('heading', { name: '新的场次标题' })).toBeVisible();
  await expect(page.getByText('营地实验桌旁')).toBeVisible();
  await expect(page.getByRole('status').getByText('已保存')).toBeVisible({ timeout: 15_000 });
  const draft = await (await request.get(`${service}/api/v1/admin/activities/${activity.id}/draft`, { headers })).json();
  const savedScene = draft.document.scenes.find((item: { id: string }) => item.id === 'scene-compact-edit-test');
  expect(savedScene.title).toBe('新的场次标题');
  expect(savedScene.locationText).toBe('营地实验桌旁');
  expect(savedScene.timeText).toBe('傍晚 18:30');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '编辑场次' }).click();
  dialog = page.getByRole('dialog', { name: '编辑场次' });
  await expect(dialog.getByLabel('场次标题')).toHaveValue('新的场次标题');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await dialog.getByLabel('场次标题').fill('窄屏临时内容');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('dialog', { name: '放弃场次修改？' }).getByRole('button', { name: '放弃修改' }).click();
  await expect(page.getByRole('heading', { name: '新的场次标题' })).toBeVisible();
});

/**
* 群聊与朋友圈的视图内生成入口：按钮存在，自动续聊默认关闭。
*/
test('the AI writing assistant stays collapsed until requested and then exposes its writing modes', async ({ page, request }) => {
  const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
  const response = await request.post(`${service}/api/v1/admin/activities`, { headers, data: { document } });
  expect(response.ok()).toBeTruthy();
  const { activity } = await response.json();
  await page.goto(`/apps/activities/${activity.id}?tab=script`);
  await expect(page.getByRole('button', { name: '展开 AI 助手' })).toBeVisible();
  await page.getByRole('button', { name: '展开 AI 助手' }).click();
  const assistant = page.getByRole('complementary');
  await expect(assistant.getByText('AI 创作伴侣')).toBeVisible();
  await expect(assistant.getByRole('button', { name: /续写对话/ })).toBeVisible();
  await expect(assistant.getByRole('button', { name: /朋友圈文案/ })).toBeVisible();
  await expect(assistant.getByRole('button', { name: '生成候选' })).toBeDisabled();
  await page.getByRole('button', { name: '收起 AI 助手' }).click();
  await expect(page.getByRole('button', { name: '展开 AI 助手' })).toBeVisible();
  const draft = await (await request.get(`${service}/api/v1/admin/activities/${activity.id}/draft`, { headers })).json();
  expect(draft.document.messages.length).toBe(document.messages.length);
});
