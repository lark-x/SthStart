import type {
  PlanningKnowledgeReference,
  PlanningKnowledgeSnapshot,
  PlanningReferenceSelection,
  PlanningReferenceUsage,
} from '@sthstart/contracts';

export const STEPS = ['活动意图', '人物与地点', '方案对比', '确认创建'] as const;

export type StepIndex = 0 | 1 | 2 | 3;
export type CandidateStatus = 'required' | 'optional' | 'excluded';
export type CastPickerTarget = 'cast' | 'lead' | { match: string };

export interface CastMember {
  characterId: string;
  displayName: string;
  avatarUrl?: string;
  activityRole?: string;
  version?: number;
  variantId?: string;
  costumeAssetId?: string;
}

/**
 * 自定义参与者只在本场活动出现，没有 sourceCharacterId，服务端无法冻结人设快照。
 * 因此只能走「从空白开始」，进入检索或方案生成前必须移除。
 */
export interface CustomCastMember {
  key: string;
  displayName: string;
  activityRole: string;
  identity: string;
  outfitDescription: string;
}

export interface CustomLocation {
  id: string;
  name: string;
  note: string;
  status: CandidateStatus;
  locked: boolean;
}

/** 已选的参考资料：保留显示内容与用户确认的冻结引用，刷新后可继续使用同一版本。 */
export interface ReferenceDraft {
  key: string;
  sourceKind: PlanningReferenceSelection['sourceKind'];
  sourceId: string;
  usage: PlanningReferenceUsage;
  title: string;
  excerpt: string;
  nature?: string;
  authorship?: string;
  usageLabel?: string;
  /** 用户选择继续用旧内容时固定下来的摘要；生成时作为该引用的覆盖内容。 */
  pinnedExcerpt?: string;
  frozenReference?: PlanningKnowledgeReference;
}

export interface ReferencePreviewState {
  snapshot: PlanningKnowledgeSnapshot;
  unresolved: Array<{ sourceKind: string; sourceId: string; reason: string }>;
  truncated: boolean;
}

export interface IntakeForm {
  templateActorMappings?: Record<string, string[]>;
  creationProfile?: Record<string, unknown>;
  templateId: string;
  title: string;
  type: string;
  theme: string;
  location: string;
  rules: string;
  scheduledDate: string;
  instruction: string;
  leadCharacterId: string;
  crossoverWorks: string[];
  unrestrictedWorks: boolean;
  guestCountPreference: number;
  sourceIds: string[];
  storyScopeNote: string;
  cast: CastMember[];
  birthdayIds: string[];
}
