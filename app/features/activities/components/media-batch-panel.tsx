'use client';
import { normalizeCreationProfile } from '@sthstart/contracts';
import { useSearchParams } from 'next/navigation';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  Camera,
  Play,
  RotateCcw,
  Square,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Check,
  ChevronRight,
  Filter,
  Layers,
  Image as ImageIcon,
  Bookmark,
} from 'lucide-react';
import type {
  Activity,
  ContentDocument,
  MediaRevision,
  ActivityMediaBatch,
  ActivityMediaBatchItem,
  PrepareMediaBatchOutput,
} from '@sthstart/contracts';
import { fetchActivity, fetchImageConfigDraft, commitImageConfigRevision } from '../api';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Spinner } from '@/app/components/ui/spinner';
import { Alert } from '@/app/components/ui/alert';
import {
  useMediaBatches,
  useMediaBatch,
  useImageConfigDraft,
  useActivityAssets,
  useActivityPresets,
} from '../queries';
import {
  usePrepareMediaBatch,
  useCreateMediaBatch,
  useCancelMediaBatch,
  useRetryFailedBatchItems,
  useCreateActivityPreset,
} from '../mutations';

interface MediaBatchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activity: Activity;
  document: ContentDocument;
  currentMediaRevision?: MediaRevision | null;
  bindingsMap: Record<string, string>;
  onAdoptAsset: (slotId: string, assetKey: string) => Promise<void>;
  onAdoptAssets: (selected: Record<string, string>) => Promise<void>;
  disabled?: boolean;
}

export function MediaBatchPanel({
  isOpen,
  onClose,
  activity,
  document,
  currentMediaRevision,
  bindingsMap,
  onAdoptAsset,
  onAdoptAssets,
  disabled,
}: MediaBatchPanelProps) {
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [selectedTab, setActiveTab] = useState<'create' | 'gallery' | null>(null);
  const [stageFilter, setStageFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');

  const [candidateCount, setCandidateCount] = useState<1 | 2 | 3>(()=>normalizeCreationProfile((document.activity.creationProfile?.values||{}) as Record<string,unknown>).candidateCount);
  const searchParams = useSearchParams();
  const [slotSelection, setSelectedSlotIds] = useState<string[] | null>(()=>searchParams.get('reworkSlots')?.split(',').filter(id=>document.mediaSlots.some(s=>s.id===id)&&!document.editingPolicy?.lockedMediaSlotIds.includes(id))||null);
  const [batchChoice, setSelectedBatchId] = useState<string | null>(searchParams.get('batchId'));
  const [adoptingKey, setAdoptingKey] = useState<string | null>(null);
  const [selectedAssets, setSelectedAssets] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const imageSlots = useMemo(
    () => (document.mediaSlots || []).filter((s) => s.kind === 'image' && (!stageFilter || s.stageId === stageFilter) && (!actorFilter || s.actorIds.includes(actorFilter))),
    [document.mediaSlots, stageFilter, actorFilter]
  );

  const selectedSlotIds = useMemo(() => slotSelection || imageSlots.filter(slot => !bindingsMap[slot.id]
    && !document.editingPolicy?.lockedMediaSlotIds.includes(slot.id)).map(slot => slot.id), [slotSelection, imageSlots, bindingsMap, document.editingPolicy]);

  // Production presets state
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const { data: presetsData } = useActivityPresets('production_preset');
  const createPresetMutation = useCreateActivityPreset();
  const productionPresets = presetsData?.items || [];

  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (!presetId) return;
    const preset = productionPresets.find((p) => p.id === presetId);
    if (preset?.payload) {
      const pCount = (preset.payload as Record<string, unknown>).candidateCountPerSlot;
      if (pCount === 1 || pCount === 2 || pCount === 3) {
        setCandidateCount(pCount as 1 | 2 | 3);
      }
    }
  };

  const handleSaveProductionPreset = async () => {
    const name = window.prompt('请输入生产预设名称:', `生图偏好 (${candidateCount}张候选)`);
    if (!name?.trim()) return;
    try {
      const created = await createPresetMutation.mutateAsync({
        kind: 'production_preset',
        name: name.trim(),
        payload: {
          candidateCountPerSlot: candidateCount,
          globalStylePrompt: configDraft?.document.globalStylePrompt,
          globalNegativePrompt: configDraft?.document.globalNegativePrompt,
          defaultParams: configDraft?.document.defaultParams,
        },
      });
      setSelectedPresetId(created.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '保存生产预设失败');
    }
  };

  // Queries
  const { data: batchesData, isLoading: batchesLoading } = useMediaBatches(activity.id);
  const batches = batchesData?.items || [];

  const selectedBatchId = batchChoice || batches.find(batch => ['running', 'preparing'].includes(batch.summary.displayState))?.id || batches[0]?.id;
  const activeTab = selectedTab || (selectedBatchId ? 'gallery' : 'create');
  const [selectionBatchId, setSelectionBatchId] = useState(selectedBatchId);
  if (selectionBatchId !== selectedBatchId) {
    setSelectionBatchId(selectedBatchId);
    setSelectedAssets({});
  }

  const { data: currentBatch, isLoading: batchLoading } = useMediaBatch(
    activity.id,
    selectedBatchId || undefined
  );

  const { data: configDraft } = useImageConfigDraft(activity.id);
  const { data: assetsData } = useActivityAssets(activity.id);

  // Preflight prepare mutation
  const prepareMutation = usePrepareMediaBatch();
  const [preflight, setPreflight] = useState<{ key: string; result: PrepareMediaBatchOutput } | null>(null);
  const preflightKey = JSON.stringify([activity.id, activity.currentContentRevisionId, configDraft?.baseRevisionId, selectedSlotIds]);
  const preflightResult = preflight?.key === preflightKey ? preflight.result : null;

  useEffect(() => {
    if (!isOpen || selectedSlotIds.length === 0 || !configDraft?.baseRevisionId) {
      return;
    }

    let isMounted = true;
    const runPreflight = async () => {
      try {
        const result = await prepareMutation.mutateAsync({
          id: activity.id,
          input: {
            contentRevisionId: activity.currentContentRevisionId || '',
            imageConfigRevisionId: configDraft?.baseRevisionId || 'default',
            slotIds: selectedSlotIds,
          },
        });
        if (isMounted) {
          setPreflight({ key: preflightKey, result });
        }
      } catch (err) {
        if (isMounted) setActionError(err instanceof Error ? err.message : '预检失败');
      }
    };

    runPreflight();
    return () => {
      isMounted = false;
    };
  }, [isOpen, selectedSlotIds, activity.id, activity.currentContentRevisionId, configDraft?.baseRevisionId, preflightKey]);

  // Mutations
  const createBatchMutation = useCreateMediaBatch();
  const cancelBatchMutation = useCancelMediaBatch();
  const retryFailedMutation = useRetryFailedBatchItems();

  const handleStartBatch = async () => {
    if (selectedSlotIds.length === 0 || starting) return;
    setStarting(true);
    setActionError(null);

    try {
      let fresh = await fetchActivity(activity.id);
      if (!fresh.currentContentRevision || JSON.stringify(fresh.draft.document) !== JSON.stringify(fresh.currentContentRevision.document)) {
        throw new Error('请先在活动顶部保存当前内容为新版本，再批量生图。');
      }
      const latestConfig = await fetchImageConfigDraft(activity.id);
      const preset = productionPresets.find(preset => preset.id === selectedPresetId);
      const configDocument = { ...latestConfig.document };
      if (preset) {
        const style = preset.payload.globalStylePrompt ?? preset.payload.stylePrompt;
        if (typeof style === 'string') configDocument.globalStylePrompt = style;
        if (typeof preset.payload.globalNegativePrompt === 'string') configDocument.globalNegativePrompt = preset.payload.globalNegativePrompt;
        if (preset.payload.defaultParams && typeof preset.payload.defaultParams === 'object') configDocument.defaultParams = preset.payload.defaultParams as typeof configDocument.defaultParams;
      }
      const revision = await commitImageConfigRevision(activity.id, configDocument, latestConfig.draftVersion, fresh.activity.headVersion);
      fresh = await fetchActivity(activity.id);
      const newBatch = await createBatchMutation.mutateAsync({
        id: activity.id,
        input: {
          expectedHeadVersion: fresh.activity.headVersion,
          contentRevisionId: fresh.activity.currentContentRevisionId!,
          imageConfigRevisionId: revision.id,
          productionPresetId: selectedPresetId || undefined,
          idempotencyKey: `batch_${activity.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          items: selectedSlotIds.map((slotId) => ({
            slotId,
            candidateCount,
          })),
        },
      });

      setSelectedBatchId(newBatch.id);
      setActiveTab('gallery');
      await queryClient.invalidateQueries();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '启动批量生图失败';
      setActionError(msg);
    } finally { setStarting(false); }
  };

  const handleCancelBatch = async () => {
    if (!selectedBatchId) return;
    try {
      await cancelBatchMutation.mutateAsync({
        id: activity.id,
        batchId: selectedBatchId,
      });
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : '取消批次失败');
    }
  };

  const handleRetryFailed = async () => {
    if (!selectedBatchId) return;
    try {
      const retried = await retryFailedMutation.mutateAsync({
        id: activity.id,
        batchId: selectedBatchId,
      });
      setSelectedBatchId(retried.id);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : '重试失败条目失败');
    }
  };

  const handleAdopt = async (slotId: string, assetKey: string) => {
    setAdoptingKey(assetKey);
    setActionError(null);
    try {
      await onAdoptAsset(slotId, assetKey);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : '采纳候选失败');
    } finally {
      setAdoptingKey(null);
    }
  };

  const handleAdoptSelected = async () => {
    setAdoptingKey('batch');
    setActionError(null);
    try {
      await onAdoptAssets(selectedAssets);
      setSelectedAssets({});
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '批量采用失败，所选候选未写入');
    } finally { setAdoptingKey(null); }
  };

  // Group current batch items by slotId
  const itemsBySlot = useMemo(() => {
    const map = new Map<string, ActivityMediaBatchItem[]>();
    if (currentBatch?.items) {
      for (const item of currentBatch.items) {
        const list = map.get(item.slotId) || [];
        list.push(item);
        map.set(item.slotId, list);
      }
    }
    return map;
  }, [currentBatch]);

  const summary = currentBatch?.summary;
  const progressPercent = summary && summary.total > 0
    ? Math.round(((summary.succeeded + summary.failed + summary.skipped) / summary.total) * 100)
    : 0;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      title="批量生图与多候选挑选"
      description="针对活动镜头批量发起图片生成任务，并在实时生成的候选图库中直接比较和一键采纳。"
      className="max-w-4xl"
    >
      <div className="space-y-4 py-1">
        {/* Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-border-default pb-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'create'
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-muted hover:text-ink hover:bg-surface-hover'
              }`}
            >
              新建批量生图
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('gallery')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                activeTab === 'gallery'
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-muted hover:text-ink hover:bg-surface-hover'
              }`}
            >
              批次进度与选片
              {summary && summary.displayState === 'running' && (
                <Spinner className="h-3 w-3 text-accent" />
              )}
            </button>
          </div>

          {/* Batch Selector when in gallery */}
          {activeTab === 'gallery' && batches.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">切换批次:</span>
              <select
                value={selectedBatchId || ''}
                onChange={(e) => setSelectedBatchId(e.target.value)}
                aria-label="选择生图批次"
                className="text-xs py-1 px-2 border border-border-default rounded bg-surface text-ink font-mono"
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {new Date(b.createdAt).toLocaleTimeString()} ({b.summary.succeeded}/{b.summary.total}完成 - {b.summary.displayState})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {actionError && (
          <Alert variant="danger" title="操作提示">
            {actionError}
          </Alert>
        )}

        {/* TAB 1: CREATE BATCH */}
        {activeTab === 'create' && (
          <div className="space-y-4">
            {/* Options */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-3.5 rounded-lg bg-surface-raised border border-border-default">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-ink">每镜头候选张数</label>
                <div className="flex items-center gap-2 pt-1">
                  {([1, 2, 3] as const).map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setCandidateCount(count)}
                      className={`px-3 py-1 text-xs font-medium rounded border transition-colors ${
                        candidateCount === count
                          ? 'border-accent bg-accent text-white'
                          : 'border-border-default bg-surface hover:bg-surface-hover text-ink'
                      }`}
                    >
                      {count} 张候选
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted pt-1">
                  单次生成多个候选种子，方便在生成完成后挑选最佳结果。
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-ink">生产预设偏好</label>
                  <button
                    type="button"
                    onClick={handleSaveProductionPreset}
                    className="text-2xs text-accent hover:underline flex items-center gap-1"
                  >
                    <Bookmark className="h-3 w-3" />
                    另存预设
                  </button>
                </div>
                <div className="pt-1">
                  <select
                    value={selectedPresetId}
                    onChange={(e) => handleSelectPreset(e.target.value)}
                    aria-label="选择生产预设"
                    className="w-full text-xs py-1.5 px-2 border border-border-default rounded bg-surface text-ink"
                  >
                    <option value="">默认配置 (未指定预设)</option>
                    {productionPresets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (v{p.version})
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-muted pt-1">
                  复用常用生图候选数与风格偏好。
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-ink">待处理槽位概况</label>
                <div className="text-xs text-muted pt-1 space-y-0.5">
                  <div>已选 {selectedSlotIds.length} / {imageSlots.length} 个镜头</div>
                  <div>预计生成：{selectedSlotIds.length * candidateCount} 张图片</div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted" />
              <select aria-label="筛选阶段" value={stageFilter} onChange={event => setStageFilter(event.target.value)} className="text-xs rounded border border-border-default p-2">
                <option value="">全部阶段</option>{document.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.title}</option>)}
              </select>
              <select aria-label="筛选角色" value={actorFilter} onChange={event => setActorFilter(event.target.value)} className="text-xs rounded border border-border-default p-2">
                <option value="">全部角色</option>{document.actors.map(actor => <option key={actor.id} value={actor.id}>{actor.displayName}</option>)}
              </select>
            </div>
            {/* Slots Selection Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-ink">选择参与批量生图的镜头</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedSlotIds(imageSlots.filter(s => !bindingsMap[s.id] && !document.editingPolicy?.lockedMediaSlotIds.includes(s.id)).map(s => s.id))}
                    className="text-xs text-accent hover:underline"
                  >
                    选择当前筛选中未补齐的镜头
                  </button>
                  <span className="text-xs text-border-strong">|</span>
                  <button
                    type="button"
                    onClick={() => setSelectedSlotIds([])}
                    className="text-xs text-muted hover:underline"
                  >
                    清空
                  </button>
                </div>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-1.5 border border-border-default rounded-lg p-2 bg-surface">
                {imageSlots.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted">
                    当前活动没有图片类型的镜头槽位。
                  </div>
                ) : (
                  imageSlots.map((slot) => {
                    const isChecked = selectedSlotIds.includes(slot.id);
                    const preflightUnready = preflightResult?.unreadyItems.find(
                      (u) => u.slotId === slot.id
                    );
                    const preflightReady = preflightResult?.readyItems.find(
                      (r) => r.slotId === slot.id
                    );
                    const hasBound = Boolean(bindingsMap[slot.id]);

                    return (
                      <div
                        key={slot.id}
                        onClick={() => {
                          if (document.editingPolicy?.lockedMediaSlotIds.includes(slot.id)) return;
                          setSelectedSlotIds(selectedSlotIds.includes(slot.id)
                            ? selectedSlotIds.filter(id => id !== slot.id) : [...selectedSlotIds, slot.id]);
                        }}
                        className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors text-xs ${
                          isChecked ? 'bg-accent/5 border border-accent/30' : 'bg-surface hover:bg-surface-hover border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}} // Handled by parent div
                            className="rounded text-accent focus:ring-accent h-3.5 w-3.5"
                          />
                          <Camera className="h-3.5 w-3.5 text-muted flex-shrink-0" />
                          <span className="font-medium text-ink truncate">{slot.caption}</span>
                          <span className="text-muted truncate max-w-xs">{slot.shotDescription}</span>
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {hasBound && (
                            <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">
                              已有素材
                            </Badge>
                          )}
                          {preflightUnready && (
                            <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-300">
                              {preflightUnready.reason}
                            </Badge>
                          )}
                          {preflightReady?.reason && (
                            <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-300">
                              {preflightReady.reason}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Submit Bar */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleStartBatch}
                disabled={disabled || starting || selectedSlotIds.length === 0 || createBatchMutation.isPending}
                className="bg-accent hover:bg-accent-dark text-white flex items-center gap-1.5"
              >
                {starting || createBatchMutation.isPending ? (
                  <>
                    <Spinner className="h-3.5 w-3.5" />
                    正在排队中…
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    开始批量生图 ({selectedSlotIds.length * candidateCount} 张)
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* TAB 2: GALLERY & CANDIDATE SELECTION */}
        {batches.length > 0 && <select aria-label="选择生图批次" value={selectedBatchId || ''} onChange={e => { setSelectedBatchId(e.target.value); setActiveTab('gallery'); }} className="w-full rounded border p-2 text-sm">
          {batches.map(b => <option key={b.id} value={b.id}>{new Date(b.createdAt).toLocaleString()} · {b.summary.succeeded}/{b.summary.total}</option>)}
        </select>}
        {activeTab === 'gallery' && (
          <div className="space-y-4">
            {!currentBatch ? (
              <div className="p-8 text-center text-xs text-muted">
                {batchLoading ? '加载批次数据中…' : '暂无生图批次记录。请在上方切换到“新建批量生图”创建。'}
              </div>
            ) : (
              <>
                {/* Batch Status Bar */}
                <div className="p-3.5 rounded-lg bg-surface-raised border border-border-default space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-ink">批次状态：</span>
                      {summary?.displayState === 'needs_attention' && <Badge>远端结果待核对，请查看原任务</Badge>}
                      {summary?.displayState === 'preparing' && <Badge>正在准备任务</Badge>}
                      {summary?.displayState === 'running' && (
                        <Badge variant="outline" className="text-xs bg-sky-50 text-sky-700 border-sky-300 flex items-center gap-1">
                          <Spinner className="h-3 w-3" />
                          正在生图 ({summary.succeeded}/{summary.total})
                        </Badge>
                      )}
                      {summary?.displayState === 'succeeded' && (
                        <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-300 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          全部成功完成 ({summary.total} 张)
                        </Badge>
                      )}
                      {summary?.displayState === 'partial' && (
                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          部分成功 ({summary.succeeded} 成功 / {summary.failed} 失败)
                        </Badge>
                      )}
                      {summary?.displayState === 'stopped' && (
                        <Badge variant="outline" className="text-xs bg-slate-50 text-slate-700 border-slate-300 flex items-center gap-1">
                          <Square className="h-3 w-3" />
                          已手动终止
                        </Badge>
                      )}
                      {summary?.displayState === 'failed' && (
                        <Badge variant="outline" className="text-xs bg-rose-50 text-rose-700 border-rose-300 flex items-center gap-1">
                          <XCircle className="h-3 w-3" />
                          全部生成失败
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {['running', 'preparing'].includes(summary?.displayState || '') && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleCancelBatch}
                          disabled={cancelBatchMutation.isPending}
                          className="h-7 text-xs flex items-center gap-1 text-rose-700 border-rose-300 hover:bg-rose-50"
                        >
                          <Square className="h-3 w-3" />
                          停止未开始任务
                        </Button>
                      )}

                      {Boolean(summary && summary.failed > 0) && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleRetryFailed}
                          disabled={retryFailedMutation.isPending}
                          className="h-7 text-xs flex items-center gap-1 text-sky-700 border-sky-300 hover:bg-sky-50"
                        >
                          <RotateCcw className="h-3 w-3" />
                          重试失败条目 ({summary?.failed})
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-border-subtle rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        summary?.displayState === 'failed'
                          ? 'bg-rose-500'
                          : summary?.displayState === 'succeeded'
                          ? 'bg-emerald-500'
                          : 'bg-accent'
                      }`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">每个镜头选一张，确认后一次写入；其他镜头保持现有选择。</span>
                  <Button size="sm" disabled={disabled || Boolean(adoptingKey) || !Object.keys(selectedAssets).length}
                    onClick={handleAdoptSelected}>采用所选 {Object.keys(selectedAssets).length} 张</Button>
                </div>
                {/* Per-slot Candidates Gallery */}
                <div className="max-h-[500px] overflow-y-auto space-y-4 pr-1">
                  {imageSlots.map((slot) => {
                    const items = itemsBySlot.get(slot.id) || [];
                    if (items.length === 0) return null;

                    const currentlyBoundKey = bindingsMap[slot.id];

                    return (
                      <div
                        key={slot.id}
                        className="p-3 rounded-lg border border-border-default bg-surface space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs font-mono">
                              📷 镜头
                            </Badge>
                            <span className="text-xs font-semibold text-ink">{slot.caption}</span>
                          </div>
                          <div className="text-xs text-muted">
                            {items.filter((i) => i.state === 'linked').length} / {items.length} 候选已生成
                          </div>
                        </div>

                        {/* Candidates Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                          {items.map((item) => {
                            const output = item.attemptOutputs?.[0];
                            const isLinked = item.state === 'linked' && output;
                            const isAdopted = output && currentlyBoundKey === output.assetKey;
                            const isItemAdopting = output && adoptingKey === output.assetKey;

                            return (
                              <div
                                key={item.id}
                                className={`group relative rounded-lg border overflow-hidden bg-surface-raised flex flex-col transition-all ${
                                  isAdopted
                                    ? 'border-emerald-500 ring-2 ring-emerald-500/30 shadow-xs'
                                    : 'border-border-default hover:border-border-strong'
                                }`}
                              >
                                {/* Thumbnail */}
                                <div className="relative aspect-video bg-paper overflow-hidden flex items-center justify-center">
                                  {isLinked ? (
                                    <img
                                      src={`/api/admin/artifacts/${output.artifactId}/file`}
                                      alt={`候选 #${item.candidateIndex}`}
                                      className="w-full h-full object-contain"
                                    />
                                  ) : item.state === 'skipped' ? <span className="text-xs text-muted">已停止</span> : item.state === 'failed' ? (
                                    <div className="flex flex-col items-center justify-center p-2 text-center text-rose-600">
                                      <XCircle className="h-5 w-5 mb-1" />
                                      <span className="text-[10px]">{String(item.error?.message || '生成失败')}</span>
                                    </div>
                                  ) : (
                                    <div className="flex flex-col items-center justify-center p-2 text-center text-muted">
                                      <Spinner className="h-5 w-5 mb-1 text-accent" />
                                      <span className="text-[10px]">
                                        {item.state === 'waiting' ? '排队中' : '正在出图'}
                                      </span>
                                    </div>
                                  )}

                                  {/* Badge on candidate index */}
                                  <div className="absolute top-1 left-1 bg-black/60 px-1 py-0.5 rounded text-[10px] font-mono text-white">
                                    #{item.candidateIndex}
                                  </div>

                                  {/* Currently adopted badge */}
                                  {isAdopted && (
                                    <div className="absolute top-1 right-1 bg-emerald-600 px-1.5 py-0.5 rounded text-[10px] font-medium text-white flex items-center gap-0.5 shadow-xs">
                                      <Check className="h-3 w-3" />
                                      已采用
                                    </div>
                                  )}
                                </div>

                                {/* Details & Adopt Action */}
                                <div className="p-2 space-y-1.5 flex-1 flex flex-col justify-between">
                                  <div className="text-[10px] text-muted space-y-0.5">
                                    {item.actualSeed != null && (
                                      <div className="font-mono truncate">种子: {item.actualSeed}</div>
                                    )}
                                    {output?.width && output?.height && (
                                      <div>尺寸: {output.width}x{output.height}</div>
                                    )}
                                  </div>

                                  {isLinked && !isAdopted && <label className="flex items-center gap-1 text-xs">
                                    <input type="checkbox" aria-label={`选择${slot.caption}的候选${item.candidateIndex}`}
                                      disabled={disabled || Boolean(adoptingKey) || document.editingPolicy?.lockedMediaSlotIds.includes(slot.id)}
                                      checked={selectedAssets[slot.id] === output.assetKey}
                                      onChange={event => setSelectedAssets(current => {
                                        const next = { ...current };
                                        if (event.target.checked) next[slot.id] = output.assetKey; else delete next[slot.id];
                                        return next;
                                      })} />加入所选
                                  </label>}
                                  {isLinked && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={isAdopted ? 'outline' : 'primary'}
                                      disabled={disabled || isAdopted || Boolean(adoptingKey) || document.editingPolicy?.lockedMediaSlotIds.includes(slot.id)}
                                      onClick={() => handleAdopt(slot.id, output.assetKey)}
                                      className={`w-full h-6 text-xs flex items-center justify-center gap-1 ${
                                        isAdopted
                                          ? 'border-emerald-400 text-emerald-700 bg-emerald-50'
                                          : 'bg-accent hover:bg-accent-dark text-white'
                                      }`}
                                    >
                                      {isItemAdopting ? (
                                        <Spinner className="h-3 w-3" />
                                      ) : isAdopted ? (
                                        <>
                                          <Check className="h-3 w-3" />
                                          当前采用
                                        </>
                                      ) : (
                                        '采用此张'
                                      )}
                                    </Button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
