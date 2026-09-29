'use client';

import Link from 'next/link';
import { ArrowUpRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NAV_APPS, NAV_SECTIONS, navDisplayLabel, type NavSection } from './shared/navigation';

type DirectoryFilter = '常用' | NavSection | '全部';

const FILTERS: DirectoryFilter[] = ['常用', ...NAV_SECTIONS, '全部'];
const COMMON_APP_IDS = new Set(['activities', 'story', 'creative', 'characters', 'notebook']);

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
          <p className="desk-eyebrow">YOUR CREATIVE TOOLS</p>
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
        <ul className="desk-directory-grid">
          {apps.map((app) => {
            const Icon = app.icon;
            return (
              <li key={app.id}>
                <Link href={app.href} className="desk-directory-card group">
                  <span className="desk-directory-icon"><Icon size={19} aria-hidden="true" /></span>
                  <span className="desk-directory-copy">
                    <span className="desk-directory-title">{navDisplayLabel(app)}</span>
                    <span className="desk-directory-description">{app.description}</span>
                  </span>
                  <ArrowUpRight className="desk-directory-arrow" size={16} aria-hidden="true" />
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
