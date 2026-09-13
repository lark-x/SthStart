import type { CharacterBrowseQuery } from '@sthstart/contracts';

export const CHARACTER_FILTER_URL_PARAM = 'cf';

/**
 * 解析 URL 中的角色筛选条件。
 * 这里刻意放在不带 'use client' 的模块里：服务端页面需要直接调用它来注入首屏筛选，
 * 从客户端模块导入的函数在服务端只是客户端引用，无法调用。
 */
export function parseCharacterFilterParam(raw?: string | string[] | null): CharacterBrowseQuery | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as CharacterBrowseQuery;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return { ...parsed, page: Math.max(1, Number(parsed.page) || 1) };
  } catch { return null; }
}
