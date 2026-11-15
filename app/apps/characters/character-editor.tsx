'use client';

import { CharacterEditor as Editor } from '@/app/features/characters/components/character-editor';
import { ConnectedImageGenerationPanel } from '@/app/workspaces/generation/connected-image-generation-panel';

export function CharacterEditor({ characterId }: { characterId?: string }) {
  return <Editor characterId={characterId} generationPanel={ConnectedImageGenerationPanel} />;
}
