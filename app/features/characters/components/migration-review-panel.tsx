'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { fetchCharacterMigrationReview } from '../api';
import { characterKeys } from '@/app/lib/query-keys';

/** 复核项类别的中文说明：用户不需要知道内部 kind 名称。 */
const CONFLICT_LABELS: Record<string, string> = {
  ambiguous_appearance: '外貌与穿着的分界需要确认',
  accessory_placement: '配饰归属需要确认',
  mixed_extra_rules: '旧额外规则需要确认',
  ambiguous_legacy_prompt: '旧正文与结构化人设并存',
};

/**
 * 迁移复核面板。
 *
 * 结构升级时不替用户消解语义冲突，只把「哪里没把握、旧数据原本是什么」摆出来，
 * 让人能对照归档原文做判断（规划第 7 节）。没有复核项时整块不显示。
 */
export function MigrationReviewPanel({ characterId }: { characterId?: string }) {
  const { data } = useQuery({
    queryKey: characterKeys.migrationReview(characterId ?? ''),
    queryFn: () => fetchCharacterMigrationReview(characterId as string),
    enabled: Boolean(characterId),
  });

  if (!characterId || !data || !data.hasArchive) return null;
  const hasConflicts = data.conflicts.length > 0;
  const extraOutfits = data.archivedOutfits.filter((outfit) => outfit && outfit !== data.current.defaultOutfitText);
  if (!hasConflicts && extraOutfits.length === 0) return null;

  return (
    <section className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-4 space-y-3">
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <History className="h-4 w-4 text-accent" aria-hidden="true" />
          结构迁移复核
        </h4>
        <p className="mt-0.5 text-sm text-muted">
          升级到新版人设结构时，以下内容无法自动判断归属，原文都已保留。确认后按需要手工整理即可。
          {data.archivedAt && <span className="ml-1">归档时间：{data.archivedAt.slice(0, 10)}。</span>}
        </p>
      </div>

      {hasConflicts && (
        <ul className="space-y-1.5">
          {data.conflicts.map((conflict, index) => (
            <li key={`${conflict.kind}-${index}`} className="rounded border border-border-subtle bg-paper p-2 text-xs">
              <p className="font-semibold text-ink">{CONFLICT_LABELS[conflict.kind] ?? conflict.kind}</p>
              <p className="mt-0.5 text-muted">{conflict.detail}</p>
            </li>
          ))}
        </ul>
      )}

      {extraOutfits.length > 0 && (
        <div className="rounded border border-border-subtle bg-paper p-2 text-xs">
          <p className="font-semibold text-ink">旧数据里还有这些未生效的服装</p>
          <p className="mt-0.5 text-muted">当前默认穿着是「{data.current.defaultOutfitText || '（空）'}」。需要保留的话，把它们写进「外观与素材」的默认穿着里。</p>
          <ul className="mt-1 space-y-0.5 text-muted">
            {extraOutfits.map((outfit) => <li key={outfit}>· {outfit}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
