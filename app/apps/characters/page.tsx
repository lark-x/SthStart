import type { Metadata } from 'next';
import { CharacterLibrary } from './character-library';
import { parseCharacterFilterParam, CHARACTER_FILTER_URL_PARAM } from '@/app/features/characters/filter-url';

export const metadata: Metadata = { title: '角色资料库 — SthStart', description: '跨应用复用、可追溯版本的公共角色资料库。' };

/** 首屏直接从 URL 恢复筛选条件，从角色详情返回时不会丢失筛选与页码。 */
export default async function CharacterLibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <CharacterLibrary initialFilter={parseCharacterFilterParam(params[CHARACTER_FILTER_URL_PARAM])} />;
}
