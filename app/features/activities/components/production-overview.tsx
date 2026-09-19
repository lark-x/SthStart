'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { getJson } from '@/app/lib/api-client';
import type { ActivityReviewItem, ContentDocument, ActivityProductionOverview as OverviewType } from '@sthstart/contracts';
import { useActivityProductionOverview } from '../queries';
import { Button } from '@/app/components/ui/button';
import { activityNextStep, imageSetupMessage } from '@/app/lib/activity-guidance';

interface ProductionOverviewProps {
  activityId: string;
  document: ContentDocument;
  headVersion?: number;
  onReview?: () => void;
  onAction?: (action: OverviewType['suggestedStep']) => void;
  onOpenBatchCandidates?: () => void;
  /** 第二个参数是内容 tab 内的视图提示（设定/群聊/朋友圈/事件）。 */
  onNavigateTab?: (tab: 'content' | 'media' | 'playback' | 'export', view?: 'settings' | 'chat' | 'moments' | 'facts') => void;
}

export function ProductionOverview({ activityId, document, headVersion, onReview, onAction, onOpenBatchCandidates, onNavigateTab }: ProductionOverviewProps) {
  /*
   * 这里曾经额外渲染一行「1 内容 2 素材 3 回放 4 导出」。
   * 它和紧邻下方的页级标签栏表达同一件事，第一屏出现两排重复的步骤提示；
   * 步骤顺序现在只由标签栏承载，这一行已删除。
   */
  const { data: reviews } = useQuery({
    queryKey: ['activity-review', activityId, headVersion],
    queryFn: () => getJson<{ items: ActivityReviewItem[] }>(`/api/admin/activities/${activityId}/review-items`),
  });
  const { data: overview, error, refetch } = useActivityProductionOverview(activityId);
  const reviewCount = reviews?.items.filter(item => item.decision === 'pending' || item.decision === 'rework').length ?? 0;
  const next = activityNextStep(document, overview);
  const act = () => {
    // 设定并入内容 tab：连视图提示一起给出去，直接落到设定视图。
    if (next.action === 'settings') onNavigateTab?.('content', 'settings');
    else if (next.action === 'review_candidates') onOpenBatchCandidates?.();
    else if (next.action === 'generate_media' || next.action === 'pick_media') onNavigateTab?.('media');
    else if (next.action === 'update_playback') onNavigateTab?.('playback');
    else onAction?.(next.action);
  };

  return (
    /*
     * 紧凑单行条：标题、说明与主动作同行。之前用大卡片承载一句提示，
     * 在页头与标签栏之间又插了一整块，页面显得层数过多。
     */
    <section aria-label="接下来做什么" className="rounded-[var(--radius-panel)] border border-border-default bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-xs font-semibold text-accent shrink-0">下一步</p>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink">{next.title}</h2>
          <p className="text-sm text-muted">{next.description}</p>
        </div>
        {reviewCount > 0 && <Button size="sm" variant="outline" onClick={onReview}>查看 {reviewCount} 项内容变化</Button>}
        <Button variant="primary" onClick={act}>{next.button}</Button>
      </div>
      {overview && ['generate_media', 'pick_media'].includes(next.action) && !overview.imagePreflight.ready && (
        <div className="mt-2 border-t border-border-subtle pt-2 text-sm text-muted">
          <p>{imageSetupMessage(overview.imagePreflight.reason)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Link href="/settings/generation" className="font-medium text-accent underline">配置图片生成</Link>
            <Button size="sm" variant="ghost" onClick={() => onNavigateTab?.('playback')}>暂不配图，预览文字</Button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-muted">暂时无法读取生成进度，你仍可编辑内容。<button type="button" className="ml-2 text-accent underline" onClick={() => void refetch()}>重试</button></p>}
    </section>
  );
}
