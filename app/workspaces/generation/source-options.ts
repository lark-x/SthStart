import { fetchCharacters } from '@/app/features/characters/api';
import { fetchNotes } from '@/app/features/notebook/api';
import type { ImageContextChoices } from '@/app/features/generation/components/image-generation-panel';

/**
 * 加载角色与世界观笔记选项，供图片生成面板作为上下文来源选择。
 */
export async function loadGenerationContextChoices(): Promise<ImageContextChoices> {
  const [characters, notes] = await Promise.all([
    fetchCharacters(),
    fetchNotes({ kind: 'world' }),
  ]);
  return {
    characters: characters.items.map(item => ({ id: item.id, label: item.displayName })),
    notes: notes.items.flatMap(item => item.id ? [{ id: item.id, label: item.title }] : []),
  };
}

export { adaptEffectiveContext, toggleCharacterInContext, toggleNoteInContext, isCharacterInContext, isNoteInContext } from '@/app/features/generation/model/context-selection';
