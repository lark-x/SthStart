'use client';

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Menu, PanelLeftClose, PanelLeftOpen, Search, X, ListTodo, ChevronDown } from 'lucide-react';
import { NAV_APPS, NAV_PORTAL, NAV_SECTIONS, navDisplayLabel, type NavApp, type NavSection } from './navigation';
import { ThemeSwitcher } from './theme-switcher';
import { AutoHideScrollbars } from './auto-hide-scrollbars';
import { useOverlayAccessibility } from '../ui/overlay';
import { TaskDrawer } from './task-drawer';
import { useGlobalTasks } from '@/app/features/tasks/queries';

const COLLAPSE_KEY = 'sthstart_nav_collapsed';
const COLLAPSED_SECTIONS_KEY = 'sthstart_nav_collapsed_sections';

function readCollapsedSectionsPref(): Set<NavSection> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(COLLAPSED_SECTIONS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed as NavSection[]);
    }
  } catch {
    /* ignore */
  }
  return new Set();
}

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
 * 全站应用外框：负责导航、48px 顶部指令条与抽屉，并承载页面内容。
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const collapsedPref = useSyncExternalStore(subscribeNavPref, readCollapsedPref, serverCollapsedPref);
  const [mobileCollapsed, setMobileCollapsed] = useState<boolean | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const { data: globalTasksData } = useGlobalTasks({ state: 'active' });
  const activeTasksCount = globalTasksData?.activeCount ?? 0;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const collapsed = mobileCollapsed ?? collapsedPref;
  const [collapsedSections, setCollapsedSections] = useState<Set<NavSection>>(new Set());

  useEffect(() => {
    setCollapsedSections(readCollapsedSectionsPref());
  }, []);

  const toggleSection = useCallback((section: NavSection) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      try {
        localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify(Array.from(next)));
      } catch {
        /* 忽略持久化失败 */
      }
      return next;
    });
  }, []);

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
        <kbd className="shell-nav-text rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-nav-muted">⌘K</kbd>
      </button>

      <nav className="shell-nav" aria-label="主导航">
        <div className="shell-nav-group">
          <Link
            href={NAV_PORTAL.href}
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
          <span className="shell-nav-text">{collapsed ? '展开' : '收起'}</span>
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
      <aside
        className="shell-sidebar"
        data-collapsed={collapsed || undefined}
        aria-label="侧边导航"
      >
        {navContent}
      </aside>

      <div className="shell-main">
        {/* Slim 48px Top Command Header */}
        <header className="shell-command-header" aria-label="全局指令条">
          <div className="flex items-center gap-3 min-w-0">
            <button
              ref={triggerRef}
              type="button"
              className="lg:hidden inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-default/70 bg-surface/70 text-ink transition-colors hover:bg-surface-hover"
              aria-label="打开导航"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>

            {/* Breadcrumb Hierarchy */}
            <div className="flex items-center gap-1.5 min-w-0 text-xs text-muted font-sans">
              {pathname === '/' ? (
                <span className="font-serif font-bold text-sm tracking-tight text-ink">工作台</span>
              ) : active ? (
                <>
                  <span className="hidden sm:inline hover:text-ink transition-colors">{active.navSection}</span>
                  <span className="hidden sm:inline text-muted/60">/</span>
                  <span className="font-medium text-ink truncate">{active.title}</span>
                </>
              ) : pathname.startsWith('/settings') ? (
                <>
                  <span className="hidden sm:inline hover:text-ink transition-colors">系统与应用</span>
                  <span className="hidden sm:inline text-muted/60">/</span>
                  <span className="font-medium text-ink truncate">系统设置</span>
                </>
              ) : (
                <span className="font-serif font-bold text-sm tracking-tight text-ink">工作台</span>
              )}
            </div>
          </div>

          {/* Quick Access Control Capsules */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-default/70 bg-surface/70 px-2.5 text-xs text-muted hover:text-ink hover:border-border-default transition-colors"
              onClick={() => {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }));
              }}
              title="搜索与命令 (Cmd+K)"
              aria-label="搜索与命令快捷键"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden md:inline">搜索与命令</span>
              <kbd className="hidden md:inline font-mono text-[10px] text-muted bg-surface-sunken px-1 rounded border border-border-subtle">⌘K</kbd>
            </button>

            <button
              type="button"
              className="relative inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-default/70 bg-surface/70 px-2.5 text-xs text-muted hover:text-ink hover:border-border-default transition-colors"
              aria-label="打开任务中心"
              title="全局任务中心"
              onClick={() => setTaskDrawerOpen(true)}
            >
              <ListTodo className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              <span className="hidden sm:inline">任务</span>
              {activeTasksCount > 0 && (
                <span className="bg-accent text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  {activeTasksCount}
                </span>
              )}
            </button>

            <ThemeSwitcher />
          </div>
        </header>

        <main className="shell-content" id="shell-content">{children}</main>
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
