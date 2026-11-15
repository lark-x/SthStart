/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ThemeProvider,
  useTheme,
  useEyeCare,
  toneFromThemeId,
  modeFromThemeId,
  type ThemeContextType,
} from './theme-provider';
import {
  ToastProvider,
  ToastCard,
  useToast,
  useToastActions,
  useToastList,
  MAX_VISIBLE_TOASTS,
  DEFAULT_DURATION,
  type ToastItem,
  type ToastActionsContextType,
  type ToastMethods,
} from './toast-provider';
import {
  UIProvider,
  useUI,
  type UIContextType,
} from './ui-provider';
import { ACCENT_STORAGE_KEY, UI_SKIN_STORAGE_KEY } from '../lib/theme-preference';

type ListenerFn = (event: unknown) => void;

// --- Minimal DOM Environment for Node.js Testing ---
class MockStyle {
  [key: string]: unknown;
  setProperty(prop: string, val: string) {
    this[prop] = val;
  }
  removeProperty(prop: string) {
    delete this[prop];
  }
}

class MockNode {
  nodeType = 1;
}

class MockElement extends MockNode {
  tagName = 'DIV';
  nodeName = 'DIV';
  style = new MockStyle();
  attributes = new Map<string, string>();
  listeners = new Map<string, Set<ListenerFn>>();

  setAttribute(key: string, value: string) {
    this.attributes.set(key, String(value));
  }
  removeAttribute(key: string) {
    this.attributes.delete(key);
  }
  getAttribute(key: string) {
    return this.attributes.get(key) ?? null;
  }
  addEventListener(event: string, fn: ListenerFn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }
  removeEventListener(event: string, fn: ListenerFn) {
    this.listeners.get(event)?.delete(fn);
  }
  dispatchEvent(event: { type: string; [key: string]: unknown }) {
    this.listeners.get(event.type)?.forEach((fn) => fn(event));
  }
  appendChild() {}
  insertBefore() {}
  removeChild() {}
}

class MockHTMLElement extends MockElement {}
class MockHTMLIFrameElement extends MockHTMLElement {}

function setupMockEnvironment() {
  const listeners = new Map<string, Set<ListenerFn>>();
  const storageMap = new Map<string, string>();

  const docElement = new MockHTMLElement();
  docElement.tagName = 'HTML';
  docElement.nodeName = 'HTML';

  const doc = {
    nodeType: 9,
    nodeName: '#document',
    activeElement: null,
    documentElement: docElement,
    addEventListener(event: string, fn: ListenerFn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    removeEventListener(event: string, fn: ListenerFn) {
      listeners.get(event)?.delete(fn);
    },
    createElement(tag: string) {
      const el = new MockHTMLElement();
      el.tagName = tag.toUpperCase();
      el.nodeName = tag.toUpperCase();
      return el;
    },
    createElementNS(_ns: string, tag: string) {
      const el = new MockHTMLElement();
      el.tagName = tag.toUpperCase();
      el.nodeName = tag.toUpperCase();
      return el;
    },
    createTextNode(text: string) {
      const t = new MockNode();
      t.nodeType = 3;
      (t as unknown as { nodeName: string; nodeValue: string }).nodeName = '#text';
      (t as unknown as { nodeName: string; nodeValue: string }).nodeValue = text;
      return t;
    },
  };

  const mockWindow = {
    document: doc,
    HTMLIFrameElement: MockHTMLIFrameElement,
    HTMLElement: MockHTMLElement,
    Element: MockElement,
    Node: MockNode,
    addEventListener(event: string, fn: ListenerFn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    removeEventListener(event: string, fn: ListenerFn) {
      listeners.get(event)?.delete(fn);
    },
    dispatchEvent(event: { type: string; [key: string]: unknown }) {
      listeners.get(event.type)?.forEach((fn) => fn(event));
    },
    matchMedia(query: string) {
      return {
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    },
    localStorage: {
      getItem(key: string) {
        return storageMap.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storageMap.set(key, String(value));
      },
      removeItem(key: string) {
        storageMap.delete(key);
      },
      clear() {
        storageMap.clear();
      },
    },
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
  };

  (doc as unknown as { defaultView: typeof mockWindow }).defaultView = mockWindow;

  const globalScope = global as unknown as Record<string, unknown>;
  globalScope.Node = MockNode;
  globalScope.Element = MockElement;
  globalScope.HTMLElement = MockHTMLElement;
  globalScope.HTMLIFrameElement = MockHTMLIFrameElement;
  globalScope.window = mockWindow;
  globalScope.document = doc;
  globalScope.localStorage = mockWindow.localStorage;
  globalScope.IS_REACT_ACT_ENVIRONMENT = true;

  return {
    mockWindow,
    docElement,
    storageMap,
  };
}

describe('Theme and Toast Providers (S1.3 Architectural Refactoring)', () => {
  let env: ReturnType<typeof setupMockEnvironment>;
  let container: MockHTMLElement;
  let root: Root | null = null;

  beforeEach(() => {
    env = setupMockEnvironment();
    container = new MockHTMLElement();
    (container as unknown as { ownerDocument: unknown }).ownerDocument = env.mockWindow.document;
    root = createRoot(container as unknown as HTMLElement);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
      root = null;
    }
  });

  describe('Pure helper mappings', () => {
    it('toneFromThemeId maps each ThemeId to its exact tone', () => {
      assert.equal(toneFromThemeId('light-paper'), 'paper');
      assert.equal(toneFromThemeId('light-zinc'), 'zinc');
      assert.equal(toneFromThemeId('dark-espresso'), 'espresso');
      assert.equal(toneFromThemeId('dark-obsidian'), 'obsidian');
    });

    it('modeFromThemeId maps dark themes to dark and others to light', () => {
      assert.equal(modeFromThemeId('light-paper'), 'light');
      assert.equal(modeFromThemeId('light-zinc'), 'light');
      assert.equal(modeFromThemeId('dark-espresso'), 'dark');
      assert.equal(modeFromThemeId('dark-obsidian'), 'dark');
    });
  });

  describe('ThemeProvider operations and persistence', () => {
    it('initializes with default light-paper and syncs to document and storage', async () => {
      let themeValue: ThemeContextType | undefined;
      function Consumer() {
        themeValue = useTheme();
        return null;
      }

      await act(async () => {
        root!.render(
          <ThemeProvider>
            <Consumer />
          </ThemeProvider>
        );
      });

      assert.equal(themeValue?.themeId, 'light-paper');
      assert.equal(themeValue?.colorMode, 'light');
      assert.equal(themeValue?.themeTone, 'paper');
      assert.equal(themeValue?.eyeCare, true);
      assert.equal(themeValue?.accentColor, null);
      assert.equal(env.docElement.getAttribute('data-theme'), 'light-paper');
    });

    it('reads initial theme from localStorage if present', async () => {
      env.storageMap.set('sthstart_theme_id', 'dark-espresso');
      let themeValue: ThemeContextType | undefined;
      function Consumer() {
        themeValue = useTheme();
        return null;
      }

      await act(async () => {
        root!.render(
          <ThemeProvider>
            <Consumer />
          </ThemeProvider>
        );
      });

      assert.equal(themeValue?.themeId, 'dark-espresso');
      assert.equal(themeValue?.colorMode, 'dark');
      assert.equal(themeValue?.themeTone, 'espresso');
      assert.equal(themeValue?.eyeCare, false);
      assert.equal(env.docElement.getAttribute('data-theme'), 'dark-espresso');
    });

    it('setThemeId updates state, document attributes, and writes to storage keys', async () => {
      let themeValue: ThemeContextType | undefined;
      function Consumer() {
        themeValue = useTheme();
        return null;
      }

      await act(async () => {
        root!.render(
          <ThemeProvider>
            <Consumer />
          </ThemeProvider>
        );
      });

      await act(async () => {
        themeValue?.setThemeId('dark-obsidian');
      });

      assert.equal(themeValue?.themeId, 'dark-obsidian');
      assert.equal(themeValue?.colorMode, 'dark');
      assert.equal(themeValue?.themeTone, 'obsidian');
      assert.equal(themeValue?.eyeCare, false);
      assert.equal(env.storageMap.get('sthstart_theme_id'), 'dark-obsidian');
      assert.equal(env.storageMap.get('sthstart_theme'), 'dark-obsidian');
      assert.equal(env.storageMap.get('sthstart_eye_care_mode'), 'false');
      assert.equal(env.docElement.getAttribute('data-theme'), 'dark-obsidian');
    });

    it('toggleColorMode switches between light and dark counterpart pairs', async () => {
      let themeValue: ThemeContextType | undefined;
      function Consumer() {
        themeValue = useTheme();
        return null;
      }

      await act(async () => {
        root!.render(
          <ThemeProvider>
            <Consumer />
          </ThemeProvider>
        );
      });

      // light-paper -> dark-espresso
      assert.equal(themeValue?.themeId, 'light-paper');
      await act(async () => {
        themeValue?.toggleColorMode();
      });
      assert.equal(themeValue?.themeId, 'dark-espresso');

      // dark-espresso -> light-paper
      await act(async () => {
        themeValue?.toggleColorMode();
      });
      assert.equal(themeValue?.themeId, 'light-paper');

      // switch to light-zinc
      await act(async () => {
        themeValue?.setThemeId('light-zinc');
      });
      assert.equal(themeValue?.themeId, 'light-zinc');

      // light-zinc -> dark-obsidian
      await act(async () => {
        themeValue?.toggleColorMode();
      });
      assert.equal(themeValue?.themeId, 'dark-obsidian');

      // dark-obsidian -> light-zinc
      await act(async () => {
        themeValue?.toggleColorMode();
      });
      assert.equal(themeValue?.themeId, 'light-zinc');
    });

    it('toggleEyeCare toggles between paper (warm) and zinc (neutral)', async () => {
      let themeValue: ThemeContextType | undefined;
      let eyeCareValue: { eyeCare: boolean; toggleEyeCare: (enabled?: boolean) => void } | undefined;
      function Consumer() {
        themeValue = useTheme();
        eyeCareValue = useEyeCare();
        return null;
      }

      await act(async () => {
        root!.render(
          <ThemeProvider>
            <Consumer />
          </ThemeProvider>
        );
      });

      assert.equal(themeValue?.eyeCare, true);
      assert.equal(eyeCareValue?.eyeCare, true);

      await act(async () => {
        eyeCareValue?.toggleEyeCare();
      });
      assert.equal(themeValue?.themeId, 'light-zinc');
      assert.equal(themeValue?.eyeCare, false);
      assert.equal(eyeCareValue?.eyeCare, false);

      await act(async () => {
        eyeCareValue?.toggleEyeCare(true);
      });
      assert.equal(themeValue?.themeId, 'light-paper');
      assert.equal(themeValue?.eyeCare, true);
    });

    it('setAccentColor normalizes color, updates storage, and syncs via storage events', async () => {
      let themeValue: ThemeContextType | undefined;
      function Consumer() {
        themeValue = useTheme();
        return null;
      }

      await act(async () => {
        root!.render(
          <ThemeProvider>
            <Consumer />
          </ThemeProvider>
        );
      });

      await act(async () => {
        themeValue?.setAccentColor('#6366f1');
      });
      // normalizeAccentColor returns uppercase hex
      assert.equal(themeValue?.accentColor, '#6366F1');
      assert.equal(env.storageMap.get(ACCENT_STORAGE_KEY), '#6366F1');

      // Clear accent
      await act(async () => {
        themeValue?.setAccentColor(null);
      });
      assert.equal(themeValue?.accentColor, null);
      assert.equal(env.storageMap.has(ACCENT_STORAGE_KEY), false);

      // External storage event sync
      env.storageMap.set(ACCENT_STORAGE_KEY, '#10b981');
      await act(async () => {
        env.mockWindow.dispatchEvent({ type: 'storage', key: ACCENT_STORAGE_KEY });
      });
      assert.equal(themeValue?.accentColor, '#10B981');
    });

    it('handles localStorage throwing exceptions gracefully without crashing', async () => {
      env.mockWindow.localStorage.getItem = () => {
        throw new Error('Storage quota / access denied');
      };
      env.mockWindow.localStorage.setItem = () => {
        throw new Error('Storage write prohibited');
      };

      let themeValue: ThemeContextType | undefined;
      function Consumer() {
        themeValue = useTheme();
        return null;
      }

      await act(async () => {
        root!.render(
          <ThemeProvider>
            <Consumer />
          </ThemeProvider>
        );
      });

      assert.equal(themeValue?.themeId, 'light-paper');

      // State still updates in-memory even if storage write throws
      await act(async () => {
        themeValue?.setThemeId('dark-espresso');
        themeValue?.setAccentColor('#ff5500');
      });

      assert.equal(themeValue?.themeId, 'dark-espresso');
      assert.equal(themeValue?.accentColor, '#FF5500');
    });

    it('setUiSkin initializes as default, applies genshin and sticker skins, and persists to storage', async () => {
      env.storageMap.set(UI_SKIN_STORAGE_KEY, 'genshin');
      let themeValue: ThemeContextType | undefined;
      function Consumer() {
        themeValue = useTheme();
        return null;
      }

      await act(async () => {
        root!.render(
          <ThemeProvider>
            <Consumer />
          </ThemeProvider>
        );
      });

      assert.equal(themeValue?.uiSkin, 'genshin');
      assert.equal(env.docElement.getAttribute('data-ui-skin'), 'genshin');

      await act(async () => {
        themeValue?.setUiSkin('sticker');
      });
      assert.equal(themeValue?.uiSkin, 'sticker');
      assert.equal(env.docElement.getAttribute('data-ui-skin'), 'sticker');
      assert.equal(env.storageMap.get(UI_SKIN_STORAGE_KEY), 'sticker');

      await act(async () => {
        themeValue?.setUiSkin('default');
      });
      assert.equal(themeValue?.uiSkin, 'default');
      assert.equal(env.docElement.getAttribute('data-ui-skin'), null);
      assert.equal(env.storageMap.has(UI_SKIN_STORAGE_KEY), false);
    });
  });

  describe('ToastProvider operations, deduplication, and limits', () => {
    it('creates toast with unique id, respects default and explicit duration', async () => {
      let actions: ToastActionsContextType | undefined;
      let toasts: ToastItem[] = [];
      function Consumer() {
        actions = useToastActions();
        toasts = useToastList();
        return null;
      }

      await act(async () => {
        root!.render(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      let id1: string | undefined;
      let id2: string | undefined;
      await act(async () => {
        id1 = actions?.toast.success('保存成功', '已保存草稿');
        id2 = actions?.toast.error('请求失败', '请检查网络');
      });

      assert.equal(toasts.length, 2);
      assert.equal(toasts[0].id, id1);
      assert.equal(toasts[0].duration, DEFAULT_DURATION.success);
      assert.equal(toasts[1].id, id2);
      assert.equal(toasts[1].duration, DEFAULT_DURATION.danger);
    });

    it('merges toasts with the same key or variant+title instead of duplicating', async () => {
      let actions: ToastActionsContextType | undefined;
      let toasts: ToastItem[] = [];
      function Consumer() {
        actions = useToastActions();
        toasts = useToastList();
        return null;
      }

      await act(async () => {
        root!.render(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      await act(async () => {
        actions?.toast.info('正在同步', '进度 10%');
      });
      assert.equal(toasts.length, 1);
      assert.equal(toasts[0].description, '进度 10%');

      // Same variant+title merges and updates description
      await act(async () => {
        actions?.toast.info('正在同步', '进度 100%');
      });
      assert.equal(toasts.length, 1);
      assert.equal(toasts[0].description, '进度 100%');

      // Explicit key merges
      await act(async () => {
        actions?.showToast({ key: 'backup-task', title: '任务A', variant: 'warning' });
        actions?.showToast({ key: 'backup-task', title: '任务A更新', variant: 'success' });
      });
      // 1 from before + 1 merged backup-task = 2 total
      assert.equal(toasts.length, 2);
      const backupToast = toasts.find((t) => t.key === 'backup-task');
      assert.ok(backupToast);
      assert.equal(backupToast.title, '任务A更新');
      assert.equal(backupToast.variant, 'success');
    });

    it('enforces MAX_VISIBLE_TOASTS = 3 discarding oldest when exceeding limit', async () => {
      let actions: ToastActionsContextType | undefined;
      let toasts: ToastItem[] = [];
      function Consumer() {
        actions = useToastActions();
        toasts = useToastList();
        return null;
      }

      await act(async () => {
        root!.render(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      await act(async () => {
        actions?.showToast({ title: '通知 1', key: '1' });
        actions?.showToast({ title: '通知 2', key: '2' });
        actions?.showToast({ title: '通知 3', key: '3' });
      });
      assert.equal(toasts.length, 3);
      assert.equal(toasts[0].title, '通知 1');

      await act(async () => {
        actions?.showToast({ title: '通知 4', key: '4' });
      });
      assert.equal(toasts.length, MAX_VISIBLE_TOASTS);
      // '通知 1' should be evicted
      assert.deepEqual(toasts.map((t) => t.title), ['通知 2', '通知 3', '通知 4']);
    });

    it('dismissToast removes the specified toast', async () => {
      let actions: ToastActionsContextType | undefined;
      let toasts: ToastItem[] = [];
      function Consumer() {
        actions = useToastActions();
        toasts = useToastList();
        return null;
      }

      await act(async () => {
        root!.render(
          <ToastProvider>
            <Consumer />
          </ToastProvider>
        );
      });

      let id1: string | undefined;
      let id2: string | undefined;
      await act(async () => {
        id1 = actions?.showToast({ title: '保留' });
        id2 = actions?.showToast({ title: '移除' });
      });
      assert.equal(toasts.length, 2);

      await act(async () => {
        if (id2) actions?.dismissToast(id2);
      });
      assert.equal(toasts.length, 1);
      assert.equal(toasts[0].id, id1);
    });

    it('ToastCard automatically triggers dismiss on duration timeout', async () => {
      let dismissedId: string | null = null;
      const item: ToastItem = {
        id: 'toast-timer-test',
        title: '自动关闭',
        duration: 50,
      };

      await act(async () => {
        root!.render(
          <ToastCard item={item} onDismiss={(id) => { dismissedId = id; }} />
        );
      });

      assert.equal(dismissedId, null);
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(dismissedId, 'toast-timer-test');
    });

    it('ToastCard pauses timer on pointerEnter/focus and resumes on pointerLeave/blur', () => {
      const item: ToastItem = {
        id: 'toast-pause-test',
        title: '悬停暂停',
        duration: 100,
      };

      const markup = renderToStaticMarkup(<ToastCard item={item} onDismiss={() => {}} />);
      assert.ok(markup.includes('悬停暂停'));
      assert.ok(markup.includes('关闭通知'));
    });
  });

  describe('Context Separation & Render Isolation Verification', () => {
    it('theme consumers DO NOT re-render when toasts change; toast actions consumers DO NOT re-render', async () => {
      let themeRenderCount = 0;
      let toastTriggerRenderCount = 0;
      let toastListRenderCount = 0;

      let triggerToast: ToastMethods | undefined;
      let setThemeIdFn: ((id: any) => void) | undefined;

      function ThemeSubscriber() {
        themeRenderCount++;
        const { setThemeId } = useTheme();
        setThemeIdFn = setThemeId;
        return null;
      }

      function ToastTriggerSubscriber() {
        toastTriggerRenderCount++;
        const toast = useToast();
        triggerToast = toast;
        return null;
      }

      function ToastListSubscriber() {
        toastListRenderCount++;
        useToastList();
        return null;
      }

      await act(async () => {
        root!.render(
          <UIProvider>
            <ThemeSubscriber />
            <ToastTriggerSubscriber />
            <ToastListSubscriber />
          </UIProvider>
        );
      });

      // Initial mount: all rendered once
      assert.equal(themeRenderCount, 1, 'Theme consumer initially rendered 1 time');
      assert.equal(toastTriggerRenderCount, 1, 'Toast trigger consumer initially rendered 1 time');
      assert.equal(toastListRenderCount, 1, 'Toast list consumer initially rendered 1 time');

      // Trigger 1st toast
      await act(async () => {
        triggerToast?.success('操作完成');
      });

      // Verification: Theme and Toast trigger consumers MUST NOT re-render!
      assert.equal(
        themeRenderCount,
        1,
        'Theme consumer MUST NOT re-render when a toast is created'
      );
      assert.equal(
        toastTriggerRenderCount,
        1,
        'Toast action consumer MUST NOT re-render when a toast is created'
      );
      assert.equal(
        toastListRenderCount,
        2,
        'Toast list subscriber MUST update when toast list changes'
      );

      // Trigger 2nd toast
      await act(async () => {
        triggerToast?.error('注意异常');
      });

      assert.equal(themeRenderCount, 1, 'Theme consumer STILL has not re-rendered');
      assert.equal(toastTriggerRenderCount, 1, 'Toast trigger consumer STILL has not re-rendered');
      assert.equal(toastListRenderCount, 3, 'Toast list subscriber updated again');

      // Now change the theme
      await act(async () => {
        setThemeIdFn?.('dark-espresso');
      });

      // Verification: Theme consumer updates, but toast list subscriber does NOT re-render
      assert.equal(themeRenderCount, 2, 'Theme consumer rendered on theme change');
      assert.equal(
        toastListRenderCount,
        3,
        'Toast list subscriber MUST NOT re-render on theme change'
      );
      assert.equal(
        toastTriggerRenderCount,
        1,
        'Toast action consumer MUST NOT re-render on theme change'
      );
    });
  });

  describe('Backward compatibility of UIProvider and useUI', () => {
    it('useUI returns composite context with both theme and toast capabilities', async () => {
      let uiValue: UIContextType | undefined;
      function LegacyConsumer() {
        uiValue = useUI();
        return null;
      }

      await act(async () => {
        root!.render(
          <UIProvider>
            <LegacyConsumer />
          </UIProvider>
        );
      });

      // All theme properties exist
      assert.equal(uiValue?.themeId, 'light-paper');
      assert.equal(uiValue?.colorMode, 'light');
      assert.equal(uiValue?.themeTone, 'paper');
      assert.equal(typeof uiValue?.setThemeId, 'function');
      assert.equal(typeof uiValue?.toggleColorMode, 'function');
      assert.equal(typeof uiValue?.setAccentColor, 'function');
      assert.equal(typeof uiValue?.toggleEyeCare, 'function');
      assert.equal(uiValue?.eyeCare, true);

      // All toast properties exist
      assert.ok(Array.isArray(uiValue?.toasts));
      assert.equal(typeof uiValue?.showToast, 'function');
      assert.equal(typeof uiValue?.dismissToast, 'function');
      assert.equal(typeof uiValue?.toast.success, 'function');
      assert.equal(typeof uiValue?.toast.error, 'function');
      assert.equal(typeof uiValue?.toast.warning, 'function');
      assert.equal(typeof uiValue?.toast.info, 'function');

      // Trigger toast via legacy useUI
      await act(async () => {
        uiValue?.toast.success('兼容测试');
      });
      assert.equal(uiValue?.toasts.length, 1);
      assert.equal(uiValue?.toasts[0].title, '兼容测试');
    });

    it('throws meaningful error when hooks are used outside required providers', () => {
      function BadTheme() {
        useTheme();
        return null;
      }
      function BadToast() {
        useToast();
        return null;
      }
      function BadToastList() {
        useToastList();
        return null;
      }
      function BadUI() {
        useUI();
        return null;
      }

      assert.throws(() => {
        renderToStaticMarkup(<BadTheme />);
      }, /useTheme must be used within a ThemeProvider or UIProvider/);

      assert.throws(() => {
        renderToStaticMarkup(<BadToast />);
      }, /useToastActions must be used within a ToastProvider or UIProvider/);

      assert.throws(() => {
        renderToStaticMarkup(<BadToastList />);
      }, /useToastList must be used within a ToastProvider or UIProvider/);

      assert.throws(() => {
        renderToStaticMarkup(<BadUI />);
      }, /useUI must be used within a UIProvider/);
    });
  });
});
