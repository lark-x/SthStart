'use client';

import { openCommandPalette } from '@/app/shell/command-palette-events';

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Menu, PanelLeftClose, PanelLeftOpen, Search, ListTodo, ChevronDown, MoreHorizontal, SlidersHorizontal, Sun, Moon } from 'lucide-react';
import { Menu as MantineMenu } from '@mantine/core';
import { NAV_APPS, NAV_PORTAL, NAV_SECTIONS, navDisplayLabel, type NavApp, type NavSection } from '@/app/shell/navigation';
import { findBestActiveApp } from '@/app/shell/nav-match';
import { resolveShellLayout } from '@/app/shell/shell-layout';
import { ThemeSwitcher } from '@/app/shell/theme-switcher';
import { SIDEBAR_COLLAPSE_KEY } from '@/app/shell/sidebar-preference';
import { AutoHideScrollbars } from '@/app/shell/auto-hide-scrollbars';
import { Button } from '@/app/components/ui/button';
import { IconButton } from '@/app/components/ui/icon-button';
import { Drawer } from '@/app/components/ui/drawer';
import { TaskDrawer } from '@/app/shell/task-drawer';
import { useTheme } from '@/app/providers/ui-provider';
import { useGlobalTasks } from '@/app/features/tasks/queries';

const COLLAPSED_SECTIONS_KEY = 'sthstart_nav_collapsed_sections';
const subscribePlatform = () => () => {};
const readCommandKey = () => /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';
const serverCommandKey = () => 'Ctrl K';

/* The browser snapshot is only read after the client tree has mounted. */
const subscribeClientReady = () => () => {};
const readClientReady = () => true;
const serverClientReady = () => false;

let collapsedSectionsFallback = '[]';

function readCollapsedSectionsSnapshot() {
  try {
    return localStorage.getItem(COLLAPSED_SECTIONS_KEY) ?? collapsedSectionsFallback;
  } catch {
    return collapsedSectionsFallback;
  }
}

function serverSectionsSnapshot() { return '[]'; }

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
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return;
    if (event.key === SIDEBAR_COLLAPSE_KEY || event.key === null) {
      document.documentElement.dataset.navCollapsed = event.newValue === 'false' ? 'false' : 'true';
    }
    if (event.key === SIDEBAR_COLLAPSE_KEY || event.key === COLLAPSED_SECTIONS_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    navPrefListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const readCollapsedPref = () => document.documentElement.dataset.navCollapsed !== 'false';

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
  const collapsed = useSyncExternalStore(subscribeNavPref, readCollapsedPref, serverCollapsedPref);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const { data: globalTasksData } = useGlobalTasks({ state: 'active' });
  const activeTasksCount = globalTasksData?.activeCount ?? 0;
  const triggerRef = useRef<HTMLButtonElement>(null);
  /* 打开导航抽屉的控件。页头按钮与嵌入外壳的入口都会带上自己，关闭时焦点
   * 回到真正被点击的那一个；工具栏触发器只在没有更具体的来源时兜底。 */
  const navInvokerRef = useRef<HTMLElement | null>(null);
  const commandAfterNavRef = useRef<{ invoker: HTMLElement | null } | null>(null);
  const [navHint, setNavHint] = useState<{ text: string; left: number; top: number } | null>(null);

  const { colorMode, toggleColorMode } = useTheme();
  const isDark = colorMode === 'dark';

  // Browser snapshot flips only after the client tree mounts. Server HTML has
  // no marker, so tests can separate hydration readiness from product clicks.
  const clientReady = useSyncExternalStore(subscribeClientReady, readClientReady, serverClientReady);

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

  const { workspaceHeader, workspace, workspaceKind, embed } = resolveShellLayout({ pathname, searchParams });
  const toggleCollapsed = useCallback(() => {
    const next = String(!readCollapsedPref());
    document.documentElement.dataset.navCollapsed = next;
    try {
      localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next);
    } catch {
      /* 外部存储仍通过会话回退值通知所有订阅者。 */
    }
    setNavHint(null);
    emitNavPref();
  }, []);

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

  /* 打开导航抽屉：记下真实触发器，并先聚焦它。WebKit 指针点击不聚焦按钮，
   * 先聚焦能让原生 close() 自己把焦点还回来；抽屉内部的补帧只是兜底。 */
  const openNavDrawer = useCallback((trigger: HTMLElement | null) => {
    commandAfterNavRef.current = null;
    navInvokerRef.current = trigger;
    trigger?.focus({ preventScroll: true });
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback((restoreFocus = true) => {
    /* 抽屉自己在 close() 之后归还焦点；这里先聚焦会在模态仍打开时被忽略，
     * 随后 close() 又把焦点交给浏览器，等于白做。导航跳转不需要归还。 */
    if (!restoreFocus) navInvokerRef.current = null;
    setDrawerOpen(false);
  }, []);

  const finishNavClose = useCallback(() => {
    const next = commandAfterNavRef.current;
    commandAfterNavRef.current = null;
    if (next) openCommandPalette(next.invoker);
  }, []);

  useEffect(() => {
    const handleOpenNav = (event: Event) => {
      const trigger = (event as CustomEvent<{ trigger?: HTMLElement | null }>).detail?.trigger;
      openNavDrawer(trigger instanceof HTMLElement ? trigger : null);
    };
    const handleOpenTasks = () => setTaskDrawerOpen(true);
    window.addEventListener('sthstart:open-nav-drawer', handleOpenNav);
    window.addEventListener('sthstart:open-task-drawer', handleOpenTasks);
    return () => {
      window.removeEventListener('sthstart:open-nav-drawer', handleOpenNav);
      window.removeEventListener('sthstart:open-task-drawer', handleOpenTasks);
    };
  }, [openNavDrawer]);

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
        data-tone="slate"
        onClick={(event) => {
          if (drawerOpen) {
            commandAfterNavRef.current = { invoker: navInvokerRef.current };
            closeDrawer();
            return;
          }
          openCommandPalette(event.currentTarget);
        }}
        title={`搜索与命令 (${commandKey})`}
        data-nav-label={`搜索与命令 (${commandKey})`}
        aria-label="搜索与命令快捷键"
      >
        <span className="shell-nav-icon-wrap" data-tone="slate"><Search className="shell-nav-icon" aria-hidden="true" /></span>
        <span className="shell-nav-text flex-1">搜索与命令</span>
        <kbd className="shell-nav-text shell-nav-kbd">{commandKey}</kbd>
      </button>

      <nav className="shell-nav" aria-label="主导航" tabIndex={0}>
        <div className="shell-nav-group">
          <Link
            href={NAV_PORTAL.href}
            title={collapsed ? navDisplayLabel(NAV_PORTAL) : undefined}
            data-nav-label={navDisplayLabel(NAV_PORTAL)}
            className="shell-nav-link"
            data-tone={NAV_PORTAL.tone}
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
                <div className="shell-nav-list" data-section-collapsed={isSectionCollapsed || undefined}>
                  {apps.map((app) => {
                    const selected = activeSidebarApp?.id === app.id;
                    return (
                      <Link
                        key={app.href}
                        href={app.href}
                        className="shell-nav-link"
                        data-tone={app.tone}
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
            </div>
          );
        })}
      </nav>

      <div className="shell-sidebar-foot">
        <ThemeSwitcher className="w-full" />
        <button
          type="button"
          className="shell-collapse-btn shell-sidebar-collapse-btn"
          data-nav-label={collapsed ? '展开导航' : '收起导航'}
          onClick={toggleCollapsed}
          aria-pressed={collapsed}
          aria-label={collapsed ? '展开导航' : '收起导航'}
          title={collapsed ? '展开导航' : '收起导航'}
        >
          <PanelLeftOpen className="shell-nav-icon shell-collapse-expand-icon" aria-hidden="true" />
          <PanelLeftClose className="shell-nav-icon shell-collapse-close-icon" aria-hidden="true" />
          <span className="shell-nav-text">收起侧栏</span>
        </button>
      </div>
    </>
  );

  if (embed) {
    return (
      <div className="shell-root" data-layout="b" data-embed="true" data-client-ready={clientReady ? 'true' : undefined}>
        <AutoHideScrollbars />
        <div className="shell-main">{children}</div>
        <Drawer className="shell-navigation-drawer" open={drawerOpen} onOpenChange={(next) => !next && closeDrawer()} onExitTransitionEnd={finishNavClose} title="导航" invokerRef={navInvokerRef}>
          {navContent}
        </Drawer>
        <TaskDrawer isOpen={taskDrawerOpen} onClose={() => setTaskDrawerOpen(false)} />
      </div>
    );
  }

  return (
    <div className="shell-root" data-layout="b" data-workspace={workspace ? workspaceKind : undefined} data-workspace-header={workspaceHeader || undefined} data-client-ready={clientReady ? 'true' : undefined}>
      <AutoHideScrollbars />
      <a href={`${pathname}#shell-content`} className="shell-skip-link" onClick={event => { event.preventDefault(); document.getElementById('shell-content')?.focus(); }}>跳至主要内容</a>
      <aside
        className="shell-sidebar"
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
                <IconButton
                  ref={triggerRef}
                  icon={Menu}
                  label="打开导航"
                  size="icon"
                  variant="ghost"
                  className="shell-command-action shell-nav-trigger"
                  aria-expanded={drawerOpen}
                  onClick={(event) => openNavDrawer(event.currentTarget)}
                />

              </div>

              <div className="shell-toolbar-actions">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="shell-command-action shell-search-trigger [&_.ui-mantine-button-label]:gap-2"
                  onClick={(event) => openCommandPalette(event.currentTarget)}
                  title={`搜索与命令 (${commandKey})`}
                  aria-label="搜索与命令快捷键"
                >
                  <Search className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden md:inline">搜索</span>
                  <kbd className="hidden md:inline" aria-hidden="true">{commandKey}</kbd>
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="shell-command-action relative [&_.ui-mantine-button-label]:gap-2"
                  aria-label="打开任务中心"
                  title="全局任务抽屉"
                  onClick={() => setTaskDrawerOpen(true)}
                >
                  <ListTodo className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">任务</span>
                  {activeTasksCount > 0 && <span className="shell-task-count">{activeTasksCount}</span>}
                </Button>

                {/* 更多菜单：Mantine owns menu focus, dismissal and portal placement. */}
                <MantineMenu position="bottom-end" returnFocus shadow="md" radius="md">
                  <MantineMenu.Target>
                    <IconButton icon={MoreHorizontal} label="更多操作" size="icon" variant="ghost" className="shell-command-action" />
                  </MantineMenu.Target>
                  <MantineMenu.Dropdown aria-label="更多操作菜单">
                    <MantineMenu.Item
                      leftSection={isDark ? <Sun className="h-4 w-4 text-muted" /> : <Moon className="h-4 w-4 text-muted" />}
                      onClick={toggleColorMode}
                    >
                      {isDark ? '切换至日间模式' : '切换至夜间模式'}
                    </MantineMenu.Item>
                    <MantineMenu.Item
                      component={Link}
                      href="/settings/public-services"
                      leftSection={<SlidersHorizontal className="h-4 w-4 text-muted" />}
                    >
                      模型与系统设置
                    </MantineMenu.Item>
                  </MantineMenu.Dropdown>
                </MantineMenu>
              </div>
            </div>
          </header>}

          <main className="shell-content" data-section={pathname.startsWith('/settings') ? 'settings' : undefined} id="shell-content" tabIndex={-1}>{children}</main>
        </div>
      </div>

      <Drawer className="shell-navigation-drawer" open={drawerOpen} onOpenChange={(next) => !next && closeDrawer()} onExitTransitionEnd={finishNavClose} title="导航" invokerRef={navInvokerRef}>
        {navContent}
      </Drawer>

      <TaskDrawer isOpen={taskDrawerOpen} onClose={() => setTaskDrawerOpen(false)} />
      {navHint && collapsed && !drawerOpen && (
        <div className="shell-nav-tooltip" role="tooltip" style={{ left: navHint.left, top: navHint.top }}>{navHint.text}</div>
      )}
    </div>
  );
}
