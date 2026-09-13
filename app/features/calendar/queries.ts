'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { browseCharacters } from '@/app/features/characters/api';
import { fetchCalendar, type CalendarFilter } from './api';

export const calendarKeys = {
  all: ['calendar'] as const,
  range: (from: string, to: string, filter: CalendarFilter) => [...calendarKeys.all, from, to, filter] as const,
  facets: () => [...calendarKeys.all, 'facets'] as const,
};

export function useCalendarEvents(from: string, to: string, filter: CalendarFilter) {
  return useQuery({
    queryKey: calendarKeys.range(from, to, filter),
    queryFn: ({ signal }) => fetchCalendar(from, to, filter, signal),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

/** 筛选候选直接复用角色库的 facets，避免日历维护第二套作品与标签列表。 */
export function useCalendarFacets() {
  return useQuery({
    queryKey: calendarKeys.facets(),
    queryFn: ({ signal }) => browseCharacters({ page: 1, pageSize: 1 }, signal),
    staleTime: 60_000,
  });
}
