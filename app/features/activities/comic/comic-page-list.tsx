'use client';

import type { ComicPage, ComicPanel, ComicTemplate } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Select } from '@/app/components/ui/select';

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
            className={`w-32 shrink-0 rounded-panel border p-2 text-left transition-colors xl:w-full ${page.id === selectedPageId ? 'border-accent bg-accent/5' : 'border-border-default bg-surface hover:bg-surface-raised'}`}>
            <span className="flex items-center justify-between text-xs font-semibold text-ink"><span>第 {index + 1} 页</span><span className="text-muted">{page.panelIds.length} 格</span></span>
            <span className="mt-2 grid grid-cols-2 gap-1">
              {page.panelIds.map((panelId) => <span key={panelId} className="aspect-[4/3] rounded-sm bg-ink/10 p-1 text-xs text-muted line-clamp-2">{panelById.get(panelId)?.visualDescription || '空白画格'}</span>)}
            </span>
          </button>
        ))}
        {!pages.length && <p className="px-2 py-4 text-center text-xs text-muted">还没有页面</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border-default p-2 xl:flex-col xl:items-stretch">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 xl:w-full xl:flex-none">
          <label htmlFor="comic-new-page-template" className="shrink-0 text-xs font-medium text-muted">版式</label>
          <Select id="comic-new-page-template" className="min-w-0 text-xs" value={newPageTemplate} onChange={(event) => onTemplateChange(event.target.value as ComicTemplate)}>
            <option value="single">单格</option><option value="duo">双格</option><option value="trio">三格</option><option value="quad">四格</option>
          </Select>
        </div>
        <Button size="sm" variant="outline" onClick={onAdd} disabled={!canAdd} className="justify-start border-dashed text-xs xl:w-full">＋ 新增页</Button>
        {selectedIndex >= 0 && <div className="flex items-center gap-1 xl:justify-between">
          <Button size="sm" variant="outline" onClick={() => onMove(-1)} disabled={selectedIndex === 0} aria-label="页面前移" className="px-2 text-xs">↑</Button>
          <Button size="sm" variant="outline" onClick={() => onMove(1)} disabled={selectedIndex === pages.length - 1} aria-label="页面后移" className="px-2 text-xs">↓</Button>
          <Button size="sm" variant="danger-ghost" onClick={onRemove} aria-label="删除当前页" className="px-2 text-xs">删除</Button>
        </div>}
      </div>
    </aside>
  );
}
