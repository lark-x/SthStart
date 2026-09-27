'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { Check, User, Image as ImageIcon, Loader2 } from 'lucide-react';
import type { ActorSnapshot } from '@sthstart/contracts';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { useCharacterAssets } from '@/app/features/characters/queries';

interface ActorAssetPickerDialogProps {
  actor: ActorSnapshot | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: {
    avatarAssetId?: string;
    avatarUrl?: string;
    portraitAssetId?: string;
    portraitUrl?: string;
  }) => void;
}

export function ActorAssetPickerDialog({
  actor,
  open,
  onOpenChange,
  onConfirm,
}: ActorAssetPickerDialogProps) {
  const characterId = actor?.sourceCharacterId;
  const { data: assetsData, isLoading } = useCharacterAssets(characterId || undefined);

  const [selectedAvatarId, setSelectedAvatarId] = useState<string | undefined>(actor?.avatarAssetId);
  const [selectedPortraitId, setSelectedPortraitId] = useState<string | undefined>(actor?.portraitAssetId);

  useEffect(() => {
    if (open && actor) {
      setSelectedAvatarId(actor.avatarAssetId);
      setSelectedPortraitId(actor.portraitAssetId);
    }
  }, [open, actor]);

  const allAssets = assetsData?.items || [];
  const avatarCandidates = allAssets.filter((a) => a.kind === 'avatar');
  const portraitCandidates = allAssets.filter((a) => a.kind === 'portrait');

  // 如果角色未指定，默认选择第一个
  useEffect(() => {
    if (open && !selectedAvatarId && avatarCandidates.length > 0) {
      setSelectedAvatarId(avatarCandidates[0].id);
    }
    if (open && !selectedPortraitId && portraitCandidates.length > 0) {
      setSelectedPortraitId(portraitCandidates[0].id);
    }
  }, [open, avatarCandidates, portraitCandidates, selectedAvatarId, selectedPortraitId]);

  const handleSave = () => {
    const chosenAvatar = allAssets.find((a) => a.id === selectedAvatarId);
    const chosenPortrait = allAssets.find((a) => a.id === selectedPortraitId);

    onConfirm({
      avatarAssetId: chosenAvatar?.id,
      avatarUrl: chosenAvatar?.url,
      portraitAssetId: chosenPortrait?.id,
      portraitUrl: chosenPortrait?.url,
    });
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`为 ${actor?.displayName || '角色'} 挑选本场形象`}
      description="活动中（剧情对话、群聊与动态）可自由指定使用该角色的哪款头像和立绘。默认使用主设定。"
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="accent" size="sm" onClick={handleSave}>
            确认选用
          </Button>
        </div>
      }
    >
      <div className="space-y-6 py-2">
        {isLoading && (
          <div className="flex items-center justify-center py-12 text-muted gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <span className="text-xs">加载角色资产库…</span>
          </div>
        )}

        {!isLoading && (
          <>
            {/* 1. 挑选头像 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-ink flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-accent" />
                  <span>选择本场头像 ({avatarCandidates.length})</span>
                </label>
                <span className="text-[11px] text-muted">用于剧情对话框、群聊头像</span>
              </div>

              {avatarCandidates.length === 0 ? (
                <div className="text-xs text-muted py-4 text-center border border-dashed border-border-default rounded-lg">
                  暂无独立头像资产（将沿用角色默认头像）
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-36 overflow-y-auto p-1">
                  {avatarCandidates.map((asset) => {
                    const isSelected = selectedAvatarId === asset.id;
                    return (
                      <div
                        key={asset.id}
                        onClick={() => setSelectedAvatarId(asset.id)}
                        className={`group relative aspect-square rounded-xl border cursor-pointer overflow-hidden p-1 transition-all flex items-center justify-center ${
                          isSelected
                            ? 'border-accent bg-accent/10 ring-2 ring-accent shadow-sm'
                            : 'border-border-default bg-surface hover:border-border-hover'
                        }`}
                      >
                        <div className="relative h-full w-full rounded-lg overflow-hidden">
                          <Image
                            src={asset.url}
                            alt="头像"
                            fill
                            unoptimized
                            className="object-cover"
                          />
                        </div>
                        {isSelected && (
                          <div className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white shadow-xs">
                            <Check className="h-2.5 w-2.5" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 2. 挑选立绘 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-ink flex items-center gap-1.5">
                  <ImageIcon className="h-3.5 w-3.5 text-purple-500" />
                  <span>选择本场立绘 ({portraitCandidates.length})</span>
                </label>
                <span className="text-[11px] text-muted">用于舞台大图、朋友圈半身照</span>
              </div>

              {portraitCandidates.length === 0 ? (
                <div className="text-xs text-muted py-4 text-center border border-dashed border-border-default rounded-lg">
                  暂无独立立绘资产（可在角色资料库中「多源获取」添加）
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 max-h-56 overflow-y-auto p-1">
                  {portraitCandidates.map((asset) => {
                    const isSelected = selectedPortraitId === asset.id;
                    return (
                      <div
                        key={asset.id}
                        onClick={() => setSelectedPortraitId(asset.id)}
                        className={`group relative aspect-[3/4] rounded-xl border cursor-pointer overflow-hidden p-1.5 transition-all flex flex-col items-center justify-center ${
                          isSelected
                            ? 'border-purple-500 bg-purple-500/10 ring-2 ring-purple-500 shadow-sm'
                            : 'border-border-default bg-surface hover:border-border-hover'
                        }`}
                      >
                        <div className="relative h-full w-full rounded-lg overflow-hidden bg-surface-muted">
                          <Image
                            src={asset.url}
                            alt="立绘"
                            fill
                            unoptimized
                            className="object-contain"
                          />
                        </div>
                        {isSelected && (
                          <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-purple-600 text-white shadow-xs">
                            <Check className="h-3 w-3" />
                          </div>
                        )}
                        <span className="mt-1 text-[10px] text-fg-subtle truncate max-w-full">
                          {asset.userNote || '官方立绘'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
