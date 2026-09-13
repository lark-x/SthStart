'use client';

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react';
import { NAV_APPS, NAV_PORTAL, NAV_SECTIONS, navDisplayLabel, type NavApp } from './navigation';
import { EyeCareToggle } from './eye-care-toggle';
import { AutoHideScrollbars } from './auto-hide-scrollbars';

const COLLAPSE_KEY = 'sthstart_nav_collapsed';
/** 1024–1439px 默认收窄为图标栏，用户显式选择过则沿用其偏好。 */
const NARROW_QUERY = '(min-width: 1024px) and (max-width: 1439px)';

/** 邻舍嵌入模式：使用精简外框，由页面自身提供退回全站导航的动作。 */
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
 * 用 useSyncExternalStore 订阅，避免在 effect 中同步 setState 造成二次渲染，
 * 也保证服务端首帧与客户端首帧一致。
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
 * 全站应用外框：负责导航、移动端页头与抽屉，并承载页面内容。
 *
 * 不持有任何业务草稿状态；主题切换、导航收起等 UI 偏好不会导致页面重挂载。
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const collapsedPref = useSyncExternalStore(subscribeNavPref, readCollapsedPref, serverCollapsedPref);
  const [mobileCollapsed, setMobileCollapsed] = useState<boolean | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const collapsed = mobileCollapsed ?? collapsedPref;
  const embed = EMBED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

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

  // 抽屉：Escape 关闭、滚动锁、焦点进入与恢复。
  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.querySelector<HTMLElement>('a, button')?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen, closeDrawer]);

  const active = currentApp(pathname);
  const pageTitle = active ? active.title : NAV_PORTAL.title;

  const navContent = (
    <>
      <Link href="/" className="shell-brand" aria-label="SthStart 工作台" onClick={() => closeDrawer(false)}>
        <span className="shell-brand-mark" aria-hidden="true">S</span>
        <span className="shell-brand-text">SthStart</span>
      </Link>

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
          return (
            <div key={section} className="shell-nav-group">
              <p className="shell-nav-label">{section}</p>
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
          );
        })}
      </nav>

      <div className="shell-sidebar-foot">
        <EyeCareToggle className="w-full justify-start" />
        <button
          type="button"
          className="shell-collapse-btn"
          onClick={toggleCollapsed}
          aria-pressed={collapsed}
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
        <div className="shell-main">{children}</div>
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
        <div className="shell-mobilebar">
          <button
            ref={triggerRef}
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-border-default bg-surface text-ink"
            aria-label="打开导航"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="shell-mobilebar-title">{pageTitle}</span>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-border-default bg-surface text-muted"
            aria-label="搜索与命令"
            title="搜索与命令（Ctrl/Cmd + K）"
            onClick={() => {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
            }}
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <main className="shell-content" id="shell-content">{children}</main>
      </div>

      {drawerOpen && (
        <>
          <div className="shell-drawer-backdrop" onClick={() => closeDrawer()} aria-hidden="true" />
          <div className="shell-drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-label="导航">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center self-end rounded-[var(--radius-control)] border border-border-default bg-surface text-muted"
              onClick={() => closeDrawer()}
              aria-label="关闭导航"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            {navContent}
          </div>
        </>
      )}
    </div>
  );
}
