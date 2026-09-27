'use client';

import type { ComicHistoryImage, ComicPanel } from '@sthstart/contracts';
import { useComicPanelHistory } from '../queries';
import { useSelectComicPanelImage } from '../mutations';

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
  const query = useComicPanelHistory(activityId, panel?.id);
  const selectImage = useSelectComicPanelImage();
  if (!panel) return <section className="shrink-0 border-t border-border-default bg-surface px-3 py-2"><p className="text-xs text-muted">选择画格后查看该格的绘制历史。</p></section>;

  const choose = async (item: ComicHistoryImage) => {
    if (!item.available || !draftVersion || !await flush()) return;
    const expectedDraftVersion = getDraftVersion() ?? draftVersion;
    const allowStaleSource = item.sourceChanged && window.confirm('这张图片来自不同的画面描述。仍要将它切换为当前画格图片吗？');
    if (item.sourceChanged && !allowStaleSource) return;
    await selectImage.mutateAsync({ activityId, panelId: panel.id, request: {
      expectedDraftVersion, artifactId: item.artifactId, allowStaleSource,
    } });
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
      {images.length ? <div className="flex w-max gap-2">{images.map((item) => <button key={`${item.origin}:${item.artifactId}`} type="button" disabled={!item.available || selectImage.isPending}
        onClick={() => void choose(item)} aria-label={`${item.current ? '当前' : '切换为'}历史图片，绘制于 ${new Date(item.createdAt).toLocaleString()}`}
        className={`group relative w-28 shrink-0 overflow-hidden rounded-[var(--radius-control)] border bg-surface text-left ${item.current ? 'border-accent ring-1 ring-accent' : 'border-border-default'} disabled:cursor-not-allowed disabled:opacity-50`}>
        {item.previewUrl ? <img src={item.previewUrl} alt="漫画绘制历史缩略图" loading="lazy" className="aspect-[4/3] w-full object-cover" />
          : <span className="grid aspect-[4/3] place-items-center bg-surface-muted text-[11px] text-muted">文件不可用</span>}
        <span className="absolute left-1 top-1 rounded bg-ink/75 px-1 py-0.5 text-[10px] font-medium text-white">{item.current ? '当前' : item.sourceChanged ? '描述不同' : '历史'}</span>
        <span className="block truncate px-1.5 py-1 text-[10px] text-muted">{new Date(item.createdAt).toLocaleString()}</span>
      </button>)}</div> : <p className="py-2 text-xs text-muted">尚无绘制图片。图片生成完成后会保留在这里。</p>}
    </div>
    {nonImageJobs.length > 0 && <details className="border-t border-border-subtle px-3 py-1.5">
      <summary className="cursor-pointer text-[11px] font-medium text-muted">失败与处理中记录（{nonImageJobs.length}）</summary>
      <div className="mt-1 flex max-h-20 flex-col gap-1 overflow-y-auto pb-1 text-[11px]" data-autohide-scroll>{nonImageJobs.map((job) => <div key={job.id} className="flex items-center justify-between gap-2">
        <span className={job.status === 'failed' || job.status === 'interrupted' ? 'min-w-0 truncate text-danger' : 'min-w-0 truncate text-muted'}>{new Date(job.createdAt).toLocaleString()} · {statusText(job.status)}{job.errorMessage ? ` · ${job.errorMessage}` : ''}</span>
        {job.callId && <a className="shrink-0 text-accent hover:underline" href={`/settings/ai-logs?callId=${encodeURIComponent(job.callId)}`} target="_blank" rel="noreferrer">调用日志 ↗</a>}
      </div>)}</div>
    </details>}
    {selectImage.isError && <p role="alert" className="px-3 pb-2 text-xs text-danger">{selectImage.error instanceof Error ? selectImage.error.message : '切换图片失败。'}</p>}
  </section>;
}
