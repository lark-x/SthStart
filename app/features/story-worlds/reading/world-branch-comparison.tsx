'use client';

import React, { useState, useMemo } from 'react';
import {
  GitCompare,
  GitBranch,
  Clock,
  MapPin,
  Users,
  ChevronRight,
  Sparkles,
  Layers,
  ArrowRight,
  Filter,
  FileText,
  Image as ImageIcon,
  HeartHandshake,
} from 'lucide-react';
import type {
  WorldEvent,
  WorldActor,
  WorldLocation,
  WorldImage,
  WorldBranch,
} from '@sthstart/contracts';
import type { WorldBranchComparisonProps } from './types';
import {
  formatTick,
  formatDuration,
  lookupActor,
  lookupLocation,
  groupImagesByEvent,
  sortEventsChronologically,
} from './reading-utils';
import {
  BranchModeBadge,
  SourceNatureBadge,
  ImagePhaseBadge,
  ImageStatusBadge,
} from './badges';
import { Button } from '@/app/components/ui/button';

export function WorldBranchComparison({
  left,
  right,
  actors,
  locations,
  onSelectEvent,
  className = '',
}: WorldBranchComparisonProps) {
  // Optional character filter to focus comparison on a specific actor's divergent fate
  const [filterActorId, setFilterActorId] = useState<string | undefined>(undefined);

  // Mobile layout switch (left | right | both)
  const [mobileTab, setMobileTab] = useState<'both' | 'left' | 'right'>('both');

  // Per-branch actor & location fallback (supporting branch divergence with full compatibility)
  const leftActors = left.actors ?? actors;
  const leftLocations = left.locations ?? locations;
  const rightActors = right.actors ?? actors;
  const rightLocations = right.locations ?? locations;

  // Consolidated actor list for top filter bar (merging common and per-branch actors)
  const allComparisonActors = useMemo(() => {
    const map = new Map<string, WorldActor>();
    for (const a of actors) map.set(a.id, a);
    for (const a of leftActors) map.set(a.id, a);
    for (const a of rightActors) map.set(a.id, a);
    return Array.from(map.values());
  }, [actors, leftActors, rightActors]);

  // STRICT BRANCH ISOLATION: Left branch images only for left, right only for right (reject mismatched branchId)
  const leftImagesByEvent = useMemo(
    () => groupImagesByEvent(left.images || [], left.branch.id),
    [left.images, left.branch.id]
  );
  const rightImagesByEvent = useMemo(
    () => groupImagesByEvent(right.images || [], right.branch.id),
    [right.images, right.branch.id]
  );

  // Chronologically sorted events
  const leftEvents = useMemo(() => sortEventsChronologically(left.events), [left.events]);
  const rightEvents = useMemo(() => sortEventsChronologically(right.events), [right.events]);

  // Filtered by actor
  const visibleLeftEvents = useMemo(() => {
    if (!filterActorId) return leftEvents;
    return leftEvents.filter(e => e.participantIds.includes(filterActorId));
  }, [leftEvents, filterActorId]);

  const visibleRightEvents = useMemo(() => {
    if (!filterActorId) return rightEvents;
    return rightEvents.filter(e => e.participantIds.includes(filterActorId));
  }, [rightEvents, filterActorId]);

  // Find divergence point (fork tick)
  const forkTick = Math.min(left.branch.forkTick, right.branch.forkTick);

  return (
    <div className={`flex flex-col w-full min-w-0 space-y-6 font-sans ${className}`}>
      {/* Top Comparison Controller Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 bg-surface rounded-[var(--radius-panel)] border border-hairline shadow-xs">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent-soft flex items-center justify-center shrink-0">
            <GitCompare className="w-4 h-4 text-accent" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-ink">分支演进并排对照</h2>
            <p className="text-xs text-muted">
              独立观察不同前提或抉择下的事件分歧，分支独立不混图
            </p>
          </div>
        </div>

        {/* Character Focus Filter */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          <span className="text-xs font-semibold text-muted shrink-0 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" />
            <span>聚焦角色：</span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setFilterActorId(undefined)}
            aria-pressed={!filterActorId}
            className="ui-choice h-auto min-h-0 shrink-0 rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface-raised hover:text-ink sm:min-h-0"
          >
            全部事件对比
          </Button>
          {allComparisonActors.map(actor => {
            const isSelected = filterActorId === actor.id;
            return (
              <Button
                key={actor.id}
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setFilterActorId(isSelected ? undefined : actor.id)}
                aria-pressed={isSelected}
                className="ui-choice h-auto min-h-0 shrink-0 rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface-raised hover:text-ink sm:min-h-0"
              >
                {actor.name}
              </Button>
            );
          })}
        </div>

        {/* Mobile View Toggle (Hidden on large screens) */}
        <div className="flex lg:hidden items-center gap-1 bg-surface-sunken p-1 rounded-lg text-xs self-start">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setMobileTab('both')}
            aria-pressed={mobileTab === 'both'}
            className="ui-choice h-auto min-h-0 rounded px-2 py-0.5 text-xs font-medium text-muted sm:min-h-0"
          >
            并排双栏
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setMobileTab('left')}
            aria-pressed={mobileTab === 'left'}
            className="ui-choice h-auto min-h-0 rounded px-2 py-0.5 text-xs font-medium text-muted sm:min-h-0"
          >
            仅看左侧
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setMobileTab('right')}
            aria-pressed={mobileTab === 'right'}
            className="ui-choice h-auto min-h-0 rounded px-2 py-0.5 text-xs font-medium text-muted sm:min-h-0"
          >
            仅看右侧
          </Button>
        </div>
      </div>

      {/* Divergence Fork Banner */}
      <div className="flex items-center justify-between p-3.5 bg-accent-soft/20 rounded-[var(--radius-panel)] border border-accent/20 text-xs text-muted">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-accent" />
          <span>
            分歧起点时刻：<strong className="text-ink font-mono">{formatTick(forkTick)}</strong>
          </span>
          <span className="hidden sm:inline text-muted">| 起点前的共识历史保持一致，起点之后各自分化</span>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono">
          <span>左侧：{visibleLeftEvents.length} 事件</span>
          <span>右侧：{visibleRightEvents.length} 事件</span>
        </div>
      </div>

      {/* Main Side-by-Side Comparison Container */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* LEFT BRANCH COLUMN */}
        {(mobileTab === 'both' || mobileTab === 'left') && (
          <div className="space-y-4">
            <BranchHeader
              side="left"
              branch={left.branch}
              eventCount={leftEvents.length}
              imageCount={(left.images || []).length}
            />

            {visibleLeftEvents.length === 0 ? (
              <div className="p-8 text-center bg-surface rounded-[var(--radius-panel)] border border-hairline text-xs text-muted">
                左侧分支暂无匹配事件记录。
              </div>
            ) : (
              <div className="space-y-4">
                {visibleLeftEvents.map(ev => (
                  <BranchEventCard
                    key={ev.id}
                    event={ev}
                    branchId={left.branch.id}
                    actors={leftActors}
                    locations={leftLocations}
                    images={leftImagesByEvent.get(ev.id) || []}
                    isDiverged={ev.tick > forkTick}
                    onSelectEvent={onSelectEvent}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* RIGHT BRANCH COLUMN */}
        {(mobileTab === 'both' || mobileTab === 'right') && (
          <div className="space-y-4">
            <BranchHeader
              side="right"
              branch={right.branch}
              eventCount={rightEvents.length}
              imageCount={(right.images || []).length}
            />

            {visibleRightEvents.length === 0 ? (
              <div className="p-8 text-center bg-surface rounded-[var(--radius-panel)] border border-hairline text-xs text-muted">
                右侧分支暂无匹配事件记录。
              </div>
            ) : (
              <div className="space-y-4">
                {visibleRightEvents.map(ev => (
                  <BranchEventCard
                    key={ev.id}
                    event={ev}
                    branchId={right.branch.id}
                    actors={rightActors}
                    locations={rightLocations}
                    images={rightImagesByEvent.get(ev.id) || []}
                    isDiverged={ev.tick > forkTick}
                    onSelectEvent={onSelectEvent}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Branch metadata header card.
 */
function BranchHeader({
  side,
  branch,
  eventCount,
  imageCount,
}: {
  side: 'left' | 'right';
  branch: WorldBranch;
  eventCount: number;
  imageCount: number;
}) {
  return (
    <div className="p-4 bg-surface rounded-[var(--radius-panel)] border border-hairline shadow-xs space-y-3 font-sans">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted uppercase">
              {side === 'left' ? '分支 A (基底/参照)' : '分支 B (对比分支)'}
            </span>
            <span className="text-xs text-muted font-mono">#{branch.id.slice(0, 8)}</span>
          </div>
          <h3 className="text-base font-semibold text-ink">{branch.title}</h3>
        </div>

        {/* Branch Mode Badge (canon-gap | adaptation | alternate) */}
        <BranchModeBadge mode={branch.mode} />
      </div>

      {branch.direction && (
        <p className="text-xs text-muted bg-surface-sunken p-2.5 rounded border border-hairline leading-relaxed">
          <strong className="text-ink">创作方向：</strong>
          {branch.direction}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between text-xs text-muted pt-1 border-t border-hairline">
        <span className="flex items-center gap-1 font-mono">
          <Clock className="w-3 h-3" />
          <span>进度: {formatTick(branch.currentTick)}</span>
        </span>
        <span className="font-mono">
          {eventCount} 事件 · {imageCount} 配图
        </span>
      </div>
    </div>
  );
}

/**
 * Single Event card inside branch column.
 * Images rendered here strictly come from that branch's image list.
 */
function BranchEventCard({
  event,
  branchId,
  actors,
  locations,
  images,
  isDiverged,
  onSelectEvent,
}: {
  event: WorldEvent;
  branchId: string;
  actors: WorldActor[];
  locations: WorldLocation[];
  images: WorldImage[];
  isDiverged: boolean;
  onSelectEvent?: (eventId: string, branchId: string) => void;
}) {
  const location = lookupLocation(locations, event.locationId);

  return (
    <article
      className={`p-4 rounded-[var(--radius-panel)] bg-surface border transition-all duration-150 space-y-3 font-sans ${
        isDiverged
          ? 'border-hairline shadow-xs'
          : 'border-hairline/60 bg-surface/80'
      }`}
    >
      {/* Event Header Meta */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-ink font-mono bg-surface-sunken px-2 py-0.5 rounded text-xs">
            {formatTick(event.tick)}
          </span>
          <span className="text-muted text-xs flex items-center gap-0.5">
            <MapPin className="w-3 h-3 text-muted" />
            <span>{location.name}</span>
          </span>
        </div>

        {isDiverged ? (
          <span className="text-xs px-1.5 py-0.2 rounded-full bg-accent-soft text-accent-dark font-medium">
            分歧后独立事件
          </span>
        ) : (
          <span className="text-xs px-1.5 py-0.2 rounded-full bg-surface-sunken text-muted">
            分歧前共识事件
          </span>
        )}
      </div>

      {/* Event Title (Clickable heading for direct accessibility) */}
      <h4 className="text-sm font-semibold text-ink leading-snug">
        {onSelectEvent ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onSelectEvent(event.id, branchId)}
            className="h-auto min-h-0 justify-start whitespace-normal rounded p-0 text-left text-sm font-semibold leading-snug text-ink hover:bg-transparent hover:text-accent sm:min-h-0"
            title="展开此分支事件详细档案"
          >
            {event.title}
          </Button>
        ) : (
          event.title
        )}
      </h4>

      {/* Narrative Prose (SERIF FONT FOR PROSE ONLY) */}
      <p
        className="story-reading-content font-serif text-sm leading-relaxed text-ink/90 line-clamp-4 break-words text-pretty bg-surface-sunken/20 p-2.5 rounded border border-hairline/60"
      >
        {event.summary}
      </p>

      {/* State Changes Highlights (How characters differ in this branch) */}
      {event.stateChanges.length > 0 && (
        <div className="text-xs space-y-1 pt-1 border-t border-hairline">
          <div className="text-xs text-muted flex items-center gap-1">
            <HeartHandshake className="w-3 h-3 text-warning-fg" />
            <span>角色状态演化：</span>
          </div>
          <div className="space-y-1">
            {event.stateChanges.slice(0, 2).map((st, idx) => {
              const actor = lookupActor(actors, st.actorId);
              return (
                <div key={idx} className="text-xs text-muted flex items-baseline gap-1.5">
                  <span className="font-semibold text-ink">{actor.name}:</span>
                  {st.emotion && <span>情绪[{st.emotion}]</span>}
                  {st.relationships.length > 0 && (
                    <span className="truncate">
                      关系→{lookupActor(actors, st.relationships[0].actorId).name}: {st.relationships[0].description}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Independent Branch Images Preview (Strictly partitioned) */}
      {images.length > 0 && (
        <div className="pt-2 border-t border-hairline">
          <div className="flex items-center justify-between text-xs text-muted mb-1.5">
            <span className="flex items-center gap-1 font-semibold text-ink">
              <ImageIcon className="w-3 h-3 text-accent" />
              <span>本分支专属配图 ({images.length})</span>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {images.map(img => (
              <div
                key={img.id}
                className="flex flex-col p-1.5 rounded bg-surface-sunken/60 border border-hairline space-y-1"
              >
                <div className="flex items-center justify-between gap-0.5">
                  <ImagePhaseBadge phase={img.phase} className="text-xs px-1 py-0" />
                  <ImageStatusBadge status={img.status} className="text-xs px-1 py-0" />
                </div>
                {img.imageUrl && img.status === 'succeeded' ? (
                  <div className="aspect-video rounded overflow-hidden bg-media-backdrop/5">
                    <img
                      src={img.imageUrl}
                      alt={img.caption || '分镜画面'}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <div className="aspect-video rounded bg-surface border border-dashed border-hairline flex items-center justify-center text-xs text-muted p-1 text-center">
                    <span className="line-clamp-2">{img.caption || '分镜构图'}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Footer */}
      {onSelectEvent && (
        <div className="flex justify-end pt-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onSelectEvent(event.id, branchId)}
            className="gap-0.5 px-2 text-xs font-medium text-accent hover:bg-transparent hover:text-accent hover:underline"
          >
            <span>展开事件档案</span>
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}
    </article>
  );
}
