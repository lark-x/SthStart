'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  ChevronDown,
  Clapperboard,
  ImageIcon,
  Library,
  MapPin,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  UserRound,
} from 'lucide-react';
import type {
  WorldActor,
  WorldBranchDetail,
  WorldLocation,
  WorldOverview,
  WorldSuggestionCandidate,
  WorldVisualReference,
} from '@sthstart/contracts';
import { PageContainer } from '@/app/components/shared/page-layout';
import { PageHeader } from '@/app/components/shared/page-header';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Select } from '@/app/components/ui/select';
import { FormField } from '@/app/components/ui/form-field';
import { FormSection, ShortFieldGrid } from '@/app/components/ui/form-section';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Skeleton } from '@/app/components/ui/skeleton';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Drawer } from '@/app/components/ui/drawer';
import { useToast } from '@/app/providers/ui-provider';
import { ApiClientError } from '@/app/lib/api-client';
import { usePublicOverview } from '@/app/features/public-services/queries';
import type { WorldList } from '../api';
import { useStoryWorldOverview, useWorldBranchDetail } from '../queries';
import { storyWorldKeys } from '../query-keys';
import { useModelRoutingOptions } from '../hooks/use-external-options';
import { modelCatalog } from '../hooks/world-format';
import { SOURCE_NATURE_META } from '../hooks/world-format';
import {
  BRANCH_MODE_HINTS,
  BRANCH_MODE_LABELS,
  MODEL_PURPOSES,
  MODEL_PURPOSE_LABELS,
  applyCandidates,
  branchHref,
  createEmptyActor,
  createEmptyDraft,
  createEmptyLocation,
  createWorldBundle,
  compareDraftToServer,
  compareBranchFields,
  definitionFromWorld,
  draftFingerprint,
  draftFromWorld,
  formatMinuteOfDay,
  insertCreatedWorld,
  isRunBlockingBranch,
  mergeActors,
  mergeSources,
  newId,
  normalizeDraftForSubmit,
  parseMinuteOfDay,
  replaceActors,
  replaceSources,
  resolveSavePlan,
  resolveSaveCompletion,
  diffAppliedChanges,
  revertAppliedChanges,
  saveWorldBranch,
  saveWorldDefinition,
  validateDraft,
  validateSelection,
  issueFor,
  type DraftValidation,
  type AppliedChanges,
} from './model';
import { useAuthoringSession } from './use-authoring-session';
import { MediaReferenceField, MediaReferencePicker } from './media-reference-picker';
import { WorldResourcePicker } from './world-resource-picker';
import { WorldAiPanel, type WorldAiPersistedState } from './world-ai-panel';
import { fetchWorldSetup, pendingWorldsKey, saveWorldSetup, worldSetupKey } from './setup-api';
import './world-authoring.css';

export interface WorldAuthoringPageProps {
  /** 编辑已有世界时传入；新建页不传。 */
  worldId?: string;
  pending?: boolean;
}

function OptionalSection({ enabled, title, children }: { enabled: boolean; title: string; children: ReactNode }) {
  if (!enabled) return children;
  return (
    <details className="rounded-control border border-border-subtle px-3 py-2">
      <summary className="text-sm font-medium text-ink">{title}</summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

type MediaTarget =
  | { kind: 'actor'; actorId: string }
  | { kind: 'visual'; referenceId: string };

const EMPTY_VALIDATION: DraftValidation = { ok: true, issues: [] };

function messageOf(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return '操作失败，请重试。';
}

function isConflict(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 409 || error.status === 412);
}

function conflictMessage(kind: ReturnType<typeof useAuthoringSession>['conflictKind']): string {
  switch (kind) {
    case 'world-stale':
      return '世界设定已在别处更新。草稿仍在，请先核对服务器当前值与草稿差异，确认后再保存。';
    case 'branch-stale':
      return '该分支已在别处更新。请先核对差异，确认后再保存分支字段。';
    case 'branch-switched':
      return '草稿来自另一个分支。切换分支后，分支名称、模式与方向需要重新确认。';
    case 'missing-base':
      return '草稿没有可确认的修订基底（可能来自旧版表单）。请核对差异后确认基准。';
    default:
      return '世界或分支已在别处更新。草稿仍在，请核对后重试。';
  }
}

function createVisualReference(
  kind: WorldVisualReference['kind'],
  locationId?: string,
): WorldVisualReference {
  return {
    id: newId('visual'),
    name: kind === 'location' ? '场景锚点' : '重要道具',
    kind,
    ...(kind === 'location' && locationId ? { locationId } : {}),
    description: '',
    referenceArtifactIds: [],
  };
}

/**
 * 世界独立配置页：四个主要区域（简介、人物、开场地点、故事方向）常驻，
 * 时间、锁定事实、画面与模型收在高级折叠里。新建与编辑共用一套草稿与保存语义。
 */
export function WorldAuthoringPage({ worldId, pending = false }: WorldAuthoringPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const toast = useToast();
  const isEdit = Boolean(worldId);
  const branchParam = searchParams.get('branch')?.trim() ?? '';
  const projectId = searchParams.get('projectId')?.trim() ?? '';
  const pendingBackHref = worldId ? `/apps/story-worlds?world=${encodeURIComponent(worldId)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}` : '/apps/story-worlds';

  const overview = useStoryWorldOverview(pending ? undefined : worldId);
  const setup = useQuery({
    queryKey: worldSetupKey(worldId ?? ''), queryFn: () => fetchWorldSetup(worldId!),
    enabled: pending && Boolean(worldId), retry: false, staleTime: 10_000,
  });
  const branchId = useMemo(() => {
    if (!isEdit || !overview.data) return '';
    return overview.data.branches.some((branch) => branch.id === branchParam)
      ? branchParam
      : overview.data.branches[0]?.id ?? '';
  }, [isEdit, overview.data, branchParam]);
  const detail = useWorldBranchDetail(worldId, branchId || undefined);

  const serverBranch = detail.data?.branch ?? null;
  const activeRun = detail.data?.run ?? null;
  const branchLocked = isRunBlockingBranch(activeRun?.status);

  const initialValues = useMemo(() => {
    if (pending) return setup.data?.draft ?? null;
    if (!isEdit) return null;
    if (!overview.data?.world || !serverBranch) return null;
    return draftFromWorld(overview.data.world, serverBranch);
  }, [isEdit, overview.data, serverBranch, pending, setup.data]);

  const ready = !isEdit
    ? true
    : pending ? Boolean(initialValues) : Boolean(initialValues && overview.data?.world && serverBranch);

  const createInitial = useMemo(() => (isEdit ? null : createEmptyDraft()), [isEdit]);

  const session = useAuthoringSession({
    worldId,
    branchId: branchId || undefined,
    serverBranch: serverBranch
      ? {
        branchId: serverBranch.id,
        title: serverBranch.title,
        mode: serverBranch.mode,
        direction: serverBranch.direction,
        revision: serverBranch.revision,
      }
      : undefined,
    initialValues: initialValues ?? createInitial ?? createEmptyDraft(),
    baseRevision: pending ? setup.data?.revision : overview.data?.world.revision,
    branchRevision: serverBranch?.revision,
    ready,
  });

  const values = session.values;
  const definition = values.definition;
  const fingerprint = useMemo(() => draftFingerprint(values), [values]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const aiInvoker = useRef<HTMLButtonElement>(null);
  const pendingSaveBusy = useRef(false);
  const [mediaTarget, setMediaTarget] = useState<MediaTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [rebasePreview, setRebasePreview] = useState<{
    baseRevision: number;
    branchRevision?: number;
    fields: ReturnType<typeof compareDraftToServer>;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [undo, setUndo] = useState<AppliedChanges | null>(null);
  const [timeInput, setTimeInput] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const saveRef = useRef<() => void>(() => {});
  const handleAiStateChange = useCallback((state: WorldAiPersistedState | null) => {
    if (!state) {
      if (session.suggestion) session.setSuggestion(null);
      return;
    }
    session.setSuggestion({
      fingerprint: state.run.response.draftFingerprint,
      scope: state.run.scope,
      instruction: state.run.instruction,
      candidates: state.run.response.candidates,
      gaps: state.run.response.gaps,
      selectedIds: state.selectedIds,
      manualIds: state.manualIds,
      excludedIds: state.excludedIds,
      confirmations: state.confirmations,
      baseDraft: state.run.baseDraft,
      createdAt: session.suggestion?.createdAt ?? new Date().toISOString(),
    });
  }, [session]);
  const loadError = isEdit && (overview.isError || detail.isError)
    ? messageOf(overview.error ?? detail.error)
    : null;

  const validation = useMemo(() => validateDraft(values), [values]);
  const pendingIssues = validation.issues.filter(({ path }) =>
    (path !== 'locations' || definition.locations.length > 0) &&
    (path !== 'actors' || definition.actors.length > 0));
  const shownValidation = showValidation || saveError
    ? pending ? { ok: pendingIssues.length === 0, issues: pendingIssues } : validation
    : EMPTY_VALIDATION;

  const update = session.update;

  const patchDefinition = useCallback(
    (patch: Partial<typeof definition>) => update((current) => ({
      ...current,
      definition: { ...current.definition, ...patch },
    })),
    [update],
  );

  const patchActor = useCallback((actorId: string, patch: Partial<WorldActor>) => {
    update((current) => ({
      ...current,
      definition: {
        ...current.definition,
        actors: current.definition.actors.map((actor) => (
          actor.id === actorId ? { ...actor, ...patch } : actor
        )),
      },
    }));
  }, [update]);

  const patchLocation = useCallback((locationId: string, patch: Partial<WorldLocation>) => {
    update((current) => ({
      ...current,
      definition: {
        ...current.definition,
        locations: current.definition.locations.map((location) => (
          location.id === locationId ? { ...location, ...patch } : location
        )),
      },
    }));
  }, [update]);

  const addActor = useCallback(() => {
    const locationId = definition.locations[0]?.id;
    if (!locationId) {
      setSaveError('请先添加一个开场地点，再添加人物。');
      return;
    }
    update((current) => ({
      ...current,
      definition: {
        ...current.definition,
        actors: [...current.definition.actors, createEmptyActor(locationId)],
      },
    }));
  }, [definition.locations, update]);

  const removeActor = useCallback((actorId: string) => {
    update((current) => ({
      ...current,
      definition: {
        ...current.definition,
        actors: current.definition.actors.filter((actor) => actor.id !== actorId),
      },
    }));
  }, [update]);

  const addLocation = useCallback(() => {
    update((current) => ({
      ...current,
      definition: {
        ...current.definition,
        locations: [...current.definition.locations, createEmptyLocation(current.definition.locations.length)],
      },
    }));
  }, [update]);

  const [locationError, setLocationError] = useState<string | null>(null);
  const removeLocation = useCallback((locationId: string) => {
    const usedBy = definition.actors.filter((actor) => actor.locationId === locationId);
    if (usedBy.length > 0) {
      setLocationError(
        `「${definition.locations.find((item) => item.id === locationId)?.name ?? '该地点'}」仍是 ${usedBy.map((actor) => actor.name || '未命名人物').join('、')} 的地点，请先改派人物。`,
      );
      return;
    }
    if (!pending && definition.locations.length <= 1) {
      setLocationError('至少保留一个开场地点。');
      return;
    }
    setLocationError(null);
    update((current) => ({
      ...current,
      definition: {
        ...current.definition,
        locations: current.definition.locations.filter((location) => location.id !== locationId),
        visualReferences: (current.definition.visualReferences ?? []).filter((reference) => (
          reference.kind === 'prop' ? reference.locationId !== locationId : (reference.locationId ?? reference.id) !== locationId
        )),
      },
    }));
  }, [definition.actors, definition.locations, pending, update]);

  const addSources = useCallback((incoming: Parameters<typeof mergeSources>[1]) => {
    if (saving) {
      toast.warning('正在保存', '保存完成后再导入资料。');
      return;
    }
    update((current) => ({
      ...current,
      definition: {
        ...current.definition,
        sources: mergeSources(current.definition.sources, incoming),
      },
    }));
    if (incoming.length > 0) {
      setNotice(`已加入 ${incoming.length} 条参考资料；AI 只会引用这里列出的来源。`);
    }
  }, [update, saving, toast]);

  const addActors = useCallback((incoming: WorldActor[]) => {
    if (saving) {
      toast.warning('正在保存', '保存完成后再导入人物。');
      return;
    }
    const fallback = definition.locations[0]?.id;
    const locationIds = new Set(definition.locations.map((location) => location.id));
    let moved = 0;
    const prepared = incoming.map((actor) => {
      if (locationIds.has(actor.locationId)) return actor;
      moved += 1;
      return fallback ? { ...actor, locationId: fallback } : actor;
    });
    update((current) => ({
      ...current,
      definition: {
        ...current.definition,
        actors: mergeActors(current.definition.actors, prepared),
      },
    }));
    if (incoming.length > 0) {
      setNotice(
        moved > 0
          ? `已加入 ${incoming.length} 名人物；其中 ${moved} 名原地点不在本世界，已放到「${definition.locations[0]?.name ?? '首个地点'}」，请在人物卡里改派。`
          : `已加入 ${incoming.length} 名人物。`,
      );
    }
  }, [definition.locations, update, saving, toast]);

  const replaceActorVersions = useCallback((incoming: WorldActor[]) => {
    if (saving) {
      toast.warning('正在保存', '保存完成后再更新人物版本。');
      return;
    }
    let replaced = 0;
    let rejectedCount = 0;
    let firstRejection = '';
    update((current) => {
      const result = replaceActors(current.definition.actors, incoming);
      replaced = result.replaced;
      rejectedCount = result.rejected.length;
      firstRejection = result.rejected[0]?.reason ?? '';
      return {
        ...current,
        definition: {
          ...current.definition,
          actors: result.items,
        },
      };
    });
    if (replaced > 0) {
      setNotice(`已按资料库版本更新 ${replaced} 名人物；原有地点、角色定位与媒体绑定保持不变。`);
    }
    if (rejectedCount > 0) {
      toast.error(
        '人物版本未全部更新',
        `${firstRejection}${rejectedCount > 1 ? `另有 ${rejectedCount - 1} 项未更新。` : ''}`,
      );
    }
  }, [saving, toast, update]);

  const replaceSourceVersions = useCallback((incoming: Parameters<typeof replaceSources>[1]) => {
    if (saving) {
      toast.warning('正在保存', '保存完成后再更新资料来源。');
      return;
    }
    let replaced = 0;
    let rejectedCount = 0;
    let firstRejection = '';
    update((current) => {
      const result = replaceSources(current.definition.sources, incoming);
      replaced = result.replaced;
      rejectedCount = result.rejected.length;
      firstRejection = result.rejected[0]?.reason ?? '';
      return {
        ...current,
        definition: {
          ...current.definition,
          sources: result.items,
        },
      };
    });
    if (replaced > 0) {
      setNotice(`已按确认的版本更新 ${replaced} 条参考资料，原有来源 ID 保持不变。`);
    }
    if (rejectedCount > 0) {
      toast.error(
        '资料来源未全部更新',
        `${firstRejection}${rejectedCount > 1 ? `另有 ${rejectedCount - 1} 项未更新。` : ''}`,
      );
    }
  }, [saving, toast, update]);

  const mediaValue = useMemo(() => {
    if (!mediaTarget) return [];
    if (mediaTarget.kind === 'actor') {
      return definition.actors.find((actor) => actor.id === mediaTarget.actorId)?.referenceArtifactIds ?? [];
    }
    return (definition.visualReferences ?? [])
      .find((reference) => reference.id === mediaTarget.referenceId)?.referenceArtifactIds ?? [];
  }, [mediaTarget, definition.actors, definition.visualReferences]);

  const setMediaValue = useCallback((ids: string[]) => {
    if (!mediaTarget) return;
    if (mediaTarget.kind === 'actor') {
      patchActor(mediaTarget.actorId, { referenceArtifactIds: ids });
      return;
    }
    update((current) => ({
      ...current,
      definition: {
        ...current.definition,
        visualReferences: (current.definition.visualReferences ?? []).map((reference) => (
          reference.id === mediaTarget.referenceId
            ? { ...reference, referenceArtifactIds: ids }
            : reference
        )),
      },
    }));
  }, [mediaTarget, patchActor, update]);

  const handleApplyCandidates = useCallback((selected: WorldSuggestionCandidate[]) => {
    if (saving) {
      toast.warning('正在保存', '保存完成后再采纳建议，避免覆盖正在提交的内容。');
      return;
    }
    const check = validateSelection(values, selected);
    if (!check.ok) {
      setSaveError(check.errors.join(' '));
      return;
    }
    const next = applyCandidates(values, selected);
    setUndo(diffAppliedChanges(values, next, `AI 建议 ${selected.length} 项`));
    session.replaceValues(next);
    session.setSuggestion(null);
    setSaveError(null);
    toast.success('已采纳建议', `更新了 ${selected.length} 项；可用“撤销”还原。`);
  }, [values, session, toast, saving]);

  const handleUndo = useCallback(() => {
    if (!undo) return;
    const result = revertAppliedChanges(session.getValues(), undo);
    if (result.reverted === 0) {
      setUndo(null);
      toast.info('没有可撤销的字段', '采纳后这些字段都已被手改，保留了当前内容。');
      return;
    }
    session.replaceValues(result.values);
    setUndo(null);
    toast.info(
      `已撤销 ${result.reverted} 项`,
      result.kept > 0
        ? `另有 ${result.kept} 项在采纳后被手改，已保留你的修改。`
        : '只回退了仍等于 AI 填入值的字段。',
    );
  }, [undo, session, toast]);

  const handleTimeChange = useCallback((raw: string) => {
    const parsed = parseMinuteOfDay(raw);
    if (parsed === null) {
      setTimeInput(raw);
      setTimeError('请使用 00:00 到 23:59 的时刻，或留空表示未定义。');
      return;
    }
    setTimeInput(null);
    setTimeError(null);
    update((current) => {
      const nextDefinition = { ...current.definition };
      if (parsed === undefined) delete nextDefinition.startMinuteOfDay;
      else nextDefinition.startMinuteOfDay = parsed;
      return { ...current, definition: nextDefinition };
    });
  }, [update]);

  const branchChanged = Boolean(
    serverBranch && compareBranchFields(values, serverBranch).changed,
  );

  /**
   * scope='world' 只写世界设定（分支运行时仍然可用）；
   * scope='branch' 只写分支；'all' 依次写两者，分支失败时保留世界已保存的结果。
   */
  const save = useCallback(async (scope: 'all' | 'world' | 'branch' = 'all') => {
    if (saving || pendingSaveBusy.current) return;
    setShowValidation(true);
    setSaveError(null);
    setConflict(false);
    const check = validateDraft(values);
    if (pending && worldId) {
      const issues = check.issues.filter(({ path }) => (path !== 'locations' || values.definition.locations.length > 0)
        && (path !== 'actors' || values.definition.actors.length > 0));
      if (issues.length) { setSaveError(issues[0].message); return; }
      if (!session.baseRevision || session.hasConflict || conflict) {
        setSaveError('请先核对服务器上的最新设定。');
        setConflict(true);
        return;
      }
      pendingSaveBusy.current = true;
      setSaving(true);
      try {
        const result = await saveWorldSetup(worldId, {
          expectedRevision: session.baseRevision, draft: normalizeDraftForSubmit(values), complete: check.ok,
        });
        if (result.status === 'ready') {
          session.markSaved({ values: draftFromWorld(result.world, result.branch),
            baseRevision: result.world.revision, branchRevision: result.branch.revision });
          queryClient.setQueryData<WorldOverview>(storyWorldKeys.overview(worldId), { world: result.world, branches: [result.branch] });
          queryClient.setQueryData<WorldList>(storyWorldKeys.list(), (current) => insertCreatedWorld(current, result.world));
          router.replace(branchHref(worldId, result.branch.id));
          toast.success('配置已完成', '主线已建立，可以开始运行。');
        } else {
          session.markSaved({ values: result.setup.draft, baseRevision: result.setup.revision });
          queryClient.setQueryData(worldSetupKey(worldId), result.setup);
          toast.success('设定已保存');
        }
        void queryClient.invalidateQueries({ queryKey: pendingWorldsKey });
      } catch (error) {
        setSaveError(messageOf(error));
        if (isConflict(error)) setConflict(true);
      } finally {
        pendingSaveBusy.current = false;
        setSaving(false);
      }
      return;
    }
    if (!check.ok) {
      setSaveError(`还有 ${check.issues.length} 处需要修正：${check.issues[0].message}`);
      return;
    }
    const plan = resolveSavePlan({
      isEdit: Boolean(worldId),
      scope,
      hasConflict: session.hasConflict,
      baseRevision: session.baseRevision,
      branchRevision: session.branchRevision,
      branchChanged,
      branchLocked,
      serverReady: Boolean(overview.data?.world && serverBranch),
    });
    if (plan.kind === 'blocked') {
      if (plan.conflict) setConflict(true);
      setSaveError(plan.message);
      return;
    }
    const normalized = normalizeDraftForSubmit(values);
    const submitted = values;
    setPickerOpen(false);
    setSaving(true);
    try {
      if (plan.kind === 'create') {
        const currentFingerprint = draftFingerprint(normalized);
        const key = session.beginCreateAttempt(currentFingerprint);
        const result = await createWorldBundle({
          idempotencyKey: key,
          definition: normalized.definition,
          initialBranch: normalized.initialBranch,
        });
        session.markSaved({
          values: draftFromWorld(result.world, result.branch),
          baseRevision: result.world.revision,
          branchRevision: result.branch.revision,
        });
        toast.success('世界已创建', result.world.title);
        await queryClient.invalidateQueries({ queryKey: storyWorldKeys.list() });
        queryClient.setQueryData<WorldList>(storyWorldKeys.list(), (current) => (
          insertCreatedWorld(current, result.world)
        ));
        queryClient.setQueryData(storyWorldKeys.overview(result.world.id), {
          world: result.world,
          branches: [result.branch],
        });
        router.push(branchHref(result.world.id, result.branch.id));
        return;
      }

      if (!worldId || !overview.data?.world || !serverBranch) return;
      const worldRevision = plan.expectedRevision;
      const branchRevision = plan.branchRevision;
      const savedWorld = !plan.writeWorld
        ? overview.data.world
        : await saveWorldDefinition(worldId, worldRevision, normalized.definition);
      const publishSavedWorld = () => {
        if (!plan.writeWorld) return;
        queryClient.setQueryData<WorldOverview>(storyWorldKeys.overview(worldId), (current) => (
          current && current.world.revision <= savedWorld.revision
            ? { ...current, world: savedWorld }
            : current
        ));
        queryClient.setQueryData<WorldList>(storyWorldKeys.list(), (current) => (
          current ? {
            ...current,
            items: current.items.map((world) => world.id === savedWorld.id && world.revision <= savedWorld.revision
              ? savedWorld : world),
          } : current
        ));
      };
      let savedBranch = serverBranch;
      const branchWillSave = plan.writeBranch;
      try {
        if (branchWillSave) {
          savedBranch = await saveWorldBranch(
            worldId,
            serverBranch.id,
            branchRevision!,
            normalized.initialBranch,
          );
        }
      } catch (branchError) {
        publishSavedWorld();
        session.markSaved({
          values: { definition: definitionFromWorld(savedWorld), initialBranch: normalized.initialBranch },
          baseRevision: savedWorld.revision,
          branchRevision: session.branchRevision,
          keepDirty: true,
        });
        setSaveError(
          `${isConflict(branchError) ? '世界设定已保存，但分支已在别处更新。' : '世界设定已保存，但分支保存失败。'}${messageOf(branchError)} 分支输入仍保留在草稿中。`,
        );
        if (isConflict(branchError)) {
          setConflict(true);
          void overview.refetch();
          void detail.refetch();
        }
        return;
      }

      publishSavedWorld();
      if (branchWillSave) {
        queryClient.setQueryData<WorldOverview>(storyWorldKeys.overview(worldId), (current) => (
          current ? {
            ...current,
            branches: current.branches.map((branch) => branch.id === savedBranch.id && branch.revision <= savedBranch.revision
              ? savedBranch : branch),
          } : current
        ));
        queryClient.setQueryData<WorldBranchDetail>(storyWorldKeys.branch(worldId, savedBranch.id), (current) => (
          current && current.branch.revision <= savedBranch.revision
            ? { ...current, branch: savedBranch }
            : current
        ));
      }

      if (scope === 'branch') {
        const saved = resolveSaveCompletion({
          scope,
          writeBranch: true,
          draft: submitted,
          submitted,
          late: session.getValues(),
          savedDefinition: definitionFromWorld(savedWorld),
          savedBranch,
        });
        session.markSaved({
          values: saved.values,
          baseRevision: savedWorld.revision,
          branchRevision: savedBranch.revision,
          keepDirty: saved.keepDirty,
        });
        toast.success(
          '分支设定已保存',
          saved.worldPending
            ? '世界设定仍有未保存的修改，草稿已保留。'
            : saved.lateBranchEdits ? '保存期间的新输入已保留。' : savedBranch.title,
        );
        return;
      }

      const saved = resolveSaveCompletion({
        scope,
        writeBranch: branchWillSave,
        draft: submitted,
        submitted,
        late: session.getValues(),
        savedDefinition: definitionFromWorld(savedWorld),
        savedBranch,
      });
      session.markSaved({
        values: saved.values,
        baseRevision: savedWorld.revision,
        branchRevision: savedBranch.revision,
        keepDirty: saved.keepDirty,
      });
      toast.success(
        scope === 'world'
          ? '世界设定已保存'
          : branchWillSave ? '世界与分支已保存' : '世界设定已保存',
        saved.branchPending
          ? '分支设定仍有未保存的修改，草稿已保留。'
          : saved.lateWorldEdits || saved.lateBranchEdits
            ? '保存期间的新输入已保留。'
            : savedWorld.title,
      );
    } catch (error) {
      if (isConflict(error)) {
        setConflict(true);
        setSaveError(
          worldId
            ? '世界或分支已在别处更新。草稿仍在，请刷新到最新修订后再次保存。'
            : '这次创建与已有记录冲突，已保留草稿；请再次保存。',
        );
        if (!worldId) session.rotateIdempotencyKey();
        void overview.refetch();
        if (worldId) void detail.refetch();
      } else {
        setSaveError(messageOf(error));
      }
    } finally {
      setSaving(false);
    }
  }, [
    saving, values, worldId, session, overview, detail, serverBranch,
    branchLocked, branchChanged, router, toast, queryClient, pending, conflict,
  ]);
  useEffect(() => {
    saveRef.current = () => { void save(); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      saveRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  /** 拉取最新快照并展示差异；作者确认后才推进基准，绝不静默 rebase。 */
  const prepareRebase = useCallback(async () => {
    if (pending) {
      const latest = await setup.refetch();
      if (!latest.data || latest.isError) {
        setSaveError('无法取得最新配置；如已在另一个页面完成配置，请返回故事世界。');
        return;
      }
      setRebasePreview({ baseRevision: latest.data.revision, fields: compareDraftToServer(values, {
        definition: latest.data.draft.definition, branch: latest.data.draft.initialBranch,
      }) });
      return;
    }
    const [nextOverview, nextDetail] = await Promise.all([
      overview.refetch(),
      worldId && serverBranch ? detail.refetch() : Promise.resolve(undefined),
    ]);
    const latestWorld = nextOverview.data?.world;
    const latestBranch = nextDetail?.data?.branch;
    if (!latestWorld || !latestBranch) {
      setSaveError('无法取得最新修订，请刷新页面后重试。');
      return;
    }
    const serverDraft = draftFromWorld(latestWorld, latestBranch);
    setRebasePreview({
      baseRevision: latestWorld.revision,
      branchRevision: latestBranch.revision,
      fields: compareDraftToServer(values, {
        definition: serverDraft.definition,
        branch: serverDraft.initialBranch,
      }),
    });
  }, [overview, detail, worldId, serverBranch, values, pending, setup]);

  const confirmRebase = useCallback(() => {
    if (!rebasePreview) return;
    session.rebaseTo({
      baseRevision: rebasePreview.baseRevision,
      branchRevision: rebasePreview.branchRevision,
    });
    setConflict(false);
    setRebasePreview(null);
    setSaveError(null);
    setNotice(
      pending
        ? `已确认使用修订 ${rebasePreview.baseRevision} 作为基准；草稿内容保持不变，下次保存会写入这些内容。`
        : `已确认使用世界 rev ${rebasePreview.baseRevision} / 分支 rev ${rebasePreview.branchRevision} 作为基准；草稿内容保持不变，下次保存会写入这些内容。`,
    );
  }, [rebasePreview, session, pending]);

  const discard = useCallback(() => {
    session.discard();
    setUndo(null);
    setSaveError(null);
    setConflict(false);
    setShowValidation(false);
    setNotice('已放弃未保存的修改。');
  }, [session]);

  const modelRouting = useModelRoutingOptions(advancedOpen);
  const publicOverview = usePublicOverview();
  const modelOptions = useMemo(() => modelCatalog(
    publicOverview.data?.profiles ?? [],
    modelRouting.data?.models ?? [],
  ), [publicOverview.data?.profiles, modelRouting.data?.models]);

  const loading = !ready && !overview.isError && (
    (pending ? setup.isLoading : overview.isLoading || (Boolean(branchId) && detail.isLoading))
  );
  if (isEdit && loading) {
    return (
      <PageContainer width="wide" className="py-6">
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </PageContainer>
    );
  }

  if (isEdit && !initialValues) {
    return (
      <PageContainer width="wide" className="py-6">
        <EmptyState
          icon={Clapperboard}
          title="找不到这个世界"
          description={messageOf(setup.error ?? overview.error ?? detail.error)}
          actions={<Button variant="outline" onClick={() => router.push('/apps/story-worlds')}>返回故事世界</Button>}
        />
      </PageContainer>
    );
  }

  const statusLabel = saving
    ? '保存中'
    : !isEdit
      ? session.isDirty ? '草稿未创建' : '尚未填写'
      : session.isDirty
        ? '未保存'
        : '已保存';

  const aiPanel = (
          <fieldset disabled={saving} className="min-w-0 border-0 p-0 disabled:opacity-70">
          <WorldAiPanel
            draft={values}
            fingerprint={fingerprint}
            onApply={handleApplyCandidates}
            onUndo={handleUndo}
            canUndo={Boolean(undo)}
            initialRun={session.suggestion
              ? {
                response: {
                  draftFingerprint: session.suggestion.fingerprint,
                  candidates: session.suggestion.candidates,
                  gaps: session.suggestion.gaps,
                },
                scope: session.suggestion.scope,
                instruction: session.suggestion.instruction,
                baseDraft: session.suggestion.baseDraft ?? values,
              }
              : null}
            initialSelection={session.suggestion
              ? {
                selectedIds: session.suggestion.selectedIds,
                manualIds: Array.isArray(session.suggestion.manualIds)
                  ? session.suggestion.manualIds
                  : undefined,
                excludedIds: Array.isArray(session.suggestion.excludedIds)
                  ? session.suggestion.excludedIds
                  : undefined,
                confirmations: session.suggestion.confirmations ?? [],
              }
              : null}
            onStateChange={handleAiStateChange}
            staleNotice={session.suggestion && session.suggestion.fingerprint !== fingerprint
              ? '草稿在建议生成后又改过；采纳前请逐项核对当前值。'
              : null}
          />
          </fieldset>
  );

  return (
    <PageContainer width="wide" className="wa-page pb-16 pt-2">
      <PageHeader
        title={pending ? '补全设定' : isEdit ? '世界设定' : '新建世界'}
        backHref={pending ? pendingBackHref : '/apps/story-worlds'}
        backLabel="故事世界"
        status={(
          <span
            className={`text-xs font-medium ${session.isDirty ? 'text-warning-fg' : 'text-muted'}`}
            role="status"
            aria-live="polite"
          >
            {statusLabel}
          </span>
        )}
        actions={(
          <>
            {pending && <Button ref={aiInvoker} variant="outline" size="sm" onClick={() => setAiOpen(true)}>AI 候选</Button>}
            {session.isDirty && (
              <Button variant="ghost" size="sm" onClick={discard} disabled={saving}>
                放弃修改
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={() => void save('all')} loading={saving}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {pending ? validation.ok ? '完成配置' : '保存设定' : isEdit ? '保存全部' : '创建世界'}
            </Button>
          </>
        )}
      />

      <div className={`mt-4 grid min-w-0 grid-cols-1 items-start gap-6 ${pending ? 'max-w-4xl' : 'xl:grid-cols-[minmax(0,1fr)_22rem]'}`}>
        <div className="min-w-0 space-y-8">
          {session.restoredFromLegacy && (
            <Alert variant="warning" title="已恢复旧版草稿">
              这份内容来自旧世界表单，没有可确认的修订基底。保存前请先核对下方“服务器当前值 / 你的草稿”差异并确认。
            </Alert>
          )}

          {(conflict || session.hasConflict) && (
            <Alert variant="warning" title="需要确认修订基底">
              <p>{saveError ?? conflictMessage(session.conflictKind)}</p>
              {rebasePreview ? (
                <div className="mt-3 space-y-3">
                  <p className="text-sm">
                    服务器当前为世界修订 {rebasePreview.baseRevision}{rebasePreview.branchRevision ? ` / 分支修订 ${rebasePreview.branchRevision}` : ''}。
                    {rebasePreview.fields.length === 0
                      ? '两边内容一致，可以直接采用这个基准。'
                      : `有 ${rebasePreview.fields.length} 处不同；确认后草稿内容保持不变，下次保存会以草稿覆盖这些字段。`}
                  </p>
                  {rebasePreview.fields.length > 0 && (
                    <div className="overflow-x-auto rounded-control border border-border-subtle">
                      <table className="w-full min-w-[32rem] border-collapse text-left text-xs">
                        <thead className="bg-surface-sunken/60 text-muted">
                          <tr>
                            <th scope="col" className="px-3 py-2 font-medium">字段</th>
                            <th scope="col" className="px-3 py-2 font-medium">服务器当前值</th>
                            <th scope="col" className="px-3 py-2 font-medium">你的草稿</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rebasePreview.fields.map((row) => (
                            <tr key={row.field} className="border-t border-border-subtle align-top">
                              <th scope="row" className="w-[12rem] px-3 py-2 font-medium text-ink">{row.label}</th>
                              <td className="max-w-[16rem] px-3 py-2 text-muted">
                                <ComparisonValue value={row.server} />
                              </td>
                              <td className="max-w-[16rem] px-3 py-2 text-ink">
                                <ComparisonValue value={row.draft} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" onClick={confirmRebase}>
                      确认以这个基准保存我的草稿
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRebasePreview(null)}>先不确认</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => void prepareRebase()}>
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    对比服务器当前值
                  </Button>
                </div>
              )}
            </Alert>
          )}

          {!conflict && !session.hasConflict && (saveError ?? loadError) && (
            <Alert variant="danger" title="保存没有完成" onDismiss={() => setSaveError(null)}>
              {saveError ?? loadError}
            </Alert>
          )}

          {notice && (
            <Alert variant="info" onDismiss={() => setNotice(null)}>
              {notice}
            </Alert>
          )}

          {session.branchSwitched && (
            <Alert variant="warning" title="已保留上一个分支的未保存输入" onDismiss={session.clearBranchSwitched}>
              世界设定草稿保留了下来。上一个分支（{session.switchedFromBranchId ?? '未知'}）尚未保存的名称、模式与方向
              已按分支单独保存，切回该分支即可继续编辑；当前分支显示的是它自己的内容。
            </Alert>
          )}

          {branchLocked && (
            <Alert variant="info" title="分支正在运行">
              该分支有活动运行。世界设定可以保存；分支名称、模式与故事方向需要等运行暂停或结束。
            </Alert>
          )}

          <fieldset
            disabled={saving}
            aria-busy={saving || undefined}
            className="min-w-0 space-y-8 border-0 p-0 disabled:opacity-70"
          >
          <OptionalSection enabled={pending} title="名称与简介">
          <FormSection
            title="世界简介"
            description="先写清这是一个怎样的世界。人物、地点与方向都建立在这段简介上。"
          >
            <FormField label="世界名称" required error={issueFor(shownValidation, 'title')}>
              <Input
                value={definition.title}
                maxLength={200}
                placeholder="例如：灰烬中的向量"
                onChange={(event) => patchDefinition({ title: event.target.value })}
              />
            </FormField>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="作品属性">
                <Select
                  value={definition.workNature ?? 'original'}
                  onChange={(event) => {
                    const nextNature = event.target.value as 'canon' | 'derivative' | 'original';
                    patchDefinition({
                      workNature: nextNature,
                      parentWork: nextNature === 'derivative' ? (definition.parentWork ?? '') : null,
                    });
                  }}
                >
                  <option value="canon">原作（官方 IP 正典世界）</option>
                  <option value="derivative">同人（基于原作衍生世界）</option>
                  <option value="original">原创（角色开启阶段版本）</option>
                </Select>
              </FormField>
              {definition.workNature === 'derivative' && (
                <FormField label="所属母原作">
                  <Input
                    value={definition.parentWork ?? ''}
                    maxLength={200}
                    placeholder="例如：原神"
                    onChange={(event) => patchDefinition({ parentWork: event.target.value || null })}
                  />
                </FormField>
              )}
            </div>
            <FormField
              label="世界简介"
              hint="写下时代、冲突与基调；事实与推测分开表述，AI 会把不确定处列入缺口。"
              error={issueFor(shownValidation, 'summary')}
            >
              <Textarea
                value={definition.summary}
                rows={7}
                maxLength={20000}
                placeholder="这个世界发生了什么？谁在其中行动？哪些事实不能改？"
                onChange={(event) => patchDefinition({ summary: event.target.value })}
              />
            </FormField>
          </FormSection>
          </OptionalSection>

          <FormSection
            title="开场地点"
            description={pending ? undefined : "故事从这些地点开始。人物必须落在其中一个地点，不会自动回退到第一个。"}
          >
            <div className="space-y-3">
              {definition.locations.map((location, index) => (
                <div
                  key={location.id}
                  className="rounded-panel border border-border-subtle bg-surface p-4"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-2 grid size-8 shrink-0 place-items-center rounded-control bg-surface-sunken text-muted">
                      <MapPin className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-3">
                      <FormField label="地点名称" required error={issueFor(shownValidation, `locations.${index}.name`)}>
                        <Input
                          value={location.name}
                          maxLength={200}
                          onChange={(event) => patchLocation(location.id, { name: event.target.value })}
                        />
                      </FormField>
                      <details className="group">
                        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted [&::-webkit-details-marker]:hidden">
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                          {location.description.trim()
                            ? `地点描述 · ${location.description.trim().slice(0, 24)}${location.description.trim().length > 24 ? '…' : ''}`
                            : '补充地点描述（可选）'}
                        </summary>
                        <FormField label="地点描述" hint="空间、氛围与可互动的物件。" className="mt-3">
                          <Textarea
                            value={location.description}
                            rows={2}
                            maxLength={5000}
                            onChange={(event) => patchLocation(location.id, { description: event.target.value })}
                          />
                        </FormField>
                      </details>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`删除地点 ${location.name || index + 1}`}
                      onClick={() => removeLocation(location.id)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={addLocation}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                添加地点
              </Button>
              {locationError && <p role="alert" className="text-sm text-danger-fg">{locationError}</p>}
            </div>
            {issueFor(shownValidation, 'locations') && (
              <p role="alert" className="text-sm text-danger-fg">{issueFor(shownValidation, 'locations')}</p>
            )}
          </FormSection>

          <FormSection
            title="登场人物"
            description={pending ? undefined : "每张人物卡先给可扫读的摘要；背景、目标与参考素材收在详情里。"}
          >
            {definition.actors.length === 0 && pending ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" disabled={!definition.locations.length} onClick={() => setPickerOpen(true)}>从角色库添加</Button>
                <Button variant="ghost" size="sm" disabled={!definition.locations.length} onClick={addActor}>新建人物</Button>
                {!definition.locations.length && <span className="text-sm text-muted">先添加开场地点。</span>}
              </div>
            ) : definition.actors.length === 0 ? (
              <EmptyState
                icon={UserRound}
                title="还没有人物"
                description="至少需要一名登场人物。可以从角色库导入真实版本，或直接新建原创人物。"
                actions={(
                  <>
                    <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                      <Library className="h-4 w-4" aria-hidden="true" />
                      从角色库添加
                    </Button>
                    <Button variant="ghost" size="sm" onClick={addActor}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      新建人物
                    </Button>
                  </>
                )}
              />
            ) : (
              <div className="space-y-3">
                {definition.actors.map((actor, index) => (
                  <ActorCard
                    key={actor.id}
                    actor={actor}
                    index={index}
                    locations={definition.locations}
                    nameError={issueFor(shownValidation, `actors.${index}.name`)}
                    locationError={issueFor(shownValidation, `actors.${index}.locationId`)}
                    bindingError={issueFor(shownValidation, `actors.${index}.characterId`)}
                    onPatch={(patch) => patchActor(actor.id, patch)}
                    onRemove={() => removeActor(actor.id)}
                    onPickMedia={() => setMediaTarget({ kind: 'actor', actorId: actor.id })}
                  />
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                    <Library className="h-4 w-4" aria-hidden="true" />
                    从资料库添加人物
                  </Button>
                  <Button variant="ghost" size="sm" onClick={addActor}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    新建人物
                  </Button>
                </div>
              </div>
            )}
            {issueFor(shownValidation, 'actors') && (
              <p role="alert" className="text-sm text-danger-fg">{issueFor(shownValidation, 'actors')}</p>
            )}
          </FormSection>

          <OptionalSection enabled={pending} title="故事方向">
          <FormSection
            title="故事方向"
            description="这一栏只描述从哪个时间点、以什么口径推进；它属于分支，与世界设定分开保存。"
          >
            <ShortFieldGrid>
              <FormField label="分支名称" required error={issueFor(shownValidation, 'branch.title')}>
                <Input
                  value={values.initialBranch.title}
                  maxLength={200}
                  onChange={(event) => update((current) => ({
                    ...current,
                    initialBranch: { ...current.initialBranch, title: event.target.value },
                  }))}
                />
              </FormField>
              <FormField label="分支模式" hint={BRANCH_MODE_HINTS[values.initialBranch.mode]}>
                <Select
                  value={values.initialBranch.mode}
                  disabled={branchLocked}
                  onChange={(event) => update((current) => ({
                    ...current,
                    initialBranch: {
                      ...current.initialBranch,
                      mode: event.target.value as typeof current.initialBranch.mode,
                    },
                  }))}
                >
                  {(Object.keys(BRANCH_MODE_LABELS) as Array<keyof typeof BRANCH_MODE_LABELS>).map((mode) => (
                    <option key={mode} value={mode}>{BRANCH_MODE_LABELS[mode]}</option>
                  ))}
                </Select>
              </FormField>
            </ShortFieldGrid>
            <FormField
              label="故事方向"
              hint="接下来会发生什么、冲突如何推进。保存时与分支修订一起提交。"
              error={issueFor(shownValidation, 'branch.direction')}
            >
              <Textarea
                value={values.initialBranch.direction}
                rows={5}
                maxLength={8000}
                disabled={branchLocked}
                placeholder="从当前时刻开始，哪些人物会做什么？哪些结果必须发生？"
                onChange={(event) => update((current) => ({
                  ...current,
                  initialBranch: { ...current.initialBranch, direction: event.target.value },
                }))}
              />
            </FormField>
          </FormSection>
          </OptionalSection>

          <OptionalSection enabled={pending} title="参考资料">
          <FormSection
            title="参考资料"
            description="AI 建议只引用这里选中的资料；未核实的网页会明确标为待核实。"
          >
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                <Library className="h-4 w-4" aria-hidden="true" />
                从资料库添加
              </Button>
              <span className="self-center text-xs text-muted">
                支持角色、知识库、笔记、叙事档案、项目资料与网页。
              </span>
            </div>
            {definition.sources.length === 0 ? (
              <p className="rounded-control bg-surface-sunken/50 px-3 py-2 text-sm text-muted">
                还没有参考资料。没有资料也可以写，但 AI 会把事实缺口留给你确认。
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle overflow-hidden rounded-panel border border-border-subtle bg-surface">
                {definition.sources.map((source) => (
                  <li key={source.id} className="flex min-w-0 items-start gap-3 px-3 py-2.5">
                    <Badge variant={SOURCE_NATURE_META[source.nature].tone}>
                      {SOURCE_NATURE_META[source.nature].label}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink" title={source.title}>{source.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">
                        {source.content || '没有正文摘要。'}
                      </p>
                      {source.sourceUrl && (
                        <a
                          href={source.sourceUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mt-1 inline-block max-w-full truncate text-xs text-accent underline underline-offset-2"
                        >
                          {source.sourceUrl}
                        </a>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`移除来源 ${source.title}`}
                      onClick={() => update((current) => ({
                        ...current,
                        definition: {
                          ...current.definition,
                          sources: current.definition.sources.filter((item) => item.id !== source.id),
                        },
                      }))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </FormSection>
          </OptionalSection>

          <section className="min-w-0">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-panel border border-border-subtle bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus-ring"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((current) => !current)}
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">高级设定</span>
                <span className="mt-0.5 block text-xs text-muted">时间、锁定事实、画面风格、画面参考与模型绑定。</span>
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>

            {advancedOpen && (
              <div className="mt-6 space-y-8">
                <FormSection title="时间" description="只定义世界起点的钟点；留空表示未定义，不根据文风推测昼夜。">
                  <ShortFieldGrid>
                    <FormField label="时间标签" hint="给作者看的文字，例如“第三纪元 · 雨季”。">
                      <Input
                        value={definition.timeLabel}
                        maxLength={200}
                        onChange={(event) => patchDefinition({ timeLabel: event.target.value })}
                      />
                    </FormField>
                    <FormField
                      label="起点时刻"
                      hint="24 小时制，留空表示未定义。"
                      error={timeError ?? undefined}
                    >
                      <Input
                        type="time"
                        value={timeInput ?? formatMinuteOfDay(definition.startMinuteOfDay)}
                        onChange={(event) => handleTimeChange(event.target.value)}
                      />
                    </FormField>
                  </ShortFieldGrid>
                </FormSection>

                <FormSection title="锁定事实" description="每行一条。运行时这些事实不可被改写。">
                  <FormField
                    label="不可改动的设定"
                    hint="只写确定的事实；推测请放进简介或故事方向。"
                    error={issueFor(shownValidation, 'lockedFacts')}
                  >
                    <Textarea
                      value={definition.lockedFacts.join('\n')}
                      rows={5}
                      onChange={(event) => patchDefinition({ lockedFacts: event.target.value.split('\n') })}
                    />
                  </FormField>
                </FormSection>

                <FormSection title="画面" description="统一画风用于配图一致性；场景锚点与道具只影响画面，不改写世界事实。">
                  <FormField
                    label="画面风格"
                    hint="描述材质、光线与镜头语言，避免只写一个画派名。"
                    error={issueFor(shownValidation, 'visualStyle')}
                  >
                    <Textarea
                      value={definition.visualStyle}
                      rows={3}
                      maxLength={8000}
                      onChange={(event) => patchDefinition({ visualStyle: event.target.value })}
                    />
                  </FormField>

                  <div className="space-y-3">
                    {(definition.visualReferences ?? []).map((reference) => (
                      <div key={reference.id} className="rounded-panel border border-border-subtle bg-surface p-4">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="min-w-0 flex-1 space-y-3">
                            <ShortFieldGrid>
                              <FormField label="名称">
                                <Input
                                  value={reference.name}
                                  maxLength={200}
                                  onChange={(event) => update((current) => ({
                                    ...current,
                                    definition: {
                                      ...current.definition,
                                      visualReferences: (current.definition.visualReferences ?? []).map((item) => (
                                        item.id === reference.id ? { ...item, name: event.target.value } : item
                                      )),
                                    },
                                  }))}
                                />
                              </FormField>
                              <FormField label="类型">
                                <Select
                                  value={reference.kind}
                                  onChange={(event) => update((current) => ({
                                    ...current,
                                    definition: {
                                      ...current.definition,
                                      visualReferences: (current.definition.visualReferences ?? []).map((item) => (
                                        item.id === reference.id
                                          ? { ...item, kind: event.target.value as WorldVisualReference['kind'] }
                                          : item
                                      )),
                                    },
                                  }))}
                                >
                                  <option value="location">场景锚点</option>
                                  <option value="prop">重要道具</option>
                                </Select>
                              </FormField>
                            </ShortFieldGrid>
                            {reference.kind === 'location' && (
                              <FormField label="对应地点">
                                <Select
                                  value={reference.locationId ?? reference.id}
                                  onChange={(event) => update((current) => ({
                                    ...current,
                                    definition: {
                                      ...current.definition,
                                      visualReferences: (current.definition.visualReferences ?? []).map((item) => (
                                        item.id === reference.id ? { ...item, locationId: event.target.value } : item
                                      )),
                                    },
                                  }))}
                                >
                                  {definition.locations.map((location) => (
                                    <option key={location.id} value={location.id}>{location.name}</option>
                                  ))}
                                </Select>
                              </FormField>
                            )}
                            <FormField label="画面说明">
                              <Textarea
                                value={reference.description}
                                rows={2}
                                maxLength={5000}
                                onChange={(event) => update((current) => ({
                                  ...current,
                                  definition: {
                                    ...current.definition,
                                    visualReferences: (current.definition.visualReferences ?? []).map((item) => (
                                      item.id === reference.id ? { ...item, description: event.target.value } : item
                                    )),
                                  },
                                }))}
                              />
                            </FormField>
                            <MediaReferenceField
                              value={reference.referenceArtifactIds}
                              onOpen={() => setMediaTarget({ kind: 'visual', referenceId: reference.id })}
                              onClear={() => update((current) => ({
                                ...current,
                                definition: {
                                  ...current.definition,
                                  visualReferences: (current.definition.visualReferences ?? []).map((item) => (
                                    item.id === reference.id ? { ...item, referenceArtifactIds: [] } : item
                                  )),
                                },
                              }))}
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`删除画面参考 ${reference.name}`}
                            onClick={() => update((current) => ({
                              ...current,
                              definition: {
                                ...current.definition,
                                visualReferences: (current.definition.visualReferences ?? []).filter((item) => item.id !== reference.id),
                              },
                            }))}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => update((current) => ({
                          ...current,
                          definition: {
                            ...current.definition,
                            visualReferences: [
                              ...(current.definition.visualReferences ?? []),
                              createVisualReference('location', current.definition.locations[0]?.id),
                            ],
                          },
                        }))}
                      >
                        <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        添加场景锚点
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => update((current) => ({
                          ...current,
                          definition: {
                            ...current.definition,
                            visualReferences: [
                              ...(current.definition.visualReferences ?? []),
                              createVisualReference('prop'),
                            ],
                          },
                        }))}
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        添加道具参考
                      </Button>
                    </div>
                  </div>
                </FormSection>

                <FormSection title="模型绑定" description="留空表示跟随公共配置；这里只覆盖本世界。">
                  <ShortFieldGrid>
                    {MODEL_PURPOSES.map((purpose) => (
                      <FormField key={purpose} label={MODEL_PURPOSE_LABELS[purpose]}>
                        <Select
                          value={definition.models[purpose] ?? ''}
                          onChange={(event) => update((current) => ({
                            ...current,
                            definition: {
                              ...current.definition,
                              models: { ...current.definition.models, [purpose]: event.target.value || null },
                            },
                          }))}
                        >
                          <option value="">跟随公共配置</option>
                          {modelOptions.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name}{profile.model ? ` · ${profile.model}` : ''}{profile.enabled ? '' : '（已停用）'}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                    ))}
                  </ShortFieldGrid>
                  {modelOptions.length === 0 && (
                    <p className="text-xs text-muted">
                      暂时读不到模型目录；仍可保存“跟随公共配置”，不影响世界内容。
                    </p>
                  )}
                </FormSection>
              </div>
            )}
          </section>
          </fieldset>

          {!pending && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4">
            <p className="text-xs text-muted">
              {session.isDirty
                ? branchLocked && branchChanged
                  ? '草稿会自动保留在本会话；该分支正在运行，只能先保存世界设定。'
                  : '草稿会自动保留在本会话；保存前不会写入服务器。'
                : '没有未保存的修改。'}
            </p>
            <div className="flex flex-wrap gap-2">
              {session.isDirty && (
                <Button variant="ghost" onClick={discard} disabled={saving}>放弃修改</Button>
              )}
              {isEdit ? (
                <>
                  <Button variant="outline" onClick={() => void save('world')} loading={saving}>
                    只保存世界设定
                  </Button>
                  {branchChanged && (
                    <Button
                      variant="outline"
                      onClick={() => void save('branch')}
                      loading={saving}
                      disabled={branchLocked}
                    >
                      只保存分支设定
                    </Button>
                  )}
                  <Button variant="primary" onClick={() => void save('all')} loading={saving}>
                    <Save className="h-4 w-4" aria-hidden="true" />
                    保存全部
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => void save('all')} loading={saving}>
                  <Save className="h-4 w-4" aria-hidden="true" />
                  创建世界
                </Button>
              )}
            </div>
          </div>}
        </div>

        {pending ? (
          <Drawer open={aiOpen} onOpenChange={setAiOpen} title="生成设定建议" invokerRef={aiInvoker} keepMounted>
            {aiPanel}
          </Drawer>
        ) : <aside className="min-w-0 xl:sticky xl:top-4">{aiPanel}</aside>}
      </div>

      <WorldResourcePicker
        open={pickerOpen && !saving}
        onOpenChange={setPickerOpen}
        draft={values}
        projectId={projectId || undefined}
        onAddActors={addActors}
        onAddSources={addSources}
        onReplaceActors={replaceActorVersions}
        onReplaceSources={replaceSourceVersions}
      />

      <MediaReferencePicker
        open={Boolean(mediaTarget) && !saving}
        onOpenChange={(open) => { if (!open) setMediaTarget(null); }}
        value={mediaValue}
        onChange={setMediaValue}
        max={10}
      />
    </PageContainer>
  );
}

/** 冲突对照里的一侧值：短文本直接显示，长文本/JSON 展开可滚动，绝不截断到看不见差异。 */
function ComparisonValue({ value }: { value: string }) {
  const isLong = value.length > 120 || value.includes('\n');
  if (!isLong) {
    return <span className="whitespace-pre-wrap break-words">{value}</span>;
  }
  return (
    <details className="min-w-0">
      <summary className="cursor-pointer text-xs text-accent underline underline-offset-2">
        展开 {value.length} 字符
      </summary>
      <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-control bg-surface-sunken/60 p-2 text-[11px] leading-relaxed">
        {value}
      </pre>
    </details>
  );
}

function ActorCard({
  actor,
  index,
  locations,
  nameError,
  locationError,
  bindingError,
  onPatch,
  onRemove,
  onPickMedia,
}: {
  actor: WorldActor;
  index: number;
  locations: WorldLocation[];
  nameError?: string;
  locationError?: string;
  bindingError?: string;
  onPatch: (patch: Partial<WorldActor>) => void;
  onRemove: () => void;
  onPickMedia: () => void;
}) {
  const location = locations.find((item) => item.id === actor.locationId);
  const [goalsText, setGoalsText] = useState(actor.goals.join('\n'));
  const goalsRef = useRef<HTMLTextAreaElement | null>(null);
  const goalsSignature = actor.goals.join('\u0000');
  useEffect(() => {
    if (goalsRef.current && document.activeElement === goalsRef.current) return;
    setGoalsText(actor.goals.join('\n'));
  }, [goalsSignature, actor.goals]);

  return (
    <div className="rounded-panel border border-border-subtle bg-surface px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-control bg-surface-sunken text-muted">
          <UserRound className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Input
              value={actor.name}
              maxLength={200}
              placeholder="人物名称"
              aria-label="人物名称"
              aria-invalid={Boolean(nameError) || undefined}
              className="h-9 min-w-0 flex-1 border-transparent bg-transparent px-0 text-sm font-semibold hover:border-border-subtle focus:border-border-control"
              onChange={(event) => onPatch({ name: event.target.value })}
            />
            <Badge variant={actor.role === 'main' ? 'accent' : 'secondary'}>
              {actor.role === 'main' ? '主角' : '配角'}
            </Badge>
          </div>
          {nameError && <p role="alert" className="text-xs text-danger-fg">{nameError}</p>}
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
              所在地点
              <Select
                value={actor.locationId}
                aria-invalid={Boolean(locationError) || undefined}
                onChange={(event) => onPatch({ locationId: event.target.value })}
              >
                {!location && <option value={actor.locationId}>（地点已失效，请重新选择）</option>}
                {locations.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </Select>
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
              处境
              <Input
                value={actor.background}
                maxLength={20000}
                placeholder="一句话说明人物现在的处境"
                onChange={(event) => onPatch({ background: event.target.value })}
              />
            </label>
          </div>
          {locationError && <p role="alert" className="text-xs text-danger-fg">{locationError}</p>}
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
            当前目标
            <Textarea
              ref={goalsRef}
              value={goalsText}
              rows={2}
              placeholder="每行一条目标"
              onChange={(event) => {
                const raw = event.target.value;
                setGoalsText(raw);
                onPatch({ goals: raw.split('\n').map((goal) => goal.trim()).filter(Boolean).slice(0, 30) });
              }}
            />
          </label>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`移除人物 ${actor.name || index + 1}`}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <details className="group mt-3 border-t border-border-subtle pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-muted [&::-webkit-details-marker]:hidden">
          <span>详细档案 · 定位、性格、说话方式、外貌、角色库绑定与参考素材</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="mt-3 space-y-3">
          <ShortFieldGrid>
            <FormField label="角色定位">
              <Select
                value={actor.role}
                onChange={(event) => onPatch({ role: event.target.value as WorldActor['role'] })}
              >
                <option value="main">主角</option>
                <option value="supporting">配角</option>
              </Select>
            </FormField>
            <FormField label="角色库绑定" error={bindingError}>
              <div className="flex min-h-[var(--control-h)] min-w-0 flex-wrap items-center gap-2 rounded-control border border-border-subtle bg-surface-sunken/40 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-muted">
                  {actor.characterId
                    ? `${actor.characterId}${actor.characterVersion !== null ? ` · v${actor.characterVersion}` : ' · 缺少版本'}`
                    : '原创人物（未绑定角色库）'}
                </span>
                {actor.characterId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onPatch({ characterId: null, characterVersion: null })}
                  >
                    解除绑定
                  </Button>
                )}
              </div>
            </FormField>
          </ShortFieldGrid>
          <ShortFieldGrid>
            <FormField label="性格">
              <Textarea
                value={actor.personality}
                rows={3}
                maxLength={8000}
                onChange={(event) => onPatch({ personality: event.target.value })}
              />
            </FormField>
            <FormField label="说话方式">
              <Textarea
                value={actor.speechStyle}
                rows={3}
                maxLength={4000}
                onChange={(event) => onPatch({ speechStyle: event.target.value })}
              />
            </FormField>
          </ShortFieldGrid>
          <FormField label="外貌">
            <Textarea
              value={actor.appearance}
              rows={2}
              maxLength={5000}
              onChange={(event) => onPatch({ appearance: event.target.value })}
            />
          </FormField>
          <MediaReferenceField
            value={actor.referenceArtifactIds}
            onOpen={onPickMedia}
            onClear={() => onPatch({ referenceArtifactIds: [] })}
          />
        </div>
      </details>
    </div>
  );
}
