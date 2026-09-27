'use client';

import type { ComicPage, ComicPanel, ComicTemplate } from '@sthstart/contracts';

interface ComicPageListProps {
  pages: ComicPage[];
  panels: ComicPanel[];
  selectedPageId: string;
  newPageTemplate: ComicTemplate;
  canAdd: boolean;
  onTemplateChange(template: ComicTemplate): void;
  onSelect(pageId: string): void;
  onAdd(): void;
  onMove(direction: -1 | 1): void;
  onRemove(): void;
}

export function ComicPageList({ pages, panels, selectedPageId, newPageTemplate, canAdd, onTemplateChange, onSelect, onAdd, onMove, onRemove }: ComicPageListProps) {
  const panelById = new Map(panels.map((panel) => [panel.id, panel]));
  const selectedIndex = pages.findIndex((page) => page.id === selectedPageId);
  return (
    <aside className="flex min-h-0 min-w-0 max-h-44 flex-col border-b border-border-default bg-surface-muted/50 xl:max-h-none xl:border-b-0 xl:border-r">
      <div className="flex items-center justify-between border-b border-border-default px-3 py-2">
        <h3 className="text-sm font-semibold text-ink">漫画页</h3>
        <span className="text-xs text-muted">{pages.length}</span>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 gap-2 overflow-x-auto p-2 xl:block xl:space-y-2 xl:overflow-x-hidden xl:overflow-y-auto">
        {pages.map((page, index) => (
          <button key={page.id} type="button" onClick={() => onSelect(page.id)} aria-pressed={page.id === selectedPageId}
            className={`w-32 shrink-0 rounded-[var(--radius-panel)] border p-2 text-left transition-colors xl:w-full ${page.id === selectedPageId ? 'border-accent bg-accent/5' : 'border-border-default bg-surface hover:bg-surface-raised'}`}>
            <span className="flex items-center justify-between text-xs font-semibold text-ink"><span>第 {index + 1} 页</span><span className="text-muted">{page.panelIds.length} 格</span></span>
            <span className="mt-2 grid grid-cols-2 gap-1">
              {page.panelIds.map((panelId) => <span key={panelId} className="aspect-[4/3] rounded-sm bg-ink/10 p-1 text-[10px] text-muted line-clamp-2">{panelById.get(panelId)?.visualDescription || '空白画格'}</span>)}
            </span>
          </button>
        ))}
        {!pages.length && <p className="px-2 py-4 text-center text-xs text-muted">还没有页面</p>}
      </div>
      <div className="flex shrink-0 gap-1 border-t border-border-default p-2 xl:flex-col">
        <select aria-label="新页面版式" className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-border-default bg-surface px-2 text-xs text-ink xl:py-1.5" value={newPageTemplate} onChange={(event) => onTemplateChange(event.target.value as ComicTemplate)}>
          <option value="single">单格</option><option value="duo">双格</option><option value="trio">三格</option><option value="quad">四格</option>
        </select>
        <button type="button" onClick={onAdd} disabled={!canAdd} className="rounded-[var(--radius-control)] border border-dashed border-border-strong px-2 py-1.5 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-50">＋ 新增页</button>
        {selectedIndex >= 0 && <div className="flex items-center gap-1 xl:justify-between">
          <button type="button" onClick={() => onMove(-1)} disabled={selectedIndex === 0} aria-label="页面前移" className="rounded border border-border-default px-2 text-xs text-ink disabled:opacity-40">↑</button>
          <button type="button" onClick={() => onMove(1)} disabled={selectedIndex === pages.length - 1} aria-label="页面后移" className="rounded border border-border-default px-2 text-xs text-ink disabled:opacity-40">↓</button>
          <button type="button" onClick={onRemove} aria-label="删除当前页" className="rounded border border-border-default px-2 text-xs text-danger">删除</button>
        </div>}
      </div>
    </aside>
  );
}
