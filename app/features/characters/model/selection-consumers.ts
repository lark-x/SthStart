import {
  resolveCharacterVersionSelection,
  toCharacterRuntime,
  buildCharacterVisualContext,
  type ActorSnapshot,
  type CharacterProfile,
  type CreateStoryCharacter,
} from '@sthstart/contracts';
import { getJson } from '@/app/lib/api-client';
import {
  resolveCharacterSelection,
  type CharacterBrowserSelection,
} from './character-selection';

/** Read the server actor projection and enforce the same frozen visual selection locally. */
export async function activityActorFromCharacterSelection(
  selection: CharacterBrowserSelection
): Promise<ActorSnapshot> {
  const params = new URLSearchParams({
    version: String(selection.version.version),
  });
  if (selection.variantId) params.set('variantId', selection.variantId);
  if (selection.costumeAssetId)
    params.set('costumeAssetId', selection.costumeAssetId);
  const actor = await getJson<ActorSnapshot>(
    `/api/admin/activities/characters/${encodeURIComponent(selection.profile.id)}/snapshot?${params}`
  );
  const effective = resolveCharacterVersionSelection(
    selection.version,
    selection
  );
  const runtime = toCharacterRuntime(effective.draft);
  return {
    ...actor,
    sourceCharacterId: selection.profile.id,
    sourceVersion: selection.version.version,
    sourceVersionStatus: 'published',
    sourceVariantId: selection.variantId,
    sourceCostumeAssetId: selection.costumeAssetId,
    displayName: runtime.displayName,
    persona: {
      ...runtime,
      visualPrompt: buildCharacterVisualContext(runtime).text,
    },
    outfitDescription: runtime.appearance.defaultOutfitText,
    avatarAssetId: effective.avatarAssetId,
    avatarUrl: effective.avatarUrl,
    portraitAssetId: effective.portraitAssetId,
    portraitUrl: effective.portraitUrl,
  };
}
/** Adopt an explicit original stage, or the latest non-original snapshot. */
export async function storyCharacterFromCharacterSelection(
  character: CharacterProfile,
  selection?: CharacterBrowserSelection
): Promise<CreateStoryCharacter> {
  const choice = selection ?? (await resolveCharacterSelection(character));
  if (choice.profile.id !== character.id)
    throw new Error('角色来源已变化，请重新选择。');
  const effective = resolveCharacterVersionSelection(choice.version, choice);
  const runtime = toCharacterRuntime(effective.draft);
  const notes = [
    runtime.work ? '来源作品：' + runtime.work : '',
    runtime.summary,
    runtime.personaText ? '## 人设与性格\n' + runtime.personaText : '',
    runtime.speechText ? '## 语气与对话风格\n' + runtime.speechText : '',
    runtime.dialogueExamples?.length
      ? '## 对话示例\n' + runtime.dialogueExamples.join('\n\n')
      : '',
    runtime.appearance.baseText
      ? '## 外貌\n' + runtime.appearance.baseText
      : '',
    runtime.appearance.defaultOutfitText
      ? '## 采用服装\n' + runtime.appearance.defaultOutfitText
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    name: runtime.displayName || character.displayName,
    notes,
    sourceCharacterId: character.id,
    sourceVersion: choice.version.version,
    sourceVariantId: choice.variantId,
    sourceCostumeAssetId: choice.costumeAssetId,
  };
}
