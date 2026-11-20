'use client';

import Link from 'next/link';
import { Cake, CalendarDays, ArrowRight } from 'lucide-react';
import { useCalendarEvents } from '@/app/features/calendar/queries';
import { Skeleton } from '@/app/components/ui/skeleton';
import { Button } from '@/app/components/ui/button';

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

function parseDayBadge(value: string): { month: string; day: string } | null {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    month: `${parsed.getMonth() + 1}月`,
    day: String(parsed.getDate()).padStart(2, '0'),
  };
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
    <ul className="home-list" aria-hidden="true">
      {Array.from({ length: limit }, (_, index) => (
        <li key={index} className="home-row">
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
    <section className="home-section" aria-labelledby="upcoming-title">
      <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-border-subtle pb-3">
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
        <Button size="sm" variant="outline" onClick={() => void refetch()}>
          读取失败，点击重试
        </Button>
      ) : events.length === 0 ? (
        <div className="py-4 text-sm text-muted">
          未来 {days} 天内没有生日或已排期活动。
        </div>
      ) : (
        <ul className="home-list" data-testid="upcoming-schedule-list" data-motion-list="">
          {/* 同上：行数与行距纳入基线，日期与标题按动态内容遮罩。 */}
          {events.map((event) => {
            const badge = parseDayBadge(event.date);
            const tone = event.kind === 'birthday' ? 'pink' : 'orange';
            return (
              <li key={event.id} className="home-row">
                {badge ? (
                  <div
                    data-tone={tone}
                    aria-hidden="true"
                    className="flex h-11 w-10 flex-none flex-col items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-surface-sunken/70 shadow-2xs"
                  >
                    <span className="w-full bg-[var(--tone-soft)] py-0.5 text-center text-xs font-semibold leading-none text-[var(--tone-fg)] tabular-nums">
                      {badge.month}
                    </span>
                    <span className="flex flex-1 items-center justify-center text-sm font-semibold leading-none text-ink tabular-nums">
                      {badge.day}
                    </span>
                  </div>
                ) : (
                  <span className="home-row-icon" data-tone={tone}>
                    {event.kind === 'birthday'
                      ? <Cake className="h-4 w-4" aria-hidden="true" />
                      : <CalendarDays className="h-4 w-4" aria-hidden="true" />}
                  </span>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-[14.5px] font-[540] text-ink" data-visual-dynamic="true">{event.title}</p>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle" data-visual-dynamic="true">
                    <span
                      data-tone={tone}
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--tone-soft)] px-2 py-0.5 text-xs font-medium text-[var(--tone-fg)]"
                    >
                      {event.kind === 'birthday'
                        ? <Cake className="h-3 w-3" aria-hidden="true" />
                        : <CalendarDays className="h-3 w-3" aria-hidden="true" />}
                      <span>{event.kind === 'birthday' ? '角色生日' : '活动排期'}</span>
                    </span>
                    <span className="tabular-nums">{formatDay(event.date)}</span>
                    {event.kind !== 'birthday' && event.participantCount ? (
                      <span className="tabular-nums">· {event.participantCount} 位参与</span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
