'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import {
  Sparkles,
  Check,
  Loader2,
  ExternalLink,
  Image as ImageIcon,
  User,
} from 'lucide-react';
import type { CharacterOfficialAssetCandidate } from '@sthstart/contracts';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { useToast } from '@/app/providers/ui-provider';
import {
  usePreviewCharacterOfficialAssets,
  useImportCharacterAssets,
} from '../mutations';

interface CharacterMultiSourceDialogProps {
  characterId: string;
  characterName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function CharacterMultiSourceDialog({
  characterId,
  characterName,
  open,
  onOpenChange,
  onSuccess,
}: CharacterMultiSourceDialogProps) {
  const toast = useToast();
  const [candidates, setCandidates] = useState<CharacterOfficialAssetCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [setActiveAvatar, setSetActiveAvatar] = useState(true);
  const [setActivePortrait, setSetActivePortrait] = useState(true);

  const previewMutation = usePreviewCharacterOfficialAssets();
  const importMutation = useImportCharacterAssets();

  // Load preview when dialog opens
  useEffect(() => {
    if (!open || !characterId) return;
    setCandidates([]);
    setSelectedIds(new Set());

    previewMutation.mutate(characterId, {
      onSuccess: (data) => {
        setCandidates(data.items);
        // 默认全选所有探测到的优质资产
        const allIds = new Set(data.items.map((item) => item.id));
        setSelectedIds(allIds);
      },
      onError: (err) => {
        toast.error('探测多源官方资产失败', err instanceof Error ? err.message : String(err));
      },
    });
  }, [open, characterId]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(candidates.map((c) => c.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleImport = async () => {
    const selected = candidates.filter((c) => selectedIds.has(c.id));
    if (selected.length === 0) {
      toast.warning('请至少勾选一个要导入的资产');
      return;
    }

    // Determine setAsActive flag for each asset
    let avatarSet = false;
    let portraitSet = false;
    const payloadAssets = selected.map((item) => {
      let setAsActive = false;
      if (item.kind === 'avatar' && setActiveAvatar && !avatarSet) {
        setAsActive = true;
        avatarSet = true;
      } else if (item.kind === 'portrait' && setActivePortrait && !portraitSet) {
        setAsActive = true;
        portraitSet = true;
      }
      return {
        kind: item.kind,
        url: item.url,
        source: item.source,
        title: item.title,
        setAsActive,
      };
    });

    try {
      const res = await importMutation.mutateAsync({
        id: characterId,
        payload: { items: payloadAssets },
      });
      toast.success(`成功导入 ${res.imported.length} 个官方形象资产并保存到本地！`);
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error('导入资产失败', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`多源获取头像与立绘 · ${characterName}`}
      description="自动探测 BWiki (B站游戏维基)、Enka CDN (解包图)、官方角色百科等多个来源，支持勾选后一键保存到本地。"
      size="lg"
      footer={
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-4 text-xs text-muted">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={setActiveAvatar}
                onChange={(e) => setSetActiveAvatar(e.target.checked)}
                className="rounded border-border-default text-accent focus:ring-accent"
              />
              <span>首选头像设为主头像</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={setActivePortrait}
                onChange={(e) => setSetActivePortrait(e.target.checked)}
                className="rounded border-border-default text-accent focus:ring-accent"
              />
              <span>首设立绘设为主立绘</span>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="accent"
              size="sm"
              disabled={selectedIds.size === 0 || importMutation.isPending}
              loading={importMutation.isPending}
              onClick={handleImport}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              <span>导入选中的资产 ({selectedIds.size})</span>
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 py-2">
        {/* Loading State */}
        {previewMutation.isPending && (
          <div className="flex flex-col items-center justify-center py-16 text-muted space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
            <p className="text-sm font-medium">正在并发探测 BWiki、Enka CDN 等官方资源库…</p>
            <p className="text-xs text-fg-subtle">可能需要 2~5 秒进行高清资源有效性核验</p>
          </div>
        )}

        {/* Empty State */}
        {!previewMutation.isPending && candidates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted space-y-2 border border-dashed border-border-default rounded-xl bg-surface-muted/40">
            <ImageIcon className="h-10 w-10 opacity-40 text-muted" />
            <p className="text-sm font-medium text-ink">未在已知官方源中探测到匹配资产</p>
            <p className="text-xs text-fg-subtle max-w-md text-center">
              请检查角色名或英文名是否准确（如「奥黛塔」Odette、「芙宁娜」Furina），或使用「本地上传」与「图片链接导入」手动添加。
            </p>
          </div>
        )}

        {/* Results list */}
        {!previewMutation.isPending && candidates.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted pb-1 border-b border-border-subtle">
              <span>共找到 {candidates.length} 个官方形象候选资源</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-accent hover:underline"
                >
                  全选
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="text-muted hover:underline"
                >
                  清空
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[460px] overflow-y-auto p-1">
              {candidates.map((candidate) => {
                const isSelected = selectedIds.has(candidate.id);
                return (
                  <div
                    key={candidate.id}
                    onClick={() => toggleSelect(candidate.id)}
                    className={`group relative rounded-xl border p-2 cursor-pointer transition-all ${
                      isSelected
                        ? 'border-accent bg-accent/5 ring-1 ring-accent shadow-sm'
                        : 'border-border-default bg-surface hover:border-border-hover'
                    }`}
                  >
                    {/* Checkbox indicator in top-right */}
                    <div
                      className={`absolute top-3 right-3 z-10 flex h-5 w-5 items-center justify-center rounded-md border text-white transition-colors ${
                        isSelected
                          ? 'bg-accent border-accent'
                          : 'bg-surface/80 border-border-default group-hover:border-accent'
                      }`}
                    >
                      {isSelected && <Check className="h-3.5 w-3.5" />}
                    </div>

                    {/* Image Preview */}
                    <div
                      className={`relative w-full rounded-lg overflow-hidden bg-surface-muted border border-border-subtle flex items-center justify-center ${
                        candidate.kind === 'avatar' ? 'aspect-square' : 'aspect-[3/4]'
                      }`}
                    >
                      <Image
                        src={candidate.previewUrl || candidate.url}
                        alt={candidate.title}
                        fill
                        unoptimized
                        className={candidate.kind === 'avatar' ? 'object-cover' : 'object-contain'}
                        onError={(e) => {
                          const img = e.currentTarget as HTMLImageElement;
                          if (!img.src.includes('/api/admin/proxy-image')) {
                            img.src = `/api/admin/proxy-image?url=${encodeURIComponent(candidate.url)}`;
                          }
                        }}
                      />
                    </div>

                    {/* Meta info */}
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            candidate.kind === 'avatar'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                              : 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                          }`}
                        >
                          {candidate.kind === 'avatar' ? (
                            <>
                              <User className="h-2.5 w-2.5" />
                              头像
                            </>
                          ) : (
                            <>
                              <ImageIcon className="h-2.5 w-2.5" />
                              立绘
                            </>
                          )}
                        </span>
                        <span className="text-[10px] text-fg-subtle truncate max-w-[110px]" title={candidate.source}>
                          {candidate.source}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-ink truncate" title={candidate.title}>
                        {candidate.title}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
