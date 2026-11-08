import type { CharacterBrowseQuery } from '@sthstart/contracts';

export const CHARACTER_FILTER_URL_PARAM = 'cf';
export const CHARACTER_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export const CHARACTER_DEFAULT_PAGE_SIZE = CHARACTER_PAGE_SIZE_OPTIONS[0];

const CHARACTER_SORTS = new Set(['updated', 'name']);
const BIRTHDAY_STATUSES = new Set(['known', 'needs_confirmation', 'unset']);

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return items.length ? [...new Set(items)] : undefined;
}

/**
 * 把 URL 或调用方传入的条件收敛成服务端可接受的范围。
 * 非法页码回到第一页，未知容量回到文本列表默认的 20 条。
 */
export function normalizeCharacterFilter(input: unknown): CharacterBrowseQuery {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { page: 1, pageSize: CHARACTER_DEFAULT_PAGE_SIZE };
  }
  const source = { ...(input as CharacterBrowseQuery) };
  const pageSize = Number(source.pageSize);
  source.page = positiveInteger(source.page, 1);
  source.pageSize = (CHARACTER_PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSize)
    ? pageSize
    : CHARACTER_DEFAULT_PAGE_SIZE;

  for (const key of ['works', 'tags', 'groups', 'excludeIds'] as const) {
    const items = strings(source[key]);
    if (items) source[key] = items;
    else delete source[key];
  }
  for (const key of ['q', 'mediaType', 'originType', 'interpretation', 'source'] as const) {
    if (source[key] !== undefined && typeof source[key] !== 'string') delete source[key];
  }
  if (source.sort !== undefined && !(typeof source.sort === 'string' && CHARACTER_SORTS.has(source.sort))) delete source.sort;
  if (source.tagMode !== 'any' && source.tagMode !== 'all') delete source.tagMode;
  if (source.reference !== 'yes' && source.reference !== 'no') delete source.reference;
  if (source.appearance !== 'yes' && source.appearance !== 'no') delete source.appearance;
  if (source.unclassified !== 'work' && source.unclassified !== 'tags') delete source.unclassified;
  if (source.birthdayStatus !== undefined && !BIRTHDAY_STATUSES.has(String(source.birthdayStatus))) delete source.birthdayStatus;
  if (source.favorite !== undefined && typeof source.favorite !== 'boolean') delete source.favorite;
  if (source.birthdayMonth !== undefined) {
    const month = Number(source.birthdayMonth);
    if (Number.isSafeInteger(month) && month >= 1 && month <= 12) source.birthdayMonth = month;
    else delete source.birthdayMonth;
  }
  if (source.kinds !== undefined && (!Array.isArray(source.kinds) || source.kinds.some((kind) => kind !== 'birthday' && kind !== 'activity'))) {
    delete source.kinds;
  }
  return source;
}

/**
 * 解析 URL 中的角色筛选条件。
 * 这里刻意放在不带 'use client' 的模块里：服务端页面需要直接调用它来注入首屏筛选，
 * 从客户端模块导入的函数在服务端只是客户端引用，无法调用。
 */
export function parseCharacterFilterParam(raw?: string | string[] | null): CharacterBrowseQuery | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return normalizeCharacterFilter(parsed);
  } catch { return null; }
}

/** 生成角色列表 URL；分页调用方用 pushState 创建可后退的历史记录。 */
export function characterFilterUrl(currentHref: string, filter: CharacterBrowseQuery): string {
  const url = new URL(currentHref, 'http://sthstart.local');
  url.searchParams.set(CHARACTER_FILTER_URL_PARAM, JSON.stringify(normalizeCharacterFilter(filter)));
  return `${url.pathname}${url.search}${url.hash}`;
}
