'use client';
import type React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  ActivityPlanningCandidate,
  ActivityPlanningJob,
  ActivityPlanningOutput,
  ActivityPlanningSessionResponse,
  PlanningSelectionState,
  ResearchTask,
} from '@sthstart/contracts';
import { cancelPlanningJob, fetchPlanningJob, fetchPlanningSession, retryPlanningJob, savePlanningResearchSelection, triggerPlanningJob } from '@/app/features/activities/api/planning';
import { activePlanPayload, mergeGeneratedPlans, type PlanOverride } from '../plan-model';
import { pollPlanning } from '../polling';
import { buildResearchSelectionPayload } from '../research-model';
import { validateGeneratePlans } from '../steps';
import type { CustomLocation, IntakeForm } from '../types';

export function usePlanningGeneration({
  intake,
  session,
  research,
  customLocations,
  syncSession,
  applySession,
  setStep,
  setError,
  setNotice,
  mountedRef,
  setResearch,
}: {
  intake: IntakeForm;
  session: ActivityPlanningSessionResponse | null;
  research: import('@sthstart/contracts').ResearchTask | null;
  customLocations: CustomLocation[];
  syncSession: (selection: PlanningSelectionState | null, researchRevisionId: string | null, sessionIdOverride?: string) => Promise<ActivityPlanningSessionResponse>;
  applySession: (next: ActivityPlanningSessionResponse | null) => void;
  setStep: (step: 0 | 1 | 2 | 3) => void;
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
  mountedRef: React.MutableRefObject<boolean>;
  setResearch: (task: ResearchTask) => void;
}) {
  const [plans, setPlans] = useState<ActivityPlanningCandidate[]>([]);
  const [job, setJob] = useState<ActivityPlanningJob | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [planOverride, setPlanOverride] = useState<PlanOverride | null>(null);
  const [planCount, setPlanCount] = useState(3);
  const [revisionNote, setRevisionNote] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editValue, setEditValue] = useState<ActivityPlanningOutput | null>(null);
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false);

  const selectedCandidate = plans.find((plan) => plan.id === selectedPlanId) ?? null;
  const activePayload = useMemo(
    () => activePlanPayload(plans, selectedPlanId, planOverride),
    [plans, selectedPlanId, planOverride],
  );

  const pollJob = useCallback(async (id: string, jobId: string) => pollPlanning({
    read: () => fetchPlanningJob(id, jobId),
    onValue: (result) => setJob(result.job),
    done: (result) => result.job.status !== 'queued' && result.job.status !== 'running',
    isMounted: () => mountedRef.current,
  }), [mountedRef]);

  const generatePlans = async (options: { keepExisting?: boolean } = {}) => {
    if (generatingRef.current) return;
    setError(null); setNotice(null);
    const invalid = validateGeneratePlans(intake);
    if (invalid) { setError(invalid); setStep(0); return; }
    generatingRef.current = true;
    setGenerating(true);
    try {
      // 先保证会话存在，再按当前候选状态写选择，最后把表单推成与页面一致。
      const current = await syncSession(session?.session.form.selection ?? null, session?.session.researchRevisionId ?? null);
      let selection: PlanningSelectionState | null = current.session.form.selection ?? null;
      if (research && (research.status === 'succeeded' || research.status === 'incomplete')) {
        const saved = await savePlanningResearchSelection(current.session.id, research.id, buildResearchSelectionPayload(research, customLocations));
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
        setPlans((previous) => mergeGeneratedPlans({
          plans: previous,
          generated: finished.candidates,
          keepExisting: Boolean(options.keepExisting),
        }));
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
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  const retryLastJob = async () => {
    const sessionId = session?.session.id;
    if (generatingRef.current || !sessionId || !job) return;
    generatingRef.current = true;
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
      } else {
        setError(finished?.job.errorMessage || '任务尚未完成，可以刷新页面继续查看。');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '重试失败。');
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  const cancelGeneration = async () => {
    const sessionId = session?.session.id;
    if (!sessionId || !job) return;
    try {
      setJob(await cancelPlanningJob(sessionId, job.id));
      setNotice('已取消生成，已经完成的方案会保留。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '取消失败。');
    }
  };

  const openPlanEditor = () => {
    if (!activePayload) return;
    setEditValue(JSON.parse(JSON.stringify(activePayload)) as ActivityPlanningOutput);
    setEditOpen(true);
  };

  const savePlanEdit = () => {
    if (!selectedCandidate || !editValue) return;
    const override = { candidateId: selectedCandidate.id, payload: editValue };
    setPlanOverride(override);
    try {
      localStorage.setItem('planning-edit:' + session?.session.id, JSON.stringify(override));
    } catch { /* 本地存储不可用时保留当前页面草稿 */ }
    setEditOpen(false);
  };

  const updateEditActivity = (key: keyof ActivityPlanningOutput['activity'], value: string) => {
    setEditValue((current) => current ? { ...current, activity: { ...current.activity, [key]: value } } : current);
  };
  const updateEditStage = (index: number, key: 'title' | 'location' | 'description' | 'endCondition', value: string) => {
    setEditValue((current) => current ? { ...current, stages: current.stages.map((stage, stageIndex) => stageIndex === index ? { ...stage, [key]: value } : stage) } : current);
  };

  return {
    plans,
    setPlans,
    job,
    setJob,
    selectedPlanId,
    setSelectedPlanId,
    expandedPlanId,
    setExpandedPlanId,
    planOverride,
    setPlanOverride,
    planCount,
    setPlanCount,
    revisionNote,
    setRevisionNote,
    editOpen,
    setEditOpen,
    editValue,
    generating,
    setGenerating,
    selectedCandidate,
    activePayload,
    pollJob,
    generatePlans,
    retryLastJob,
    cancelGeneration,
    openPlanEditor,
    savePlanEdit,
    updateEditActivity,
    updateEditStage,
  };
}
