'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { AlertTriangle, CalendarDays, Compass, ExternalLink, Plus, RefreshCw, Sparkles, Trash2, UserPlus, Wand2 } from 'lucide-react';
import { ACTIVITY_TEMPLATES, buildActivityDocument, findActivityTemplate } from '@sthstart/contracts';
import type { ActorSnapshot, ActivityPlanningCandidate, ActivityPlanningJob, ContentDocument, StageDefinition } from '@sthstart/contracts';
import { CharacterPickerDialog } from '@/app/features/activities/components/character-picker-dialog';
import { useCreateActivity } from '@/app/features/activities/mutations';
import { activityKeys } from '@/app/lib/query-keys';
import {
  createActivityFromPlanningSession,
  createPlanningSession,
  fetchActivityCharacterSnapshot,
  fetchPlanningJob,
  triggerPlanningJob,
  updatePlanningSession,
} from '@/app/features/activities/api';
import { useActivityCapabilities } from '@/app/features/activities/queries';
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

interface StageDraft {
  title: string;
  instruction: string;
  endCondition: string;
}

/** 生日模板下，多人合办时为每位寿星安排单独的祝福环节。 */
function stageDraftsFromTemplate(templateId: string, birthdayNames: string[]): StageDraft[] {
  const template = findActivityTemplate(templateId) || findActivityTemplate('blank')!;
  return template.stages.map((stage, index) => {
    if (template.id === 'birthday' && birthdayNames.length > 1 && index === 2) {
      return {
        title: stage.title,
        instruction: `端出生日蛋糕，关灯点蜡烛，为每位寿星（${birthdayNames.join('、')}）依次安排单独的祝福时刻。`,
        endCondition: stage.endCondition,
      };
    }
    return { title: stage.title, instruction: stage.instruction, endCondition: stage.endCondition };
  });
}

/** 生成入口附近的模型状态：就绪显示模型名，未就绪给出具体原因与配置入口。 */
function ModelStatusCard({ onRefresh }: { onRefresh: () => void }) {
  const { data: capabilities, isLoading, isError, refetch } = useActivityCapabilities();
  const status = capabilities?.llmStatus;
  const ready = capabilities ? (status ? status.ready : capabilities.llm) : null;
  const refresh = () => { onRefresh(); void refetch(); };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle pb-3 text-xs">
      <span className="font-semibold text-ink">文本模型</span>
      {isLoading || (ready === null && !isError) ? (
        <span className="flex items-center gap-1.5 text-muted"><Spinner className="h-3.5 w-3.5" />正在确认模型配置…</span>
      ) : isError ? (
        <span className="flex items-center gap-2 text-muted">
          暂时无法确认模型配置
          <Button type="button" size="sm" variant="outline" onClick={refresh}><RefreshCw className="h-3.5 w-3.5" />重试</Button>
        </span>
      ) : ready ? (
        <span className="text-green-700">
          {status?.profile?.name || capabilities?.llmProfile?.name || '已就绪'}
          {status?.profile?.model ? <span className="text-muted"> / {status.profile.model}</span> : null}
        </span>
      ) : (
        <span className="text-amber-700">{status?.message || '活动工作室尚未绑定文本模型'}</span>
      )}
      <span className="ml-auto flex items-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={refresh} aria-label="刷新模型状态"><RefreshCw className="h-3.5 w-3.5" />刷新</Button>
        <a
          href="/settings/public-services?section=routing&app=activities"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border-default bg-surface px-3 text-sm font-medium text-accent hover:bg-accent/5"
        >
          配置<ExternalLink className="h-3.5 w-3.5" />
        </a>
      </span>
    </div>
  );
}

export function NewActivityForm() {
  const [expandedStage, setExpandedStage] = useState<number | null>(0);
  const router = useRouter();
  const params = useSearchParams();
  const initialTemplate = params.get('template') || 'blank';
  const initialDate = params.get('date') || '';
  const initialCharacters = (params.get('characters') || '').split(',').map((value) => value.trim()).filter(Boolean);

  const template = findActivityTemplate(initialTemplate) || findActivityTemplate('blank')!;
  const [templateId, setTemplateId] = useState(template.id);
  const [title, setTitle] = useState('');
  const [type, setType] = useState(template.type);
  const [theme, setTheme] = useState(template.theme);
  const [location, setLocation] = useState(template.location);
  const [rules, setRules] = useState(template.rules);
  const [scheduledDate, setScheduledDate] = useState(initialDate);
  const [actors, setActors] = useState<ActorSnapshot[]>([]);
  const [birthdayActorIds, setBirthdayActorIds] = useState<string[]>([]);
  const [stages, setStages] = useState<StageDraft[]>(() => stageDraftsFromTemplate(template.id, []));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 企划会话独立于正式活动：生成过程不会创建活动。
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionDocument, setSessionDocument] = useState<ContentDocument | null>(null);
  const [sessionVersion, setSessionVersion] = useState(1);
  const [instruction, setInstruction] = useState('');
  const [job, setJob] = useState<ActivityPlanningJob | null>(null);
  const [candidates, setCandidates] = useState<ActivityPlanningCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const prefilled = useRef(false);

  const createMutation = useCreateActivity();
  const queryClient = useQueryClient();
  const characterParam = initialCharacters.join(',');
  const { data: capabilities } = useActivityCapabilities();

  // 模型未就绪（或状态仍在加载）时禁用 AI 生成入口；手动创建不受影响。
  const llmReady = capabilities ? (capabilities.llmStatus ? capabilities.llmStatus.ready : capabilities.llm) : null;
  const aiDisabled = llmReady !== true;

  // 从角色日历进入时预填日期与寿星。
  useEffect(() => {
    if (prefilled.current || !characterParam) return;
    prefilled.current = true;
    void (async () => {
      try {
        const snapshots: ActorSnapshot[] = [];
        for (const id of characterParam.split(',')) snapshots.push(await fetchActivityCharacterSnapshot(id));
        const names = snapshots.map((snapshot) => snapshot.displayName);
        setActors(snapshots);
        setBirthdayActorIds(snapshots.map((snapshot) => snapshot.id));
        if (findActivityTemplate(initialTemplate)?.id === 'birthday') setTitle(names.length > 1 ? `${names.join('、')}的生日聚会` : `${names[0]}的生日聚会`);
        setStages(stageDraftsFromTemplate(initialTemplate, names));
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : '读取角色快照失败');
      }
    })();
  }, [characterParam, initialTemplate]);

  // 轮询企划任务直到进入终态。
  useEffect(() => {
    if (!sessionId || !job) return;
    if (job.status !== 'queued' && job.status !== 'running') return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const result = await fetchPlanningJob(sessionId, job.id);
          setJob(result.job);
          setCandidates(result.candidates);
          if (result.candidates.length) setSelectedCandidateId(result.candidates[result.candidates.length - 1].id);
        } catch (error) {
          setErrorMsg(error instanceof Error ? error.message : '读取企划任务失败');
          clearInterval(timer);
        }
      })();
    }, 1_500);
    return () => clearInterval(timer);
  }, [sessionId, job]);

  const birthdayNames = useMemo(
    () => actors.filter((actor) => birthdayActorIds.includes(actor.id)).map((actor) => actor.displayName),
    [actors, birthdayActorIds],
  );

  const applyTemplate = (nextTemplateId: string) => {
    const next = findActivityTemplate(nextTemplateId) || findActivityTemplate('blank')!;
    setTemplateId(next.id);
    setType(next.type);
    setTheme(next.theme);
    setLocation(next.location);
    setRules(next.rules);
    setStages(stageDraftsFromTemplate(next.id, next.id === 'birthday' ? birthdayNames : []));
  };

  // 模板切换前先展示会改变的内容，用户确认后才替换。
  const templateChanges = useMemo(() => {
    if (!pendingTemplate) return [];
    const next = findActivityTemplate(pendingTemplate);
    if (!next) return [];
    const changes: string[] = [];
    if (next.type !== type) changes.push(`活动类型 → ${next.type || '（清空）'}`);
    if (next.theme !== theme) changes.push(`活动主题 → ${next.theme || '（清空）'}`);
    if (next.location !== location) changes.push(`活动地点 → ${next.location || '（清空）'}`);
    if (next.rules !== rules) changes.push(`规则约束 → ${next.rules || '（清空）'}`);
    changes.push(`阶段安排 → ${next.stages.map((stage) => stage.title).join('、')}`);
    return changes;
  }, [pendingTemplate, type, theme, location, rules]);

  const buildDocument = (base?: ContentDocument | null): ContentDocument => {
    const source = base || buildActivityDocument({
      templateId,
      title: title.trim() || '未命名活动',
      type,
      theme,
      location,
      rules,
      actors,
      birthdayActorIds,
      scheduledDate: scheduledDate || null,
    });
    const localStages: StageDefinition[] = stages.map((stage, index) => {
      const existing = source.stages[index];
      return {
        id: existing?.id || `stage_${index + 1}`,
        title: stage.title,
        order: index + 1,
        actorIds: source.actors.map((actor) => actor.id),
        location: location || source.activity.location,
        instruction: stage.instruction,
        requiredBeats: existing?.requiredBeats || [],
        locked: false,
        endCondition: stage.endCondition,
      };
    });
    return {
      ...source,
      activity: { ...source.activity, title: title.trim() || source.activity.title, type, theme, location, rules, scheduledDate: scheduledDate || null, templateId, birthdayActorIds },
      stages: localStages,
    };
  };

  const addActor = (actor: ActorSnapshot) => setActors((current) => [...current, actor]);

  /** 自定义参与者：不进入角色库，适合只在本场活动出现的临时角色。 */
  const addCustomActor = () => setActors((current) => [...current, {
    id: `actor_custom_${Date.now().toString(36)}`,
    displayName: '旅行者',
    persona: { identity: '活动的组织者与记录者', personality: ['热情', '善于倾听'], speech: { tone: '亲切平实' } },
    activityRole: '发起者',
    outfitDescription: '日常活动便服',
    appearanceReferenceAssetKeys: [],
  }]);

  const removeActor = (actorId: string) => {
    if (actors.length <= 1) { setErrorMsg('活动至少需要保留一位参与角色'); return; }
    setActors((current) => current.filter((actor) => actor.id !== actorId));
    setBirthdayActorIds((current) => current.filter((id) => id !== actorId));
    setErrorMsg(null);
  };

  /**
   * 复用已有会话（并把当前表单写回），否则新建会话。
   * 服务端会重新冻结角色人设，保证生成依据与页面一致。
   */
  const ensureSession = async (): Promise<{ id: string; document: ContentDocument }> => {
    const form = {
      templateId,
      title: title.trim(),
      type,
      theme,
      location,
      rules,
      scheduledDate: scheduledDate || null,
      characters: actors.map((actor) => ({
        characterId: String(actor.sourceCharacterId),
        ...(actor.sourceVersion == null ? {} : { version: actor.sourceVersion }),
        activityRole: actor.activityRole,
      })),
      birthdayCharacterIds: actors.filter((actor) => birthdayActorIds.includes(actor.id)).map((actor) => String(actor.sourceCharacterId)),
      ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
    };
    if (sessionId && sessionDocument) {
      const updated = await updatePlanningSession(sessionId, form, sessionVersion);
      setSessionVersion(updated.session.version);
      setSessionDocument(updated.session.document);
      setActors(updated.session.document.actors);
      return { id: sessionId, document: updated.session.document };
    }
    const created = await createPlanningSession(form);
    setSessionId(created.session.id);
    setSessionVersion(created.session.version);
    setSessionDocument(created.session.document);
    setActors(created.session.document.actors);
    setStages(created.session.document.stages.map((stage) => ({ title: stage.title, instruction: stage.instruction, endCondition: stage.endCondition })));
    return { id: created.session.id, document: created.session.document };
  };

  const generatePlan = async () => {
    setErrorMsg(null);
    if (!title.trim()) { setErrorMsg('请先填写活动标题'); return; }
    if (!actors.length) { setErrorMsg('请先选择参与角色'); return; }
    if (actors.some((actor) => !actor.sourceCharacterId)) { setErrorMsg('生成企划需要来自角色库的角色，请先移除自定义角色。'); return; }
    setBusy(true);
    try {
      const session = await ensureSession();
      const started = await triggerPlanningJob(session.id, {
        instruction: instruction.trim() || undefined,
        idempotencyKey: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      });
      setJob(started);
      setCandidates([]);
      setSelectedCandidateId(null);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '启动企划生成失败');
    } finally { setBusy(false); }
  };

  const activeCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId) || candidates[candidates.length - 1];

  const applyCandidate = () => {
    if (!activeCandidate) return;
    const output = activeCandidate.payload;
    setTitle(output.activity.title || title);
    setTheme(output.activity.theme ?? theme);
    setLocation(output.activity.location ?? location);
    setRules(output.activity.rules ?? rules);
    setStages(output.stages.map((stage) => ({ title: stage.title, instruction: stage.description, endCondition: stage.endCondition })));
    setErrorMsg(null);
  };

  const createDirectly = async () => {
    setErrorMsg(null);
    if (!title.trim()) { setErrorMsg('请填写活动标题'); return; }
    if (!actors.length) { setErrorMsg('活动至少需要一位参与角色'); return; }
    setBusy(true);
    try {
      const result = await createMutation.mutateAsync({ document: buildDocument(null) });
      router.push(`/apps/activities/${result.activity.id}`);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '创建活动失败');
    } finally { setBusy(false); }
  };

  const createFromSession = async () => {
    setErrorMsg(null);
    if (!sessionId) { setErrorMsg('请先生成企划，再创建活动。'); return; }
    setBusy(true);
    try {
      const result = await createActivityFromPlanningSession(sessionId, buildDocument(sessionDocument), `create_${sessionId}`);
      void queryClient.invalidateQueries({ queryKey: activityKeys.all });
      router.push(`/apps/activities/${result.activity.id}`);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '创建活动失败');
    } finally { setBusy(false); }
  };

  const running = job?.status === 'queued' || job?.status === 'running';
  const sessionStatusText = running ? '企划生成中' : job?.status === 'failed' ? '企划生成失败' : activeCandidate ? '企划已就绪，可应用到表单或直接创建' : sessionDocument ? '企划会话已建立' : '尚未生成企划';

  // 阶段紧凑编辑：展开当前项，其余只显示标题行。
  const updateStage = (index: number, patch: Partial<StageDraft>) =>
    setStages((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));

  return (
    <div className="w-full bg-paper py-6 text-ink">
      <PageContainer className="space-y-4">
        <PageHeader
          backHref="/apps/activities"
          backLabel="返回活动列表"
          title="新建活动"
          description="设置活动与参与角色，生成企划或手动安排阶段。"
          actions={<Button size="sm" variant="outline" onClick={() => router.push('/apps/calendar')}><CalendarDays className="h-4 w-4" />角色日历</Button>}
        />

        <WorkbenchColumns
          className="pb-2"
          left={(
            <>
              <section className="space-y-2 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                <h3 className="flex items-center gap-2 text-base font-semibold text-ink"><Compass className="h-4 w-4 text-accent" />活动设置</h3>
                <label className="block text-sm text-muted">活动模板</label>
                <Select
                  aria-label="选择活动模板"
                  value={templateId}
                  onChange={(event) => { if (event.target.value !== templateId) setPendingTemplate(event.target.value); }}
                  className="text-sm"
                >
                  {ACTIVITY_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
                <p className="text-xs text-muted">{findActivityTemplate(templateId)?.description}</p>
                <div className="border-t border-border-subtle pt-3" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 sm:col-span-2">
                    <span className="text-xs font-semibold text-ink">活动标题</span>
                    <Input aria-label="活动标题" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：海边营地烧烤与合照日、甲的生日惊喜派对" className="h-9 text-sm" />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-ink">活动类型</span>
                    <Input aria-label="活动类型" value={type} onChange={(event) => setType(event.target.value)} className="h-9 text-sm" />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-ink">活动日期（可选）</span>
                    <Input aria-label="活动日期" type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} className="h-9 text-sm" />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-ink">活动地点</span>
                    <Input aria-label="活动地点" value={location} onChange={(event) => setLocation(event.target.value)} className="h-9 text-sm" />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold text-ink">活动主题与梗概</span>
                    <Input aria-label="活动主题与梗概" value={theme} onChange={(event) => setTheme(event.target.value)} placeholder="如：夏日傍晚布置灯串与长桌，共进晚餐并拍照留念" className="h-9 text-sm" />
                  </label>
                  <details className="sm:col-span-2">
                    <summary className="cursor-pointer text-sm text-muted">活动规则与导演约束（可选）</summary>
                    <Textarea aria-label="活动规则或导演约束" value={rules} onChange={(event) => setRules(event.target.value)} rows={2} className="mt-2" />
                  </details>
                </div>
                {scheduledDate
                  ? <p className="text-xs text-muted">已排期：活动会出现在 {scheduledDate} 的角色日历上。</p>
                  : <p className="text-xs text-muted">未填写日期时活动不会出现在日历上，稍后可以在活动内补充。</p>}
              </section>

              <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-bold text-ink"><UserPlus className="h-4 w-4 text-accent" />参与角色（{actors.length}）</h3>
                    <p className="text-xs text-muted">选入的角色会锁定此刻的人设快照，之后角色库的修改不会影响这场活动。</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}><Plus className="h-3.5 w-3.5" />从角色库添加</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={addCustomActor}>添加自定义参与者</Button>
                  </div>
                </div>

                {!actors.length && <p className="text-sm text-muted">还没有参与者。可以从角色库添加，或从角色日历的生日直接进入自动带入寿星。</p>}
                <ul className="space-y-1.5">
                  {actors.map((actor) => (
                    <li key={actor.id} className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface p-2">
                      <div className="relative flex h-9 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-hover text-xs font-semibold text-ink">
                        {actor.avatarUrl ? <Image src={actor.avatarUrl} alt="" fill unoptimized className="object-cover" /> : actor.displayName.slice(0, 1)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-bold text-ink">{actor.displayName}</span>
                          <Badge variant="outline" className="bg-surface-raised text-xs">{actor.activityRole || '参与者'}</Badge>
                          {actor.sourceVersionStatus === 'draft' && <Badge variant="outline" className="bg-amber-50 text-xs text-amber-800">草稿快照</Badge>}
                        </div>
                        <details className="text-xs text-muted">
                          <summary className="cursor-pointer select-none">人设摘要</summary>
                          <p className="mt-1 whitespace-pre-wrap">{typeof actor.persona.identity === 'string' ? actor.persona.identity : ''}</p>
                        </details>
                      </div>
                      <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                        <input
                          type="checkbox"
                          checked={birthdayActorIds.includes(actor.id)}
                          onChange={(event) => setBirthdayActorIds((current) => event.target.checked ? [...current, actor.id] : current.filter((id) => id !== actor.id))}
                        />
                        本场寿星
                      </label>
                      <button type="button" aria-label={`移除 ${actor.displayName}`} onClick={() => removeActor(actor.id)} disabled={actors.length <= 1} className="shrink-0 text-fg-subtle transition-colors hover:text-danger-fg disabled:opacity-20">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
                {templateId === 'birthday' && !birthdayActorIds.length && <p className="text-xs text-amber-700">生日模板建议至少勾选一位寿星；未勾选时仍可作为普通聚会活动创建。</p>}
              </section>
            </>
          )}
          right={(
            <>
              <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                <h3 className="flex items-center gap-2 text-sm font-bold text-ink"><Sparkles className="h-4 w-4 text-accent" />企划助手</h3>
              <ModelStatusCard onRefresh={() => void queryClient.invalidateQueries({ queryKey: activityKeys.capabilities() })} />
                <Textarea
                  aria-label="生成要求"
                  value={instruction}
                  rows={3}
                  placeholder="例如：想在天台准备惊喜，希望每位寿星都有单独的祝福环节。"
                  onChange={(event) => setInstruction(event.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    size="md"
                    disabled={busy || running || aiDisabled}
                    title={aiDisabled && llmReady === false ? '请先为活动工作室绑定文本模型' : undefined}
                    onClick={() => void generatePlan()}
                  >
                    <Wand2 className="h-3.5 w-3.5" />{job ? '重新生成企划' : '生成企划'}
                  </Button>
                  {running && <span className="flex items-center gap-1.5 text-xs text-amber-800"><Spinner className="h-3.5 w-3.5" />生成中，请稍候…</span>}
                  {aiDisabled && !running && <span className="text-xs text-muted">文本模型未就绪或状态加载中；仍可手动填写并直接创建。</span>}
                </div>
                <details className="text-xs text-muted" open={Boolean(job?.status === 'failed')}>
                  <summary className="cursor-pointer select-none">会话与技术状态</summary>
                  <p className="mt-1">状态：{sessionStatusText}</p>
                  {!!sessionId && <p className="break-all">企划会话 {sessionId}（刷新页面后仍在同一会话中）</p>}
                  {sessionDocument && <p>已冻结 {sessionDocument.actors.length} 位角色的人设快照；创建时若角色草稿发生变化会提示重新读取。</p>}
                </details>
                {job?.status === 'failed' && <Alert variant="danger" title="企划生成失败">{job.errorMessage || '请稍后重试'}</Alert>}
              </section>

              {activeCandidate && (
                <section className="space-y-3 rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-4 shadow-xs">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="bg-green-50 text-xs text-green-700">企划候选已就绪</Badge>
                    <span className="text-xs text-muted">{candidates.length} 份候选</span>
                  </div>
                  {candidates.length > 1 && (
                    <select
                      aria-label="选择企划候选"
                      className="w-full rounded border border-ink/15 bg-surface px-2 py-2 text-sm"
                      value={activeCandidate.id}
                      onChange={(event) => setSelectedCandidateId(event.target.value)}
                    >
                      {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.payload.activity.title}</option>)}
                    </select>
                  )}
                  <div className="space-y-1.5 text-sm">
                    <p><span className="font-semibold">标题：</span>{activeCandidate.payload.activity.title}</p>
                    <p><span className="font-semibold">概述：</span>{activeCandidate.payload.activity.overview}</p>
                    <p><span className="font-semibold">主题：</span>{activeCandidate.payload.activity.theme} · <span className="font-semibold">地点：</span>{activeCandidate.payload.activity.location}</p>
                    {!!activeCandidate.payload.actorRoles.length && (
                      <div>
                        <span className="font-semibold">角色分工：</span>
                        <ul className="mt-1 space-y-0.5 text-xs text-muted">
                          {activeCandidate.payload.actorRoles.map((role) => (
                            <li key={role.actorId}>{actors.find((actor) => actor.id === role.actorId)?.displayName || role.actorId}：{role.activityRole}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {activeCandidate.payload.stages.map((stage, index) => (
                      <div key={stage.clientId} className="rounded border border-border-subtle p-2 text-sm">
                        <p className="font-medium">#{index + 1} {stage.title}（{stage.location}）</p>
                        <p className="text-xs text-muted">{stage.description}</p>
                        {!!stage.requiredBeats.length && <p className="mt-1 text-xs text-muted">关键事件：{stage.requiredBeats.join('；')}</p>}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={applyCandidate}>应用到表单</Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowRawJson((current) => !current)}>{showRawJson ? '隐藏原始 JSON' : '查看原始 JSON'}</Button>
                  </div>
                  {showRawJson && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-xs text-muted">{JSON.stringify(activeCandidate.payload, null, 2)}</pre>}
                </section>
              )}

              <section className="space-y-2 rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-ink">阶段安排（{stages.length}）</h3>
                  <Button type="button" size="sm" variant="outline" onClick={() => { setExpandedStage(stages.length); setStages((current) => [...current, { title: `第 ${current.length + 1} 阶段`, instruction: '', endCondition: '' }]); }}>添加阶段</Button>
                </div>
                <div className="space-y-1.5">
                  {stages.map((stage, index) => (
                    <div key={index} className="border-t border-border-subtle py-2">
                      <button type="button" aria-expanded={expandedStage === index} aria-controls={`stage-editor-${index}`} onClick={() => setExpandedStage(expandedStage === index ? null : index)} className="flex w-full items-center gap-3 rounded-[var(--radius-control)] py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-accent">
                        <span className="text-accent">{String(index + 1).padStart(2, '0')}</span>
                        <span className="min-w-0 flex-1 truncate font-semibold">{stage.title || '未命名阶段'}</span>
                        <span className="text-muted">{expandedStage === index ? '收起' : '编辑'}</span>
                      </button>
                      <div id={`stage-editor-${index}`} hidden={expandedStage !== index} className="space-y-2 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted">#{index + 1}</span>
                        <Input
                          aria-label={`阶段 ${index + 1} 标题`}
                          value={stage.title}
                          onChange={(event) => updateStage(index, { title: event.target.value })}
                          className="h-8 text-sm"
                        />
                        <button
                          type="button"
                          aria-label={`删除阶段 ${index + 1}`}
                          onClick={() => { if (stages.length <= 1) return; setExpandedStage(Math.max(0, index - 1)); setStages((current) => current.filter((_, i) => i !== index)); }}
                          disabled={stages.length <= 1}
                          className={`shrink-0 ${stages.length <= 1 ? 'opacity-20' : 'text-fg-subtle hover:text-danger-fg'}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <Textarea
                        aria-label={`阶段 ${index + 1} 指示`}
                        value={stage.instruction}
                        rows={2}
                        placeholder="本阶段发生的事情与角色行动"
                        onChange={(event) => updateStage(index, { instruction: event.target.value })}
                      />
                      <Input
                        aria-label={`阶段 ${index + 1} 结束条件`}
                        value={stage.endCondition}
                        placeholder="结束条件"
                        onChange={(event) => updateStage(index, { endCondition: event.target.value })}
                        className="h-8 text-sm"
                      />
                      </div>
                    </div>
                  ))}
                </div>
                {stages.length < 2 && <p className="text-xs text-amber-700">使用企划创建活动至少需要两个阶段。</p>}
              </section>
            </>
          )}
        />

        {/* 吸底创建工具栏：与右侧创建按钮同步，长页面滚动时保持可见。 */}
        <div className="sticky bottom-0 z-10 -mx-4 border-t border-border-subtle bg-paper/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 text-xs text-muted">{errorMsg ? <span className="text-red-700">{errorMsg}</span> : sessionStatusText}</span>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void createDirectly()}>直接创建活动</Button>
              <Button variant="primary" disabled={busy || !sessionId} onClick={() => void createFromSession()}>{busy ? '处理中…' : '使用企划创建活动'}</Button>
            </div>
          </div>
        </div>
        <div className="h-2" aria-hidden="true" />
      </PageContainer>

      <CharacterPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        existingSourceCharacterIds={actors.map((actor) => String(actor.sourceCharacterId)).filter(Boolean)}
        existingActorCount={actors.length}
        onSelectCharacter={addActor}
      />

      <Dialog
        open={pendingTemplate !== null}
        onOpenChange={(open) => { if (!open) setPendingTemplate(null); }}
        title="应用新的活动模板"
        description="应用模板会替换下面列出的内容；已选参与角色会保留。"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPendingTemplate(null)}>取消</Button>
            <Button onClick={() => { if (pendingTemplate) applyTemplate(pendingTemplate); setPendingTemplate(null); }}>应用模板</Button>
          </div>
        }
      >
        <ul className="space-y-1 text-sm">
          {templateChanges.map((change) => (
            <li key={change} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />{change}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">已经生成的企划不会自动更新；切换模板后请重新生成企划。</p>
      </Dialog>
    </div>
  );
}
