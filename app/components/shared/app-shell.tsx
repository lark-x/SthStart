'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import { Menu, PanelLeftClose, PanelLeftOpen, Search, X, ListTodo, ChevronDown, MoreHorizontal, SlidersHorizontal, Sun, Moon } from 'lucide-react';
import { NAV_APPS, NAV_PORTAL, NAV_SECTIONS, navDisplayLabel, type NavApp, type NavSection } from './navigation';
import { findBestActiveApp } from './nav-match';
import { ThemeSwitcher } from './theme-switcher';
import { AutoHideScrollbars } from './auto-hide-scrollbars';
import { useOverlayAccessibility } from '../ui/overlay';
import { TaskDrawer } from './task-drawer';
import { useTheme } from '@/app/providers/ui-provider';
import { useGlobalTasks } from '@/app/features/tasks/queries';

const COLLAPSE_KEY = 'sthstart_nav_collapsed';
const COLLAPSED_SECTIONS_KEY = 'sthstart_nav_collapsed_sections';
const subscribePlatform = () => () => {};
const readCommandKey = () => /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';
const serverCommandKey = () => 'Ctrl K';

let collapsedSectionsFallback = '[]';
let collapsedPrefFallback = true;

function readCollapsedSectionsSnapshot() {
  try {
    return localStorage.getItem(COLLAPSED_SECTIONS_KEY) ?? collapsedSectionsFallback;
  } catch {
    return collapsedSectionsFallback;
  }
}

function serverSectionsSnapshot() { return '[]'; }

/** 邻舍与工作区嵌入模式：使用精简外框，由页面自身提供退回全站导航的动作。 */
const EMBED_PREFIXES = ['/apps/linshe'];

/** 导航图标：放进模块色小方块，选中时由 CSS 铺上模块浅底。 */
function NavIcon({ app }: { app: NavApp }) {
  return (
    <span className="shell-nav-icon-wrap" data-tone={app.tone}>
      <app.icon className="shell-nav-icon" aria-hidden="true" />
    </span>
  );
}

/**
 * B 导航默认使用图标栏；显式选择保留到下次访问，存储不可用时保留会话偏好。
 */
const navPrefListeners = new Set<() => void>();

function emitNavPref() {
  navPrefListeners.forEach((listener) => listener());
}

function subscribeNavPref(listener: () => void) {
  navPrefListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    navPrefListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function readCollapsedPref() {
  try {
    const stored = localStorage.getItem(COLLAPSE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    /* localStorage 不可用时沿用会话偏好。 */
  }
  return collapsedPrefFallback;
}

function serverCollapsedPref() {
  return true;
}

/**
 * B 外框：紧凑导航、全局工具条与共享画布，各页面在画布上组织独立工作面。
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const commandKey = useSyncExternalStore(subscribePlatform, readCommandKey, serverCommandKey);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const collapsedPref = useSyncExternalStore(subscribeNavPref, readCollapsedPref, serverCollapsedPref);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const { data: globalTasksData } = useGlobalTasks({ state: 'active' });
  const activeTasksCount = globalTasksData?.activeCount ?? 0;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuId = React.useId();
  const [navHint, setNavHint] = useState<{ text: string; left: number; top: number } | null>(null);

  const { colorMode, toggleColorMode } = useTheme();
  const isDark = colorMode === 'dark';

  const sectionsSnapshot = useSyncExternalStore(subscribeNavPref, readCollapsedSectionsSnapshot, serverSectionsSnapshot);
  const collapsedSections = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(sectionsSnapshot);
      return new Set<NavSection>(Array.isArray(parsed) ? parsed.filter((value): value is NavSection => NAV_SECTIONS.includes(value)) : []);
    } catch {
      return new Set<NavSection>();
    }
  }, [sectionsSnapshot]);

  const toggleSection = useCallback((section: NavSection) => {
    const next = new Set(collapsedSections);
    if (next.has(section)) next.delete(section);
    else next.add(section);
    collapsedSectionsFallback = JSON.stringify(Array.from(next));
    try {
      localStorage.setItem(COLLAPSED_SECTIONS_KEY, collapsedSectionsFallback);
    } catch {
      /* Storage 不可用时保留本次会话偏好。 */
    }
    emitNavPref();
  }, [collapsedSections]);

  const isActivityStudio = pathname.startsWith('/apps/activities/') && pathname !== '/apps/activities/new';
  const isStoryWorkspace = pathname.startsWith('/apps/story/') && pathname.split('/').filter(Boolean).length === 3;
  const isNarrativeFocus = pathname === '/apps/narrative' && (searchParams.get('view') === 'review' || (!searchParams.has('project') && !['research', 'import'].includes(searchParams.get('mode') ?? 'read')));
  const isNotebookEditor = pathname.startsWith('/apps/notebook/') && pathname !== '/apps/notebook/offline';
  const embed = EMBED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const workspaceHeader = isActivityStudio || isStoryWorkspace || isNotebookEditor || isNarrativeFocus;
  const workspace = workspaceHeader || pathname === '/apps/resources' || pathname === '/apps/notebook' || pathname === '/apps/creative';
  // 工作台临时使用紧凑导航，不写回普通页面的展开偏好。
  const collapsed = workspaceHeader || collapsedPref;
  const workspaceKind = pathname === '/apps/creative' ? 'creative' : workspaceHeader ? 'editor' : 'library';

  const toggleCollapsed = useCallback(() => {
    collapsedPrefFallback = !collapsedPref;
    try {
      localStorage.setItem(COLLAPSE_KEY, String(collapsedPrefFallback));
    } catch {
      /* 外部存储仍通过会话回退值通知所有订阅者。 */
    }
    setNavHint(null);
    emitNavPref();
  }, [collapsedPref]);

  const showNavHint = (target: EventTarget) => {
    if (!collapsed || !(target instanceof Element)) return;
    const item = target.closest<HTMLElement>('[data-nav-label]');
    if (!item) { setNavHint(null); return; }
    const rect = item.getBoundingClientRect();
    setNavHint({
      text: item.dataset.navLabel ?? '',
      left: rect.right + 12,
      top: Math.max(24, Math.min(window.innerHeight - 24, rect.top + rect.height / 2)),
    });
  };

  const closeDrawer = useCallback((restoreFocus = true) => {
    setDrawerOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleOpenNav = () => setDrawerOpen(true);
    const handleOpenTasks = () => setTaskDrawerOpen(true);
    window.addEventListener('sthstart:open-nav-drawer', handleOpenNav);
    window.addEventListener('sthstart:open-task-drawer', handleOpenTasks);
    return () => {
      window.removeEventListener('sthstart:open-nav-drawer', handleOpenNav);
      window.removeEventListener('sthstart:open-task-drawer', handleOpenTasks);
    };
  }, []);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node) && !moreTriggerRef.current?.contains(event.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMoreMenuOpen(false);
        moreTriggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [moreMenuOpen]);

  useOverlayAccessibility({
    open: drawerOpen,
    onRequestClose: closeDrawer,
    containerRef: drawerRef,
    initialFocusRef: closeButtonRef,
  });

  useEffect(() => {
    if (!drawerOpen || embed) return;
    const desktop = window.matchMedia('(min-width: 1024px)');
    const onDesktop = () => {
      if (desktop.matches) closeDrawer(false);
    };
    desktop.addEventListener('change', onDesktop);
    return () => desktop.removeEventListener('change', onDesktop);
  }, [drawerOpen, embed, closeDrawer]);

  const activeSidebarApp = useMemo(() => {
    const visible = NAV_APPS.filter((app) => !app.hiddenFromSidebar);
    return findBestActiveApp(pathname, visible);
  }, [pathname]);

  const navContent = (
    <>
      <Link href="/" className="shell-brand" aria-label="SthStart 工作台" onClick={() => closeDrawer(false)}>
        <span className="shell-brand-mark" aria-hidden="true">S</span>
        <span className="shell-brand-text">SthStart</span>
      </Link>

      <button
        type="button"
        className="shell-nav-link w-full text-left"
        onClick={() => {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }));
        }}
        title={`搜索与命令 (${commandKey})`}
        data-nav-label={`搜索与命令 (${commandKey})`}
        aria-label="搜索与命令快捷键"
      >
        <span className="shell-nav-icon-wrap" data-tone="slate"><Search className="shell-nav-icon" aria-hidden="true" /></span>
        <span className="shell-nav-text flex-1">搜索与命令</span>
        <kbd className="shell-nav-text shell-nav-kbd">{commandKey}</kbd>
      </button>

      <nav className="shell-nav" aria-label="主导航">
        <div className="shell-nav-group">
          <Link
            href={NAV_PORTAL.href}
            title={collapsed ? navDisplayLabel(NAV_PORTAL) : undefined}
            data-nav-label={navDisplayLabel(NAV_PORTAL)}
            className="shell-nav-link"
            data-active={(pathname === '/' && !activeSidebarApp) || undefined}
            aria-current={pathname === '/' ? 'page' : undefined}
            onClick={() => closeDrawer(false)}
          >
            <NavIcon app={NAV_PORTAL} />
            <span className="shell-nav-text">{navDisplayLabel(NAV_PORTAL)}</span>
          </Link>
        </div>

        {NAV_SECTIONS.map((section) => {
          const apps = NAV_APPS.filter((app) => app.navSection === section && !app.hiddenFromSidebar);
          if (apps.length === 0) return null;
          const isSectionCollapsed = collapsedSections.has(section);
          return (
            <div key={section} className="shell-nav-group">
              <button
                type="button"
                className="shell-nav-label-btn"
                onClick={() => toggleSection(section)}
                aria-expanded={!isSectionCollapsed}
                aria-label={`${section}（${isSectionCollapsed ? '已折叠，点击展开' : '已展开，点击收起'}）`}
                title={`${section}（${isSectionCollapsed ? '点击展开' : '点击收起'}）`}
              >
                <span className="shell-nav-label-text">{section}</span>
                <ChevronDown className="shell-nav-chevron" aria-hidden="true" />
              </button>
              {(!isSectionCollapsed || collapsed) && (
                <div className="shell-nav-list">
                  {apps.map((app) => {
                    const selected = activeSidebarApp?.id === app.id;
                    return (
                      <Link
                        key={app.href}
                        href={app.href}
                        className="shell-nav-link"
                        data-active={selected || undefined}
                        aria-current={selected ? 'page' : undefined}
                        title={collapsed ? navDisplayLabel(app) : undefined}
                        data-nav-label={navDisplayLabel(app)}
                        onClick={() => closeDrawer(false)}
                      >
                        <NavIcon app={app} />
                        <span className="shell-nav-text">{navDisplayLabel(app)}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="shell-sidebar-foot">
        <ThemeSwitcher className="w-full" compact={collapsed && !drawerOpen} dropDirection="up" variant="sidebar" />
        <button
          type="button"
          className="shell-collapse-btn"
          data-nav-label={collapsed ? '展开导航' : '收起导航'}
          onClick={workspaceHeader ? () => setDrawerOpen(true) : toggleCollapsed}
          aria-pressed={collapsed}
          aria-label={workspaceHeader ? '打开完整导航' : collapsed ? '展开导航' : '收起导航'}
          title={workspaceHeader ? '打开完整导航' : collapsed ? '展开导航' : '收起导航'}
        >
          {collapsed
            ? <PanelLeftOpen className="shell-nav-icon" aria-hidden="true" />
            : <PanelLeftClose className="shell-nav-icon" aria-hidden="true" />}
          <span className="shell-nav-text">{collapsed ? '展开侧栏' : '收起侧栏'}</span>
        </button>
      </div>
    </>
  );

  if (embed) {
    return (
      <div className="shell-root" data-layout="b" data-embed="true">
        <AutoHideScrollbars />
        <div className="shell-main">{children}</div>
        {drawerOpen && (
          <>
            <div className="shell-drawer-backdrop" onClick={() => closeDrawer()} aria-hidden="true" />
            <div className="shell-drawer" ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="导航">
              <button
                ref={closeButtonRef}
                type="button"
                className="shell-drawer-close"
                onClick={() => closeDrawer()}
                aria-label="关闭导航"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
              {navContent}
            </div>
          </>
        )}
        <TaskDrawer isOpen={taskDrawerOpen} onClose={() => setTaskDrawerOpen(false)} />
      </div>
    );
  }

  return (
    <div className="shell-root" data-layout="b" data-workspace={workspace ? workspaceKind : undefined} data-workspace-header={workspaceHeader || undefined}>
      <AutoHideScrollbars />
      <a href={`${pathname}#shell-content`} className="shell-skip-link" onClick={event => { event.preventDefault(); document.getElementById('shell-content')?.focus(); }}>跳至主要内容</a>
      <aside
        className="shell-sidebar"
        data-collapsed={collapsed || undefined}
        aria-label="侧边导航"
        onMouseOver={(event) => showNavHint(event.target)}
        onMouseLeave={() => setNavHint(null)}
        onFocusCapture={(event) => showNavHint(event.target)}
        onBlurCapture={() => setNavHint(null)}
        onScrollCapture={() => setNavHint(null)}
        onKeyDown={(event) => { if (event.key === 'Escape') setNavHint(null); }}
      >
        {navContent}
      </aside>

      <div className="shell-main">
        <div className="shell-surface">
          {/* 全局工具只放通用操作；当前位置由侧栏与页面主标题表达。 */}
          {!workspaceHeader && <header className="shell-toolbar" aria-label="全局指令条" data-testid="shell-header">
            <div className="shell-toolbar-inner">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <button
                  ref={triggerRef}
                  type="button"
                  className="shell-command-action shell-nav-trigger"
                  aria-label="打开导航"
                  aria-expanded={drawerOpen}
                  onClick={() => setDrawerOpen(true)}
                >
                  <Menu className="h-4 w-4" aria-hidden="true" />
                </button>

              </div>

              <div className="shell-toolbar-actions">
                <button
                  type="button"
                  className="shell-command-action shell-search-trigger"
                  onClick={() => {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }));
                  }}
                  title={`搜索与命令 (${commandKey})`}
                  aria-label="搜索与命令快捷键"
                >
                  <Search className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden md:inline">搜索</span>
                  <kbd className="hidden md:inline" aria-hidden="true">{commandKey}</kbd>
                </button>

                <button
                  type="button"
                  className="shell-command-action relative"
                  aria-label="打开任务中心"
                  title="全局任务抽屉"
                  onClick={() => setTaskDrawerOpen(true)}
                >
                  <ListTodo className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">任务</span>
                  {activeTasksCount > 0 && <span className="shell-task-count">{activeTasksCount}</span>}
                </button>

                {/* 更多菜单：收纳低频次要操作（主题切换、快速设置等） */}
                <div className="relative" ref={moreMenuRef}>
                  <button
                    ref={moreTriggerRef}
                    type="button"
                    className="shell-command-action"
                    aria-label="更多操作"
                    aria-haspopup="menu"
                    aria-expanded={moreMenuOpen}
                    aria-controls={moreMenuOpen ? moreMenuId : undefined}
                    onClick={() => setMoreMenuOpen((v) => !v)}
                    title="更多操作"
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </button>

                  {moreMenuOpen && (
                    <div
                      id={moreMenuId}
                      role="menu"
                      aria-label="更多操作菜单"
                      className="absolute right-0 z-[var(--z-menu)] mt-1.5 w-52 overflow-hidden rounded-panel border border-border-subtle bg-surface-raised p-1 shadow-floating"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          toggleColorMode();
                          setMoreMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-hover"
                      >
                        {isDark ? <Sun className="h-4 w-4 text-muted" aria-hidden="true" /> : <Moon className="h-4 w-4 text-muted" aria-hidden="true" />}
                        <span>{isDark ? '切换至日间模式' : '切换至夜间模式'}</span>
                      </button>
                      <Link
                        href="/settings/public-services"
                        role="menuitem"
                        onClick={() => setMoreMenuOpen(false)}
                        className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-hover"
                      >
                        <SlidersHorizontal className="h-4 w-4 text-muted" aria-hidden="true" />
                        <span>模型与系统设置</span>
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </header>}

          <main className="shell-content" data-section={pathname.startsWith('/settings') ? 'settings' : undefined} id="shell-content" tabIndex={-1}>{children}</main>
        </div>
      </div>

      {drawerOpen && (
        <>
          <div className="shell-drawer-backdrop" onClick={() => closeDrawer()} aria-hidden="true" />
          <div className="shell-drawer" ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="导航">
            <button
              ref={closeButtonRef}
              type="button"
              className="shell-drawer-close"
              onClick={() => closeDrawer()}
              aria-label="关闭导航"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            {navContent}
          </div>
        </>
      )}

      <TaskDrawer isOpen={taskDrawerOpen} onClose={() => setTaskDrawerOpen(false)} />
      {navHint && collapsed && !drawerOpen && createPortal(
        <div className="shell-nav-tooltip" role="tooltip" style={{ left: navHint.left, top: navHint.top }}>{navHint.text}</div>,
        document.body,
      )}
    </div>
  );
}
