'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import {
  Calendar,
  Compass,
  Layers,
  MapPin,
  Settings,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import type { ActorSnapshot, ContentDocument, StageDefinition } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';

interface StudioSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  document: ContentDocument;
  onUpdateDocument: (doc: ContentDocument) => void;
}

export function StudioSettingsDrawer({
  open,
  onClose,
  document,
  onUpdateDocument,
}: StudioSettingsDrawerProps) {
  const [tab, setTab] = useState<'basics' | 'actors' | 'stages'>('basics');

  if (!open) return null;

  const activity = document.activity;
  const actors = document.actors || [];
  const stages = document.stages || [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in">
      <div className="w-full max-w-md bg-surface h-full flex flex-col border-l border-border-default shadow-xl animate-in slide-in-from-right duration-200">
        {/* 抽屉顶栏 */}
        <div className="h-12 px-4 border-b border-border-default flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-bold text-ink">活动全局设置</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-surface-muted transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 内部 Tab 切换 */}
        <div className="flex border-b border-border-default px-4 bg-surface-muted/30">
          <button
            type="button"
            onClick={() => setTab('basics')}
            className={`py-2 px-3 text-xs font-semibold border-b-2 cursor-pointer transition-colors ${
              tab === 'basics'
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            基本资料
          </button>
          <button
            type="button"
            onClick={() => setTab('actors')}
            className={`py-2 px-3 text-xs font-semibold border-b-2 cursor-pointer transition-colors ${
              tab === 'actors'
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            登场演员 ({actors.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('stages')}
            className={`py-2 px-3 text-xs font-semibold border-b-2 cursor-pointer transition-colors ${
              tab === 'stages'
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            幕次目标 ({stages.length})
          </button>
        </div>

        {/* 滚动表单区 */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {tab === 'basics' && (
            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-ink mb-1">活动标题</label>
                <Input
                  value={activity.title || ''}
                  onChange={(e) =>
                    onUpdateDocument({
                      ...document,
                      activity: { ...activity, title: e.target.value },
                    })
                  }
                  className="h-8 text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-ink mb-1">主题 / 衍生作品</label>
                <Input
                  value={activity.theme || ''}
                  onChange={(e) =>
                    onUpdateDocument({
                      ...document,
                      activity: { ...activity, theme: e.target.value },
                    })
                  }
                  className="h-8 text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-ink mb-1">主要活动地点</label>
                <Input
                  value={activity.location || ''}
                  onChange={(e) =>
                    onUpdateDocument({
                      ...document,
                      activity: { ...activity, location: e.target.value },
                    })
                  }
                  className="h-8 text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-ink mb-1">活动规则与创作设定</label>
                <Textarea
                  rows={4}
                  value={activity.rules || ''}
                  onChange={(e) =>
                    onUpdateDocument({
                      ...document,
                      activity: { ...activity, rules: e.target.value },
                    })
                  }
                  className="text-xs"
                />
              </div>
            </div>
          )}

          {tab === 'actors' && (
            <div className="space-y-3">
              {actors.map((actor) => (
                <div
                  key={actor.id}
                  className="rounded-xl border border-border-default bg-surface-raised p-3 space-y-2 text-xs"
                >
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
                    <label className="block text-[11px] text-muted mb-0.5">本场职责 / 身份</label>
                    <Input
                      value={actor.activityRole || ''}
                      onChange={(e) => {
                        const next = actors.map((a) =>
                          a.id === actor.id ? { ...a, activityRole: e.target.value } : a
                        );
                        onUpdateDocument({ ...document, actors: next });
                      }}
                      className="h-7 text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-muted mb-0.5">服装与外貌装扮</label>
                    <Input
                      value={actor.outfitDescription || ''}
                      onChange={(e) => {
                        const next = actors.map((a) =>
                          a.id === actor.id ? { ...a, outfitDescription: e.target.value } : a
                        );
                        onUpdateDocument({ ...document, actors: next });
                      }}
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'stages' && (
            <div className="space-y-3">
              {stages.map((stage, idx) => (
                <div
                  key={stage.id}
                  className="rounded-xl border border-border-default bg-surface-raised p-3 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-accent font-mono">第 {idx + 1} 幕</span>
                  </div>

                  <div>
                    <label className="block text-[11px] text-muted mb-0.5">幕次标题</label>
                    <Input
                      value={stage.title}
                      onChange={(e) => {
                        const next = stages.map((s) =>
                          s.id === stage.id ? { ...s, title: e.target.value } : s
                        );
                        onUpdateDocument({ ...document, stages: next });
                      }}
                      className="h-7 text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-muted mb-0.5">本幕目标与核心事件</label>
                    <Textarea
                      rows={2}
                      value={stage.instruction || ''}
                      onChange={(e) => {
                        const next = stages.map((s) =>
                          s.id === stage.id ? { ...s, instruction: e.target.value } : s
                        );
                        onUpdateDocument({ ...document, stages: next });
                      }}
                      className="text-xs"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 抽屉底部 */}
        <div className="p-3 border-t border-border-default bg-surface flex justify-end">
          <Button size="sm" onClick={onClose} className="text-xs">
            完成
          </Button>
        </div>
      </div>
    </div>
  );
}
