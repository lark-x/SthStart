'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Compass,
  ExternalLink,
  MapPin,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import type { WorldHub } from '@sthstart/contracts';
import { Badge } from '@/app/components/ui/badge';
import { buttonVariants } from '@/app/components/ui/button';
import { cn } from '@/app/lib/cn';
import {
  ORIGIN_TYPE_LABELS,
  buildAiStudioHref,
  groupActorsByFaction,
  groupLocationsByRegion,
  parseOpenThreadsFromDocs,
} from './world-hub-shared';
import { SOURCE_NATURE_META, sourceNatureTone } from '../hooks/world-format';

export interface WorldCodexViewProps {
  hub: WorldHub;
  initialTarget?: { tab: 'regions' | 'factions' | 'lore'; id?: string } | null;
}

export function WorldCodexView({ hub, initialTarget }: WorldCodexViewProps) {
  const { world, activeBranch, definition, linkedProjects, characterCards, scopePolicy } = hub;
  const primaryProject = linkedProjects[0] ?? null;

  const regions = useMemo(() => groupLocationsByRegion(definition), [definition]);
  const factions = useMemo(() => groupActorsByFaction(definition), [definition]);
  const openThreads = useMemo(
    () => parseOpenThreadsFromDocs(primaryProject?.worldDocs ?? []),
    [primaryProject],
  );
  const cardByCharId = useMemo(
    () => new Map(characterCards.map((card) => [card.id, card])),
    [characterCards],
  );

  const [tab, setTab] = useState<'regions' | 'factions' | 'lore'>(
    () => initialTarget?.tab ?? 'regions',
  );
  const [selectedRegionId, setSelectedRegionId] = useState<string>(
    () => (initialTarget?.tab === 'regions' && initialTarget.id) ? initialTarget.id : (regions[0]?.id ?? ''),
  );
  const [selectedLocationId, setSelectedLocationId] = useState<string>(
    () => definition?.locations[0]?.id ?? '',
  );
  const [selectedFactionId, setSelectedFactionId] = useState<string>('all');
  const [selectedActorId, setSelectedActorId] = useState<string>(
    () => (initialTarget?.tab === 'factions' && initialTarget.id) ? initialTarget.id : (definition?.actors[0]?.id ?? ''),
  );

  useEffect(() => {
    if (!initialTarget) return;
    setTab(initialTarget.tab);
    if (initialTarget.tab === 'regions' && initialTarget.id) {
      setSelectedRegionId(initialTarget.id);
      const reg = regions.find((r) => r.id === initialTarget.id);
      if (reg?.locations[0]) setSelectedLocationId(reg.locations[0].id);
    }
    if (initialTarget.tab === 'factions' && initialTarget.id) {
      setSelectedActorId(initialTarget.id);
    }
  }, [initialTarget, regions]);

  const activeRegion = regions.find((r) => r.id === selectedRegionId) ?? regions[0] ?? null;
  const visibleLocations = activeRegion?.locations ?? definition?.locations ?? [];
  const activeLocation = visibleLocations.find((l) => l.id === selectedLocationId)
    ?? visibleLocations[0]
    ?? null;

  const locationVisualRef = useMemo(() => {
    if (!activeLocation || !definition?.visualReferences) return null;
    return definition.visualReferences.find(
      (ref) => ref.locationId === activeLocation.id || ref.id === activeLocation.id,
    ) ?? null;
  }, [activeLocation, definition]);

  const stationedActors = useMemo(() => {
    if (!activeLocation || !definition) return [];
    return definition.actors.filter((actor) => actor.locationId === activeLocation.id);
  }, [activeLocation, definition]);

  const visibleFactions = selectedFactionId === 'all'
    ? factions
    : factions.filter((f) => f.id === selectedFactionId);
  const activeActor = (definition?.actors ?? []).find((a) => a.id === selectedActorId)
    ?? definition?.actors[0]
    ?? null;
  const activeCharCard = activeActor?.characterId ? cardByCharId.get(activeActor.characterId) : null;
  const activeVoice = activeActor ? scopePolicy?.characterVoices?.[activeActor.id] : undefined;

  const aiStudioHref = buildAiStudioHref({
    workName: world.title,
    worldId: world.id,
    branchId: activeBranch?.id ?? null,
    projectId: primaryProject?.project.id ?? null,
  });

  // 方案 A 统一卡片/侧栏选中态：洁白抬升卡片 + 微强发丝边框（无刺眼亮色/左侧条）
  const cardClass = (selected: boolean) =>
    cn(
      'transition-all text-left rounded-[var(--radius-panel)]',
      selected
        ? 'bg-surface-raised shadow-[var(--elev-sm),0_0_0_1px_var(--border-default)]'
        : 'bg-surface shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)] hover:bg-surface-hover',
    );

  const sideRowClass = (selected: boolean) =>
    cn(
      'flex shrink-0 items-center justify-between gap-2 rounded-[var(--radius-control)] px-3 py-2 text-left text-xs transition-colors',
      selected
        ? 'bg-surface-raised font-semibold text-ink shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)]'
        : 'text-muted hover:bg-surface-hover hover:text-ink',
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-app">
      {/* 设定集纯中文分段条 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-hairline bg-surface px-4 py-2 sm:px-6">
        <div className="inline-flex rounded-[var(--radius-control)] bg-surface-sunken p-0.5">
          {[
            { id: 'regions' as const, label: '地域与舞台', icon: Compass, count: regions.length },
            { id: 'factions' as const, label: '阵营与人物', icon: Users, count: definition?.actors.length ?? 0 },
            { id: 'lore' as const, label: '规则 · 伏笔 · 文风', icon: ShieldCheck, count: openThreads.length },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors',
                  tab === item.id ? 'bg-surface-raised text-ink shadow-xs' : 'text-muted hover:text-ink',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{item.label}</span>
                <span className="text-[11px] opacity-70">{item.count}</span>
              </button>
            );
          })}
        </div>

        <Link href={aiStudioHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          调整文风与声纹
        </Link>
      </div>

      {/* 1. 地域与舞台分层视图 */}
      {tab === 'regions' && (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[240px_minmax(0,1fr)_360px]">
          <aside className="min-h-0 overflow-y-auto border-b border-hairline bg-surface/60 p-3 lg:border-b-0 lg:border-r">
            <p className="mb-2 px-2 text-xs font-semibold text-muted">国度 / 星球 / 区域</p>
            <div className="flex flex-row gap-1 overflow-x-auto lg:flex-col">
              {regions.map((reg) => (
                <button
                  key={reg.id}
                  type="button"
                  onClick={() => {
                    setSelectedRegionId(reg.id);
                    if (reg.locations[0]) setSelectedLocationId(reg.locations[0].id);
                  }}
                  className={sideRowClass(activeRegion?.id === reg.id)}
                >
                  <span className="truncate">{reg.name}</span>
                  <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-[11px]">{reg.locations.length}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
            {activeRegion && (
              <div className="mb-4 space-y-1">
                <h2 className="text-base font-semibold text-ink">{activeRegion.name}</h2>
                {activeRegion.description && (
                  <p className="text-xs leading-relaxed text-muted">{activeRegion.description}</p>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {visibleLocations.map((loc) => {
                const residentCount = (definition?.actors ?? []).filter((a) => a.locationId === loc.id).length;
                return (
                  <button
                    key={loc.id}
                    type="button"
                    onClick={() => setSelectedLocationId(loc.id)}
                    className={cn(cardClass(activeLocation?.id === loc.id), 'flex flex-col justify-between p-4')}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-ink">{loc.name}</h3>
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                      </div>
                      <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted">{loc.description}</p>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-hairline pt-2 text-[11px] text-muted">
                      <span>常驻人物 {residentCount} 位</span>
                      <span>{loc.id}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="min-h-0 overflow-y-auto border-t border-hairline bg-surface p-5 lg:border-l lg:border-t-0">
            {activeLocation && (
              <div className="space-y-4">
                <div>
                  {activeLocation.region && <Badge variant="tone">{activeLocation.region}</Badge>}
                  <h3 className="mt-2 text-lg font-semibold text-ink">{activeLocation.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{activeLocation.description}</p>
                </div>

                {locationVisualRef && (
                  <div className="rounded-[var(--radius-control)] bg-surface-sunken/70 p-3.5 text-xs">
                    <p className="font-semibold text-ink">画面基准：{locationVisualRef.name}</p>
                    <p className="mt-1.5 leading-relaxed text-muted">{locationVisualRef.description}</p>
                    <p className="mt-2 text-[11px] text-muted">
                      参考图：{locationVisualRef.referenceArtifactIds.length} 张
                    </p>
                  </div>
                )}

                <div className="border-t border-hairline pt-4">
                  <h4 className="mb-2 text-xs font-semibold text-muted">
                    常驻该地人物 ({stationedActors.length})
                  </h4>
                  {stationedActors.length === 0 ? (
                    <p className="text-xs text-muted">暂无固定驻留该地的人物。</p>
                  ) : (
                    <div className="space-y-2">
                      {stationedActors.map((actor) => (
                        <button
                          key={actor.id}
                          type="button"
                          onClick={() => {
                            setSelectedActorId(actor.id);
                            setTab('factions');
                          }}
                          className="flex w-full items-center justify-between rounded-[var(--radius-control)] bg-surface-raised px-3 py-2 text-left text-xs shadow-[0_0_0_1px_var(--hairline)] hover:bg-surface-hover"
                        >
                          <span className="font-medium text-ink">{actor.name}</span>
                          <span className="text-accent">查看人设</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* 2. 阵营与人物 */}
      {tab === 'factions' && (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[220px_minmax(0,1fr)_400px]">
          <aside className="min-h-0 overflow-y-auto border-b border-hairline bg-surface/60 p-3 lg:border-b-0 lg:border-r">
            <p className="mb-2 px-2 text-xs font-semibold text-muted">按阵营 / 势力筛选</p>
            <div className="flex flex-row gap-1 overflow-x-auto lg:flex-col">
              <button
                type="button"
                onClick={() => setSelectedFactionId('all')}
                className={sideRowClass(selectedFactionId === 'all')}
              >
                <span>全部阵营</span>
                <span>{definition?.actors.length ?? 0}</span>
              </button>
              {factions.map((fac) => (
                <button
                  key={fac.id}
                  type="button"
                  onClick={() => setSelectedFactionId(fac.id)}
                  className={sideRowClass(selectedFactionId === fac.id)}
                >
                  <span className="truncate">{fac.name}</span>
                  <span>{fac.actors.length}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
            <div className="space-y-6">
              {visibleFactions.map((faction) => (
                <section key={faction.id} className="space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline pb-2">
                    <h2 className="text-base font-semibold text-ink">{faction.name}</h2>
                    {faction.description && <p className="text-xs text-muted">{faction.description}</p>}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {faction.actors.map((actor) => {
                      const card = actor.characterId ? cardByCharId.get(actor.characterId) : undefined;
                      return (
                        <button
                          key={actor.id}
                          type="button"
                          onClick={() => setSelectedActorId(actor.id)}
                          className={cn(cardClass(activeActor?.id === actor.id), 'flex items-start gap-3 p-4')}
                        >
                          {card?.avatarUrl ? (
                            <img src={card.avatarUrl} alt={actor.name} className="h-11 w-11 shrink-0 rounded-full object-cover" />
                          ) : (
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-sm font-semibold text-ink">
                              {actor.name.slice(0, 1)}
                            </div>
                          )}
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-semibold text-ink">{actor.name}</span>
                              <Badge variant={actor.role === 'main' ? 'accent' : 'outline'}>
                                {actor.role === 'main' ? '主核' : '参演'}
                              </Badge>
                            </div>
                            <p className="line-clamp-2 text-xs leading-relaxed text-muted">
                              {card?.summary || actor.personality}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>

          <aside className="min-h-0 overflow-y-auto border-t border-hairline bg-surface p-5 lg:border-l lg:border-t-0">
            {activeActor && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {activeActor.faction && <Badge variant="tone">{activeActor.faction}</Badge>}
                      {activeCharCard && (
                        <Badge variant="outline">{ORIGIN_TYPE_LABELS[activeCharCard.originType]}</Badge>
                      )}
                    </div>
                    <h3 className="mt-2 text-lg font-semibold text-ink">{activeActor.name}</h3>
                    {activeCharCard?.englishName && (
                      <p className="text-xs text-muted">{activeCharCard.englishName}</p>
                    )}
                  </div>
                  {activeActor.characterId && (
                    <Link
                      href={`/apps/characters/${encodeURIComponent(activeActor.characterId)}`}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      角色库详情
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  )}
                </div>

                <div className="space-y-3 text-xs leading-relaxed">
                  <div className="rounded-[var(--radius-control)] bg-surface-sunken/60 p-3">
                    <p className="font-semibold text-ink">目标与状态</p>
                    <p className="mt-1 text-muted">{activeActor.goals.join('；') || '待定'}</p>
                  </div>

                  <div>
                    <p className="font-semibold text-ink">人设核心</p>
                    <p className="mt-1 whitespace-pre-wrap text-muted">
                      {activeCharCard?.personaText || activeActor.background}
                    </p>
                  </div>

                  {activeVoice && (
                    <div className="space-y-2 rounded-[var(--radius-control)] bg-surface-raised p-3 shadow-[0_0_0_1px_var(--hairline)]">
                      <p className="font-semibold text-ink">声纹样本与行为准则</p>
                      {activeVoice.mannerisms && <p className="text-muted">习惯：{activeVoice.mannerisms}</p>}
                      {activeVoice.voiceSamples.map((line, idx) => (
                        <p key={idx} className="rounded bg-surface-sunken px-2.5 py-1.5 text-ink">{line}</p>
                      ))}
                      {activeVoice.taboos?.length ? (
                        <p className="text-warning-fg">禁忌：{activeVoice.taboos.join('；')}</p>
                      ) : null}
                    </div>
                  )}

                  {activeCharCard?.appearance.baseText && (
                    <div>
                      <p className="font-semibold text-ink">外貌与常驻服饰基准</p>
                      <p className="mt-1 text-muted">{activeCharCard.appearance.baseText}</p>
                      {activeCharCard.appearance.defaultOutfitText && (
                        <p className="mt-1 text-muted">{activeCharCard.appearance.defaultOutfitText}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* 3. 规则 · 伏笔 · 来源 · 文风 */}
      {tab === 'lore' && (
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <div className="mx-auto max-w-5xl space-y-6">
            <section className="rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)]">
              <h2 className="text-base font-semibold text-ink">常驻硬约束</h2>
              <ul className="mt-3 space-y-2 text-sm text-muted">
                {(definition?.lockedFacts ?? []).map((fact, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span>{fact}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)]">
              <h2 className="text-base font-semibold text-ink">开放伏笔与触发词账本 ({openThreads.length})</h2>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {openThreads.map((thread) => (
                  <div key={thread.id} className="rounded-[var(--radius-control)] bg-surface-raised p-4 shadow-[0_0_0_1px_var(--hairline)]">
                    <h3 className="text-sm font-semibold text-ink">{thread.title}</h3>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {thread.triggers.map((trigger) => (
                        <Badge key={trigger} variant="tone">{trigger}</Badge>
                      ))}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted">{thread.detail}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-xs),0_0_0_1px_var(--hairline)]">
              <h2 className="text-base font-semibold text-ink">考据与设定来源 ({definition?.sources.length ?? 0})</h2>
              <div className="mt-3 space-y-2">
                {(definition?.sources ?? []).map((src) => (
                  <details key={src.id} className="rounded-[var(--radius-control)] bg-surface-sunken/50 px-4 py-3 text-xs">
                    <summary className="flex cursor-pointer items-center justify-between gap-2 font-medium text-ink">
                      <span>{src.title}</span>
                      <Badge variant={sourceNatureTone(src.nature)}>
                        {SOURCE_NATURE_META[src.nature].label}
                      </Badge>
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap leading-relaxed text-muted">{src.content}</p>
                    {src.sourceUrl && <p className="mt-1.5 text-[11px] text-muted">来源：{src.sourceUrl}</p>}
                  </details>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
