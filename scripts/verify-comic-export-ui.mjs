import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { readZip } from '../apps/service/dist/activities/zip.js';

const activityId = process.env.STHSTART_COMIC_ACTIVITY_ID;
if (!activityId) throw new Error('STHSTART_COMIC_ACTIVITY_ID is required.');
const outputDir = resolve('artifacts/activity-comic-screenshots', `live-sample-${activityId}`);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:9320/apps/activities/${activityId}?tab=playback&mode=comic`, { waitUntil: 'domcontentloaded' });
  await page.getByText('漫画编辑', { exact: true }).waitFor({ timeout: 20000 });
  const exportButton = page.getByRole('button', { name: '导出当前页 PNG' });
  await exportButton.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === '导出当前页 PNG');
    return button && !button.disabled;
  }, undefined, { timeout: 20000 }).catch(async () => {
    throw new Error(`The current page PNG export stayed disabled: ${(await page.locator('body').innerText()).slice(-700)}`);
  });
  await exportButton.click();
  await page.getByRole('dialog', { name: '导出漫画' }).waitFor();
  const allPages = page.getByRole('button', { name: '导出全部页面 PNG（ZIP）' });
  if (!(await allPages.isEnabled())) throw new Error('The all-pages PNG export is disabled.');
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await allPages.click();
  const download = await downloadPromise;
  const destination = join(outputDir, 'comic-pages.zip');
  await download.saveAs(destination);
  const entries = readZip(await readFile(destination));
  for (const name of ['page-001.png', 'page-002.png']) {
    const png = entries.get(name);
    if (!png || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`${name} missing or invalid.`);
    if (png.readUInt32BE(16) !== 1920 || png.readUInt32BE(20) !== 1080) throw new Error(`${name} is not 1920×1080.`);
    await writeFile(join(outputDir, name), png);
  }
  const readerDir = join(outputDir, 'offline-reader');
  await mkdir(readerDir, { recursive: true });
  const offlineEntries = readZip(await readFile(join(outputDir, 'comic-reader.zip')));
  if ([...offlineEntries.keys()].filter((name) => name.startsWith('assets/images/')).length !== 6) throw new Error('The real offline reader does not contain all six images.');
  for (const [name, contents] of offlineEntries) {
    const destination = resolve(readerDir, name);
    if (!destination.startsWith(`${readerDir}${sep}`)) throw new Error(`Unsafe ZIP entry: ${name}`);
    await mkdir(resolve(destination, '..'), { recursive: true });
    await writeFile(destination, contents);
  }
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const offline = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const externalRequests = [];
    offline.on('pageerror', (error) => errors.push(error.message));
    offline.on('request', (request) => { if (!request.url().startsWith('file://')) externalRequests.push(request.url()); });
    await offline.goto(pathToFileURL(join(readerDir, 'index.html')).href, { waitUntil: 'load' });
    await offline.getByText('就绪 · 点击“下一步”开始阅读。').waitFor({ timeout: 15000 });
    for (let step = 0; step < 12; step++) await offline.getByRole('button', { name: '下一步' }).click();
    await offline.getByText('雪山实验 · 下 · 第 2/2 页').waitFor();
    await offline.screenshot({ path: join(outputDir, `offline-real-${width}x${height}.png`) });
    if (externalRequests.length) throw new Error(`Offline reader made external requests: ${externalRequests.join(', ')}`);
    await offline.close();
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log(destination);
} finally {
  await browser.close();
}
