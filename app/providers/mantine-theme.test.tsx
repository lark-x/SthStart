import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { DEFAULT_THEME, MantineProvider, mergeMantineTheme } from '@mantine/core';
import {
  STHSTART_COLOR_SCHEME_MANAGER,
  STHSTART_MANTINE_THEME,
  STHSTART_PRIMARY_COLOR,
  THEME_CHANGE_EVENT,
  sthstartVariantColorsResolver,
} from './mantine-theme';
import { applyThemeId, THEME_BOOTSTRAP_SCRIPT, type ThemeId } from '../lib/theme-preference';

const THEME_IDS: ThemeId[] = ['light-paper', 'light-zinc', 'dark-espresso', 'dark-obsidian'];

/** 静态变量桥接的唯一来源；provider 不再生成运行时变量。 */
const bridgeCss = readFileSync(
  fileURLToPath(new URL('../styles/mantine-bridge.css', import.meta.url)),
  'utf8'
);

/** 极简 DOM：只实现主题桥接实际触碰的属性、事件与容器能力。 */
class FakeStyle {
  colorScheme = '';
  private values = new Map<string, string>();
  setProperty(name: string, value: string) {
    this.values.set(name, value);
  }
  removeProperty(name: string) {
    this.values.delete(name);
  }
  getPropertyValue(name: string) {
    return this.values.get(name) ?? '';
  }
}

class FakeElement {
  nodeType = 1;
  childNodes: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  ownerDocument: unknown = undefined;
  style = new FakeStyle();
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(public nodeName = 'DIV') {}

  setAttribute(name: string, value: string) {
    this.attrs.set(name, String(value));
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  hasAttribute(name: string) {
    return this.attrs.has(name);
  }
  addEventListener(type: string, fn: (event: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (event: unknown) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatchEvent(event: { type: string }) {
    this.listeners.get(event.type)?.forEach((fn) => fn(event));
    return true;
  }
  appendChild<T extends FakeElement>(child: T): T {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  insertBefore<T extends FakeElement>(child: T, before: FakeElement | null): T {
    child.parentNode = this;
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index >= 0) this.childNodes.splice(index, 0, child);
    else this.childNodes.push(child);
    return child;
  }
  removeChild<T extends FakeElement>(child: T): T {
    this.childNodes = this.childNodes.filter((node) => node !== child);
    child.parentNode = null;
    return child;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [] as FakeElement[];
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  set textContent(_value: string) {}
  get textContent() {
    return '';
  }
  set innerHTML(_value: string) {}
  get innerHTML() {
    return '';
  }
}

let globalsInstalled = false;

function installDom() {
  const html = new FakeElement('HTML');
  const body = new FakeElement('BODY');
  const head = new FakeElement('HEAD');
  const doc = {
    nodeType: 9,
    documentElement: html,
    body,
    head,
    activeElement: null,
    createElement: (tag: string) => new FakeElement(tag.toUpperCase()),
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag.toUpperCase()),
    createTextNode: (text: string) => Object.assign(new FakeElement('#text'), { nodeType: 3, text }),
    querySelector: () => null,
    querySelectorAll: () => [] as FakeElement[],
    addEventListener() {},
    removeEventListener() {},
  };
  html.ownerDocument = doc;
  body.ownerDocument = doc;
  head.ownerDocument = doc;
  html.appendChild(head);
  html.appendChild(body);

  const win = {
    document: doc,
    localStorage: {
      getItem: () => null,
      setItem: (() => {}) as (key: string, value: string) => void,
      removeItem: (() => {}) as (key: string) => void,
    },
    matchMedia: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    addEventListener: (type: string, fn: (event: unknown) => void) => html.addEventListener(type, fn),
    removeEventListener: (type: string, fn: (event: unknown) => void) => html.removeEventListener(type, fn),
    dispatchEvent: (event: { type: string }) => html.dispatchEvent(event),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    requestAnimationFrame: (cb: (time: number) => void) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
  };

  (doc as unknown as { defaultView: unknown }).defaultView = win;
  const baseCreateElement = doc.createElement;
  doc.createElement = (tag: string) => {
    const element = baseCreateElement(tag);
    element.ownerDocument = doc;
    return element;
  };
  const baseCreateElementNS = doc.createElementNS;
  doc.createElementNS = (ns: string, tag: string) => {
    const element = baseCreateElementNS(ns, tag);
    element.ownerDocument = doc;
    return element;
  };

  const scope = globalThis as unknown as Record<string, unknown>;
  scope.window = win;
  scope.document = doc;
  scope.HTMLElement = FakeElement;
  scope.Element = FakeElement;
  scope.Node = FakeElement;
  scope.IS_REACT_ACT_ENVIRONMENT = true;
  globalsInstalled = true;
  return { html, doc, win };
}

function removeDom() {
  const scope = globalThis as unknown as Record<string, unknown>;
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) {
    delete scope[key];
  }
  globalsInstalled = false;
}

describe('Mantine theme bridge (A1)', () => {
  before(() => {
    if (!globalsInstalled) installDom();
  });

  after(() => {
    removeDom();
  });

  describe('bootstrap and ownership', () => {
    it('layout ships the SSR scheme default so no-script fallback is deterministic', () => {
      const layout = readFileSync(
        fileURLToPath(new URL('../layout.tsx', import.meta.url)),
        'utf8'
      );
      assert.match(layout, /data-mantine-color-scheme="light"/);
      // 只允许 SSR 兜底值（JSX 属性本身）：切换必须经 applyThemeId，不能写死第二套状态。
      assert.equal((layout.match(/data-mantine-color-scheme="light"/g) ?? []).length, 1);
    });

    it('bootstrap script writes the Mantine scheme attribute before first paint', () => {
      assert.match(THEME_BOOTSTRAP_SCRIPT, /data-mantine-color-scheme/);
      // 成功与异常分支都必须写入，否则 Mantine 首屏会落到默认 light。
      assert.equal(THEME_BOOTSTRAP_SCRIPT.split('data-mantine-color-scheme').length - 1, 2);
    });

    it('applyThemeId keeps SthStart and Mantine scheme attributes in lockstep', () => {
      const { html } = installDom();
      for (const id of THEME_IDS) {
        applyThemeId(html, id);
        const expected = id.startsWith('dark') ? 'dark' : 'light';
        assert.equal(html.getAttribute('data-theme'), id);
        assert.equal(html.getAttribute('data-color-mode'), expected);
        assert.equal(html.getAttribute('data-mantine-color-scheme'), expected);
      }
    });

    it('manager reads the bootstrap attribute instead of falling back to light', () => {
      const { html } = installDom();
      html.setAttribute('data-mantine-color-scheme', 'dark');
      assert.equal(STHSTART_COLOR_SCHEME_MANAGER.get('light'), 'dark');
      html.setAttribute('data-mantine-color-scheme', 'light');
      assert.equal(STHSTART_COLOR_SCHEME_MANAGER.get('dark'), 'light');
    });

    it('manager falls back to the provided default when no attribute exists', () => {
      const { html } = installDom();
      html.removeAttribute('data-mantine-color-scheme');
      assert.equal(STHSTART_COLOR_SCHEME_MANAGER.get('light'), 'light');
      assert.equal(STHSTART_COLOR_SCHEME_MANAGER.get('dark'), 'dark');
    });

    it('manager never persists a competing scheme key', () => {
      const { win } = installDom();
      const writes: string[] = [];
      win.localStorage.setItem = (key: string) => {
        writes.push(key);
      };
      STHSTART_COLOR_SCHEME_MANAGER.set('dark');
      STHSTART_COLOR_SCHEME_MANAGER.clear();
      assert.deepEqual(writes, []);
    });

    it('subscribers receive theme changes broadcast by applyThemeId', () => {
      const { html } = installDom();
      const seen: string[] = [];
      STHSTART_COLOR_SCHEME_MANAGER.subscribe((value) => seen.push(value));
      applyThemeId(html, 'dark-obsidian');
      applyThemeId(html, 'light-zinc');
      STHSTART_COLOR_SCHEME_MANAGER.unsubscribe();
      applyThemeId(html, 'dark-espresso');
      assert.deepEqual(seen, ['dark', 'light']);
      assert.ok(THEME_CHANGE_EVENT.length > 0);
    });
  });

  describe('theme mapping', () => {
    it('declares Mantine variables from project tokens in the static bridge', () => {
      // provider 关闭 withCssVariables：变量必须由 bridge 样式表声明，且只引用项目 token。
      const decl = (name: string) => {
        const match = bridgeCss.match(new RegExp(name + ':\\s*([^;]+);'));
        return match?.[1].trim();
      };
      assert.equal(decl('--mantine-color-body'), 'var(--bg-app)');
      assert.equal(decl('--mantine-color-text'), 'var(--fg-default)');
      assert.equal(decl('--mantine-radius-default'), 'var(--radius-control)');
      assert.equal(decl('--mantine-primary-color-filled'), 'var(--accent)');
      assert.equal(decl('--mantine-color-red-light'), 'var(--danger-bg)');
      assert.equal(decl('--mantine-font-family'), 'var(--font-sans)');
    });

    it('keeps the bridge free of per-theme hex values', () => {
      // 只允许 #ffffff / #000000 这类中性基色；主题色必须经项目 token 间接引用。
      const hex = [...bridgeCss.matchAll(/#[0-9a-f]{3,8}/gi)].map((m) => m[0].toLowerCase());
      assert.deepEqual([...new Set(hex)].sort(), ['#000000', '#ffffff']);
    });

    it('declares every Mantine variable referenced by the imported component CSS', () => {
      // 以 globals.css 实际引入的官方样式表为准，逐个核对变量是否在 bridge 中声明；
      // 缺失变量会让组件静默回落到 UA 默认值（例如尺寸为 0、边框透明）。
      const globals = readFileSync(
        fileURLToPath(new URL('../globals.css', import.meta.url)),
        'utf8'
      );
      const imported = [...globals.matchAll(/@mantine\/core\/styles\/([A-Za-z]+)\.layer\.css/g)]
        .map((match) => match[1]);
      assert.ok(imported.length >= 12, 'component layer CSS must be imported explicitly');

      const referenced = new Set<string>();
      for (const component of imported) {
        const css = readFileSync(
          fileURLToPath(new URL(`../../node_modules/@mantine/core/styles/${component}.layer.css`, import.meta.url)),
          'utf8'
        );
        for (const match of css.matchAll(/var\((--mantine-[a-z0-9-]+)/g)) referenced.add(match[1]);
      }
      if (globals.includes("@mantine/notifications/styles.layer.css")) {
        const notificationsCss = readFileSync(
          fileURLToPath(new URL('../../node_modules/@mantine/notifications/styles.layer.css', import.meta.url)),
          'utf8'
        );
        for (const match of notificationsCss.matchAll(/var\((--mantine-[a-z0-9-]+)/g)) referenced.add(match[1]);
      }

      const declared = new Set([...bridgeCss.matchAll(/^\s*(--mantine-[a-z0-9-]+):/gm)].map((m) => m[1]));
      const missing = [...referenced].filter((name) => !declared.has(name)).sort();
      assert.deepEqual(missing, [], `undeclared Mantine variables: ${missing.join(', ')}`);
    });

    it('resolves accent and status variants to project tokens', () => {
      const base = { theme: STHSTART_MANTINE_THEME as never };
      assert.equal(sthstartVariantColorsResolver({ ...base, variant: 'filled', color: STHSTART_PRIMARY_COLOR }).background, 'var(--accent)');
      assert.equal(sthstartVariantColorsResolver({ ...base, variant: 'filled', color: 'red' }).background, 'var(--danger-solid)');
      assert.equal(sthstartVariantColorsResolver({ ...base, variant: 'light', color: 'red' }).color, 'var(--danger-fg)');
      assert.equal(sthstartVariantColorsResolver({ ...base, variant: 'light', color: 'green' }).background, 'var(--success-bg)');
      assert.equal(sthstartVariantColorsResolver({ ...base, variant: 'default', color: undefined }).background, 'var(--surface-raised)');
    });

    it('leaves explicit non-semantic colors to the official resolver', () => {
      // provider 内部会把 override 合并进 DEFAULT_THEME；这里用同样的合并结果，
      // 才能验证 `grape` 这类默认色仍由官方解析器处理。
      const merged = mergeMantineTheme(DEFAULT_THEME, STHSTART_MANTINE_THEME);
      const result = sthstartVariantColorsResolver({
        theme: merged,
        variant: 'filled',
        color: 'grape',
      });
      assert.match(result.background, /^var\(--mantine-color-grape-/);
    });

  });

  describe('rendering', () => {
    it('server render emits no inline variable block or scheme script', () => {
      const html = renderToString(
        <MantineProvider
          theme={STHSTART_MANTINE_THEME}
          defaultColorScheme="light"
          colorSchemeManager={STHSTART_COLOR_SCHEME_MANAGER}
          withCssVariables={false}
          withGlobalClasses={false}
        >
          <span>ssr</span>
        </MantineProvider>
      );
      assert.match(html, /ssr/);
      // 不挂载 ColorSchemeScript，也不生成运行时变量：首屏体积只含业务标记。
      assert.doesNotMatch(html, /data-mantine-script/);
      assert.doesNotMatch(html, /data-mantine-styles/);
      assert.doesNotMatch(html, /--mantine-color-body/);
    });

    it('server render carries the token bridge without scheme-specific values', () => {
      const dark = renderToString(
        <MantineProvider
          theme={STHSTART_MANTINE_THEME}
          defaultColorScheme="dark"
          colorSchemeManager={STHSTART_COLOR_SCHEME_MANAGER}
          withCssVariables={false}
          withGlobalClasses={false}
        >
          <span>ssr</span>
        </MantineProvider>
      );
      // 两种 defaultColorScheme 生成同一份映射，避免 hydration 前后颜色不一致。
      assert.equal(dark, renderToString(
        <MantineProvider
          theme={STHSTART_MANTINE_THEME}
          defaultColorScheme="light"
          colorSchemeManager={STHSTART_COLOR_SCHEME_MANAGER}
          withCssVariables={false}
          withGlobalClasses={false}
        >
          <span>ssr</span>
        </MantineProvider>
      ));
    });

    it('manager returns the bootstrapped dark value at mount time', () => {
      // Mantine 的挂载 effect 调用 manager.get(defaultColorScheme) 后写回属性；
      // 这里直接验证该调用的返回值，浏览器端闪烁由 Playwright 采样覆盖。
      const { html: rootElement } = installDom();
      applyThemeId(rootElement, 'dark-espresso');
      const seen: string[] = [];
      STHSTART_COLOR_SCHEME_MANAGER.subscribe((value) => seen.push(value));

      const mountValue = STHSTART_COLOR_SCHEME_MANAGER.get('light');
      STHSTART_COLOR_SCHEME_MANAGER.set(mountValue);
      applyThemeId(rootElement, 'dark-obsidian');
      STHSTART_COLOR_SCHEME_MANAGER.unsubscribe();

      assert.equal(mountValue, 'dark');
      assert.equal(rootElement.getAttribute('data-mantine-color-scheme'), 'dark');
      assert.deepEqual(seen, ['dark'], 'only the explicit switch is broadcast');
    });
  });
});
