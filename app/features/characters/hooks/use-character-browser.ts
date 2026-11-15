'use client';

import { useCallback, useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { CharacterBrowseQuery } from '@sthstart/contracts';
import { browseCharacters } from '../api';
import {
  CHARACTER_DEFAULT_PAGE_SIZE,
  CHARACTER_FILTER_URL_PARAM,
  CHARACTER_PAGE_SIZE_OPTIONS,
  normalizeCharacterFilter,
  parseCharacterFilterParam,
} from '../filter-url';
import { characterKeys } from '../query-keys';

export interface CharacterBrowserOptions {
  persist?: boolean;
  initialFilter?: CharacterBrowseQuery | null;
}

/**
 * 角色浏览的统一实现：角色库与活动选人共用同一套条件与分页。
 * persist=true 时把条件写入 URL，从角色详情返回后可以恢复。
 */
export function useCharacterBrowser(
  overrides: CharacterBrowseQuery = {},
  enabled = true,
  options: CharacterBrowserOptions = {},
) {
  const persist = options.persist === true;
  const initialFilter = normalizeCharacterFilter(options.initialFilter || { page: 1, pageSize: CHARACTER_DEFAULT_PAGE_SIZE });
  const [filter, setFilter] = useState<CharacterBrowseQuery>(initialFilter);
  const [debouncedQ, setDebouncedQ] = useState(() => initialFilter.q || '');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(filter.q || ''), 250);
    return () => clearTimeout(timer);
  }, [filter.q]);

  useEffect(() => {
    if (!persist || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const value = JSON.stringify(filter);
    if (url.searchParams.get(CHARACTER_FILTER_URL_PARAM) === value) return;
    url.searchParams.set(CHARACTER_FILTER_URL_PARAM, value);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [filter, persist]);

  // 浏览器后退/前进时恢复当时的页码、搜索、筛选与排序。
  useEffect(() => {
    if (!persist) return;
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const next = parseCharacterFilterParam(params.get(CHARACTER_FILTER_URL_PARAM))
        || { page: 1, pageSize: CHARACTER_DEFAULT_PAGE_SIZE };
      setFilter(next);
      setDebouncedQ(next.q || '');
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [persist]);

  const request = { ...filter, ...overrides, q: debouncedQ };
  const result = useQuery({
    queryKey: characterKeys.browse(request),
    queryFn: ({ signal }) => browseCharacters(request, signal),
    enabled,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  const change = useCallback((patch: CharacterBrowseQuery) => setFilter((current) => normalizeCharacterFilter({
    ...current,
    ...patch,
    page: patch.page ?? 1,
  })), []);
  const reset = useCallback(() => {
    setFilter((current) => ({
      page: 1,
      pageSize: (CHARACTER_PAGE_SIZE_OPTIONS as readonly number[]).includes(Number(current.pageSize))
        ? Number(current.pageSize)
        : CHARACTER_DEFAULT_PAGE_SIZE,
    }));
    setDebouncedQ('');
  }, []);

  // 删除末页内容后把越界页码收回最后一页；URL 也会同步修正。
  useEffect(() => {
    // keepPreviousData 期间显示的是上一查询的结果，不能用它判断新页码是否越界。
    if (result.isPlaceholderData) return;
    const data = result.data;
    if (!data) return;
    const pages = Math.max(1, Math.ceil(data.total / Math.max(1, data.pageSize)));
    if (filter.page && filter.page > pages) {
      const timer = setTimeout(() => {
        setFilter((current) => current.page === pages ? current : { ...current, page: pages });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [filter.page, result.data, result.isPlaceholderData]);

  return {
    ...result,
    facets: result.data?.facets,
    filter,
    change,
    // 关键词还在防抖窗口内时提示结果即将更新。
    isSearchPending: (filter.q || '') !== debouncedQ,
    reset,
  };
}
