import type { ImageContextSelection } from '@sthstart/contracts';

/**
 * 适配并合并固定上下文（如来自角色编辑器的角色上下文）与用户在面板中选择的上下文。
 * 遵循原业务规则：当传入固定上下文时，以固定上下文为基准，并合并或覆盖 noteIds。
 */
export function adaptEffectiveContext(
  baseContext?: ImageContextSelection,
  selectedContext?: ImageContextSelection,
): ImageContextSelection {
  if (baseContext) {
    return {
      ...baseContext,
      noteIds: selectedContext?.noteIds ?? baseContext.noteIds,
    };
  }
  return selectedContext ?? {};
}

/**
 * 切换角色选中状态，最多支持 maxCharacters 个角色（默认 8 个，遵循契约约束）。
 */
export function toggleCharacterInContext(
  previous: ImageContextSelection,
  characterId: string,
  checked: boolean,
  maxCharacters = 8,
): ImageContextSelection {
  return {
    ...previous,
    characters: checked
      ? [...(previous.characters ?? []), { characterId }].slice(0, maxCharacters)
      : previous.characters?.filter(actor => actor.characterId !== characterId),
  };
}

/**
 * 切换笔记设定选中状态，最多支持 maxNotes 篇笔记（默认 12 篇，遵循契约约束）。
 */
export function toggleNoteInContext(
  previous: ImageContextSelection,
  noteId: string,
  checked: boolean,
  maxNotes = 12,
): ImageContextSelection {
  return {
    ...previous,
    noteIds: checked
      ? [...(previous.noteIds ?? []), noteId].slice(0, maxNotes)
      : previous.noteIds?.filter(id => id !== noteId),
  };
}

/**
 * 判断指定角色是否已在有效上下文中选中。
 */
export function isCharacterInContext(
  effectiveContext: ImageContextSelection,
  characterId: string,
): boolean {
  return Boolean(effectiveContext.characters?.some(actor => actor.characterId === characterId));
}

/**
 * 判断指定笔记是否已在有效上下文中选中。
 */
export function isNoteInContext(
  effectiveContext: ImageContextSelection,
  noteId: string,
): boolean {
  return Boolean(effectiveContext.noteIds?.includes(noteId));
}
