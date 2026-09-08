import { createHash, randomUUID } from 'node:crypto';
import type {
  ActorSnapshot,
  ContentDocument,
  ImageConfigDocument,
  MediaSlot,
  SourceEntityKind,
  SourceOwnerKind,
  SourceRef,
} from '@sthstart/contracts';

export function computeValueHash(value: unknown): string {
  if (value === undefined || value === null) {
    return createHash('sha256').update('__NULL__').digest('hex');
  }
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return createHash('sha256').update(str).digest('hex');
}

export const ALLOWED_FIELD_PATHS: Record<SourceEntityKind, readonly string[]> = {
  actor: [
    '/displayName',
    '/activityRole',
    '/outfitDescription',
    '/appearanceReferenceAssetKeys',
    '/persona',
    '/persona/appearance',
    '/persona/hairColor',
    '/persona/eyeColor',
    '/persona/features',
    '/persona/clothing',
    '/persona/style',
    '/persona/gender',
    '/persona/age',
    'outfitDescription',
  ],
  stage: [
    '/title',
    '/location',
    '/instruction',
  ],
  fact: [
    '/text',
    '/status',
  ],
  activity: [
    '/title',
    '/theme',
    '/location',
    '/rules',
    'activity.title',
    'activity.theme',
    'activity.location',
    'activity.rules',
  ],
  shot: [
    '/shotDescription',
    '/caption',
    '/shotType',
    '/composition',
    '/viewpoint',
    '/lighting',
    '/supplementPrompt',
    '/negativePrompt',
  ],
  style: [
    '/stylePreset',
    '/globalStylePrompt',
    '/globalNegativePrompt',
  ],
  override: [
    '/overrideText',
  ],
  character: [
    '/displayName',
    '/draftRevision',
    '/appearance',
    '/appearance/description',
    '/appearance/hair',
    '/appearance/eyes',
    '/appearance/build',
    '/appearance/outfits',
    '/appearance/accessories',
  ],
  character_version: [
    '/version',
    '/data',
    '/appearanceSnapshot',
  ],
  reference: [
    '/assetId',
    '/purpose',
    '/outfitId',
    '/sha256',
  ],
};

export function isAllowedFieldPath(entityKind: SourceEntityKind, fieldPath: string): boolean {
  const allowed = ALLOWED_FIELD_PATHS[entityKind];
  if (!allowed) return false;
  if (allowed.includes(fieldPath)) return true;
  if (allowed.some((a) => fieldPath.endsWith(a) || fieldPath.replace(/^\//, '') === a.replace(/^\//, ''))) return true;
  if (fieldPath.includes('].')) {
    const prop = '/' + fieldPath.split('].')[1];
    if (allowed.includes(prop) || allowed.includes(fieldPath.split('].')[1])) return true;
  }
  // For persona nested fields
  if (entityKind === 'actor' && (fieldPath.startsWith('/persona/') || fieldPath.includes('persona.'))) {
    const key = fieldPath.replace(/^.*persona[./]/, '');
    return /^[a-zA-Z0-9_]{1,32}$/.test(key);
  }
  return false;
}

export function extractEntityFieldValue(
  entity: Record<string, unknown> | null | undefined,
  fieldPath: string,
): { value: unknown; found: boolean } {
  if (!entity || typeof entity !== 'object') {
    return { value: null, found: false };
  }

  let cleanPath = fieldPath;
  if (cleanPath.includes('].')) {
    cleanPath = cleanPath.split('].')[1];
  }
  const parts = cleanPath.split(/[./]/).filter(Boolean);
  if (parts.length > 1 && (parts[0] === 'activity' || parts[0] === 'actor' || parts[0] === 'stage' || parts[0] === 'fact')) {
    parts.shift();
  }

  let current: unknown = entity;

  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return { value: null, found: false };
    }
    if (Object.prototype.hasOwnProperty.call(current, part)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return { value: null, found: false };
    }
  }

  return { value: current, found: true };
}

export function createSourceRef(params: {
  activityId: string;
  ownerKind: SourceOwnerKind;
  ownerRevisionId: string;
  entityKind: SourceEntityKind;
  entityId: string;
  fieldPath: string;
  valueSnapshot: unknown;
  labelSnapshot: string;
}): SourceRef {
  return {
    id: `sref_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    activityId: params.activityId,
    ownerKind: params.ownerKind,
    ownerRevisionId: params.ownerRevisionId,
    entityKind: params.entityKind,
    entityId: params.entityId,
    fieldPath: params.fieldPath,
    valueSnapshot: params.valueSnapshot ?? '',
    valueHash: computeValueHash(params.valueSnapshot),
    labelSnapshot: params.labelSnapshot,
  };
}

export interface ResolvedSourceDetail {
  sourceRef: SourceRef;
  historicalValue: unknown;
  currentValue: unknown;
  isDeleted: boolean;
  isChanged: boolean;
  hasChanged?: boolean;
  navigationTarget: {
    entityKind: SourceEntityKind;
    entityId: string;
    fieldPath: string;
    panel: 'actor' | 'stage' | 'fact' | 'image_config' | 'shot' | 'override' | 'character';
    label: string;
  };
}

export function resolveSourceRef(
  sourceRef: SourceRef,
  currentContent: ContentDocument,
  currentImageConfig: ImageConfigDocument,
): ResolvedSourceDetail {
  let currentValue: unknown = null;
  let isDeleted = false;
  let panel: 'actor' | 'stage' | 'fact' | 'image_config' | 'shot' | 'override' | 'character' = 'actor';
  let label = sourceRef.labelSnapshot;

  switch (sourceRef.entityKind) {
    case 'actor': {
      panel = 'actor';
      const actor = currentContent.actors.find((a) => a.id === sourceRef.entityId);
      if (!actor) {
        isDeleted = true;
      } else {
        label = `本场角色·${actor.displayName}`;
        const res = extractEntityFieldValue(actor as unknown as Record<string, unknown>, sourceRef.fieldPath);
        currentValue = res.found ? res.value : null;
      }
      break;
    }
    case 'stage': {
      panel = 'stage';
      const stage = currentContent.stages.find((s) => s.id === sourceRef.entityId);
      if (!stage) {
        isDeleted = true;
      } else {
        label = `阶段·${stage.title}`;
        const res = extractEntityFieldValue(stage as unknown as Record<string, unknown>, sourceRef.fieldPath);
        currentValue = res.found ? res.value : null;
      }
      break;
    }
    case 'fact': {
      panel = 'fact';
      const fact = currentContent.facts.find((f) => f.id === sourceRef.entityId);
      if (!fact) {
        isDeleted = true;
      } else {
        label = '活动事实';
        const res = extractEntityFieldValue(fact as unknown as Record<string, unknown>, sourceRef.fieldPath);
        currentValue = res.found ? res.value : null;
      }
      break;
    }
    case 'style': {
      panel = 'image_config';
      label = '本场图像风格';
      const res = extractEntityFieldValue(currentImageConfig as unknown as Record<string, unknown>, sourceRef.fieldPath);
      currentValue = res.found ? res.value : null;
      break;
    }
    case 'shot': {
      panel = 'shot';
      const slot = currentContent.mediaSlots.find((s) => s.id === sourceRef.entityId);
      const slotConfig = currentImageConfig.slotConfigs.find((sc) => sc.slotId === sourceRef.entityId);
      if (!slot && !slotConfig) {
        isDeleted = true;
      } else {
        label = `镜头设定·${slot?.caption || sourceRef.entityId}`;
        const fromSlot = slot ? extractEntityFieldValue(slot as unknown as Record<string, unknown>, sourceRef.fieldPath) : { found: false, value: null };
        const fromConfig = slotConfig ? extractEntityFieldValue(slotConfig as unknown as Record<string, unknown>, sourceRef.fieldPath) : { found: false, value: null };
        currentValue = fromSlot.found ? fromSlot.value : (fromConfig.found ? fromConfig.value : null);
      }
      break;
    }
    case 'activity': {
      panel = 'stage';
      label = '活动设定';
      const res = extractEntityFieldValue(currentContent.activity as unknown as Record<string, unknown>, sourceRef.fieldPath);
      currentValue = res.found ? res.value : null;
      break;
    }
    case 'override': {
      panel = 'override';
      label = '单次生成覆盖';
      currentValue = sourceRef.valueSnapshot;
      break;
    }
    case 'character':
    case 'character_version': {
      panel = 'character';
      const actor = currentContent.actors.find((item) => item.sourceCharacterId === sourceRef.entityId);
      if (!actor) {
        isDeleted = true;
      } else {
        label = `公共角色·${actor.displayName}`;
        const res = extractEntityFieldValue(actor.persona as Record<string, unknown>, sourceRef.fieldPath);
        currentValue = res.found ? res.value : null;
      }
      break;
    }
    default: {
      panel = 'actor';
      break;
    }
  }

  const currentHash = computeValueHash(currentValue);
  const isChanged = !isDeleted && currentHash !== sourceRef.valueHash;

  return {
    sourceRef,
    historicalValue: sourceRef.valueSnapshot,
    currentValue,
    isDeleted,
    isChanged,
    hasChanged: isChanged,
    navigationTarget: {
      entityKind: sourceRef.entityKind,
      entityId: sourceRef.entityId,
      fieldPath: sourceRef.fieldPath,
      panel,
      label,
    },
  };
}
