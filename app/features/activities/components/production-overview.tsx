'use client';
import { useQuery } from '@tanstack/react-query';
import { getJson } from '@/app/lib/api-client';
import type { ActivityReviewItem } from '@sthstart/contracts';

import React, { useState } from 'react';
import {
  CheckCircle2,
  CircleDot,
  AlertCircle,
  Sparkles,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Image,
  Film,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { useActivityProductionOverview } from '../queries';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Spinner } from '@/app/components/ui/spinner';
import type { ActivityProductionOverview as OverviewType } from '@sthstart/contracts';

interface ProductionOverviewProps {
  activityId: string;
  headVersion?:number;
  onReview?:()=>void;
  onAction?: (action: OverviewType['suggestedStep']) => void;
  onOpenBatchCandidates?: () => void;
  onNavigateTab?: (tab: 'settings' | 'records' | 'media' | 'playback') => void;
}

export function ProductionOverview({
  activityId,
  headVersion,
  onReview,
  onAction,
  onOpenBatchCandidates,
  onNavigateTab,
}: ProductionOverviewProps) {
  const {data:reviews}=useQuery({queryKey:['activity-review',activityId,headVersion],queryFn:()=>getJson<{items:ActivityReviewItem[]}>(`/api/admin/activities/${activityId}/review-items`)});
  const reviewCount=reviews?.items.filter(i=>i.decision==='pending'||i.decision==='rework').length||0;
  const [collapsed, setCollapsed] = useState(false);
  const { data: overview, isLoading, error } = useActivityProductionOverview(activityId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border-subtle bg-surface/60 px-4 py-2 text-xs text-muted">
        <Spinner className="h-3.5 w-3.5 animate-spin text-accent" />
        <span>同步生产流水线状态…</span>
      </div>
    );
  }

  if (error || !overview) {
    return null;
  }

  const handleNextStep = () => {
    if(reviewCount&&onReview){onReview();return;}
    if (overview.suggestedStep === 'generate_text') {
      onAction ? onAction('generate_text') : onNavigateTab?.('records');
    } else if (overview.suggestedStep === 'review_candidates') {
      onOpenBatchCandidates ? onOpenBatchCandidates() : onAction?.('review_candidates');
    } else if (overview.suggestedStep === 'generate_media' || overview.suggestedStep === 'pick_media') {
      onNavigateTab ? onNavigateTab('media') : onAction?.(overview.suggestedStep);
    } else if (overview.suggestedStep === 'update_playback') {
      onNavigateTab ? onNavigateTab('playback') : onAction?.('update_playback');
    } else if (overview.suggestedStep === 'preview_export') {
      onAction?.('preview_export');
    }
  };

  const stepMeta: Record<
    OverviewType['suggestedStep'],
    { label: string; actionText: string; icon: React.ComponentType<{ className?: string }> }
  > = {
    generate_text: { label: '未生成文本', actionText: '生成活动文本', icon: Sparkles },
    review_candidates: {
      label: `候选就绪 (${overview.unadoptedCandidates.length})`,
      actionText: `检视与批量采用 (${overview.unadoptedCandidates.length})`,
      icon: CheckCircle2,
    },
    generate_media: {
      label: `待生图 (${overview.mediaStatus.pendingSlots} 槽位)`,
      actionText: '批量生图工作台',
      icon: Image,
    },
    pick_media: { label: '待挑选图片', actionText: '挑选采用图片', icon: Image },
    update_playback: { label: '回放待更新', actionText: '更新回放编排', icon: Film },
    preview_export: { label: '准备就绪', actionText: '导出视频工程', icon: ArrowRight },
  };

  const currentMeta = stepMeta[overview.suggestedStep];
  const NextIcon = currentMeta.icon;

  return (
    <section aria-label="活动生产总览" className="rounded-xl border border-border-default bg-surface shadow-xs transition-all">
      {/* 顶栏：进度概览与主操作 */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">流水线概览</span>

          {/* 进度步进条 (Ribbon) */}
          <div className="flex items-center gap-1.5 text-xs">
            {/* 1. 企划 */}
            <div className="flex items-center gap-1 font-medium text-success-fg">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>企划</span>
            </div>

            <span className="text-muted/50">›</span>

            {/* 2. 文本 */}
            <div
              className={`flex items-center gap-1 ${
                overview.textStatus === 'adopted'
                  ? 'font-medium text-success-fg'
                  : overview.textStatus === 'candidates_ready'
                  ? 'font-medium text-accent'
                  : 'text-muted'
              }`}
            >
              {overview.textStatus === 'adopted' ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : overview.textStatus === 'candidates_ready' ? (
                <CircleDot className="h-3.5 w-3.5 text-accent animate-pulse" />
              ) : (
                <CircleDot className="h-3.5 w-3.5" />
              )}
              <span>
                文本
                {overview.textStatus === 'candidates_ready' && ` (${overview.unadoptedCandidates.length}待确认)`}
                {overview.textStatus === 'adopted' && ' 已采用'}
              </span>
            </div>

            <span className="text-muted/50">›</span>

            {/* 3. 图片 */}
            <div
              className={`flex items-center gap-1 ${
                overview.mediaStatus.totalSlots > 0 &&
                overview.mediaStatus.adoptedSlots >= overview.mediaStatus.totalSlots
                  ? 'font-medium text-success-fg'
                  : overview.mediaStatus.totalSlots > 0
                  ? 'font-medium text-accent'
                  : 'text-muted'
              }`}
            >
              {overview.mediaStatus.totalSlots > 0 &&
              overview.mediaStatus.adoptedSlots >= overview.mediaStatus.totalSlots ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <CircleDot className="h-3.5 w-3.5" />
              )}
              <span>
                图片
                {overview.mediaStatus.totalSlots > 0
                  ? ` (${overview.mediaStatus.adoptedSlots}/${overview.mediaStatus.totalSlots})`
                  : ''}
              </span>
            </div>

            <span className="text-muted/50">›</span>

            {/* 4. 回放 */}
            <div
              className={`flex items-center gap-1 ${
                overview.playbackStatus === 'ready'
                  ? 'font-medium text-success-fg'
                  : overview.playbackStatus === 'needs_update'
                  ? 'font-medium text-warning-fg'
                  : 'text-muted'
              }`}
            >
              {overview.playbackStatus === 'ready' ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <CircleDot className="h-3.5 w-3.5" />
              )}
              <span>
                回放
                {overview.playbackStatus === 'needs_update' && ' 待更新'}
              </span>
            </div>
          </div>
        </div>

        {/* 建议的下一步 Prominent Action */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleNextStep}
            className="flex h-8 items-center gap-1.5 bg-accent px-3.5 text-xs font-semibold text-white shadow-xs hover:bg-accent-dark active:scale-[0.98]"
          >
            <NextIcon className="h-3.5 w-3.5" />
            <span>{reviewCount&&onReview?`先复核 ${reviewCount} 项变化`:currentMeta.actionText}</span>
          </Button>

          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            className="rounded p-1 text-muted hover:bg-surface-hover hover:text-ink"
            aria-label={collapsed ? '展开阶段详情' : '收起阶段详情'}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* 展开的阶段卡片与预检提醒 */}
      {!collapsed && (
        <div className="border-t border-border-subtle/80 bg-surface-raised/40 px-4 py-3 space-y-3">
          {/* 阶段状态网格 */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {overview.stages.map((st) => (
              <div
                key={st.id}
                className="flex flex-col justify-between rounded-lg border border-border-subtle bg-surface p-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-semibold text-ink truncate">
                    #{st.order} {st.title}
                  </span>
                  {st.locked && (
                    <Badge variant="outline" className="border-amber-400 bg-amber-50 text-[10px] text-amber-700">
                      已锁定
                    </Badge>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-muted">
                  <span>
                    内容:{' '}
                    {st.hasMessages || st.hasPosts ? (
                      <span className="text-success-fg font-medium">已有记录</span>
                    ) : (
                      '无'
                    )}
                  </span>
                  <span>·</span>
                  <span>
                    图片: {st.adoptedImageSlotCount}/{st.imageSlotCount}
                  </span>
                  {st.unadoptedCandidateCount > 0 && (
                    <span className="rounded bg-accent/10 px-1 font-semibold text-accent">
                      {st.unadoptedCandidateCount} 候选待审
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 生图预检提醒 (Preflight) */}
          {(!overview.imagePreflight.ready ||
            (overview.imagePreflight.reason && overview.mediaStatus.totalSlots > 0)) && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/70 p-2.5 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-semibold">生图准备提示</div>
                <div className="text-amber-800 leading-relaxed">
                  {overview.imagePreflight.reason || '部分角色缺少服装描述或参考图，建议补齐以保持角色形象一致。'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
