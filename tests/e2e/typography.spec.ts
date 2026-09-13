import { expect, test, type Page } from '@playwright/test';

/**
 * 计划 §11.3 的排版下限：
 *   - 辅助元信息不低于 12px；
 *   - 工作界面常用标签/控件不低于 14px。
 * 只看 token 不足以说明问题，这里遍历真实渲染的文字与控件计算字号。
 */

const ROUTES = [
  '/',
  '/apps/characters',
  '/apps/activities',
  '/apps/activities/new',
  '/apps/notebook',
  '/apps/narrative',
  '/apps/calendar',
  '/apps/creative',
  '/apps/linshe',
  '/settings/generation',
  '/settings/public-services',
  '/settings/control-center',
];

const COLLECT_TEXT_SIZES = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[aria-hidden="true"], [hidden], script, style')) continue;
    if (el.tagName === 'SVG' || el.closest('svg') || el.tagName === 'OPTION') continue;
    const direct = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('')
      .trim();
    if (!direct) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    out.push({ px: parseFloat(style.fontSize), text: direct.slice(0, 20), selector: el.tagName.toLowerCase() + '.' + (el.getAttribute('class') || '').split(' ').slice(0, 2).join('.') });
  }
  return out;
})()`;

const COLLECT_CONTROL_SIZES = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('button, a[role="button"], input, select, textarea, [role="tab"], [role="combobox"]')) {
    if (el.type === 'hidden') continue;
    if (el.closest('[aria-hidden="true"], [hidden]')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const label = (el.textContent || '').trim().slice(0, 20) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    out.push({ px: parseFloat(style.fontSize), label, selector: el.tagName.toLowerCase() + '.' + (el.getAttribute('class') || '').split(' ').slice(0, 2).join('.') });
  }
  return out;
})()`;

type Sized = { px: number; text?: string; label?: string; selector: string };

/*
 * 每个用例要顺序走完 12 条路由并逐页取样 DOM，本身就需要 20 秒以上；
 * 与其余用例并发时会超过默认 30 秒上限。放宽时限，断言内容不变。
 */
test.describe.configure({ timeout: 120_000 });

async function sweep(page: Page, warm: boolean, collect: string, floor: number) {
  if (warm) await page.addInitScript(() => window.localStorage.setItem('sthstart_eye_care_mode', 'true'));
  const failures: Array<Sized & { route: string }> = [];
  let checked = 0;
  for (const route of ROUTES) {
    const response = await page.goto(route);
    if (response && response.status() >= 400) continue;
    if (warm) await expect(page.locator('html')).toHaveAttribute('data-eye-care', 'true');
    await page.waitForTimeout(300);
    for (const row of (await page.evaluate(collect)) as Sized[]) {
      checked += 1;
      if (row.px < floor) failures.push({ ...row, route });
    }
  }
  return { failures, checked };
}

function describe(failures: Array<Sized & { route: string }>) {
  return failures
    .slice(0, 25)
    .map((f) => `${f.route}  ${f.px}px  "${f.text ?? f.label}"  ${f.selector}`)
    .join('\n');
}

test('no visible text drops below the 12px auxiliary floor', async ({ page }) => {
  const { failures, checked } = await sweep(page, false, COLLECT_TEXT_SIZES, 12);
  expect(checked, '取样文字数量').toBeGreaterThan(300);
  expect(failures.length, `低于 12px 的文字：\n${describe(failures)}`).toBe(0);
});

test('no visible text drops below 12px in the warm theme', async ({ page }) => {
  const { failures, checked } = await sweep(page, true, COLLECT_TEXT_SIZES, 12);
  expect(checked, '取样文字数量').toBeGreaterThan(300);
  expect(failures.length, `低于 12px 的文字：\n${describe(failures)}`).toBe(0);
});

test('labels and controls stay at or above 14px', async ({ page }) => {
  const { failures, checked } = await sweep(page, false, COLLECT_CONTROL_SIZES, 14);
  expect(checked, '取样控件数量').toBeGreaterThan(50);
  expect(failures.length, `低于 14px 的标签/控件：\n${describe(failures)}`).toBe(0);
});

/*
 * 计划 §11.3：「主要正文不低于 16px」。
 * 界面上承担长文录入/阅读的表面是 textarea 与带正文语义的容器，逐路由取样它们的计算字号。
 */
const COLLECT_PROSE_SIZES = `(() => {
  const out = [];
  /*
   * 只取真正承担长文的表面：body 录入 textarea，以及显式标注的正文段落。
   * 卡片里的作品名/状态/摘要属于辅助信息，按 12–14px 的要求判定，不在本项范围内。
   */
  const nodes = document.querySelectorAll('textarea, [data-reading-surface]');
  for (const el of nodes) {
    if (el.closest('[hidden]') || el.closest('[aria-hidden="true"]')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 12) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    /*
     * 等宽字段是 JSON / 工作流代码编辑器，不是「主要正文」，
     * 代码编辑器用 14px 等宽更易读，因此不套用正文的 16px 下限。
     */
    if (/mono|consolas|menlo/i.test(style.fontFamily)) continue;
    const text = (el.value || el.textContent || '').trim().slice(0, 20);
    out.push({ px: parseFloat(style.fontSize), text, selector: el.tagName.toLowerCase() + '.' + (el.getAttribute('class') || '').split(' ').slice(0, 2).join('.') });
  }
  return out;
})()`;

test('long-form reading and editing surfaces are at least 16px', async ({ page }) => {
  const { failures, checked } = await sweep(page, false, COLLECT_PROSE_SIZES, 16);
  expect(checked, '取样正文表面数量').toBeGreaterThan(3);
  expect(failures.length, `低于 16px 的正文表面：\n${describe(failures)}`).toBe(0);
});
