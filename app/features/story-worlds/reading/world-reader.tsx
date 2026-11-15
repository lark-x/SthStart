'use client';

import React, { useState, useMemo } from 'react';
import {
  BookOpen,
  User,
  Users,
  MapPin,
  Clock,
  Eye,
  Sparkles,
  ChevronRight,
  HeartHandshake,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import type { WorldReaderProps, WorldPerspective } from './types';
import {
  formatTick,
  formatDuration,
  lookupActor,
  lookupLocation,
  groupImagesForEvents,
  sortEventsChronologically,
} from './reading-utils';
import {
  SourceNatureBadge,
  ImagePhaseBadge,
  ImageStatusBadge,
} from './badges';
import { Button } from '@/app/components/ui/button';

export function WorldReader({
  events,
  actors,
  locations,
  images = [],
  actorId: propActorId,
  onSelectEvent,
  selectedEventId,
  className = '',
}: WorldReaderProps) {
  // Controlled actorId sync with props (undefined = show all); local clicks allow interactive filtering
  const [localActorId, setLocalActorId] = useState<string | undefined>(propActorId);
  const [prevPropActorId, setPrevPropActorId] = useState<string | undefined>(propActorId);

  if (propActorId !== prevPropActorId) {
    setPrevPropActorId(propActorId);
    setLocalActorId(propActorId);
  }

  const effectiveActorId = localActorId;

  // Branch-isolated perspective map: "${branchId}:${eventId}" -> actorId | 'objective'
  const [eventPerspectives, setEventPerspectives] = useState<Record<string, string>>({});

  // Branch-isolated collapse/expanded sections state: "${branchId}:${eventId}" -> boolean
  const [expandedFacts, setExpandedFacts] = useState<Record<string, boolean>>({});
  const [expandedStates, setExpandedStates] = useState<Record<string, boolean>>({});

  // Group images strictly matching event branchId (mismatched branch images are rejected)
  const imagesByEvent = useMemo(() => groupImagesForEvents(images, events), [images, events]);

  // Sorted events
  const sortedEvents = useMemo(() => sortEventsChronologically(events), [events]);

  // Filtered events by effective character
  const visibleEvents = useMemo(() => {
    if (!effectiveActorId) return sortedEvents;
    return sortedEvents.filter(
      ev =>
        ev.participantIds.includes(effectiveActorId) ||
        ev.perspectives.some(p => p.actorId === effectiveActorId) ||
        ev.stateChanges.some(s => s.actorId === effectiveActorId)
    );
  }, [sortedEvents, effectiveActorId]);

  const branchEventKey = (branchId: string, eventId: string) => `${branchId}:${eventId}`;

  const handlePerspectiveChange = (branchId: string, eventId: string, actorIdOrObjective: string) => {
    const key = branchEventKey(branchId, eventId);
    setEventPerspectives(prev => ({
      ...prev,
      [key]: actorIdOrObjective,
    }));
  };

  const toggleFacts = (branchId: string, eventId: string) => {
    const key = branchEventKey(branchId, eventId);
    setExpandedFacts(prev => ({ ...prev, [key]: !(prev[key] ?? false) }));
  };

  const toggleStates = (branchId: string, eventId: string) => {
    const key = branchEventKey(branchId, eventId);
    setExpandedStates(prev => ({ ...prev, [key]: !(prev[key] ?? false) }));
  };

  return (
    <div className={`flex flex-col w-full min-w-0 space-y-6 ${className}`}>
      {/* Top Filter and Controls Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 bg-surface rounded-[var(--radius-panel)] border border-hairline shadow-xs font-sans">
        {/* Character Navigation Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 scrollbar-none min-w-0">
          <span className="text-xs font-semibold text-muted flex items-center gap-1 shrink-0">
            <User className="w-3.5 h-3.5" />
            <span>阅读视角：</span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setLocalActorId(undefined)}
            aria-pressed={!effectiveActorId}
            className="ui-choice h-auto min-h-0 shrink-0 rounded-full bg-surface-sunken px-3 py-1 text-xs font-medium text-muted hover:bg-surface-raised hover:text-ink sm:min-h-0"
          >
            全部事件长卷 ({sortedEvents.length})
          </Button>
          {actors.map(actor => {
            const isSelected = effectiveActorId === actor.id;
            const actorEventsCount = sortedEvents.filter(
              e => e.participantIds.includes(actor.id) || e.perspectives.some(p => p.actorId === actor.id)
                || e.stateChanges.some(s => s.actorId === actor.id)
            ).length;

            return (
              <Button
                key={actor.id}
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setLocalActorId(isSelected ? undefined : actor.id)}
                aria-pressed={isSelected}
                className="ui-choice h-auto min-h-0 shrink-0 rounded-full bg-surface-sunken px-3 py-1 text-xs font-medium text-muted hover:bg-surface-raised hover:text-ink sm:min-h-0 [&_.ui-mantine-button-label]:gap-1.5"
                title={`查看 ${actor.name} 参与的剧情`}
              >
                <span>{actor.name}</span>
                <span className="rounded-full bg-ink/5 px-1 text-[10px]">
                  {actorEventsCount}
                </span>
              </Button>
            );
          })}
        </div>

        {/* Status Count Meta */}
        <div className="flex items-center gap-3 shrink-0 text-xs text-muted">
          <span className="flex items-center gap-1">
            <BookOpen className="w-3.5 h-3.5" />
            <span>当前展示 {visibleEvents.length} 个事件</span>
          </span>
        </div>
      </div>

      {/* Main Continuous Reading Stream */}
      {visibleEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center bg-surface rounded-[var(--radius-panel)] border border-hairline font-sans">
          <BookOpen className="w-10 h-10 text-muted mb-3 opacity-60" />
          <h3 className="text-sm font-semibold text-ink">当前视角暂无事件记录</h3>
          <p className="text-xs text-muted mt-1 max-w-sm">
            {effectiveActorId
              ? '选中的角色在该分支尚未参与已记录的事件，您可以切换为全部事件或选择其他角色。'
              : '此分支尚未生成推进事件，请通过模拟推进或导演干预创建新的事件。'}
          </p>
          {effectiveActorId && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setLocalActorId(undefined)}
              className="mt-4"
            >
              返回全部故事事件
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {visibleEvents.map((ev) => {
            const location = lookupLocation(locations, ev.locationId);
            const isSelected = selectedEventId === ev.id;
            const eventImages = imagesByEvent.get(ev.id) || [];
            const eventKey = branchEventKey(ev.branchId, ev.id);

            // Determine active perspective for this event (strictly branch-isolated)
            const chosenKey =
              eventPerspectives[eventKey] ||
              effectiveActorId || 'objective';

            const activePerspective: WorldPerspective | undefined =
              chosenKey !== 'objective'
                ? ev.perspectives.find(p => p.actorId === chosenKey)
                : undefined;

            const perspectiveActor = chosenKey !== 'objective'
              ? lookupActor(actors, chosenKey)
              : null;
            const perspectiveActorIds = [...new Set([
              ...ev.participantIds,
              ...ev.perspectives.map(p => p.actorId),
              ...(effectiveActorId ? [effectiveActorId] : []),
            ])];

            // Fact expansion check: default to false (collapsed) for clean user reading
            const showFacts = expandedFacts[eventKey] ?? false;
            const showStates = expandedStates[eventKey] ?? false;

            return (
              <article
                key={eventKey}
                id={`event-${ev.id}`}
                className={`relative bg-surface rounded-[var(--radius-panel)] border transition-all duration-200 overflow-hidden ${
                  isSelected
                    ? 'border-accent shadow-md ring-1 ring-accent/30'
                    : 'border-hairline shadow-xs hover:border-border-default/60'
                }`}
              >
                {/* Event Metadata Ribbon (Clean, Sans-serif UI) */}
                <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-surface-sunken/40 border-b border-hairline font-sans">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {/* Time Tick (Human readable: 第 D 天 HH:MM) */}
                    <span className="inline-flex items-center gap-1 font-semibold text-ink bg-surface px-2.5 py-0.5 rounded border border-hairline">
                      <Clock className="w-3 h-3 text-muted" />
                      <span>{formatTick(ev.tick)}</span>
                    </span>

                    {/* Location */}
                    <span
                      className="inline-flex items-center gap-1 text-muted bg-surface px-2 py-0.5 rounded border border-hairline"
                      title={location.description || location.name}
                    >
                      <MapPin className="w-3 h-3 text-muted" />
                      <span className="font-medium text-ink">{location.name}</span>
                    </span>

                    {/* Duration (only when > 0, human readable minutes) */}
                    {ev.duration > 0 && formatDuration(ev.duration) ? (
                      <span className="text-muted text-[11px]">
                        {formatDuration(ev.duration)}
                      </span>
                    ) : null}
                  </div>

                  {/* Quick Action: Open Inspector */}
                  <div className="flex items-center gap-2">
                    {onSelectEvent && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onSelectEvent(ev.id)}
                        className="gap-1 px-2 text-xs font-medium text-muted hover:text-accent"
                        title="查看事件详细事实、各方记忆与分镜生成"
                      >
                        <span>查看档案</span>
                        <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </header>

                <div className="p-4 md:p-6 space-y-4">
                  {/* Event Title (Clickable heading for direct accessibility) */}
                  <h2 className="text-lg md:text-xl font-semibold text-ink font-sans tracking-tight">
                    {onSelectEvent ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onSelectEvent(ev.id)}
                        className="h-auto min-h-0 justify-start whitespace-normal rounded p-0 text-left text-lg font-semibold tracking-tight text-ink hover:bg-transparent hover:text-accent sm:min-h-0 md:text-xl"
                        title="点击查看事件详细档案"
                      >
                        {ev.title}
                      </Button>
                    ) : (
                      ev.title
                    )}
                  </h2>

                  {/* Perspective Switcher Controls (Sans-serif UI) */}
                  <div className="flex flex-wrap items-center gap-1.5 p-1 bg-surface-sunken rounded-lg font-sans text-xs">
                    <span className="text-muted px-2 py-1 text-[11px] font-semibold shrink-0 flex items-center gap-1">
                      <Eye className="w-3 h-3" />
                      <span>叙述视角：</span>
                    </span>

                    {/* Objective Overview Option */}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handlePerspectiveChange(ev.branchId, ev.id, 'objective')}
                      aria-pressed={chosenKey === 'objective'}
                      className="ui-choice h-auto min-h-0 rounded-md px-2.5 py-1 text-xs font-medium text-muted hover:text-ink sm:min-h-0"
                    >
                      客观叙述
                    </Button>

                    {/* Participant Perspectives */}
                    {perspectiveActorIds.map(pId => {
                      const actor = lookupActor(actors, pId);
                      const hasSpecificPerspective = ev.perspectives.some(p => p.actorId === pId);
                      const isActive = chosenKey === pId;

                      return (
                        <Button
                          key={pId}
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handlePerspectiveChange(ev.branchId, ev.id, pId)}
                          aria-pressed={isActive}
                          className="ui-choice h-auto min-h-0 rounded-md px-2.5 py-1 text-xs font-medium text-muted hover:text-ink sm:min-h-0 [&_.ui-mantine-button-label]:gap-1"
                          title={
                            hasSpecificPerspective
                              ? `查看 ${actor.name} 的个人视角记录`
                              : `${actor.name} 的个人视角尚未记录`
                          }
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              hasSpecificPerspective ? 'bg-accent' : 'bg-muted'
                            }`}
                          />
                          <span>{actor.name}视角</span>
                        </Button>
                      );
                    })}
                  </div>

                  {/* Perspective Attribution Note */}
                  {perspectiveActor && activePerspective && (
                    <div className="flex items-center gap-2 text-xs text-muted font-sans bg-accent-soft/30 px-3 py-1.5 rounded-md border border-accent/15">
                      <Sparkles className="w-3.5 h-3.5 text-accent" />
                      <span>
                        正在阅读「<strong className="text-ink">{perspectiveActor.name}</strong>」的个人视角记录
                      </span>
                    </div>
                  )}

                  {perspectiveActor && !activePerspective && (
                    <div className="space-y-2 rounded-lg bg-surface-sunken/50 p-3 font-sans text-sm text-muted">
                      <p>此事件尚未记录「{perspectiveActor.name}」的个人视角。</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handlePerspectiveChange(ev.branchId, ev.id, 'objective')}
                        className="justify-start px-2 text-accent hover:text-accent"
                      >
                        切换为客观叙述
                      </Button>
                    </div>
                  )}

                  {/* Only the explicitly chosen narrative is shown; personal gaps stay visible. */}
                  {(chosenKey === 'objective' || activePerspective) && <div
                    className="story-reading-content max-w-[75ch] font-serif text-[16.5px] leading-[1.85] text-ink break-words text-pretty py-1 selection:bg-accent-soft"
                    style={{ fontFamily: 'var(--font-serif)' }}
                  >
                    {activePerspective ? (
                      /* Specific participant perspective chosen */
                      activePerspective.text.split('\n\n').map((paragraph: string, pIdx: number) => {
                        const trimmed = paragraph.trim();
                        if (!trimmed) return null;
                        return (
                          <p key={pIdx} className="my-3 text-justify">
                            {trimmed}
                          </p>
                        );
                      })
                    ) : (
                      /* Objective mode presents the event once; personal prose is available above. */
                      <div className="space-y-4">
                        {ev.summary.split('\n\n').map((paragraph: string, pIdx: number) => {
                          const trimmed = paragraph.trim();
                          if (!trimmed) return null;
                          return (
                            <p key={pIdx} className="my-2 text-justify">
                              {trimmed}
                            </p>
                          );
                        })}
                      </div>
                    )}
                  </div>}

                  {/* Participants & Scene Characters Bar */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-hairline font-sans text-xs">
                    <span className="text-muted shrink-0 flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      <span>在场角色：</span>
                    </span>
                    {ev.participantIds.map(pId => {
                      const actor = lookupActor(actors, pId);
                      return (
                        <span
                          key={pId}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-sunken text-ink text-[11px] font-medium"
                        >
                          <span className="w-1 h-1 rounded-full bg-accent" />
                          <span>{actor.name}</span>
                          <span className="text-[10px] text-muted">
                            ({actor.role === 'main' ? '主角' : '配角'})
                          </span>
                        </span>
                      );
                    })}
                  </div>

                  {/* Non-Blocking Visual Storyboard Thumbnail Strip */}
                  {eventImages.length > 0 && (
                    <div className="pt-2 font-sans">
                      <div className="flex items-center justify-between text-xs text-muted mb-2">
                        <span className="flex items-center gap-1 font-semibold text-ink">
                          <ImageIcon className="w-3.5 h-3.5" />
                          <span>分镜画面 ({eventImages.length})</span>
                        </span>
                        <span className="text-[11px]">点击图片或右上方展开档案查看原画提示</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {eventImages.map(img => (
                          <div
                            key={img.id}
                            onClick={() => onSelectEvent?.(ev.id)}
                            className="group flex flex-col p-2 rounded-lg bg-surface-sunken/60 border border-hairline hover:border-accent/40 cursor-pointer transition-colors"
                          >
                            <div className="flex items-center justify-between gap-1 mb-1.5">
                              <ImagePhaseBadge phase={img.phase} />
                              <ImageStatusBadge status={img.status} />
                            </div>

                            {img.imageUrl && img.status === 'succeeded' ? (
                              <div className="relative aspect-video rounded overflow-hidden bg-black/5 mb-1.5">
                                <img
                                  src={img.imageUrl}
                                  alt={img.caption || '分镜画面'}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                  loading="lazy"
                                />
                              </div>
                            ) : (
                              <div className="aspect-video rounded bg-surface border border-dashed border-hairline flex flex-col items-center justify-center p-2 text-center mb-1.5">
                                <span className="text-[11px] text-muted font-medium line-clamp-1">
                                  {img.caption || '分镜构图'}
                                </span>
                              </div>
                            )}

                            <p className="text-[11px] text-muted line-clamp-1 group-hover:text-ink transition-colors">
                              {img.caption || '分镜规划'}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Foldable Facts & Cognitive Provenance Section */}
                  {ev.facts.length > 0 && (
                    <div className="pt-2 border-t border-hairline font-sans">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleFacts(ev.branchId, ev.id)}
                        aria-expanded={showFacts}
                        className="h-auto min-h-0 w-full justify-between px-0 py-1 text-left text-xs font-normal text-muted hover:bg-transparent hover:text-ink sm:min-h-0 [&_.ui-mantine-button-inner]:w-full [&_.ui-mantine-button-label]:flex [&_.ui-mantine-button-label]:w-full [&_.ui-mantine-button-label]:items-center [&_.ui-mantine-button-label]:justify-between"
                      >
                        <span className="flex items-center gap-1.5 font-semibold text-ink">
                          <FileText className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                          <span>沉淀事实与认知边界 ({ev.facts.length})</span>
                        </span>
                        <span className="text-[11px] text-accent font-medium">
                          {showFacts ? '收起事实' : `展开事实 (${ev.facts.length})`}
                        </span>
                      </Button>

                      {showFacts && (
                        <div className="mt-2 space-y-2">
                          {ev.facts.map(fact => {
                            const knownActors = fact.knownBy.map(kId => lookupActor(actors, kId).name);
                            return (
                              <div
                                key={fact.id}
                                className="p-2.5 rounded-lg bg-surface-sunken/40 border border-hairline text-xs space-y-1"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <SourceNatureBadge nature={fact.nature} />
                                  <span className="text-[11px] text-muted">
                                    已知晓角色：{knownActors.length > 0 ? knownActors.join('、') : '仅环境记录'}
                                  </span>
                                </div>
                                <p className="text-ink leading-relaxed font-sans">{fact.content}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Foldable Character State Changes */}
                  {ev.stateChanges.length > 0 && (
                    <div className="pt-2 border-t border-hairline font-sans">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleStates(ev.branchId, ev.id)}
                        aria-expanded={showStates}
                        className="h-auto min-h-0 w-full justify-between px-0 py-1 text-left text-xs font-normal text-muted hover:bg-transparent hover:text-ink sm:min-h-0 [&_.ui-mantine-button-inner]:w-full [&_.ui-mantine-button-label]:flex [&_.ui-mantine-button-label]:w-full [&_.ui-mantine-button-label]:items-center [&_.ui-mantine-button-label]:justify-between"
                      >
                        <span className="flex items-center gap-1.5 font-semibold text-ink">
                          <HeartHandshake className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                          <span>角色心理与关系演变 ({ev.stateChanges.length})</span>
                        </span>
                        <span className="text-[11px] text-accent font-medium">
                          {showStates ? '收起状态' : `展开状态 (${ev.stateChanges.length})`}
                        </span>
                      </Button>

                      {showStates && (
                        <div className="mt-2 space-y-2">
                          {ev.stateChanges.map((st, sIdx) => {
                            const actor = lookupActor(actors, st.actorId);
                            return (
                              <div
                                key={`${st.actorId}-${sIdx}`}
                                className="p-2.5 rounded-lg bg-surface-sunken/40 border border-hairline text-xs space-y-1.5"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-ink">{actor.name}</span>
                                  {st.emotion && (
                                    <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-800 dark:text-amber-300 text-[11px]">
                                      情绪：{st.emotion}
                                    </span>
                                  )}
                                </div>

                                {st.goals.length > 0 && (
                                  <div className="text-[11px] text-muted">
                                    <span className="font-medium text-ink">当前目标：</span>
                                    <span>{st.goals.join('；')}</span>
                                  </div>
                                )}

                                {st.relationships.length > 0 && (
                                  <div className="space-y-1 pt-1 border-t border-hairline/60">
                                    <span className="text-[11px] font-medium text-ink">关系变化：</span>
                                    {st.relationships.map((rel, rIdx) => {
                                      const target = lookupActor(actors, rel.actorId);
                                      return (
                                        <div
                                          key={rIdx}
                                          className="text-[11px] text-muted pl-2 border-l border-accent/40"
                                        >
                                          对 <strong className="text-ink">{target.name}</strong>：{rel.description}
                                          {rel.sourceEventId && (
                                            <span className="text-[10px] text-muted ml-1.5">
                                              (源于事件 #{rel.sourceEventId})
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
