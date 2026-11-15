'use client';

import React, { useState, useMemo } from 'react';
import {
  Image as ImageIcon,
  Compass,
  Zap,
  Flag,
  Clock,
  MapPin,
  Users,
  ChevronRight,
  Maximize2,
  X,
  AlertCircle,
  FileText,
  Filter,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import type {
  WorldEvent,
  WorldActor,
  WorldLocation,
  WorldImage,
} from '@sthstart/contracts';
import type {
  WorldImageReaderProps,
  ImagePhase,
  WorldImageAdoptInput,
} from './types';
import {
  formatTick,
  formatDuration,
  lookupActor,
  lookupLocation,
  groupImagesForEvents,
  groupImagesByPhase,
  sortEventsChronologically,
  IMAGE_PHASE_CONFIG,
} from './reading-utils';
import {
  ImagePhaseBadge,
  ImageStatusBadge,
} from './badges';
import { Button } from '@/app/components/ui/button';
import { IconButton } from '@/app/components/ui/icon-button';

export function worldImageAdoptInput(
  image: WorldImage,
  event: WorldEvent | undefined,
): WorldImageAdoptInput | null {
  if (!event) return null;
  if (image.eventId !== event.id) return null;
  if (image.branchId && image.branchId !== event.branchId) return null;
  if (!image.artifactId) return null;
  return {
    image,
    event,
    artifactId: image.artifactId,
    disabled: image.status !== 'succeeded',
  };
}

export function WorldImageReader({
  events,
  actors,
  locations,
  images = [],
  actorId: propActorId,
  onSelectEvent,
  selectedEventId,
  adoptAction,
  className = '',
}: WorldImageReaderProps) {
  // Controlled actorId sync with props (undefined = show all)
  const [localActorId, setLocalActorId] = useState<string | undefined>(propActorId);
  const [prevPropActorId, setPrevPropActorId] = useState<string | undefined>(propActorId);

  if (propActorId !== prevPropActorId) {
    setPrevPropActorId(propActorId);
    setLocalActorId(propActorId);
  }

  const effectiveActorId = localActorId;
  const [phaseFilter, setPhaseFilter] = useState<ImagePhase | 'all'>('all');
  const [previewImage, setPreviewImage] = useState<WorldImage | null>(null);
  const previewEvent = previewImage
    ? events.find(event => event.id === previewImage.eventId) ?? null
    : null;
  const previewAdoptInput = previewImage
    ? worldImageAdoptInput(previewImage, previewEvent ?? undefined)
    : null;

  // Group images strictly matching event branchId (reject mismatched branch images)
  const imagesByEvent = useMemo(() => groupImagesForEvents(images, events), [images, events]);

  // Chronologically sorted events
  const sortedEvents = useMemo(() => sortEventsChronologically(events), [events]);

  // Filter events by effective actor
  const visibleEvents = useMemo(() => {
    if (!effectiveActorId) return sortedEvents;
    return sortedEvents.filter(
      ev =>
        ev.participantIds.includes(effectiveActorId) ||
        ev.perspectives.some(p => p.actorId === effectiveActorId)
    );
  }, [sortedEvents, effectiveActorId]);

  // Aggregate stats across all provided images
  const stats = useMemo(() => {
    const total = images.length;
    const succeeded = images.filter(i => i.status === 'succeeded').length;
    const queuedOrRunning = images.filter(i => i.status === 'queued' || i.status === 'running').length;
    const planned = images.filter(i => i.status === 'planned').length;
    const failedOrStale = images.filter(i => i.status === 'failed' || i.status === 'stale' || i.status === 'uncertain').length;
    return { total, succeeded, queuedOrRunning, planned, failedOrStale };
  }, [images]);

  return (
    <div className={`flex flex-col w-full min-w-0 space-y-6 ${className}`}>
      {/* Top Filter and Stats Bar (Sans-serif UI) */}
      <div className="flex flex-col gap-3 p-4 bg-surface rounded-[var(--radius-panel)] border border-hairline shadow-xs font-sans">
        {/* Character Navigation Pills */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 scrollbar-none min-w-0">
            <span className="text-xs font-semibold text-muted shrink-0 flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              <span>筛选角色：</span>
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setLocalActorId(undefined)}
              aria-pressed={!effectiveActorId}
              className="ui-choice h-auto min-h-0 shrink-0 rounded-full bg-surface-sunken px-3 py-1 text-xs font-medium text-muted hover:bg-surface-raised hover:text-ink sm:min-h-0"
            >
              全部事件 ({sortedEvents.length})
            </Button>
            {actors.map(actor => {
              const isSelected = effectiveActorId === actor.id;
              const count = sortedEvents.filter(e => e.participantIds.includes(actor.id)).length;
              return (
                <Button
                  key={actor.id}
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setLocalActorId(isSelected ? undefined : actor.id)}
                  aria-pressed={isSelected}
                  className="ui-choice h-auto min-h-0 shrink-0 rounded-full bg-surface-sunken px-3 py-1 text-xs font-medium text-muted hover:bg-surface-raised hover:text-ink sm:min-h-0 [&_.ui-mantine-button-label]:gap-1.5"
                >
                  <span>{actor.name}</span>
                  <span className="rounded-full bg-ink/5 px-1 text-[10px]">
                    {count}
                  </span>
                </Button>
              );
            })}
          </div>

          {/* Phase Filter Tabs */}
          <div className="flex items-center gap-1 bg-surface-sunken p-1 rounded-lg text-xs shrink-0">
            <span className="text-[11px] text-muted px-1.5 font-medium flex items-center gap-1">
              <Filter className="w-3 h-3" />
              <span>分镜阶段：</span>
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPhaseFilter('all')}
              aria-pressed={phaseFilter === 'all'}
              className="ui-choice h-auto min-h-0 rounded px-2 py-0.5 text-xs font-medium text-muted hover:text-ink sm:min-h-0"
            >
              全部三幕
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPhaseFilter('establishing')}
              aria-pressed={phaseFilter === 'establishing'}
              className="ui-choice h-auto min-h-0 rounded px-2 py-0.5 text-xs font-medium text-muted hover:text-ink sm:min-h-0"
            >
              建立
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPhaseFilter('action')}
              aria-pressed={phaseFilter === 'action'}
              className="ui-choice h-auto min-h-0 rounded px-2 py-0.5 text-xs font-medium text-muted hover:text-ink sm:min-h-0"
            >
              行动
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPhaseFilter('result')}
              aria-pressed={phaseFilter === 'result'}
              className="ui-choice h-auto min-h-0 rounded px-2 py-0.5 text-xs font-medium text-muted hover:text-ink sm:min-h-0"
            >
              结果
            </Button>
          </div>
        </div>

        {/* Global Image Status Summary Badges */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-hairline text-xs text-muted">
          <span className="flex items-center gap-1">
            <ImageIcon className="w-3.5 h-3.5 text-muted" />
            <span>规划配图总计: <strong className="text-ink">{stats.total}</strong></span>
          </span>
          <span className="inline-flex items-center gap-1 text-success-fg">
            <CheckCircle2 className="w-3 h-3 text-success" />
            <span>已生成: {stats.succeeded}</span>
          </span>
          {stats.queuedOrRunning > 0 && (
            <span className="inline-flex items-center gap-1 text-warning-fg">
              <Clock className="w-3 h-3 text-warning" />
              <span>调度中: {stats.queuedOrRunning}</span>
            </span>
          )}
          {stats.planned > 0 && (
            <span className="inline-flex items-center gap-1 text-muted">
              <span>待提交: {stats.planned}</span>
            </span>
          )}
          {stats.failedOrStale > 0 && (
            <span className="inline-flex items-center gap-1 text-danger-fg">
              <AlertCircle className="w-3 h-3 text-danger" />
              <span>失败/待重做: {stats.failedOrStale}</span>
            </span>
          )}
        </div>
      </div>

      {/* Main Image Narrative Stream */}
      {visibleEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center bg-surface rounded-[var(--radius-panel)] border border-hairline font-sans">
          <ImageIcon className="w-10 h-10 text-muted mb-3 opacity-60" />
          <h3 className="text-sm font-semibold text-ink">当前筛选无对应图像分镜</h3>
          <p className="text-xs text-muted mt-1 max-w-sm">
            该角色或分支暂无匹配的故事事件画面。
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {visibleEvents.map((ev, evIdx) => {
            const location = lookupLocation(locations, ev.locationId);
            const isSelected = selectedEventId === ev.id;
            const eventImages = imagesByEvent.get(ev.id) || [];
            const phaseGroups = groupImagesByPhase(eventImages);

            return (
              <section
                key={ev.id}
                id={`image-event-${ev.id}`}
                className={`bg-surface rounded-[var(--radius-panel)] border transition-all duration-200 overflow-hidden ${
                  isSelected
                    ? 'border-accent shadow-md ring-1 ring-accent/30'
                    : 'border-hairline shadow-xs hover:border-border-default/60'
                }`}
              >
                {/* Event Ribbon Header */}
                <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-surface-sunken/40 border-b border-hairline font-sans">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 font-semibold text-ink bg-surface px-2.5 py-0.5 rounded border border-hairline">
                      <Clock className="w-3 h-3 text-muted" />
                      <span>{formatTick(ev.tick)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-muted bg-surface px-2 py-0.5 rounded border border-hairline">
                      <MapPin className="w-3 h-3 text-muted" />
                      <span className="font-medium text-ink">{location.name}</span>
                    </span>
                    {ev.duration > 0 && formatDuration(ev.duration) ? (
                      <span className="text-muted text-[11px]">
                        {formatDuration(ev.duration)}
                      </span>
                    ) : null}
                  </div>

                  {onSelectEvent && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onSelectEvent(ev.id)}
                      className="gap-1 px-2 text-xs font-medium text-muted hover:text-accent"
                    >
                      <span>查看档案</span>
                      <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </header>

                <div className="p-4 md:p-6 space-y-6">
                  {/* Event Title */}
                  <div className="font-sans">
                    <h2 className="text-lg md:text-xl font-semibold text-ink tracking-tight">
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
                    <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs text-muted">
                      <span>出场：</span>
                      {ev.participantIds.map(pId => (
                        <span
                          key={pId}
                          className="px-2 py-0.2 rounded-full bg-surface-sunken text-ink text-[11px]"
                        >
                          {lookupActor(actors, pId).name}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* 3-PHASE VISUAL NARRATIVE GRID (Scene Establishing -> Action -> Result) */}
                  <div className="space-y-2 font-sans">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span className="font-semibold text-ink flex items-center gap-1.5">
                        <ImageIcon className="w-3.5 h-3.5 text-accent" />
                        <span>三阶段分镜叙事（建立 → 行动 → 结果）</span>
                      </span>
                      <span className="text-[11px]">图像按场景脉络展开，不阻塞文字正文</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Phase 1: Establishing */}
                      {(phaseFilter === 'all' || phaseFilter === 'establishing') && (
                        <PhaseColumn
                          phase="establishing"
                          images={phaseGroups.establishing}
                          onPreview={setPreviewImage}
                          event={ev}
                          adoptAction={adoptAction}
                        />
                      )}

                      {/* Phase 2: Action */}
                      {(phaseFilter === 'all' || phaseFilter === 'action') && (
                        <PhaseColumn
                          phase="action"
                          images={phaseGroups.action}
                          onPreview={setPreviewImage}
                          event={ev}
                          adoptAction={adoptAction}
                        />
                      )}

                      {/* Phase 3: Result */}
                      {(phaseFilter === 'all' || phaseFilter === 'result') && (
                        <PhaseColumn
                          phase="result"
                          images={phaseGroups.result}
                          onPreview={setPreviewImage}
                          event={ev}
                          adoptAction={adoptAction}
                        />
                      )}
                    </div>
                  </div>

                  {/* READABLE STORY PROSE (SERIF FOR PROSE ONLY, NEVER BLOCKED BY IMAGES) */}
                  <div className="pt-4 border-t border-hairline">
                    <div className="flex items-center gap-1.5 text-xs text-muted font-sans mb-2">
                      <FileText className="w-3.5 h-3.5 text-muted" />
                      <span className="font-semibold text-ink">事件文字记录</span>
                    </div>

                    <div
                      className="story-reading-content font-serif text-[16px] leading-[1.8] text-ink break-words text-pretty bg-surface-sunken/30 p-4 rounded-[var(--radius-panel)] border border-hairline"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      {ev.summary.split('\n\n').map((paragraph, pIdx) => {
                        const trimmed = paragraph.trim();
                        if (!trimmed) return null;
                        return (
                          <p key={pIdx} className="my-2 text-justify">
                            {trimmed}
                          </p>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Lightbox / Image Detail Modal */}
      {previewImage && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-w-3xl w-full bg-surface rounded-[var(--radius-dialog)] border border-hairline shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-hairline">
              <div className="flex items-center gap-2">
                <ImagePhaseBadge phase={previewImage.phase} />
                <ImageStatusBadge status={previewImage.status} />
                <span className="text-xs text-muted">ID: {previewImage.id.slice(0, 10)}</span>
              </div>
              <IconButton
                icon={X}
                label="关闭"
                variant="ghost"
                className="text-muted hover:text-ink"
                onClick={() => setPreviewImage(null)}
              />
            </div>

            {/* Large Image Preview if available */}
            {previewImage.imageUrl && previewImage.status === 'succeeded' ? (
              <div className="relative rounded-lg overflow-hidden bg-black/10 border border-hairline max-h-[50vh] flex items-center justify-center">
                <img
                  src={previewImage.imageUrl}
                  alt={previewImage.caption || '分镜原图'}
                  className="max-h-[50vh] w-auto object-contain"
                />
              </div>
            ) : (
              <div className="p-8 rounded-lg bg-surface-sunken border border-dashed border-hairline text-center text-xs text-muted">
                当前分镜状态为：<strong className="text-ink">{previewImage.status}</strong>，暂未生成图像文件。
              </div>
            )}

            {/* Human-Readable Story Description First */}
            <div className="space-y-3 text-xs font-sans">
              {previewEvent && (
                <div className="rounded border border-hairline bg-surface-sunken/50 p-2.5 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink">来源事件</span>
                    <span className="text-[11px] text-muted">{formatTick(previewEvent.tick)}</span>
                  </div>
                  <p className="font-medium text-ink">{previewEvent.title}</p>
                  <p className="text-[11px] text-muted">
                    {lookupLocation(locations, previewEvent.locationId).name}
                    {' · '}
                    {previewEvent.participantIds.map(id => lookupActor(actors, id).name).join('、')}
                  </p>
                  {previewEvent.summary && (
                    <p className="line-clamp-3 leading-relaxed text-muted">{previewEvent.summary}</p>
                  )}
                  {onSelectEvent && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-auto min-h-0 px-0 text-[11px] font-medium text-accent hover:bg-transparent sm:min-h-0"
                      onClick={() => {
                        setPreviewImage(null);
                        onSelectEvent(previewEvent.id);
                      }}
                    >
                      查看事件档案
                      <ChevronRight className="w-3 h-3" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              )}
              {adoptAction && (
                <div className="rounded border border-hairline bg-surface p-2.5 space-y-1.5">
                  <span className="font-semibold text-ink">加入创作项目</span>
                  {previewAdoptInput ? (
                    <>
                      {adoptAction(previewAdoptInput)}
                      <p className="text-[11px] leading-relaxed text-muted">
                        只引用现有媒体文件并保留来源；不会复制图片或改写世界事件。
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] leading-relaxed text-muted">
                      {previewImage.artifactId
                        ? '该分镜尚未成功生成文件，暂时不能加入项目。'
                        : '该分镜还没有可引用的媒体文件。'}
                    </p>
                  )}
                </div>
              )}
              <div>
                <span className="font-semibold text-ink block mb-1">分镜叙事画面：</span>
                <p className="text-ink bg-surface-sunken p-2.5 rounded border border-hairline leading-relaxed">
                  {previewImage.caption || '分镜规划画面'}
                </p>
              </div>

              {/* Folded Technical Configuration (Prompt, Negative, Consistency, Error) */}
              <details className="pt-2 border-t border-hairline font-sans group">
                <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-accent select-none">
                  高级生成配置（提示词与模型任务参数）
                </summary>
                <div className="mt-2 space-y-2.5 pt-1">
                  <div>
                    <span className="font-medium text-ink block mb-0.5 font-mono text-[11px]">Prompt:</span>
                    <pre className="text-muted bg-surface-sunken p-2 rounded border border-hairline text-[11px] whitespace-pre-wrap font-mono">
                      {previewImage.prompt}
                    </pre>
                  </div>

                  {previewImage.negativePrompt && (
                    <div>
                      <span className="font-medium text-ink block mb-0.5 font-mono text-[11px]">Negative Prompt:</span>
                      <pre className="text-muted bg-surface-sunken p-2 rounded border border-hairline text-[11px] whitespace-pre-wrap font-mono">
                        {previewImage.negativePrompt}
                      </pre>
                    </div>
                  )}

                  {previewImage.consistencyNote && (
                    <div>
                      <span className="font-medium text-amber-800 dark:text-amber-300 block mb-0.5">一致性约束提示：</span>
                      <p className="text-muted bg-amber-500/5 p-2 rounded border border-amber-500/20 text-amber-900 dark:text-amber-200">
                        {previewImage.consistencyNote}
                      </p>
                    </div>
                  )}

                  {previewImage.error && (
                    <div>
                      <span className="font-medium text-danger-fg block mb-0.5">错误诊断信息：</span>
                      <pre className="text-danger-fg bg-danger/10 p-2 rounded border border-danger/20 text-[11px] whitespace-pre-wrap font-mono">
                        {previewImage.error}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Single column for one phase in the 3-phase storyboard.
 */
function PhaseColumn({
  phase,
  images,
  onPreview,
  event,
  adoptAction,
}: {
  phase: ImagePhase;
  images: WorldImage[];
  onPreview: (img: WorldImage) => void;
  event: WorldEvent;
  adoptAction?: WorldImageReaderProps['adoptAction'];
}) {
  const cfg = IMAGE_PHASE_CONFIG[phase];

  return (
    <div className="flex flex-col rounded-lg bg-surface-sunken/40 border border-hairline p-3 space-y-3 font-sans">
      {/* Phase Column Header */}
      <div className="flex items-center justify-between gap-1 pb-2 border-b border-hairline">
        <div className="flex items-center gap-1.5">
          <ImagePhaseBadge phase={phase} />
        </div>
        <span className="text-[11px] text-muted font-mono">{images.length} 帧</span>
      </div>

      {/* Images or Empty Slot */}
      {images.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-6 rounded bg-surface border border-dashed border-hairline/80 text-center min-h-[140px]">
          <span className="text-xs text-muted font-medium">无{cfg.label}分镜</span>
          <span className="text-[10px] text-muted mt-1 leading-snug">{cfg.description}</span>
        </div>
      ) : (
        <div className="space-y-3">
          {images.map(img => (
            <ImageCard
              key={img.id}
              image={img}
              onPreview={() => onPreview(img)}
              adoptAction={adoptAction}
              event={event}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Individual Image Card inside a Phase Column.
 * Truthfully handles planned, queued, running, succeeded, failed, uncertain, stale.
 */
function ImageCard({
  image,
  onPreview,
  event,
  adoptAction,
}: {
  image: WorldImage;
  onPreview: () => void;
  event: WorldEvent;
  adoptAction?: WorldImageReaderProps['adoptAction'];
}) {
  const adoptInput = worldImageAdoptInput(image, event);
  return (
    <div
      onClick={onPreview}
      className="group relative flex flex-col bg-surface rounded-[var(--radius-control)] border border-hairline hover:border-accent/50 shadow-xs hover:shadow-sm transition-all duration-150 cursor-pointer overflow-hidden p-2.5 space-y-2"
    >
      {/* Status & Action Bar */}
      <div className="flex items-center justify-between gap-1">
        <ImageStatusBadge status={image.status} />
        <IconButton
          icon={Maximize2}
          label="放大查看提示词与原画"
          variant="ghost"
          iconClassName="h-3.5 w-3.5"
          className="text-muted hover:text-accent"
          onClick={e => {
            e.stopPropagation();
            onPreview();
          }}
        />
      </div>

      {/* Visual Render or Status Representation */}
      {image.status === 'succeeded' && image.imageUrl ? (
        <div className="relative aspect-video rounded overflow-hidden bg-black/5">
          <img
            src={image.imageUrl}
            alt={image.caption || '分镜图'}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        </div>
      ) : image.status === 'running' ? (
        <div className="aspect-video rounded bg-surface-sunken border border-success/30 flex flex-col items-center justify-center p-3 text-center space-y-1.5 animate-pulse">
          <Clock className="w-5 h-5 text-success animate-spin" />
          <span className="text-xs font-semibold text-success-fg">正在渲染画面...</span>
          <span className="text-[10px] text-muted line-clamp-1">{image.caption || '分镜渲染中'}</span>
        </div>
      ) : image.status === 'queued' ? (
        <div className="aspect-video rounded bg-surface-sunken border border-warning/30 flex flex-col items-center justify-center p-3 text-center space-y-1">
          <Clock className="w-5 h-5 text-warning-fg" />
          <span className="text-xs font-semibold text-warning-fg">排队调度中</span>
          <span className="text-[10px] text-muted">等待公共生图名额</span>
        </div>
      ) : image.status === 'failed' ? (
        <div className="aspect-video rounded bg-danger/5 border border-danger/20 flex flex-col items-center justify-center p-3 text-center space-y-1">
          <AlertCircle className="w-5 h-5 text-danger-fg" />
          <span className="text-xs font-semibold text-danger-fg">生成失败</span>
          <span className="text-[10px] text-danger-fg/80 line-clamp-2">
            {image.error || '生成接口异常'}
          </span>
        </div>
      ) : image.status === 'uncertain' ? (
        <div className="aspect-video rounded bg-warning/5 border border-warning/20 flex flex-col items-center justify-center p-3 text-center space-y-1">
          <AlertCircle className="w-5 h-5 text-warning-fg" />
          <span className="text-xs font-semibold text-warning-fg">状态待核对</span>
          <span className="text-[10px] text-muted">外部任务未明确返回</span>
        </div>
      ) : image.status === 'stale' ? (
        <div className="aspect-video rounded bg-surface-sunken border border-hairline flex flex-col items-center justify-center p-3 text-center space-y-1">
          <RefreshCw className="w-5 h-5 text-muted" />
          <span className="text-xs font-semibold text-muted">待按新设定重做</span>
          <span className="text-[10px] text-muted">事件已演进</span>
        </div>
      ) : (
        /* planned status */
        <div className="aspect-video rounded bg-surface-sunken/60 border border-dashed border-hairline flex flex-col items-center justify-center p-3 text-center space-y-1">
          <ImageIcon className="w-5 h-5 text-muted/60" />
          <span className="text-xs font-medium text-muted">分镜已规划（未生成）</span>
          <span className="text-[10px] text-muted line-clamp-1">{image.caption || '待调度生图'}</span>
        </div>
      )}

      {/* Caption snippet - Reader-First */}
      <div className="text-xs">
        <p className="font-medium text-ink line-clamp-1 group-hover:text-accent transition-colors">
          {image.caption || '分镜画面'}
        </p>
        <p className="text-[11px] text-muted line-clamp-1 mt-0.5 leading-snug">
          {IMAGE_PHASE_CONFIG[image.phase]?.label} · 点击展开详情
        </p>
      </div>
      {adoptAction && (
        <div
          className="pt-1 border-t border-hairline/70"
          onClick={eventStop => eventStop.stopPropagation()}
        >
          {adoptInput
            ? adoptAction(adoptInput)
            : (
              <p className="text-[11px] leading-snug text-muted">
                {image.artifactId ? '该分镜尚未生成文件，暂时不能加入项目。' : '该分镜还没有可引用的媒体文件。'}
              </p>
            )}
        </div>
      )}
    </div>
  );
}
