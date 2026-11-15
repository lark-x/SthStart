import type { CharacterDraftV2, CharacterVariant } from '@sthstart/contracts';

export type CharacterEditorStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

/** 服务器快照、表单值与附加实体（标签、形态）的统一比较文本。 */
export function characterDraftSnapshot(
  values: unknown,
  tags: readonly string[],
  variants: readonly CharacterVariant[],
): string {
  return JSON.stringify({ values, tags, variants });
}

/** 衍生形态只复制当前草稿的展示性内容；ID 由调用方生成，保持纯函数。 */
export function createCharacterVariant(id: string, name: string, draft: CharacterDraftV2): CharacterVariant {
  return {
    id,
    name: name.trim(),
    summary: draft.summary,
    personaText: draft.personaText,
    appearance: {
      baseText: draft.appearance.baseText,
      defaultOutfitText: draft.appearance.defaultOutfitText,
    },
  };
}

export function buildCharacterAvatarPrompt(draft: CharacterDraftV2): string {
  return [
    draft.displayName,
    draft.work,
    draft.appearance.baseText,
    draft.appearance.defaultOutfitText,
    '角色头像，突出面部特征，保持角色身份和服装一致',
  ]
    .filter(Boolean)
    .join(', ');
}
