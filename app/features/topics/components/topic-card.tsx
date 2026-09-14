'use client';

import React from 'react';
import { Ban, BookmarkCheck, BookmarkPlus, Eye } from 'lucide-react';
import type { Topic } from '@sthstart/contracts';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { TOPIC_KIND_LABELS, TOPIC_NATURE_LABELS } from '../api';

/** 发布时间未知时明确写出来，不把旧内容标成刚发生。 */
export function formatTopicTime(iso?: string | null): string {
  if (!iso) return '未知';
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '未知';
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

export function publishedLabel(iso?: string | null): string {
  return iso ? formatTopicTime(iso) : '发布时间未知';
}

/**
 * 素材卡片：素材库与「从话题素材找灵感」侧栏共用同一呈现，
 * 列表只展示摘要，完整原文放在详情里。
 */
export function TopicSummaryCard({ topic, selected, onToggle, onToggleFavorite, onToggleIgnore, onOpenDetail, showActions = true }: {
  topic: Topic;
  selected?: boolean;
  onToggle?: (topic: Topic) => void;
  onToggleFavorite?: (topic: Topic) => void;
  onToggleIgnore?: (topic: Topic) => void;
  onOpenDetail?: (topic: Topic) => void;
  showActions?: boolean;
}) {
  return (
    <li className={'space-y-2 rounded-[var(--radius-panel)] border p-3 ' + (selected ? 'border-accent bg-accent/5' : 'border-border-subtle')}>
      <div className="flex items-start gap-3">
        {onToggle && (
          <input
            type="checkbox"
            className="mt-1"
            aria-label={'选择素材 ' + topic.title}
            checked={Boolean(selected)}
            onChange={() => onToggle(topic)}
          />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <strong className="text-sm font-semibold text-ink">{topic.title}</strong>
            {topic.works.map((work) => <span key={work} className="text-xs text-muted">《{work}》</span>)}
            <Badge variant="outline" className="text-xs">{TOPIC_KIND_LABELS[topic.kind]}</Badge>
            <Badge variant="secondary" className="text-xs">{TOPIC_NATURE_LABELS[topic.infoNature]}</Badge>
            {topic.favorite && <Badge variant="accent" className="text-xs">已收藏</Badge>}
            {topic.usedActivityId && <Badge variant="online" className="text-xs">已使用</Badge>}
            {topic.ignored && <Badge variant="stopped" className="text-xs">已忽略</Badge>}
          </div>
          <p className="text-sm text-muted">{topic.summary}</p>
          {!!topic.characters.length && <p className="text-xs text-muted">涉及角色：{topic.characters.join('、')}</p>}
          {!!topic.adaptationTags.length && (
            <div className="flex flex-wrap gap-1.5">
              {topic.adaptationTags.map((tag) => <span key={tag} className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent-dark">{tag}</span>)}
            </div>
          )}
          {/* 发布时间只表示来源里能确认到的时间；确认不了就写“未知”，不拿收集时间冒充。 */}
          <p className="text-xs text-muted">
            发布时间：{publishedLabel(topic.latestPublishedAt ?? null)} · 来源 {topic.sourceCount} 个 · 收集于 {formatTopicTime(topic.firstSeenAt)}
          </p>
        </div>
      </div>
      {showActions && (
        <div className="flex flex-wrap gap-2">
          {onOpenDetail && <Button size="sm" variant="ghost" onClick={() => onOpenDetail(topic)}><Eye className="h-3.5 w-3.5" />查看详情</Button>}
          {onToggleFavorite && (
            <Button size="sm" variant="ghost" onClick={() => onToggleFavorite(topic)}>
              {topic.favorite ? <><BookmarkCheck className="h-3.5 w-3.5" />取消收藏</> : <><BookmarkPlus className="h-3.5 w-3.5" />收藏</>}
            </Button>
          )}
          {onToggleIgnore && (
            topic.ignored
              ? <Button size="sm" variant="ghost" onClick={() => onToggleIgnore(topic)}><Eye className="h-3.5 w-3.5" />恢复</Button>
              : <Button size="sm" variant="ghost" onClick={() => onToggleIgnore(topic)}><Ban className="h-3.5 w-3.5" />忽略</Button>
          )}
        </div>
      )}
    </li>
  );
}
