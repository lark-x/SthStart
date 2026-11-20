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
export function createCharacterVariant(id: string, name: string, draft: CharacterDraftV2, variantKind: CharacterVariant['variantKind'] = 'form'): CharacterVariant {
  return {
    id,
    name: name.trim(),
    variantKind,
    summary: draft.summary,
    personaText: draft.personaText,
    appearance: {
      baseText: draft.appearance.baseText,
      defaultOutfitText: draft.appearance.defaultOutfitText,
    },
  };
}

/** 形态只覆盖自己的设定；身份、语气与其他共有人设继承主档案。 */
export function effectiveCharacterDraft(draft: CharacterDraftV2, variant?: CharacterVariant | null): CharacterDraftV2 {
  if (!variant) return draft;
  return {
    ...draft,
    summary: variant.summary ?? draft.summary,
    personaText: variant.personaText ?? draft.personaText,
    appearance: variant.appearance ?? draft.appearance,
  };
}

/** 保存失败、修订缺失或保存期间产生新输入时，禁止发布旧稿。 */
export async function saveCharacterStage<T>({ prepare, publish }: {
  prepare: () => Promise<{ id: string; draftRevision: number } | null>;
  publish: (saved: { id: string; draftRevision: number }) => Promise<T>;
}): Promise<T | null> {
  const saved = await prepare();
  if (!saved || !Number.isInteger(saved.draftRevision) || saved.draftRevision < 1) return null;
  return publish(saved);
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
