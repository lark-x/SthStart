'use client';

import { useEffect, useState } from 'react';
import type { ContentDocument } from '@sthstart/contracts';
import { fetchCharacterVisualReferences } from '@/app/features/characters/api';

export type CharacterVisualReference = {
  characterId: string;
  characterName: string;
  version?: number;
  referenceId: string;
  url: string;
};

export function useCharacterReferences(actors: ContentDocument['actors'] | undefined): CharacterVisualReference[] {
  const [characterReferences, setCharacterReferences] = useState<CharacterVisualReference[]>([]);

  /* eslint-disable react-hooks/set-state-in-effect -- references are loaded from the character service for this activity. */
  useEffect(() => {
    const linkedActors = (actors || []).filter((actor) => actor.sourceCharacterId);
    if (!linkedActors.length) {
      setCharacterReferences([]);
      return;
    }
    let active = true;
    void Promise.all(linkedActors.map(async (actor) => {
      const characterId = actor.sourceCharacterId!;
      const response = await fetchCharacterVisualReferences(characterId);
      const frozenAssetIds = Array.isArray(actor.appearanceReferenceAssetIds) ? new Set(actor.appearanceReferenceAssetIds) : null;
      return response.items.flatMap((item) => typeof item.id === 'string' && typeof item.url === 'string'
        && (!frozenAssetIds || (typeof item.assetId === 'string' && frozenAssetIds.has(item.assetId)))
        ? [{ characterId, characterName: actor.displayName, version: actor.sourceVersion, referenceId: item.id, url: item.url }]
        : []);
    })).then((groups) => {
      if (active) setCharacterReferences(groups.flat());
    }).catch(() => {
      if (active) setCharacterReferences([]);
    });
    return () => { active = false; };
  }, [actors]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return characterReferences;
}
