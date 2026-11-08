'use client';

import Link from 'next/link';
import { ArrowRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NAV_APPS, NAV_SECTIONS, navDisplayLabel, type NavSection } from './shared/navigation';

type DirectoryFilter = '常用' | NavSection | '全部';

const FILTERS: DirectoryFilter[] = ['常用', ...NAV_SECTIONS, '全部'];
const COMMON_APP_IDS = new Set(['projects', 'resources', 'characters', 'media', 'creative', 'calendar']);

/** 门户应用入口：优先展示高频创作工具，其余模块可按分类或名称快速查找。 */
export function AppDirectory() {
  const [filter, setFilter] = useState<DirectoryFilter>('常用');
  const [query, setQuery] = useState('');

  const apps = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return NAV_APPS.filter((app) => {
      if (filter === '常用' && !COMMON_APP_IDS.has(app.id)) return false;
      if (filter !== '常用' && filter !== '全部' && app.navSection !== filter) return false;
      if (!normalized) return true;
      const searchable = [app.title, app.navLabel, app.description, ...app.keywords]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      return searchable.includes(normalized);
    });
  }, [filter, query]);

  return (
    <section aria-labelledby="app-directory-title" className="desk-directory" data-testid="app-directory">
      <div className="desk-directory-heading">
        <div>
          <h2 id="app-directory-title" className="tpl-section-title">全部应用</h2>
        </div>
        <span className="desk-directory-count">{apps.length} / {NAV_APPS.length}</span>
      </div>

      <div className="desk-directory-controls">
        <div className="desk-directory-filters" role="group" aria-label="按类别筛选应用">
          {FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={filter === item}
              className="desk-directory-filter"
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <label className="desk-directory-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">搜索应用</span>
          <input
            aria-label="搜索应用"
            placeholder="搜索工具…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>×</button>
          )}
        </label>
      </div>

      {apps.length > 0 ? (
        <ul className="divide-y divide-border-subtle" role="list">
          {apps.map((app) => {
            const Icon = app.icon;
            return (
              <li key={app.id}>
                <Link
                  href={app.href}
                  className="group flex items-center gap-3 px-2 py-3 transition-colors hover:bg-surface-hover rounded-control"
                >
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-control bg-surface-sunken text-muted transition-colors group-hover:text-ink">
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center sm:gap-4">
                    <span className="truncate text-sm font-medium text-ink sm:w-40 sm:flex-none">
                      {navDisplayLabel(app)}
                    </span>
                    <span className="truncate text-xs text-muted">
                      {app.description}
                    </span>
                  </span>
                  <span className="hidden flex-none text-xs text-fg-subtle sm:inline">
                    {app.navSection}
                  </span>
                  <ArrowRight
                    className="h-4 w-4 flex-none text-muted opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="desk-directory-empty">
          <p>没有找到匹配的应用。</p>
          <button type="button" onClick={() => { setFilter('全部'); setQuery(''); }}>查看全部应用</button>
        </div>
      )}
    </section>
  );
}
