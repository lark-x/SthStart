'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { CalendarDays, Cake, Film, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer, Toolbar } from '@/app/components/shared/page-layout';
import { SplitPanes } from '@/app/components/shared/split-panes';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { useCalendarEvents, useCalendarFacets } from './queries';
import type { CalendarEvent, CalendarFilter } from './api';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function pad(value: number) { return String(value).padStart(2, '0'); }
function toDateKey(year: number, month: number, day: number) { return `${year}-${pad(month)}-${pad(day)}`; }
function daysInMonth(year: number, month: number) { return new Date(year, month, 0).getDate(); }
/** 周一作为每周第一天。 */
function leadingBlanks(year: number, month: number) { return (new Date(year, month - 1, 1).getDay() + 6) % 7; }

export function CalendarView() {
  const router = useRouter();
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string>(toDateKey(today.getFullYear(), today.getMonth() + 1, today.getDate()));
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [work, setWork] = useState('');
  const [kind, setKind] = useState<'all' | 'birthday' | 'activity'>('all');

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
  const { data, isLoading, error } = useCalendarEvents(gridStart, gridEnd, filter);
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
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
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
    <PageContainer className="space-y-4 py-6">
        <PageHeader
          title="角色日历"
          description="按月份查看角色生日与已排期的活动，从生日直接为一位或多位寿星创建活动。"
          actions={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" aria-label="上个月" onClick={() => shiftMonth(-1)}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <span className="min-w-24 text-center text-sm font-semibold text-ink" aria-live="polite">
                {year} 年 {month} 月
              </span>
              <Button size="sm" variant="outline" aria-label="下个月" onClick={() => shiftMonth(1)}>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button size="sm" variant="outline" onClick={goToday}>回到今天</Button>
            </div>
          }
        />

        {/* 第二层工具栏：搜索与筛选（§8.7）。 */}
        <Toolbar>
          <Input aria-label="搜索角色或活动" placeholder="搜索角色姓名或活动标题…" value={query} onChange={(event) => setQuery(event.target.value)} className="w-full sm:w-64" />
          <select aria-label="筛选作品" className="rounded border border-border-control bg-surface px-2 py-2 text-sm" value={work} onChange={(event) => setWork(event.target.value)}>
            <option value="">全部作品</option>
            {(facets.data?.facets.works || []).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
          <div className="flex overflow-hidden rounded border border-ink/15 text-sm">
            {([['all', '全部'], ['birthday', '仅生日'], ['activity', '仅活动']] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setKind(value)} className={`px-3 py-2 ${kind === value ? 'bg-accent text-white' : 'bg-surface'}`}>{label}</button>
            ))}
          </div>
          <label className="flex items-center gap-2 px-2 text-sm">
            <input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} />仅收藏角色
          </label>
          {isLoading && <span className="text-sm text-muted">正在更新…</span>}
        </Toolbar>

        {error && <p role="alert" className="text-sm text-accent-dark">{error instanceof Error ? error.message : String(error)}</p>}

        {/* 左月历与右当天详情各自滚动：右侧生日名单再长也不会把月历拉长（§4.4）。 */}
        <SplitPanes
          className="lg:grid-cols-[minmax(0,1fr)_360px]"
          from="lg"
          labels={{ left: '月历', right: '当天详情' }}
          left={
          <section className="tpl-panel p-3">
            <div className="mb-3 flex items-center justify-end">
              <span className="text-sm text-muted">本月共 {(data?.events || []).length} 项</span>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-sm text-muted">
              {WEEKDAYS.map((label) => <div key={label} className="py-1">{label}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
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
                    className={`min-h-20 rounded border p-1.5 text-left align-top text-sm transition-colors ${isSelected ? 'border-accent bg-accent/5' : 'border-border-subtle'} ${inMonth ? 'bg-surface' : 'bg-surface-muted/40 opacity-40'}`}
                  >
                    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${isToday ? 'bg-accent text-white' : ''}`}>{cell.day}</span>
                    <span className="mt-1 flex flex-col gap-0.5">
                      {events.slice(0, 3).map((event) => (
                        <span key={event.id} className={`block truncate rounded px-1 ${event.kind === 'birthday' ? 'bg-rose-50 text-rose-700' : 'bg-sky-50 text-sky-800'}`}>
                          {event.kind === 'birthday' ? '🎂 ' : '🎬 '}{event.title}
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
          <section className="space-y-3 rounded-lg border border-border-subtle bg-surface p-3">
            <h2 className="flex items-center gap-2 text-base font-semibold"><CalendarDays className="h-4 w-4 text-accent" />{selectedDate} 当天</h2>
            {!dayEvents.length && <p className="text-sm text-muted">这一天没有生日或活动。</p>}
            {!!birthdays.length && (
              <div className="space-y-2">
                <p className="text-sm font-medium">寿星（{birthdays.length}）</p>
                <ul className="space-y-1">
                  {birthdays.map((event) => (
                    <li key={event.id} className="flex items-center gap-2 rounded border border-border-subtle p-2 text-sm">
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
                        ? <Image src={event.avatarUrl} alt="" width={24} height={24} unoptimized className="h-6 w-6 rounded object-cover" />
                        : <Cake className="h-4 w-4 text-rose-500" />}
                      <span className="min-w-0 flex-1 truncate">{event.characterName}{event.work ? <span className="text-muted"> · {event.work}</span> : null}</span>
                      <Button size="sm" variant="ghost" onClick={() => openPickerFor([String(event.characterId)])}>为 TA 创建</Button>
                    </li>
                  ))}
                </ul>
                <Button size="sm" disabled={!picked.length} onClick={() => openPickerFor(picked)}>
                  为选中的 {picked.length} 位寿星合办生日活动
                </Button>
              </div>
            )}
            {dayEvents.some((event) => event.kind === 'activity') && (
              <div className="space-y-2">
                <p className="text-sm font-medium">活动</p>
                <ul className="space-y-1">
                  {dayEvents.filter((event) => event.kind === 'activity').map((event) => (
                    <li key={event.id} className="rounded border border-border-subtle p-2 text-sm">
                      <span className="flex items-center gap-2"><Film className="h-4 w-4 text-sky-600" />{event.title}</span>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted">
                        <span>参与角色 {event.participantCount ?? 0} 位</span>
                        <Link className="inline-flex items-center gap-1 text-accent" href={`/apps/activities/${event.activityId}`}>打开活动<ExternalLink className="h-3 w-3" /></Link>
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
