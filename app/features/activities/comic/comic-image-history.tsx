'use client';

import { useState } from 'react';
import type { ComicHistoryImage, ComicPanel } from '@sthstart/contracts';
import { useComicDraftRecord, useComicPanelHistory } from '../queries';
import { useCreateComicPanelRender, usePreviewComicPanelRender, useSelectComicPanelImage } from '../mutations';
import { StudioHiresDialog } from '../components/studio-hires-dialog';

interface ComicImageHistoryProps {
  activityId: string;
  panel: ComicPanel | null;
  draftVersion: number | null;
  flush(): Promise<boolean>;
  getDraftVersion(): number | null;
}

function statusText(status: string) {
  return ({ queued: '排队中', preparing: '准备中', running: '绘制中', succeeded: '已完成', failed: '失败', interrupted: '已中断', unknown: '状态未知' } as Record<string, string>)[status] ?? status;
}

export function ComicImageHistory({ activityId, panel, draftVersion, flush, getDraftVersion }: ComicImageHistoryProps) {
  const persistedDraft = useComicDraftRecord(activityId);
  const persistedPanelId = persistedDraft.data?.document.panels.some(item => item.id === panel?.id) ? panel?.id : undefined;
  // A newly added local panel does not exist on the server until the save queue finishes.
  const query = useComicPanelHistory(activityId, persistedPanelId);
  const selectImage = useSelectComicPanelImage();
  const previewRender = usePreviewComicPanelRender();
  const createRender = useCreateComicPanelRender();
  /** 待细化的历史图；打开弹窗不提交草稿、不创建任务、不调用模型。 */
  const [hiresImage, setHiresImage] = useState<ComicHistoryImage | null>(null);
  const [sourcePreviewKey, setSourcePreviewKey] = useState('');
  /** “按原配置重绘”的结果说明：成功、配置已变化、或失败原因。 */
  const [rerenderNotice, setRerenderNotice] = useState('');
  if (!panel) return <section className="shrink-0 border-t border-border-default bg-surface px-3 py-2"><p className="text-xs text-muted">选择画格后查看该格的绘制历史。</p></section>;

  /**
   * 按原配置重绘（计划 §1.1）：复用画格当前持久化的配置，换一个新种子。
   * 与“放大细化”不同——这里不以原图为输入，也不共用同一个按钮含义。
   */
  const rerender = async (item: ComicHistoryImage) => {
    if (!item.available || !draftVersion || !await flush()) return;
    setRerenderNotice('');
    // 来自镜头绘制的历史图用的是镜头配置，不能在漫画这里冒充“原配置”。
    if (item.origin !== 'comic_render') {
      setRerenderNotice('这张图来自镜头绘制，请在镜头页面按原配置重绘。');
      return;
    }
    if (item.sourceChanged && !window.confirm('这张图片来自不同的画面描述，重绘会使用当前画面描述与画格设置。仍要继续吗？')) return;
    const expectedDraftVersion = getDraftVersion() ?? draftVersion;
    const seed = Math.floor(Math.random() * 2_147_483_647);
    try {
      const preview = await previewRender.mutateAsync({ activityId, panelId: panel.id, expectedDraftVersion, seed });
      if (!preview.canSubmit) { setRerenderNotice('当前配置未通过检查，不能提交重绘；请打开绘制弹窗查看具体原因。'); return; }
      await createRender.mutateAsync({ activityId, panelId: panel.id, request: {
        expectedDraftVersion, planHash: preview.planHash, seed, idempotencyKey: `comic-rerender-${item.artifactId}-${seed}`,
      } });
      setRerenderNotice('已按当前画格配置提交重绘（换了新种子），结果会作为新历史保留。');
    } catch (cause) {
      setRerenderNotice(cause instanceof Error ? cause.message : '按原配置重绘失败，未创建任务。');
    }
  };

  const choose = async (item: ComicHistoryImage) => {
    if (!item.available || !draftVersion || !await flush()) return;
    const expectedDraftVersion = getDraftVersion() ?? draftVersion;
    const allowStaleSource = item.sourceChanged && window.confirm('这张图片来自不同的画面描述。仍要将它切换为当前画格图片吗？');
    if (item.sourceChanged && !allowStaleSource) return;
    try {
      await selectImage.mutateAsync({ activityId, panelId: panel.id, request: {
        expectedDraftVersion, artifactId: item.artifactId, allowStaleSource,
      } });
    } catch { /* The mutation's error is shown below; keep the current image and local edits. */ }
  };

  const images = query.data?.pages.flatMap((page) => page.images).filter((image, index, all) => all.findIndex((item) => item.artifactId === image.artifactId) === index) ?? [];
  const jobs = query.data?.pages[0]?.jobs ?? [];
  const nonImageJobs = jobs.filter((job) => job.status !== 'succeeded' || !images.some((image) => image.renderJobId === job.id));
  return <section className="flex shrink-0 flex-col border-t border-border-default bg-surface" aria-label="镜头绘制历史">
    <div className="flex items-center justify-between gap-2 px-3 pt-2"><div className="flex items-center gap-2"><h3 className="text-xs font-semibold text-ink">画格历史图片</h3><span className="text-[11px] text-muted">{images.length} 张</span></div>
      {query.isFetching && !query.isFetchingNextPage && <span className="text-[11px] text-muted">更新中…</span>}
    </div>
    {query.hasNextPage && <button type="button" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}
      className="mx-3 mb-2 self-start text-xs font-medium text-accent disabled:opacity-50">{query.isFetchingNextPage ? '正在载入…' : '加载更早的图片'}</button>}
    <div className="min-h-0 overflow-x-auto px-3 py-2" data-autohide-scroll>
      {images.length ? <div className="flex w-max gap-2">{images.map((item) => {
        const itemKey = `${item.origin}:${item.artifactId}`;
        const isHires = item.imageOperation?.operation === 'hires';
        const parentArtifactId = item.imageOperation?.parentArtifactId ?? null;
        const parent = parentArtifactId ? images.find((image) => image.artifactId === parentArtifactId) : null;
        return <div key={itemKey} className="w-28 shrink-0 space-y-1">
          <button type="button" disabled={!item.available || selectImage.isPending}
            onClick={() => void choose(item)} aria-label={`${item.current ? '当前' : '切换为'}历史图片${isHires ? '（细化）' : ''}，绘制于 ${new Date(item.createdAt).toLocaleString()}`}
            className={`group relative block w-28 overflow-hidden rounded-[var(--radius-control)] border bg-surface text-left ${item.current ? 'border-accent ring-1 ring-accent' : 'border-border-default'} disabled:cursor-not-allowed disabled:opacity-50`}>
            {item.previewUrl ? <img src={item.previewUrl} alt="漫画绘制历史缩略图" loading="lazy" className="aspect-[4/3] w-full object-cover" />
              : <span className="grid aspect-[4/3] place-items-center bg-surface-muted text-[11px] text-muted">文件不可用</span>}
            <span className="absolute left-1 top-1 rounded bg-ink/75 px-1 py-0.5 text-[10px] font-medium text-white">{item.current ? '当前' : item.sourceChanged ? '描述不同' : '历史'}</span>
            {isHires && <span className="absolute right-1 top-1 rounded bg-accent/90 px-1 py-0.5 text-[10px] font-medium text-white">细化</span>}
            <span className="block truncate px-1.5 py-1 text-[10px] text-muted">{new Date(item.createdAt).toLocaleString()}</span>
          </button>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
            <button type="button" className="text-accent hover:underline disabled:text-muted" disabled={!item.available || selectImage.isPending}
              onClick={() => void choose(item)}>使用</button>
            <button type="button" className="text-accent hover:underline disabled:text-muted" disabled={!item.available || previewRender.isPending || createRender.isPending}
              onClick={() => void rerender(item)}>按原配置重绘</button>
            <button type="button" className="text-accent hover:underline disabled:text-muted" disabled={!item.available}
              onClick={() => { setSourcePreviewKey(''); setHiresImage(item); }}>放大细化</button>
            {item.callId && <a className="text-accent hover:underline" href={`/settings/ai-logs?callId=${encodeURIComponent(item.callId)}`} target="_blank" rel="noreferrer">日志</a>}
            {isHires && <button type="button" className="text-accent hover:underline disabled:text-muted" disabled={!parent}
              title={parent ? '显示本次细化所用的来源图' : '来源图在更早的分页里，请先加载更早的图片'}
              onClick={() => setSourcePreviewKey((current) => current === itemKey ? '' : itemKey)}>来源图</button>}
          </div>
          {isHires && sourcePreviewKey === itemKey && parent?.previewUrl && <div className="overflow-hidden rounded border border-border-default">
            <img src={parent.previewUrl} alt="细化来源图" className="aspect-[4/3] w-full object-cover" />
            <p className="px-1 py-0.5 text-[10px] text-muted">细化来源</p>
          </div>}
        </div>;
      })}</div> : <p className="py-2 text-xs text-muted">尚无绘制图片。图片生成完成后会保留在这里。</p>}
    </div>
    {nonImageJobs.length > 0 && <details className="border-t border-border-subtle px-3 py-1.5">
      <summary className="cursor-pointer text-[11px] font-medium text-muted">失败与处理中记录（{nonImageJobs.length}）</summary>
      <div className="mt-1 flex max-h-20 flex-col gap-1 overflow-y-auto pb-1 text-[11px]" data-autohide-scroll>{nonImageJobs.map((job) => <div key={job.id} className="flex items-center justify-between gap-2">
        <span className={job.status === 'failed' || job.status === 'interrupted' ? 'min-w-0 truncate text-danger' : 'min-w-0 truncate text-muted'}>{new Date(job.createdAt).toLocaleString()} · {statusText(job.status)}{job.errorMessage ? ` · ${job.errorMessage}` : ''}</span>
        {job.callId && <a className="shrink-0 text-accent hover:underline" href={`/settings/ai-logs?callId=${encodeURIComponent(job.callId)}`} target="_blank" rel="noreferrer">调用日志 ↗</a>}
      </div>)}</div>
    </details>}
    {selectImage.isError && <p role="alert" className="px-3 pb-2 text-xs text-danger">{selectImage.error instanceof Error ? selectImage.error.message : '切换图片失败。'}</p>}
    {rerenderNotice && <p role="status" className="break-words px-3 pb-2 text-xs text-muted">{rerenderNotice}</p>}
    <StudioHiresDialog
      activityId={activityId}
      target={{ kind: 'comic_panel', panelId: panel.id }}
      sourceArtifactId={hiresImage?.artifactId ?? null}
      sourceImageUrl={hiresImage?.previewUrl ?? null}
      sourceLabel={hiresImage ? `画格 ${panel.id} · ${new Date(hiresImage.createdAt).toLocaleString()}` : undefined}
      open={Boolean(hiresImage)}
      onOpenChange={(next) => { if (!next) setHiresImage(null); }}
      beforePreview={flush}
      onCreated={() => { void query.refetch(); }}
    />
  </section>;
}
