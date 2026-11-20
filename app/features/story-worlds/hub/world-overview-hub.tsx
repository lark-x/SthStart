'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BookOpen,
  Compass,
  FileText,
  Layers,
  MapPin,
  Plus,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import type { WorldHub } from '@sthstart/contracts';
import { Badge } from '@/app/components/ui/badge';
import { Button, buttonVariants } from '@/app/components/ui/button';
import { cn } from '@/app/lib/cn';
import { CoverField } from '@/app/features/covers/components/cover-field';
import { EntityImage } from '@/app/components/ui/entity-art';
import { storyWorldKeys } from '../query-keys';
import {
  ARC_KIND_LABELS,
  WORK_NATURE_LABELS,
  buildStoryProjectHref,
  groupActorsByFaction,
  groupLocationsByRegion,
  parseOpenThreadsFromDocs,
  splitStoryLines,
} from './world-hub-shared';
import type { WorkbenchView } from '../hooks/use-workbench-url';

export interface WorldOverviewHubProps {
  hub: WorldHub;
  onNavigateView: (view: WorkbenchView) => void;
  onOpenCopilot?: () => void;
  onSelectLoreTarget?: (target: { tab: 'regions' | 'factions' | 'lore'; id?: string }) => void;
  onSelectChapterTarget?: (target: { arcId?: string; docId?: string; rightTab?: 'stage' | 'copilot' }) => void;
  onCreateArc: () => void;
}

export function WorldOverviewHub({
  hub,
  onNavigateView,
  onOpenCopilot,
  onSelectLoreTarget,
  onSelectChapterTarget,
  onCreateArc,
}: WorldOverviewHubProps) {
  const { world, activeBranch, definition, storyLines, linkedProjects, characterCards, scopePolicy, mcpSources } = hub;
  const primaryProject = linkedProjects[0] ?? null;
  const regions = useMemo(() => groupLocationsByRegion(definition), [definition]);
  const factions = useMemo(() => groupActorsByFaction(definition), [definition]);
  const openThreads = useMemo(
    () => parseOpenThreadsFromDocs(primaryProject?.worldDocs ?? []),
    [primaryProject],
  );
  const { canonChapters, customArcs } = useMemo(() => splitStoryLines(storyLines), [storyLines]);
  const avatarByCharId = useMemo(
    () => new Map(characterCards.map((card) => [card.id, card.avatarUrl])),
    [characterCards],
  );
  const actorById = useMemo(
    () => new Map((definition?.actors ?? []).map((actor) => [actor.id, actor])),
    [definition],
  );

  const worldSummary = definition?.summary || world.summary || '尚未补充作品导语。';
  const queryClient = useQueryClient();
  const refreshCover = () => {
    void queryClient.invalidateQueries({ queryKey: [...storyWorldKeys.all, 'hub', world.id] });
    void queryClient.invalidateQueries({ queryKey: storyWorldKeys.overview(world.id) });
    void queryClient.invalidateQueries({ queryKey: storyWorldKeys.list() });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-5">
        {/* 紧凑作品导语条：去掉重复大标题与整屏简介墙 */}
        <section className="rounded-[var(--radius-panel)] bg-surface p-4 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)] sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <CoverField
              className="world-hub-cover"
              entityType="story-world"
              entityId={world.id}
              title={world.title}
              tone="blue"
              coverArtifactId={world.coverArtifactId}
              onChanged={refreshCover}
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {world.workNature && (
                  <Badge variant="tone">{WORK_NATURE_LABELS[world.workNature]}</Badge>
                )}
                {world.parentWork && (
                  <Badge variant="outline">源自《{world.parentWork}》</Badge>
                )}
                <Badge variant="secondary">{definition?.timeLabel || world.timeLabel}</Badge>
                {(mcpSources?.length ?? 0) > 0 && (
                  <Badge variant="outline">已连 MCP {mcpSources!.length} 个</Badge>
                )}
              </div>
              <details className="group">
                <summary className="cursor-pointer list-none text-sm leading-relaxed text-muted">
                  <span className="line-clamp-2 group-open:hidden">{worldSummary}</span>
                  <span className="mt-1 inline-block text-xs font-medium text-accent group-open:hidden">
                    展开完整世界观导语
                  </span>
                </summary>
                <p className="mt-1 text-sm leading-relaxed text-ink">{worldSummary}</p>
              </details>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="primary" size="sm" onClick={() => onNavigateView('chapters')}>
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                浏览剧情章节
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (onOpenCopilot) {
                    onOpenCopilot();
                  } else {
                    onSelectChapterTarget?.({ rightTab: 'copilot' });
                    onNavigateView('chapters');
                  }
                }}
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                AI 续写创作
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1">
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              正史 {canonChapters.length} 章 · 分支线 {customArcs.length} 条
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {regions.length} 大地域 · {definition?.locations.length ?? 0} 处舞台
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {factions.length} 阵营 · {definition?.actors.length ?? 0} 位人物
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {definition?.lockedFacts.length ?? 0} 条法则 · {openThreads.length} 条伏笔
            </span>
          </div>
        </section>

        {/* 主体双列：左 7 列按序正史章节 + 分支创作；右 5 列地域与人物速览 */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-7">
            {/* 按顺序显示主线章节梗概（不含对话，点开可读细节或走 MCP） */}
            <section className="space-y-3 rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)]">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-ink">正史剧情章节序</h2>
                  <p className="text-xs text-muted">按作品版本与时间顺序展示剧情梗概；需要具体对白或原文细节时可按需调用 MCP 检索。</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => onNavigateView('chapters')}>
                  全部章节
                </Button>
              </div>

              {canonChapters.length === 0 ? (
                <div className="rounded-[var(--radius-control)] bg-surface-sunken/70 p-4 text-xs text-muted">
                  当前作品暂未导入按顺序排列的正史章节条目，可先查看下方分支与创作线。
                </div>
              ) : (
                <div className="space-y-2.5">
                  {canonChapters.slice(0, 6).map((chap, idx) => (
                    <button
                      key={chap.id}
                      type="button"
                      onClick={() => {
                        onSelectChapterTarget?.({ arcId: chap.id });
                        onNavigateView('chapters');
                      }}
                      className="flex w-full items-start justify-between gap-3 rounded-[var(--radius-control)] bg-surface-raised p-3.5 text-left shadow-[0_0_0_1px_var(--hairline)] transition-colors hover:bg-surface-hover"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{chap.chapterCode || `第 ${idx + 1} 节`}</Badge>
                          <span className="text-sm font-semibold text-ink">{chap.title}</span>
                        </div>
                        <p className="line-clamp-2 text-xs leading-relaxed text-muted">{chap.description}</p>
                      </div>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                    </button>
                  ))}
                  {canonChapters.length > 6 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full"
                      onClick={() => onNavigateView('chapters')}
                    >
                      查看完整 {canonChapters.length} 章节脉络
                    </Button>
                  )}
                </div>
              )}
            </section>

            {/* 分支线与绑定手稿 */}
            <section className="space-y-3 rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)]">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-ink">衍生 / 分支篇章与手稿</h2>
                  <p className="text-xs text-muted">圈定局部核心阵容展开共创，与正史章节相互参照。</p>
                </div>
                <Button size="sm" variant="ghost" onClick={onCreateArc}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  新建篇章
                </Button>
              </div>

              {customArcs.length > 0 && (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {customArcs.map((line) => (
                    <button
                      key={line.id}
                      type="button"
                      onClick={() => {
                        onSelectChapterTarget?.({ arcId: line.id });
                        onNavigateView('chapters');
                      }}
                      className="flex flex-col justify-between rounded-[var(--radius-control)] bg-surface-raised p-3.5 text-left shadow-[0_0_0_1px_var(--hairline)] transition-colors hover:bg-surface-hover"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {line.arcKind && <Badge variant="tone">{ARC_KIND_LABELS[line.arcKind]}</Badge>}
                          <span className="text-xs text-muted">{line.actorIds.length} 人</span>
                        </div>
                        <p className="text-sm font-semibold text-ink">{line.title}</p>
                        <p className="line-clamp-2 text-xs text-muted">{line.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {primaryProject && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] bg-surface-sunken/60 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <span className="text-xs text-muted">关联写作项目：</span>
                    <span className="text-xs font-semibold text-ink">{primaryProject.project.title}</span>
                    <span className="ml-2 text-xs text-muted">
                      ({primaryProject.chapters.length} 篇手稿)
                    </span>
                  </div>
                  <Link
                    href={buildStoryProjectHref({
                      projectId: primaryProject.project.id,
                      worldId: world.id,
                      branchId: activeBranch?.id ?? null,
                    })}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    去正文编辑器
                  </Link>
                </div>
              )}
            </section>
          </div>

          {/* 右 5 列：地域、人物、伏笔与文风 */}
          <div className="space-y-5 lg:col-span-5">
            <section className="space-y-3 rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)]">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-base font-semibold text-ink">
                  <Compass className="h-4 w-4 text-tone-fg" aria-hidden="true" />
                  地域与舞台
                </h2>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onSelectLoreTarget?.({ tab: 'regions' });
                    onNavigateView('lore');
                  }}
                >
                  全部查看
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {regions.map((region) => (
                  <button
                    key={region.id}
                    type="button"
                    onClick={() => {
                      onSelectLoreTarget?.({ tab: 'regions', id: region.id });
                      onNavigateView('lore');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-surface-raised px-3 py-1.5 text-xs shadow-[0_0_0_1px_var(--hairline)] transition-colors hover:bg-surface-hover"
                  >
                    <span className="font-medium text-ink">{region.name}</span>
                    <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-xs text-muted">
                      {region.locations.length}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-3 rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)]">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-base font-semibold text-ink">
                  <Users className="h-4 w-4 text-tone-fg" aria-hidden="true" />
                  阵营与人物
                </h2>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onSelectLoreTarget?.({ tab: 'factions' });
                    onNavigateView('lore');
                  }}
                >
                  人设与声纹
                </Button>
              </div>
              <div className="space-y-3">
                {factions.map((faction) => (
                  <div key={faction.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-ink">{faction.name}</span>
                      {faction.alignment && <span className="text-muted">{faction.alignment}</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {faction.actors.map((actor) => {
                        const avatar = actor.characterId ? avatarByCharId.get(actor.characterId) : null;
                        return (
                          <button
                            key={actor.id}
                            type="button"
                            onClick={() => {
                              onSelectLoreTarget?.({ tab: 'factions', id: actor.id });
                              onNavigateView('lore');
                            }}
                            className="inline-flex items-center gap-1.5 rounded-full bg-surface-raised py-1 pl-1.5 pr-2.5 text-xs text-ink shadow-[0_0_0_1px_var(--hairline)] transition-colors hover:bg-surface-hover"
                          >
                            <span className="world-actor-chip-avatar" aria-hidden="true">
                              <EntityImage seed={actor.id} title={actor.name} tone="violet" ratio="avatar" src={avatar ?? null} alt="" />
                            </span>
                            <span>{actor.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3 rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)]">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-ink">开放伏笔与文风约束</h2>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onSelectLoreTarget?.({ tab: 'lore' });
                    onNavigateView('lore');
                  }}
                >
                  展开全部
                </Button>
              </div>
              {openThreads.slice(0, 3).map((thread) => (
                <div key={thread.id} className="rounded-[var(--radius-control)] bg-surface-sunken/60 p-3 text-xs">
                  <p className="font-medium text-ink">{thread.title}</p>
                  {thread.triggers.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {thread.triggers.map((t) => (
                        <Badge key={t} variant="outline">{t}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {scopePolicy?.styleGuide?.tone && (
                <p className={cn('text-xs leading-relaxed text-muted', openThreads.length > 0 && 'border-t border-hairline pt-2')}>
                  文风基调：{scopePolicy.styleGuide.tone}
                </p>
              )}
              {actorById.size === 0 && <p className="text-xs text-muted">暂无规则记录。</p>}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
