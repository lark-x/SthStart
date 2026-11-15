'use client';

/**
 * 角色模块的稳定客户端入口。跨模块从这里取浏览 Hook 与筛选能力，
 * 不连带引入编辑器、请求实现或整个模块；服务端首屏筛选直接使用 filter-url。
 */
export { useCharacterBrowser, type CharacterBrowserOptions } from './hooks/use-character-browser';
export {
  CHARACTER_DEFAULT_PAGE_SIZE,
  CHARACTER_FILTER_URL_PARAM,
  CHARACTER_PAGE_SIZE_OPTIONS,
  characterFilterUrl,
  normalizeCharacterFilter,
  parseCharacterFilterParam,
} from './filter-url';
export { hasCharacterFilters } from './model/filter-chips';
