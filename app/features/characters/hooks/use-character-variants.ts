'use client';

import { useState } from 'react';
import type { CharacterDraftV2, CharacterVariant } from '@sthstart/contracts';
import { useToast } from '@/app/providers/ui-provider';
import { createCharacterVariant } from '../model/character-editor-model';

/** 衍生形态的编辑状态；与主表单一起保存，但不是第二份角色草稿。 */
export function useCharacterVariants({
  draft,
  markDirty,
}: {
  draft: CharacterDraftV2;
  markDirty: () => void;
}) {
  const toast = useToast();
  const [variants, setVariants] = useState<CharacterVariant[]>([]);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);

  const addVariant = (name: string, kind: CharacterVariant['variantKind'] = 'form') => {
    if (!name.trim()) return null;
    const variant = createCharacterVariant(crypto.randomUUID(), name, draft, kind);
    setVariants((current) => [...current, variant]);
    setActiveVariantId(variant.id);
    markDirty();
    toast.success(`已添加衍生形态「${variant.name}」`);
    return variant;
  };

  const removeVariant = (variantId: string) => {
    setVariants((current) => current.filter((item) => item.id !== variantId));
    setActiveVariantId((current) => current === variantId ? null : current);
    markDirty();
    toast.info('已移除衍生形态');
  };

  const updateVariant = (variantId: string, patch: Partial<CharacterVariant>) => {
    setVariants((current) =>
      current.map((item) => (item.id === variantId ? { ...item, ...patch } : item)),
    );
    markDirty();
  };

  return { variants, setVariants, activeVariantId, setActiveVariantId, addVariant, removeVariant, updateVariant };
}
