'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMediaQuery } from '@mantine/hooks';
import {
  ArrowLeftRight,
  BookOpen,
  Brain,
  Camera,
  Clock3,
  Film,
  GitBranch,
  Globe2,
  Image as ImageIcon,
  Layers,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Wand2,
} from 'lucide-react';
import type {
  ProviderProfile,
  WorldActor,
  WorldAdoptionResult,
  WorldBranch,
  WorldEvent,
  WorldImage,
  WorldIntervention,
  WorldLocation,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { AsyncState } from '@/app/components/ui/async-state';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { useQuery } from '@tanstack/react-query';
import { fetchWorldSetups, pendingWorldsKey } from './authoring/setup-api';
import { Drawer } from '@/app/components/ui/drawer';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Input } from '@/app/components/ui/input';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { RowActionsMenu } from '@/app/components/ui/row-actions-menu';
import { Select } from '@/app/components/ui/select';
import { WorkspaceShell } from '@/app/components/shared/page-layout';
import { WorkspaceHeader } from '@/app/components/shared/workspace-header';
import { usePublicOverview } from '@/app/features/public-services/queries';
import { useToast } from '@/app/providers/ui-provider';
import StoryWorldFlow from './flow';
import {
  WorldBranchComparison,
  WorldEventDetail,
  WorldImageReader,
  WorldReader,
} from './reading';
import type { WorldImageAdoptAction } from './reading';
import {
  isRunActive,
  useStoryWorldOverview,
  useStoryWorlds,
  useWorldBranchDetail,
  useWorldEventPages,
  useWorldMemories,
  useWorldComparisonBranch,
} from './queries';
import { useWorkbenchUrl } from './hooks/use-workbench-url';
import { useStoryWorldActions } from './hooks/use-story-world-actions';
import { useModelRoutingOptions } from './hooks/use-external-options';
import { SourceUpdatePreview } from './components/source-update-preview';
import {
  BRANCH_MODE_META,
  IMAGE_PHASE_META,
  IMAGE_STATUS_META,
  INTERVENTION_KIND_META,
  SOURCE_NATURE_META,
  bucketHeights,
  branchModeLabel,
  defaultWindow,
  describeError,
  formatQuota,
  formatTick,
  formatWindow,
  imageStatusTone,
  mergeEventPages,
  modelCatalog,
  runStatusLabel,
  runStatusTone,
  sourceNatureTone,
} from './hooks/world-format';
import { BranchForm } from './forms/branch-form';
import { RunForm } from './forms/run-form';
import { InterventionForm } from './forms/intervention-form';
import { StoryLineForm } from './forms/story-line-form';
import { AdoptForm } from './forms/adopt-form';
import { ImagePlanForm, ImageSubmitForm } from './forms/image-forms';
import { ActorPromoteForm } from './forms/actor-promote-form';
import { RunRecoveryDialog } from './forms/run-recovery-dialog';
import { GenerationRecoveryDialog } from './forms/generation-recovery-dialog';
import './story-worlds.css';

const MEMORY_KIND_LABELS = {
  experienced: '亲历',
  heard: '听说',
  inferred: '推测',
  mistaken: '误解',
} as const;

function WorldFilterRail({ narrow, open, onOpenChange, children }: {
  narrow: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  if (narrow) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} title="世界与筛选" position="bottom">
        <div className="sw-filter-content">{children}</div>
      </Drawer>
    );
  }

  return (
    <aside className="sw-rail sw-rail-left" aria-label="世界与筛选">
      <div className="sw-filter-content sw-rail-scroll">{children}</div>
    </aside>
  );
}

function actorLocation(actor: WorldActor, locations: WorldLocation[], stateLocationId?: string) {
  const locationId = stateLocationId || actor.locationId;
  return locations.find((location) => location.id === locationId)?.name ?? '未设地点';
}

function locationName(locations: WorldLocation[], locationId: string) {
  return locations.find((location) => location.id === locationId)?.name ?? locationId;
}

function participantNames(actors: WorldActor[], participantIds: string[]) {
  return participantIds
    .map((id) => actors.find((actor) => actor.id === id)?.name)
    .filter((name): name is string => Boolean(name));
}

interface EventListPanelProps {
  events: WorldEvent[];
  actors: WorldActor[];
  locations: WorldLocation[];
  selectedEventId: string;
  onSelectEvent: (eventId: string) => void;
  total: number;
  interventions: WorldIntervention[];
  onAddIntervention: () => void;
}

function EventListPanel({
  events,
  actors,
  locations,
  selectedEventId,
  onSelectEvent,
  total,
  interventions,
  onAddIntervention,
}: EventListPanelProps) {
  const pending = interventions.filter((intervention) => !intervention.consumed);
  return (
    <div className="space-y-5">
      <section>
        <div className="sw-section-head">
          <h2>事件</h2>
          <span>{events.length} / {total || events.length}</span>
        </div>
        {events.length === 0 ? (
          <EmptyState
            icon={Clock3}
            title="当前时间窗口没有事件"
            description="调整时间范围、人物或故事线筛选，或者先启动运行。"
          />
        ) : (
          <div className="sw-event-list">
            {events.map((event) => (
              <button
                key={event.id}
                type="button"
                className="sw-event-row ui-choice"
                aria-pressed={event.id === selectedEventId}
                onClick={() => onSelectEvent(event.id)}
              >
                <span className="sw-event-tick">{formatTick(event.tick)}</span>
                <span className="sw-event-title text-ink">{event.title}</span>
                <span className="sw-event-meta text-muted">
                  {locationName(locations, event.locationId)}
                  {event.participantIds.length > 0 && (
                    <> · {participantNames(actors, event.participantIds).join('、') || `${event.participantIds.length} 人`}</>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      <section>
        <div className="sw-section-head">
          <h2>导演干预</h2>
          <Button size="sm" variant="ghost" onClick={onAddIntervention}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            添加
          </Button>
        </div>
        {pending.length === 0 ? (
          <p className="text-sm leading-relaxed text-muted">没有待生效干预。</p>
        ) : (
          <div className="space-y-2">
            {pending.map((intervention) => (
              <div key={intervention.id} className="rounded-control bg-surface-sunken/40 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge variant="outline">{INTERVENTION_KIND_META[intervention.kind].label}</Badge>
                  <span>{formatTick(intervention.tick)}</span>
                </div>
                <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-ink">{intervention.instruction}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

interface EventImageCardProps {
  image: WorldImage;
  onPrepareSubmit: (image: WorldImage) => void;
}

function EventImageCard({ image, onPrepareSubmit }: EventImageCardProps) {
  const url = image.imageUrl || (image.artifactId ? `/api/admin/artifacts/${encodeURIComponent(image.artifactId)}/file` : '');
  return (
    <div className="sw-image-card">
      {url ? (
        <img src={url} alt={image.caption || '故事配图'} className="sw-image-thumb" loading="lazy" />
      ) : (
        <div className="sw-image-placeholder">
          <ImageIcon className="h-5 w-5" aria-hidden="true" />
          <span>{IMAGE_PHASE_META[image.phase].label}</span>
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={imageStatusTone(image.status)}>{IMAGE_STATUS_META[image.status].label}</Badge>
          <Badge variant="outline">{IMAGE_PHASE_META[image.phase].label}</Badge>
        </div>
        <p className="text-sm font-medium text-ink">{image.caption || '未填写画面说明'}</p>
        {image.consistencyNote && <p className="text-xs leading-relaxed text-warning-fg">{image.consistencyNote}</p>}
        {image.error && <p className="text-xs leading-relaxed text-danger-fg">{image.error}</p>}
        <details className="sw-prompt">
          <summary>查看提示词</summary>
          <p>{image.prompt}</p>
          {image.negativePrompt && <p className="text-muted">负面：{image.negativePrompt}</p>}
        </details>
        {(image.status === 'planned' || image.status === 'failed' || image.status === 'stale') && (
          <Button size="sm" variant="secondary" onClick={() => onPrepareSubmit(image)}>
            <Wand2 className="h-4 w-4" aria-hidden="true" />
            提交生成
          </Button>
        )}
        {image.status === 'queued' && <p className="text-xs text-muted">排队中；不阻塞故事阅读。</p>}
        {image.status === 'running' && <p className="text-xs text-muted">生成中；不阻塞故事阅读。</p>}
        {image.status === 'uncertain' && <p className="text-xs text-warning-fg">结果不明；服务核对前不会重复提交。</p>}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-accent hover:underline"
          >
            打开图片
          </a>
        )}
      </div>
    </div>
  );
}

interface EventPanelProps {
  event: WorldEvent;
  actors: WorldActor[];
  locations: WorldLocation[];
  images: WorldImage[];
  onClose?: () => void;
  onAddIntervention: () => void;
  onPlanImages: () => void;
  onAdopt: () => void;
  onPrepareSubmit: (image: WorldImage) => void;
}

function EventPanel({
  event,
  actors,
  locations,
  images,
  onClose,
  onAddIntervention,
  onPlanImages,
  onAdopt,
  onPrepareSubmit,
}: EventPanelProps) {
  const eventImages = images.filter((image) => image.eventId === event.id);
  return (
    <div className="space-y-5">
      <div className="sw-panel-actions">
        <Button size="sm" variant="secondary" onClick={onAddIntervention}>
          <Wand2 className="h-4 w-4" aria-hidden="true" />
          导演干预
        </Button>
        <Button size="sm" variant="secondary" onClick={onPlanImages}>
          <Camera className="h-4 w-4" aria-hidden="true" />
          规划配图
        </Button>
        <Button size="sm" variant="secondary" onClick={onAdopt}>
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          采纳
        </Button>
      </div>
      <WorldEventDetail
        event={event}
        actors={actors}
        locations={locations}
        images={eventImages}
        onClose={onClose}
      />
      <section>
        <div className="sw-section-head">
          <h2>配图</h2>
          <span>{eventImages.length} 幅</span>
        </div>
        {eventImages.length === 0 ? (
          <p className="text-sm leading-relaxed text-muted">
            还没有配图。规划后可以逐幅提交；图片延迟不会阻塞阅读。
          </p>
        ) : (
          <div className="space-y-3">
            {eventImages.map((image) => (
              <EventImageCard key={image.id} image={image} onPrepareSubmit={onPrepareSubmit} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

interface BranchComparisonDialogProps {
  worldId: string;
  branches: WorldBranch[];
  initialLeftId: string;
  actors: WorldActor[];
  locations: WorldLocation[];
  onClose: () => void;
}

function BranchComparisonDialog({
  worldId,
  branches,
  initialLeftId,
  actors,
  locations,
  onClose,
}: BranchComparisonDialogProps) {
  const defaultLeft = branches.find((branch) => branch.id === initialLeftId) ?? branches[0];
  const [leftId, setLeftId] = useState(defaultLeft?.id ?? '');
  const [rightId, setRightId] = useState(
    branches.find((branch) => branch.id !== defaultLeft?.id)?.id ?? '',
  );
  const left = branches.find((branch) => branch.id === leftId);
  const right = branches.find((branch) => branch.id === rightId);
  const leftQuery = useWorldComparisonBranch(worldId, left, Boolean(left));
  const rightQuery = useWorldComparisonBranch(worldId, right, Boolean(right));
  const same = Boolean(left && right && left.id === right.id);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="并排比较分支"
      description="各自读取独立事件；只做比较，不自动合并。"
      size="lg"
      className="max-w-5xl"
    >
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select aria-label="左侧分支" value={leftId} onChange={(event) => setLeftId(event.target.value)}>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.title}</option>
            ))}
          </Select>
          <Select aria-label="右侧分支" value={rightId} onChange={(event) => setRightId(event.target.value)}>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.title}</option>
            ))}
          </Select>
        </div>
        {same && <Alert variant="warning" title="请选择两个不同分支">当前两侧选择了同一条分支。</Alert>}
        {!same && (leftQuery.isError || rightQuery.isError) && (
          <Alert variant="danger" title="分支事件读取失败">
            {describeError(leftQuery.error ?? rightQuery.error)}
          </Alert>
        )}
        {!same && (leftQuery.isLoading || rightQuery.isLoading) && (
          <AsyncState status="loading" rows={4} />
        )}
        {!same && left && right && leftQuery.data && rightQuery.data && (
          <div className="min-h-0 flex-1 overflow-auto" data-autohide-scroll>
            {(leftQuery.data.truncated || rightQuery.data.truncated) && (
              <Alert variant="info" className="mb-3">
                比较视图最多加载每侧 1000 条事件；当前显示的是已加载部分。
              </Alert>
            )}
            <WorldBranchComparison
              left={{ branch: left, events: leftQuery.data.items }}
              right={{ branch: right, events: rightQuery.data.items }}
              actors={actors}
              locations={locations}
            />
          </div>
        )}
    </Dialog>
  );
}

function MemoryDrawer({
  actor,
  worldId,
  branchId,
  state,
  locations,
  events,
  onSelectEvent,
  onClose,
}: {
  actor: WorldActor | null;
  worldId: string;
  branchId: string;
  state: { locationId: string; emotion: string; goals: string[] } | undefined;
  locations: WorldLocation[];
  events: WorldEvent[];
  onSelectEvent: (eventId: string) => void;
  onClose: () => void;
}) {
  const memories = useWorldMemories(worldId, branchId, actor?.id, Boolean(actor));
  return (
    <Drawer
      open={Boolean(actor)}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={actor ? `记忆 · ${actor.name}` : '人物记忆'}
      description="人物只依据自己获知的信息行动；记忆会保留来源事件和获知时间。"
      position="right"
    >
      {actor && (
        <div className="space-y-5">
          <div className="rounded-control bg-surface-sunken/45 px-4 py-3 text-sm leading-relaxed text-muted">
            <p>当前地点：{locationName(locations, state?.locationId ?? actor.locationId)}</p>
            {state?.emotion && <p>当前情绪：{state.emotion}</p>}
            {state?.goals?.length ? <p>当前目标：{state.goals.join('；')}</p> : null}
          </div>
          {memories.isError && (
            <Alert variant="danger" title="记忆读取失败">{describeError(memories.error)}</Alert>
          )}
          {memories.isLoading && <p className="text-sm text-muted">正在读取记忆…</p>}
          {!memories.isLoading && !memories.isError && (memories.data?.items.length ?? 0) === 0 && (
            <EmptyState icon={Brain} title="还没有记忆" description="运行推进后，人物会在这里留下亲历、听说、推测或误解。" />
          )}
          <div className="space-y-3">
            {(memories.data?.items ?? [])
              .slice()
              .sort((left, right) => left.learnedAt - right.learnedAt)
              .map((memory) => {
                const source = events.find((event) => event.id === memory.sourceEventId);
                return (
                  <div key={memory.id} className="rounded-control bg-surface-sunken/40 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Badge variant={memory.kind === 'mistaken' ? 'warning' : 'outline'}>
                        {MEMORY_KIND_LABELS[memory.kind]}
                      </Badge>
                      <span>{formatTick(memory.learnedAt)}</span>
                      {memory.fromActorId && (
                        <span>来自 {memory.fromActorId}</span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink">{memory.content}</p>
                    {source ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="mt-2 h-auto min-h-0 justify-start px-0 py-0 text-xs font-medium text-accent hover:bg-transparent hover:text-accent hover:underline sm:min-h-0"
                        onClick={() => onSelectEvent(source.id)}
                      >
                        定位来源事件：{source.title}
                      </Button>
                    ) : (
                      <p className="mt-2 text-xs text-muted">来源事件不在当前时间窗口。</p>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </Drawer>
  );
}

export function StoryWorldsWorkspace({ imageAdoptAction }: { imageAdoptAction?: WorldImageAdoptAction } = {}) {
  const narrow = useMediaQuery('(max-width: 1151px)', false);
  const router = useRouter();
  const toast = useToast();
  const actions = useStoryWorldActions();
  const publicOverview = usePublicOverview();
  const profiles = (publicOverview.data?.profiles ?? []) as ProviderProfile[];
  const modelRouting = useModelRoutingOptions();
  const models = modelCatalog(profiles, modelRouting.data?.models ?? []);
  const worldsQuery = useStoryWorlds();
  const worlds = worldsQuery.data?.items ?? [];
  const pendingQuery = useQuery({ queryKey: pendingWorldsKey, queryFn: fetchWorldSetups, staleTime: 10_000, retry: false });
  const pendingWorlds = (pendingQuery.data?.items ?? []).filter((item) => !worlds.some((world) => world.id === item.id));
  const worldChoices = [...worlds, ...pendingWorlds];
  const searchParams = useSearchParams();
  const searchParamsWorld = searchParams.get('world')?.trim() ?? '';
  const provisionalWorldId = worldChoices.some((item) => item.id === searchParamsWorld)
    ? searchParamsWorld
    : worldChoices[0]?.id ?? '';
  const pendingWorld = pendingWorlds.find((item) => item.id === provisionalWorldId);
  const overviewQuery = useStoryWorldOverview(pendingWorld ? undefined : provisionalWorldId || undefined);
  const branches = pendingWorld ? [] : overviewQuery.data?.branches ?? [];
  const url = useWorkbenchUrl(worldsQuery.isLoading || pendingQuery.isLoading ? [] : worldChoices, branches);
  const world = overviewQuery.data?.world
    ?? worlds.find((item) => item.id === url.worldId)
    ?? null;
  const branch = branches.find((item) => item.id === url.branchId) ?? null;
  const detailQuery = useWorldBranchDetail(url.worldId, branch?.id);
  const detail = detailQuery.data;
  const definition = detail?.definition ?? (world
    ? {
        title: world.title,
        summary: world.summary,
        timeLabel: world.timeLabel,
        locations: world.locations,
        actors: world.actors,
        sources: world.sources,
        lockedFacts: world.lockedFacts,
        models: world.models,
        visualStyle: world.visualStyle,
      }
    : null);
  const [filterState, setFilterState] = useState({ branchId: '', actorId: '', storyLineId: '' });
  const activeFilters = filterState.branchId === (branch?.id ?? '')
    ? filterState
    : { branchId: branch?.id ?? '', actorId: '', storyLineId: '' };
  const [windowState, setWindowState] = useState<{ branchId: string; from: number; to: number } | null>(null);
  const windowRange = windowState && windowState.branchId === (branch?.id ?? '')
    ? windowState
    : defaultWindow(branch);
  const hasEventFilters = Boolean(activeFilters.actorId || activeFilters.storyLineId);
  const isNarrowEventWindow = windowRange.from > 0 || windowRange.to < (branch?.currentTick ?? 0);
  const run = detail?.run ?? null;
  const polling = isRunActive(run?.status);
  const eventQuery = useWorldEventPages(
    url.worldId,
    branch?.id,
    {
      from: windowRange.from,
      to: windowRange.to,
      limit: 200,
      ...(activeFilters.actorId ? { actorId: activeFilters.actorId } : {}),
      ...(activeFilters.storyLineId ? { storyLineId: activeFilters.storyLineId } : {}),
    },
    polling,
  );
  const events = mergeEventPages(eventQuery.data?.pages);
  const buckets = eventQuery.data?.pages[0]?.buckets;
  const total = eventQuery.data?.pages[eventQuery.data.pages.length - 1]?.total ?? 0;
  const isAllEventsLoaded = Boolean(
    !activeFilters.actorId &&
    !activeFilters.storyLineId &&
    !eventQuery.hasNextPage &&
    events.length >= total &&
    events.length > 0,
  );
  const images = detail?.images ?? [];
  const uncertainImagesCount = images.filter((img) => img.status === 'uncertain').length;
  const [eventSelection, setEventSelection] = useState({ branchId: '', id: '' });
  const selectedEventId = eventSelection.branchId === (branch?.id ?? '') ? eventSelection.id : '';
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileEventsOpen, setMobileEventsOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [memoryActorId, setMemoryActorId] = useState('');
  const [branchFormOpen, setBranchFormOpen] = useState(false);
  const [branchParent, setBranchParent] = useState<string | null>(null);
  const [branchForkTick, setBranchForkTick] = useState<number | undefined>(undefined);
  const [runFormOpen, setRunFormOpen] = useState(false);
  const [interventionOpen, setInterventionOpen] = useState(false);
  const [storyLineOpen, setStoryLineOpen] = useState(false);
  const [adoptOpen, setAdoptOpen] = useState(false);
  const [imagePlanOpen, setImagePlanOpen] = useState(false);
  const [imageSubmitId, setImageSubmitId] = useState('');
  const imageSubmitTarget = images.find((image) => image.id === imageSubmitId) ?? null;
  const [compareOpen, setCompareOpen] = useState(false);
  const [promotingActor, setPromotingActor] = useState<WorldActor | null>(null);
  const [runRecoveryOpen, setRunRecoveryOpen] = useState(false);
  const [generationRecoveryOpen, setGenerationRecoveryOpen] = useState(false);
  const [runBusy, setRunBusy] = useState<'pause' | 'resume' | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const actors = definition?.actors ?? [];
  const locations = definition?.locations ?? [];
  const storyLines = detail?.storyLines ?? [];
  const stateByActor = useMemo(
    () => new Map((detail?.states ?? []).map((state) => [state.actorId, state])),
    [detail?.states],
  );
  const memoryActor = actors.find((actor) => actor.id === memoryActorId) ?? null;
  const memoryState = memoryActor ? stateByActor.get(memoryActor.id) : undefined;

  const selectEvent = (eventId: string) => {
    setEventSelection({ branchId: branch?.id ?? '', id: eventId });
    setMobileEventsOpen(false);
    if (narrow) setMobileDetailOpen(true);
  };

  const setWindow = (from: number, to: number) => {
    const nextFrom = Math.max(0, Math.floor(Number.isFinite(from) ? from : 0));
    const nextTo = Math.max(nextFrom, Math.floor(Number.isFinite(to) ? to : nextFrom));
    setWindowState({ branchId: branch?.id ?? '', from: nextFrom, to: nextTo });
  };

  const setFilter = (patch: Partial<{ actorId: string; storyLineId: string }>) => {
    setFilterState({ ...activeFilters, ...patch, branchId: branch?.id ?? '' });
  };

  const openCreateWorld = () => {
    router.push('/apps/story-worlds/new');
  };

  const openPendingWorld = () => {
    if (!pendingWorld) return;
    const projectId = searchParams.get('projectId');
    router.push(`/apps/story-worlds/${encodeURIComponent(pendingWorld.id)}/setup${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`);
  };

  const openEditWorld = () => {
    if (!world) return;
    router.push(`/apps/story-worlds/${encodeURIComponent(world.id)}/edit${branch ? `?branch=${encodeURIComponent(branch.id)}` : ''}`);
  };

  const openBranchForm = (parentId?: string | null, forkTick?: number) => {
    setBranchParent(parentId ?? null);
    setBranchForkTick(forkTick);
    setBranchFormOpen(true);
  };

  const toggleRun = async () => {
    if (!run || !branch || !world) return;
    const operation = run.status === 'paused' ? 'resume' : 'pause';
    setRunBusy(operation);
    setRunError(null);
    try {
      if (operation === 'pause') {
        await actions.pauseRun(world.id, branch.id, run.id, { expectedRevision: branch.revision });
        toast.success('已请求暂停', '服务端会在当前步骤完成后停止。');
      } else {
        await actions.resumeRun(world.id, branch.id, run.id, { expectedRevision: branch.revision });
        toast.success('已恢复运行');
      }
    } catch (error) {
      setRunError(describeError(error));
    } finally {
      setRunBusy(null);
    }
  };

  const worldsLoading = worldsQuery.isLoading || pendingQuery.isLoading;
  const worldsError = worldsQuery.isError || (pendingQuery.isError && worldChoices.length === 0);
  const bucketData = bucketHeights(buckets);

  useEffect(() => {
    if (!eventQuery.hasNextPage || eventQuery.isFetchingNextPage || eventQuery.isLoading) return;
    if (events.length >= 1_000) return;
    const timer = setTimeout(() => {
      void eventQuery.fetchNextPage();
    }, 0);
    return () => clearTimeout(timer);
  }, [eventQuery, events.length]);

  return (
    <WorkspaceShell className="story-worlds-workspace">
      <WorkspaceHeader
        title="故事世界"
        status={(
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant={runStatusTone(run?.status)} dot>{runStatusLabel(run?.status)}</Badge>
            {run && (
              <span className="text-xs text-muted">
                文本 {run.textCallsUsed}/{run.settings.maxTextCalls} · 配图 {run.imagesSubmitted}/{run.settings.maxImages}
              </span>
            )}
          </span>
        )}
        actions={(
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setRunFormOpen(true)}
              disabled={!world || !branch || !detail}
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              运行设置
            </Button>
            {(run?.status === 'running' || run?.status === 'queued') && (
              <Button
                size="sm"
                variant="outline"
                className="hidden md:inline-flex"
                onClick={() => void toggleRun()}
                loading={runBusy === 'pause'}
              >
                <Pause className="h-4 w-4" aria-hidden="true" />
                暂停
              </Button>
            )}
            {run?.status === 'paused' && (
              <Button
                size="sm"
                variant="outline"
                className="hidden md:inline-flex"
                onClick={() => void toggleRun()}
                loading={runBusy === 'resume'}
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                恢复
              </Button>
            )}
            <RowActionsMenu
              label="故事世界操作"
              items={[
                { label: '新建世界', onSelect: openCreateWorld },
                { label: '编辑当前世界', onSelect: openEditWorld, hidden: !world },
                { label: '新建分支', onSelect: () => openBranchForm(), hidden: !world, separatorBefore: true },
                {
                  label: '从历史节点分支',
                  onSelect: () => openBranchForm(branch?.id, Math.max(0, (branch?.currentTick ?? 0) - 60)),
                  hidden: !branch,
                },
                {
                  label: '并排比较分支',
                  onSelect: () => setCompareOpen(true),
                  hidden: !branch || branches.length < 2,
                  separatorBefore: true,
                },
                { label: '新建故事线', onSelect: () => setStoryLineOpen(true), hidden: !branch },
                { label: '刷新运行状态', onSelect: () => void detailQuery.refetch(), hidden: !branch },
              ]}
            />
          </>
        )}
      />

      {worldsLoading ? (
        <div className="p-6"><AsyncState status="loading" rows={4} /></div>
      ) : worldsError ? (
        <div className="p-6">
          <AsyncState
            status="error"
            title="故事世界读取失败"
            description={describeError(worldsQuery.error ?? pendingQuery.error)}
            onRetry={() => void Promise.all([worldsQuery.refetch(), pendingQuery.refetch()])}
          />
        </div>
      ) : pendingWorld ? (
        <div className="min-h-0 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="max-w-lg space-y-4">
            <Select aria-label="选择故事世界" value={pendingWorld.id} onChange={(event) => url.selectWorld(event.target.value)}>
              {worldChoices.map((item) => (
                <option key={item.id} value={item.id}>{item.title}{pendingWorlds.some((entry) => entry.id === item.id) ? ' · 待配置' : ''}</option>
              ))}
            </Select>
            <Badge variant="warning">待配置</Badge>
            <p className="text-sm text-muted">添加一个开场地点和一名人物后，就可以建立主线。</p>
            <Button variant="primary" onClick={openPendingWorld}>补全设定</Button>
          </div>
        </div>
      ) : worldChoices.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState
            icon={Globe2}
            title="还没有故事世界"
            description="先给世界取个名字，地点和人物可以稍后添加。"
            actions={<Button variant="primary" onClick={openCreateWorld}>创建第一个世界</Button>}
          />
        </div>
      ) : (
        <>
          <div className="sw-runbar">
            <div className="sw-runbar-main">
              <Badge variant={runStatusTone(run?.status)} dot>{runStatusLabel(run?.status)}</Badge>
              {branch ? (
                <span className="sw-runbar-branch">
                  {branch.title} · {branchModeLabel(branch.mode)} · {formatTick(branch.currentTick)}
                </span>
              ) : (
                <span className="sw-runbar-branch">选择一个分支</span>
              )}
              {run && (
                <span className="sw-runbar-quota">
                  文本 {formatQuota(run.textCallsUsed, run.settings.maxTextCalls)} · 配图 {formatQuota(run.imagesSubmitted, run.settings.maxImages)}
                </span>
              )}
            </div>
            <div className="sw-runbar-actions">
              {(run?.status === 'running' || run?.status === 'queued') && (
                <Button size="sm" variant="outline" onClick={() => void toggleRun()} loading={runBusy === 'pause'}>
                  <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                  暂停
                </Button>
              )}
              {run?.status === 'paused' && (
                <Button size="sm" variant="outline" onClick={() => void toggleRun()} loading={runBusy === 'resume'}>
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  恢复
                </Button>
              )}
              {run?.status === 'uncertain' && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setRunRecoveryOpen(true)}>
                    <ShieldAlert className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
                    处理异常调用
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void detailQuery.refetch()}>
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    核对状态
                  </Button>
                </>
              )}
              {uncertainImagesCount > 0 && (
                <Button size="sm" variant="outline" onClick={() => setGenerationRecoveryOpen(true)}>
                  <ShieldAlert className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
                  核对不明生图 ({uncertainImagesCount})
                </Button>
              )}
            </div>
          </div>
          {Boolean(run?.pauseReason?.trim()) && (
            <div className="sw-run-note">
              <Alert variant={run?.status === 'failed' ? 'danger' : 'warning'} title="运行说明">
                {run?.pauseReason}
              </Alert>
            </div>
          )}
          {Boolean(runError?.trim()) && (
            <div className="sw-run-note">
              <Alert variant="danger" title="运行操作失败" onDismiss={() => setRunError(null)}>{runError}</Alert>
            </div>
          )}

          <div className="sw-workbench">
            <WorldFilterRail narrow={narrow} open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
                <section className="sw-section">
                  <div className="sw-section-head">
                    <h2>世界</h2>
                    <Button size="sm" variant="ghost" onClick={openCreateWorld}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      新建
                    </Button>
                  </div>
                  <Select
                    aria-label="选择故事世界"
                    value={url.worldId}
                    onChange={(event) => url.selectWorld(event.target.value)}
                  >
                    {worldChoices.map((item) => (
                      <option key={item.id} value={item.id}>{item.title}{pendingWorlds.some((entry) => entry.id === item.id) ? ' · 待配置' : ''}</option>
                    ))}
                  </Select>
                  {world && (
                    <Button size="sm" variant="outline" onClick={openEditWorld}>
                      编辑世界资料
                    </Button>
                  )}
                </section>

                <section className="sw-section">
                  <div className="sw-section-head">
                    <h2>分支</h2>
                    <Button size="sm" variant="ghost" onClick={() => openBranchForm()} disabled={!world}>
                      <GitBranch className="h-4 w-4" aria-hidden="true" />
                      新建
                    </Button>
                  </div>
                  {overviewQuery.isError ? (
                    <Alert variant="danger" title="分支读取失败">{describeError(overviewQuery.error)}</Alert>
                  ) : branches.length === 0 ? (
                    <p className="text-sm leading-relaxed text-muted">还没有分支。先建立一个起点，再启动运行。</p>
                  ) : (
                    <div className="sw-branch-list">
                      {branches.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="sw-branch-row ui-choice"
                          aria-current={item.id === branch?.id ? 'true' : undefined}
                          onClick={() => url.selectBranch(item.id)}
                        >
                          <span className="sw-branch-title">{item.title}</span>
                          <span className="sw-branch-meta">
                            {branchModeLabel(item.mode)} · {formatTick(item.currentTick)}
                          </span>
                          {item.parentBranchId && <span className="sw-branch-fork">历史分叉</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="sw-section">
                  <div className="sw-section-head">
                    <h2>时间与筛选</h2>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setWindow(0, Math.max(branch?.currentTick ?? 0, 1_440));
                        setFilter({ actorId: '', storyLineId: '' });
                      }}
                    >
                      清除
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="sw-compact-field">
                      <span>从</span>
                      <Input
                        type="number"
                        min={0}
                        value={windowRange.from}
                        onChange={(event) => setWindow(Number(event.target.value), windowRange.to)}
                      />
                    </label>
                    <label className="sw-compact-field">
                      <span>到</span>
                      <Input
                        type="number"
                        min={0}
                        value={windowRange.to}
                        onChange={(event) => setWindow(windowRange.from, Number(event.target.value))}
                      />
                    </label>
                  </div>
                  <p className="sw-window-label">{formatWindow(windowRange.from, windowRange.to)}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setWindow(
                        Math.max(0, (branch?.currentTick ?? 0) - 1_440),
                        Math.max(branch?.currentTick ?? 0, 1_440),
                      )}
                    >
                      最近 24 小时
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setWindow(0, Math.max(branch?.currentTick ?? 0, 1_440))}
                    >
                      全部
                    </Button>
                  </div>
                  <label className="sw-compact-field">
                    <span>人物</span>
                    <Select
                      value={activeFilters.actorId}
                      onChange={(event) => setFilter({ actorId: event.target.value })}
                    >
                      <option value="">全部人物</option>
                      {actors.map((actor) => (
                        <option key={actor.id} value={actor.id}>{actor.name}</option>
                      ))}
                    </Select>
                  </label>
                  <label className="sw-compact-field">
                    <span>故事线</span>
                    <Select
                      value={activeFilters.storyLineId}
                      onChange={(event) => setFilter({ storyLineId: event.target.value })}
                    >
                      <option value="">全部故事线</option>
                      {storyLines.map((line) => (
                        <option key={line.id} value={line.id}>{line.title}</option>
                      ))}
                    </Select>
                  </label>
                  <p className="text-xs text-muted">
                    已加载 {events.length} / {total || events.length} 个事件
                  </p>
                  {bucketData.length > 0 && (
                    <div className="sw-buckets" role="img" aria-label="时间窗口内事件分布">
                      {bucketData.map((height, index) => (
                        <span key={index} style={{ height: `${height}%` }} title={`${buckets?.[index]?.count ?? 0} 个事件`} />
                      ))}
                    </div>
                  )}
                </section>

                <section className="sw-section">
                  <div className="sw-section-head">
                    <h2>人物</h2>
                    <span>{actors.length}</span>
                  </div>
                  <div className="sw-actor-list">
                    {actors.map((actor) => (
                      <div key={actor.id} className="sw-actor-row">
                        <button
                          type="button"
                          className="sw-actor-filter ui-choice"
                          aria-current={actor.id === activeFilters.actorId ? 'true' : undefined}
                          onClick={() => setFilter({ actorId: actor.id === activeFilters.actorId ? '' : actor.id })}
                        >
                          <span className="sw-actor-name">{actor.name}</span>
                          <span className="sw-actor-meta">
                            {actor.role === 'main' ? '主要' : '配角'} · {actorLocation(actor, locations, stateByActor.get(actor.id)?.locationId)}
                          </span>
                          {actor.characterId && <span className="sw-actor-source">角色库快照</span>}
                        </button>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`提升或将 ${actor.name} 存入角色库`}
                            title="提升角色 / 角色库建卡"
                            onClick={() => setPromotingActor(actor)}
                          >
                            <Sparkles className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`查看 ${actor.name} 的记忆`}
                            title="查看记忆"
                            onClick={() => setMemoryActorId(actor.id)}
                          >
                            <Brain className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="sw-section">
                  <div className="sw-section-head">
                    <h2>故事线</h2>
                    <Button size="sm" variant="ghost" onClick={() => setStoryLineOpen(true)} disabled={!branch}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      新建
                    </Button>
                  </div>
                  {storyLines.length === 0 ? (
                    <p className="text-sm leading-relaxed text-muted">还没有故事线。可以把同一主题下的事件串起来。</p>
                  ) : (
                    <div className="sw-line-list">
                      {storyLines.map((line) => (
                        <button
                          key={line.id}
                          type="button"
                          className="sw-line-row ui-choice"
                          aria-current={line.id === activeFilters.storyLineId ? 'true' : undefined}
                          onClick={() => setFilter({ storyLineId: line.id === activeFilters.storyLineId ? '' : line.id })}
                        >
                          <span className="sw-line-title">{line.title}</span>
                          <span className="sw-line-meta">{line.actorIds.length} 人</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="sw-section">
                  <div className="sw-section-head">
                    <h2>来源</h2>
                    <span>{definition?.sources.length ?? 0}</span>
                  </div>
                  {(definition?.sources.length ?? 0) === 0 ? (
                    <Alert variant="info">没有来源资料；运行仍可开始，但服务会标注资料缺口。</Alert>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {definition?.sources.map((source) => (
                        <Badge key={source.id} variant={sourceNatureTone(source.nature)}>
                          {SOURCE_NATURE_META[source.nature].label}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <SourceUpdatePreview
                    worldId={world?.id ?? ''}
                    worldRevision={world?.revision ?? 0}
                    branchId={branch?.id ?? ''}
                    branchRevision={branch?.revision ?? 0}
                    available={Boolean(detail?.sourceUpdatesAvailable && world && branch)}
                    onEditWorld={openEditWorld}
                  />
                </section>
            </WorldFilterRail>

            <section className="sw-canvas" aria-labelledby="sw-branch-title">
              <div className="sw-canvas-head">
                <div className="min-w-0">
                  <p className="sw-eyebrow">{world?.title ?? '故事世界'}</p>
                  <h2 id="sw-branch-title" className="sw-canvas-title">{branch?.title ?? '选择一个分支'}</h2>
                  {branch && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Badge variant="outline">{BRANCH_MODE_META[branch.mode].label}</Badge>
                      <span>{formatTick(branch.currentTick)}</span>
                      <span>分支修订 {branch.revision}</span>
                    </div>
                  )}
                  {branch?.direction && (
                    <details className="sw-direction">
                      <summary>创作方向</summary>
                      <p>{branch.direction}</p>
                    </details>
                  )}
                </div>
                <div className="sw-canvas-actions">
                  <Button
                    size="sm"
                    variant="outline"
                    className="sw-mobile-only"
                    onClick={() => setMobileFiltersOpen(true)}
                  >
                    <Layers className="h-4 w-4" aria-hidden="true" />
                    筛选
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="sw-mobile-only"
                    onClick={() => setMobileEventsOpen(true)}
                  >
                    <Clock3 className="h-4 w-4" aria-hidden="true" />
                    事件
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCompareOpen(true)}
                    disabled={branches.length < 2}
                  >
                    <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
                    比较
                  </Button>
                </div>
              </div>

              <PageTabs
                ariaLabel="故事世界视图"
                variant="local"
                value={url.view}
                onChange={(value) => {
                  if (value === 'flow' || value === 'reading' || value === 'images') url.selectView(value);
                }}
                tabs={[
                  { id: 'flow', label: <><Layers className="h-4 w-4" aria-hidden="true" />故事流</>, count: events.length },
                  { id: 'reading', label: <><BookOpen className="h-4 w-4" aria-hidden="true" />故事阅读</>, count: events.length },
                  { id: 'images', label: <><Film className="h-4 w-4" aria-hidden="true" />图像叙事</>, count: images.length },
                ]}
              />

              <div className="sw-canvas-body">
                {overviewQuery.isLoading ? (
                  <AsyncState status="loading" rows={4} />
                ) : !branch ? (
                  <EmptyState
                    icon={GitBranch}
                    title="还没有可查看的分支"
                    description="先建立一个分支，设置推进方向后启动运行。"
                    actions={<Button variant="primary" onClick={() => openBranchForm()} disabled={!world}>新建分支</Button>}
                  />
                ) : detailQuery.isError ? (
                  <Alert variant="danger" title="分支详情读取失败">
                    {describeError(detailQuery.error)}
                    <Button size="sm" variant="outline" className="ml-2" onClick={() => void detailQuery.refetch()}>
                      重试
                    </Button>
                  </Alert>
                ) : !detail ? (
                  <AsyncState status="loading" rows={5} />
                ) : eventQuery.isError ? (
                  <Alert variant="danger" title="事件读取失败">
                    {describeError(eventQuery.error)}
                    <Button size="sm" variant="outline" className="ml-2" onClick={() => void eventQuery.refetch()}>
                      重试
                    </Button>
                  </Alert>
                ) : (
                  <div className="sw-view">
                    {eventQuery.isFetching && (
                      <span className="sw-refreshing">
                        {eventQuery.isFetchingNextPage ? '正在加载更多事件…' : '正在更新事件…'}
                      </span>
                    )}
                    {events.length > 0 && url.view === 'flow' && (
                      <StoryWorldFlow
                        actors={actors}
                        locations={locations}
                        events={events}
                        selectedEventId={selectedEventId || undefined}
                        onSelectEvent={selectEvent}
                        from={windowRange.from}
                        to={windowRange.to}
                        onWindowChange={setWindow}
                        className="sw-flow"
                        dataComplete={isAllEventsLoaded}
                      />
                    )}
                    {events.length > 0 && url.view === 'reading' && (
                      <WorldReader
                        events={events}
                        actors={actors}
                        locations={locations}
                        images={images}
                        actorId={activeFilters.actorId || undefined}
                        selectedEventId={selectedEventId || undefined}
                        onSelectEvent={selectEvent}
                        className="sw-reader"
                      />
                    )}
                    {events.length > 0 && url.view === 'images' && (
                      <WorldImageReader
                        adoptAction={imageAdoptAction}
                        events={events}
                        actors={actors}
                        locations={locations}
                        images={images}
                        actorId={activeFilters.actorId || undefined}
                        selectedEventId={selectedEventId || undefined}
                        onSelectEvent={selectEvent}
                        className="sw-reader"
                      />
                    )}
                    {events.length === 0 && (eventQuery.isLoading ? (
                      <AsyncState status="loading" rows={4} />
                    ) : (
                      <div className="sw-empty-window">
                        <EmptyState
                          icon={Clock3}
                          title="这个时间窗口没有事件"
                          description={isNarrowEventWindow || hasEventFilters
                            ? '试试扩大时间范围，或清除人物和故事线筛选。'
                            : '故事推进后，生成的事件会显示在这里。'}
                          actions={isNarrowEventWindow ? (
                            <Button size="sm" variant="outline" onClick={() => setWindow(0, Math.max(branch.currentTick, 1_440))}>
                              查看全部时间
                            </Button>
                          ) : hasEventFilters ? (
                            <Button size="sm" variant="outline" onClick={() => setFilter({ actorId: '', storyLineId: '' })}>
                              清除人物和故事线筛选
                            </Button>
                          ) : null}
                        />
                      </div>
                    ))}
                    {eventQuery.hasNextPage && (
                      <div className="sw-load-more">
                        {events.length >= 1_000 && (
                          <p className="text-xs text-muted">已自动加载前 1000 条事件。</p>
                        )}
                        <Button
                          variant="outline"
                          loading={eventQuery.isFetchingNextPage}
                          onClick={() => void eventQuery.fetchNextPage()}
                        >
                          加载更多事件
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            <aside className="sw-rail sw-rail-right">
              <div className="sw-rail-scroll">
                {selectedEvent ? (
                  <EventPanel
                    event={selectedEvent}
                    actors={actors}
                    locations={locations}
                    images={images}
                    onAddIntervention={() => setInterventionOpen(true)}
                    onPlanImages={() => setImagePlanOpen(true)}
                    onAdopt={() => setAdoptOpen(true)}
                    onPrepareSubmit={(image) => setImageSubmitId(image.id)}
                  />
                ) : (
                  <EventListPanel
                    events={events}
                    actors={actors}
                    locations={locations}
                    selectedEventId={selectedEventId}
                    onSelectEvent={selectEvent}
                    total={total}
                    interventions={detail?.interventions ?? []}
                    onAddIntervention={() => setInterventionOpen(true)}
                  />
                )}
              </div>
            </aside>
          </div>
        </>
      )}

      {world && (
        <BranchForm
          key={`branch-form:${world.id}`}
          open={branchFormOpen}
          onOpenChange={setBranchFormOpen}
          world={world}
          branches={branches}
          defaultParentBranchId={branchParent}
          defaultForkTick={branchForkTick}
          onSubmit={(input) => actions.createBranch(world.id, input)}
          onSaved={(saved) => {
            url.selectBranch(saved.id);
            toast.success('分支已创建', saved.title);
          }}
        />
      )}

      {branch && detail && (
        <RunForm
          key={`run-form:${branch.id}`}
          open={runFormOpen}
          onOpenChange={setRunFormOpen}
          definition={detail.definition}
          branch={branch}
          run={run}
          modelCatalog={models}
          purposeBindings={modelRouting.data?.purposes ?? []}
          assignments={publicOverview.data?.llmAssignments ?? []}
          profilesUnavailable={publicOverview.isError || modelRouting.isError}
          onSubmit={(input) => actions.startRun(url.worldId, branch.id, input)}
          onResume={(input) => actions.resumeRun(url.worldId, branch.id, run!.id, input)}
          onSaved={() => toast.success(
            run?.status === 'paused' ? '已更新额度并恢复' : '运行已启动',
            '关闭网页后仍会在服务端继续；重新打开可恢复状态。',
          )}
        />
      )}

      {branch && (
        <InterventionForm
          key={`intervention-form:${branch.id}`}
          open={interventionOpen}
          onOpenChange={setInterventionOpen}
          branch={branch}
          actors={actors}
          onSubmit={(input) => actions.createIntervention(url.worldId, branch.id, input)}
          onSaved={() => toast.success('干预已加入', '会在后续运行步骤中生效。')}
        />
      )}

      {branch && (
        <StoryLineForm
          key={`story-line-form:${branch.id}`}
          open={storyLineOpen}
          onOpenChange={setStoryLineOpen}
          branch={branch}
          actors={actors}
          onSubmit={(input) => actions.createStoryLine(url.worldId, branch.id, input)}
          onSaved={(line) => {
            setFilter({ storyLineId: line.id });
            toast.success('故事线已创建', line.title);
          }}
        />
      )}

      {branch && (
        <ImagePlanForm
          key={`image-plan-form:${branch.id}`}
          open={imagePlanOpen}
          onOpenChange={setImagePlanOpen}
          branch={branch}
          events={events}
          selectedEventId={selectedEventId}
          onSubmit={(input) => actions.planImages(url.worldId, branch.id, input)}
          onSaved={(result) => {
            url.selectView('images');
            toast.success('配图计划已生成', `${result.items.length} 幅待提交`);
          }}
        />
      )}

      {branch && (
        <ImageSubmitForm
          key={`image-submit:${imageSubmitTarget?.id ?? 'none'}`}
          open={Boolean(imageSubmitTarget)}
          onOpenChange={(next) => {
            if (!next) setImageSubmitId('');
          }}
          branch={branch}
          image={imageSubmitTarget}
          run={run}
          onSubmit={(input) => actions.submitImage(url.worldId, branch.id, imageSubmitTarget!.id, input)}
          onSaved={() => toast.success('配图任务已提交', '排队和执行中的任务会占用公共图片名额。')}
        />
      )}

      {world && branch && (
        <AdoptForm
          key={`adopt-form:${branch.id}`}
          open={adoptOpen}
          onOpenChange={setAdoptOpen}
          worldTitle={world.title}
          worldId={world.id}
          branch={branch}
          actors={actors}
          events={events}
          selectedEventId={selectedEventId}
          onSubmit={(input) => actions.adoptEvents(world.id, branch.id, input)}
          onBind={(projectId, expectedRevision, expectedBinding) => actions.bindProject(world.id, branch.id, { projectId, expectedRevision, expectedBinding })}
          onSaved={(result: WorldAdoptionResult) => toast.success('已采纳进项目', result.projectId)}
        />
      )}

      {compareOpen && world && branch && branches.length >= 2 && (
        <BranchComparisonDialog
          worldId={world.id}
          branches={branches}
          initialLeftId={branch.id}
          actors={actors}
          locations={locations}
          onClose={() => setCompareOpen(false)}
        />
      )}

      <MemoryDrawer
        actor={memoryActor}
        worldId={url.worldId}
        branchId={branch?.id ?? ''}
        state={memoryState}
        locations={locations}
        events={events}
        onSelectEvent={(eventId) => {
          selectEvent(eventId);
          setMemoryActorId('');
        }}
        onClose={() => setMemoryActorId('')}
      />

      <Drawer
        open={mobileEventsOpen}
        onOpenChange={setMobileEventsOpen}
        title="事件"
        description="当前时间窗口与筛选下的事件。"
        position="bottom"
      >
        <EventListPanel
          events={events}
          actors={actors}
          locations={locations}
          selectedEventId={selectedEventId}
          onSelectEvent={(eventId) => {
            selectEvent(eventId);
            setMobileEventsOpen(false);
          }}
          total={total}
          interventions={detail?.interventions ?? []}
          onAddIntervention={() => {
            setMobileEventsOpen(false);
            setInterventionOpen(true);
          }}
        />
      </Drawer>

      <Drawer
        open={mobileDetailOpen && Boolean(selectedEvent)}
        onOpenChange={setMobileDetailOpen}
        title="事件详情"
        position="bottom"
      >
        {selectedEvent && (
          <EventPanel
            event={selectedEvent}
            actors={actors}
            locations={locations}
            images={images}
            onClose={() => setMobileDetailOpen(false)}
            onAddIntervention={() => setInterventionOpen(true)}
            onPlanImages={() => setImagePlanOpen(true)}
            onAdopt={() => setAdoptOpen(true)}
            onPrepareSubmit={(image) => setImageSubmitId(image.id)}
          />
        )}
      </Drawer>

      {world && branch && promotingActor && (
        <ActorPromoteForm
          key={`actor-promote:${branch.id}:${promotingActor.id}`}
          open={Boolean(promotingActor)}
          onOpenChange={(next) => {
            if (!next) setPromotingActor(null);
          }}
          actor={promotingActor}
          branch={branch}
          onSubmit={(input) => actions.promoteActor(world.id, branch.id, promotingActor.id, input)}
          onSaved={(result) => {
            toast.success(
              result.promoted ? '人物已提升为主角' : '角色已存入角色库',
              result.character ? `已创建角色卡「${result.character.displayName}」` : undefined,
            );
          }}
        />
      )}

      {world && branch && run && (
        <RunRecoveryDialog
          key={`run-recovery:${branch.id}:${run.id}`}
          open={runRecoveryOpen}
          onOpenChange={setRunRecoveryOpen}
          worldId={world.id}
          branch={branch}
          run={run}
          onResolve={async (callId, input) => {
            const res = await actions.resolveRunCall(world.id, branch.id, run.id, callId, input);
            toast.success('调用决议已生效', `分支已更新至修订版 ${res.branchRevision}`);
            return res;
          }}
        />
      )}

      <GenerationRecoveryDialog
        open={generationRecoveryOpen}
        onOpenChange={setGenerationRecoveryOpen}
        onResolve={async (taskId, input) => {
          const res = await actions.resolveUncertainGeneration(taskId, input);
          toast.success('生图判定已生效', `任务 ${res.task.id} 状态已更新`);
          void detailQuery.refetch();
          return res;
        }}
      />
    </WorkspaceShell>
  );
}

export default StoryWorldsWorkspace;
