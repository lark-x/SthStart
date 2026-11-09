'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { CalendarDays, Cake, Film, ChevronLeft, ChevronRight, ExternalLink, SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer, Toolbar } from '@/app/components/shared/page-layout';
import { SplitPanes } from '@/app/components/shared/split-panes';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { useCalendarEvents, useCalendarFacets } from './queries';
import type { CalendarEvent, CalendarFilter } from './api';
import { daysInMonth, leadingBlanks, shiftCalendarMonth, toDateKey } from './calendar-state';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

const subscribeCalendarClock = () => () => {};
const clientClockReady = () => true;
const serverClockReady = () => false;

export function CalendarView() {
  // The container may use UTC while the browser is already on the next local day.
  // Render the same loading state for SSR and hydration, then use the user's clock.
  const ready = useSyncExternalStore(subscribeCalendarClock, clientClockReady, serverClockReady);
  if (!ready) return <PageContainer><PageHeader compact title="角色日历" /><p role="status" className="py-8 text-muted">正在载入日历…</p></PageContainer>;
  return <LocalCalendarView />;
}

function LocalCalendarView() {
  const router = useRouter();
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string>(toDateKey(today.getFullYear(), today.getMonth() + 1, today.getDate()));
  const [picked, setPicked] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [work, setWork] = useState('');
  const [kind, setKind] = useState<'all' | 'birthday' | 'activity'>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const composingSearchRef = useRef(false);

  useEffect(() => {
    if (composingSearchRef.current) return;
    const timer = setTimeout(() => {
      if (!composingSearchRef.current) setQuery(searchInput);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const gridStart = useMemo(() => {
    const blanks = leadingBlanks(year, month);
    const start = new Date(year, month - 1, 1 - blanks);
    return toDateKey(start.getFullYear(), start.getMonth() + 1, start.getDate());
  }, [year, month]);
  const gridEnd = useMemo(() => {
    const blanks = leadingBlanks(year, month);
    const total = blanks + daysInMonth(year, month);
    const rows = Math.ceil(total / 7);
    const end = new Date(year, month - 1, rows * 7 - blanks);
    return toDateKey(end.getFullYear(), end.getMonth() + 1, end.getDate());
  }, [year, month]);

  const filter: CalendarFilter = {
    ...(query.trim() ? { q: query.trim() } : {}),
    ...(work ? { works: [work] } : {}),
    ...(favorite ? { favorite: true } : {}),
    ...(kind === 'all' ? {} : { kinds: [kind] }),
  };
  const { data, isLoading, error, refetch } = useCalendarEvents(gridStart, gridEnd, filter);
  const facets = useCalendarFacets();

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of data?.events || []) {
      const list = map.get(event.date) || [];
      list.push(event);
      map.set(event.date, list);
    }
    return map;
  }, [data]);

  const cells = useMemo(() => {
    const total = new Date(year, month, 0).getDate();
    const blanks = leadingBlanks(year, month);
    const items: { key: string; day?: number }[] = [];
    for (let index = 0; index < blanks; index += 1) {
      const date = new Date(year, month - 1, 1 - blanks + index);
      items.push({ key: toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate()) });
    }
    for (let day = 1; day <= total; day += 1) items.push({ key: toDateKey(year, month, day), day });
    while (items.length % 7 !== 0) {
      const offset = items.length - blanks - total;
      const date = new Date(year, month - 1, total + 1 + offset);
      items.push({ key: toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate()) });
    }
    return items;
  }, [year, month]);

  const todayKey = toDateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const dayEvents = byDate.get(selectedDate) || [];
  const birthdays = dayEvents.filter((event) => event.kind === 'birthday');
  const shiftMonth = (delta: number) => {
    const next = shiftCalendarMonth(year, month, delta, selectedDate);
    setYear(next.year);
    setMonth(next.month);
    setSelectedDate(next.selectedDate);
    setPicked([]);
  };
  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth() + 1);
    setSelectedDate(todayKey);
    setPicked([]);
  };
  const openPickerFor = (characterIds: string[]) => {
    const params = new URLSearchParams({ template: 'birthday', date: selectedDate, characters: characterIds.join(',') });
    router.push(`/apps/activities/new?${params.toString()}`);
  };

  return (
    <PageContainer className="space-y-4">
        <PageHeader compact
          title="角色日历"
        />

        <ResponsiveEditOverlay
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          title="日历筛选"
          description="搜索与事件类型常驻在日历上方；作品和收藏条件可在这里调整。"
          footer={<><Button variant="outline" onClick={() => { setWork(''); setFavorite(false); }}>重置</Button><Button variant="primary" onClick={() => setFiltersOpen(false)}>完成</Button></>}
        >
          <div className="space-y-4">
            <label className="block space-y-1.5 text-sm font-medium text-ink" htmlFor="calendar-work-filter">作品
              <select id="calendar-work-filter" disabled={facets.isLoading} className="h-11 w-full rounded-control border border-border-control bg-surface-raised px-3 text-base font-normal disabled:opacity-60" value={work} onChange={(event) => setWork(event.target.value)}>
                <option value="">全部作品</option>
                {(facets.data?.facets.works || []).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
              </select>
              {facets.isError && <span role="alert" className="block text-xs font-normal text-danger-fg">作品列表读取失败。{facets.error instanceof Error ? facets.error.message : '已有作品筛选不会被删除。'}</span>}
            </label>
            <label className="flex min-h-11 items-center gap-3 rounded-xl bg-surface-muted/50 px-3 text-sm text-ink">
              <input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} className="h-4 w-4 accent-accent" />
              仅显示收藏角色相关的事件
            </label>
          </div>
        </ResponsiveEditOverlay>

        {error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger-fg"><p>{error instanceof Error ? error.message : String(error)}</p><Button size="sm" variant="outline" onClick={() => { void refetch(); }}>重试读取日历</Button></div>}

        {/* 左月历与右当天详情各自滚动：右侧生日名单再长也不会把月历拉长（§4.4）。 */}
        <SplitPanes
          className="lg:grid-cols-[minmax(0,1fr)_360px]"
          from="lg"
          labels={{ left: '月历', right: '当天详情' }}
          left={
          <section className="tpl-panel overflow-hidden">
        <Toolbar className="border-b border-border-subtle px-3" aria-label="月历筛选">
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="上个月" onClick={() => shiftMonth(-1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <span className="min-w-28 text-center text-sm font-semibold text-ink" aria-live="polite">
              {year} 年 {month} 月
            </span>
            <Button size="sm" variant="ghost" aria-label="下个月" onClick={() => shiftMonth(1)}>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button size="sm" variant="ghost" onClick={goToday}>今天</Button>
          </div>
          <Input
            aria-label="搜索角色或活动"
            placeholder="搜索角色姓名或活动标题…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onCompositionStart={() => { composingSearchRef.current = true; }}
            onCompositionEnd={(event) => {
              composingSearchRef.current = false;
              setSearchInput(event.currentTarget.value);
              setQuery(event.currentTarget.value);
            }}
            className="w-full sm:ml-auto sm:w-64"
          />
          <div className="flex items-center gap-4 text-sm">
            {([['all', '全部'], ['birthday', '仅生日'], ['activity', '仅活动']] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setKind(value)} aria-pressed={kind === value} className={`border-b-2 py-1.5 text-sm transition-colors cursor-pointer ${kind === value ? 'border-accent font-semibold text-ink' : 'border-transparent text-muted hover:text-ink'}`}>{label}</button>
            ))}
          </div>
          <Button type="button" size="sm" variant="ghost" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}><SlidersHorizontal className="mr-1.5 h-4 w-4" />筛选{work || favorite ? ' · 已启用' : ''}</Button>
          {isLoading && <span className="text-sm text-muted">正在更新…</span>}
        </Toolbar>
        {(work || favorite) && <div className="px-3 py-2 flex flex-wrap items-center gap-2 text-xs text-muted" aria-label="当前筛选条件">
          {work && <span className="rounded-full bg-surface-muted px-2.5 py-1">作品：{work}</span>}
          {favorite && <span className="rounded-full bg-surface-muted px-2.5 py-1">仅收藏角色</span>}
          <button type="button" className="text-ink hover:underline" onClick={() => { setWork(''); setFavorite(false); }}>清除</button>
        </div>}

            <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2.5">
              <h2 className="text-sm font-semibold text-ink">{year} 年 {month} 月</h2>
              <span className="text-xs text-muted">{error ? '记录暂不可用' : `共 ${(data?.events || []).length} 项`}</span>
            </div>
            <div className="grid grid-cols-7 border-b border-border-subtle bg-surface-sunken/60 text-center text-xs font-semibold text-muted">
              {WEEKDAYS.map((label) => <div key={label} className="py-2">{label}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-px bg-border-subtle">
              {cells.map((cell) => {
                const events = byDate.get(cell.key) || [];
                const inMonth = cell.day !== undefined;
                const isToday = cell.key === todayKey;
                const isSelected = cell.key === selectedDate;
                return (
                  <button
                    key={cell.key}
                    type="button"
                    disabled={!inMonth}
                    onClick={() => { setSelectedDate(cell.key); setPicked([]); }}
                    aria-label={inMonth ? `${cell.key}，${events.length} 项事件` : undefined}
                    aria-pressed={isSelected}
                    className={`min-h-20 p-1.5 text-left align-top text-sm transition-colors ${isSelected ? 'bg-accent/5 ring-1 ring-inset ring-accent/30' : inMonth ? 'bg-surface hover:bg-surface-hover' : 'bg-surface-sunken/35 opacity-45'}`}
                  >
                    <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-xs font-semibold ${isToday ? 'text-accent-dark' : 'text-ink'}`}>{cell.day}</span>
                    <span className="mt-1 flex flex-col gap-1">
                      {events.slice(0, 3).map((event) => (
                        <span key={event.id} className="flex min-w-0 items-center gap-1 truncate py-0.5 text-xs text-ink">
                          {event.kind === 'birthday' ? <Cake className="size-3 shrink-0 text-muted" /> : <Film className="size-3 shrink-0 text-muted" />}
                          <span className="truncate">{event.title}</span>
                        </span>
                      ))}
                      {events.length > 3 && <span className="px-1 text-muted">还有 {events.length - 3} 项</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
          }
          right={
          <section className="tpl-panel space-y-4 p-4">
            <div>
              <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink"><CalendarDays className="h-4 w-4 text-muted" />当天安排 <span className="font-normal text-muted">{selectedDate}</span></h2>
            </div>
            {error ? <p className="text-sm text-muted">暂时无法确认当天安排，请重试读取日历。</p> : !isLoading && !dayEvents.length && <p className="text-sm text-muted">这一天没有生日或活动。</p>}
            {!!birthdays.length && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-ink">寿星 <span className="font-normal text-muted">{birthdays.length} 位</span></p>
                <ul className="divide-y divide-border-subtle border-y border-border-subtle">
                  {birthdays.map((event) => (
                    <li key={event.id} className="flex items-center gap-2.5 py-3 text-sm">
                      <input
                        type="checkbox"
                        aria-label={`选择${event.characterName || event.title}`}
                        checked={picked.includes(String(event.characterId))}
                        onChange={(event_) => {
                          const id = String(event.characterId);
                          setPicked(event_.target.checked ? [...picked, id] : picked.filter((value) => value !== id));
                        }}
                      />
                      {event.avatarUrl
                        ? <Image src={event.avatarUrl} alt="" width={24} height={24} unoptimized className="h-6 w-6 rounded-md object-cover" />
                        : <Cake className="h-4 w-4 text-muted" />}
                      <span className="min-w-0 flex-1 truncate">{event.characterName}{event.work ? <span className="text-muted"> · {event.work}</span> : null}</span>
                      <Button size="sm" variant="ghost" onClick={() => openPickerFor([String(event.characterId)])}>创建活动</Button>
                    </li>
                  ))}
                </ul>
                <Button size="sm" variant="primary" disabled={!picked.length} onClick={() => openPickerFor(picked)}>
                  为选中的 {picked.length} 位寿星合办生日活动
                </Button>
              </div>
            )}
            {dayEvents.some((event) => event.kind === 'activity') && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-ink">已排期活动</p>
                <ul className="divide-y divide-border-subtle border-y border-border-subtle">
                  {dayEvents.filter((event) => event.kind === 'activity').map((event) => (
                    <li key={event.id} className="py-3 text-sm">
                      <span className="flex items-center gap-2 font-medium text-ink"><Film className="h-4 w-4 text-muted" />{event.title}</span>
                      <div className="mt-1.5 flex items-center justify-between text-xs text-muted">
                        <span>参与角色 {event.participantCount ?? 0} 位</span>
                        <Link className="inline-flex items-center gap-1 text-ink hover:text-accent" href={`/apps/activities/${event.activityId}`}>打开活动<ExternalLink className="h-3 w-3" /></Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-muted">未排期的活动不会出现在日历上；2 月 29 日的生日只在闰年显示。</p>
          </section>
          }
        />
    </PageContainer>
  );
}
