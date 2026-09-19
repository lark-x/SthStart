'use client';
import { suggestRoleMappings } from '@sthstart/contracts';
import { TemplateRoleMapping } from './template-role-mapping';
import { CreationProfilePicker } from './creation-profile-picker';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, Compass, ExternalLink, FileText, Lightbulb, Link2, Lock, MapPin,
  BookOpen, Plus, RefreshCw, Search, Sparkles, Trash2, UserPlus, Users, Wand2, X,
} from 'lucide-react';
import { ACTIVITY_TEMPLATES, applyPlanningOutput, buildActivityDocument, findActivityTemplate, isUnresolvedPlanningActor } from '@sthstart/contracts';
import type {
  ActivityPlanningActorResolveInput, ActivityPlanningCandidate, ActivityPlanningFormExtended,
  ActivityPlanningJob, ActivityPlanningOutput, ActivityPlanningPersonaDraft, ActivityPlanningSessionResponse,
  ActorSnapshot, PlanningCandidateSummary, PlanningSelectionState, ResearchCharacterCandidate, ResearchEvidence,
  ResearchTask, ActivityIdea, ActivityIdeaBatch,
} from '@sthstart/contracts';
import type {
  KnowledgeSearchItem, PlanningKnowledgeSnapshot, PlanningKnowledgeReference, PlanningReferenceSelection, PlanningReferenceUsage,
} from '@sthstart/contracts';
import { KNOWLEDGE_MAX_REFERENCES } from '@sthstart/contracts';
import { CharacterPickerDialog } from './character-picker-dialog';
import { CharacterImportDialog } from '@/app/features/characters/components/character-import-dialog';
import { browseCharacters } from '@/app/features/characters/api';
import { fetchMcpSources } from '@/app/features/mcp-sources/api';
import { InspirationPicker } from '@/app/features/topics/components/inspiration-picker';
import { applyIdea } from '@/app/features/topics/api';
import { KnowledgePicker } from '@/app/features/knowledge/components/knowledge-picker';
import {
  GapCollectionDialog, RecommendationDialog, ReferenceUpdateDialog, type AssistantSelection,
} from '@/app/features/knowledge/components/reference-assistant';
import { previewReferences } from '@/app/features/notebook/api';
import { authorshipLabels, natureLabels } from '@/app/features/notebook/schemas';
import { activityKeys } from '@/app/lib/query-keys';
import {
  cancelPlanningJob, cancelPlanningResearch, createActivityFromPlanningSession, createPlanningSession,
  fetchActivityCharacterSnapshot, fetchPlanningJob, fetchPlanningPersonaDraft, fetchPlanningResearch,
  fetchPlanningResearchTasks, fetchPlanningSession, resolvePlanningActor, savePlanningResearchSelection,
  startPlanningResearch, triggerPlanningJob, updatePlanningSession, retryPlanningJob,
} from '@/app/features/activities/api';
import { useActivityCapabilities, useActivityPresets } from '@/app/features/activities/queries';
import { useCreateActivity } from '@/app/features/activities/mutations';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer, WorkbenchColumns } from '@/app/components/shared/page-layout';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Dialog } from '@/app/components/ui/dialog';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { PageTabs } from '@/app/components/ui/page-tabs';

const STEPS = ['活动意图', '人物与地点', '方案对比', '确认创建'] as const;
type StepIndex = 0 | 1 | 2 | 3;
type CandidateStatus = 'required' | 'optional' | 'excluded';

const MCP_SETTINGS_HREF = '/settings/public-services?section=models';
const TERMINAL_RESEARCH: ResearchTask['status'][] = ['succeeded', 'failed', 'cancelled', 'incomplete'];

const BASIS_LABEL: Record<string, string> = { documented: '资料支持', inferred: '资料推测', creative: '联动建议' };
const BASIS_CLASS: Record<string, string> = {
  documented: 'bg-green-50 text-green-700 border-green-200',
  inferred: 'bg-amber-50 text-amber-800 border-amber-200',
  creative: 'bg-accent/10 text-accent-dark border-accent/30',
};

interface CastMember { characterId: string; displayName: string; avatarUrl?: string; activityRole?: string }
/**
 * 自定义参与者：只在本场活动出现、不来自角色库的临时角色。
 *
 * 这类角色没有 sourceCharacterId，服务端无法为它冻结人设快照，
 * 因此只能走「从空白开始」直接建活动；进入检索或方案生成前必须移除。
 */
interface CustomCastMember { key: string; displayName: string; activityRole: string; identity: string; outfitDescription: string }
interface CustomLocation { id: string; name: string; note: string; status: CandidateStatus; locked: boolean }

/** 已选的参考资料：保留显示内容与用户确认的冻结引用，刷新后可继续使用同一版本。 */
interface ReferenceDraft {
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

interface IntakeForm {
  templateActorMappings?: Record<string,string[]>;
  creationProfile?: Record<string,unknown>;
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

function defaultIntake(templateId: string, date: string): IntakeForm {
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

function sleep(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }
function statusLabel(status: CandidateStatus) { return status === 'required' ? '必选' : status === 'excluded' ? '排除' : '可选'; }
function isTerminalResearch(status: ResearchTask['status']) { return TERMINAL_RESEARCH.includes(status); }

/** 候选的三态处理：必选 / 可选 / 排除。 */
function StatusToggle({ value, onChange, lockedLabel }: {
  value: CandidateStatus;
  onChange: (next: CandidateStatus) => void;
  lockedLabel?: string;
}) {
  if (lockedLabel) return <Badge variant="accent" className="text-xs">{lockedLabel}</Badge>;
  return (
    <div role="radiogroup" aria-label="候选处理方式" className="flex flex-wrap gap-1">
      {(['required', 'optional', 'excluded'] as CandidateStatus[]).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={'rounded-[var(--radius-control)] border px-2 py-1 text-xs transition-colors ' +
            (value === option
              ? option === 'excluded' ? 'border-danger bg-danger/10 text-danger-fg' : 'border-accent bg-accent/10 text-accent-dark'
              : 'border-border-default text-muted hover:bg-surface-hover')}
        >
          {statusLabel(option)}
        </button>
      ))}
    </div>
  );
}

function BasisBadge({ basis }: { basis: ResearchCharacterCandidate['basis'] }) {
  return <Badge variant="outline" className={'text-xs ' + (BASIS_CLASS[basis] || '')}>{BASIS_LABEL[basis] || basis}</Badge>;
}

/**
 * 自定义参与者编辑器。
 *
 * 第一步（选模板与角色）与第二步（确认人物）都会用到：
 * 「从空白开始」是页头动作、任何一步都能点，所以添加自定义参与者的入口
 * 不能只放在第二步，否则用户在第一步就加不了人。
 */
function CustomCastEditor({
  members,
  onChange,
}: {
  members: CustomCastMember[];
  onChange: (next: CustomCastMember[]) => void;
}) {
  if (!members.length) return null;
  return (
    <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-muted/40 p-3">
      <p className="text-xs text-muted">
        自定义参与者只在本场活动出现，不会写入角色库。它们没有角色库人设，
        因此不能用于「查资料并推荐」或「生成方案」，只能配合页头的「从空白开始」创建。
      </p>
      {members.map((member, index) => (
        <div key={member.key} className="space-y-2 rounded-lg border border-border-subtle bg-surface p-2">
          <div className="flex items-center gap-2">
            <Input
              aria-label={`自定义参与者 ${index + 1} 名称`}
              value={member.displayName}
              placeholder="角色名称"
              onChange={(event) => onChange(members.map((item) => item.key === member.key ? { ...item, displayName: event.target.value } : item))}
              className="h-8 text-sm"
            />
            <Input
              aria-label={`自定义参与者 ${index + 1} 本场职责`}
              value={member.activityRole}
              placeholder="本场职责"
              onChange={(event) => onChange(members.map((item) => item.key === member.key ? { ...item, activityRole: event.target.value } : item))}
              className="h-8 w-32 text-sm"
            />
            <button
              type="button"
              aria-label={`移除自定义参与者 ${index + 1}`}
              className="text-fg-subtle hover:text-danger-fg"
              onClick={() => onChange(members.filter((item) => item.key !== member.key))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <Input
            aria-label={`自定义参与者 ${index + 1} 身份描述`}
            value={member.identity}
            placeholder="身份描述（会作为人设交给模型）"
            onChange={(event) => onChange(members.map((item) => item.key === member.key ? { ...item, identity: event.target.value } : item))}
            className="h-8 text-sm"
          />
        </div>
      ))}
    </div>
  );
}

export function PlanningWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const client = useQueryClient();
  const initialTemplate = params.get('template') || 'blank';
  const initialDate = params.get('date') || '';
  const initialCharacterIds = (params.get('characters') || '').split(',').map((value) => value.trim()).filter(Boolean);

  const [step, setStep] = useState<StepIndex>(0);
  const [intake, setIntake] = useState<IntakeForm>(() => defaultIntake(initialTemplate, initialDate));
  const [customCast, setCustomCast] = useState<CustomCastMember[]>([]);
  const [creatingBlank, setCreatingBlank] = useState(false);
  const createActivityMutation = useCreateActivity();
  /**
   * 选人时读到的完整快照（含人设与外观引用），供「从空白开始」直接建活动使用。
   * IntakeForm.cast 只保留展示需要的字段，不足以构造正式活动文档。
   */
  const castSnapshotsRef = useRef(new Map<string, ActorSnapshot>());
  const [session, setSession] = useState<ActivityPlanningSessionResponse | null>(null);
  /**
   * 会话的最新版本号。state 更新是异步的，同一串 await 里读 state 会拿到过期版本，
   * 从而在下次 PUT 时撞 409（服务端用版本号做乐观锁）。
   */
  const sessionRef = useRef<ActivityPlanningSessionResponse | null>(null);
  const [research, setResearch] = useState<ResearchTask | null>(null);
  const [customLocations, setCustomLocations] = useState<CustomLocation[]>([]);
  const [plans, setPlans] = useState<ActivityPlanningCandidate[]>([]);
  const [job, setJob] = useState<ActivityPlanningJob | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [planOverride, setPlanOverride] = useState<{ candidateId: string; payload: ActivityPlanningOutput } | null>(null);
  const [planCount, setPlanCount] = useState(3);
  const [revisionNote, setRevisionNote] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editValue, setEditValue] = useState<ActivityPlanningOutput | null>(null);
  const [tab, setTab] = useState<'characters' | 'locations'>('characters');
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [researching, setResearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<'cast' | 'lead' | { match: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importTarget, setImportTarget] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState<ResearchCharacterCandidate | null>(null);
  const [personaOpen, setPersonaOpen] = useState<{ actorId: string; draft: ActivityPlanningPersonaDraft } | null>(null);
  const [personaValue, setPersonaValue] = useState({ displayName: '', work: '', summary: '', personaText: '', baseText: '', defaultOutfitText: '' });
  const [customForm, setCustomForm] = useState({ name: '', note: '' });
  const [inspirationOpen, setInspirationOpen] = useState(false);
  const [references, setReferences] = useState<ReferenceDraft[]>([]);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [referencePreview, setReferencePreview] = useState<{
    snapshot: PlanningKnowledgeSnapshot;
    unresolved: Array<{ sourceKind: string; sourceId: string; reason: string }>;
    truncated: boolean;
  } | null>(null);
  const [recommendOpen, setRecommendOpen] = useState(false);
  const [updateCheckOpen, setUpdateCheckOpen] = useState(false);
  const [gapOpen, setGapOpen] = useState(false);
  const [pendingIdea, setPendingIdea] = useState<{ batch: ActivityIdeaBatch; idea: ActivityIdea } | null>(null);
  const [replaceFields, setReplaceFields] = useState(false);
  const mountedRef = useRef(true);
  /** 已经恢复过（或由本页创建）的会话 id：避免创建会话后又被当成“恢复现场”。 */
  const resumeRef = useRef(false);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const { data: capabilities } = useActivityCapabilities();
  const { data: userPresetsData } = useActivityPresets('activity_template');
  const userTemplates = userPresetsData?.items || [];
  const userTemplateMap = useMemo(() => new Map(userTemplates.map((t) => [t.id, t])), [userTemplates]);
  const maxActors = capabilities?.limits.maxActors ?? 20;
  // 从「待整理」带进来的来源：用返回的快照内容填充参考资料，只引用已保存的内容。
  const refsSeededRef = useRef(false);
  useEffect(() => {
    const raw = params.get('refs');
    if (!raw || refsSeededRef.current) return;
    refsSeededRef.current = true;
    const selections: PlanningReferenceSelection[] = [];
    for (const entry of raw.split(',')) {
      const [kind, id] = entry.split(':');
      if (!id) continue;
      if (kind === 'collection' || kind === 'note' || kind === 'narrative' || kind === 'topic') {
        selections.push({ sourceKind: kind, sourceId: id, usage: 'background' });
      }
    }
    if (!selections.length) return;
    void (async () => {
      try {
        const result = await previewReferences(selections);
        if (!mountedRef.current) return;
        setReferences((current) => {
          const next = [...current];
          for (const reference of result.snapshot.references) {
            const key = reference.sourceKind + ':' + reference.sourceId;
            if (next.some((item) => item.key === key)) continue;
            next.push({
              key,
              sourceKind: reference.sourceKind,
              sourceId: reference.sourceId,
              usage: reference.usage,
              title: reference.title,
              excerpt: reference.excerpt,
              nature: reference.nature,
              authorship: reference.authorship,
              frozenReference: reference,
            });
          }
          return next.slice(0, KNOWLEDGE_MAX_REFERENCES);
        });
        setNotice('已把选中的来源加入参考资料；生成时会以它们为依据。');
      } catch {
        if (mountedRef.current) setError('来源内容读取失败，可以在参考资料里手动搜索添加。');
      }
    })();
  }, [params]);

  const llmReady = capabilities ? (capabilities.llmStatus ? capabilities.llmStatus.ready : capabilities.llm) : null;
  const sourcesQuery = useQuery({ queryKey: ['mcp-sources'], queryFn: fetchMcpSources, staleTime: 30_000 });
  const worksQuery = useQuery({
    queryKey: ['characters', 'works-facets'],
    queryFn: () => browseCharacters({ page: 1, pageSize: 1 }),
    staleTime: 60_000,
  });
  const enabledSources = useMemo(() => (sourcesQuery.data ?? []).filter((source) => source.status === 'enabled'), [sourcesQuery.data]);
  const workOptions = useMemo(() => (worksQuery.data?.facets.works ?? []).map((work) => work.name), [worksQuery.data]);

  const sessionId = session?.session.id ?? null;
  const summaries = session?.summaries ?? [];
  const researchStale = session?.researchStale ?? false;
  const leadName = intake.cast.find((member) => member.characterId === intake.leadCharacterId)?.displayName ?? '';
  const selectedCandidate = plans.find((plan) => plan.id === selectedPlanId) ?? null;
  const activePayload = selectedCandidate
    ? (planOverride && planOverride.candidateId === selectedCandidate.id ? planOverride.payload : selectedCandidate.payload)
    : null;
  const selectedActorIds = new Set([...(activePayload?.actorRoles.map(role => role.actorId) ?? []), ...(activePayload?.stages.flatMap(stage => stage.actorIds) ?? [])]);
  const pendingActors = (session?.pendingActors ?? []).filter(actor => selectedActorIds.has(actor.actorId));
  const runningJob = job?.status === 'queued' || job?.status === 'running';

  const setIntakeField = useCallback(<K extends keyof IntakeForm>(key: K, value: IntakeForm[K]) => {
    setIntake((current) => ({ ...current, [key]: value }));
  }, []);

  const formPayload = useCallback((selection: PlanningSelectionState | null, researchRevisionId: string | null): ActivityPlanningFormExtended => ({
    templateId: intake.templateId,
    creationProfile: intake.creationProfile,
    ...(userTemplateMap.has(intake.templateId)?{templateActorMappings:intake.templateActorMappings||suggestRoleMappings(userTemplateMap.get(intake.templateId)!.payload,intake.cast.map(a=>({id:a.characterId})),intake.leadCharacterId)}:{}),
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
    ...(session?.session.form.inspiration ? { inspiration: session.session.form.inspiration } : {}),
    // 参考资料：提交选中的冻结版本；新选择由服务端预览解析后再用于生成。
    ...(references.length
      ? {
          references: references.map((item) => ({
            sourceKind: item.sourceKind,
            sourceId: item.sourceId,
            usage: item.usage,
            // 固定旧内容的引用带上覆盖摘要，服务端按它冻结快照。
            ...(item.pinnedExcerpt ? { excerptOverride: item.pinnedExcerpt } : {}),
            ...(item.frozenReference ? { frozenReference: item.frozenReference } : {}),
          })),
        }
      : {}),
  }), [intake, references, session, userTemplateMap]);

  const rememberSession = useCallback((id: string) => {
    resumeRef.current = true;
    const next = new URLSearchParams(params.toString());
    next.set('session', id);
    next.delete('characters');
    router.replace('/apps/activities/new?' + next.toString());
  }, [params, router]);

  /** 同时更新会话 state 与版本引用，保证同一串 await 里拿到最新版本。 */
  const applySession = useCallback((next: ActivityPlanningSessionResponse | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  /**
   * 表单变化即同步会话：研究输入与生成依据都以服务端会话为准。
   * 版本冲突时保留页面输入并提示用户，避免覆盖另一处的修改。
   */
  const syncSession = useCallback(async (selection: PlanningSelectionState | null, researchRevisionId: string | null, sessionIdOverride?: string) => {
    const payload = formPayload(selection, researchRevisionId);
    const targetId = sessionIdOverride ?? sessionRef.current?.session.id;
    if (!targetId) {
      const created = await createPlanningSession(payload);
      applySession(created);
      rememberSession(created.session.id);
      return created;
    }
    const updated = await updatePlanningSession(targetId, payload, sessionRef.current?.session.version ?? 1);
    applySession(updated);
    return updated;
  }, [applySession, formPayload, rememberSession]);

  // 从角色日历等入口带入的活动角色：只读取一次，不覆盖用户后续的选择。
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !initialCharacterIds.length) return;
    seededRef.current = true;
    void (async () => {
      try {
        const actors = await Promise.all(initialCharacterIds.map((id) => fetchActivityCharacterSnapshot(id)));
        if (!mountedRef.current) return;
        actors.forEach((actor) => { if (actor.sourceCharacterId) castSnapshotsRef.current.set(String(actor.sourceCharacterId), actor); });
        /*
         * 从角色日历进入时，除了带入角色，还要补上标题与寿星：
         * 这两项原本由已移除的手动表单负责，向导接手后必须一并接过来，
         * 否则「选好寿星 → 建生日活动」会在标题和寿星名单上断掉。
         */
        const names = actors.map((actor) => actor.displayName);
        setIntake((current) => ({
          ...current,
          cast: mergeCast(current.cast, actors, maxActors),
          birthdayIds: current.templateId === 'birthday' ? [...new Set([...current.birthdayIds, ...actors.map((actor) => String(actor.sourceCharacterId))])] : current.birthdayIds,
          /*
           * 措辞与内置生日模板的 activity.type（「生日聚会」）保持一致：
           * 从日历带出的合办活动标题要和模板类型、以及日历上的活动名对得上。
           */
          title: current.title || (names.length ? `${names.join('、')}的生日聚会` : current.title),
        }));
      } catch { /* 带入失败不阻塞：仍可手动选择角色。 */ }
    })();
  }, [initialCharacterIds, maxActors]);

  const pollResearch = useCallback(async (id: string, taskId: string) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const task = await fetchPlanningResearch(id, taskId);
      if (!mountedRef.current) return task;
      setResearch(task);
      if (isTerminalResearch(task.status)) return task;
      await sleep(1500);
    }
    return null;
  }, []);

  const pollJob = useCallback(async (id: string, jobId: string) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const result = await fetchPlanningJob(id, jobId);
      if (!mountedRef.current) return result;
      setJob(result.job);
      if (result.job.status !== 'queued' && result.job.status !== 'running') return result;
      await sleep(1500);
    }
    return null;
  }, []);

  // URL 里带会话 id 时恢复现场：企划会话在服务端存活，刷新后可以继续。
  useEffect(() => {
    const resumeId = params.get('session');
    if (!resumeId || resumeRef.current) return;
    resumeRef.current = true;
    void (async () => {
      try {
        const response = await fetchPlanningSession(resumeId);
        let tasks: ResearchTask[] = [];
        try { tasks = await fetchPlanningResearchTasks(resumeId); } catch { tasks = []; }
        if (!mountedRef.current) return;
        const latest = [...tasks].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
        const restoredCast = response.session.document.actors
          .filter((actor) => actor.sourceCharacterId && response.session.form.characters.some(member => member.characterId === actor.sourceCharacterId))
          .map((actor) => ({
            characterId: String(actor.sourceCharacterId),
            displayName: actor.displayName,
            avatarUrl: actor.avatarUrl,
            activityRole: actor.activityRole,
          }));
        const form = response.session.form;
        setReferences((form.references ?? []).map(selection => {
          const frozen = selection.frozenReference ?? form.knowledgeSnapshot?.references.find(ref => ref.sourceKind === selection.sourceKind && ref.sourceId === selection.sourceId);
          return {
            key: selection.sourceKind + ':' + selection.sourceId,
            sourceKind: selection.sourceKind, sourceId: selection.sourceId, usage: selection.usage,
            title: frozen?.title ?? '已选资料', excerpt: selection.excerptOverride ?? frozen?.excerpt ?? '',
            nature: frozen?.nature, authorship: frozen?.authorship,
            pinnedExcerpt: selection.excerptOverride, frozenReference: frozen,
          };
        }));
        applySession(response);
        setPlans(response.candidates ?? []);
        setJob(response.jobs[0] ?? null);
        setResearch(latest);
        setIntake((current) => ({
          ...current,
          templateActorMappings: form.templateActorMappings,
          creationProfile: form.creationProfile,
          templateId: form.templateId || current.templateId,
          title: form.title || current.title,
          type: form.type || current.type,
          theme: form.theme || current.theme,
          location: form.location || current.location,
          rules: form.rules || current.rules,
          scheduledDate: form.scheduledDate ?? current.scheduledDate,
          instruction: form.instruction ?? current.instruction,
          leadCharacterId: form.leadCharacterId ?? current.leadCharacterId,
          crossoverWorks: form.crossoverWorks ?? current.crossoverWorks,
          unrestrictedWorks: form.unrestrictedWorks === true,
          guestCountPreference: form.guestCountPreference ?? current.guestCountPreference,
          storyScopeNote: form.storyScopeNote ?? current.storyScopeNote,
          cast: current.cast.length ? current.cast : restoredCast,
          birthdayIds: form.birthdayCharacterIds.length ? form.birthdayCharacterIds : current.birthdayIds,
        }));
        const first = response.candidates?.[0];
        setSelectedPlanId(first?.id ?? null);
        try {
          const saved = JSON.parse(localStorage.getItem('planning-edit:' + resumeId) || 'null');
          if (saved?.payload && response.candidates.some(candidate => candidate.id === saved.candidateId)) {
            setPlanOverride(saved); setSelectedPlanId(saved.candidateId);
          }
        } catch { /* 旧草稿不可读时使用服务端方案 */ }
        setStep(response.candidates?.length ? 2 : latest ? 1 : 0);
        setNotice('已恢复上次的企划会话。');
        const activeJob = response.jobs.find(item => item.status === 'queued' || item.status === 'running');
        if (latest && !isTerminalResearch(latest.status)) {
          setResearching(true);
          try { await pollResearch(resumeId, latest.id); applySession(await fetchPlanningSession(resumeId)); }
          finally { if (mountedRef.current) setResearching(false); }
        }
        if (activeJob) {
          setGenerating(true);
          try {
            await pollJob(resumeId, activeJob.id);
            const fresh = await fetchPlanningSession(resumeId);
            if (!mountedRef.current) return;
            applySession(fresh); setPlans(fresh.candidates); setSelectedPlanId(fresh.candidates[0]?.id ?? null);
            if (fresh.candidates.length) setStep(2);
          } finally { if (mountedRef.current) setGenerating(false); }
        }
      } catch {
        if (mountedRef.current) setNotice('未能恢复上次的企划会话，已开始新的会话。');
      }
    })();
  }, [applySession, params, pollResearch, pollJob]);

  const startResearch = async () => {
    setError(null); setNotice(null);
    if (!intake.cast.length) { setError('请先选择至少一位参与角色。'); return; }
    if (!intake.sourceIds.length) { setError('请至少选择一个资料源，或改用「跳过检索，直接构思」。'); return; }
    setResearching(true);
    try {
      const current = await syncSession(session?.session.form.selection ?? null, session?.session.researchRevisionId ?? null);
      const task = await startPlanningResearch(current.session.id, {
        sourceIds: intake.sourceIds,
        userRequest: intake.instruction,
        crossoverWorks: intake.crossoverWorks,
        storyScopeNote: intake.storyScopeNote,
      });
      setResearch(task);
      const finished = await pollResearch(current.session.id, task.id);
      const refreshed = await fetchPlanningSession(current.session.id);
      applySession(refreshed);
      if (finished?.status === 'succeeded' || finished?.status === 'incomplete') setStep(1);
      else if (finished?.status === 'cancelled') setNotice('已取消本次资料检索，可以跳过检索直接构思。');
      else if (finished?.status === 'failed') setError(finished.errorMessage || '资料检索失败，可以跳过检索直接构思。');
      else setNotice('资料检索仍在后台运行，稍后可在「人物与地点」查看结果。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '资料检索失败。');
    } finally { setResearching(false); }
  };

  const skipResearch = async () => {
    setError(null); setNotice(null);
    if (!intake.cast.length) { setError('请先选择至少一位参与角色。'); return; }
    setBusy(true);
    try {
      await syncSession(null, null);
      setResearch(null);
      setCustomLocations([]);
      setStep(1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '建立企划会话失败。');
    } finally { setBusy(false); }
  };

  const cancelResearch = async () => {
    if (!sessionId || !research) return;
    setBusy(true);
    try {
      const task = await cancelPlanningResearch(sessionId, research.id);
      setResearch(task);
      setNotice('已取消本次资料检索。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '取消失败。');
    } finally { setBusy(false); }
  };

  /** 状态改动只在生成时写库，避免每次点击都产生请求。 */
  const buildSelectionPayload = useCallback((task: ResearchTask) => {
    const unsaved = customLocations.filter((location) => !task.locationCandidates.some((candidate) => candidate.id === location.id));
    return {
      characters: task.characterCandidates.map((candidate) => ({
        id: candidate.id,
        status: (candidate.userStatus === 'pending' ? 'optional' : candidate.userStatus) as CandidateStatus,
      })),
      locations: [
        ...task.locationCandidates.map((candidate) => ({
          id: candidate.id,
          status: (candidate.userStatus === 'pending' ? 'optional' : candidate.userStatus) as CandidateStatus,
          locked: Boolean(candidate.locked),
        })),
        ...unsaved.map((location) => ({ id: location.id, status: location.status, locked: location.locked })),
      ],
      addLocations: unsaved.map((location) => ({ id: location.id, name: location.name, note: location.note, status: location.status, locked: location.locked })),
    };
  }, [customLocations]);

  const generatePlans = async (options: { keepExisting?: boolean } = {}) => {
    setError(null); setNotice(null);
    if (!intake.cast.length) { setError('请至少选择一位参与角色。'); setStep(0); return; }
    setGenerating(true);
    try {
      // 先保证会话存在，再按当前候选状态写选择，最后把表单推成与页面一致。
      const current = await syncSession(session?.session.form.selection ?? null, session?.session.researchRevisionId ?? null);
      let selection: PlanningSelectionState | null = current.session.form.selection ?? null;
      if (research && (research.status === 'succeeded' || research.status === 'incomplete')) {
        const saved = await savePlanningResearchSelection(current.session.id, research.id, buildSelectionPayload(research));
        selection = saved.selection;
        setResearch(saved.task);
      }
      // 选择写回后读取新的版本与研究修订，再同步当前表单。
      const fresh = await fetchPlanningSession(current.session.id);
      applySession(fresh);
      const synced = await syncSession(selection, fresh.session.researchRevisionId ?? null, current.session.id);
      selection = synced.session.form.selection ?? selection;
      const instruction = options.keepExisting
        ? [intake.instruction, activePayload ? '请基于以下所选方案进行修改：' + JSON.stringify(activePayload) : '', revisionNote].filter((value) => value.trim()).join('\n') || undefined
        : intake.instruction.trim() || undefined;
      const created = await triggerPlanningJob(current.session.id, {
        ...(instruction ? { instruction } : {}),
        planCount: options.keepExisting ? 1 : planCount,
      });
      setJob(created);
      const finished = await pollJob(current.session.id, created.id);
      const refreshed = await fetchPlanningSession(current.session.id);
      applySession(refreshed);
      if (finished && finished.candidates.length) {
        setPlans((previous) => {
          const merged = options.keepExisting ? [...finished.candidates, ...previous] : finished.candidates;
          return [...new Map(merged.map((plan) => [plan.id, plan])).values()];
        });
        if (options.keepExisting) {
          if (!selectedPlanId && finished.candidates[0]) setSelectedPlanId(finished.candidates[0].id);
          setNotice('已新增一份方案，原有方案仍然保留。');
          setRevisionNote('');
        } else {
          setSelectedPlanId(finished.candidates[0]?.id ?? null);
          setExpandedPlanId(finished.candidates[0]?.id ?? null);
          setPlanOverride(null);
          setStep(2);
          setNotice(finished.job.errorMessage ? '已保留成功的方案；部分方案失败：' + finished.job.errorMessage : '方案已生成，可以逐份对比。');
        }
      } else if (finished?.job.status === 'failed') {
        setError(finished.job.errorMessage || '方案生成失败，请重试。');
      } else if (!finished) {
        setError('生成超时，请稍后重试或刷新页面查看结果。');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '生成方案失败。');
    } finally { setGenerating(false); }
  };

  const retryLastJob = async () => {
    if (!sessionId || !job) return;
    setGenerating(true); setError(null);
    try {
      const queued = await retryPlanningJob(sessionId, job.id);
      setJob(queued);
      const finished = await pollJob(sessionId, queued.id);
      const fresh = await fetchPlanningSession(sessionId);
      applySession(fresh); setPlans(fresh.candidates);
      if (finished?.candidates.length) {
        setSelectedPlanId(finished.candidates[0].id); setStep(2);
        setNotice(finished.job.errorMessage || '已使用原始输入重新生成方案，历史方案仍保留。');
      } else setError(finished?.job.errorMessage || '任务尚未完成，可以刷新页面继续查看。');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '重试失败。'); }
    finally { setGenerating(false); }
  };

  const cancelGeneration = async () => {
    if (!sessionId || !job) return;
    try { setJob(await cancelPlanningJob(sessionId, job.id)); setNotice('已取消生成，已经完成的方案会保留。'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '取消失败。'); }
  };

  const refreshSession = useCallback(async () => {
    if (!session) return;
    const fresh = await fetchPlanningSession(session.session.id);
    applySession(fresh);
    if (fresh.candidates?.length && !plans.length) setPlans(fresh.candidates);
  }, [applySession, session, plans.length]);

  const resolveActor = async (actorId: string, input: ActivityPlanningActorResolveInput) => {
    if (!sessionId) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await resolvePlanningActor(sessionId, actorId, input);
      await refreshSession();
      if (input.mode === 'remove') {
        setNotice(result.affectedStageIds.length
          ? '已从企划中移除该角色，' + result.affectedStageIds.length + ' 个阶段的人物引用已同步更新。'
          : '已从企划中移除该角色。');
      } else if (input.mode === 'persona') {
        setNotice(result.createdCharacterId ? '已把确认后的人设写入本地角色库并匹配到本企划。' : '已完成人设匹配。');
      } else {
        setNotice('已匹配到本地角色快照。');
      }
      void client.invalidateQueries({ queryKey: ['characters'] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '处理待补人设失败。');
    } finally { setBusy(false); }
  };

  const openPersonaDraft = async (actorId: string) => {
    if (!sessionId) return;
    setBusy(true); setError(null);
    try {
      const draft = await fetchPlanningPersonaDraft(sessionId, actorId);
      const persona = draft.persona as Record<string, unknown>;
      const appearance = (persona.appearance && typeof persona.appearance === 'object' ? persona.appearance : {}) as Record<string, unknown>;
      setPersonaValue({
        displayName: draft.displayName,
        work: typeof persona.work === 'string' ? persona.work : '',
        summary: typeof persona.summary === 'string' ? persona.summary : '',
        personaText: typeof persona.personaText === 'string' ? persona.personaText : '',
        baseText: typeof appearance.baseText === 'string' ? appearance.baseText : '',
        defaultOutfitText: typeof appearance.defaultOutfitText === 'string' ? appearance.defaultOutfitText : '',
      });
      setPersonaOpen({ actorId, draft });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '生成人设草稿失败。');
    } finally { setBusy(false); }
  };

  const confirmPersonaDraft = async () => {
    if (!personaOpen) return;
    const base = personaOpen.draft.persona as Record<string, unknown>;
    const displayName = personaValue.displayName.trim() || personaOpen.draft.displayName;
    await resolveActor(personaOpen.actorId, {
      mode: 'persona',
      displayName,
      persona: {
        ...base,
        displayName,
        work: personaValue.work,
        summary: personaValue.summary,
        personaText: personaValue.personaText,
        appearance: { ...(base.appearance as Record<string, unknown> | undefined), baseText: personaValue.baseText, defaultOutfitText: personaValue.defaultOutfitText },
      },
      sourceNote: personaOpen.draft.basisNote,
    });
    setPersonaOpen(null);
  };

  /** 导入角色卡后把新角色加入名单：先读快照，避免把未发布草稿当作已发布版本使用。 */
  const addImportedCharacterToCast = async (characterId: string) => {
    try {
      const actor = await fetchActivityCharacterSnapshot(characterId);
      if (!mountedRef.current) return;
      if (actor.sourceCharacterId) castSnapshotsRef.current.set(String(actor.sourceCharacterId), actor);
      setIntake((current) => ({ ...current, cast: mergeCast(current.cast, [actor], maxActors) }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取导入的角色失败。');
    }
  };

  /**
   * 从话题素材找灵感（向导第一步）：先把点子会填入的标题、主题与要求展示给用户，
   * 再由用户决定是否采用。采用时把灵感来源快照写进企划会话，避免生成一份无关方案。
   */
  const adoptInspiration = async (batch: ActivityIdeaBatch, idea: ActivityIdea, replaceFields: boolean) => {
    setError(null); setNotice(null); setBusy(true);
    try {
      const current = await syncSession(session?.session.form.selection ?? null, session?.session.researchRevisionId ?? null);
      const overrides = replaceFields
        ? { title: idea.name, theme: idea.overview, location: idea.location || intake.location }
        : {};
      const result = await applyIdea(batch.id, idea.id, { sessionId: current.session.id, ...(Object.keys(overrides).length ? { overrides } : {}) });
      const refreshed = await fetchPlanningSession(result.sessionId);
      applySession(refreshed);
      const form = refreshed.session.form;
      setIntake((existing) => ({
        ...existing,
        title: form.title || existing.title,
        theme: form.theme || existing.theme,
        location: form.location || existing.location,
        instruction: form.instruction ?? existing.instruction,
      }));
      setNotice('已采用点子「' + idea.name + '」：' + (replaceFields ? '标题与主题已替换' : '只填空了未填写的标题与主题') + '，灵感来源已写入企划。');
      setInspirationOpen(false);
      setPendingIdea(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '采用点子失败。');
    } finally { setBusy(false); }
  };

  /** 预览实际会送给模型的引用内容：截断情况如实显示。 */
  const previewSelectedReferences = async () => {
    if (!references.length) return;
    setBusy(true); setError(null);
    try {
      const result = await previewReferences(references.map((item) => ({ sourceKind: item.sourceKind, sourceId: item.sourceId, usage: item.usage, excerptOverride: item.pinnedExcerpt, frozenReference: item.frozenReference })));
      setReferencePreview(result);
      setReferences(current => current.map(item => {
        const frozen = result.snapshot.references.find(ref => ref.sourceKind === item.sourceKind && ref.sourceId === item.sourceId);
        return frozen ? { ...item, frozenReference: frozen, excerpt: frozen.excerpt } : item;
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取引用内容失败。');
    } finally { setBusy(false); }
  };

  /** 加入参考资料：同一来源只保留一条，重复添加不产生第二份。 */
  const addReferences = async (items: Array<{ item: KnowledgeSearchItem; usage: PlanningReferenceUsage }>) => {
    try {
      const result = await previewReferences(items.map(({ item, usage }) => ({ sourceKind: (item.kind === 'note' ? 'note' : 'narrative'), sourceId: item.id, usage })));
      addAssistantReferences(result.snapshot.references.map(reference => ({ ...reference, frozenReference: reference })));
    } catch (caught) { setError(caught instanceof Error ? caught.message : '读取引用内容失败。'); }

  };

  /** 把助手解析出来的引用草稿加入参考资料：同一来源只保留一条。 */
  const addAssistantReferences = (items: AssistantSelection[]) => {
    setReferences((current) => {
      const next = [...current];
      for (const item of items) {
        const key = item.sourceKind + ':' + item.sourceId;
        if (next.some((entry) => entry.key === key)) continue;
        next.push({
          key,
          sourceKind: item.sourceKind,
          sourceId: item.sourceId,
          usage: item.usage,
          title: item.title,
          excerpt: item.excerpt,
          ...(item.nature ? { nature: item.nature } : {}),
          ...(item.authorship ? { authorship: item.authorship } : {}),
          frozenReference: item.frozenReference,
        });
      }
      return next.slice(0, KNOWLEDGE_MAX_REFERENCES);
    });
    setNotice('已加入参考资料；生成时会以它们为依据。');
  };

  /** 继续使用旧内容：把生成时用的旧摘要固定成引用覆盖内容。 */
  const pinOldReference = (referenceId: string, excerpt: string) => {
    const reference = session?.session.form.knowledgeSnapshot?.references.find((item) => item.id === referenceId);
    if (!reference) return;
    setReferences((current) => current.map((entry) => (
      entry.sourceKind === reference.sourceKind && entry.sourceId === reference.sourceId
        ? { ...entry, pinnedExcerpt: excerpt, frozenReference: reference }
        : entry
    )));
    setNotice('已固定为旧内容；下次生成会使用这份摘要。');
  };

  const refreshReference = async (referenceId: string, currentSourceId?: string) => {
    const reference = session?.session.form.knowledgeSnapshot?.references.find(item => item.id === referenceId);
    if (!reference || reference.externalSource) return;
    const result = await previewReferences([{ sourceKind: reference.sourceKind, sourceId: currentSourceId ?? reference.sourceId, usage: reference.usage }]);
    const fresh = result.snapshot.references[0];
    if (!fresh) throw new Error('来源已不可用，可以继续使用旧内容。');
    setReferences(current => current.map(entry => entry.sourceKind === reference.sourceKind && entry.sourceId === reference.sourceId
      ? { ...entry, key: fresh.sourceKind + ':' + fresh.sourceId, sourceId: fresh.sourceId, frozenReference: fresh, pinnedExcerpt: undefined, excerpt: fresh.excerpt, title: fresh.title } : entry));
    setNotice('已选择更新这一条参考；重新生成后生效。');
  };

  const createActivity = async () => {
    if (!session || !selectedCandidate || !activePayload) return;
    setBusy(true); setError(null);
    try {
      const selectedDocument = { ...session.session.document, actors: session.session.document.actors.filter(actor => !actor.candidateRefId || selectedActorIds.has(actor.id)) };
      const finalDocument = applyPlanningOutput(selectedDocument, activePayload);
      const result = await createActivityFromPlanningSession(session.session.id, finalDocument, {
        candidateId: selectedCandidate.id,
        idempotencyKey: 'create_' + session.session.id,
      });
      void client.invalidateQueries({ queryKey: activityKeys.all });
      router.push('/apps/activities/' + result.activity.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建活动失败。');
    } finally { setBusy(false); }
  };

  const toggleWork = (work: string) => setIntake((current) => ({
    ...current,
    crossoverWorks: current.crossoverWorks.includes(work) ? current.crossoverWorks.filter((item) => item !== work) : [...current.crossoverWorks, work],
  }));

  /**
   * 把「角色库角色 + 自定义参与者」合成建活动用的 ActorSnapshot 列表。
   *
   * 角色库角色直接用选人时读到的快照（保留人设与外观引用），
   * 自定义参与者现场构造一份最小人设。两者都要给出稳定 id，
   * 因为阶段与必达事件的 actorIds 由 buildActivityDocument 按这些 id 生成。
   */
  const buildBlankActors = (): ActorSnapshot[] => {
    const fromLibrary = intake.cast.map((member) => {
      const snapshot = castSnapshotsRef.current.get(member.characterId);
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
  };

  /**
   * 从空白开始：跳过检索与方案生成，直接用当前模板与参与者建立活动。
   *
   * 这条路径不经过企划会话，因此服务端不会校验「提交角色与会话快照一致」，
   * 自定义参与者才能被带进正式活动。代价是没有方案对比与规划依据。
   */
  const createBlankActivity = async () => {
    setError(null); setNotice(null);
    const actors = buildBlankActors();
    if (!actors.length) { setError('请先选择至少一位参与角色，或添加自定义参与者。'); return; }
    const title = intake.title.trim() || '未命名活动';
    setCreatingBlank(true);
    try {
      /*
       * birthdayIds 存的是角色 id，而 buildActivityDocument 的 birthdayActorIds
       * 要的是 actor id；快照的 actor id 由服务端随机生成，两者不能混用，
       * 否则会被它的 filter 静默丢弃、寿星名单为空。
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
      const result = await createActivityMutation.mutateAsync({ document });
      router.push('/apps/activities/' + result.activity.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建活动失败。');
    } finally { setCreatingBlank(false); }
  };

  const handleEvidence = (candidate: ResearchCharacterCandidate) => setEvidenceOpen(candidate);
  const evidenceFor = (ids: string[]): ResearchEvidence[] => (research?.evidence ?? []).filter((item) => ids.includes(item.id));

  const setCandidateStatus = (candidateId: string, status: CandidateStatus) => {
    setResearch((current) => current ? {
      ...current,
      characterCandidates: current.characterCandidates.map((candidate) => candidate.id === candidateId ? { ...candidate, userStatus: status } : candidate),
    } : current);
  };
  const setLocationStatus = (candidateId: string, status: CandidateStatus) => {
    setResearch((current) => current ? {
      ...current,
      locationCandidates: current.locationCandidates.map((candidate) => candidate.id === candidateId ? { ...candidate, userStatus: status } : candidate),
    } : current);
  };
  const lockLocation = (candidateId: string) => {
    if (customLocations.some((location) => location.id === candidateId)) {
      setCustomLocations((current) => current.map((location) => ({ ...location, locked: location.id === candidateId ? !location.locked : false })));
      return;
    }
    setResearch((current) => current ? {
      ...current,
      locationCandidates: current.locationCandidates.map((candidate) => ({ ...candidate, locked: candidate.id === candidateId ? !candidate.locked : false })),
    } : current);
  };
  const lockedLocationName = useMemo(() => {
    const id = research?.locationCandidates.find((candidate) => candidate.locked)?.id ?? customLocations.find((location) => location.locked)?.id ?? null;
    if (!id) return null;
    return research?.locationCandidates.find((candidate) => candidate.id === id)?.name ?? customLocations.find((location) => location.id === id)?.name ?? null;
  }, [research, customLocations]);

  const openPlanEditor = () => {
    if (!activePayload) return;
    setEditValue(JSON.parse(JSON.stringify(activePayload)) as ActivityPlanningOutput);
    setEditOpen(true);
  };
  const savePlanEdit = () => {
    if (!selectedCandidate || !editValue) return;
    const override = { candidateId: selectedCandidate.id, payload: editValue };
    setPlanOverride(override);
    try { localStorage.setItem('planning-edit:' + sessionId, JSON.stringify(override)); } catch { /* 本地存储不可用时保留当前页面草稿 */ }
    setEditOpen(false);
  };
  const updateEditActivity = (key: keyof ActivityPlanningOutput['activity'], value: string) => setEditValue((current) => current ? { ...current, activity: { ...current.activity, [key]: value } } : current);
  const updateEditStage = (index: number, key: 'title' | 'location' | 'description' | 'endCondition', value: string) =>
    setEditValue((current) => current ? { ...current, stages: current.stages.map((stage, stageIndex) => stageIndex === index ? { ...stage, [key]: value } : stage) } : current);

  const summaryFor = (candidate: ActivityPlanningCandidate): PlanningCandidateSummary | null => summaries.find((summary) => summary.id === candidate.id) ?? null;
  const actorName = (actorId: string) => session?.session.document.actors.find((actor) => actor.id === actorId)?.displayName ?? actorId;

  /** 本次生成冻结的引用快照：方案依据从这里取，不从当前笔记重算。 */
  const snapshotReferences = session?.session.form.knowledgeSnapshot?.references ?? [];
  /** 一份方案实际标注的依据。 */
  const basisFor = (payload: ActivityPlanningOutput) => {
    const ids = new Set<string>([
      ...(payload.activity.referenceIds ?? []),
      ...payload.actorRoles.flatMap((role) => role.referenceIds ?? []),
      ...payload.stages.flatMap((stage) => stage.referenceIds ?? []),
    ]);
    return snapshotReferences.filter((item) => ids.has(item.id));
  };
  const stepsDone = (index: StepIndex) => index === 0 ? Boolean(sessionId) : index === 1 ? plans.length > 0 : index === 2 ? Boolean(selectedPlanId) : false;

  return (
    <div className="w-full bg-paper py-6 text-ink">
      <PageContainer className="space-y-4">
        <PageHeader
          backHref="/apps/activities"
          backLabel="返回活动列表"
          title="新建活动"
          description="先确定活动意图，再检索资料、确认人物与地点，最后对比方案并创建。"
          actions={<Button size="sm" variant="outline" disabled={busy || creatingBlank || generating || researching} onClick={() => void createBlankActivity()}>{creatingBlank ? '正在创建…' : '从空白开始'}</Button>}
        />

        <nav aria-label="企划步骤" className="flex flex-wrap items-center gap-2">
          {STEPS.map((label, index) => {
            const value = index as StepIndex;
            const reachable = value <= step || stepsDone(value);
            return (
              <button
                key={label}
                type="button"
                disabled={!reachable || generating || researching}
                aria-current={step === value ? 'step' : undefined}
                onClick={() => { if (reachable) setStep(value); }}
                className={'inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm transition-colors ' +
                  (step === value ? 'border-accent bg-accent/10 font-semibold text-accent-dark'
                    : reachable ? 'border-border-default text-muted hover:bg-surface-hover' : 'border-border-subtle text-fg-subtle opacity-60')}
              >
                <span className={'flex h-5 w-5 items-center justify-center rounded-full text-xs ' + (stepsDone(value) && step !== value ? 'bg-green-100 text-green-700' : 'bg-ink/8')}>
                  {stepsDone(value) && step !== value ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                {label}
              </button>
            );
          })}
        </nav>

        {error && <Alert variant="danger" title="操作未完成">{error}</Alert>}
        {notice && <Alert variant="info">{notice}</Alert>}
        {job && !generating && (job.status === 'failed' || job.status === 'cancelled' || (job.status === 'succeeded' && job.errorMessage)) && <Button size="sm" variant="outline" onClick={() => void retryLastJob()}><RefreshCw className="h-3.5 w-3.5" />按原始输入重试此批方案</Button>}

        {step === 0 && (
          <WorkbenchColumns
            left={(
              <>
                <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Compass className="h-4 w-4 text-accent" />活动意图</h3>
                  <label className="block space-y-1.5">
                    <span className="text-xs text-muted">活动模板</span>
                    <Select aria-label="活动模板" value={intake.templateId} onChange={(event) => {
                      const selectedId = event.target.value;
                      const userPreset = userTemplateMap.get(selectedId);
                      if (userPreset) {
                        const payload = (userPreset.payload || {}) as {
                          activityType?: string;
                          theme?: string;
                          location?: string;
                          rules?: string;
                        };
                        setIntake((current) => ({
                          ...current,
                          templateActorMappings: undefined,
                          templateId: userPreset.id,
                          type: payload.activityType || '自定义活动',
                          theme: payload.theme || '',
                          location: payload.location || '',
                          rules: payload.rules || '',
                        }));
                        return;
                      }
                      const next = findActivityTemplate(selectedId) || findActivityTemplate('blank')!;
                      setIntake((current) => ({ ...current, templateId: next.id, type: next.type, theme: next.theme, location: next.location, rules: next.rules }));
                    }}>
                      <optgroup label="内置模板">
                        {ACTIVITY_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </optgroup>
                      {userTemplates.length > 0 && (
                        <optgroup label="我的模板">
                          {userTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </optgroup>
                      )}
                    </Select>
                    <CreationProfilePicker value={intake.creationProfile} allowDefault={!params.get('session')} onChange={value=>setIntake(current=>({...current,creationProfile:value,instruction:current.instruction===String((current.creationProfile?.values as Record<string,unknown>)?.instruction||'')?String((value.values as Record<string,unknown>)?.instruction||''):current.instruction}))}/>
                    {userTemplateMap.has(intake.templateId)&&<TemplateRoleMapping payload={userTemplateMap.get(intake.templateId)!.payload} actors={intake.cast.map(a=>({id:a.characterId,displayName:a.displayName}))} value={intake.templateActorMappings||suggestRoleMappings(userTemplateMap.get(intake.templateId)!.payload,intake.cast.map(a=>({id:a.characterId})),intake.leadCharacterId)} onChange={value=>setIntakeField('templateActorMappings',value)}/>}

                  </label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="space-y-1.5 sm:col-span-2">
                      <span className="text-xs font-semibold text-ink">活动标题</span>
                      <Input aria-label="活动标题" value={intake.title} onChange={(event) => setIntakeField('title', event.target.value)} placeholder="例如：海边营地烧烤与合照日" />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-semibold text-ink">活动日期（可选）</span>
                      <Input aria-label="活动日期" type="date" value={intake.scheduledDate} onChange={(event) => setIntakeField('scheduledDate', event.target.value)} />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-semibold text-ink">人数偏好</span>
                      <Input aria-label="人数偏好" type="number" min={2} max={50} value={intake.guestCountPreference} onChange={(event) => setIntakeField('guestCountPreference', Math.max(2, Math.min(50, Number(event.target.value) || 6)))} />
                    </label>
                    <label className="space-y-1.5 sm:col-span-2">
                      <span className="text-xs font-semibold text-ink">活动主题与梗概</span>
                      <Input aria-label="活动主题与梗概" value={intake.theme} onChange={(event) => setIntakeField('theme', event.target.value)} placeholder="如：夏日傍晚布置灯串与长桌，共进晚餐并拍照留念" />
                    </label>
                    <label className="space-y-1.5 sm:col-span-2">
                      <span className="text-xs font-semibold text-ink">活动地点</span>
                      <Input aria-label="活动地点" value={intake.location} onChange={(event) => setIntakeField('location', event.target.value)} />
                    </label>
                  </div>
                  <details>
                    <summary className="cursor-pointer text-sm text-muted">活动规则与导演约束（可选）</summary>
                    <Textarea aria-label="活动规则" value={intake.rules} rows={2} className="mt-2" onChange={(event) => setIntakeField('rules', event.target.value)} />
                  </details>
                </section>

                <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Users className="h-4 w-4 text-accent" />主角与参与角色</h3>
                      <p className="text-xs text-muted">主角是检索人物关系的锚点；候选人物与地点会在下一步确认。</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setPickerTarget('lead'); setPickerOpen(true); }}><Sparkles className="h-3.5 w-3.5" />选择主角</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setPickerTarget('cast'); setPickerOpen(true); }}><Plus className="h-3.5 w-3.5" />添加参与角色</Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={intake.cast.length + customCast.length >= maxActors}
                        onClick={() => setCustomCast((current) => [...current, {
                          key: `actor_custom_${Date.now().toString(36)}_${current.length + 1}`,
                          displayName: '',
                          activityRole: '参与者',
                          identity: '只在本场活动出现的临时角色',
                          outfitDescription: '日常便服',
                        }])}
                      ><Plus className="h-3.5 w-3.5" />自定义参与者</Button>
                    </div>
                  </div>
                  {!intake.cast.length && <p className="text-sm text-muted">还没有参与角色，请先从角色库选择主角。</p>}
                  <ul className="space-y-1.5">
                    {intake.cast.map((member) => (
                      <li key={member.characterId} className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface p-2">
                        <div className="relative flex h-9 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-hover text-xs font-semibold text-ink">
                          {member.avatarUrl ? <Image src={member.avatarUrl} alt="" fill unoptimized className="object-cover" /> : member.displayName.slice(0, 1)}
                        </div>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{member.displayName}</span>
                        {member.characterId === intake.leadCharacterId
                          ? <Badge variant="accent" className="text-xs">主角</Badge>
                          : <Button size="sm" variant="ghost" onClick={() => setIntakeField('leadCharacterId', member.characterId)}>设为主角</Button>}
                        {intake.templateId === 'birthday' && (
                          <label className="flex items-center gap-1.5 text-xs text-muted">
                            <input
                              type="checkbox"
                              checked={intake.birthdayIds.includes(member.characterId)}
                              onChange={(event) => setIntake((current) => ({
                                ...current,
                                birthdayIds: event.target.checked ? [...new Set([...current.birthdayIds, member.characterId])] : current.birthdayIds.filter((id) => id !== member.characterId),
                              }))}
                            />
                            寿星
                          </label>
                        )}
                        <button type="button" aria-label={'移除 ' + member.displayName} className="shrink-0 text-fg-subtle hover:text-danger-fg" onClick={() => setIntake((current) => ({
                          ...current,
                          cast: current.cast.filter((item) => item.characterId !== member.characterId),
                          birthdayIds: current.birthdayIds.filter((id) => id !== member.characterId),
                          leadCharacterId: current.leadCharacterId === member.characterId ? '' : current.leadCharacterId,
                        }))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <CustomCastEditor members={customCast} onChange={setCustomCast} />
                </section>
              </>
            )}
            right={(
              <>
               <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                 <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Sparkles className="h-4 w-4 text-accent" />补充要求</h3>
               {/* 从话题素材找灵感：复用素材库筛选，采用后把灵感来源写进企划。 */}
                {/* 参考资料：手动检索选择，不触发联网；正文由服务端在生成时冻结。 */}
                <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><BookOpen className="h-4 w-4 text-accent" />参考资料（{references.length}）</h3>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setReferencePickerOpen(true)}><Plus className="h-3.5 w-3.5" />添加资料</Button>
                      <Button size="sm" variant="outline" onClick={() => setRecommendOpen(true)} disabled={!intake.cast.length}>推荐资料</Button>
                      <Button size="sm" variant="outline" onClick={() => setGapOpen(true)} disabled={!sessionId}>补充搜集</Button>
                      <Button size="sm" variant="ghost" onClick={() => setUpdateCheckOpen(true)} disabled={!session?.session.form.knowledgeSnapshot}>检查资料更新</Button>
                      {!!references.length && (
                        <Button size="sm" variant="ghost" onClick={() => void previewSelectedReferences()}>查看本次引用</Button>
                      )}
                    </div>
                  </div>
                  {!references.length && (
                    <p className="text-xs text-muted">还没有选择资料。可以只写要求交给模型，也可以先挑几篇资料作为依据。</p>
                  )}
                  <ul className="space-y-1.5">
                    {references.map((item) => (
                      <li key={item.key} className="space-y-1 rounded-lg border border-border-subtle p-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{item.title}</span>
                          <Badge variant="outline" className="text-xs">{item.sourceKind === 'note' ? '资料' : item.sourceKind === 'narrative' ? '叙事档案' : item.sourceKind === 'topic' ? '话题素材' : '搜集来源'}</Badge>
                          {item.nature && <Badge variant="secondary" className="text-xs">{natureLabels[item.nature as keyof typeof natureLabels] ?? item.nature}</Badge>}
                          {item.pinnedExcerpt && <Badge variant="warning" className="text-xs">已固定旧内容</Badge>}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Select
                            aria-label={'引用用途 ' + item.title}
                            value={item.usage}
                            className="h-7 text-xs"
                            onChange={(event) => setReferences((current) => current.map((entry) => entry.key === item.key ? { ...entry, usage: event.target.value as PlanningReferenceUsage } : entry))}
                          >
                            <option value="background">背景参考</option>
                            <option value="requirement">本次要求</option>
                          </Select>
                          <button type="button" aria-label={'移除 ' + item.title} className="text-fg-subtle hover:text-danger-fg" onClick={() => setReferences((current) => current.filter((entry) => entry.key !== item.key))}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted">背景参考按原作资料与未确认解释分开提交；「本次要求」优先于资料内容。未选择的资料不会被悄悄加入。</p>
                </section>
                <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Lightbulb className="h-4 w-4 text-accent" />从话题素材找灵感</h3>
                  <p className="text-xs text-muted">
                    {intake.cast.length
                      ? '从已搜集的话题素材里选几条让模型给出活动点子，再决定是否采用；不会重新搜集。'
                      : '请先选择主角：采用点子会写入企划会话，需要先有一位参与角色。'}
                  </p>
                  <Button
                    variant="outline"
                    disabled={busy || !intake.cast.length}
                    title={intake.cast.length ? undefined : '请先选择主角'}
                    onClick={() => setInspirationOpen(true)}
                  >
                    <Lightbulb className="h-3.5 w-3.5" />打开话题素材
                  </Button>
                  {!intake.cast.length && <p className="text-xs text-amber-700">也可以先去「话题素材库」页面独立挑素材、生成点子。</p>}
                </section>
                  <Textarea
                    aria-label="补充要求"
                    rows={4}
                    value={intake.instruction}
                    placeholder="例如：想在天台准备惊喜，希望每位寿星都有单独的祝福环节。"
                    onChange={(event) => setIntakeField('instruction', event.target.value)}
                  />
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-ink">剧情范围说明</span>
                    <Textarea aria-label="剧情范围说明" rows={2} value={intake.storyScopeNote} placeholder="如：只使用主线已公开的剧情，不涉及后续章节。" onChange={(event) => setIntakeField('storyScopeNote', event.target.value)} />
                  </label>
                </section>

                <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                  <div>
                    <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Link2 className="h-4 w-4 text-accent" />联动范围</h3>
                    <p className="text-xs text-muted">选择允许联动的作品，检索与人物推荐会限制在这些范围内。</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={intake.unrestrictedWorks} onChange={(event) => setIntakeField('unrestrictedWorks', event.target.checked)} />
                    不限制作品范围
                  </label>
                  {!intake.unrestrictedWorks && (
                    <div className="space-y-2">
                      {workOptions.length ? (
                        <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border-subtle p-2">
                          {workOptions.map((work) => (
                            <label key={work} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={intake.crossoverWorks.includes(work)} onChange={() => toggleWork(work)} />
                              <span className="truncate">{work}</span>
                            </label>
                          ))}
                        </div>
                      ) : <p className="text-xs text-muted">角色库里还没有作品记录，可以直接输入作品名。</p>}
                      <Input
                        aria-label="添加联动作品"
                        placeholder="输入作品名后回车"
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          const value = event.currentTarget.value.trim();
                          if (value && !intake.crossoverWorks.includes(value)) setIntakeField('crossoverWorks', [...intake.crossoverWorks, value]);
                          event.currentTarget.value = '';
                        }}
                      />
                      {!!intake.crossoverWorks.length && (
                        <div className="flex flex-wrap gap-1.5">
                          {intake.crossoverWorks.map((work) => (
                            <button key={work} type="button" className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent-dark" onClick={() => toggleWork(work)}>
                              {work}<X className="h-3 w-3" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </section>

                <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Search className="h-4 w-4 text-accent" />资料源</h3>
                    <a href={MCP_SETTINGS_HREF} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">配置资料源<ExternalLink className="h-3 w-3" /></a>
                  </div>
                  {sourcesQuery.isLoading && <Spinner size="sm" label="正在读取资料源…" />}
                  {sourcesQuery.isError && <p className="text-xs text-amber-700">暂时无法读取资料源列表；不选择资料源时请使用「跳过检索，直接构思」。</p>}
                  {!sourcesQuery.isLoading && !enabledSources.length && (
                    <p className="text-xs text-muted">还没有启用的资料源。可以先去配置，或跳过检索直接构思。</p>
                  )}
                  {!!enabledSources.length && (
                    <div className="space-y-1.5">
                      {enabledSources.map((source) => (
                        <label key={source.id} className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={intake.sourceIds.includes(source.id)}
                            onChange={(event) => setIntake((current) => ({
                              ...current,
                              sourceIds: event.target.checked ? [...new Set([...current.sourceIds, source.id])] : current.sourceIds.filter((id) => id !== source.id),
                            }))}
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-ink">{source.name}</span>
                            <span className="block truncate text-xs text-muted">{source.purpose || source.url}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                  {llmReady === false && <Alert variant="warning" title="文本模型未就绪">方案生成需要文本模型，请先前往 <a className="underline" href={MCP_SETTINGS_HREF} target="_blank" rel="noreferrer">公共服务配置</a>。</Alert>}
                </section>
              </>
            )}
          />
        )}

        {step === 1 && (
          <WorkbenchColumns
            left={(
              <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                <PageTabs
                  ariaLabel="人物与地点"
                  value={tab}
                  onChange={(value) => setTab(value === 'locations' ? 'locations' : 'characters')}
                  tabs={[
                    { id: 'characters', label: '人物', count: research ? research.characterCandidates.length : intake.cast.length },
                    { id: 'locations', label: '地点', count: research ? research.locationCandidates.length : 0 },
                  ]}
                />

                {tab === 'characters' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-ink">已选参与角色（{intake.cast.length}）</h4>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => { setPickerTarget('cast'); setPickerOpen(true); }}><UserPlus className="h-3.5 w-3.5" />从角色库添加</Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={intake.cast.length + customCast.length >= maxActors}
                            onClick={() => setCustomCast((current) => [...current, {
                              key: `actor_custom_${Date.now().toString(36)}_${current.length + 1}`,
                              displayName: '',
                              activityRole: '参与者',
                              identity: '只在本场活动出现的临时角色',
                              outfitDescription: '日常便服',
                            }])}
                          ><Plus className="h-3.5 w-3.5" />添加自定义参与者</Button>
                        </div>
                      </div>
                      <ul className="space-y-1.5">
                        {intake.cast.map((member) => (
                          <li key={member.characterId} className="flex items-center gap-2 rounded-lg border border-border-subtle p-2 text-sm">
                            <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
                            {member.characterId === intake.leadCharacterId
                              ? <Badge variant="accent" className="text-xs">主角 · 固定必选</Badge>
                              : <Badge variant="outline" className="text-xs">必选</Badge>}
                            {member.characterId !== intake.leadCharacterId && (
                              <button type="button" aria-label={'移除 ' + member.displayName} className="text-fg-subtle hover:text-danger-fg" onClick={() => setIntake((current) => ({ ...current, cast: current.cast.filter((item) => item.characterId !== member.characterId) }))}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>

                      <CustomCastEditor members={customCast} onChange={setCustomCast} />
                    </div>

                    <div className="space-y-2 border-t border-border-subtle pt-3">
                      <h4 className="text-sm font-semibold text-ink">检索推荐人物</h4>
                      {!research && <p className="text-sm text-muted">本次没有发起资料检索，将只使用已选角色生成方案；可以返回上一步补充检索。</p>}
                      {research?.status === 'running' && <Spinner size="sm" label={research.progressLabel || '正在检索资料…'} />}
                      {research?.status === 'failed' && <Alert variant="warning" title="资料检索失败">{research.errorMessage || '未知原因'}。仍可用已选角色继续。</Alert>}
                      {research?.status === 'incomplete' && <Alert variant="warning" title="资料检索未完成">{research.incompleteReason || '已达到检索预算'}，下面只列出已取得的候选。</Alert>}
                      {research && !research.characterCandidates.length && isTerminalResearch(research.status) && <p className="text-sm text-muted">没有检索到可推荐的人物候选。</p>}
                      <ul className="space-y-2">
                        {(research?.characterCandidates ?? []).map((candidate) => {
                          const status = (candidate.userStatus === 'pending' ? 'optional' : candidate.userStatus) as CandidateStatus;
                          const isLead = Boolean(leadName) && candidate.displayName === leadName;
                          return (
                            <li key={candidate.id} className="space-y-2 rounded-lg border border-border-subtle p-3">
                              <div className="flex items-start gap-3">
                                <div className="relative flex h-11 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-hover text-sm font-semibold">
                                  {candidate.avatarUrl ? <Image src={candidate.avatarUrl} alt="" fill unoptimized className="object-cover" /> : candidate.displayName.slice(0, 1)}
                                </div>
                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="truncate text-sm font-semibold text-ink">{candidate.displayName}</span>
                                    {candidate.work && <span className="truncate text-xs text-muted">《{candidate.work}》</span>}
                                    <BasisBadge basis={candidate.basis} />
                                    {candidate.localMatchStatus === 'unique' && <Badge variant="outline" className="text-xs">角色库已有</Badge>}
                                    {candidate.localMatchStatus === 'multiple' && <Badge variant="warning" className="text-xs">角色库有 {candidate.localCharacterIds?.length ?? 2} 张同名卡</Badge>}
                                    {candidate.localMatchStatus === 'none' && <Badge variant="outline" className="text-xs">尚未入库</Badge>}
                                  </div>
                                  <p className="text-xs text-muted">推荐原因：{candidate.reason}</p>
                                  {candidate.relationshipToLead && <p className="text-xs text-muted">关系依据：{candidate.relationshipToLead}</p>}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <StatusToggle
                                  value={status}
                                  lockedLabel={isLead ? '主角 · 固定必选' : undefined}
                                  onChange={(next) => setCandidateStatus(candidate.id, next)}
                                />
                                {!!candidate.evidenceIds.length && (
                                  <Button size="sm" variant="ghost" onClick={() => handleEvidence(candidate)}><FileText className="h-3.5 w-3.5" />查看依据（{candidate.evidenceIds.length}）</Button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                )}

                {tab === 'locations' && (
                  <div className="space-y-3">
                    {!research && <p className="text-sm text-muted">本次没有检索到地点候选，可以自行填写活动地点。</p>}
                    <ul className="space-y-2">
                      {(research?.locationCandidates ?? []).map((candidate) => {
                        const status = (candidate.userStatus === 'pending' ? 'optional' : candidate.userStatus) as CandidateStatus;
                        return (
                          <li key={candidate.id} className="space-y-2 rounded-lg border border-border-subtle p-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-semibold text-ink">{candidate.name}</span>
                              {candidate.work && <span className="text-xs text-muted">《{candidate.work}》</span>}
                              <BasisBadge basis={candidate.basis} />
                              {candidate.locked && <Badge variant="accent" className="text-xs">主要地点</Badge>}
                            </div>
                            {candidate.environment && <p className="text-xs text-muted">环境：{candidate.environment}</p>}
                            {candidate.reasonForActivity && <p className="text-xs text-muted">适合理由：{candidate.reasonForActivity}</p>}
                            <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
                              <p><span className="font-medium text-ink">原作依据：</span>{candidate.originalBasis || '—'}</p>
                              <p><span className="font-medium text-ink">本次安排：</span>{candidate.activityArrangement || '—'}</p>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <StatusToggle value={status} onChange={(next) => setLocationStatus(candidate.id, next)} />
                              <Button size="sm" variant={candidate.locked ? 'primary' : 'outline'} onClick={() => lockLocation(candidate.id)}>
                                <Lock className="h-3.5 w-3.5" />{candidate.locked ? '取消主要地点' : '设为主要地点'}
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    <div className="space-y-2 rounded-lg border border-dashed border-border-default p-3">
                      <h4 className="flex items-center gap-2 text-sm font-semibold text-ink"><MapPin className="h-4 w-4 text-accent" />自行填写地点</h4>
                      {!!customLocations.length && (
                        <ul className="space-y-2">
                          {customLocations.map((location) => (
                            <li key={location.id} className="space-y-2 rounded-lg border border-border-subtle p-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-semibold text-ink">{location.name}</span>
                                <Badge variant="outline" className="text-xs">用户设定</Badge>
                                {location.locked && <Badge variant="accent" className="text-xs">主要地点</Badge>}
                              </div>
                              {location.note && <p className="text-xs text-muted">{location.note}</p>}
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <StatusToggle value={location.status} onChange={(next) => setCustomLocations((current) => current.map((item) => item.id === location.id ? { ...item, status: next } : item))} />
                                <div className="flex gap-2">
                                  <Button size="sm" variant={location.locked ? 'primary' : 'outline'} onClick={() => lockLocation(location.id)}><Lock className="h-3.5 w-3.5" />{location.locked ? '取消主要地点' : '设为主要地点'}</Button>
                                  <button type="button" aria-label={'删除 ' + location.name} className="text-fg-subtle hover:text-danger-fg" onClick={() => setCustomLocations((current) => current.filter((item) => item.id !== location.id))}><Trash2 className="h-3.5 w-3.5" /></button>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input aria-label="自定义地点名称" placeholder="地点名称" value={customForm.name} onChange={(event) => setCustomForm((current) => ({ ...current, name: event.target.value }))} />
                        <Input aria-label="自定义地点说明" placeholder="说明（可选）" value={customForm.note} onChange={(event) => setCustomForm((current) => ({ ...current, note: event.target.value }))} />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!customForm.name.trim() || customLocations.length >= 5}
                        onClick={() => {
                          const name = customForm.name.trim().slice(0, 60);
                          if (!name) return;
                          setCustomLocations((current) => [...current, { id: 'user_loc_' + crypto.randomUUID(), name, note: customForm.note.trim().slice(0, 300), status: 'optional', locked: false }]);
                          setCustomForm({ name: '', note: '' });
                        }}
                      >
                        <Plus className="h-3.5 w-3.5" />添加地点
                      </Button>
                      <p className="text-xs text-muted">自填地点会标记为「用户设定」，最多 5 个；主要地点只能有一个。生成方案时会一并保存。</p>
                    </div>
                  </div>
                )}
              </section>
            )}
            right={(
              <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Wand2 className="h-4 w-4 text-accent" />生成方案</h3>
                <p className="text-xs text-muted">必选的人物会进入方案，排除的候选不会被使用；设为「主要地点」的会作为方案首选场地。</p>
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-ink">生成数量</span>
                  <Select aria-label="生成方案数量" value={String(planCount)} onChange={(event) => setPlanCount(Number(event.target.value))}>
                    <option value="1">1 份</option>
                    <option value="2">2 份</option>
                    <option value="3">3 份（推荐）</option>
                  </Select>
                </label>
                <div className="space-y-1 text-xs text-muted">
                  <p>已选参与角色：{intake.cast.length} 位</p>
                  <p>推荐必选：{(research?.characterCandidates ?? []).filter((candidate) => candidate.userStatus === 'required').length} 位</p>
                  <p>推荐排除：{(research?.characterCandidates ?? []).filter((candidate) => candidate.userStatus === 'excluded').length} 位</p>
                  <p>地点候选：{research?.locationCandidates.length ?? 0} 个（含自填 {customLocations.length} 个）</p>
                  {lockedLocationName && <p>主要地点：{lockedLocationName}</p>}
                </div>
                {llmReady === false && <Alert variant="warning" title="文本模型未就绪">请先前往 <a className="underline" href={MCP_SETTINGS_HREF} target="_blank" rel="noreferrer">公共服务配置</a> 绑定文本模型。</Alert>}
                {researchStale && <Alert variant="warning" title="研究输入已过期">活动意图在研究之后有改动，生成的方案会标记为「基于旧设置」。</Alert>}
                <Button variant="primary" disabled={generating || !intake.cast.length} onClick={() => void generatePlans()}>
                  {generating ? <><Spinner size="sm" label="" className="text-white" />正在生成…</> : <><Wand2 className="h-3.5 w-3.5" />根据候选生成方案</>}
                </Button>
                {generating && job && <p className="text-xs text-muted">任务状态：{job.status === 'queued' ? '排队中' : '生成中'}…</p>}
                {runningJob && sessionId && job && (
                  <Button size="sm" variant="ghost" onClick={() => void cancelGeneration()}><X className="h-3.5 w-3.5" />取消生成</Button>
                )}
              </section>
            )}
          />
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">共 {plans.length} 份方案。可以选择、编辑、展开时间线，或带着修改意见再生成一份。</p>
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label="修改意见" className="h-9 w-56 text-sm" placeholder="修改意见（用于重新生成）" value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} />
                <Button size="sm" variant="outline" disabled={generating} onClick={() => void generatePlans({ keepExisting: true })}><RefreshCw className="h-3.5 w-3.5" />重生成一份</Button>
              </div>
            </div>
            {!plans.length && <Alert variant="info">还没有方案：请回到上一步点击「根据候选生成方案」。</Alert>}
            <div className="grid gap-3 lg:grid-cols-3">
              {plans.map((plan) => {
                const summary = summaryFor(plan);
                const payload = planOverride && planOverride.candidateId === plan.id ? planOverride.payload : plan.payload;
                const active = plan.id === selectedPlanId;
                const expanded = expandedPlanId === plan.id;
                return (
                  <article key={plan.id} className={'flex flex-col gap-2 rounded-[var(--radius-panel)] border bg-surface p-3 shadow-xs ' + (active ? 'border-accent' : 'border-border-default')}>
                    <header className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="min-w-0 flex-1 text-sm font-semibold text-ink">{payload.activity.title || '未命名方案'}</h3>
                        {plan.adopted && <Badge variant="accent" className="text-xs">已采用</Badge>}
                        {summary?.stale && <Badge variant="warning" className="text-xs">基于旧设置</Badge>}
                      </div>
                      <p className="text-xs text-muted">{payload.activity.overview}</p>
                    </header>
                    <dl className="space-y-0.5 text-xs text-muted">
                      <div><dt className="inline font-medium text-ink">风格：</dt><dd className="inline">{summary?.style || payload.activity.theme || '—'}</dd></div>
                      <div><dt className="inline font-medium text-ink">主要地点：</dt><dd className="inline">{summary?.primaryLocation || payload.activity.location || '—'}</dd></div>
                      <div><dt className="inline font-medium text-ink">阶段数：</dt><dd className="inline">{summary?.stageCount ?? payload.stages.length}</dd></div>
                      <div><dt className="inline font-medium text-ink">待补人设：</dt><dd className="inline">{summary?.pendingPersonaCount ?? 0}</dd></div>
                    </dl>
                    {!!(summary?.participants?.length ?? payload.actorRoles.length) && (
                      <p className="text-xs text-muted">参与者：{(summary?.participants ?? payload.actorRoles.map((role) => actorName(role.actorId))).join('、')}</p>
                    )}
                    {!!summary?.highlights?.length && (
                      <ul className="space-y-0.5 text-xs text-muted">
                        {summary.highlights.map((highlight) => <li key={highlight}>· {highlight}</li>)}
                      </ul>
                    )}
                    {/* 主要依据：只展示本次真实存在且被方案引用的资料。 */}
                    {(() => {
                      const basis = basisFor(payload);
                      if (!basis.length) {
                        return snapshotReferences.length
                          ? <p className="text-xs text-muted">这份方案没有标注具体依据。</p>
                          : null;
                      }
                      return (
                        <div className="space-y-0.5 text-xs text-muted">
                          <p className="font-medium text-ink">主要依据</p>
                          {basis.map((item) => (
                            <p key={item.id} className="truncate">
                              · {item.title}
                              <span className="ml-1">{natureLabels[item.nature as keyof typeof natureLabels] ?? item.nature}</span>
                            </p>
                          ))}
                        </div>
                      );
                    })()}
                    {!!summary?.caveats?.length && (
                      <ul className="space-y-0.5 text-xs text-amber-700">
                        {summary.caveats.map((caveat) => <li key={caveat}>· {caveat}</li>)}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant={active ? 'primary' : 'outline'} onClick={() => setSelectedPlanId(plan.id)}>{active ? '已选择' : '选择此方案'}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setExpandedPlanId(expanded ? null : plan.id)}><ChevronDown className={'h-3.5 w-3.5 ' + (expanded ? 'rotate-180' : '')} />{expanded ? '收起' : '展开时间线'}</Button>
                      <Button size="sm" variant="ghost" disabled={!active} onClick={openPlanEditor}><FileText className="h-3.5 w-3.5" />编辑</Button>
                    </div>
                    {expanded && (
                      <ol className="space-y-2 border-t border-border-subtle pt-2">
                        {payload.stages.map((stage, index) => (
                          <li key={stage.clientId} className="space-y-1">
                            <p className="text-xs font-semibold text-ink">{index + 1}. {stage.title}{stage.location ? '（' + stage.location + '）' : ''}</p>
                            <p className="text-xs text-muted">{stage.description}</p>
                            <p className="text-xs text-muted">参与：{stage.actorIds.map((id) => actorName(id)).join('、') || '—'}</p>
                            {!!stage.requiredBeats.length && <p className="text-xs text-muted">关键事件：{stage.requiredBeats.join('；')}</p>}
                            {stage.endCondition && <p className="text-xs text-muted">结束条件：{stage.endCondition}</p>}
                          </li>
                        ))}
                      </ol>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {step === 3 && (
          <WorkbenchColumns
            left={(
              <>
                <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Check className="h-4 w-4 text-accent" />最终确认</h3>
                  {!selectedCandidate && <Alert variant="warning">请先在「方案对比」中选择一份方案。</Alert>}
                  {selectedCandidate && activePayload && (
                    <div className="space-y-2 text-sm">
                      <p><span className="font-semibold">标题：</span>{activePayload.activity.title}</p>
                      <p><span className="font-semibold">主题：</span>{activePayload.activity.theme || '—'}</p>
                      <p><span className="font-semibold">地点：</span>{activePayload.activity.location || '—'}</p>
                      <p><span className="font-semibold">日期：</span>{intake.scheduledDate || '未排期'}</p>
                      <div>
                        <span className="font-semibold">参与名单（{session?.session.document.actors.length ?? 0}）：</span>
                        <ul className="mt-1 space-y-0.5 text-xs text-muted">
                          {(session?.session.document.actors ?? []).map((actor) => (
                            <li key={actor.id}>
                              {actor.displayName} · {actor.activityRole || '参与者'}
                              {isUnresolvedPlanningActor(actor) ? ' · 待处理人设' : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <span className="font-semibold">阶段（{activePayload.stages.length}）：</span>
                        <ol className="mt-1 space-y-1 text-xs text-muted">
                          {activePayload.stages.map((stage, index) => (
                            <li key={stage.clientId}>
                              {index + 1}. {stage.title}（{stage.location || '—'}）· 参与：{stage.actorIds.map((id) => actorName(id)).join('、') || '—'}
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  )}
                </section>

                <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><UserPlus className="h-4 w-4 text-accent" />待处理人设（{pendingActors.length}）</h3>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refreshSession()}><RefreshCw className="h-3.5 w-3.5" />重新读取企划</Button>
                  </div>
                  {!pendingActors.length && <p className="text-sm text-muted">没有待处理人设，方案里的人都有对应的本地角色快照。</p>}
                  <ul className="space-y-2">
                    {pendingActors.map((actor) => {
                      const candidate = research?.characterCandidates.find((item) => item.id === actor.candidateRefId);
                      return (
                        <li key={actor.actorId} className="space-y-2 rounded-lg border border-border-subtle p-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-semibold text-ink">{actor.displayName}</span>
                            {actor.work && <span className="text-xs text-muted">《{actor.work}》</span>}
                            {actor.basis && <BasisBadge basis={actor.basis} />}
                            <Badge variant="outline" className="text-xs">{actor.activityRole || '受邀参与者'}</Badge>
                          </div>
                          {actor.relationshipToLead && <p className="text-xs text-muted">关系依据：{actor.relationshipToLead}</p>}
                          <p className="text-xs text-muted">
                            出现在 {actor.affectedStageIds.length} 个阶段：
                            {actor.affectedStageIds.map((id) => {
                              const index = activePayload?.stages.findIndex((stage) => stage.clientId === id) ?? -1;
                              return index >= 0 ? '第 ' + (index + 1) + ' 阶段' : id;
                            }).join('、') || '—'}
                          </p>
                          {candidate?.localMatchStatus === 'multiple' && (
                            <Alert variant="warning" title="角色库中有多张同名卡">请手动选定要匹配的角色，系统不会自动挑选。</Alert>
                          )}
                          {!candidate && <p className="text-xs text-muted">该角色来自本地方案编辑，没有关联研究候选。</p>}
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setPickerTarget({ match: actor.actorId }); setPickerOpen(true); }}><Search className="h-3.5 w-3.5" />匹配已有角色</Button>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setImportTarget(actor.actorId); setImportOpen(true); }}><UserPlus className="h-3.5 w-3.5" />导入角色卡</Button>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void openPersonaDraft(actor.actorId)}><Sparkles className="h-3.5 w-3.5" />补齐人设并入库</Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void resolveActor(actor.actorId, { mode: 'remove' })}><Trash2 className="h-3.5 w-3.5" />从企划移除</Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </>
            )}
            right={(
              <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                <h3 className="text-base font-semibold text-ink">创建前检查</h3>
                <ul className="space-y-1 text-xs text-muted">
                  <li>{selectedCandidate ? '已选择方案：' + (activePayload?.activity.title || '未命名') : '尚未选择方案'}</li>
                  <li>{pendingActors.length ? '还有 ' + pendingActors.length + ' 位人物待匹配或补齐人设' : '所有人物都已匹配本地角色'}</li>
                  <li>{activePayload && activePayload.stages.length >= 2 ? '阶段数满足要求' : '需要至少两个阶段'}</li>
                  <li>{intake.scheduledDate ? '将出现在 ' + intake.scheduledDate + ' 的角色日历' : '未填写日期，创建后可在活动内补充'}</li>
                  {planOverride && <li>已在页面内编辑过方案内容，创建时会使用编辑后的版本。</li>}
                </ul>
                {!!pendingActors.length && <Alert variant="warning" title="暂时无法创建">待处理人设完成后才能创建活动，这样活动里的人都有真实的人设快照。</Alert>}
                {llmReady === false && <Alert variant="warning" title="文本模型未就绪">创建活动不需要模型，但后续生成内容需要。</Alert>}
                <Button variant="primary" disabled={busy || !selectedCandidate || !!pendingActors.length} onClick={() => void createActivity()}>
                  {busy ? '正在创建…' : '创建活动'}
                </Button>
              </section>
            )}
          />
        )}

        <div className="sticky bottom-0 z-10 -mx-4 border-t border-border-subtle bg-paper/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 text-xs text-muted">
              {researching ? <span className="flex items-center gap-1.5 text-amber-800"><Spinner size="sm" label="" />{research?.progressLabel || '正在检索资料…'}</span>
                : generating ? <span className="flex items-center gap-1.5 text-amber-800"><Spinner size="sm" label="" />正在生成方案…</span>
                  : sessionId ? '企划会话 ' + sessionId.slice(0, 8) + '（刷新页面后仍可继续）' : '还没有企划会话'}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {researching && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancelResearch()}><X className="h-3.5 w-3.5" />取消检索</Button>}
              {step > 0 && <Button size="sm" variant="outline" disabled={generating || researching} onClick={() => setStep((step - 1) as StepIndex)}><ArrowLeft className="h-3.5 w-3.5" />上一步</Button>}
              {step === 0 && <Button size="sm" variant="outline" disabled={busy || researching} onClick={() => void skipResearch()}>跳过检索，直接构思<ArrowRight className="h-3.5 w-3.5" /></Button>}
              {step === 0 && <Button size="sm" variant="primary" disabled={busy || researching || !intake.cast.length} onClick={() => void startResearch()}>{researching ? '正在检索…' : '查资料并推荐'}<Search className="h-3.5 w-3.5" /></Button>}
              {step === 1 && <Button size="sm" variant="primary" disabled={generating || researching || !intake.cast.length} onClick={() => void generatePlans()}>{generating ? '正在生成…' : '根据候选生成方案'}</Button>}
              {step === 2 && <Button size="sm" variant="primary" disabled={!selectedPlanId} onClick={() => setStep(3)}>采用该方案并继续<ArrowRight className="h-3.5 w-3.5" /></Button>}
              {step === 3 && <Button size="sm" variant="primary" disabled={busy || !selectedCandidate || !!pendingActors.length} onClick={() => void createActivity()}>创建活动</Button>}
            </div>
          </div>
        </div>
        <div className="h-2" aria-hidden="true" />
      </PageContainer>

      <RecommendationDialog
        open={recommendOpen}
        onOpenChange={setRecommendOpen}
        works={session?.session.form.crossoverWorks ?? []}
        characters={intake.cast.map((member) => member.displayName)}
        theme={intake.theme}
        onAdd={addAssistantReferences}
      />

      <ReferenceUpdateDialog
        open={updateCheckOpen}
        onOpenChange={setUpdateCheckOpen}
        snapshot={session?.session.form.knowledgeSnapshot ?? null}
        onPinOld={pinOldReference}
        onRefresh={refreshReference}
      />

      <GapCollectionDialog
        open={gapOpen}
        onOpenChange={setGapOpen}
        sessionId={sessionId ?? ''}
        works={session?.session.form.crossoverWorks ?? []}
        characters={intake.cast.map((member) => member.displayName)}
        theme={intake.theme}
        onAdd={addAssistantReferences}
      />
      <KnowledgePicker
        open={referencePickerOpen}
        onOpenChange={setReferencePickerOpen}
        onAdd={addReferences}
      />

      <Dialog
        open={Boolean(referencePreview)}
        onOpenChange={(open) => { if (!open) setReferencePreview(null); }}
        title="本次引用"
        description="下面就是生成时会送给模型的内容；超出预算的部分已截断。"
        className="max-w-3xl"
        footer={<Button variant="outline" onClick={() => setReferencePreview(null)}>关闭</Button>}
      >
        {referencePreview && (
          <div className="space-y-3 text-sm">
            {referencePreview.truncated && <Alert variant="warning" title="内容已截取">部分引用超出长度预算，已按预算截断；如需完整内容请减少引用条数。</Alert>}
            {!!referencePreview.unresolved.length && (
              <Alert variant="warning" title="部分来源未匹配">
                {referencePreview.unresolved.map((item) => item.reason).join('；')}。这些来源不会进入本次生成。
              </Alert>
            )}
            {!referencePreview.snapshot.references.length && <p className="text-muted">没有任何可用的引用内容。</p>}
            <ul className="space-y-2">
              {referencePreview.snapshot.references.map((item) => (
                <li key={item.id} className="space-y-1 rounded-lg border border-border-subtle p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <strong className="text-sm text-ink">{item.title}</strong>
                    <Badge variant="outline" className="text-xs">{item.usage === 'requirement' ? '本次要求' : '背景参考'}</Badge>
                    <Badge variant="secondary" className="text-xs">{natureLabels[item.nature as keyof typeof natureLabels] ?? item.nature}</Badge>
                    <span className="text-xs text-muted">{authorshipLabels[item.authorship as keyof typeof authorshipLabels] ?? item.authorship}</span>
                    {item.truncated && <Badge variant="warning" className="text-xs">已截取</Badge>}
                  </div>
                  <p className="whitespace-pre-wrap text-xs text-muted">{item.excerpt.slice(0, 600)}{item.excerpt.length > 600 ? '…' : ''}</p>
                  {!!item.evidence.length && (
                    <p className="text-xs text-muted">来源：{item.evidence.map((evidence) => evidence.title).join('、')}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Dialog>
      <InspirationPicker
        open={inspirationOpen}
        onOpenChange={setInspirationOpen}
        activityType={intake.type}
        leadCharacterId={intake.leadCharacterId || intake.cast[0]?.characterId}
        initialRequirement={intake.instruction}
        onPickIdea={(batch, idea) => { setPendingIdea({ batch, idea }); setReplaceFields(false); }}
      />

      <Dialog
        open={Boolean(pendingIdea)}
        onOpenChange={(open) => { if (!open) setPendingIdea(null); }}
        title="应用这个点子"
        description="下面是会填入的内容。已填写的主角与日期不受影响；推荐人物只是候选，不会自动成为参与者。"
        className="max-w-2xl"
        footer={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setPendingIdea(null)}>取消</Button>
            <Button variant="primary" disabled={busy} onClick={() => { if (pendingIdea) void adoptInspiration(pendingIdea.batch, pendingIdea.idea, replaceFields); }}>
              {busy ? '正在应用…' : replaceFields ? '替换标题与主题并应用' : '应用这个点子'}
            </Button>
          </div>
        )}
      >
        {pendingIdea && (
          <div className="space-y-3 text-sm">
            <p><span className="font-semibold">点子：</span>{pendingIdea.idea.name}</p>
            <div className="space-y-1 rounded-lg border border-border-subtle p-3 text-xs">
              <p><span className="font-semibold text-ink">标题：</span>{replaceFields ? pendingIdea.idea.name : (intake.title || pendingIdea.idea.name + '（将填入）')}</p>
              <p><span className="font-semibold text-ink">主题：</span>{replaceFields ? pendingIdea.idea.overview : (intake.theme || pendingIdea.idea.overview + '（将填入）')}</p>
              <p><span className="font-semibold text-ink">地点：</span>{replaceFields ? (pendingIdea.idea.location || '未指定') : (intake.location || pendingIdea.idea.location || '未指定')}</p>
              <p><span className="font-semibold text-ink">要求：</span>会追加点子说明，包含改编方式、推荐人物与初步阶段（作为参考，不是正式剧本）。</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={replaceFields} onChange={(event) => setReplaceFields(event.target.checked)} />
              替换标题与主题（不勾选时只填空）
            </label>
            {!!pendingIdea.idea.assumptions.length && (
              <Alert variant="warning" title="以下属于创作建议">{pendingIdea.idea.assumptions.join('；')}</Alert>
            )}
          </div>
        )}
      </Dialog>

      <CharacterPickerDialog
        open={pickerOpen}
        onOpenChange={(open) => { setPickerOpen(open); if (!open) setPickerTarget(null); }}
        existingSourceCharacterIds={pickerTarget && typeof pickerTarget === 'object' ? [] : intake.cast.map((member) => member.characterId)}
        existingActorCount={pickerTarget && typeof pickerTarget === 'object' ? 0 : intake.cast.length}
        onSelectCharacter={(actor) => {
          const characterId = String(actor.sourceCharacterId || actor.id);
          if (actor.sourceCharacterId) castSnapshotsRef.current.set(characterId, actor);
          if (pickerTarget === 'lead') {
            setIntake((current) => ({
              ...current,
              cast: current.cast.some((member) => member.characterId === characterId)
                ? current.cast
                : [...current.cast, { characterId, displayName: actor.displayName, avatarUrl: actor.avatarUrl, activityRole: actor.activityRole }],
              leadCharacterId: characterId,
              birthdayIds: current.templateId === 'birthday' ? [...new Set([...current.birthdayIds, characterId])] : current.birthdayIds,
            }));
          } else if (pickerTarget && typeof pickerTarget === 'object') {
            void resolveActor(pickerTarget.match, { mode: 'match', characterId });
          } else {
            setIntake((current) => ({ ...current, cast: mergeCast(current.cast, [actor], maxActors) }));
          }
        }}
      />

      <CharacterImportDialog
        open={importOpen}
        onOpenChange={(open) => { setImportOpen(open); if (!open) setImportTarget(null); }}
        onCommitted={(characterId) => {
          setImportOpen(false);
          if (importTarget) void resolveActor(importTarget, { mode: 'match', characterId });
          else void addImportedCharacterToCast(characterId);
        }}
      />

      <Dialog
        open={Boolean(evidenceOpen)}
        onOpenChange={(open) => { if (!open) setEvidenceOpen(null); }}
        title="候选依据"
        description="以下摘录来自本次检索已保存的资料；没有引用资料的候选会被标注为推测或联动建议。"
        className="max-w-3xl"
        footer={<Button variant="outline" onClick={() => setEvidenceOpen(null)}>关闭</Button>}
      >
        <ul className="space-y-3">
          {evidenceOpen?.evidenceIds.length
            ? evidenceFor(evidenceOpen.evidenceIds).map((evidence) => (
              <li key={evidence.id} className="space-y-1 rounded-lg border border-border-subtle p-3">
                <p className="text-xs font-semibold text-ink">{evidence.sourceName}</p>
                <p className="text-xs text-muted">定位：{evidence.documentLocator}</p>
                <p className="whitespace-pre-wrap text-sm text-ink">{evidence.excerpt}</p>
                <p className="text-xs text-muted">工具：{evidence.tool} · 获取于 {evidence.retrievedAt}</p>
              </li>
            ))
            : <li className="text-sm text-muted">该候选没有关联资料摘录。请按「联动建议」对待，不要当作原作设定。</li>}
        </ul>
      </Dialog>

      <Dialog
        open={Boolean(personaOpen)}
        onOpenChange={(open) => { if (!open && !busy) setPersonaOpen(null); }}
        title="补齐人设并入库"
        description={personaOpen ? (personaOpen.draft.hasEvidence ? '以下内容依据已保存的资料摘录生成，保存前请确认。' : '本次没有可引用的外部资料，内容是创作建议；未查到的设定请自行补充或留空。') : ''}
        className="max-w-3xl"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setPersonaOpen(null)}>取消</Button>
            <Button variant="primary" disabled={busy} onClick={() => void confirmPersonaDraft()}>{busy ? '正在写入…' : '确认并写入角色库'}</Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">角色名</span>
            <Input aria-label="角色名" value={personaValue.displayName} onChange={(event) => setPersonaValue((current) => ({ ...current, displayName: event.target.value }))} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">作品</span>
            <Input aria-label="作品" value={personaValue.work} onChange={(event) => setPersonaValue((current) => ({ ...current, work: event.target.value }))} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">一句话简介</span>
            <Textarea aria-label="一句话简介" rows={2} value={personaValue.summary} onChange={(event) => setPersonaValue((current) => ({ ...current, summary: event.target.value }))} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">人设正文</span>
            <Textarea aria-label="人设正文" rows={8} value={personaValue.personaText} onChange={(event) => setPersonaValue((current) => ({ ...current, personaText: event.target.value }))} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-ink">外貌描写</span>
              <Textarea aria-label="外貌描写" rows={3} value={personaValue.baseText} onChange={(event) => setPersonaValue((current) => ({ ...current, baseText: event.target.value }))} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-ink">默认服装</span>
              <Textarea aria-label="默认服装" rows={3} value={personaValue.defaultOutfitText} onChange={(event) => setPersonaValue((current) => ({ ...current, defaultOutfitText: event.target.value }))} />
            </label>
          </div>
          {personaOpen && !personaOpen.draft.hasEvidence && <Alert variant="warning" title="没有资料依据">资料未覆盖的设定请留空，避免把推测写进角色库。</Alert>}
        </div>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="编辑方案内容"
        description="这里的改动只影响本次创建的活动，不会写回模型输出，也不会修改其他方案。"
        className="max-w-3xl"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button variant="primary" onClick={savePlanEdit}>保存改动</Button>
          </div>
        )}
      >
        {editValue && (
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-ink">标题</span>
              <Input aria-label="方案标题" value={editValue.activity.title} onChange={(event) => updateEditActivity('title', event.target.value)} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-ink">主题</span>
                <Input aria-label="方案主题" value={editValue.activity.theme} onChange={(event) => updateEditActivity('theme', event.target.value)} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-ink">地点</span>
                <Input aria-label="方案地点" value={editValue.activity.location} onChange={(event) => updateEditActivity('location', event.target.value)} />
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-ink">概述</span>
              <Textarea aria-label="方案概述" rows={2} value={editValue.activity.overview} onChange={(event) => updateEditActivity('overview', event.target.value)} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-ink">活动规则</span>
              <Textarea aria-label="方案规则" rows={2} value={editValue.activity.rules} onChange={(event) => updateEditActivity('rules', event.target.value)} />
            </label>
            <div className="space-y-2">
              {editValue.stages.map((stage, index) => (
                <div key={stage.clientId} className="space-y-2 rounded-lg border border-border-subtle p-2">
                  <p className="text-xs font-semibold text-ink">阶段 {index + 1}</p>
                  <Input aria-label={'阶段 ' + (index + 1) + ' 标题'} value={stage.title} onChange={(event) => updateEditStage(index, 'title', event.target.value)} />
                  <Input aria-label={'阶段 ' + (index + 1) + ' 地点'} value={stage.location} onChange={(event) => updateEditStage(index, 'location', event.target.value)} />
                  <Textarea aria-label={'阶段 ' + (index + 1) + ' 描述'} rows={2} value={stage.description} onChange={(event) => updateEditStage(index, 'description', event.target.value)} />
                  <Input aria-label={'阶段 ' + (index + 1) + ' 结束条件'} value={stage.endCondition} onChange={(event) => updateEditStage(index, 'endCondition', event.target.value)} />
                </div>
              ))}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

/** 合并角色快照到名单，按 characterId 去重并遵守人数上限。 */
function mergeCast(current: CastMember[], actors: ActorSnapshot[], maxActors: number): CastMember[] {
  const existing = new Set(current.map((member) => member.characterId));
  const added = actors
    .filter((actor) => actor.sourceCharacterId && !existing.has(actor.sourceCharacterId))
    .map((actor) => ({ characterId: String(actor.sourceCharacterId), displayName: actor.displayName, avatarUrl: actor.avatarUrl, activityRole: actor.activityRole }));
  return added.length ? [...current, ...added].slice(0, maxActors) : current;
}
