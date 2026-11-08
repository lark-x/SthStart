'use client';

import React from 'react';
import Image from 'next/image';
import {
  LoaderCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { ActorSnapshot, SceneBeat } from '@sthstart/contracts';
import { isImeComposingEvent } from '@/app/lib/hooks/use-cjk-ime-guard';

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
  const actorName = isNarrator ? '旁白' : actor?.displayName || beat.characterName || '角色';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isImeComposingEvent(e)) return;
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      onInsertBelow();
    }
  };

  return (
    <article
      onClick={onSelect}
      aria-current={isSelected ? 'true' : undefined}
      aria-label={`分镜 ${index + 1} · ${actorName}`}
      className={`group/beat relative cursor-pointer px-3 py-4 transition-colors sm:px-5 ${
        isSelected ? 'bg-surface' : 'hover:bg-surface/60'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-4 left-0 w-0.5 rounded-full transition-colors ${
          isSelected ? 'bg-accent' : 'bg-transparent'
        }`}
      />

      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 gap-y-2 lg:grid-cols-[2.75rem_minmax(0,1fr)_9rem] lg:gap-x-4">
        {/* 固定左列：镜号与角色 */}
        <div className="flex flex-col items-start gap-2">
          <span className="font-mono text-xs font-medium tabular-nums text-muted">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full bg-surface-sunken ring-1 ring-border-subtle">
            {actor?.avatarUrl ? (
              <Image
                src={actor.avatarUrl}
                alt=""
                fill
                unoptimized
                className="object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-muted">
                {isNarrator ? '旁' : actorName.slice(0, 1)}
              </span>
            )}
          </div>
        </div>

        {/* 固定中列：角色 → 对白 → 动作 */}
        <div className="min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <select
              aria-label={`分镜 ${index + 1} 角色`}
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
              onFocus={onSelect}
              className="h-9 min-w-0 max-w-full cursor-pointer truncate border-0 bg-transparent p-0 text-base font-semibold text-ink outline-none hover:text-accent focus-visible:outline focus-visible:outline-accent lg:h-8 lg:text-sm"
            >
              <option value="narrator">旁白 / 场景交代</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}{a.activityRole ? ` · ${a.activityRole}` : ''}
                </option>
              ))}
            </select>

            <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity lg:opacity-0 lg:focus-within:opacity-100 lg:group-hover/beat:opacity-100">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onInsertBelow();
                }}
                className="flex h-9 w-9 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline focus-visible:outline-accent lg:h-7 lg:w-7"
                title="在下方插入镜头 (Shift+Enter)"
                aria-label={`在分镜 ${index + 1} 下方插入镜头`}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="flex h-9 w-9 items-center justify-center rounded-control text-muted transition-colors hover:bg-danger-bg hover:text-danger-fg focus-visible:outline focus-visible:outline-accent lg:h-7 lg:w-7"
                title="删除此分镜"
                aria-label={`删除分镜 ${index + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <textarea
            aria-label={`分镜 ${index + 1} 对白`}
            rows={2}
            value={beat.dialogue || ''}
            onChange={(e) => onUpdate({ dialogue: e.target.value })}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            onFocus={onSelect}
            placeholder="输入角色台词或内心独白…"
            className="min-h-14 w-full resize-none border-0 border-b border-transparent bg-transparent p-0 pb-1 text-base font-medium leading-7 text-ink outline-none transition-colors placeholder:font-normal placeholder:text-muted/60 hover:border-border-subtle focus:border-accent lg:text-[15px] lg:leading-6"
          />

          <input
            aria-label={`分镜 ${index + 1} 动作`}
            value={beat.action || ''}
            onChange={(e) => onUpdate({ action: e.target.value })}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            onFocus={onSelect}
            placeholder="动作 / 神态 / 画面事件"
            className="h-9 w-full border-0 bg-transparent p-0 text-base text-muted outline-none transition-colors placeholder:text-muted/60 hover:text-ink focus:text-ink lg:h-7 lg:text-sm"
          />
        </div>

        {/* 固定右列：镜头画面 */}
        <div className="col-start-2 lg:col-start-3 lg:row-start-1">
          {beat.mediaUrl ? (
            <div className="group/media relative h-36 w-full overflow-hidden rounded-control border border-border-subtle bg-surface-sunken lg:aspect-video lg:h-auto">
              <Image
                src={beat.mediaUrl}
                alt={beat.action || `分镜 ${index + 1} 画面`}
                fill
                unoptimized
                className="object-cover"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickGenerate();
                }}
                className="absolute inset-0 flex items-center justify-center gap-1 bg-ink/20 text-xs font-medium text-white opacity-100 backdrop-blur-[1px] transition-opacity focus-visible:opacity-100 lg:bg-ink/45 lg:opacity-0 lg:group-hover/media:opacity-100"
                title="重新绘制此画面"
                aria-label={`重新绘制分镜 ${index + 1} 画面`}
              >
                <RefreshCw className="h-3.5 w-3.5" />
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
              className="flex h-11 w-full items-center justify-center gap-2 rounded-control bg-surface-sunken/40 text-muted transition-colors hover:bg-surface-sunken hover:text-ink disabled:cursor-wait lg:aspect-video lg:h-auto lg:flex-col"
              title="生成此镜头画面"
              aria-label={`生成分镜 ${index + 1} 画面`}
            >
              {isGenerating ? (
                <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span className="text-sm font-medium">
                {isGenerating ? '绘制中' : '生成画面'}
              </span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
