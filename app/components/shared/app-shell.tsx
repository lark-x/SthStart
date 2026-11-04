'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Menu, PanelLeftClose, PanelLeftOpen, Search, X, ListTodo, ChevronDown, MoreHorizontal, SlidersHorizontal, Sun, Moon } from 'lucide-react';
import { NAV_APPS, NAV_PORTAL, NAV_SECTIONS, navDisplayLabel, type NavApp, type NavSection } from './navigation';
import { ThemeSwitcher } from './theme-switcher';
import { AutoHideScrollbars } from './auto-hide-scrollbars';
import { useOverlayAccessibility } from '../ui/overlay';
import { TaskDrawer } from './task-drawer';
import { useTheme } from '@/app/providers/ui-provider';
import { useGlobalTasks } from '@/app/features/tasks/queries';

const COLLAPSE_KEY = 'sthstart_nav_collapsed';
const COLLAPSED_SECTIONS_KEY = 'sthstart_nav_collapsed_sections';

let collapsedSectionsFallback = '[]';

function readCollapsedSectionsSnapshot() {
  try {
    return localStorage.getItem(COLLAPSED_SECTIONS_KEY) ?? collapsedSectionsFallback;
  } catch {
    return collapsedSectionsFallback;
  }
}

function serverSectionsSnapshot() { return '[]'; }

/** 1024–1439px 默认收窄为图标栏，用户显式选择过则沿用其偏好。 */
const NARROW_QUERY = '(min-width: 1024px) and (max-width: 1439px)';

/** 邻舍与工作区嵌入模式：使用精简外框，由页面自身提供退回全站导航的动作。 */
const EMBED_PREFIXES = ['/apps/linshe'];

function isActive(pathname: string, app: NavApp) {
  if (app.href === '/') return pathname === '/';
  return pathname === app.href || pathname.startsWith(`${app.href}/`);
}

function currentApp(pathname: string): NavApp | undefined {
  return NAV_APPS.find((app) => isActive(pathname, app));
}

/**
 * 导航偏好以外部存储形式读取：localStorage 记忆用户选择，未选择时按视口宽度决定。
 */
const navPrefListeners = new Set<() => void>();

function emitNavPref() {
  navPrefListeners.forEach((listener) => listener());
}

function subscribeNavPref(listener: () => void) {
  navPrefListeners.add(listener);
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener('change', listener);
  window.addEventListener('storage', listener);
  return () => {
    navPrefListeners.delete(listener);
    media.removeEventListener('change', listener);
    window.removeEventListener('storage', listener);
  };
}

function readCollapsedPref() {
  try {
    const stored = localStorage.getItem(COLLAPSE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    /* localStorage 不可用时退回视口判断 */
  }
  return window.matchMedia(NARROW_QUERY).matches;
}

function serverCollapsedPref() {
  return false;
}

/**
 * 全站应用外框：负责轻盈同色系侧栏导航、48px 顶部指令条与抽屉，并承载页面内容。
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const collapsedPref = useSyncExternalStore(subscribeNavPref, readCollapsedPref, serverCollapsedPref);
  const [mobileCollapsed, setMobileCollapsed] = useState<boolean | null>(null);
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

  const { colorMode, toggleColorMode } = useTheme();
  const isDark = colorMode === 'dark';

  const collapsed = mobileCollapsed ?? collapsedPref;
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
  const embed = EMBED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) || isActivityStudio || isStoryWorkspace || isNotebookEditor || isNarrativeFocus;

  const toggleCollapsed = useCallback(() => {
    setMobileCollapsed((prev) => {
      const next = !(prev ?? collapsedPref);
      try {
        localStorage.setItem(COLLAPSE_KEY, String(next));
      } catch {
        /* 忽略持久化失败 */
      }
      emitNavPref();
      return next;
    });
  }, [collapsedPref]);

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

  const active = currentApp(pathname);

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
        title="搜索与命令 (Cmd+K)"
        aria-label="搜索与命令快捷键"
      >
        <Search className="shell-nav-icon" aria-hidden="true" />
        <span className="shell-nav-text flex-1">搜索与命令</span>
        <kbd className="shell-nav-text rounded border border-nav-border bg-surface-sunken px-1.5 py-0.5 font-mono text-xs text-nav-muted">⌘K</kbd>
      </button>

      <nav className="shell-nav" aria-label="主导航">
        <div className="shell-nav-group">
          <Link
            href={NAV_PORTAL.href}
            title={collapsed ? navDisplayLabel(NAV_PORTAL) : undefined}
            className="shell-nav-link"
            data-active={isActive(pathname, NAV_PORTAL) || undefined}
            aria-current={isActive(pathname, NAV_PORTAL) ? 'page' : undefined}
            onClick={() => closeDrawer(false)}
          >
            <NAV_PORTAL.icon className="shell-nav-icon" aria-hidden="true" />
            <span className="shell-nav-text">{navDisplayLabel(NAV_PORTAL)}</span>
          </Link>
        </div>

        {NAV_SECTIONS.map((section) => {
          const apps = NAV_APPS.filter((app) => app.navSection === section);
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
                    const selected = isActive(pathname, app);
                    return (
                      <Link
                        key={app.href}
                        href={app.href}
                        className="shell-nav-link"
                        data-active={selected || undefined}
                        aria-current={selected ? 'page' : undefined}
                        title={collapsed ? navDisplayLabel(app) : undefined}
                        onClick={() => closeDrawer(false)}
                      >
                        <app.icon className="shell-nav-icon" aria-hidden="true" />
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
        <ThemeSwitcher className="w-full" compact={collapsed} dropDirection="up" variant="sidebar" />
        <button
          type="button"
          className="shell-collapse-btn"
          onClick={toggleCollapsed}
          aria-pressed={collapsed}
          aria-label={collapsed ? '展开导航' : '收起导航'}
          title={collapsed ? '展开导航' : '收起导航'}
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
      <div className="shell-root" data-embed="true">
        <AutoHideScrollbars />
        <div className="shell-main">{children}</div>
        {drawerOpen && (
          <>
            <div className="shell-drawer-backdrop" onClick={() => closeDrawer()} aria-hidden="true" />
            <div className="shell-drawer" ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="导航">
              <button
                ref={closeButtonRef}
                type="button"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-[var(--radius-control)] border border-border-default bg-surface text-muted"
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
    <div className="shell-root">
      <AutoHideScrollbars />
      <a href="#shell-content" className="shell-skip-link">跳至主要内容</a>
      <aside
        className="shell-sidebar"
        data-collapsed={collapsed || undefined}
        aria-label="侧边导航"
      >
        {navContent}
      </aside>

      <div className="shell-main">
        {/* Slim 48px Top Command Header: 降低操作密度，保留单主操作，次要收进菜单 */}
        <header className="shell-command-header" aria-label="全局指令条" data-testid="shell-header">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
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

            {/* Breadcrumb Hierarchy (Modern Sans-Serif) - 移动端标题完整 */}
            <div className="flex items-center gap-1.5 min-w-0 text-xs text-muted font-sans overflow-hidden">
              {pathname === '/' ? (
                <span className="font-sans font-semibold text-sm tracking-tight text-ink truncate">工作台</span>
              ) : active ? (
                <>
                  <span className="hidden sm:inline hover:text-ink transition-colors flex-none">{active.navSection}</span>
                  <span className="hidden sm:inline text-muted/60 flex-none">/</span>
                  <span className="font-semibold text-sm text-ink truncate">{active.title}</span>
                </>
              ) : pathname.startsWith('/settings') ? (
                <>
                  <span className="hidden sm:inline hover:text-ink transition-colors flex-none">系统与应用</span>
                  <span className="hidden sm:inline text-muted/60 flex-none">/</span>
                  <span className="font-semibold text-sm text-ink truncate">系统设置</span>
                </>
              ) : (
                <span className="font-sans font-semibold text-sm tracking-tight text-ink truncate">工作台</span>
              )}
            </div>
          </div>

          {/* 顶栏操作区：单主操作（搜索与命令），任务与次级操作收敛 */}
          <div className="flex items-center gap-1.5 flex-none">
            <button
              type="button"
              className="shell-command-action"
              onClick={() => {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }));
              }}
              title="搜索与命令 (Cmd+K / Ctrl+K)"
              aria-label="搜索与命令快捷键"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden md:inline text-sm font-medium">搜索与命令</span>
              <kbd className="hidden md:inline font-mono text-xs text-fg-subtle bg-surface-sunken px-1.5 py-0.5 rounded border border-border-subtle" aria-hidden="true">⌘K</kbd>
            </button>

            <button
              type="button"
              className="shell-command-action relative flex items-center gap-1.5"
              aria-label="打开任务中心"
              title="全局任务抽屉"
              onClick={() => setTaskDrawerOpen(true)}
            >
              <ListTodo className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline text-sm font-medium">任务</span>
              {activeTasksCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-[var(--fg-on-accent)]">
                  {activeTasksCount}
                </span>
              )}
            </button>

            {/* 更多菜单：收纳低频次要操作（主题切换、快速设置、快捷键提示等） */}
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
                  className="absolute right-0 z-[var(--z-menu)] mt-1.5 w-48 overflow-hidden rounded-[var(--radius-panel)] border border-border-default bg-surface py-1 shadow-[var(--shadow-floating)]"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      toggleColorMode();
                      setMoreMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-xs font-medium text-ink transition-colors hover:bg-surface-hover"
                  >
                    {isDark ? <Sun className="h-3.5 w-3.5 text-muted" aria-hidden="true" /> : <Moon className="h-3.5 w-3.5 text-muted" aria-hidden="true" />}
                    <span>{isDark ? '切换至日间模式' : '切换至夜间模式'}</span>
                  </button>
                  <Link
                    href="/settings/public-services"
                    role="menuitem"
                    onClick={() => setMoreMenuOpen(false)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-xs font-medium text-ink transition-colors hover:bg-surface-hover"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                    <span>模型与系统设置</span>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="shell-content" id="shell-content" tabIndex={-1}>{children}</main>
      </div>

      {drawerOpen && (
        <>
          <div className="shell-drawer-backdrop" onClick={() => closeDrawer()} aria-hidden="true" />
          <div className="shell-drawer" ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="导航">
            <button
              ref={closeButtonRef}
              type="button"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-[var(--radius-control)] border border-border-default bg-surface text-muted"
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
