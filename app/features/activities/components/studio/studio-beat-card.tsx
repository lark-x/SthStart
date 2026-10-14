'use client';

import React from 'react';
import Image from 'next/image';
import {
  Camera,
  Film,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react';
import type { ActorSnapshot, SceneBeat } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';

interface StudioBeatCardProps {
  index: number;
  beat: SceneBeat;
  actors: ActorSnapshot[];
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<SceneBeat>) => void;
  onDelete: () => void;
  onInsertBelow: () => void;
  onQuickGenerate: () => void;
  isGenerating?: boolean;
}

export function StudioBeatCard({
  index,
  beat,
  actors,
  isSelected,
  onSelect,
  onUpdate,
  onDelete,
  onInsertBelow,
  onQuickGenerate,
  isGenerating = false,
}: StudioBeatCardProps) {
  const actor = actors.find((a) => a.id === beat.characterId);
  const isNarrator = !beat.characterId || beat.characterId === 'narrator';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      onInsertBelow();
    }
  };

  return (
    <div
      onClick={onSelect}
      className={`group relative rounded-xl border p-3 transition-all cursor-pointer bg-surface ${
        isSelected
          ? 'border-accent ring-1 ring-accent/30 shadow-2xs'
          : 'border-border-default hover:border-border-default/80 hover:shadow-2xs'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* 左侧：序号与角色头像 */}
        <div className="flex flex-col items-center gap-1.5 shrink-0 pt-0.5">
          <span className="font-mono text-[10px] font-bold text-muted">
            #{index + 1}
          </span>
          <div className="relative h-8 w-8 rounded-full overflow-hidden border border-border-default bg-surface-muted shrink-0">
            {actor?.avatarUrl ? (
              <Image
                src={actor.avatarUrl}
                alt={actor.displayName}
                fill
                unoptimized
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-muted">
                {isNarrator ? '旁' : actor?.displayName.slice(0, 1) || '角'}
              </div>
            )}
          </div>
        </div>

        {/* 中间：对白与动作输入区 */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* 角色选择器与卡片操作 */}
          <div className="flex items-center justify-between gap-2">
            <select
              value={beat.characterId || 'narrator'}
              onChange={(e) => {
                const charId = e.target.value;
                const chosen = actors.find((a) => a.id === charId);
                onUpdate({
                  characterId: charId,
                  characterName: chosen?.displayName || (charId === 'narrator' ? '旁白' : '角色'),
                });
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-6 rounded bg-surface-muted px-2 text-xs font-bold text-ink border border-transparent hover:border-border-default focus:border-accent outline-none cursor-pointer"
            >
              <option value="narrator">旁白 / 场景交代</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}{a.activityRole ? ` (${a.activityRole})` : ''}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onInsertBelow();
                }}
                className="h-6 px-1.5 rounded text-[11px] text-muted hover:text-ink hover:bg-surface-muted transition-colors flex items-center gap-0.5"
                title="在下方插入新镜头 (Shift+Enter)"
              >
                <Plus className="h-3 w-3" />
                <span>加镜</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="h-6 w-6 rounded flex items-center justify-center text-muted hover:text-red-600 hover:bg-red-500/10 transition-colors"
                title="删除此分镜"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* 对白台词输入（行内直编） */}
          <div>
            <textarea
              rows={2}
              value={beat.dialogue || ''}
              onChange={(e) => onUpdate({ dialogue: e.target.value })}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              placeholder="输入角色台词或内心独白..."
              className="w-full resize-none rounded-lg bg-surface-muted/50 p-2 text-xs font-medium text-ink placeholder:text-muted/60 border border-transparent hover:border-border-default focus:border-accent focus:bg-surface outline-none transition-all leading-relaxed"
            />
          </div>

          {/* 动作描写输入 */}
          <div>
            <input
              value={beat.action || ''}
              onChange={(e) => onUpdate({ action: e.target.value })}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              placeholder="动作、神态或画面事件描述..."
              className="w-full rounded px-2 py-1 text-[11px] text-muted placeholder:text-muted/50 bg-transparent border border-transparent hover:border-border-subtle focus:border-accent focus:bg-surface outline-none transition-all"
            />
          </div>
        </div>

        {/* 右侧：镜头画面缩略图与即时生图 */}
        <div className="shrink-0 w-28 sm:w-32 flex flex-col items-center justify-center">
          {beat.mediaUrl ? (
            <div className="relative aspect-video w-full rounded-lg overflow-hidden border border-border-default group/media">
              <Image
                src={beat.mediaUrl}
                alt={beat.action || '分镜画面'}
                fill
                unoptimized
                className="object-cover transition-transform group-hover/media:scale-105"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickGenerate();
                }}
                className="absolute inset-0 bg-ink/40 opacity-0 group-hover/media:opacity-100 flex items-center justify-center gap-1 text-white text-[10px] font-semibold transition-opacity backdrop-blur-2xs cursor-pointer"
                title="重新绘制此画面"
              >
                <RefreshCw className="h-3 w-3" />
                <span>重绘</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onQuickGenerate();
              }}
              disabled={isGenerating}
              className="aspect-video w-full rounded-lg border border-dashed border-border-default bg-surface-muted/40 hover:bg-accent/5 hover:border-accent/40 flex flex-col items-center justify-center gap-1 text-muted hover:text-accent transition-all cursor-pointer p-1"
              title="一键出图"
            >
              {isGenerating ? (
                <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
              ) : (
                <Sparkles className="h-4 w-4 text-accent/80" />
              )}
              <span className="text-[10px] font-semibold">
                {isGenerating ? '绘制中' : '生成画面'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
