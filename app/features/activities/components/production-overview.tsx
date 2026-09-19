'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { getJson } from '@/app/lib/api-client';
import type { ActivityReviewItem, ContentDocument, ActivityProductionOverview as OverviewType } from '@sthstart/contracts';
import { useActivityProductionOverview } from '../queries';
import { Button } from '@/app/components/ui/button';
import { activityNextStep, imageSetupMessage } from '@/app/lib/activity-guidance';

/**
 * 步骤文案与工作室的页级 tab 同名同序。
 *
 * 之前这里硬编码「1 确认设定 / 2 写活动内容 / 3 配图 / 4 预览与导出」，
 * 与实际的 tab（记录 / 设定 / 素材 / 回放）对不上，用户第一屏就自相矛盾。
 * 改成一份定义后，两处不会各自漂移。
 */
export const WORKFLOW_STEPS = ['内容', '素材', '回放', '导出'] as const;

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
    <section aria-label="接下来做什么" className="rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold text-accent">下一步</p>
          <h2 className="text-base font-semibold text-ink">{next.title}</h2>
          <p className="text-sm text-muted">{next.description}</p>
        </div>
        <Button variant="primary" onClick={act}>{next.button}</Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        {WORKFLOW_STEPS.map((label, index) => <span key={label}>{index + 1} {label}</span>)}
        {reviewCount > 0 && <Button size="sm" variant="outline" onClick={onReview}>查看 {reviewCount} 项内容变化</Button>}
      </div>
      {overview && ['generate_media', 'pick_media'].includes(next.action) && !overview.imagePreflight.ready && (
        <div className="mt-3 border-t border-border-subtle pt-3 text-sm text-muted">
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
