import type { CharacterProfile, CharacterVersion } from '@sthstart/contracts';
import { fetchCharacterDetail, publishCharacter } from '../api';

/** A selection always owns a frozen snapshot; browsing never publishes original work. */
export interface CharacterBrowserSelection {
  profile: CharacterProfile;
  versions: CharacterVersion[];
  version: CharacterVersion;
  variantId?: string;
  costumeAssetId?: string;
}

export function characterStageLabel(version: CharacterVersion): string {
  return (
    version.versionLabel?.trim() ||
    `历史阶段 ${version.version} · ${version.createdAt.slice(0, 10)}`
  );
}

export async function resolveCharacterSelection(
  profile: CharacterProfile,
  options: {
    version?: number;
    variantId?: string;
    costumeAssetId?: string;
  } = {}
): Promise<CharacterBrowserSelection> {
  let detail = await fetchCharacterDetail(profile.id);
  const original = detail.draft.originType === 'original';
  let versionNumber = options.version;
  if (original) {
    if (!detail.versions.length)
      throw new Error(
        `原创角色「${profile.displayName}」尚未保存阶段，请先前往角色详情保存一个具名阶段。`
      );
    versionNumber ??= detail.latestVersion ?? undefined;
  } else {
    // Publishing non-original work is idempotent at an unchanged draft revision.
    const latest = await publishCharacter(profile.id, detail.draftRevision);
    versionNumber = latest.version;
    detail = await fetchCharacterDetail(profile.id);
  }
  const versions = [...detail.versions].sort((a, b) => b.version - a.version);
  const version =
    versions.find((item) => item.version === versionNumber) ??
    (versionNumber == null ? versions[0] : undefined);
  if (!version) throw new Error('所选角色快照不可读取，请刷新角色库。');
  return {
    profile: detail,
    versions,
    version,
    variantId: options.variantId,
    costumeAssetId: options.costumeAssetId,
  };
}
