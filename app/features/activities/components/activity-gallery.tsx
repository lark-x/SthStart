'use client';
import { useState } from 'react';
import { useActivityGallery } from '../queries';
import { Button } from '@/app/components/ui/button';

export function ActivityGallery({ activityId, onCreate }: { activityId: string; onCreate(): void }) {
  const gallery = useActivityGallery(activityId);
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<'all' | 'beat' | 'comic' | 'material' | 'upload'>('all');
  const images = (gallery.data?.items ?? []).filter(item => kind === 'all' || item.kind === kind);
  const counts = gallery.data?.counts;
  const kinds = [['all','全部'],['beat','镜头'],['comic','漫画'],['material','素材'],['upload','上传']] as const;
  const count = (value: typeof kinds[number][0]) => !counts ? '' :
    ` ${value === 'all' ? counts.beat + counts.comic + counts.material + counts.upload : counts[value]}`;
  return <section aria-label="活动画廊" className="space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">活动画廊</h2><p className="mt-1 text-sm text-muted">汇总镜头、漫画、素材与上传图片；这里只读浏览，选用与绘制仍在对应工作台进行。</p></div><Button variant="outline" onClick={onCreate}>前往素材制作</Button></header>
    <div className="flex flex-wrap gap-2">{kinds.map(([value,label]) =>
      <Button key={value} size="sm" variant={kind === value ? 'accent' : 'ghost'} onClick={() => setKind(value)}>{label}{count(value)}</Button>)}</div>
    {gallery.isPending && <p role="status" className="text-sm text-muted">加载图片…</p>}
    {gallery.isError && <><p role="alert" className="text-danger-fg">{gallery.error.message}</p><Button variant="outline" onClick={() => void gallery.refetch()}>重新加载</Button></>}
    {gallery.isSuccess && !images.length && <p className="rounded-[var(--radius-panel)] bg-surface p-8 text-center text-sm text-muted">{kind === 'all' ? '还没有图片资产，完成绘制或上传后会显示在这里。' : '当前分类没有图片。'}</p>}
    {images.length > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{images.map(image => <article key={image.artifactId} className="min-w-0 overflow-hidden rounded-[var(--radius-panel)] bg-surface">
      <div className="grid aspect-[4/3] place-items-center bg-surface-muted">{!image.available || unavailable.has(image.artifactId) ? <span className="text-sm text-muted">文件不可用</span> : <img src={`/api/admin/artifacts/${encodeURIComponent(image.artifactId)}/file`} alt={image.label} loading="lazy" className="h-full w-full object-contain" onError={() => setUnavailable(previous => new Set(previous).add(image.artifactId))} />}</div>
      <div className="space-y-1 p-3"><p className="truncate text-sm font-medium">{image.label}</p><p className="text-xs text-muted">{image.width ?? '?'} × {image.height ?? '?'} · {new Date(image.createdAt).toLocaleDateString()}</p>
        {image.available && !unavailable.has(image.artifactId) && <a href={`/api/admin/artifacts/${encodeURIComponent(image.artifactId)}/file`} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-accent">查看完整图片</a>}</div>
    </article>)}</div>}
    {gallery.data?.truncated && <p className="text-xs text-muted">图片较多，仅显示最近 400 张；更早的图片仍保留在各自历史中。</p>}
  </section>;
}
