import { toCharacterRuntime, type CharacterProfile, type CreateStoryCharacter } from '@sthstart/contracts';
import { fetchCharacterDetail } from '@/app/features/characters/api';

/** Use the selected published snapshot, including its text, rather than the mutable library draft. */
export async function publishedCharacterInput(character: CharacterProfile): Promise<CreateStoryCharacter> {
  if (!character.latestVersion) throw new Error('请先在角色库发布一个版本。');
  const detail = await fetchCharacterDetail(character.id);
  const version = detail.versions.find(item => item.version === character.latestVersion);
  if (!version) throw new Error('来源版本不存在，请刷新角色库。');
  const runtime = toCharacterRuntime(version.data);
  const notes = [
    runtime.work ? '来源作品：' + runtime.work : '',
    runtime.summary,
    runtime.personaText ? '## 人设与性格\n' + runtime.personaText : '',
    runtime.speechText ? '## 语气与对话风格\n' + runtime.speechText : '',
    runtime.dialogueExamples?.length ? '## 对话示例\n' + runtime.dialogueExamples.join('\n\n') : '',
  ].filter(Boolean).join('\n\n');
  return { name: runtime.displayName || character.displayName, notes, sourceCharacterId: character.id, sourceVersion: version.version };
}
