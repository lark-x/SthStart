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
    const bg = backgroundUnder(el);
    if (!bg) continue;
    const borderWidth = parseFloat(style.borderTopWidth) || 0;
    const border = borderWidth > 0 ? parseColor(style.borderTopColor) : null;
    const outlineVisible = style.outlineStyle !== 'none' && (parseFloat(style.outlineWidth) || 0) > 0;
    const shadowColors = colorsIn(style.boxShadow).map(parseColor).filter((c) => c && c.a > 0.05);
    const candidates = (outlineVisible ? [parseColor(style.outlineColor)] : [])
      .concat(shadowColors)
      .filter((c) => c && c.a > 0.05);
    const ratioOf = (c) => round2(contrast(c.a >= 1 ? c : over(c, bg), bg));
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

async function sweepText(page: Page, warm: boolean) {
  if (warm) await page.addInitScript(() => window.localStorage.setItem('sthstart_eye_care_mode', 'true'));
  const failures: Array<Sample & { route: string }> = [];
  let checked = 0;
  for (const route of ROUTES) {
    const response = await page.goto(route);
    if (response && response.status() >= 400) continue;
    if (warm) await expect(page.locator('html')).toHaveAttribute('data-eye-care', 'true');
    await page.waitForTimeout(350);
    for (const sample of await collectText(page)) {
      checked += 1;
      if (sample.ratio < (isLargeText(sample) ? 3 : 4.5)) failures.push({ ...sample, route });
    }
  }
  return { failures, checked };
}

test('default theme text meets 4.5:1 on real surfaces', async ({ page }) => {
  const { failures, checked } = await sweepText(page, false);
  // 取样量过低说明选择器或渲染出了问题，不能算通过。
  expect(checked, '取样文字数量').toBeGreaterThan(200);
  expect(failures.length, `低于 4.5:1 的文字：\n${reportText(failures)}`).toBe(0);
});

test('warm theme text meets 4.5:1 on real surfaces', async ({ page }) => {
  const { failures, checked } = await sweepText(page, true);
  expect(checked, '取样文字数量').toBeGreaterThan(200);
  expect(failures.length, `低于 4.5:1 的文字：\n${reportText(failures)}`).toBe(0);
});

test('form control borders reach 3:1 in the resting state', async ({ page }) => {
  const failures: Array<ControlSample & { route: string }> = [];
  let checked = 0;
  for (const route of ROUTES) {
    const response = await page.goto(route);
    if (response && response.status() >= 400) continue;
    await page.waitForTimeout(250);
    for (const control of await collectControls(page)) {
      if (control.borderWidth <= 0) continue;
      if (control.border === null) continue;
      checked += 1;
      if (control.border < 3) failures.push({ ...control, route });
    }
  }
  expect(checked, '取样控件数量').toBeGreaterThan(10);
  expect(failures.length, `控件边界低于 3:1：\n${reportControls(failures)}`).toBe(0);
});

test('focused controls show a visible indicator with 3:1 contrast', async ({ page }) => {
  const failures: string[] = [];
  for (const route of ROUTES) {
    const response = await page.goto(route);
    if (response && response.status() >= 400) continue;
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
