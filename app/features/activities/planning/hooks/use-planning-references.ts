'use client';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  ActivityIdea,
  ActivityIdeaBatch,
  ActivityPlanningSessionResponse,
  KnowledgeSearchItem,
  PlanningReferenceUsage,
  PlanningSelectionState,
} from '@sthstart/contracts';
import { applyIdea } from '@/app/features/topics/api';
import { previewReferences } from '@/app/features/notebook/api';
import { fetchMcpSources } from '@/app/features/mcp-sources/api';
import { browseCharacters } from '@/app/features/characters/api';
import { characterFacetKeys, mcpSourceKeys } from '@/app/lib/query-keys';
import type { AssistantSelection } from '@/app/features/knowledge/components/reference-assistant';
import { fetchPlanningSession } from '@/app/features/activities/api/planning';
import {
  appendReferences,
  parseReferenceSelections,
  referenceFromFrozen,
  toReferenceSelections,
} from '../references-model';
import type { IntakeForm, ReferenceDraft, ReferencePreviewState } from '../types';

export function usePlanningReferences({
  params,
  session,
  intake,
  setIntake,
  references,
  setReferences,
  syncSession,
  applySession,
  setBusy,
  setError,
  setNotice,
  mountedRef,
}: {
  params: { get(name: string): string | null };
  session: ActivityPlanningSessionResponse | null;
  intake: IntakeForm;
  setIntake: React.Dispatch<React.SetStateAction<IntakeForm>>;
  references: ReferenceDraft[];
  setReferences: React.Dispatch<React.SetStateAction<ReferenceDraft[]>>;
  syncSession: (selection: PlanningSelectionState | null, researchRevisionId: string | null, sessionIdOverride?: string) => Promise<ActivityPlanningSessionResponse>;
  applySession: (next: ActivityPlanningSessionResponse | null) => void;
  setBusy: (value: boolean) => void;
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
  mountedRef: React.MutableRefObject<boolean>;
}) {
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [referencePreview, setReferencePreview] = useState<ReferencePreviewState | null>(null);
  const [recommendOpen, setRecommendOpen] = useState(false);
  const [updateCheckOpen, setUpdateCheckOpen] = useState(false);
  const [gapOpen, setGapOpen] = useState(false);
  const [inspirationOpen, setInspirationOpen] = useState(false);
  const [pendingIdea, setPendingIdea] = useState<{ batch: ActivityIdeaBatch; idea: ActivityIdea } | null>(null);
  const [replaceFields, setReplaceFields] = useState(false);
  const refsSeededRef = useRef(false);

  const sourcesQuery = useQuery({ queryKey: mcpSourceKeys.all, queryFn: fetchMcpSources, staleTime: 30_000 });
  const worksQuery = useQuery({
    queryKey: characterFacetKeys.works(),
    queryFn: () => browseCharacters({ page: 1, pageSize: 1 }),
    staleTime: 60_000,
  });
  const enabledSources = useMemo(() => (sourcesQuery.data ?? []).filter((source) => source.status === 'enabled'), [sourcesQuery.data]);
  const workOptions = useMemo(() => (worksQuery.data?.facets.works ?? []).map((work) => work.name), [worksQuery.data]);

  // 从「待整理」带进来的来源：用返回的快照内容填充参考资料，只引用已保存的内容。
  useEffect(() => {
    const selections = parseReferenceSelections(params.get('refs'));
    if (!selections.length || refsSeededRef.current) return;
    refsSeededRef.current = true;
    void (async () => {
      try {
        const result = await previewReferences(selections);
        if (!mountedRef.current) return;
        setReferences((current) => appendReferences(current, result.snapshot.references.map(referenceFromFrozen)));
        setNotice('已把选中的来源加入参考资料；生成时会以它们为依据。');
      } catch {
        if (mountedRef.current) setError('来源内容读取失败，可以在参考资料里手动搜索添加。');
      }
    })();
  }, [mountedRef, params, setError, setNotice, setReferences]);

  /** 预览实际会送给模型的引用内容：截断情况如实显示。 */
  const previewSelectedReferences = async () => {
    if (!references.length) return;
    setBusy(true); setError(null);
    try {
      const result = await previewReferences(toReferenceSelections(references));
      setReferencePreview(result);
      setReferences((current) => current.map((item) => {
        const frozen = result.snapshot.references.find((ref) => ref.sourceKind === item.sourceKind && ref.sourceId === item.sourceId);
        return frozen ? { ...item, frozenReference: frozen, excerpt: frozen.excerpt } : item;
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取引用内容失败。');
    } finally {
      setBusy(false);
    }
  };

  /** 加入参考资料：同一来源只保留一条，重复添加不产生第二份。 */
  const addReferences = async (items: Array<{ item: KnowledgeSearchItem; usage: PlanningReferenceUsage }>) => {
    try {
      const result = await previewReferences(items.map(({ item, usage }) => ({ sourceKind: item.kind, sourceId: item.id, usage })));
      addAssistantReferences(result.snapshot.references.map((reference) => ({ ...reference, frozenReference: reference })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取引用内容失败。');
    }
  };

  /** 把助手解析出来的引用草稿加入参考资料：同一来源只保留一条。 */
  const addAssistantReferences = (items: AssistantSelection[]) => {
    setReferences((current) => appendReferences(current, items.map((item) => ({
      key: item.sourceKind + ':' + item.sourceId,
      sourceKind: item.sourceKind,
      sourceId: item.sourceId,
      usage: item.usage,
      title: item.title,
      excerpt: item.excerpt,
      ...(item.nature ? { nature: item.nature } : {}),
      ...(item.authorship ? { authorship: item.authorship } : {}),
      frozenReference: item.frozenReference,
    }))));
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
    const reference = session?.session.form.knowledgeSnapshot?.references.find((item) => item.id === referenceId);
    if (!reference || reference.externalSource) return;
    const result = await previewReferences([{ sourceKind: reference.sourceKind, sourceId: currentSourceId ?? reference.sourceId, usage: reference.usage }]);
    const fresh = result.snapshot.references[0];
    if (!fresh) throw new Error('来源已不可用，可以继续使用旧内容。');
    setReferences((current) => current.map((entry) => entry.sourceKind === reference.sourceKind && entry.sourceId === reference.sourceId
      ? { ...entry, key: fresh.sourceKind + ':' + fresh.sourceId, sourceId: fresh.sourceId, frozenReference: fresh, pinnedExcerpt: undefined, excerpt: fresh.excerpt, title: fresh.title }
      : entry));
    setNotice('已选择更新这一条参考；重新生成后生效。');
  };

  /**
   * 从话题素材找灵感：先把点子会填入的标题、主题与要求展示给用户，
   * 再由用户决定是否采用。采用时把灵感来源快照写进企划会话。
   */
  const adoptInspiration = async (batch: ActivityIdeaBatch, idea: ActivityIdea, replace: boolean) => {
    setError(null); setNotice(null); setBusy(true);
    try {
      const current = await syncSession(session?.session.form.selection ?? null, session?.session.researchRevisionId ?? null);
      const overrides = replace
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
      setNotice('已采用点子「' + idea.name + '」：' + (replace ? '标题与主题已替换' : '只填空了未填写的标题与主题') + '，灵感来源已写入企划。');
      setInspirationOpen(false);
      setPendingIdea(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '采用点子失败。');
    } finally {
      setBusy(false);
    }
  };

  return {
    sourcesQuery,
    enabledSources,
    workOptions,
    referencePickerOpen,
    setReferencePickerOpen,
    referencePreview,
    setReferencePreview,
    recommendOpen,
    setRecommendOpen,
    updateCheckOpen,
    setUpdateCheckOpen,
    gapOpen,
    setGapOpen,
    inspirationOpen,
    setInspirationOpen,
    pendingIdea,
    setPendingIdea,
    replaceFields,
    setReplaceFields,
    previewSelectedReferences,
    addReferences,
    addAssistantReferences,
    pinOldReference,
    refreshReference,
    adoptInspiration,
  };
}
