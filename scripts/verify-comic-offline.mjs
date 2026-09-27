import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { ServiceDatabase, nowIso } from '../apps/service/dist/database.js';
import { readConfig } from '../apps/service/dist/config.js';
import { buildComicOfflineReaderZip } from '../apps/service/dist/activities/comic-exports.js';
import { readZip } from '../apps/service/dist/activities/zip.js';

const outputDir = resolve('artifacts/activity-comic-screenshots', `offline-smoke-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`);
const readerDir = join(outputDir, 'reader');
await mkdir(readerDir, { recursive: true });
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=', 'base64');
const imagePath = join(outputDir, 'sample.png');
await writeFile(imagePath, image);
const database = new ServiceDatabase(':memory:');
const now = nowIso();
database.connection.prepare(`INSERT OR IGNORE INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
  VALUES ('activities','Activities','offline-smoke-test','[]',1,?,?)`).run(now, now);
database.connection.prepare(`INSERT INTO artifacts(id,app_id,local_path,content_type,byte_size,created_at,media_type,file_status)
  VALUES ('comic-smoke-image','activities',?,'image/png',?,?,'image','ready')`).run(imagePath, image.length, now);

const panels = Array.from({ length: 6 }, (_, index) => ({
  id: `panel-${index + 1}`, source: { stageId: 'stage-1', sceneId: 'scene-1', beatIds: [`beat-${index + 1}`] },
  actorIds: ['albedo'], shotSize: 'medium', visualDescription: `阿贝多观察第 ${index + 1} 次结晶实验`,
  composition: '雪山营地中的实验桌', textSafeArea: 'top_left',
  selectedImage: { artifactId: 'comic-smoke-image', origin: 'comic_render', renderJobId: 'job-1', sourceFingerprint: 'smoke' },
  crop: { focalX: 0.5, focalY: 0.5, zoom: 1 },
  bubbles: [{ id: `bubble-${index + 1}`, kind: 'speech', speakerActorId: 'albedo', text: `第 ${index + 1} 格：请观察雪山结晶。`,
    rect: { x: 0.05, y: 0.05, width: 0.8, height: 0.3 }, tail: { x: 0.5, y: 0.8 }, fontSize: 32 }],
  presentation: { camera: 'none', impact: 'none', holdMs: null }, renderSettings: {},
}));
const document = {
  schemaVersion: 1, contentRevisionId: 'sample-revision', style: 'ink-paper-v1', canvas: { width: 1920, height: 1080 },
  pages: [
    { id: 'page-1', title: '雪山实验 · 上', template: 'trio', panelIds: panels.slice(0, 3).map((panel) => panel.id) },
    { id: 'page-2', title: '雪山实验 · 下', template: 'trio', panelIds: panels.slice(3).map((panel) => panel.id) },
  ], panels,
};
const config = readConfig({ STHSTART_ADMIN_TOKEN: 'offline-smoke-admin-token-1234567890', STHSTART_ARTIFACT_DIR: outputDir });
const archive = buildComicOfflineReaderZip({ database, config, activityId: 'sample-activity', document, revisionId: 'sample-revision' });
database.close();
await writeFile(join(outputDir, 'comic-reader.zip'), archive);
for (const [relativePath, contents] of readZip(archive)) {
  const destination = resolve(readerDir, relativePath);
  if (!destination.startsWith(`${readerDir}${sep}`)) throw new Error(`ZIP 路径越界：${relativePath}`);
  await mkdir(resolve(destination, '..'), { recursive: true });
  await writeFile(destination, contents);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height, isMobile] of [[1440, 900, false], [390, 844, true]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    const externalRequests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (!request.url().startsWith('file://')) externalRequests.push(request.url()); });
    await page.goto(pathToFileURL(join(readerDir, 'index.html')).href, { waitUntil: 'load' });
    await page.getByText('就绪 · 点击“下一步”开始阅读。').waitFor({ timeout: 15000 });
    for (let step = 0; step < 6; step++) await page.getByRole('button', { name: '下一步' }).click();
    await page.getByText('雪山实验 · 上 · 第 1/2 页').waitFor();
    if (!isMobile) {
      await page.locator('#comic-canvas').screenshot({ path: join(outputDir, 'page-001.png') });
    }
    await page.screenshot({ path: join(outputDir, `reader-${width}x${height}-page-1.png`) });
    for (let step = 0; step < 6; step++) await page.getByRole('button', { name: '下一步' }).click();
    await page.getByText('雪山实验 · 下 · 第 2/2 页').waitFor();
    if (!isMobile) {
      await page.locator('#comic-canvas').screenshot({ path: join(outputDir, 'page-002.png') });
    } else if (!(await page.getByText('第 6 格：请观察雪山结晶。').isVisible())) {
      throw new Error('窄屏离线阅读没有展示当前格台词。');
    }
    await page.screenshot({ path: join(outputDir, `reader-${width}x${height}-page-2.png`) });
    if (errors.length || externalRequests.length) throw new Error(`离线阅读异常：${JSON.stringify({ errors, externalRequests })}`);
    await page.close();
  }
  console.log(outputDir);
} finally {
  await browser.close();
}
