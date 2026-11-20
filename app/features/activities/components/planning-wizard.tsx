'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { ActorSnapshot, PlanningReferenceSelection, PlanningReferenceUsage, ResearchTask } from '@sthstart/contracts';
import { fetchActivityCharacterSnapshot } from '@/app/features/activities/api/images';
import { fetchPlanningResearchTasks, fetchPlanningSession } from '@/app/features/activities/api/planning';
import { useActivityCapabilities, useActivityPresets } from '@/app/features/activities/queries/activities';
import { PageHeader } from '@/app/components/shared/page-header';
import { PageContainer } from '@/app/components/shared/page-layout';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { defaultIntake, mergeCast, type PlanningTemplatePreset } from '../planning/intake-model';
import { referenceFromSelection } from '../planning/references-model';
import { isRunningJob, selectedActorIds as collectSelectedActorIds } from '../planning/plan-model';
import { isTerminalResearch } from '../planning/research-model';
import { stepsDone } from '../planning/steps';
import type { IntakeForm, ReferenceDraft, StepIndex } from '../planning/types';
import { usePlanningSession } from '../planning/hooks/use-planning-session';
import { usePlanningReferences } from '../planning/hooks/use-planning-references';
import { usePlanningResearch } from '../planning/hooks/use-planning-research';
import { usePlanningGeneration } from '../planning/hooks/use-planning-generation';
import { usePlanningCast } from '../planning/hooks/use-planning-cast';
import { usePlanningCommit } from '../planning/hooks/use-planning-commit';
import { PlanningIntentStep } from '../planning/components/intent-step';
import { PlanningCandidatesStep } from '../planning/components/candidates-step';
import { PlanningPlansStep } from '../planning/components/plans-step';
import { PlanningConfirmStep } from '../planning/components/confirm-step';
import { PlanningFooter, PlanningStepNav } from '../planning/components/planning-controls';
import { PlanningReferenceDialogs } from '../planning/components/reference-dialogs';
import { PlanningIdeaDialogs } from '../planning/components/idea-dialogs';
import { PlanningCastDialogs } from '../planning/components/cast-dialogs';
import { PlanningPlanEditorDialog } from '../planning/components/plan-editor-dialog';

const MCP_SETTINGS_HREF = '/settings/public-services?section=models';

export function PlanningWizard({ onExitWizard }: { onExitWizard?: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const client = useQueryClient();
  const initialTemplate = params.get('template') || 'blank';
  const initialDate = params.get('date') || '';
  const initialCharacterIds = useMemo(
    () => (params.get('characters') || '').split(',').map((value) => value.trim()).filter(Boolean),
    [params],
  );

  const [step, setStep] = useState<StepIndex>(0);
  const [intake, setIntake] = useState<IntakeForm>(() => defaultIntake(initialTemplate, initialDate));
  const [tab, setTab] = useState<'characters' | 'locations'>('characters');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [references, setReferences] = useState<ReferenceDraft[]>([]);
  const castSnapshotsRef = useRef(new Map<string, ActorSnapshot>());
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const { data: capabilities } = useActivityCapabilities();
  const { data: userPresetsData } = useActivityPresets('activity_template');
  const userTemplates = userPresetsData?.items || [];
  const userTemplateMap = useMemo(() => new Map<string, PlanningTemplatePreset>(
    userTemplates.map((template) => [template.id, { id: template.id, payload: (template.payload ?? {}) as Record<string, unknown> }]),
  ), [userTemplates]);
  const maxActors = capabilities?.limits.maxActors ?? 20;
  const llmReady = capabilities ? (capabilities.llmStatus ? capabilities.llmStatus.ready : capabilities.llm) : null;

  const sessionApi = usePlanningSession({
    params,
    router,
    intake,
    references,
    userTemplate: userTemplateMap.get(intake.templateId),
  });
  const { session, sessionId, applySession, syncSession, refreshSession, resumeRef } = sessionApi;
  const referenceApi = usePlanningReferences({
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
  });
  const researchApi = usePlanningResearch({
    intake,
    session,
    syncSession,
    applySession,
    setStep,
    setBusy,
    setError,
    setNotice,
    mountedRef,
  });
  const generationApi = usePlanningGeneration({
    intake,
    session,
    research: researchApi.research,
    customLocations: researchApi.customLocations,
    syncSession,
    applySession,
    setStep,
    setError,
    setNotice,
    mountedRef,
    setResearch: researchApi.setResearch,
  });
  const handleRefreshSession = async () => {
    const fresh = await refreshSession();
    if (fresh?.candidates?.length && !generationApi.plans.length) generationApi.setPlans(fresh.candidates);
  };
  const castApi = usePlanningCast({
    sessionId,
    maxActors,
    castSnapshotsRef,
    setIntake,
    refreshSession: handleRefreshSession,
    setBusy,
    setError,
    setNotice,
    mountedRef,
    client,
  });
  const pendingActors = useMemo(() => {
    const selected = collectSelectedActorIds(generationApi.activePayload);
    return (session?.pendingActors ?? []).filter((actor) => selected.has(actor.actorId));
  }, [generationApi.activePayload, session?.pendingActors]);
  const selectedActorIds = useMemo(() => collectSelectedActorIds(generationApi.activePayload), [generationApi.activePayload]);
  const commitApi = usePlanningCommit({
    intake,
    customCast: castApi.customCast,
    castSnapshotsRef,
    session,
    activePayload: generationApi.activePayload,
    selectedCandidate: generationApi.selectedCandidate,
    selectedActorIds,
    setBusy,
    setError,
    setNotice,
    router,
    client,
  });

  const setIntakeField = useCallback(<K extends keyof IntakeForm>(key: K, value: IntakeForm[K]) => {
    setIntake((current) => ({ ...current, [key]: value }));
  }, []);
  const toggleWork = (work: string) => setIntake((current) => ({
    ...current,
    crossoverWorks: current.crossoverWorks.includes(work) ? current.crossoverWorks.filter((item) => item !== work) : [...current.crossoverWorks, work],
  }));
  const leadName = intake.cast.find((member) => member.characterId === intake.leadCharacterId)?.displayName ?? '';
  const summaries = session?.summaries ?? [];
  const snapshotReferences = session?.session.form.knowledgeSnapshot?.references ?? [];
  const actorName = (actorId: string) => session?.session.document.actors.find((actor) => actor.id === actorId)?.displayName ?? actorId;
  const done = (index: number) => stepsDone({ index, sessionId, planCount: generationApi.plans.length, selectedPlanId: generationApi.selectedPlanId });

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
        const names = actors.map((actor) => actor.displayName);
        setIntake((current) => ({
          ...current,
          cast: mergeCast(current.cast, actors, maxActors),
          birthdayIds: current.templateId === 'birthday' ? [...new Set([...current.birthdayIds, ...actors.map((actor) => String(actor.sourceCharacterId))])] : current.birthdayIds,
          title: current.title || (names.length ? `${names.join('、')}的生日聚会` : current.title),
        }));
      } catch (cause) {
        if (mountedRef.current) setError(`${cause instanceof Error ? cause.message : '带入角色失败。'} 请在角色库保存原创角色的具名阶段，再从“选择角色”加入企划。`);
      }
    })();
  }, [initialCharacterIds, maxActors]);

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
        response.session.document.actors.forEach(actor => {
          if (actor.sourceCharacterId) castSnapshotsRef.current.set(String(actor.sourceCharacterId), actor);
        });
        const restoredCast = response.session.document.actors
          .filter((actor) => actor.sourceCharacterId && response.session.form.characters.some((member) => member.characterId === actor.sourceCharacterId))
          .map((actor) => ({
            characterId: String(actor.sourceCharacterId),
            displayName: actor.displayName,
            avatarUrl: actor.avatarUrl,
            activityRole: actor.activityRole,
            ...(actor.sourceVersion != null ? { version: actor.sourceVersion } : {}),
            ...(actor.sourceVariantId ? { variantId: actor.sourceVariantId } : {}),
            ...(actor.sourceCostumeAssetId ? { costumeAssetId: actor.sourceCostumeAssetId } : {}),
          }));
        const form = response.session.form;
        setReferences((form.references ?? []).map((selection: PlanningReferenceSelection) => referenceFromSelection(selection, form.knowledgeSnapshot)));
        applySession(response);
        generationApi.setPlans(response.candidates ?? []);
        generationApi.setJob(response.jobs[0] ?? null);
        researchApi.setResearch(latest);
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
        generationApi.setSelectedPlanId(first?.id ?? null);
        try {
          const saved = JSON.parse(localStorage.getItem('planning-edit:' + resumeId) || 'null');
          if (saved?.payload && response.candidates.some((candidate) => candidate.id === saved.candidateId)) {
            generationApi.setPlanOverride(saved);
            generationApi.setSelectedPlanId(saved.candidateId);
          }
        } catch { /* 旧草稿不可读时使用服务端方案 */ }
        setStep(response.candidates?.length ? 2 : latest ? 1 : 0);
        setNotice('已恢复上次的企划会话。');
        const activeJob = response.jobs.find((item) => item.status === 'queued' || item.status === 'running');
        if (latest && !isTerminalResearch(latest.status)) {
          researchApi.setResearching(true);
          try {
            await researchApi.pollResearch(resumeId, latest.id);
            applySession(await fetchPlanningSession(resumeId));
          } finally {
            if (mountedRef.current) researchApi.setResearching(false);
          }
        }
        if (activeJob) {
          generationApi.setGenerating(true);
          try {
            await generationApi.pollJob(resumeId, activeJob.id);
            const fresh = await fetchPlanningSession(resumeId);
            if (!mountedRef.current) return;
            applySession(fresh);
            generationApi.setPlans(fresh.candidates);
            generationApi.setSelectedPlanId(fresh.candidates[0]?.id ?? null);
            if (fresh.candidates.length) setStep(2);
          } finally {
            if (mountedRef.current) generationApi.setGenerating(false);
          }
        }
      } catch {
        if (mountedRef.current) setNotice('未能恢复上次的企划会话，已开始新的会话。');
      }
    })();
    // 恢复只执行一次；后续页面状态由各自操作更新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applySession, params, resumeRef]);

  const changeReferenceUsage = (key: string, usage: PlanningReferenceUsage) => {
    setReferences((current) => current.map((entry) => entry.key === key ? { ...entry, usage } : entry));
  };
  const removeReference = (key: string) => {
    setReferences((current) => current.filter((entry) => entry.key !== key));
  };

  return (
    <div className="w-full bg-paper py-6 text-ink">
      <PageContainer className="space-y-4">
        <PageHeader
          backHref="/apps/activities"
          backLabel="返回活动列表"
          title="新建活动"
          description="先确定活动意图，再检索资料、确认人物与地点，最后对比方案并创建。"
          actions={<div className="flex flex-wrap items-center gap-2">
            {onExitWizard && <Button size="sm" variant="ghost" onClick={onExitWizard}>快速制作工坊</Button>}
            <Button size="sm" variant="outline" disabled={busy || commitApi.creatingBlank || generationApi.generating || researchApi.researching} onClick={() => void commitApi.createBlankActivity()}>{commitApi.creatingBlank ? '正在创建…' : '从空白开始'}</Button>
          </div>}
        />

        <PlanningStepNav step={step} setStep={setStep} done={done} generating={generationApi.generating} researching={researchApi.researching} />

        {error && <Alert variant="danger" title="操作未完成">{error}</Alert>}
        {notice && <Alert variant="info">{notice}</Alert>}
        {generationApi.job && !generationApi.generating && (generationApi.job.status === 'failed' || generationApi.job.status === 'cancelled' || (generationApi.job.status === 'succeeded' && generationApi.job.errorMessage)) && <Button size="sm" variant="outline" onClick={() => void generationApi.retryLastJob()}><RefreshCw className="h-3.5 w-3.5" />按原始输入重试此批方案</Button>}

        {step === 0 && (
          <PlanningIntentStep
            intake={intake}
            setIntake={setIntake}
            setIntakeField={setIntakeField}
            userTemplates={userTemplates}
            userTemplateMap={userTemplateMap}
            paramsHasSession={Boolean(params.get('session'))}
            customCast={castApi.customCast}
            setCustomCast={castApi.setCustomCast}
            maxActors={maxActors}
            references={references}
            onChangeReferenceUsage={changeReferenceUsage}
            onRemoveReference={removeReference}
            onOpenReferencePicker={() => referenceApi.setReferencePickerOpen(true)}
            onOpenRecommend={() => referenceApi.setRecommendOpen(true)}
            onOpenGap={() => referenceApi.setGapOpen(true)}
            onOpenUpdateCheck={() => referenceApi.setUpdateCheckOpen(true)}
            onPreviewReferences={() => void referenceApi.previewSelectedReferences()}
            hasKnowledgeSnapshot={Boolean(session?.session.form.knowledgeSnapshot)}
            hasSession={Boolean(sessionId)}
            busy={busy}
            onOpenInspiration={() => referenceApi.setInspirationOpen(true)}
            enabledSources={referenceApi.enabledSources}
            sourcesLoading={referenceApi.sourcesQuery.isLoading}
            sourcesError={referenceApi.sourcesQuery.isError}
            workOptions={referenceApi.workOptions}
            toggleWork={toggleWork}
            llmReady={llmReady}
            mcpSettingsHref={MCP_SETTINGS_HREF}
            onOpenLeadPicker={() => { castApi.setPickerTarget('lead'); castApi.setPickerOpen(true); }}
            onOpenCastPicker={() => { castApi.setPickerTarget('cast'); castApi.setPickerOpen(true); }}
          />
        )}

        {step === 1 && (
          <PlanningCandidatesStep
            intake={intake}
            setIntake={setIntake}
            customCast={castApi.customCast}
            setCustomCast={castApi.setCustomCast}
            maxActors={maxActors}
            tab={tab}
            setTab={setTab}
            onOpenCastPicker={() => { castApi.setPickerTarget('cast'); castApi.setPickerOpen(true); }}
            research={researchApi.research}
            leadName={leadName}
            onCandidateStatus={researchApi.setCandidateStatus}
            onLocationStatus={researchApi.setLocationStatus}
            onLockLocation={researchApi.lockLocation}
            onEvidence={castApi.handleEvidence}
            customLocations={researchApi.customLocations}
            setCustomLocations={researchApi.setCustomLocations}
            customForm={researchApi.customForm}
            setCustomForm={researchApi.setCustomForm}
            planCount={generationApi.planCount}
            setPlanCount={generationApi.setPlanCount}
            generating={generationApi.generating}
            job={generationApi.job}
            runningJob={isRunningJob(generationApi.job)}
            hasSession={Boolean(sessionId)}
            researchStale={session?.researchStale ?? false}
            llmReady={llmReady}
            lockedLocationName={researchApi.lockedLocationName}
            onGenerate={() => void generationApi.generatePlans()}
            onCancelGeneration={() => void generationApi.cancelGeneration()}
            mcpSettingsHref={MCP_SETTINGS_HREF}
          />
        )}

        {step === 2 && (
          <PlanningPlansStep
            plans={generationApi.plans}
            summaries={summaries}
            planOverride={generationApi.planOverride}
            selectedPlanId={generationApi.selectedPlanId}
            setSelectedPlanId={generationApi.setSelectedPlanId}
            expandedPlanId={generationApi.expandedPlanId}
            setExpandedPlanId={generationApi.setExpandedPlanId}
            revisionNote={generationApi.revisionNote}
            setRevisionNote={generationApi.setRevisionNote}
            generating={generationApi.generating}
            onGenerateAnother={() => void generationApi.generatePlans({ keepExisting: true })}
            onOpenPlanEditor={generationApi.openPlanEditor}
            actorName={actorName}
            snapshotReferences={snapshotReferences}
          />
        )}

        {step === 3 && (
          <PlanningConfirmStep
            intake={intake}
            session={session}
            selectedCandidate={generationApi.selectedCandidate}
            activePayload={generationApi.activePayload}
            pendingActors={pendingActors}
            research={researchApi.research}
            busy={busy}
            planOverride={generationApi.planOverride}
            llmReady={llmReady}
            actorName={actorName}
            onRefreshSession={() => void handleRefreshSession()}
            onMatchActor={(actorId) => { castApi.setPickerTarget({ match: actorId }); castApi.setPickerOpen(true); }}
            onImportActor={(actorId) => { castApi.setImportTarget(actorId); castApi.setImportOpen(true); }}
            onOpenPersona={(actorId) => void castApi.openPersonaDraft(actorId)}
            onRemoveActor={(actorId) => void castApi.resolveActor(actorId, { mode: 'remove' })}
            onCreateActivity={() => void commitApi.createActivity()}
          />
        )}

        <PlanningFooter
          step={step}
          setStep={setStep}
          busy={busy}
          generating={generationApi.generating}
          researching={researchApi.researching}
          researchLabel={researchApi.research?.progressLabel}
          sessionId={sessionId}
          hasCast={Boolean(intake.cast.length)}
          selectedPlanId={generationApi.selectedPlanId}
          selectedCandidate={generationApi.selectedCandidate}
          pendingActorCount={pendingActors.length}
          onCancelResearch={() => void researchApi.cancelResearch()}
          onSkipResearch={() => void researchApi.skipResearch()}
          onStartResearch={() => void researchApi.startResearch()}
          onGeneratePlans={() => void generationApi.generatePlans()}
          onCreateActivity={() => void commitApi.createActivity()}
        />
        <div className="h-2" aria-hidden="true" />
      </PageContainer>

      <PlanningReferenceDialogs
        session={session}
        sessionId={sessionId}
        intake={intake}
        recommendOpen={referenceApi.recommendOpen}
        setRecommendOpen={referenceApi.setRecommendOpen}
        updateCheckOpen={referenceApi.updateCheckOpen}
        setUpdateCheckOpen={referenceApi.setUpdateCheckOpen}
        gapOpen={referenceApi.gapOpen}
        setGapOpen={referenceApi.setGapOpen}
        referencePickerOpen={referenceApi.referencePickerOpen}
        setReferencePickerOpen={referenceApi.setReferencePickerOpen}
        referencePreview={referenceApi.referencePreview}
        setReferencePreview={referenceApi.setReferencePreview}
        onAddAssistantReferences={referenceApi.addAssistantReferences}
        onAddReferences={referenceApi.addReferences}
        onPinOldReference={referenceApi.pinOldReference}
        onRefreshReference={referenceApi.refreshReference}
      />
      <PlanningIdeaDialogs
        intake={intake}
        busy={busy}
        inspirationOpen={referenceApi.inspirationOpen}
        setInspirationOpen={referenceApi.setInspirationOpen}
        pendingIdea={referenceApi.pendingIdea}
        setPendingIdea={referenceApi.setPendingIdea}
        replaceFields={referenceApi.replaceFields}
        setReplaceFields={referenceApi.setReplaceFields}
        onAdopt={(batch, idea, replace) => void referenceApi.adoptInspiration(batch, idea, replace)}
      />
      <PlanningCastDialogs
        intake={intake}
        setIntake={setIntake}
        maxActors={maxActors}
        castSnapshotsRef={castSnapshotsRef}
        pickerOpen={castApi.pickerOpen}
        setPickerOpen={castApi.setPickerOpen}
        pickerTarget={castApi.pickerTarget}
        setPickerTarget={castApi.setPickerTarget}
        importOpen={castApi.importOpen}
        setImportOpen={castApi.setImportOpen}
        importTarget={castApi.importTarget}
        setImportTarget={castApi.setImportTarget}
        evidenceOpen={castApi.evidenceOpen}
        setEvidenceOpen={castApi.setEvidenceOpen}
        personaOpen={castApi.personaOpen}
        setPersonaOpen={castApi.setPersonaOpen}
        personaValue={castApi.personaValue}
        setPersonaValue={castApi.setPersonaValue}
        research={researchApi.research}
        busy={busy}
        resolveActor={castApi.resolveActor}
        confirmPersonaDraft={castApi.confirmPersonaDraft}
        onAddImportedCharacter={castApi.addImportedCharacterToCast}
      />
      <PlanningPlanEditorDialog
        open={generationApi.editOpen}
        setOpen={generationApi.setEditOpen}
        editValue={generationApi.editValue}
        onSave={generationApi.savePlanEdit}
        onUpdateActivity={generationApi.updateEditActivity}
        onUpdateStage={generationApi.updateEditStage}
      />
    </div>
  );
}
