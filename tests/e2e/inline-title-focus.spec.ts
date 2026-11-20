import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeCharacterDraftV2 } from '@sthstart/contracts';
import { isOwnedDirectory } from './global-setup';

const portal = `http://127.0.0.1:${process.env.E2E_PORTAL_PORT ?? 4273}`;
const service = `http://127.0.0.1:${process.env.E2E_SERVICE_PORT ?? 4200}/api/v1/admin`;
const headers = { 'x-sthstart-admin-token': 'sthstart-e2e-secret-0123456789abcdef' };
const directory = resolve('artifacts/visual-verification/resources-polish');

test.use({ serviceWorkers: 'block', deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });

async function focusInline(page: Page, input: Locator, screenshot: string) {
  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute('data-ui-variant', 'inline');
  // Re-enter from the keyboard so the screenshot includes :focus-visible.
  await input.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(input).toBeFocused();
  await expect.poll(() => input.evaluate(node => {
    const style = getComputedStyle(node);
    return {
      top: style.borderTopWidth,
      left: style.borderLeftWidth,
      right: style.borderRightWidth,
      outline: style.outlineStyle,
      background: style.backgroundColor,
    };
  })).toEqual({ top: '0px', left: '0px', right: '0px', outline: 'none', background: 'rgba(0, 0, 0, 0)' });
  const focus = await input.evaluate(node => {
    const style = getComputedStyle(node);
    return { bottom: parseFloat(style.borderBottomWidth), shadow: style.boxShadow };
  });
  // A visible underline may be a border or an inset shadow; an outer halo is not allowed.
  expect(focus.bottom > 0 || focus.shadow.includes('inset')).toBe(true);
  expect(focus.shadow === 'none' || focus.shadow.includes('inset')).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(directory, screenshot), animations: 'disabled' });
}

for (const theme of ['light-paper', 'dark-espresso']) {
  test(`inline titles retain a single focus indicator in ${theme}`, async ({ page, context, request }) => {
    test.setTimeout(120_000);
    expect(isOwnedDirectory(process.env.STHSTART_E2E_DIRECTORY ?? '')).toBe(true);
    expect(new URL(portal).port).not.toBe('9320');
    mkdirSync(directory, { recursive: true });
    expect((await context.request.post(portal + '/api/auth/admin-session', { headers: { origin: portal } })).ok()).toBe(true);
    await context.addInitScript(value => {
      localStorage.setItem('sthstart_theme_id', value);
      localStorage.setItem('sthstart_ui_skin', 'genshin');
    }, theme);

    const draft = normalizeCharacterDraftV2({ schemaVersion: 2, displayName: '林舟 · 焦点验收', originType: 'original', work: '海边来信', summary: '在海边小镇整理旧信件的年轻人。', personaText: '认真倾听，习惯先核实再回答。' });
    const characterResponse = await request.post(service + '/characters', { headers, data: { displayName: draft.displayName, draft } });
    expect(characterResponse.status()).toBe(201);
    const character = await characterResponse.json();
    await page.goto(`/apps/characters/${character.id}`);
    await page.getByRole('button', { name: '编辑档案', exact: true }).click();
    await focusInline(page, page.getByRole('textbox', { name: '角色名称', exact: true }), `inline-character-${theme}.png`);

    const regular = page.getByRole('textbox', { name: '一句话概述', exact: true });
    await regular.focus();
    await expect(regular).not.toHaveAttribute('data-ui-variant', 'inline');
    await expect.poll(() => regular.evaluate(node => parseFloat(getComputedStyle(node).borderTopWidth))).toBeGreaterThan(0);
    await page.screenshot({ path: resolve(directory, `regular-input-${theme}.png`), animations: 'disabled' });

    const projectResponse = await request.post(service + '/story/projects', { headers, data: { title: '海边来信 · 焦点验收', summary: '隔离浏览器视觉样本' } });
    expect(projectResponse.status()).toBe(201);
    const project = await projectResponse.json();
    const chapterResponse = await request.post(`${service}/story/projects/${project.id}/documents`, { headers, data: { kind: 'chapter', title: '第一章 · 雨后的街角', body: '海风穿过旧灯塔，林舟把信收进衣袋。' } });
    expect(chapterResponse.status()).toBe(201);
    const chapter = await chapterResponse.json();
    await page.goto(`/apps/story/${project.id}?entry=${chapter.id}`);
    await focusInline(page, page.getByRole('textbox', { name: '条目标题', exact: true }), `inline-story-${theme}.png`);

    const document = JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8'));
    document.activity.title = '海边来信 · 分镜制作';
    const activityResponse = await request.post(service + '/activities', { headers, data: { document } });
    expect(activityResponse.status()).toBe(201);
    const { activity } = await activityResponse.json();
    await page.goto(`/apps/activities/${activity.id}`);
    await focusInline(page, page.getByRole('textbox', { name: '活动标题', exact: true }), `inline-activity-${theme}.png`);
    await page.getByRole('button', { name: '新增场次', exact: true }).click();
    await focusInline(page, page.getByRole('textbox', { name: '场次标题', exact: true }), `inline-scene-${theme}.png`);
  });
}
