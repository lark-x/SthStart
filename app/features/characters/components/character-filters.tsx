'use client';

import { type ReactNode, useId, useRef, useState } from 'react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import type { CharacterBrowseQuery, CharacterBrowseResult } from '@sthstart/contracts';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { AnchoredPopover } from '@/app/components/ui/anchored-popover';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { cn } from '@/app/lib/cn';
import { activeCharacterFilterChips, type CharacterFilterChip } from '../model/filter-chips';
import {
  buildCharacterFilterControls,
  characterFilterSelectPatch,
  type CharacterFilterMultiControl,
  type CharacterFilterSelectControl,
} from '../model/filter-controls';

// 过渡兼容入口：外部调用方迁移到 hooks/use-character-browser 与 components/character-pagination 前继续可用。
export { useCharacterBrowser } from '../hooks/use-character-browser';
export { hasCharacterFilters } from '../model/filter-chips';
export { CharacterPagination } from './character-pagination';

export {
  CHARACTER_DEFAULT_PAGE_SIZE,
  CHARACTER_FILTER_URL_PARAM,
  CHARACTER_PAGE_SIZE_OPTIONS,
  normalizeCharacterFilter,
  parseCharacterFilterParam,
} from '../filter-url';

function MultiFilter({ control, onChange }: { control: CharacterFilterMultiControl; onChange: (values: string[]) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const needle = query.trim().toLowerCase();
  const matches = needle ? control.options.filter((item) => `${item.label} ${item.search || ''}`.toLowerCase().includes(needle)) : control.options;
  const { label, options, selected } = control;

  return (
    <AnchoredPopover title={`按${label}筛选`} open={open} onOpenChange={setOpen} side="bottom" align="start" className="w-64"
      trigger={<Button size="sm" variant={selected.length ? 'secondary' : 'outline'} className="h-9 min-h-0 gap-1.5 px-2.5 text-sm">
        {label}{selected.length ? ` (${selected.length})` : ''}<ChevronDown size={14} aria-hidden="true" />
      </Button>}>
        <Input
          data-popover-focus="true"
          aria-label={`搜索${label}`}
          placeholder={`搜索${label}…`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 text-base sm:text-sm"
        />
        <div className="mt-2 max-h-48 space-y-0.5 overflow-auto">
          {matches.map((item) => (
            <div
              key={item.value}
              className="flex min-h-9 items-center rounded-control px-2 transition-colors hover:bg-surface-hover focus-within:bg-surface-hover [&_.ui-mantine-checkbox-root]:w-full [&_.ui-mantine-checkbox-root]:items-center [&_.ui-mantine-checkbox-input]:mt-0 [&_.ui-mantine-checkbox-label]:block [&_.ui-mantine-checkbox-label]:truncate [&_.ui-mantine-checkbox-label]:font-normal"
            >
              <Checkbox
                label={item.label}
                checked={selected.includes(item.value)}
                onChange={(event) => onChange(event.target.checked ? [...selected, item.value] : selected.filter((value) => value !== item.value))}
              />
            </div>
          ))}
          {!options.length && <p className="px-2 py-1 text-xs text-muted">暂无可选项</p>}
          {!!options.length && !matches.length && <p className="px-2 py-1 text-xs text-muted">没有匹配“{query.trim()}”的选项</p>}
        </div>
    </AnchoredPopover>
  );
}

/** Shared renderer for the common controls in the desktop quick row and the responsive panel. */
function CommonFilterControls({ model, onChange, className }: {
  model: ReturnType<typeof buildCharacterFilterControls>;
  onChange: (patch: CharacterBrowseQuery) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      {model.multi.map((control) => (
        <MultiFilter
          key={control.key}
          control={control}
          onChange={(values) => onChange({ [control.key]: values })}
        />
      ))}
      <span
        data-favorite-pill={model.favorite ? 'on' : 'off'}
        className={cn(
          'inline-flex min-h-[var(--control-h-touch)] items-center justify-self-start rounded-full border px-3 transition-colors duration-[var(--motion-fast)] sm:min-h-[var(--control-h-sm)]',
          '[&_.ui-mantine-checkbox-root]:items-center [&_.ui-mantine-checkbox-label]:whitespace-nowrap [&_.ui-mantine-checkbox-label]:font-medium',
          model.favorite
            ? 'border-[var(--selection-border)] bg-[var(--selection-bg)]'
            : 'border-border-default bg-surface hover:bg-surface-hover',
        )}
      >
        <Checkbox
          label="仅收藏"
          checked={model.favorite}
          onChange={(event) => onChange({ favorite: event.target.checked })}
        />
      </span>
    </div>
  );
}

export function CharacterFilters({
  filter,
  onChange,
  facets,
  onReset,
  actions,
  leftSlot,
}: {
  actions?: ReactNode;
  leftSlot?: ReactNode;
  filter: CharacterBrowseQuery;
  onChange: (patch: CharacterBrowseQuery) => void;
  facets?: CharacterBrowseResult['facets'];
  onReset: () => void;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const filterCountId = useId();
  const [searchInput, setSearchInput] = useState(filter.q || '');
  const [lastFilterQuery, setLastFilterQuery] = useState(filter.q || '');
  const composingRef = useRef(false);
  const filterQuery = filter.q || '';
  if (filterQuery !== lastFilterQuery) {
    setLastFilterQuery(filterQuery);
    setSearchInput(filterQuery);
  }
  const model = buildCharacterFilterControls(filter, facets);
  const select = (control: CharacterFilterSelectControl) => (
    <label key={control.key} className="flex min-w-0 flex-col gap-1 text-sm font-medium text-ink">
      <span>{control.label}</span>
      <Select
        value={control.value}
        onChange={(event) => onChange(characterFilterSelectPatch(control.key, event.target.value))}
      >
        <option value="">全部</option>
        {control.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
    </label>
  );
  const chips = activeCharacterFilterChips(filter);
  const clearChip = (chip: CharacterFilterChip) => onChange(chip.clear());
  const allWorks = facets?.works || [];
  const parentWorks = allWorks.filter((w) => w.workNature !== 'derivative');
  const selectedWorks = filter.works || [];
  const selectedWork = selectedWorks.length === 1 ? allWorks.find(work => work.name === selectedWorks[0]) : undefined;
  const selectedParentWork = filter.parentWork || selectedWork?.parentWork || (selectedWork?.workNature !== 'derivative' ? selectedWork?.name : '') || '';
  const derivativeSubWorks = selectedParentWork
    ? allWorks.filter(
        (w) => w.workNature === 'derivative' && (w.parentWork || '').toLowerCase() === selectedParentWork.toLowerCase(),
      )
    : [];

  const worksControl = model.multi.find((item) => item.key === 'works');
  const originTabs = [
    { label: '全部', value: undefined as CharacterBrowseQuery['originType'] },
    { label: '原作', value: 'ip' as const },
    { label: '同人', value: 'derivative' as const },
    { label: '原创', value: 'original' as const },
  ] as const;

  return (
    <section
      aria-label="角色筛选控件"
      className="space-y-2.5 rounded-panel bg-surface p-3 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-9 min-h-0 w-full text-sm sm:w-40 xl:w-52"
          aria-label="搜索角色"
          placeholder="搜索姓名、作品或标签…"
          value={searchInput}
          onChange={(event) => {
            const value = event.target.value;
            setSearchInput(value);
            if (composingRef.current) return;
            onChange({ q: value });
          }}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            const value = event.currentTarget.value;
            setSearchInput(value);
            onChange({ q: value });
          }}
        />

        <div
          role="group"
          aria-label="角色类别"
          className="inline-flex h-9 shrink-0 items-center rounded-control border border-hairline bg-surface-sunken p-0.5"
        >
          {originTabs.map((item) => {
            const active = (filter.originType ?? undefined) === item.value;
            return (
              <button
                key={item.label}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ originType: item.value })}
                className={cn(
                  'h-7.5 rounded-[6px] px-2.5 text-xs font-medium transition-colors',
                  active
                    ? 'bg-surface-raised text-ink shadow-xs'
                    : 'text-muted hover:text-ink',
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {worksControl && (
          <MultiFilter
            control={worksControl}
            onChange={(values) => onChange({ works: values })}
          />
        )}

        <Select
          aria-label="快捷排序"
          value={filter.sort || 'updated'}
          onChange={(event) => onChange(characterFilterSelectPatch('sort', event.target.value))}
          className="h-9 min-h-0 w-auto text-sm"
        >
          <option value="updated">最近更新</option>
          <option value="name">按名称</option>
        </Select>

        <Button
          size="sm"
          variant={chips.length ? 'secondary' : 'outline'}
          aria-label="筛选与排序"
          aria-describedby={chips.length ? filterCountId : undefined}
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen(true)}
          className="h-9 min-h-0 gap-1.5 px-2.5 text-sm"
        >
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          <span>更多筛选</span>
          {!!chips.length && <span aria-hidden="true" className="tabular-nums">({chips.length})</span>}
        </Button>
        <span id={filterCountId} className="sr-only">已启用 {chips.length} 个筛选条件</span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {leftSlot}
          {actions}
        </div>
      </div>

      {derivativeSubWorks.length > 0 && (
        <div role="group" aria-label="同人衍生作品" className="flex flex-wrap items-center gap-1.5 border-t border-border-subtle/60 pt-2">
          <span className="text-xs text-muted">同人衍生：</span>
          <Button
            type="button"
            size="sm"
            variant={filter.parentWork === selectedParentWork ? 'secondary' : 'ghost'}
            aria-pressed={filter.parentWork === selectedParentWork}
            onClick={() =>
              onChange(
                filter.parentWork === selectedParentWork
                  ? { parentWork: undefined }
                  : { parentWork: selectedParentWork, works: undefined },
              )
            }
            className="h-7 min-h-0 rounded-full border border-hairline px-2.5 text-xs"
          >
            全部《{selectedParentWork}》同人
          </Button>
          {derivativeSubWorks.map((sub) => {
            const active = selectedWorks.includes(sub.name);
            return (
              <Button
                key={sub.name}
                type="button"
                size="sm"
                variant={active ? 'secondary' : 'ghost'}
                aria-pressed={active}
                onClick={() => onChange({ works: [sub.name], parentWork: undefined })}
                className="h-7 min-h-0 rounded-full border border-hairline px-2.5 text-xs"
              >
                {sub.name}
              </Button>
            );
          })}
        </div>
      )}

      <ResponsiveEditOverlay
        open={panelOpen}
        onOpenChange={setPanelOpen}
        title="角色筛选与排序"
        description="按作品、标签、分组、仅看收藏与母原作组合筛选；更改会立即更新列表。"
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="ghost" onClick={onReset} className="justify-center">
              重置筛选
            </Button>
            <Button type="button" variant="primary" onClick={() => setPanelOpen(false)} className="justify-center">
              完成
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <fieldset className="min-w-0 space-y-3">
            <legend className="text-sm font-semibold text-ink">作品、标签与分组</legend>
            <CommonFilterControls model={model} onChange={onChange} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" />
          </fieldset>

          <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-ink">
            <span>按母原作浏览同人</span>
            <Select
              aria-label="母原作与衍生作品"
              value={filter.parentWork || ''}
              onChange={(event) => onChange({ parentWork: event.target.value || undefined, works: undefined })}
            >
              <option value="">全部母原作</option>
              {parentWorks.map((work) => <option key={work.name} value={work.name}>{work.name}</option>)}
            </Select>
          </label>

          {model.sections.map((section) => (
            <fieldset key={section.id} className="min-w-0 space-y-3 border-t border-border-subtle pt-4">
              <legend className="px-1 text-sm font-semibold text-ink">{section.title}</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {section.selects.map(select)}
              </div>
            </fieldset>
          ))}
        </div>
      </ResponsiveEditOverlay>

      {!panelOpen && !!chips.length && (
        <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-border-subtle/50 pt-2">
          {chips.map((chip) => (
            <Button
              type="button"
              key={chip.key}
              size="sm"
              variant="ghost"
              aria-label={`移除筛选：${chip.label}`}
              className="h-7 min-h-0 gap-1 border border-border-subtle bg-surface-sunken px-2 text-xs text-ink hover:border-accent/40"
              onClick={() => clearChip(chip)}
            >
              <span aria-hidden="true">{chip.label}</span>
              <X className="size-3 text-muted" aria-hidden="true" />
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onReset}
            className="ml-auto h-7 min-h-0 px-2 text-xs text-accent"
          >
            清空筛选
          </Button>
        </div>
      )}
    </section>
  );
}
