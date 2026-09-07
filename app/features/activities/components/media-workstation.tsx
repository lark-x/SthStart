'use client';

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
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-[4px_14px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/14%)]">
        <div>
          <h3 className="text-sm font-semibold text-[#18201d] flex items-center gap-2">
            <Camera className="h-4 w-4 text-[#e45d35]" />
            媒体镜头槽位与选片工作台
          </h3>
          <p className="text-xs text-[#68716d]">
            管理活动记录引用的图片与视频槽位。上传素材并选定后，原子发布媒体选择版本。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleAddSlot}
            disabled={disabled}
            className="text-xs flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            新增镜头槽位
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleSaveMedia}
            disabled={disabled || saveMediaMutation.isPending}
            className="text-xs bg-[#e45d35] hover:bg-[#b83b1b] text-white flex items-center gap-1.5 shadow-xs"
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
      {slots.length === 0 ? (
        <div className="p-12 text-center text-xs text-[#68716d] bg-[#faf8f2] rounded-lg border border-[rgb(24_32_29/14%)] space-y-2">
          <Film className="h-8 w-8 mx-auto text-stone-400 opacity-60" />
          <p>当前活动尚无媒体槽位</p>
          <p className="text-[11px]">可在上方点击“新增镜头槽位”，或由 AI 生成对白与动态时自动创建。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {slots.map((slot) => {
            const boundKey = bindingsMap[slot.id];
            const boundAsset = assets.find((a) => a.assetKey === boundKey);

            return (
              <div
                key={slot.id}
                className="p-4 rounded-[4px_14px_4px_4px] bg-[#fffdf8] border border-[rgb(24_32_29/14%)] space-y-3 shadow-2xs"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase font-mono">
                      {slot.kind === 'video' ? '🎬 视频' : '📷 照片'}
                    </Badge>
                    <span className="text-xs font-semibold text-[#18201d]">{slot.caption}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteSlot(slot.id)}
                    disabled={disabled}
                    className="text-stone-400 hover:text-red-500 transition-colors p-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <p className="text-xs text-[#68716d] leading-relaxed">
                  {slot.shotDescription}
                </p>

                {/* Bound Asset Preview or Placeholder */}
                <div className="p-2.5 rounded-lg bg-[#faf8f2] border border-stone-200/80 space-y-2">
                  <div className="text-[11px] font-medium text-[#18201d] flex items-center justify-between">
                    <span>当前采用素材：</span>
                    {boundKey ? (
                      <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">
                        已选片
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50">
                        未选片
                      </Badge>
                    )}
                  </div>

                  {boundKey ? (
                    <div className="flex items-center gap-3">
                      <div className="relative h-14 w-20 rounded bg-stone-200 overflow-hidden flex-shrink-0 flex items-center justify-center text-xs text-stone-500">
                        {slot.kind === 'video' ? (
                          <Video className="h-5 w-5 text-stone-600" />
                        ) : (
                          <Camera className="h-5 w-5 text-stone-600" />
                        )}
                      </div>
                      <div className="text-[11px] space-y-0.5 min-w-0">
                        <div className="font-mono text-[#18201d] truncate">{boundKey}</div>
                        {slot.kind === 'video' && boundAsset?.durationMs && (
                          <div className="text-stone-500">
                            时长: {Math.round(boundAsset.durationMs / 1000)}s
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-stone-500 py-3 text-center">
                      尚未绑定素材。可从本地上传或从活动资产库挑选。
                    </div>
                  )}

                  {/* Actions for slot */}
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={disabled || uploadMutation.isPending}
                      onClick={() => {
                        setTargetSlotIdForUpload(slot.id);
                        fileInputRef.current?.click();
                      }}
                      className="text-xs h-7 flex items-center gap-1"
                    >
                      <Upload className="h-3 w-3" />
                      本地上传
                    </Button>

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setActiveSlotId(slot.id)}
                      className="text-xs h-7 flex items-center gap-1"
                    >
                      <Layers className="h-3 w-3" />
                      从资产库挑选 ({assets.length})
                    </Button>
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
            className="text-xs bg-[#e45d35] hover:bg-[#b83b1b] text-white"
          >
            完成选择
          </Button>
        }
      >
        <div className="max-h-80 overflow-y-auto space-y-2 py-2 pr-1">
          {assetsLoading ? (
            <div className="text-xs text-stone-500 py-8 text-center">加载素材列表中…</div>
          ) : assets.length === 0 ? (
            <div className="text-xs text-stone-500 py-8 text-center">
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
                      ? 'border-[#e45d35] bg-[#e45d35]/5 ring-1 ring-[#e45d35]'
                      : 'border-stone-200 hover:border-stone-300 bg-white'
                  }`}
                >
                  <div className="h-10 w-14 rounded bg-stone-200 flex items-center justify-center text-xs text-stone-600 flex-shrink-0">
                    {asset.type === 'video' ? <Video className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs text-[#18201d] truncate">{asset.assetKey}</div>
                    <div className="text-[10px] text-stone-500">
                      类型: {asset.type} | 尺寸: {asset.width || '?'}x{asset.height || '?'}
                      {asset.durationMs ? ` | 时长: ${Math.round(asset.durationMs / 1000)}s` : ''}
                    </div>
                  </div>
                  {isSelected && <Check className="h-4 w-4 text-[#e45d35]" />}
                </div>
              );
            })
          )}
        </div>
      </Dialog>
    </div>
  );
}
