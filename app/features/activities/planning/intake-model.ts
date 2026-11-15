import { buildActivityDocument, findActivityTemplate, suggestRoleMappings } from '@sthstart/contracts';
import type {
  ActivityPlanningFormExtended,
  ActorSnapshot,
  PlanningSelectionState,
} from '@sthstart/contracts';
import type { CastMember, CustomCastMember, IntakeForm, ReferenceDraft } from './types';

export interface PlanningTemplatePreset {
  id: string;
  payload: Record<string, unknown>;
}

export function defaultIntake(templateId: string, date: string): IntakeForm {
  const template = findActivityTemplate(templateId) || findActivityTemplate('blank')!;
  return {
    templateId: template.id,
    title: '',
    type: template.type,
    theme: template.theme,
    location: template.location,
    rules: template.rules,
    scheduledDate: date,
    instruction: '',
    leadCharacterId: '',
    crossoverWorks: [],
    unrestrictedWorks: false,
    guestCountPreference: 6,
    sourceIds: [],
    storyScopeNote: '',
    cast: [],
    birthdayIds: [],
  };
}

/** 合并角色快照到名单，按 characterId 去重并遵守人数上限。 */
export function mergeCast(current: CastMember[], actors: ActorSnapshot[], maxActors: number): CastMember[] {
  const existing = new Set(current.map((member) => member.characterId));
  const added = actors
    .filter((actor) => actor.sourceCharacterId && !existing.has(actor.sourceCharacterId))
    .map((actor) => ({
      characterId: String(actor.sourceCharacterId),
      displayName: actor.displayName,
      avatarUrl: actor.avatarUrl,
      activityRole: actor.activityRole,
    }));
  return added.length ? [...current, ...added].slice(0, maxActors) : current;
}

export function templateActorMappingsFor(
  intake: IntakeForm,
  preset: PlanningTemplatePreset | undefined,
): Record<string, string[]> | undefined {
  if (!preset) return undefined;
  return intake.templateActorMappings || suggestRoleMappings(
    preset.payload,
    intake.cast.map((actor) => ({ id: actor.characterId })),
    intake.leadCharacterId,
  );
}

export function buildPlanningFormPayload({
  intake,
  references,
  templateActorMappings,
  inspiration,
  selection,
  researchRevisionId,
}: {
  intake: IntakeForm;
  references: ReferenceDraft[];
  templateActorMappings?: Record<string, string[]>;
  inspiration?: ActivityPlanningFormExtended['inspiration'];
  selection: PlanningSelectionState | null;
  researchRevisionId: string | null;
}): ActivityPlanningFormExtended {
  return {
    templateId: intake.templateId,
    creationProfile: intake.creationProfile,
    ...(templateActorMappings === undefined ? {} : { templateActorMappings }),
    title: intake.title,
    type: intake.type,
    theme: intake.theme,
    location: intake.location,
    rules: intake.rules,
    scheduledDate: intake.scheduledDate || null,
    characters: intake.cast.map((member) => ({
      characterId: member.characterId,
      ...(member.activityRole ? { activityRole: member.activityRole } : {}),
    })),
    birthdayCharacterIds: intake.birthdayIds,
    ...(intake.instruction.trim() ? { instruction: intake.instruction.trim() } : {}),
    ...(intake.leadCharacterId ? { leadCharacterId: intake.leadCharacterId } : {}),
    ...(intake.leadCharacterId ? { leadRoleLabel: intake.templateId === 'birthday' ? 'birthday-star' as const : 'activity-lead' as const } : {}),
    ...(intake.crossoverWorks.length ? { crossoverWorks: intake.crossoverWorks } : {}),
    ...(intake.unrestrictedWorks ? { unrestrictedWorks: true } : {}),
    guestCountPreference: intake.guestCountPreference,
    ...(intake.storyScopeNote.trim() ? { storyScopeNote: intake.storyScopeNote.trim() } : {}),
    ...(researchRevisionId ? { researchRevisionId } : {}),
    ...(selection ? { selection } : {}),
    // 灵感来源已保存在会话里：每次同步表单都要带上，否则会被这次 PUT 覆盖掉。
    ...(inspiration ? { inspiration } : {}),
    // 参考资料：提交选中的冻结版本；新选择由服务端预览解析后再用于生成。
    ...(references.length
      ? {
          references: references.map((item) => ({
            sourceKind: item.sourceKind,
            sourceId: item.sourceId,
            usage: item.usage,
            ...(item.pinnedExcerpt ? { excerptOverride: item.pinnedExcerpt } : {}),
            ...(item.frozenReference ? { frozenReference: item.frozenReference } : {}),
          })),
        }
      : {}),
  };
}

/** 把角色库角色与自定义参与者合成建活动用的 ActorSnapshot 列表。 */
export function buildBlankActors({
  intake,
  customCast,
  snapshots,
}: {
  intake: IntakeForm;
  customCast: CustomCastMember[];
  snapshots: Map<string, ActorSnapshot>;
}): ActorSnapshot[] {
  const fromLibrary = intake.cast.map((member) => {
    const snapshot = snapshots.get(member.characterId);
    return {
      ...(snapshot ?? {}),
      id: snapshot?.id ?? member.characterId,
      sourceCharacterId: member.characterId,
      displayName: member.displayName,
      persona: (snapshot?.persona ?? {}) as Record<string, unknown>,
      activityRole: member.activityRole || snapshot?.activityRole || '参与者',
      outfitDescription: snapshot?.outfitDescription ?? '',
      appearanceReferenceAssetKeys: snapshot?.appearanceReferenceAssetKeys ?? [],
    } satisfies ActorSnapshot;
  });
  const custom = customCast.map((member) => ({
    id: member.key,
    displayName: member.displayName.trim() || '自定义角色',
    persona: { identity: member.identity, speech: { tone: '' } },
    activityRole: member.activityRole.trim() || '参与者',
    outfitDescription: member.outfitDescription,
    appearanceReferenceAssetKeys: [],
  } satisfies ActorSnapshot));
  return [...fromLibrary, ...custom];
}

/** 从空白开始：跳过检索与方案生成，直接用当前模板与参与者建立活动。 */
export function buildBlankActivityDocument(intake: IntakeForm, actors: ActorSnapshot[]) {
  const title = intake.title.trim() || '未命名活动';
  /*
   * birthdayIds 存的是角色 id，而 buildActivityDocument 的 birthdayActorIds
   * 要的是 actor id；快照的 actor id 由服务端随机生成，两者不能混用。
   */
  const actorIdByCharacterId = new Map(actors.filter((actor) => actor.sourceCharacterId).map((actor) => [String(actor.sourceCharacterId), actor.id]));
  const birthdayActorIds = intake.birthdayIds.flatMap((characterId) => {
    const actorId = actorIdByCharacterId.get(characterId);
    return actorId ? [actorId] : [];
  });
  const document = buildActivityDocument({
    templateId: intake.templateId,
    title,
    type: intake.type,
    theme: intake.theme,
    location: intake.location,
    rules: intake.rules,
    actors,
    birthdayActorIds,
    scheduledDate: intake.scheduledDate || null,
  });
  return { document, title };
}

export function createCustomCastMember(index: number): CustomCastMember {
  return {
    key: `actor_custom_${Date.now().toString(36)}_${index + 1}`,
    displayName: '',
    activityRole: '参与者',
    identity: '只在本场活动出现的临时角色',
    outfitDescription: '日常便服',
  };
}
