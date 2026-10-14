'use client';

import Link from 'next/link';
import { Cake, CalendarDays, ArrowRight } from 'lucide-react';
import { useCalendarEvents } from '../features/calendar/queries';
import { Skeleton } from './ui/skeleton';

function isoDay(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function formatDay(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
}

/** 工作台辅区：未来一段时间的生日与活动安排，数据来自现有日历接口。 */
export function UpcomingSchedule({ days = 45, limit = 5 }: { days?: number; limit?: number }) {
  const { data, isLoading, isError, refetch } = useCalendarEvents(isoDay(0), isoDay(days), { kinds: ['birthday', 'activity'] });

  const events = (data?.events ?? [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);

  /* 骨架与真实日程行同构，保证载入完成时不出现整块高度跳变。 */
  const skeletonRows = (
    <ul className="space-y-2" aria-hidden="true">
      {Array.from({ length: limit }, (_, index) => (
        <li key={index} className="flex items-start gap-3 rounded-xl border border-border-subtle/70 bg-surface-sunken/35 px-3.5 py-2.5">
          <Skeleton className="mt-0.5 h-8 w-8 rounded-lg flex-none" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-3/4" data-visual-dynamic="true" />
            <Skeleton className="h-3 w-1/3" data-visual-dynamic="true" />
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="tpl-panel p-4 sm:p-5" aria-labelledby="upcoming-title">
      <div className="mb-3.5 flex items-baseline justify-between gap-3 border-b border-border-subtle pb-3">
        <div>
          <h2 id="upcoming-title" className="tpl-section-title">近期日程</h2>
          <p className="mt-0.5 text-xs text-muted">未来 {days} 天角色生辰与活动排期</p>
        </div>
        <Link href="/apps/calendar" className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-accent">
          <span>打开日历</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      {isLoading ? (
        <>
          <p role="status" className="sr-only">正在读取…</p>
          {skeletonRows}
        </>
      ) : isError ? (
        <button type="button" onClick={() => void refetch()} className="text-sm font-medium text-accent-dark">
          读取失败，点击重试
        </button>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-sunken/35 px-3.5 py-3 text-sm text-muted">
          未来 {days} 天内没有生日或已排期活动。
        </div>
      ) : (
        <ul className="space-y-2" data-testid="upcoming-schedule-list">
          {/* 同上：行数与行距纳入基线，日期与标题按动态内容遮罩。 */}
          {events.map((event) => (
            <li key={event.id} className="flex items-center gap-3 rounded-xl border border-border-subtle/80 bg-surface-sunken/35 px-3.5 py-2.5 transition-colors hover:bg-surface">
              <span
                className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg border ${
                  event.kind === 'birthday'
                    ? 'border-warning-border bg-warning-bg text-warning-fg'
                    : 'border-accent/15 bg-accent-soft text-accent'
                }`}
              >
                {event.kind === 'birthday'
                  ? <Cake className="h-4 w-4" aria-hidden="true" />
                  : <CalendarDays className="h-4 w-4" aria-hidden="true" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink" data-visual-dynamic="true">{event.title}</p>
                <p className="mt-0.5 text-xs text-fg-subtle" data-visual-dynamic="true">
                  {formatDay(event.date)}
                  {event.kind === 'birthday' ? ' · 角色生日' : event.participantCount ? ` · ${event.participantCount} 位参与` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
