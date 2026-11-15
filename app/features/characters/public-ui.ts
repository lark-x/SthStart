/**
 * 角色模块明确支持跨模块使用的展示组件。
 * 模块内部仍直接引用 components 下的具体文件，不绕回此入口。
 */
export { CharacterFilters } from './components/character-filters';
export { CharacterPagination } from './components/character-pagination';
export type { CharacterAvatarGenerationPanel } from './components/character-avatar-dialogs';
