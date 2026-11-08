'use client';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { ActivityPageQuery } from '@sthstart/contracts';
import { activityKeys } from '@/app/lib/query-keys';
import { fetchActivityPage } from './api';

export function useActivityPage(filters: ActivityPageQuery, enabled = true) {
  return useQuery({
    queryKey: [...activityKeys.list(), 'page', filters],
    queryFn: ({signal}) => fetchActivityPage(filters, signal),
    enabled, placeholderData: keepPreviousData, staleTime: 10_000,
  });
}
