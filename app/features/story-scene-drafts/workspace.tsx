'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, GitBranch, Image as ImageIcon, MapPin, MessageSquare, PenLine, RefreshCw } from 'lucide-react';
import type { SceneDirection, StorySceneDraft } from '@sthstart/contracts';
import { WorkspaceHeader } from '@/app/components/shared/workspace-header';
import { SplitPanes } from '@/app/components/shared/split-panes';
import { ScrollFadeContainer } from '@/app/components/ui/scroll-fade-container';
import { Button, buttonVariants } from '@/app/components/ui/button';
import { Drawer } from '@/app/components/ui/drawer';
import { Dialog } from '@/app/components/ui/dialog';
import { Alert } from '@/app/components/ui/alert';
import { AsyncState } from '@/app/components/ui/async-state';
import { Input } from '@/app/components/ui/input';
import { useCjkImeGuard } from '@/app/lib/hooks/use-cjk-ime-guard';
import { generateId } from '@/app/lib/uuid';
import { createSceneDraft, getSceneDraft, sceneHref, sceneKeys } from './api';
import { Choice, SceneText, surfaceClass, textClass } from './fields';
import { ReferenceSources, SceneStartPanel } from './start';
import { directionLabels, SceneDiscussPanel, SceneWritingPanel } from './writing';
import { SceneAdoptPanel, SceneImagePanel } from './image-adopt';
import { sceneActionNames, useSceneSession, type SceneActionInput, type SceneEdits } from './use-scene-session';

const stages = [
  { id: 'start', label: '选时地', icon: MapPin },
  { id: 'discuss', label: '讨论讲法', icon: MessageSquare },
  { id: 'write', label: '正文', icon: PenLine },
  { id: 'image', label: '画面', icon: ImageIcon },
  { id: 'adopt', label: '收入作品', icon: BookOpen },
] as const;
type Stage = (typeof stages)[number]['id'];

const progressStage: Record<StorySceneDraft['progress'], Stage> = { start: 'start', discuss: 'discuss', write: 'write', image: 'image', adopted: 'adopt' };
const inProgress = (draft: StorySceneDraft | undefined) => !!draft && (draft.currentAction?.status === 'running' || draft.currentAction?.status === 'queued' || draft.images.some(image => ['queued', 'running', 'uncertain'].includes(image.status)));

export function SceneDraftWorkspace({ draftId }: { draftId: string }) {
  const query = useQuery({
    queryKey: sceneKeys.detail(draftId),
    queryFn: ({ signal }) => getSceneDraft(draftId, signal),
    refetchInterval: query => inProgress(query.state.data) ? 1800 : false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  if (query.data) return <SceneEditor initial={query.data} />;
  return <div className="flex h-full min-h-0 flex-col">
    <WorkspaceHeader title="一幕故事" backHref="/apps/story-worlds" backLabel="作品目录" />
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      {query.isPending ? <AsyncState status="loading" rows={4} /> : <Alert variant="danger" title="草稿暂时无法打开">
        <p>{query.error?.message}</p><Button size="sm" variant="ghost" onClick={() => void query.refetch()}>重新读取</Button>
      </Alert>}
    </div>
  </div>;
}

function SceneEditor({ initial }: { initial: StorySceneDraft }) {
  const router = useRouter();
  const client = useQueryClient();
  const session = useSceneSession(initial);
  const { server, edits, edit, flush, act } = session;
  const discoveryKey = `sthstart:scene-discover:${server.id}`;
  const [stage, setStage] = useState<Stage>(() => progressStage[initial.progress]);
  const [drawer, setDrawer] = useState(false);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [sourceActivation, setSourceActivation] = useState(0);
  const [focus, setFocus] = useState(false);
  const [fork, setFork] = useState(false);
  const [forkDirection, setForkDirection] = useState<SceneDirection | null>(null);
  const [forkBusy, setForkBusy] = useState(false);
  const [forkError, setForkError] = useState('');
  const forkLock = useRef(false);
  const forkAttempt = useRef<{ direction: SceneDirection | null; key: string } | null>(null);
  const discoveryStarted = useRef(false);
  const refInvoker = useRef<HTMLButtonElement>(null);
  const briefLock = useRef(false);
  const [confirmingBrief, setConfirmingBrief] = useState(false);
  const composition = useCjkImeGuard();
  const action = server.currentAction;
  const actionRunning = session.activeAction ?? (action?.status === 'running' ? action.action : null);
  const busy = Boolean(actionRunning || session.conflict || session.unknownAction || forkBusy || confirmingBrief);
  const draft: StorySceneDraft = {
    ...server,
    title: edits.title ?? server.title,
    body: edits.body ?? server.body,
    notes: edits.notes ?? server.notes,
    lockedConstraints: edits.lockedConstraints ?? server.lockedConstraints,
    authorSources: edits.authorSources ?? server.authorSources,
    direction: edits.direction === undefined ? server.direction : edits.direction,
    format: edits.format ?? server.format,
    brief: edits.brief === undefined ? server.brief : edits.brief,
    briefConfirmed: edits.briefConfirmed ?? server.briefConfirmed,
    writingCandidate: edits.writingCandidateDecision ? null : server.writingCandidate,
  };

  function jump(to: Stage) {
    setStage(to);
    setFocus(true);
  }

  useEffect(() => {
    if (!focus) return;
    const heading = document.getElementById('scene-stage-heading');
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus({ preventScroll: true });
    setFocus(false);
  }, [stage, focus]);

  useEffect(() => {
    if (discoveryStarted.current) return;
    discoveryStarted.current = true;
    try {
      const mode = sessionStorage.getItem(discoveryKey);
      sessionStorage.removeItem(discoveryKey);
      if (mode) setStage('start');
      if (mode === 'discover' && !initial.discovery && !initial.currentAction) void act({ action: 'discover' });
    } catch { /* creation intent is optional across navigation */ }
  }, [act, discoveryKey, initial]);

  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !composition.isImeComposing(event)) {
        event.preventDefault();
        void flush();
      }
    };
    window.addEventListener('keydown', saveShortcut);
    return () => window.removeEventListener('keydown', saveShortcut);
  }, [composition.isImeComposing, flush]);

  function showSource(id: string) {
    setSourceId(id);
    setSourceActivation(value => value + 1);
    if (!window.matchMedia('(min-width: 1024px)').matches) setDrawer(true);
    else requestAnimationFrame(() => {
      const selected = document.getElementById('scene-desktop-reference')?.querySelector('details[open] > summary');
      if (selected instanceof HTMLElement) { selected.scrollIntoView({ block: 'nearest' }); selected.focus({ preventScroll: true }); }
    });
  }

  async function confirmStart(start: NonNullable<SceneEdits['start']>) {
    if (busy) return;
    edit({ start }, false);
    if (await flush()) jump('discuss');
  }

  async function confirmBrief() {
    if (busy || briefLock.current) return;
    briefLock.current = true;
    setConfirmingBrief(true);
    try {
      if (!(await flush())) return;
      edit({ briefConfirmed: true }, false);
      const result = await act({ action: 'write' });
      if (result?.status === 'succeeded') jump('write');
    } finally { briefLock.current = false; setConfirmingBrief(false); }
  }

  async function showAdoption() {
    if (await flush()) jump('adopt');
  }

  function openFork() {
    setForkDirection(draft.direction);
    setFork(true);
    setForkError('');
  }

  async function submitFork() {
    if (forkLock.current) return;
    forkLock.current = true;
    setForkBusy(true);
    setForkError('');
    try {
      if (!(await flush())) return;
      if (forkAttempt.current?.direction !== forkDirection) forkAttempt.current = { direction: forkDirection, key: generateId() };
      const next = await createSceneDraft({ forkFrom: draft.id, direction: forkDirection ?? undefined, idempotencyKey: forkAttempt.current.key });
      client.setQueryData(sceneKeys.detail(next.id), next);
      void client.invalidateQueries({ queryKey: sceneKeys.list });
      router.push(sceneHref(next.id));
    } catch (cause) {
      setForkError(cause instanceof Error ? cause.message : '暂时无法另开一幕。');
    } finally { forkLock.current = false; setForkBusy(false); }
  }

  const startReady = !!server.start;
  const writeReady = !!(draft.direction && (stage === 'write' || server.briefConfirmed || draft.body.trim()));
  const bodyReady = !!draft.body.trim();
  const allowed: Record<Stage, boolean> = { start: true, discuss: startReady, write: writeReady, image: bodyReady || stage === 'image', adopt: bodyReady || !!draft.adoption || stage === 'adopt' };
  const failed = action && (action.status === 'failed' || action.status === 'stale');
  const retryAction = () => {
    if (!action || action.status !== 'failed') return;
    if (action.action === 'adopt' || action.action === 'generate-image') {
      jump(action.action === 'adopt' ? 'adopt' : 'image');
      return;
    }
    void act({ action: action.action, retryOf: action.id }).then(result => {
      if (result?.action === 'write' && result.status === 'succeeded') jump('write');
    });
  };

  const references = (mobile: boolean) => <div className="space-y-4">
    {!mobile && <h2 className="flex items-center gap-2 text-base font-semibold"><BookOpen className="size-4 text-muted" aria-hidden="true" />参考资料</h2>}
    <div className="space-y-1 border-b border-hairline pb-4">
      <p className="wrap-anywhere text-sm font-medium">{draft.character.name}{draft.character.work ? ` · ${draft.character.work}` : ''}</p>
      {draft.character.setting && <p className="whitespace-pre-wrap wrap-anywhere text-sm text-muted">{draft.character.setting}</p>}
      {draft.direction && <p className="text-xs text-muted">{directionLabels[draft.direction]}</p>}
      {draft.forkedFrom && <Link href={sceneHref(draft.forkedFrom)} className="text-sm text-accent underline">返回原稿与画面</Link>}
    </div>
    <div className="space-y-2">
      <Button size="sm" variant="ghost" disabled={busy} loading={actionRunning === 'refresh-sources'} onClick={() => void act({ action: 'refresh-sources' })}><RefreshCw className="size-4" aria-hidden="true" />更新参考资料</Button>
      {action?.action === 'refresh-sources' && !actionRunning && <p role="status" className={`text-xs leading-relaxed ${action.status === 'succeeded' && draft.discovery?.status === 'ready' ? 'text-muted' : 'text-warning'}`}>{action.error?.message || draft.discovery?.message}</p>}
      {session.actionError && <p role="status" className="text-xs leading-relaxed text-warning">{session.actionError}</p>}
    </div>
    <ReferenceSources key={sourceActivation} sources={draft.sources} activeId={sourceId} />
    <details className="space-y-3 border-t border-hairline pt-3">
      <summary className="cursor-pointer text-sm font-medium">场景笔记</summary>
      <SceneText label="草稿笔记" name="draftNotes" maxLength={2000} rows={4} value={draft.notes} onChange={event => edit({ notes: event.target.value })} />
    </details>
  </div>;

  return <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" onCompositionStart={composition.handleCompositionStart} onCompositionEnd={composition.handleCompositionEnd}>
    <WorkspaceHeader title={draft.title || '未命名一幕'} backHref="/apps/story-worlds" backLabel="作品目录"
      titleSlot={<Input aria-label="草稿标题" name="sceneTitle" variant="inline" maxLength={240} value={draft.title} placeholder="未命名一幕" onChange={event => edit({ title: event.target.value })} onBlur={() => void flush()} className="!text-base font-semibold" />}
      status={<span role="status" className={session.conflict || session.saveError ? 'text-warning' : 'text-muted'}>{session.status}</span>}
      actions={<Button ref={refInvoker} size="sm" variant="ghost" className="lg:!hidden" onClick={() => setDrawer(true)}><BookOpen className="size-4" aria-hidden="true" />参考资料</Button>} />
    <nav aria-label="一幕故事进度" className="shrink-0 border-b border-hairline bg-surface px-2 py-1.5 sm:px-4">
      <ol className="flex flex-wrap gap-1">
        {stages.map(({ id, label, icon: Icon }) => <li key={id} className="min-w-0">
          <button type="button" aria-current={stage === id ? 'step' : undefined} disabled={!allowed[id]} onClick={() => { if (id === 'adopt') void showAdoption(); else jump(id); }} className="flex min-h-9 items-center gap-1.5 rounded-control px-3 text-sm font-medium text-muted hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-55 aria-[current=step]:bg-[var(--selection-bg)] aria-[current=step]:text-ink max-sm:px-2">
            <Icon className="hidden size-4 sm:block" aria-hidden="true" />{label}
          </button>
        </li>)}
      </ol>
    </nav>
    <SplitPanes from="lg" resizable storageKey="sthstart:scene-split" defaultSplitRatio={0.73} minLeftWidth={420} minRightWidth={236}
      className="min-h-0 flex-1 !gap-0" leftClassName="flex min-h-0 flex-col" rightClassName="hidden min-h-0 flex-col bg-surface lg:flex"
      left={<ScrollFadeContainer data-autohide-scroll className="flex-1 overscroll-contain [scrollbar-gutter:stable]">
        <div className="mx-auto max-w-4xl space-y-3 px-3 py-4 sm:px-6 sm:py-6">
          {session.conflict && <Alert variant="warning" title="有版本冲突">
            <p className="mb-2 text-sm">草稿在其他页面有更新。本机的修改仍然保留。</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[{ label: '服务器稿', title: session.conflict.title, body: session.conflict.body }, { label: '本机稿', title: draft.title, body: draft.body }].map(item => <div key={item.label} className="min-w-0 rounded-control bg-surface px-3 py-2">
                <p className="text-xs text-muted">{item.label}</p><p className="wrap-anywhere text-sm font-medium">{item.title || '未命名一幕'}</p>
                <p className="max-h-52 overflow-y-auto whitespace-pre-wrap wrap-anywhere text-sm">{item.body || '正文为空'}</p>
              </div>)}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void session.resolveConflict(true)}>保存本机修改</Button>
              <Button size="sm" variant="ghost" onClick={() => void session.resolveConflict(false)}>使用服务器稿</Button>
            </div>
          </Alert>}
          {!session.conflict && session.status === '仅保存到本机' && <Alert variant="warning" title="本机有未同步的修改">
            {session.saveError && <p>{session.saveError}</p>}<Button size="sm" variant="ghost" onClick={() => void flush()}>尝试同步</Button>
          </Alert>}
          {actionRunning && <p role="status" className="rounded-control bg-surface p-3 text-sm text-muted">正在{sceneActionNames[actionRunning]}…</p>}
          {session.actionError && <Alert variant="warning" title="这次操作需要处理">{session.actionError}{session.unknownAction && <Button size="sm" variant="ghost" disabled={!!actionRunning} onClick={() => void act(session.unknownAction!, true)}>检查原请求状态</Button>}</Alert>}
          {failed && !actionRunning && <Alert variant="warning" title={`${sceneActionNames[action.action]}${action.status === 'stale' ? '需要重新执行' : '未完成'}`}>
            <p>{action.error?.message}</p>
            {action.status === 'failed' && !['generate-image', 'adopt'].includes(action.action) && <Button size="sm" variant="ghost" disabled={busy} onClick={retryAction}>重试这次操作</Button>}
          </Alert>}
          {stage === 'start' && <SceneStartPanel key={`${server.start?.candidateId}:${server.start?.time}:${server.start?.location}:${server.start?.hook}`} draft={draft} busy={busy} edit={edit} act={act} showSource={showSource} onConfirm={start => void confirmStart(start)} onFork={openFork} />}
          {stage === 'discuss' && <SceneDiscussPanel draft={draft} busy={busy} edit={edit} act={act} onWrite={() => void confirmBrief()} onManual={() => jump('write')} onFork={openFork} />}
          {stage === 'write' && <SceneWritingPanel draft={draft} busy={busy} edit={edit} act={act} onImage={() => { void flush().then(result => { if (result) jump('image'); }); }} />}
          {stage === 'image' && <SceneImagePanel draft={draft} busy={busy} edit={edit} bodyEdited={edits.body !== undefined && edits.body !== server.body} planEdit={edits.imagePlan} act={act} />}
          {stage === 'adopt' && <SceneAdoptPanel draft={draft} busy={busy} act={act} />}
          {draft.body.trim() && stage === 'write' && <div className={`${surfaceClass} flex flex-wrap items-center justify-between gap-2`}>
            <Button size="sm" variant="ghost" disabled={busy} onClick={openFork}><GitBranch className="size-4" aria-hidden="true" />从这里另开一幕</Button>
            {draft.adoption && <Link href={draft.adoption.href} className={buttonVariants({ size: 'sm', variant: 'secondary' })}>打开已收录手稿</Link>}
          </div>}
        </div>
      </ScrollFadeContainer>}
      right={<ScrollFadeContainer id="scene-desktop-reference" data-autohide-scroll className="flex-1 overscroll-contain p-4 [scrollbar-gutter:stable]">{references(false)}</ScrollFadeContainer>} />
    <Drawer title="参考资料" open={drawer} onOpenChange={setDrawer} invokerRef={refInvoker}>{references(true)}</Drawer>
    <Dialog title="从这里另开一幕" open={fork} onOpenChange={setFork} description="沿用当前角色、时地和资料。" size="sm">
      <div className="space-y-4">
        {draft.character.origin !== 'original' && <Choice label="新草稿走向" name="forkDirection" value={forkDirection} options={[
          { value: 'canon-gap', label: directionLabels['canon-gap'] }, { value: 'canon-adaptation', label: directionLabels['canon-adaptation'] }, { value: 'if', label: directionLabels.if },
        ]} onChange={setForkDirection} disabled={forkBusy} />}
        {forkError && <Alert variant="warning" title="另开草稿未完成">{forkError}</Alert>}
        <div className="flex justify-end"><Button variant="primary" loading={forkBusy} onClick={() => void submitFork()}>创建变体草稿</Button></div>
      </div>
    </Dialog>
  </div>;
}
