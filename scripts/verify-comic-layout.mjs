import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

const baseUrl = process.env.STHSTART_SCREENSHOT_BASE_URL || 'http://localhost:9320';
const outputDir = resolve('artifacts/activity-comic-screenshots', `repair-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`);
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(new URL('/apps/activities', baseUrl).toString(), { waitUntil: 'domcontentloaded' });
  const firstActivityHref = await page.locator('a[href*="/apps/activities/"]').evaluateAll((anchors) =>
    anchors.map((anchor) => anchor.getAttribute('href')).find((href) => /^\/apps\/activities\/[^/?#]+$/.test(href ?? '')) ?? null);
  const activityHref = process.env.STHSTART_COMIC_ACTIVITY_URL || firstActivityHref;
  if (!activityHref) throw new Error('没有可用于截图的活动。');
  if (process.env.STHSTART_COMIC_LAYOUT_FIXTURE === 'true') {
    const activityId = activityHref.split('/').at(-1);
    const database = new DatabaseSync(resolve('data/sthstart.db'), { readOnly: true });
    const row = database.prepare(`SELECT r.id,r.document_json FROM activities a
      JOIN activity_content_revisions r ON r.id=a.current_content_revision_id WHERE a.id=?`).get(activityId);
    database.close();
    const revision = row ? { id: row.id } : null;
    const content = row ? JSON.parse(row.document_json) : null;
    const stage = content?.stages.find((item) => (content.scenes ?? []).some((scene) => scene.stageId === item.id && scene.beats.length > 0));
    const scene = content?.scenes.find((item) => item.stageId === stage?.id && item.beats.length > 0);
    const beat = scene?.beats[0];
    if (!revision || !stage || !scene || !beat) throw new Error('活动剧情缺少可用的来源镜头。');
    const panels = Array.from({ length: 6 }, (_, index) => ({
      id: `layout-panel-${index + 1}`, source: { stageId: stage.id, sceneId: scene.id, beatIds: [beat.id] },
      actorIds: beat.characterId ? [beat.characterId] : [], shotSize: 'medium',
      visualDescription: `${index + 1}. ${beat.action}`, composition: '人物位于画面中央', textSafeArea: 'top_left',
      selectedImage: null, crop: { focalX: 0.5, focalY: 0.5, zoom: 1 },
      bubbles: [{ id: `layout-bubble-${index + 1}`, kind: 'speech', speakerActorId: beat.characterId || null,
        text: index % 2 ? '结晶在低温环境中出现了新的变化。' : '请仔细观察这次实验的结果。',
        rect: { x: 0.08, y: 0.06, width: 0.62, height: 0.26 }, tail: null, fontSize: 32 }],
      presentation: { camera: 'none', impact: 'none', holdMs: null }, renderSettings: {},
    }));
    const draft = { activityId, draftVersion: 2, baseRevisionId: null, updatedAt: new Date().toISOString(), document: {
      schemaVersion: 1, contentRevisionId: revision.id, style: 'ink-paper-v1', canvas: { width: 1920, height: 1080 },
      pages: [{ id: 'layout-page-1', title: '第一页', template: 'trio', panelIds: panels.slice(0, 3).map((item) => item.id) },
        { id: 'layout-page-2', title: '第二页', template: 'trio', panelIds: panels.slice(3).map((item) => item.id) }], panels,
    } };
    await page.route(`**/api/admin/activities/${activityId}/comic/draft`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ draft }) }));
  }

  for (const [width, height] of [[1440, 900], [1920, 1080], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(new URL(`${activityHref}?tab=playback&mode=comic`, baseUrl).toString(), { waitUntil: 'domcontentloaded' });
    try { await page.getByText('漫画编辑', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 }); }
    catch (error) { throw new Error(`${activityHref} 没有进入漫画编辑：${(await page.locator('body').innerText()).slice(0, 500)}`, { cause: error }); }
    await page.getByRole('region', { name: '镜头绘制历史' }).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
    const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    if (size.document > size.viewport + 1 || size.body > size.viewport + 1) throw new Error(`${width}px 视口发生横向溢出：${JSON.stringify(size)}`);
    await page.screenshot({ path: resolve(outputDir, `comic-${width}x${height}.png`) });
    if (width === 390) {
      const panelTab = page.getByRole('button', { name: '第 1 格' });
      if (await panelTab.isVisible()) {
        console.log('窄屏画格切换按钮', await panelTab.boundingBox());
        await page.getByRole('button', { name: '编辑选中画格' }).click();
        await page.screenshot({ path: resolve(outputDir, 'comic-inspector-390x844.png') });
      } else if (!(await page.getByText('漫画草稿还没有页面').isVisible())) {
        throw new Error('窄屏既没有画格切换按钮，也没有正确显示空草稿状态。');
      }
    }
  }
  if (errors.length) throw new Error(`浏览器页面异常：${errors.join('；')}`);
  console.log(outputDir);
} finally {
  await browser.close();
}
