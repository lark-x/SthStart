import { expect, test, type Page } from '@playwright/test';

/**
 * 计划 §11.3 的可量化验收：对比度必须在真实背景、透明度、字体和控件状态上计算，
 * 不能只看 token 表，也不能只测刚改过的组件。
 *
 * 取样说明：
 *   - 背景沿 DOM 逐层累积并合成 alpha；遇到渐变等无法解析的层就跳过该样本；
 *   - 颜色支持 rgb/rgba、oklab（Chromium 对带透明度主题色的序列化形式）与 hex；
 *   - 禁用态属于 WCAG 1.4.3 明确豁免的“非活动控件”，不参与文字对比度判定；
 *   - 大文字按 WCAG 2.2 定义（≥24px，或 ≥18.66px 且加粗）放宽容差到 3:1。
 */

const HELPERS = `
  const toSrgb = (L, a, b) => {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    return lin.map((v) => {
      const x = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
      return Math.min(255, Math.max(0, x * 255));
    });
  };

  const parseColor = (value) => {
    const text = (value || '').trim();
    if (!text || text === 'transparent' || text === 'none') return null;
    if (text.charAt(0) === '#') {
      let hex = text.slice(1);
      if (hex.length === 4) {
        hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
      }
      if (hex.length === 8) {
        const n8 = parseInt(hex.slice(0, 6), 16);
        return { r: (n8 >> 16) & 255, g: (n8 >> 8) & 255, b: n8 & 255, a: parseInt(hex.slice(6), 16) / 255 };
      }
      if (hex.length !== 6) return null;
      const n = parseInt(hex, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
    }
    const open = text.indexOf('(');
    const close = text.lastIndexOf(')');
    if (open === -1 || close === -1) return null;
    const name = text.slice(0, open).trim();
    const body = text.slice(open + 1, close).trim();
    const halves = body.split('/');
    const alphaOf = () => (halves[1] ? Number(halves[1].trim()) : 1);
    if (name === 'rgb' || name === 'rgba') {
      const parts = halves[0].split(',').map((p) => parseFloat(p.trim()));
      if (parts.length < 3) return null;
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : alphaOf() };
    }
    if (name === 'oklab') {
      const nums = halves[0].trim().split(' ').filter(Boolean).map(Number);
      if (nums.length < 3) return null;
      const rgb = toSrgb(nums[0], nums[1], nums[2]);
      return { r: rgb[0], g: rgb[1], b: rgb[2], a: alphaOf() };
    }
    if (name === 'color') {
      const nums = halves[0].trim().split(' ').filter(Boolean);
      if (nums[0] !== 'srgb' || nums.length < 4) return null;
      return { r: Number(nums[1]) * 255, g: Number(nums[2]) * 255, b: Number(nums[3]) * 255, a: alphaOf() };
    }
    return null;
  };

  const over = (src, dst) => ({
    r: src.r * src.a + dst.r * (1 - src.a),
    g: src.g * src.a + dst.g * (1 - src.a),
    b: src.b * src.a + dst.b * (1 - src.a),
    a: 1,
  });

  const channel = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const round2 = (v) => Math.round(v * 100) / 100;
  const toHex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

  /** 从元素向上累积背景；遇到渐变等无法解析的层返回 null，该样本会被跳过。 */
  const backgroundUnder = (el) => {
    const chain = [];
    let node = el;
    while (node && node.nodeType === 1) {
      const style = getComputedStyle(node);
      /*
       * 渐变会真正改变像素，无法用单色推断，遇到就放弃这个样本；
       * url() 背景在这套界面里是控件图标或纹理，底色仍然决定对比度。
       */
      if (style.backgroundImage && style.backgroundImage.indexOf('gradient') !== -1) return null;
      const bg = parseColor(style.backgroundColor);
      if (bg && bg.a >= 1) {
        chain.push(bg);
        break;
      }
      if (bg && bg.a > 0) {
        chain.push(bg);
      }
      node = node.parentElement;
    }
    let acc = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = chain.length - 1; i >= 0; i -= 1) acc = over(chain[i], acc);
    return acc;
  };

  const pathOf = (el) => {
    const parts = [];
    let node = el;
    for (let i = 0; i < 4 && node && node.nodeType === 1; i += 1) {
      let part = node.tagName.toLowerCase();
      if (node.id) part += '#' + node.id;
      const cls = (node.getAttribute('class') || '').split(' ').filter(Boolean).slice(0, 2);
      if (cls.length) part += '.' + cls.join('.');
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  /** 取出 box-shadow 等字符串里的所有颜色，用于多层焦点环测量。 */
  const colorsIn = (value) => {
    const text = value || '';
    const found = [];
    for (const name of ['rgba(', 'rgb(', 'oklab(', 'oklch(', 'color(']) {
      let index = text.indexOf(name);
      while (index !== -1) {
        const end = text.indexOf(')', index);
        if (end === -1) break;
        found.push(text.slice(index, end + 1));
        index = text.indexOf(name, end);
      }
    }
    return found;
  };
`;

type Sample = {
  text: string;
  color: string;
  background: string;
  fontSize: number;
  fontWeight: number;
  ratio: number;
  selector: string;
};

type ControlSample = {
  selector: string;
  tag: string;
  borderWidth: number;
  border: number | null;
  borderColor: string;
  background: string;
  ring: number | null;
  hasIndicator: boolean;
  focused: boolean;
  indicatorContrast: number | null;
  indicatorVisible: boolean;
};

const ROUTES = [
  '/',
  '/apps/characters',
  '/apps/activities',
  '/apps/activities/new',
  '/apps/notebook',
  '/apps/calendar',
  '/apps/creative',
  '/apps/linshe',
  '/settings/generation',
  '/settings/public-services',
];

/*
 * 每个用例要顺序走完 10 条路由并逐页取样真实 DOM，本身就需要 20 秒以上；
 * 与其余用例并发时会超过默认 30 秒上限。放宽时限，断言内容不变。
 */
test.describe.configure({ timeout: 120_000 });

const COLLECT_TEXT = `(() => {
  ${HELPERS}
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[aria-hidden="true"], [hidden], script, style')) continue;
    if (el.tagName === 'SVG' || el.closest('svg')) continue;
    if (el.tagName === 'OPTION') continue;
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
    if (Number(style.opacity) < 0.99) continue;
    const bg = backgroundUnder(el);
    if (!bg) continue;
    const raw = parseColor(style.color);
    if (!raw) continue;
    const fg = raw.a >= 1 ? raw : over(raw, bg);
    out.push({
      text: direct.slice(0, 24),
      color: toHex(fg),
      background: toHex(bg),
      fontSize: parseFloat(style.fontSize),
      fontWeight: Number(style.fontWeight) || 400,
      ratio: round2(contrast(fg, bg)),
      selector: pathOf(el),
    });
  }
  return out;
})()`;

const COLLECT_CONTROLS = `(() => {
  ${HELPERS}
  const out = [];
  const nodes = document.querySelectorAll('input, select, textarea, [role="combobox"], [role="textbox"], [role="switch"]');
  for (const el of nodes) {
    if (el.type === 'hidden' || el.type === 'file') continue;
    if (el.closest('[hidden]') || el.closest('[aria-hidden="true"]')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    if (Number(style.opacity) < 0.99) continue;
    /*
     * 复选框的边框贴着控件外侧，勾选后内部填充与边框同色。
     * 边框必须和相邻表面比较，不能拿它和自己的填充比出 1:1。
     * 勾选图标则单独与内部填充比较。
     */
    const isChoice = el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio');
    const bg = backgroundUnder(isChoice ? el.parentElement : el);
    if (!bg) continue;
    const borderWidth = parseFloat(style.borderTopWidth) || 0;
    /* 全透明边框是刻意的无边框写作区（如笔记正文块），与 0 宽边框同样跳过，聚焦态另有用例覆盖。 */
    const rawBorder = borderWidth > 0 ? parseColor(style.borderTopColor) : null;
    const border = rawBorder && rawBorder.a > 0.05 ? rawBorder : null;
    const outlineVisible = style.outlineStyle !== 'none' && (parseFloat(style.outlineWidth) || 0) > 0;
    const shadowColors = colorsIn(style.boxShadow).map(parseColor).filter((c) => c && c.a > 0.05);
    const candidates = (outlineVisible ? [parseColor(style.outlineColor)] : [])
      .concat(shadowColors)
      .filter((c) => c && c.a > 0.05);
    const ratioOf = (c) => round2(contrast(c.a >= 1 ? c : over(c, bg), bg));
    const fill = parseColor(style.backgroundColor);
    const indicator = isChoice ? el.parentElement?.querySelector('svg') ?? null : null;
    const indicatorStyle = indicator ? getComputedStyle(indicator) : null;
    const indicatorColor = indicatorStyle ? parseColor(indicatorStyle.color) : null;
    const indicatorOpacity = indicatorStyle ? Number(indicatorStyle.opacity) : 0;
    const indicatorContrast = fill && indicatorColor
      ? round2(contrast(indicatorColor.a >= 1 ? indicatorColor : over(indicatorColor, fill), fill))
      : null;
    out.push({
      selector: pathOf(el),
      tag: el.tagName.toLowerCase() + (el.type ? '[' + el.type + ']' : ''),
      borderWidth: borderWidth,
      border: border ? ratioOf(border) : null,
      borderColor: border ? toHex(border) : 'none',
      background: toHex(bg),
      ring: candidates.length ? round2(Math.max.apply(null, candidates.map(ratioOf))) : null,
      hasIndicator: outlineVisible || shadowColors.length > 0,
      focused: el === document.activeElement,
      indicatorContrast,
      indicatorVisible: indicatorOpacity > 0.99,
    });
  }
  return out;
})()`;

/** WCAG 2.2 大文字定义：≥24px，或 ≥18.66px 且加粗。 */
function isLargeText(sample: Sample) {
  return sample.fontSize >= 24 || (sample.fontSize >= 18.66 && sample.fontWeight >= 700);
}

async function collectText(page: Page): Promise<Sample[]> {
  return page.evaluate(COLLECT_TEXT) as Promise<Sample[]>;
}

async function collectControls(page: Page): Promise<ControlSample[]> {
  return page.evaluate(COLLECT_CONTROLS) as Promise<ControlSample[]>;
}

function reportText(failures: Array<Sample & { route: string }>) {
  return failures
    .slice(0, 30)
    .map((s) => `${s.route}  ${s.ratio}:1  ${s.fontSize}px  "${s.text}"  ${s.color} on ${s.background}  — ${s.selector}`)
    .join('\n');
}

function reportControls(failures: Array<ControlSample & { route: string }>) {
  return failures
    .slice(0, 30)
    .map((c) => `${c.route}  ${c.border}:1  ${c.tag}  border ${c.borderColor} on ${c.background}  — ${c.selector}`)
    .join('\n');
}

function reportIndicators(failures: Array<ControlSample & { route: string }>) {
  return failures
    .slice(0, 30)
    .map((c) => `${c.route}  ${c.indicatorContrast}:1  ${c.tag}  icon on ${c.background}  — ${c.selector}`)
    .join('\n');
}

/*
 * 主题 ID 与 app/lib/theme-preference.ts 的 THEMES 一致：两套日间（暖白 light-paper、
 * 云白 light-zinc）与两套夜间（暖夜 dark-espresso、深空 dark-obsidian）。
 * 旧的 warm / neutral 只作为迁移值读取，落到 data-theme 上的已是新 ID。
 */
const THEME_IDS = ['light-paper', 'light-zinc', 'dark-espresso', 'dark-obsidian'] as const;
type ThemeId = (typeof THEME_IDS)[number];

async function sweepText(page: Page, themeId: ThemeId) {
  const expectedTheme = themeId;
  await page.addInitScript((id) => window.localStorage.setItem('sthstart_theme_id', id), expectedTheme);
  const failures: Array<Sample & { route: string }> = [];
  let checked = 0;
  for (const route of ROUTES) {
    const response = await page.goto(route);
    if (response && response.status() >= 400) continue;
    await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme);
    await page.waitForTimeout(350);
    for (const sample of await collectText(page)) {
      checked += 1;
      if (sample.ratio < (isLargeText(sample) ? 3 : 4.5)) failures.push({ ...sample, route });
    }
  }
  return { failures, checked };
}

for (const themeId of THEME_IDS) {
  test(`${themeId} theme text meets 4.5:1 on real surfaces`, async ({ page }) => {
    const { failures, checked } = await sweepText(page, themeId);
    // 取样量过低说明选择器或渲染出了问题，不能算通过。
    expect(checked, '取样文字数量').toBeGreaterThan(200);
    expect(failures.length, `低于 4.5:1 的文字：\n${reportText(failures)}`).toBe(0);
  });
}

/*
 * 并发跑时后端响应慢，固定等待 250ms 有时还停在「正在读取…」占位上，表单没渲染出来，
 * 取样数就会掉到阈值以下。先等加载占位消失再取样。
 */
async function waitForPageData(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await expect(page.locator('[role="status"]').filter({ hasText: /^(正在|加载中)/ })).toHaveCount(0, { timeout: 10_000 });
}

test('form control borders reach 3:1 in the resting state', async ({ page }) => {
  const failures: Array<ControlSample & { route: string }> = [];
  const indicatorFailures: Array<ControlSample & { route: string }> = [];
  let checked = 0;
  const formRoute = '/apps/characters/new';
  const checkedByRoute: Record<string, number> = {};
  for (const route of [...ROUTES, formRoute]) {
    const response = await page.goto(route);
    if (response && response.status() >= 400) continue;
    await waitForPageData(page);
    if (route === formRoute) {
      await expect(page.getByRole('heading', { name: '新建角色档案', exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: '角色名称', exact: true })).toBeVisible();
    }
    await page.waitForTimeout(250);
    for (const control of await collectControls(page)) {
      if (control.borderWidth <= 0) continue;
      if (control.border === null) continue;
      checked += 1;
      checkedByRoute[route] = (checkedByRoute[route] ?? 0) + 1;
      if (control.border < 3) failures.push({ ...control, route });
      if (control.tag === 'input[checkbox]' && control.indicatorVisible
        && (control.indicatorContrast === null || control.indicatorContrast < 3)) {
        indicatorFailures.push({ ...control, route });
      }
    }
  }
  expect(checkedByRoute[formRoute] ?? 0, '新建角色表单中采到的控件').toBeGreaterThan(0);
  expect(checked, '取样控件数量：' + JSON.stringify(checkedByRoute)).toBeGreaterThan(10);
  expect(failures.length, `控件边界低于 3:1：\n${reportControls(failures)}`).toBe(0);
  expect(indicatorFailures.length, `复选框勾选图标低于 3:1：\n${reportIndicators(indicatorFailures)}`).toBe(0);
});

test('focused controls show a visible indicator with 3:1 contrast', async ({ page }) => {
  const failures: string[] = [];
  for (const route of ROUTES) {
    const response = await page.goto(route);
    if (response && response.status() >= 400) continue;
    /*
     * 部分页面（如创作中心的预设选项）在数据到达后异步替换表单控件；
     * 等待渲染稳定再聚焦，否则 activeElement 指向已被替换的旧节点。
     */
    await page.waitForTimeout(500);
    const target = page
      .locator('input[type="search"]:visible, input[type="text"]:visible, textarea:visible, select:visible')
      .first();
    if ((await target.count()) === 0) continue;
    await target.focus();
    const [control] = (await collectControls(page)).filter((c) => c.focused);
    if (!control) {
      failures.push(`${route}  聚焦的控件没有出现在取样结果里`);
      continue;
    }
    /*
     * 焦点样式有两种实现：加环（ring/outline）或直接加深边框。
     * 两者取较强的一个，代表用户实际看到的指示强度。
     */
    const strength = Math.max(control.ring ?? 0, control.border ?? 0);
    if (!control.hasIndicator && strength < 3) {
      failures.push(`${route}  ${control.selector} 聚焦后没有出现可见指示器`);
    } else if (strength < 3) {
      failures.push(`${route}  ${control.selector}  焦点指示 ${strength}:1`);
    }
  }
  expect(failures.length, `焦点指示不足：\n${failures.join('\n')}`).toBe(0);
});

test('checkbox keeps a 3:1 resting edge with stable keyboard focus and checked states', async ({ page, context, baseURL }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const read = (target: import('@playwright/test').Locator) => target.evaluate((el) => {
    const parse = (value: string) => {
      const match = /rgba?\(([^)]+)\)/.exec(value || '');
      if (!match) return null;
      const parts = match[1].split(/[,\/]/).map((part) => parseFloat(part.trim())).filter((number) => !Number.isNaN(number));
      if (parts.length < 3) return null;
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const channel = (value: number) => {
      const x = value / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    const luminance = (color: { r: number; g: number; b: number }) => 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    const ratio = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
      (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    const backgroundUnder = (node: Element | null) => {
      for (let current = node; current; current = current.parentElement) {
        const color = parse(getComputedStyle(current).backgroundColor);
        if (color && color.a >= 0.999) return color;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const style = getComputedStyle(el);
    const background = parse(style.backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 };
    const surrounding = backgroundUnder(el.parentElement);
    const border = parse(style.borderTopColor);
    const outline = parse(style.outlineColor);
    const icon = el.parentElement?.querySelector('svg') ?? null;
    const iconStyle = icon ? getComputedStyle(icon) : null;
    const iconColor = iconStyle ? parse(iconStyle.color) : null;
    const input = el as HTMLInputElement;
    const label = input.labels?.[0] ?? null;
    const rect = input.getBoundingClientRect();
    return {
      id: input.id,
      width: rect.width,
      height: rect.height,
      borderWidth: parseFloat(style.borderTopWidth) || 0,
      borderContrast: border ? ratio(border, surrounding) : 0,
      fillContrast: ratio(background, surrounding),
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth) || 0,
      ringContrast: outline ? ratio(outline, surrounding) : 0,
      checked: input.checked,
      labelText: label?.textContent?.trim() ?? '',
      labelFor: label?.htmlFor ?? '',
      iconOpacity: iconStyle ? Number(iconStyle.opacity) : null,
      iconContrast: iconColor ? ratio(iconColor, background) : 0,
    };
  });

  const openRoleFilter = async () => {
    await page.goto('/apps/characters');
    await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme);
    await expect(page.locator('.shell-root')).toHaveAttribute('data-client-ready', 'true');
    const trigger = page.getByRole('button', { name: '筛选与排序', exact: true });
    await expect(trigger).toBeVisible();
    const panel = page.getByRole('dialog', { name: '角色筛选', exact: true });
    for (let attempt = 0; attempt < 12 && !(await panel.isVisible()); attempt += 1) {
      await trigger.click();
      await page.waitForTimeout(150);
    }
    await expect(panel).toBeVisible();
    return panel;
  };

  let expectedTheme = 'light-paper';
  const assertCheckbox = async (target: import('@playwright/test').Locator, label: string) => {
    await expect(target).toBeVisible();
    const initial = await read(target);
    expect(initial.width, label + ': input width').toBeGreaterThanOrEqual(15.5);
    expect(initial.width, label + ': input width').toBeLessThanOrEqual(16.5);
    expect(initial.height, label + ': input height').toBeGreaterThanOrEqual(15.5);
    expect(initial.height, label + ': input height').toBeLessThanOrEqual(16.5);
    expect(initial.borderWidth, label + ': resting border').toBeGreaterThanOrEqual(1);
    expect(initial.borderContrast, label + ': resting border contrast').toBeGreaterThanOrEqual(3);
    expect(initial.labelText, label + ': accessible label').toBe(label);
    expect(initial.labelFor, label + ': label association').toBe(initial.id);

    // 键盘进入焦点，确保量到的是 :focus-visible 而不是脚本聚焦的瞬时样式。
    await target.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(target).toBeFocused();
    const focused = await read(target);
    expect(focused.outlineStyle, label + ': focus outline').not.toBe('none');
    expect(focused.outlineWidth, label + ': focus outline width').toBeGreaterThanOrEqual(2);
    expect(focused.ringContrast, label + ': focus ring contrast').toBeGreaterThanOrEqual(3);

    if (!(await target.isChecked())) await page.keyboard.press('Space');
    await expect(target).toBeChecked();
    // Mantine transitions border/background for 100ms; measure the settled state.
    await page.waitForTimeout(180);
    const checked = await read(target);
    expect(checked.fillContrast, label + ': checked fill contrast').toBeGreaterThanOrEqual(3);
    expect(checked.iconOpacity, label + ': checked icon visibility').toBeGreaterThan(0.99);
    expect(checked.iconContrast, label + ': checked icon contrast').toBeGreaterThanOrEqual(3);

    if (!initial.checked) await page.keyboard.press('Space');
    await expect(target).toBeChecked({ checked: initial.checked });
  };

  for (const theme of ['light-paper', 'dark-espresso']) {
    expectedTheme = theme;
    await page.addInitScript((id) => window.localStorage.setItem('sthstart_theme_id', id), theme);
    const panel = await openRoleFilter();
    await assertCheckbox(panel.getByRole('checkbox', { name: '仅收藏', exact: true }), '仅收藏');
  }

  expectedTheme = 'light-paper';
  await page.addInitScript(() => window.localStorage.setItem('sthstart_theme_id', 'light-paper'));
  const origin = new URL(baseURL ?? page.url()).origin;
  expect((await context.request.post(origin + '/api/auth/admin-session', { headers: { origin } })).ok()).toBe(true);
  await page.goto('/settings/control-center');
  await expect(page.getByRole('heading', { name: '邻舍运行栈', exact: true })).toBeVisible();
  const runtimeHeading = page.getByText('运行参数与自启配置', { exact: true });
  for (let attempt = 0; attempt < 12 && !(await runtimeHeading.isVisible()); attempt += 1) {
    await page.getByRole('tab', { name: '自启与服务', exact: true }).click();
    await page.waitForTimeout(150);
  }
  await expect(runtimeHeading).toBeVisible();
  await assertCheckbox(page.getByRole('checkbox', { name: 'MaiBot 网页控制台', exact: true }), 'MaiBot 网页控制台');
});
