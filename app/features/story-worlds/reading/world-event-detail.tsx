'use client';

import React, { useState, useMemo } from 'react';
import {
  X,
  Clock,
  MapPin,
  Users,
  Eye,
  FileText,
  HeartHandshake,
  Image as ImageIcon,
  ChevronRight,
  GitPullRequest,
  ShieldAlert,
  Sparkles,
  Link as LinkIcon,
  HelpCircle,
  ExternalLink,
} from 'lucide-react';
import type {
  WorldEvent,
  WorldActor,
  WorldLocation,
  WorldImage,
} from '@sthstart/contracts';
import type { WorldEventDetailProps, WorldPerspective } from './types';
import {
  formatTick,
  formatDuration,
  lookupActor,
  lookupLocation,
  groupImagesByPhase,
  IMAGE_PHASE_CONFIG,
} from './reading-utils';
import {
  SourceNatureBadge,
  ImagePhaseBadge,
  ImageStatusBadge,
} from './badges';
import { Button } from '@/app/components/ui/button';
import { IconButton } from '@/app/components/ui/icon-button';

export function WorldEventDetail({
  event,
  actors,
  locations,
  images = [],
  onClose,
  onSelectEvent,
  className = '',
}: WorldEventDetailProps) {
  // Filter images belonging to this event, strictly enforcing branchId match
  const eventImages = useMemo(() => {
    return images.filter(
      img => img.eventId === event.id && (!img.branchId || img.branchId === event.branchId)
    );
  }, [images, event.id, event.branchId]);

  const phaseGroups = useMemo(() => {
    return groupImagesByPhase(eventImages);
  }, [eventImages]);

  // Active perspective tab
  const [activeTab, setActiveTab] = useState<string>('summary');

  const location = lookupLocation(locations, event.locationId);

  // Available perspectives
  const currentPerspective = useMemo(() => {
    if (activeTab === 'summary') return null;
    return event.perspectives.find(p => p.actorId === activeTab) || null;
  }, [event.perspectives, activeTab]);

  return (
    <div
      className={`flex flex-col w-full bg-surface rounded-[var(--radius-panel)] border border-hairline shadow-sm overflow-hidden font-sans ${className}`}
    >
      {/* Detail Header Bar */}
      <div className="flex items-start justify-between gap-4 p-5 md:p-6 bg-surface-sunken/40 border-b border-hairline">
        <div className="space-y-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 font-semibold text-ink bg-surface px-2.5 py-0.5 rounded border border-hairline">
              <Clock className="w-3 h-3 text-muted" />
              <span>{formatTick(event.tick)}</span>
            </span>
            <span
              className="inline-flex items-center gap-1 text-muted bg-surface px-2 py-0.5 rounded border border-hairline"
              title={location.description}
            >
              <MapPin className="w-3 h-3 text-muted" />
              <span className="font-medium text-ink">{location.name}</span>
            </span>
            {event.duration > 0 && formatDuration(event.duration) ? (
              <span className="text-muted text-[11px]">
                {formatDuration(event.duration)}
              </span>
            ) : null}
          </div>

          <h2 className="text-xl md:text-2xl font-bold text-ink tracking-tight">
            {event.title}
          </h2>

          {/* Predecessor Causes & Storylines */}
          {(event.causeEventIds.length > 0 || event.storyLineIds.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
              {event.causeEventIds.length > 0 && (
                <div className="flex items-center gap-1 text-muted">
                  <GitPullRequest className="w-3 h-3 text-accent" />
                  <span>前置起因：</span>
                  {event.causeEventIds.map(causeId => (
                    <Button
                      key={causeId}
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onSelectEvent?.(causeId)}
                      className="h-6 min-h-6 gap-0 rounded border border-hairline bg-surface px-1.5 font-mono text-[11px] text-accent hover:text-accent sm:min-h-6"
                      title={`跳转查看前置事件 ${causeId}`}
                    >
                      #{causeId.slice(0, 8)}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {onClose && (
          <IconButton
            icon={X}
            label="关闭详情面板"
            variant="ghost"
            iconClassName="h-5 w-5"
            className="shrink-0 text-muted hover:text-ink"
            onClick={onClose}
          />
        )}
      </div>

      <div className="p-5 md:p-6 space-y-8">
        {/* Participants & Scene Presence */}
        <section className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Users className="w-3.5 h-3.5 text-accent" />
            <span>在场出场角色 ({event.participantIds.length})</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {event.participantIds.map(pId => {
              const actor = lookupActor(actors, pId);
              const hasPerspective = event.perspectives.some(p => p.actorId === pId);

              return (
                <div
                  key={pId}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-surface-sunken/40 border border-hairline"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink truncate">{actor.name}</p>
                      <p className="text-[11px] text-muted truncate">
                        {actor.role === 'main' ? '核心主角' : '世界配角'}
                      </p>
                    </div>
                  </div>
                  {hasPerspective && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft text-accent-dark font-medium shrink-0">
                      有主观视角
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Narrative & Multi-Perspective Section */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <Eye className="w-3.5 h-3.5 text-accent" />
              <span>多重视角记录（切视角仍对应同一事件）</span>
            </div>

            {/* Perspective Selector Pills */}
            <div className="flex items-center gap-1 bg-surface-sunken p-1 rounded-lg text-xs">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-pressed={activeTab === 'summary'}
                onClick={() => setActiveTab('summary')}
                className={`h-auto min-h-0 rounded-md px-2.5 py-1 text-xs font-medium sm:min-h-0 ${
                  activeTab === 'summary'
                    ? 'bg-surface-raised text-ink shadow-xs font-semibold hover:bg-surface-raised hover:text-ink'
                    : 'text-muted hover:text-ink'
                }`}
              >
                客观全景
              </Button>
              {event.perspectives.map(p => {
                const actor = lookupActor(actors, p.actorId);
                const isActive = activeTab === p.actorId;
                return (
                  <Button
                    key={p.actorId}
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-pressed={isActive}
                    onClick={() => setActiveTab(p.actorId)}
                    className={`h-auto min-h-0 rounded-md px-2.5 py-1 text-xs font-medium sm:min-h-0 ${
                      isActive
                        ? 'bg-surface-raised text-ink shadow-xs font-semibold hover:bg-surface-raised hover:text-ink'
                        : 'text-muted hover:text-ink'
                    }`}
                  >
                    {actor.name}视角
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Perspective Prose Box (SERIF FONT FOR STORY PROSE ONLY) */}
          <div className="p-5 rounded-[var(--radius-panel)] bg-surface-sunken/30 border border-hairline">
            {currentPerspective ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-muted pb-2 border-b border-hairline font-sans">
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  <span>
                    角色「<strong className="text-ink">{lookupActor(actors, currentPerspective.actorId).name}</strong>」的主观回忆与亲历视角
                  </span>
                </div>
                <div
                  className="story-reading-content font-serif text-[16px] leading-[1.85] text-ink break-words text-pretty"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  {currentPerspective.text.split('\n\n').map((para, idx) => (
                    <p key={idx} className="my-2.5 text-justify">
                      {para.trim()}
                    </p>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-muted pb-2 border-b border-hairline font-sans">
                  <span>世界客观事实裁定概要</span>
                </div>
                <div
                  className="story-reading-content font-serif text-[16px] leading-[1.85] text-ink break-words text-pretty"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  {event.summary.split('\n\n').map((para, idx) => (
                    <p key={idx} className="my-2.5 text-justify">
                      {para.trim()}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Settled Facts & Information Provenance */}
        <section className="space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-ink">
            <span className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>事件沉淀事实与知晓范围 ({event.facts.length})</span>
            </span>
            <span className="text-[11px] text-muted font-normal">
              区分亲历知晓与信息差
            </span>
          </div>

          {event.facts.length === 0 ? (
            <p className="text-xs text-muted p-3 bg-surface-sunken rounded border border-hairline">
              本事件未登记独立世界事实项。
            </p>
          ) : (
            <div className="space-y-2">
              {event.facts.map(fact => {
                const knownActors = fact.knownBy.map(kId => lookupActor(actors, kId));
                const unknownParticipants = event.participantIds
                  .filter(pId => !fact.knownBy.includes(pId))
                  .map(pId => lookupActor(actors, pId));

                return (
                  <div
                    key={fact.id}
                    className="p-3.5 rounded-lg bg-surface-sunken/40 border border-hairline space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <SourceNatureBadge nature={fact.nature} />
                      <span className="text-[11px] text-muted font-mono">
                        #{fact.id.slice(0, 8)}
                      </span>
                    </div>

                    <p className="text-ink leading-relaxed font-sans text-[13px]">
                      {fact.content}
                    </p>

                    <div className="pt-2 border-t border-hairline/60 flex flex-wrap items-center gap-3 text-[11px]">
                      <div className="flex items-center gap-1 text-muted">
                        <span className="font-medium text-ink">已知晓角色：</span>
                        {knownActors.length > 0 ? (
                          knownActors.map(a => (
                            <span key={a.id} className="px-1.5 py-0.2 rounded bg-surface text-ink">
                              {a.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted">（仅环境记录，人物不知）</span>
                        )}
                      </div>

                      {unknownParticipants.length > 0 && (
                        <div className="flex items-center gap-1 text-rose-700 dark:text-rose-300">
                          <span className="font-medium">在场但被隐瞒/未察觉：</span>
                          {unknownParticipants.map(a => (
                            <span key={a.id} className="px-1.5 py-0.2 rounded bg-rose-500/10 text-rose-800 dark:text-rose-200">
                              {a.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Character State & Relationship Evolution */}
        <section className="space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-ink">
            <span className="flex items-center gap-1.5">
              <HeartHandshake className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>角色状态与人际关系演进 ({event.stateChanges.length})</span>
            </span>
            <span className="text-[11px] text-muted font-normal">
              心理变化与记忆依据
            </span>
          </div>

          {event.stateChanges.length === 0 ? (
            <p className="text-xs text-muted p-3 bg-surface-sunken rounded border border-hairline">
              本事件未引发持久心理或人际关系状态改变。
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {event.stateChanges.map((st, idx) => {
                const actor = lookupActor(actors, st.actorId);
                const loc = lookupLocation(locations, st.locationId);

                return (
                  <div
                    key={`${st.actorId}-${idx}`}
                    className="p-3.5 rounded-lg bg-surface-sunken/40 border border-hairline space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-ink text-sm">{actor.name}</span>
                      {st.emotion && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-800 dark:text-amber-300 font-medium text-[11px]">
                          情绪：{st.emotion}
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-muted">
                      <span>位于地点：</span>
                      <span className="text-ink font-medium">{loc.name}</span>
                    </div>

                    {st.goals.length > 0 && (
                      <div className="text-[11px]">
                        <span className="text-muted block mb-0.5 font-medium">更新目标：</span>
                        <ul className="list-disc list-inside space-y-0.5 text-ink pl-1">
                          {st.goals.map((g, gIdx) => (
                            <li key={gIdx}>{g}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {st.relationships.length > 0 && (
                      <div className="pt-2 border-t border-hairline/60 space-y-1">
                        <span className="text-[11px] font-medium text-ink block">人际关系更新：</span>
                        {st.relationships.map((rel, rIdx) => {
                          const target = lookupActor(actors, rel.actorId);
                          return (
                            <div
                              key={rIdx}
                              className="text-[11px] bg-surface p-2 rounded border border-hairline space-y-0.5"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-ink">对 {target.name}：</span>
                                {rel.sourceEventId && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => onSelectEvent?.(rel.sourceEventId!)}
                                    className="h-auto min-h-0 gap-0 p-0 font-mono text-[10px] font-normal text-accent hover:bg-transparent hover:text-accent hover:underline sm:min-h-0"
                                  >
                                    记忆来源：事件 #{rel.sourceEventId}
                                  </Button>
                                )}
                              </div>
                              <p className="text-muted leading-relaxed">{rel.description}</p>
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
        </section>

        {/* Phase Storyboard Images Gallery */}
        <section className="space-y-4">
          <div className="flex items-center justify-between text-xs font-semibold text-ink">
            <span className="flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-accent" />
              <span>分镜配图规划与生图状态 ({eventImages.length})</span>
            </span>
            <span className="text-[11px] text-muted font-normal">
              建立 / 行动 / 结果三阶段
            </span>
          </div>

          {eventImages.length === 0 ? (
            <div className="p-4 bg-surface-sunken rounded border border-dashed border-hairline text-center text-xs text-muted">
              当前事件尚未规划图像分镜。
            </div>
          ) : (
            <div className="space-y-4">
              {(['establishing', 'action', 'result'] as const).map(phase => {
                const phaseImgs = phaseGroups[phase];
                const cfg = IMAGE_PHASE_CONFIG[phase];

                return (
                  <div key={phase} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <ImagePhaseBadge phase={phase} />
                      <span className="text-xs text-muted">{cfg.description}</span>
                    </div>

                    {phaseImgs.length === 0 ? (
                      <p className="text-xs text-muted/70 pl-2">本阶段暂无配图规划</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {phaseImgs.map(img => (
                          <div
                            key={img.id}
                            className="flex flex-col bg-surface-sunken/40 rounded-lg border border-hairline p-3 space-y-2.5 text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <ImageStatusBadge status={img.status} />
                              <span className="text-[11px] text-muted font-mono">
                                #{img.id.slice(0, 8)}
                              </span>
                            </div>

                            {img.imageUrl && img.status === 'succeeded' && (
                              <div className="aspect-video rounded overflow-hidden bg-black/10 border border-hairline">
                                <img
                                  src={img.imageUrl}
                                  alt={img.caption || '分镜画面'}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              </div>
                            )}

                            <div>
                              <span className="font-semibold text-ink block mb-0.5">画面构图：</span>
                              <p className="text-muted leading-relaxed">{img.caption || '分镜构图说明'}</p>
                            </div>

                            <details className="text-[11px] text-muted group">
                              <summary className="cursor-pointer hover:text-accent font-medium select-none">
                                高级生成参数与提示词
                              </summary>
                              <div className="mt-1.5 p-2 rounded bg-surface border border-hairline space-y-1 font-mono text-[10.5px]">
                                <p><strong className="text-ink">Prompt:</strong> {img.prompt}</p>
                                {img.negativePrompt && (
                                  <p><strong className="text-ink">Negative:</strong> {img.negativePrompt}</p>
                                )}
                                {img.consistencyNote && (
                                  <p className="text-amber-800 dark:text-amber-300">
                                    <strong className="text-ink">Consistency:</strong> {img.consistencyNote}
                                  </p>
                                )}
                                {img.error && (
                                  <p className="text-danger-fg">
                                    <strong className="text-danger-fg">Error:</strong> {img.error}
                                  </p>
                                )}
                              </div>
                            </details>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
