'use client';

import React, { useEffect } from 'react';
import Image from 'next/image';
import { Drawer } from '@/app/components/ui/drawer';
import { PageTabs } from '@/app/components/ui/page-tabs';
import type { Activity, ContentDocument } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { ActivityCreationProfile } from '../creation-profile-picker';

export type StudioSettingsTab = 'basics' | 'actors' | 'stages';

interface StudioSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  activity: Activity;
  document: ContentDocument;
  onUpdateDocument: (doc: ContentDocument) => void;
  tab: StudioSettingsTab;
  onTabChange: (tab: StudioSettingsTab) => void;
  /** 复核面板「修改本场源头」链接定位的元素 id（actor-… / stage-…）。 */
  focusId?: string | null;
  /** 草稿处于冲突或保存失败时禁止套用创作配置。 */
  profileDisabled?: boolean;
  /** 套用创作配置前把草稿保存为正式版本。 */
  beforeApplyProfile?: () => Promise<boolean>;
  onProfileApplied: () => void;
}

export function StudioSettingsDrawer({
  open,
  onClose,
  activity: activityRecord,
  document,
  onUpdateDocument,
  tab,
  onTabChange: setTab,
  focusId,
  profileDisabled,
  beforeApplyProfile,
  onProfileApplied,
}: StudioSettingsDrawerProps) {
  useEffect(() => {
    if (!open || !focusId) return;
    const frame = requestAnimationFrame(() => {
      window.document.getElementById(focusId)?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, focusId, tab]);

  if (!open) return null;

  const activity = document.activity;
  const actors = document.actors || [];
  const stages = document.stages || [];

  return (
    <Drawer open={open} onOpenChange={next => { if (!next) onClose(); }} title="活动全局设置"
      description="修改会自动保存到活动草稿。" className="p-4"
      footer={<Button size="sm" onClick={onClose}>完成</Button>}>
        <PageTabs ariaLabel="活动设置分类" value={tab} onChange={id => setTab(id as typeof tab)} tabs={[
          { id: 'basics', label: '基本资料' },
          { id: 'actors', label: '登场演员', count: actors.length },
          { id: 'stages', label: '幕次目标', count: stages.length },
        ]} />
        {/* 滚动表单区 */}
        <div className="space-y-4 py-4">
          {tab === 'basics' && (
            <div className="space-y-3.5 text-sm">
              <div>
                <label className="block font-semibold text-ink mb-1">活动标题</label>
                <Input
                  aria-label="活动标题"
                  value={activity.title || ''}
                  onChange={(e) =>
                    onUpdateDocument({
                      ...document,
                      activity: { ...activity, title: e.target.value },
                    })
                  }
                  className="h-11 sm:h-9 text-base sm:text-sm"
                />
              </div>

              <div>
                <label className="block font-semibold text-ink mb-1">主题 / 衍生作品</label>
                <Input
                  aria-label="主题 / 衍生作品"
                  value={activity.theme || ''}
                  onChange={(e) =>
                    onUpdateDocument({
                      ...document,
                      activity: { ...activity, theme: e.target.value },
                    })
                  }
                  className="h-11 sm:h-9 text-base sm:text-sm"
                />
              </div>

              <div>
                <label className="block font-semibold text-ink mb-1">主要活动地点</label>
                <Input
                  aria-label="主要活动地点"
                  value={activity.location || ''}
                  onChange={(e) =>
                    onUpdateDocument({
                      ...document,
                      activity: { ...activity, location: e.target.value },
                    })
                  }
                  className="h-11 sm:h-9 text-base sm:text-sm"
                />
              </div>

              <div>
                <label className="block font-semibold text-ink mb-1">活动规则与创作设定</label>
                <Textarea
                  rows={4}
                  aria-label="活动规则与创作设定"
                  value={activity.rules || ''}
                  onChange={(e) =>
                    onUpdateDocument({
                      ...document,
                      activity: { ...activity, rules: e.target.value },
                    })
                  }
                  className="text-base sm:text-sm"
                />
              </div>

              {/* 高级选项：把创作配置套用到本场活动（先预览参数差异，再确认冻结） */}
              <details className="rounded-control border border-border-subtle bg-surface-sunken px-3 py-2">
                <summary className="cursor-pointer py-1 font-semibold text-ink">高级选项：创作偏好与模板（可选）</summary>
                <ActivityCreationProfile
                  activityId={activityRecord.id}
                  headVersion={activityRecord.headVersion}
                  value={activity.creationProfile}
                  disabled={profileDisabled}
                  beforeApply={beforeApplyProfile}
                  onApplied={onProfileApplied}
                />
              </details>
            </div>
          )}

          {tab === 'actors' && (
            <div className="space-y-3">
              {actors.map((actor) => (
                <div key={actor.id} id={`actor-${actor.id}`} className={`space-y-2 border-b border-border-subtle py-3 last:border-b-0 ${focusId === `actor-${actor.id}` ? 'rounded-control bg-accent-soft px-2' : ''}`}>
                  <div className="flex items-center gap-2">
                    <div className="relative h-7 w-7 rounded-full overflow-hidden bg-surface-muted border border-border-default shrink-0">
                      {actor.avatarUrl ? (
                        <Image
                          src={actor.avatarUrl}
                          alt={actor.displayName}
                          fill
                          unoptimized
                          className="object-cover"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center font-bold text-muted">
                          {actor.displayName.slice(0, 1)}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="font-bold text-ink">{actor.displayName}</span>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm text-muted">本场职责 / 身份</label>
                    <Input
                      aria-label="本场职责 / 身份"
                  value={actor.activityRole || ''}
                      onChange={(e) => {
                        const next = actors.map((a) =>
                          a.id === actor.id ? { ...a, activityRole: e.target.value } : a
                        );
                        onUpdateDocument({ ...document, actors: next });
                      }}
                      className="h-11 sm:h-9 text-base sm:text-sm"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm text-muted">服装与外貌装扮</label>
                    <Input
                      aria-label="服装与外貌装扮"
                  value={actor.outfitDescription || ''}
                      onChange={(e) => {
                        const next = actors.map((a) =>
                          a.id === actor.id ? { ...a, outfitDescription: e.target.value } : a
                        );
                        onUpdateDocument({ ...document, actors: next });
                      }}
                      className="h-11 sm:h-9 text-base sm:text-sm"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'stages' && (
            <div className="space-y-3">
              {stages.map((stage, idx) => (
                <div key={stage.id} id={`stage-${stage.id}`} className={`space-y-2 border-b border-border-subtle py-3 last:border-b-0 ${focusId === `stage-${stage.id}` ? 'rounded-control bg-accent-soft px-2' : ''}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-muted">第 {idx + 1} 幕</span>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm text-muted">幕次标题</label>
                    <Input
                      aria-label="幕次标题"
                  value={stage.title}
                      onChange={(e) => {
                        const next = stages.map((s) =>
                          s.id === stage.id ? { ...s, title: e.target.value } : s
                        );
                        onUpdateDocument({ ...document, stages: next });
                      }}
                      className="h-11 sm:h-9 text-base sm:text-sm"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm text-muted">本幕目标与核心事件</label>
                    <Textarea
                      rows={2}
                      aria-label="本幕目标与核心事件"
                  value={stage.instruction || ''}
                      onChange={(e) => {
                        const next = stages.map((s) =>
                          s.id === stage.id ? { ...s, instruction: e.target.value } : s
                        );
                        onUpdateDocument({ ...document, stages: next });
                      }}
                      className="text-base sm:text-sm"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

    </Drawer>
  );
}
