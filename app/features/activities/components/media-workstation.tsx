'use client';
import { useQuery } from '@tanstack/react-query';
import { getJson } from '@/app/lib/api-client';
import type { ActivityReviewItem } from '@sthstart/contracts';
import { useSearchParams } from 'next/navigation';

import React, { useState, useRef, useMemo } from 'react';
import {
  Camera,
  Video,
  Upload,
  Check,
  Plus,
  Trash2,
  Film,
  Layers,
  Save,
  Sparkles,
  Lock,
  Unlock,
} from 'lucide-react';
import type {
  Activity,
  ActorSnapshot,
  MediaSlot,
  ContentDocument,
  MediaRevision,
  MediaRevisionDocument,
  SlotBinding,
} from '@sthstart/contracts';
import {
  useUploadActivityAsset,
  useSaveMediaRevision,
} from '../mutations';
import { useActivityAssets } from '../queries';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';
import { Dialog } from '@/app/components/ui/dialog';
import { ImageWorkbench } from './image-workbench';
import { MediaBatchPanel } from './media-batch-panel';

interface MediaWorkstationProps {
  activity: Activity;
  document: ContentDocument;
  currentMediaRevision?: MediaRevision | null;
  actors: ActorSnapshot[];
  onUpdateDocument: (doc: ContentDocument) => void;
  disabled?: boolean;
}

export function MediaWorkstation({
  activity,
  document,
  currentMediaRevision,
  actors,
  onUpdateDocument,
  disabled,
}: MediaWorkstationProps) {
  const {data:reviews}=useQuery({queryKey:['activity-review',activity.id,activity.headVersion],queryFn:()=>getJson<{items:ActivityReviewItem[]}>(`/api/admin/activities/${activity.id}/review-items`)});
  const [reworkOnly,setReworkOnly]=useState(false);
  const reviewSlots=new Set(reviews?.items.filter(i=>i.targetKind==='image'&&(i.decision==='pending'||i.decision==='rework')).map(i=>i.targetId)||[]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [targetSlotIdForUpload, setTargetSlotIdForUpload] = useState<string | null>(null);

  // Map slotId -> primary assetKey
  const initialBindings = useMemo(() => {
    const map: Record<string, string> = {};
    if (currentMediaRevision?.slotBindings) {
      for (const b of currentMediaRevision.slotBindings) {
        if (b.assets?.[0]?.assetKey) {
          map[b.slotId] = b.assets[0].assetKey;
        }
      }
    }
    return map;
  }, [currentMediaRevision]);

  const [bindingsMap, setBindingsMap] = useState<Record<string, string>>(initialBindings);
  const [lastMediaRevisionId, setLastMediaRevisionId] = useState(currentMediaRevision?.id);
  if (lastMediaRevisionId !== currentMediaRevision?.id) {
    setLastMediaRevisionId(currentMediaRevision?.id);
    setBindingsMap(initialBindings);
  }
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [workbenchSlotId, setWorkbenchSlotId] = useState<string | null>(()=>typeof window==='undefined'?null:new URLSearchParams(window.location.search).get('slotId'));
  const searchParams = useSearchParams();
  const [isBatchPanelOpen, setIsBatchPanelOpen] = useState(Boolean(searchParams.get('batchId')||searchParams.get('reworkSlots')));
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAdoptAssets = async (selected: Record<string, string>) => {
    const slotBindings: SlotBinding[] = Object.entries(selected).map(([slotId, assetKey]) => ({
      slotId, slotFingerprint: '', assets: [{ assetKey, order: 1 }],
    }));
    await saveMediaMutation.mutateAsync({ id: activity.id,
      contentRevisionId: activity.currentContentRevisionId || '', slotBindings });
    setBindingsMap(current => ({ ...current, ...selected }));
  };
  const handleAdoptAsset = (slotId: string, assetKey: string) => handleAdoptAssets({ [slotId]: assetKey });

  const { data: assetsData, isLoading: assetsLoading } = useActivityAssets(activity.id);
  const uploadMutation = useUploadActivityAsset();
  const saveMediaMutation = useSaveMediaRevision();

  const slots = document.mediaSlots || [];
  const assets = assetsData?.items || [];

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !targetSlotIdForUpload) return;

    try {
      const asset = await uploadMutation.mutateAsync({
        id: activity.id,
        file,
      });

      // Bind to slot
      setBindingsMap((prev) => ({
        ...prev,
        [targetSlotIdForUpload]: asset.assetKey,
      }));
      setTargetSlotIdForUpload(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '上传媒体文件失败');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSelectAssetForSlot = (slotId: string, assetKey: string) => {
    setBindingsMap((prev) => ({
      ...prev,
      [slotId]: assetKey,
    }));
  };

  const handleSaveMedia = async () => {
    setErrorMsg(null);
    setSaveSuccess(false);

    // Convert bindingsMap to SlotBinding[]
    const slotBindings: SlotBinding[] = slots.map((s) => ({
      slotId: s.id,
      slotFingerprint: `fp_${s.id}_${s.kind}`,
      assets: bindingsMap[s.id]
        ? [{ assetKey: bindingsMap[s.id], order: 10 }]
        : [],
    }));

    try {
      await saveMediaMutation.mutateAsync({
        id: activity.id,
        contentRevisionId: activity.currentContentRevisionId || '',
        slotBindings,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '保存媒体版本失败');
    }
  };

  const handleAddSlot = () => {
    const newSlotId = `slot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newSlot: MediaSlot = {
      id: newSlotId,
      stageId: document.stages?.[0]?.id || 'stage_default',
      kind: 'image',
      caption: '新照片镜头',
      shotDescription: '活动记录画面',
      actorIds: actors.map((a) => a.id),
      sourceFactIds: [],
    };
    onUpdateDocument({
      ...document,
      mediaSlots: [...slots, newSlot],
    });
  };

  const handleDeleteSlot = (slotId: string) => {
    onUpdateDocument({
      ...document,
      mediaSlots: slots.filter((s) => s.id !== slotId),
    });
    const updatedBindings = { ...bindingsMap };
    delete updatedBindings[slotId];
    setBindingsMap(updatedBindings);
  };

  const handleToggleSlotLock = (slotId: string) => {
    const currentLocked = document.editingPolicy?.lockedMediaSlotIds || [];
    const nextLocked = currentLocked.includes(slotId)
      ? currentLocked.filter((id) => id !== slotId)
      : [...currentLocked, slotId];

    onUpdateDocument({
      ...document,
      editingPolicy: {
        lockedRecords: document.editingPolicy?.lockedRecords || [],
        lockedMediaSlotIds: nextLocked,
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        accept="image/*,video/*"
      />

      <label className="text-sm"><input type="checkbox" checked={reworkOnly} onChange={e=>setReworkOnly(e.target.checked)}/> 仅看待复核 / 待返工镜头（{reviewSlots.size}）</label>
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-[var(--radius-panel)] bg-surface border border-border-default">
        <div>
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
            <Camera className="h-4 w-4 text-accent" />
            图片与视频
          </h3>
          <p className="text-sm text-muted">
            管理活动记录引用的图片与视频。上传或生成素材后，选择要在活动中使用的版本。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleAddSlot}
            disabled={disabled}
            className="text-sm flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            新增镜头
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setIsBatchPanelOpen(true)}
            disabled={disabled}
            className="text-sm flex items-center gap-1.5 border-sky-300 text-sky-700 hover:bg-sky-50"
          >
            <Sparkles className="h-3.5 w-3.5 text-sky-500" />
            批量生图与挑选
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleSaveMedia}
            disabled={disabled || saveMediaMutation.isPending}
            className="text-sm bg-accent hover:bg-accent-dark text-white flex items-center gap-1.5 shadow-xs"
          >
            <Save className="h-3.5 w-3.5" />
            {saveMediaMutation.isPending ? '保存中…' : '保存媒体版本'}
          </Button>
        </div>
      </div>

      {errorMsg && (
        <Alert variant="danger" title="媒体提示">
          {errorMsg}
        </Alert>
      )}

      {saveSuccess && (
        <Alert variant="info" title="已成功保存">
          媒体选择版本已更新并关联至当前内容版本。
        </Alert>
      )}

      {/* Slots List */}
      {reworkOnly&&reviewSlots.size===0&&<p className="text-sm text-muted">没有待复核或待返工镜头。</p>}
      {slots.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted bg-surface rounded-lg border border-border-default space-y-2">
          <Film className="h-8 w-8 mx-auto text-fg-subtle opacity-60" />
          <p>当前活动还没有图片或视频镜头</p>
          <p className="text-sm">可在上方点击“新增镜头”，或由 AI 生成对白与动态时自动创建。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {slots.filter(slot=>!reworkOnly||reviewSlots.has(slot.id)).map((slot) => {
            const boundKey = bindingsMap[slot.id];
            const boundAsset = assets.find((a) => a.assetKey === boundKey);
            const isSlotLocked = Boolean(document.editingPolicy?.lockedMediaSlotIds?.includes(slot.id));

            return (
              <div
                key={slot.id}
                className={`p-4 rounded-[var(--radius-panel)] bg-surface border transition-all space-y-3 shadow-2xs ${
                  isSlotLocked ? 'border-amber-300 ring-1 ring-amber-200' : 'border-border-default'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-sm uppercase font-mono">
                      {slot.kind === 'video' ? '🎬 视频' : '📷 照片'}
                    </Badge>
                    <span className="text-sm font-semibold text-ink">{slot.caption}</span>
                    {isSlotLocked && (
                      <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300 flex items-center gap-0.5">
                        <Lock className="h-2.5 w-2.5" />
                        已锁定
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleToggleSlotLock(slot.id)}
                      disabled={disabled}
                      className={`p-1 rounded transition-colors ${
                        isSlotLocked ? 'text-amber-600 hover:text-amber-700' : 'text-fg-subtle hover:text-ink'
                      }`}
                      title={isSlotLocked ? '镜头已锁定（点击解锁）' : '锁定镜头（防止自动改写或批量替换）'}
                    >
                      {isSlotLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteSlot(slot.id)}
                      disabled={disabled || isSlotLocked}
                      className="text-fg-subtle hover:text-danger-fg transition-colors p-1 disabled:opacity-30 disabled:cursor-not-allowed"
                      title={isSlotLocked ? '镜头已锁定，需解锁后才可删除' : '删除镜头'}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-sm text-muted leading-relaxed">
                  {slot.shotDescription}
                </p>

                {reviewSlots.has(slot.id)&&<p className="text-xs text-amber-700">此镜头有待复核变化，当前采用的素材仍会保留；可从活动顶部查看来源与处理方式。</p>}
                {/* Bound Asset Preview or Placeholder */}
                <div className="p-2.5 rounded-lg bg-surface border border-border-subtle space-y-2">
                  <div className="text-sm font-medium text-ink flex items-center justify-between">
                    <span>当前采用素材：</span>
                    {boundKey ? (
                      <Badge variant="outline" className="text-sm bg-emerald-50 text-emerald-700 border-emerald-300">
                        已选片
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-sm text-amber-700 border-amber-300 bg-amber-50">
                        未选片
                      </Badge>
                    )}
                  </div>

                  {boundKey ? (
                    <div className="flex items-center gap-3">
                      <div className="relative h-14 w-20 rounded bg-surface-hover overflow-hidden flex-shrink-0 flex items-center justify-center text-sm text-muted">
                        {slot.kind === 'video' ? (
                          <Video className="h-5 w-5 text-muted" />
                        ) : (
                          <Camera className="h-5 w-5 text-muted" />
                        )}
                      </div>
                      <div className="text-sm space-y-0.5 min-w-0">
                        <div className="font-mono text-ink truncate">{boundKey}</div>
                        {slot.kind === 'video' && boundAsset?.durationMs && (
                          <div className="text-muted">
                            时长: {Math.round(boundAsset.durationMs / 1000)}s
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted py-3 text-center">
                      尚未绑定素材。可从本地上传或从活动资产库挑选。
                    </div>
                  )}

                  {/* Actions for slot */}
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={disabled || isSlotLocked || uploadMutation.isPending}
                      onClick={() => {
                        setTargetSlotIdForUpload(slot.id);
                        fileInputRef.current?.click();
                      }}
                      className="text-sm h-7 flex items-center gap-1"
                    >
                      <Upload className="h-3 w-3" />
                      本地上传
                    </Button>

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={disabled || isSlotLocked}
                      onClick={() => setActiveSlotId(slot.id)}
                      className="text-sm h-7 flex items-center gap-1"
                    >
                      <Layers className="h-3 w-3" />
                      从资产库挑选 ({assets.length})
                    </Button>

                    {slot.kind === 'image' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={disabled || isSlotLocked}
                        onClick={() => setWorkbenchSlotId(slot.id)}
                        className="text-sm h-7 flex items-center gap-1 border-sky-300 text-sky-700 hover:bg-sky-50"
                      >
                        <Sparkles className="h-3 w-3 text-sky-500" />
                        AI 生图 / 提示词溯源
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Asset Picker Dialog */}
      <Dialog
        open={Boolean(activeSlotId)}
        onOpenChange={(open) => !open && setActiveSlotId(null)}
        title="选择绑定素材"
        description="从活动资产库中挑选已上传的文件绑定到该镜头槽位。"
        footer={
          <Button
            type="button"
            size="sm"
            onClick={() => setActiveSlotId(null)}
            className="text-sm bg-accent hover:bg-accent-dark text-white"
          >
            完成选择
          </Button>
        }
      >
        <div className="max-h-80 overflow-y-auto space-y-2 py-2 pr-1">
          {assetsLoading ? (
            <div className="text-sm text-muted py-8 text-center">加载素材列表中…</div>
          ) : assets.length === 0 ? (
            <div className="text-sm text-muted py-8 text-center">
              活动资产库为空。请先通过“本地上传”上传文件。
            </div>
          ) : (
            assets.map((asset) => {
              const isSelected = activeSlotId && bindingsMap[activeSlotId] === asset.assetKey;

              return (
                <div
                  key={asset.assetKey}
                  onClick={() => activeSlotId && handleSelectAssetForSlot(activeSlotId, asset.assetKey)}
                  className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-accent bg-accent/5 ring-1 ring-accent'
                      : 'border-border-default hover:border-border-strong bg-surface-raised'
                  }`}
                >
                  <div className="h-10 w-14 rounded bg-surface-hover flex items-center justify-center text-sm text-muted flex-shrink-0">
                    {asset.type === 'video' ? <Video className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-ink truncate">{asset.assetKey}</div>
                    <div className="text-sm text-muted">
                      类型: {asset.type} | 尺寸: {asset.width || '?'}x{asset.height || '?'}
                      {asset.durationMs ? ` | 时长: ${Math.round(asset.durationMs / 1000)}s` : ''}
                    </div>
                  </div>
                  {isSelected && <Check className="h-4 w-4 text-accent" />}
                </div>
              );
            })
          )}
        </div>
      </Dialog>

      {/* Image Workbench Modal */}
      {workbenchSlotId && (
        <ImageWorkbench
          isOpen={Boolean(workbenchSlotId)}
          onClose={() => setWorkbenchSlotId(null)}
          activity={activity}
          document={document}
          initialSlotId={workbenchSlotId}
          currentMediaRevision={currentMediaRevision}
          onAdoptSlotAsset={handleAdoptAsset}
        />
      )}

      {/* Media Batch Panel Modal */}
      {isBatchPanelOpen && (
        <MediaBatchPanel
          isOpen={isBatchPanelOpen}
          onClose={() => setIsBatchPanelOpen(false)}
          activity={activity}
          document={document}
          currentMediaRevision={currentMediaRevision}
          bindingsMap={bindingsMap}
          onAdoptAsset={handleAdoptAsset}
          onAdoptAssets={handleAdoptAssets}
          disabled={disabled}
        />
      )}
    </div>
  );
}
