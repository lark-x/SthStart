'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  CalendarDays,
  Cake,
  Film,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Plus,
  SlidersHorizontal,
} from 'lucide-react';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer, Toolbar } from '@/app/components/shared/page-layout';
import { SplitPanes } from '@/app/components/shared/split-panes';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { ResponsiveEditOverlay } from '@/app/components/ui/responsive-edit-overlay';
import { useCalendarEvents, useCalendarFacets } from './queries';
import type { CalendarEvent, CalendarFilter } from './api';
import {
  daysInMonth,
  formatCalendarDate,
  leadingBlanks,
  shiftCalendarMonth,
  toDateKey,
} from './calendar-state';
import './calendar.css';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const KINDS = [
  ['all', '全部'],
  ['birthday', '仅生日'],
  ['activity', '仅活动'],
] as const;

function EventGlyph({ kind, className = 'size-3' }: { kind: CalendarEvent['kind']; className?: string }) {
  return kind === 'birthday'
    ? <Cake className={`${className} shrink-0`} aria-hidden="true" />
    : <Film className={`${className} shrink-0`} aria-hidden="true" />;
}

const subscribeCalendarClock = () => () => {};
const clientClockReady = () => true;
const serverClockReady = () => false;

export function CalendarView() {
  // The container may use UTC while the browser is already on the next local day.
  // Render the same loading state for SSR and hydration, then use the user's clock.
  const ready = useSyncExternalStore(subscribeCalendarClock, clientClockReady, serverClockReady);
  if (!ready) {
    return (
      <PageContainer className="space-y-4">
        <PageHeader compact title="创作日历" />
        <p role="status" className="py-8 text-muted">正在载入日历…</p>
      </PageContainer>
    );
  }
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

  const filter: CalendarFilter = useMemo(() => ({
    ...(query.trim() ? { q: query.trim() } : {}),
    ...(work ? { works: [work] } : {}),
    ...(favorite ? { favorite: true } : {}),
    ...(kind === 'all' ? {} : { kinds: [kind] }),
  }), [favorite, kind, query, work]);
  const { data, isLoading, isFetching, error, refetch } = useCalendarEvents(gridStart, gridEnd, filter);
  /* 月份统计覆盖整月，而不是只覆盖补齐前后的可见格。范围请求会与网格查询一起缓存，
   * 因此不必为摘要另做一次无谓的往返。 */
  const monthStart = toDateKey(year, month, 1);
  const monthEnd = toDateKey(year, month, daysInMonth(year, month));
  const monthQuery = useCalendarEvents(monthStart, monthEnd, filter);
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
  const activities = dayEvents.filter((event) => event.kind === 'activity');
  const monthEvents = useMemo(() => monthQuery.data?.events ?? [], [monthQuery.data]);
  const monthBirthdayCount = monthEvents.filter((event) => event.kind === 'birthday').length;
  const monthActivityCount = monthEvents.filter((event) => event.kind === 'activity').length;
  const upcomingInMonth = useMemo(() => {
    const seen = new Set<string>();
    return monthEvents
      .filter((event) => event.date > selectedDate)
      .filter((event) => {
        const key = `${event.date}:${event.kind}:${event.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  }, [monthEvents, selectedDate]);
  const activeFilterCount = Number(Boolean(work)) + Number(favorite);
  const weeks = Math.max(1, Math.ceil(cells.length / 7));
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
  const openPickerFor = (characterIds: string[], date = selectedDate) => {
    const params = new URLSearchParams({ template: 'birthday', date, characters: characterIds.join(',') });
    router.push(`/apps/activities/new?${params.toString()}`);
  };
  const openBlankFor = (date = selectedDate) => {
    const params = new URLSearchParams({ template: 'blank', date });
    router.push(`/apps/activities/new?${params.toString()}`);
  };
  const selectDay = (date: string) => {
    setSelectedDate(date);
    setPicked([]);
  };

  return (
    <PageContainer className="space-y-4">
      <PageHeader compact title="创作日历" />

      <ResponsiveEditOverlay
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="日历筛选"
        description="搜索与事件类型常驻在日历上方；作品和收藏条件可在这里调整。"
        footer={<><Button variant="outline" onClick={() => { setWork(''); setFavorite(false); }}>重置</Button><Button variant="primary" onClick={() => setFiltersOpen(false)}>完成</Button></>}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-ink">作品</span>
            <Select
              aria-label="作品"
              disabled={facets.isLoading}
              value={work}
              onChange={(event) => setWork(event.target.value)}
            >
              <option value="">全部作品</option>
              {(facets.data?.facets.works || []).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </Select>
            {facets.isError && <span role="alert" className="block text-xs font-normal text-danger-fg">作品列表读取失败。{facets.error instanceof Error ? facets.error.message : '已有作品筛选不会被删除。'}</span>}
          </div>
          <Checkbox
            label="仅显示收藏角色相关的事件"
            checked={favorite}
            onChange={(event) => setFavorite(event.target.checked)}
          />
        </div>
      </ResponsiveEditOverlay>

      {error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger-fg"><p>{error instanceof Error ? error.message : String(error)}</p><Button size="sm" variant="outline" onClick={() => { void refetch(); }}>重试读取日历</Button></div>}

      {/* 左月历与右当天详情各自滚动：右侧名单再长也不会把月历拉长（§4.4）。 */}
      <SplitPanes
        className="lg:grid-cols-[minmax(0,1fr)_360px]"
        from="lg"
        labels={{ left: '月历', right: '当天详情' }}
        left={
          <section className="calendar-panel tpl-panel">
            <Toolbar className="calendar-toolbar border-b border-border-subtle" aria-label="月历筛选">
              <div className="calendar-month-nav">
                <Button size="sm" variant="ghost" aria-label="上个月" onClick={() => shiftMonth(-1)}>
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <h2 className="calendar-month-label" aria-live="polite">{year} 年 {month} 月</h2>
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
                className="calendar-search"
              />

              <div className="calendar-kind-switch" role="group" aria-label="事件类型">
                {KINDS.map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={kind === value ? 'secondary' : 'ghost'}
                    aria-pressed={kind === value}
                    onClick={() => setKind(value)}
                    className="ui-choice"
                  >
                    {label}
                  </Button>
                ))}
              </div>

              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen(true)}
                className="calendar-filter-trigger"
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                筛选{activeFilterCount ? ` · ${activeFilterCount}` : ''}
              </Button>
            </Toolbar>

            {(work || favorite) && (
              <div className="calendar-active-filters" aria-label="当前筛选条件">
                {work && <span>作品：{work}</span>}
                {favorite && <span>仅收藏角色</span>}
                <Button type="button" size="sm" variant="ghost" onClick={() => { setWork(''); setFavorite(false); }}>清除</Button>
              </div>
            )}

            <div className="calendar-summary">
              <div className="calendar-legend" aria-label="图例">
                <span><i data-kind="birthday" aria-hidden="true" />生日 {monthBirthdayCount}</span>
                <span><i data-kind="activity" aria-hidden="true" />活动 {monthActivityCount}</span>
              </div>
              <span className="calendar-summary-count" role="status">
                {isFetching || monthQuery.isFetching ? '正在更新…' : `本月 ${monthEvents.length} 项`}
              </span>
            </div>

            <div className="calendar-weekdays" aria-hidden="true">
              {WEEKDAYS.map((label) => <span key={label}>{label}</span>)}
            </div>

            <div
              className="calendar-grid"
              style={{ '--calendar-weeks': weeks } as React.CSSProperties}
            >
              {cells.map((cell) => {
                const events = byDate.get(cell.key) || [];
                const inMonth = cell.day !== undefined;
                const isToday = cell.key === todayKey;
                const isSelected = cell.key === selectedDate;
                return (
                  <button
                    key={cell.key}
                    type="button"
                    className={`calendar-day ui-choice ${inMonth ? 'is-in-month' : 'is-outside'}`}
                    disabled={!inMonth}
                    onClick={() => selectDay(cell.key)}
                    aria-label={inMonth ? `${cell.key}，${events.length} 项事件` : undefined}
                    aria-pressed={isSelected}
                    data-today={isToday || undefined}
                  >
                    <span className="calendar-day-date">{cell.day}</span>
                    <span className="calendar-day-events">
                      {events.slice(0, 3).map((event) => (
                        <span key={event.id} data-kind={event.kind} className="calendar-day-event">
                          <EventGlyph kind={event.kind} />
                          <span>{event.title}</span>
                        </span>
                      ))}
                      {events.length > 3 && <span className="calendar-day-overflow">还有 {events.length - 3} 项</span>}
                    </span>
                    <span className="calendar-day-dots" aria-hidden="true">
                      {events.slice(0, 4).map((event) => <i key={event.id} data-kind={event.kind} />)}
                      {events.length > 4 && <b>+{events.length - 4}</b>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        }
        right={
          <section className="calendar-day-panel tpl-panel" aria-label="当天详情">
            <header className="calendar-day-head">
              <div>
                <p className="calendar-day-kicker"><CalendarDays className="h-4 w-4" aria-hidden="true" />当天安排</p>
                <h2>{formatCalendarDate(selectedDate)}</h2>
                <p className="calendar-day-raw">{selectedDate}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => openBlankFor()}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                新建活动
              </Button>
            </header>

            {error ? (
              <p className="calendar-day-empty">暂时无法确认当天安排，请重试读取日历。</p>
            ) : !isLoading && !dayEvents.length ? (
              <EmptyState
                icon={CalendarDays}
                title="这一天没有生日或活动。"
                description="可以从右上角新建空白活动，或从其他日期带入寿星。"
                className="calendar-day-empty"
              />
            ) : null}

            {!!birthdays.length && (
              <div className="calendar-day-group">
                <div className="calendar-group-title">
                  <span>寿星名单</span>
                  <span className="calendar-group-count">寿星 {birthdays.length} 位</span>
                </div>
                <ul className="calendar-birthday-list">
                  {birthdays.map((event) => (
                    <li key={event.id}>
                      <Checkbox
                        aria-label={`选择${event.characterName || event.title}`}
                        checked={picked.includes(String(event.characterId))}
                        onChange={(event_) => {
                          const id = String(event.characterId);
                          setPicked(event_.target.checked ? [...picked, id] : picked.filter((value) => value !== id));
                        }}
                      />
                      {event.avatarUrl
                        ? <Image src={event.avatarUrl} alt="" width={28} height={28} unoptimized className="calendar-avatar" />
                        : <span className="calendar-avatar calendar-avatar-fallback"><Cake className="h-4 w-4" aria-hidden="true" /></span>}
                      <span className="calendar-birthday-name">
                        {event.characterName}
                        {event.work ? <span className="calendar-work"> · {event.work}</span> : null}
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => openPickerFor([String(event.characterId)])}>创建活动</Button>
                    </li>
                  ))}
                </ul>
                <Button size="sm" variant="primary" className="w-full" disabled={!picked.length} onClick={() => openPickerFor(picked)}>
                  {picked.length ? `为选中的 ${picked.length} 位寿星合办生日活动` : '选择寿星后合办生日活动'}
                </Button>
              </div>
            )}

            {!!activities.length && (
              <div className="calendar-day-group">
                <div className="calendar-group-title">
                  <span>已排期活动</span>
                  <span className="calendar-group-count">{activities.length} 项</span>
                </div>
                <ul className="calendar-activity-list">
                  {activities.map((event) => (
                    <li key={event.id}>
                      <span className="calendar-activity-icon"><Film className="h-4 w-4" aria-hidden="true" /></span>
                      <div className="calendar-activity-copy">
                        <p>{event.title}</p>
                        <span>参与角色 {event.participantCount ?? 0} 位</span>
                      </div>
                      <Link className="calendar-activity-link" href={`/apps/activities/${event.activityId}`}>
                        打开活动<ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!!upcomingInMonth.length && (
              <div className="calendar-upcoming">
                <div className="calendar-group-title">
                  <span>本月后续</span>
                  <span className="calendar-group-count">{formatCalendarDate(selectedDate, { short: true })} 起</span>
                </div>
                <ul>
                  {upcomingInMonth.map((event) => (
                    <li key={`${event.id}:upcoming`}>
                      <button type="button" onClick={() => selectDay(event.date)}>
                        <span className="calendar-upcoming-date">{event.date.slice(8, 10)}<small>日</small></span>
                        <span className="calendar-upcoming-copy">
                          <span>{event.title}</span>
                          <small>{event.kind === 'birthday' ? '生日' : `活动${event.participantCount ? ` · ${event.participantCount} 位参与` : ''}`}</small>
                        </span>
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="calendar-footnote">未排期的活动不会出现在日历上；2 月 29 日的生日只在闰年显示。</p>
          </section>
        }
      />
    </PageContainer>
  );
}
