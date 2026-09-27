'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Activity, ActorSnapshot, ComicDocument, ComicJob, ComicPage, ComicPanel, ComicStoryboardModelOutput, ContentDocument, SceneBeatRenderSettings } from '@sthstart/contracts';
import { renderComicPage, layoutBubbleText, panelLayoutForPage } from '@sthstart/activity-playback';
import { zipSync } from 'fflate';
import { Dialog } from '@/app/components/ui/dialog';
import { Drawer } from '@/app/components/ui/drawer';
import { Button } from '@/app/components/ui/button';
import { getEffectiveStageScenes } from '../scene-beat-utils';
import { useComicDraft } from './use-comic-draft';
import { useActivityContentRevision, useComicJob, useComicJobs } from '../queries';
import { useApplyComicStoryboard, useCreateComicRevision, useCreateComicStoryboard } from '../mutations';
import { activityKeys } from '@/app/lib/query-keys';
import { useQueryClient } from '@tanstack/react-query';
import { ComicCanvasEditor } from './comic-canvas-editor';
import { ComicPageList } from './comic-page-list';
import { ComicPanelInspector } from './comic-panel-inspector';
import { ComicRenderDialog } from './comic-render-dialog';
import { ComicImageHistory } from './comic-image-history';
import { ComicReader } from './comic-reader';
import { useComicAssets } from './use-comic-assets';
import { exportComicOfflineReader, fetchComicRevisions } from './api';

interface ComicWorkstationProps {
  activity: Activity;
  content: ContentDocument;
  actors: ActorSnapshot[];
  onBack(): void;
}

const templatePanelCounts: Record<ComicPage['template'], number> = { single: 1, duo: 2, trio: 3, quad: 4 };
const fieldClass = 'w-full rounded-[var(--radius-control)] border border-border-default bg-surface px-2.5 py-2 text-sm text-ink';
const emptyComicDocument: ComicDocument = {
  schemaVersion: 1, contentRevisionId: 'pending', style: 'ink-paper-v1', canvas: { width: 1920, height: 1080 }, pages: [], panels: [],
};

function newPanelFromBeat(beat: NonNullable<ReturnType<typeof getEffectiveStageScenes>[number]['beats'][number]>, stageId: string, sceneId: string): ComicPanel {
  return {
    id: crypto.randomUUID(), source: { stageId, sceneId, beatIds: [beat.id] }, actorIds: beat.characterId ? [beat.characterId] : [],
    shotSize: 'medium', visualDescription: '', composition: '', textSafeArea: 'none', selectedImage: null,
    crop: { focalX: 0.5, focalY: 0.5, zoom: 1 }, bubbles: [],
    presentation: { camera: 'none', impact: 'none', holdMs: null }, renderSettings: beat.renderSettings ?? {},
  };
}

function busy(job: ComicJob | undefined) { return Boolean(job && ['queued', 'preparing', 'running'].includes(job.status)); }

export function ComicWorkstation({ activity, content, actors, onBack }: ComicWorkstationProps) {
  const revisionId = activity.currentContentRevisionId || '';
  const queryClient = useQueryClient();
  const draftState = useComicDraft(activity.id, revisionId);
  const comic = draftState.document;
  const boundRevision = useActivityContentRevision(activity.id, comic?.contentRevisionId);
  const boundContent = boundRevision.data?.document ?? null;
  const sourceContent = boundContent ?? content;
  const comicAssets = useComicAssets(comic ?? emptyComicDocument);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [selectedBubbleId, setSelectedBubbleId] = useState<string | null>(null);
  const [newPageTemplate, setNewPageTemplate] = useState<ComicPage['template']>('trio');
  const [readingMode, setReadingMode] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [renderDialogOpen, setRenderDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [storyboardDialogOpen, setStoryboardDialogOpen] = useState(false);
  const [storyboardStageId, setStoryboardStageId] = useState(content.stages[0]?.id ?? '');
  const firstScene = content.stages[0] ? getEffectiveStageScenes(content.stages[0], content.scenes)[0] : null;
  const [storyboardSceneId, setStoryboardSceneId] = useState(firstScene?.id ?? '');
  const [panelCount, setPanelCount] = useState(6);
  const [instructions, setInstructions] = useState('');
  const [storyboardError, setStoryboardError] = useState<string | null>(null);
  const [latestStoryboardJobId, setLatestStoryboardJobId] = useState<string | null>(null);
  const [applyMode, setApplyMode] = useState<'append' | 'replace_scene'>('append');
  const [issues, setIssues] = useState<string[]>([]);
  const [fontReady, setFontReady] = useState(false);
  const [fontError, setFontError] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const storyboardAttempt = useRef<{ payload: string; idempotencyKey: string } | null>(null);
  const createStoryboard = useCreateComicStoryboard();
  const applyStoryboard = useApplyComicStoryboard();
  const createRevision = useCreateComicRevision();
  const jobsQuery = useComicJobs(activity.id);
  const focusedJobQuery = useComicJob(activity.id, latestStoryboardJobId ?? undefined);
  const latestStoryboardJob = focusedJobQuery.data ?? jobsQuery.data?.items.find((job) => job.kind === 'storyboard') ?? undefined;
  const isSaving = draftState.status === 'saving';

  const sceneOptions = useMemo(() => sourceContent.stages.flatMap((stage) => getEffectiveStageScenes(stage, sourceContent.scenes)
    .map((scene) => ({ stageId: stage.id, stageTitle: stage.title, scene }))), [sourceContent]);
  const selectedStageScenes = useMemo(() => {
    const stage = sourceContent.stages.find((item) => item.id === storyboardStageId);
    return stage ? getEffectiveStageScenes(stage, sourceContent.scenes) : [];
  }, [sourceContent, storyboardStageId]);

  useEffect(() => {
    if (!boundContent || boundContent.stages.some((stage) => stage.id === storyboardStageId)) return;
    setStoryboardStageId(boundContent.stages[0]?.id ?? '');
  }, [boundContent, storyboardStageId]);
  const defaultSourceBeat = sceneOptions.find((item) => item.scene.beats.length > 0);

  useEffect(() => {
    if (!selectedStageScenes.some((scene) => scene.id === storyboardSceneId)) setStoryboardSceneId(selectedStageScenes[0]?.id ?? '');
  }, [selectedStageScenes, storyboardSceneId]);

  useEffect(() => {
    if (!comic) return;
    if (!comic.pages.some((page) => page.id === selectedPageId)) {
      const firstPage = comic.pages[0];
      setSelectedPageId(firstPage?.id ?? '');
      setSelectedPanelId(firstPage?.panelIds[0] ?? null);
      setSelectedBubbleId(null);
    } else {
      const currentPage = comic.pages.find((page) => page.id === selectedPageId);
      if (currentPage && !currentPage.panelIds.includes(selectedPanelId ?? '')) setSelectedPanelId(currentPage.panelIds[0] ?? null);
    }
  }, [comic, selectedPageId, selectedPanelId]);

  useEffect(() => {
    let active = true;
    document.fonts.load('32px "Sthstart Comic Noto Sans SC"').then((faces) => {
      if (!active) return;
      const ready = faces.length > 0 && document.fonts.check('32px "Sthstart Comic Noto Sans SC"');
      setFontReady(ready);
      setFontError(!ready);
    }).catch(() => { if (active) { setFontReady(false); setFontError(true); } });
    return () => { active = false; };
  }, []);

  const page = comic?.pages.find((item) => item.id === selectedPageId) ?? comic?.pages[0] ?? null;
  const panel = comic?.panels.find((item) => item.id === selectedPanelId && page?.panelIds.includes(item.id))
    ?? comic?.panels.find((item) => item.id === page?.panelIds[0]) ?? null;
  const updateComic = (next: ComicDocument) => draftState.update(next);
  const updatePanel = (next: ComicPanel) => {
    if (!comic) return;
    updateComic({ ...comic, panels: comic.panels.map((item) => item.id === next.id ? next : item) });
  };
  const updatePanelRenderSettings = (settings: SceneBeatRenderSettings) => {
    if (!panel) return;
    updatePanel({ ...panel, renderSettings: settings });
  };
  const updateBubblePosition = (panelId: string, bubbleId: string, x: number, y: number) => {
    if (!comic) return;
    updateComic({ ...comic, panels: comic.panels.map((item) => item.id === panelId ? {
      ...item, bubbles: item.bubbles.map((bubble) => bubble.id === bubbleId ? { ...bubble, rect: { ...bubble.rect, x, y } } : bubble),
    } : item) });
  };

  const addBlankPage = (template = newPageTemplate) => {
    if (!comic || !defaultSourceBeat) return;
    const pageNumber = comic.pages.length + 1;
    const sourceBeat = defaultSourceBeat.scene.beats[0];
    const newPanels = Array.from({ length: templatePanelCounts[template] }, () => newPanelFromBeat(sourceBeat, defaultSourceBeat.stageId, defaultSourceBeat.scene.id));
    const newPage: ComicPage = { id: crypto.randomUUID(), title: `第 ${pageNumber} 页`, template, panelIds: newPanels.map((item) => item.id) };
    updateComic({ ...comic, pages: [...comic.pages, newPage], panels: [...comic.panels, ...newPanels] });
    setSelectedPageId(newPage.id);
    setSelectedPanelId(newPanels[0].id);
  };

  const movePage = (direction: -1 | 1) => {
    if (!comic || !page) return;
    const index = comic.pages.findIndex((item) => item.id === page.id);
    const target = index + direction;
    if (target < 0 || target >= comic.pages.length) return;
    const pages = [...comic.pages];
    [pages[index], pages[target]] = [pages[target], pages[index]];
    updateComic({ ...comic, pages });
  };

  const movePanel = (direction: -1 | 1) => {
    if (!comic || !page || !panel) return;
    const index = page.panelIds.indexOf(panel.id);
    const target = index + direction;
    if (target < 0 || target >= page.panelIds.length) return;
    const panelIds = [...page.panelIds];
    [panelIds[index], panelIds[target]] = [panelIds[target], panelIds[index]];
    updateComic({ ...comic, pages: comic.pages.map((item) => item.id === page.id ? { ...item, panelIds } : item) });
  };

  const removePage = () => {
    if (!comic || !page || !window.confirm(`删除“${page.title}”及其 ${page.panelIds.length} 个画格？已保存的漫画版本不会改变。`)) return;
    const removedIds = new Set(page.panelIds);
    const pages = comic.pages.filter((item) => item.id !== page.id);
    updateComic({ ...comic, pages, panels: comic.panels.filter((item) => !removedIds.has(item.id)) });
    setSelectedPageId(pages[0]?.id ?? '');
    setSelectedPanelId(pages[0]?.panelIds[0] ?? null);
    setSelectedBubbleId(null);
  };

  const requestStoryboard = async () => {
    if (!comic || !draftState.version || !storyboardStageId || !storyboardSceneId) return;
    setStoryboardError(null);
    if (!await draftState.flush()) return setStoryboardError('漫画草稿尚未保存完成，请先处理保存状态。');
    try {
      const expectedDraftVersion = draftState.getCurrentVersion() ?? draftState.version;
      const payload = JSON.stringify({ expectedDraftVersion, stageId: storyboardStageId, sceneId: storyboardSceneId, panelCount, instructions: instructions.trim() });
      const attemptKey = `sthstart:comic-storyboard-attempt:${activity.id}`;
      if (!storyboardAttempt.current) {
        try { storyboardAttempt.current = JSON.parse(sessionStorage.getItem(attemptKey) ?? 'null') as typeof storyboardAttempt.current; }
        catch { storyboardAttempt.current = null; }
      }
      if (storyboardAttempt.current?.payload !== payload) storyboardAttempt.current = { payload, idempotencyKey: crypto.randomUUID() };
      try { sessionStorage.setItem(attemptKey, JSON.stringify(storyboardAttempt.current)); } catch { /* in-memory retry remains available */ }
      const job = await createStoryboard.mutateAsync({ activityId: activity.id, request: {
        expectedDraftVersion, stageId: storyboardStageId, sceneId: storyboardSceneId,
        panelCount, instructions: instructions.trim() || undefined, idempotencyKey: storyboardAttempt.current.idempotencyKey,
      } });
      storyboardAttempt.current = null;
      try { sessionStorage.removeItem(attemptKey); } catch { /* optional retry persistence */ }
      setLatestStoryboardJobId(job.id);
      await queryClient.invalidateQueries({ queryKey: [...activityKeys.comicDraft(activity.id), 'jobs'] });
      setStoryboardDialogOpen(false);
    } catch (error) { setStoryboardError(error instanceof Error ? error.message : '创建分镜任务失败。'); }
  };

  const applyStoryboardResult = async (mode: 'append' | 'replace_scene') => {
    if (!comic || !draftState.version || !latestStoryboardJob?.id) return;
    if (mode === 'replace_scene' && !window.confirm('替换此场次的漫画页？仅会替换完全属于该场次的页面；与其他场次混排的页面会被保留。')) return;
    if (!await draftState.flush()) return setStoryboardError('漫画草稿尚未保存完成，不能应用分镜。');
    try {
      const expectedDraftVersion = draftState.getCurrentVersion() ?? draftState.version;
      const result = await applyStoryboard.mutateAsync({ activityId: activity.id, jobId: latestStoryboardJob.id, expectedDraftVersion, mode });
      setSelectedPageId(result.addedPageIds[0] ?? comic.pages[0]?.id ?? '');
      const nextPage = result.draft.document.pages.find((item) => item.id === result.addedPageIds[0]);
      setSelectedPanelId(nextPage?.panelIds[0] ?? null);
      setSelectedBubbleId(null);
      setStoryboardError(null);
    } catch (error) { setStoryboardError(error instanceof Error ? error.message : '应用分镜失败。'); }
  };

  const saveVersion = async () => {
    if (!draftState.version || !await draftState.flush()) return;
    const expectedDraftVersion = draftState.getCurrentVersion() ?? draftState.version;
    try { await createRevision.mutateAsync({ activityId: activity.id, expectedDraftVersion }); }
    catch (error) { setStoryboardError(error instanceof Error ? error.message : '保存漫画版本失败。'); }
  };

  const rerenderSelectedImage = () => {
    if (!comic || !panel?.selectedImage) return;
    const renderJobId = panel.selectedImage.renderJobId;
    if (renderJobId) {
      const sourceJob = jobsQuery.data?.items.find((job) => job.id === renderJobId);
      const snapshot = sourceJob?.input.renderSettings;
      if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
        updatePanel({ ...panel, renderSettings: snapshot as SceneBeatRenderSettings });
      }
    }
    setRenderDialogOpen(true);
  };

  const ensureExportRevision = async () => {
    if (!comic || !await draftState.flush()) throw new Error('漫画草稿尚未保存；请处理保存状态后再导出。');
    const version = draftState.getCurrentVersion();
    if (!version) throw new Error('漫画草稿版本尚未就绪。');
    const revisions = await queryClient.fetchQuery({
      queryKey: activityKeys.comicRevisions(activity.id),
      queryFn: () => fetchComicRevisions(activity.id),
      staleTime: 0,
    });
    const currentJson = JSON.stringify(comic);
    const existing = revisions.find((revision) => JSON.stringify(revision.document) === currentJson);
    if (existing) return existing;
    const revision = await createRevision.mutateAsync({ activityId: activity.id, expectedDraftVersion: version });
    if (JSON.stringify(revision.document) !== currentJson) throw new Error('保存版本与当前漫画内容不一致，请重新打开导出窗口后重试。');
    return revision;
  };

  const renderPagePng = async (documentToRender: ComicDocument, targetPage: ComicPage) => {
    await document.fonts.ready;
    await document.fonts.load('32px "Sthstart Comic Noto Sans SC"');
    if (!document.fonts.check('32px "Sthstart Comic Noto Sans SC"')) throw new Error('本地漫画字体未能载入，已停止导出。');
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建 PNG 画布。');
    const panels = documentToRender.panels.filter((item) => targetPage.panelIds.includes(item.id));
    if (comicAssets.loading) throw new Error('画格图片仍在载入，请稍后再试。');
    const missingImage = panels.find((item) => !item.selectedImage || !comicAssets.assets.getImage(item.selectedImage.artifactId));
    if (missingImage) throw new Error(`画格 ${missingImage.id} 的图片未能读取。`);
    const bubbleIds = panels.flatMap((item) => item.bubbles.map((bubble) => bubble.id));
    const renderIssues = renderComicPage(context, documentToRender, targetPage, {
      pageId: targetPage.id, visiblePanelIds: targetPage.panelIds, visibleBubbleIds: bubbleIds,
      activePanelId: null, effectProgress: 1, reducedMotion: true,
    }, comicAssets.assets);
    const issue = renderIssues.find((item) => item.code === 'bubble_overflow' || item.code === 'missing_image');
    if (issue) throw new Error(`画格 ${issue.panelId}${issue.bubbleId ? ` 的气泡 ${issue.bubbleId}` : ''}：${issue.message}`);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('浏览器未能生成 PNG 图片。');
    return blob;
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const runExport = async (action: () => Promise<void>) => {
    setExportError(null);
    setExporting(true);
    try { await action(); setExportDialogOpen(false); }
    catch (error) {
      const message = error instanceof Error ? error.message : '漫画导出失败。';
      const details = (error as { details?: unknown }).details;
      setExportError(Array.isArray(details) && details.every((item) => typeof item === 'string') ? `${message}\n${details.join('\n')}` : message);
    }
    finally { setExporting(false); }
  };

  const exportCurrentPage = async () => {
    if (!comic || !page || !fontReady) throw new Error('漫画字体或页面尚未就绪。');
    const revision = await ensureExportRevision();
    const exportPage = revision.document.pages.find((item) => item.id === page.id);
    if (!exportPage) throw new Error('当前页面已不在保存版本中，请刷新后重试。');
    const index = revision.document.pages.findIndex((item) => item.id === exportPage.id) + 1;
    downloadBlob(await renderPagePng(revision.document, exportPage), `page-${String(index).padStart(3, '0')}.png`);
  };

  const exportAllPages = async () => {
    if (!comic || !fontReady) throw new Error('漫画字体或文档尚未就绪。');
    const revision = await ensureExportRevision();
    const files: Record<string, Uint8Array> = {};
    for (const [index, exportPage] of revision.document.pages.entries()) {
      const blob = await renderPagePng(revision.document, exportPage);
      files[`page-${String(index + 1).padStart(3, '0')}.png`] = new Uint8Array(await blob.arrayBuffer());
    }
    if (!Object.keys(files).length) throw new Error('漫画版本还没有页面。');
    downloadBlob(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), 'comic-pages.zip');
  };

  const exportOfflineReader = async () => {
    const revision = await ensureExportRevision();
    const archive = await exportComicOfflineReader(activity.id, revision.id);
    downloadBlob(archive, `comic-reader-${revision.id}.zip`);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!context || !panel || !page || !comic) { setIssues([]); return; }
    const panelRect = panelLayoutForPage(page.template, page.panelIds).find((entry) => entry.panelId === panel.id)?.rect;
    if (!panelRect) { setIssues([]); return; }
    setIssues([...(panel.selectedImage ? [] : ['当前画格尚未选择图片']), ...panel.bubbles.flatMap((bubble) => {
      context.font = `${bubble.kind === 'emphasis' ? '700 ' : '500 '}${bubble.fontSize}px "Sthstart Comic Noto Sans SC", sans-serif`;
      const textLayout = layoutBubbleText(context, bubble, Math.max(1, bubble.rect.width * panelRect.width - 36), Math.max(1, bubble.rect.height * panelRect.height - 36));
      return textLayout.overflow ? [`气泡“${bubble.text.slice(0, 12)}”文字超出边界`] : [];
    })]);
  }, [comic, panel, page]);

  if (draftState.status === 'error' && !comic) return <div role="alert" className="grid h-full min-h-0 place-items-center p-6 text-sm text-danger">{draftState.error ?? '漫画草稿读取失败。'}</div>;
  if (boundRevision.isError) return <div role="alert" className="grid h-full min-h-0 place-items-center p-6 text-sm text-danger">漫画绑定的剧情版本读取失败，请刷新后重试。</div>;
  if (draftState.loading || !comic || !boundContent) return <div className="grid h-full min-h-0 place-items-center text-sm text-muted">正在载入漫画草稿…</div>;
  if (readingMode) return <div className="flex h-full min-h-0 flex-col bg-surface">
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-default px-3 py-2">
      <Button size="sm" variant="ghost" onClick={onBack}>← 原回放</Button>
      <span className="text-sm font-semibold text-ink">漫画逐格阅读</span>
      <Button size="sm" variant="outline" onClick={() => setReadingMode(false)}>返回编辑</Button>
    </div>
    <div className="min-h-0 flex-1"><ComicReader document={comic} fontReady={fontReady} assets={comicAssets.assets} loading={comicAssets.loading} missingArtifactIds={comicAssets.missingArtifactIds} /></div>
  </div>;
  const selectedPageHasImages = Boolean(page?.panelIds.length && page.panelIds.every((id) => comic.panels.find((item) => item.id === id)?.selectedImage));
  const result = latestStoryboardJob?.result as (ComicStoryboardModelOutput & { pages?: ComicPage[]; panels?: ComicPanel[] }) | null;
  const resultPanels = (result?.panels ?? []) as ComicPanel[];
  const canApply = latestStoryboardJob?.status === 'succeeded' && resultPanels.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-default px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack}>← 原回放</Button><span className="text-sm font-semibold text-ink">漫画编辑</span>
          <span className="text-xs text-muted">{draftState.status === 'saving' ? '保存中…' : draftState.status === 'saved' ? `已保存 · v${draftState.version ?? '—'}` : draftState.status === 'loading' ? '载入中…' : draftState.status === 'conflict' ? '版本冲突' : '保存失败'}</span>
          {draftState.error && <span role="alert" className="max-w-[min(70vw,520px)] truncate text-xs text-danger" title={draftState.error}>{draftState.error}</span>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {draftState.status === 'conflict' && <><Button size="sm" variant="outline" onClick={() => draftState.resolveConflict(false)}>使用服务器版本</Button><Button size="sm" variant="outline" onClick={() => draftState.resolveConflict(true)}>保留本地并保存</Button></>}
          {draftState.status === 'error' && <Button size="sm" variant="outline" onClick={draftState.retry}>重试保存</Button>}
          <Button size="sm" variant="outline" onClick={() => setStoryboardDialogOpen(true)} disabled={!revisionId || !draftState.version || isSaving}>✦ 生成分镜草案</Button>
          <Button size="sm" variant="outline" onClick={saveVersion} disabled={!draftState.version || isSaving || createRevision.isPending}>保存漫画版本</Button>
          <Button size="sm" variant="outline" onClick={() => setMobileInspectorOpen(true)} className="xl:hidden">编辑选中画格</Button>
          <Button size="sm" variant="outline" onClick={() => setReadingMode(true)} disabled={!comic.pages.length || draftState.status !== 'saved'}>逐格阅读</Button>
        </div>
      </div>
      {!revisionId && <div role="alert" className="shrink-0 border-b border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">当前活动还没有已保存的剧情版本。请先在活动编辑中保存内容版本，再创建漫画草稿。</div>}
      {comic.contentRevisionId !== revisionId && <div role="status" className="shrink-0 border-b border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">这份漫画绑定较早的剧情版本。画格来源、角色和分镜生成都使用原版本；当前活动的新剧情不会自动改写漫画。</div>}
      {fontError && <div role="alert" className="shrink-0 border-b border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">漫画字体未能载入，导出已停用。请检查应用是否包含本地字体文件。</div>}
      {!fontReady && !fontError && <div aria-live="polite" className="shrink-0 border-b border-border-default px-3 py-1 text-xs text-muted">正在载入漫画字体…</div>}
      {(storyboardError || latestStoryboardJob?.errorMessage) && <div role="alert" className="mx-3 mt-2 shrink-0 rounded-[var(--radius-control)] border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{storyboardError ?? latestStoryboardJob?.errorMessage}</div>}
      {latestStoryboardJob && <section className="mx-3 mt-2 max-h-48 shrink-0 overflow-y-auto rounded-[var(--radius-panel)] border border-border-default bg-surface-muted/40 p-3" aria-label="分镜生成任务">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-ink">分镜草案任务</h3><p className="text-xs text-muted">{busy(latestStoryboardJob) ? '生成中…' : latestStoryboardJob.status === 'succeeded' ? `已生成 ${resultPanels.length} 格；尚未应用到漫画` : `状态：${latestStoryboardJob.status}`}</p></div>
          {latestStoryboardJob.callId && <a className="text-xs font-medium text-accent hover:underline" href={`/settings/ai-logs?callId=${encodeURIComponent(latestStoryboardJob.callId)}`} target="_blank" rel="noreferrer">查看调用日志 ↗</a>}
        </div>
        {canApply && <><div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{resultPanels.map((item, index) => <article key={item.id} className="min-w-0 rounded-[var(--radius-control)] border border-border-default bg-surface p-2 text-xs"><p className="font-semibold text-ink">{index + 1}. {item.shotSize}</p><p className="mt-1 line-clamp-3 text-muted">{item.visualDescription}</p><p className="mt-1 line-clamp-2 text-muted">{item.bubbles.map((bubble) => bubble.text).join(' / ')}</p></article>)}</div>
          <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="primary" loading={applyStoryboard.isPending} onClick={() => void applyStoryboardResult('append')} disabled={draftState.status !== 'saved'}>追加到漫画</Button><Button size="sm" variant="outline" loading={applyStoryboard.isPending} onClick={() => void applyStoryboardResult('replace_scene')} disabled={draftState.status !== 'saved'}>替换该场次页面…</Button></div>
        </>}
      </section>}
      {comic.pages.length > 0 && page ? <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[190px_minmax(0,1fr)_320px] xl:grid-rows-1">
        <ComicPageList pages={comic.pages} panels={comic.panels} selectedPageId={page.id} newPageTemplate={newPageTemplate} onTemplateChange={setNewPageTemplate}
          canAdd={Boolean(defaultSourceBeat) && comic.pages.length < 20} onSelect={(id) => { setSelectedPageId(id); const next = comic.pages.find((item) => item.id === id); setSelectedPanelId(next?.panelIds[0] ?? null); setSelectedBubbleId(null); }}
          onAdd={() => addBlankPage()} onMove={movePage} onRemove={removePage} />
        <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto]">
          <ComicCanvasEditor document={comic} page={page} selectedPanelId={panel?.id ?? null} selectedBubbleId={selectedBubbleId} assets={comicAssets.assets}
            onSelectPanel={(id) => { setSelectedPanelId(id); setSelectedBubbleId(null); }} onSelectBubble={(panelId, bubbleId) => { if (panelId) setSelectedPanelId(panelId); setSelectedBubbleId(bubbleId); }} onMoveBubble={updateBubblePosition} />
          <ComicImageHistory activityId={activity.id} panel={panel} draftVersion={draftState.version} flush={draftState.flush} getDraftVersion={draftState.getCurrentVersion} />
        </div>
        <div className="hidden min-h-0 xl:flex"><ComicPanelInspector panel={panel} content={boundContent} page={page} selectedBubbleId={selectedBubbleId} issues={issues}
          onChange={updatePanel} onSelectBubble={setSelectedBubbleId} onOpenRenderSettings={() => setRenderDialogOpen(true)} onRerenderSelected={rerenderSelectedImage}
          onMovePanel={movePanel}
          onExportPng={() => { setExportError(null); setExportDialogOpen(true); }} canExport={fontReady && selectedPageHasImages && issues.length === 0} /></div>
        <Drawer open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen} position="bottom" title="编辑画格" description="图片与台词分开保存；拖动气泡可调整位置。">
          <ComicPanelInspector panel={panel} content={boundContent} page={page} selectedBubbleId={selectedBubbleId} issues={issues}
            onChange={updatePanel} onSelectBubble={setSelectedBubbleId} onOpenRenderSettings={() => setRenderDialogOpen(true)} onRerenderSelected={rerenderSelectedImage}
            onMovePanel={movePanel}
            onExportPng={() => { setExportError(null); setExportDialogOpen(true); }} canExport={fontReady && selectedPageHasImages && issues.length === 0} />
        </Drawer>
      </div> : <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6 text-center"><div className="max-w-xl"><p className="font-semibold text-ink">漫画草稿还没有页面</p><p className="mt-1 text-sm text-muted">选择一个已保存的剧情场次，生成 4～8 格分镜草案；草案会先供你审阅，不会自动写进漫画。</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2"><select className={fieldClass} value={newPageTemplate} onChange={(event) => setNewPageTemplate(event.target.value as ComicPage['template'])} aria-label="新页面版式"><option value="single">单格页</option><option value="duo">双格页</option><option value="trio">三格页</option><option value="quad">四格页</option></select>
          <Button variant="outline" onClick={() => addBlankPage()} disabled={!defaultSourceBeat}>手工新增页面</Button>
          <Button variant="primary" onClick={() => setStoryboardDialogOpen(true)} disabled={!revisionId || !draftState.version}>生成分镜草案</Button></div></div></div>}
      {panel && <ComicRenderDialog open={renderDialogOpen} onOpenChange={setRenderDialogOpen} activityId={activity.id} draftVersion={draftState.version}
        getDraftVersion={draftState.getCurrentVersion}
        panel={panel} actorReferenceKeys={panel.actorIds.flatMap((actorId) => {
          const actor = boundContent.actors.find((item) => item.id === actorId);
          return (actor?.appearanceReferenceAssetKeys ?? []).map((key) => ({ key, actorName: actor?.displayName ?? actorId }));
        })} onSettingsChange={updatePanelRenderSettings} flush={draftState.flush} onSubmitted={() => {
          void queryClient.invalidateQueries({ queryKey: [...activityKeys.comicDraft(activity.id), 'jobs'] });
          setStoryboardError(null);
        }} />}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen} title="导出漫画" description="导出内容来自已保存的不可变漫画版本；未保存的编辑会先保存。" size="md" className="max-h-[90dvh]">
        <div className="space-y-3">
          <p className="text-sm text-muted">PNG 与离线阅读包共用漫画画布和排版。离线阅读包可解压后直接双击 index.html 打开。</p>
          {comicAssets.loading && <p className="text-sm text-muted">正在载入画格图片…</p>}
          {comicAssets.missingArtifactIds.length > 0 && <p role="alert" className="rounded-[var(--radius-control)] border border-danger/30 bg-danger/5 p-2 text-sm text-danger">有 {comicAssets.missingArtifactIds.length} 张图片无法读取，导出将被阻止。</p>}
          {exportError && <p role="alert" className="whitespace-pre-line rounded-[var(--radius-control)] border border-danger/30 bg-danger/5 p-2 text-sm text-danger">{exportError}</p>}
          <div className="grid gap-2 sm:grid-cols-1">
            <Button variant="outline" loading={exporting} disabled={!fontReady || comicAssets.loading || !page} onClick={() => void runExport(exportCurrentPage)}>导出当前页 PNG</Button>
            <Button variant="outline" loading={exporting} disabled={!fontReady || comicAssets.loading || !comic.pages.length} onClick={() => void runExport(exportAllPages)}>导出全部页面 PNG（ZIP）</Button>
            <Button variant="primary" loading={exporting} disabled={!comic.pages.length} onClick={() => void runExport(exportOfflineReader)}>导出离线阅读包（ZIP）</Button>
          </div>
          <div className="flex justify-end"><Button variant="ghost" disabled={exporting} onClick={() => setExportDialogOpen(false)}>关闭</Button></div>
        </div>
      </Dialog>
      <Dialog open={storyboardDialogOpen} onOpenChange={setStoryboardDialogOpen} title="生成分镜草案" description="输入来自已保存的剧情版本。生成结果先审阅，再选择追加或替换。" size="md" className="max-h-[90dvh]">
        <div className="space-y-3">
          <label className="block space-y-1 text-xs font-medium text-muted">阶段<select className={fieldClass} value={storyboardStageId} onChange={(event) => { setStoryboardStageId(event.target.value); const stage = boundContent.stages.find((item) => item.id === event.target.value); setStoryboardSceneId(stage ? getEffectiveStageScenes(stage, boundContent.scenes)[0]?.id ?? '' : ''); }}>
            {boundContent.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}</select></label>
          <label className="block space-y-1 text-xs font-medium text-muted">场次<select className={fieldClass} value={storyboardSceneId} onChange={(event) => setStoryboardSceneId(event.target.value)}>
            {selectedStageScenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title || '未命名场次'}</option>)}</select></label>
          <label className="block space-y-1 text-xs font-medium text-muted">画格数<select className={fieldClass} value={panelCount} onChange={(event) => setPanelCount(Number(event.target.value))}>{[4, 5, 6, 7, 8].map((count) => <option key={count} value={count}>{count} 格</option>)}</select></label>
          <label className="block space-y-1 text-xs font-medium text-muted">分镜要求（可选）<textarea className={`${fieldClass} min-h-24 resize-y`} maxLength={4000} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="例如：先建立雪山营地全景，再用特写表现结晶发光，台词节奏轻松。" /></label>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setStoryboardDialogOpen(false)}>取消</Button><Button variant="primary" loading={createStoryboard.isPending} disabled={!storyboardSceneId || draftState.status !== 'saved'} onClick={() => void requestStoryboard()}>生成草案</Button></div>
        </div>
      </Dialog>
      <canvas ref={canvasRef} width={1920} height={1080} className="hidden" aria-hidden="true" />
    </div>
  );
}
