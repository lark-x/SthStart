'use client';

import React from 'react';
import { Camera, Sparkles } from 'lucide-react';

export interface DirectorChipItem {
  id: string;
  label: string;
  tag: string;
  group: 'shot_size' | 'angle' | 'time' | 'lighting' | 'atmosphere';
  category: 'framing' | 'lighting';
}

export const FRAMING_CHIPS: DirectorChipItem[] = [
  { id: 'close-up', label: '特写', tag: 'close-up', group: 'shot_size', category: 'framing' },
  { id: 'medium_shot', label: '中景', tag: 'medium_shot', group: 'shot_size', category: 'framing' },
  { id: 'full_body', label: '全身', tag: 'full_body', group: 'shot_size', category: 'framing' },
  { id: 'close_up', label: '大特写', tag: 'close_up', group: 'shot_size', category: 'framing' },
  { id: 'from_above', label: '俯视', tag: 'from_above', group: 'angle', category: 'framing' },
  { id: 'from_below', label: '仰视', tag: 'from_below', group: 'angle', category: 'framing' },
];

export const LIGHTING_CHIPS: DirectorChipItem[] = [
  { id: 'daytime', label: '自然光', tag: 'daytime', group: 'time', category: 'lighting' },
  { id: 'rim_light', label: '逆光轮廓', tag: 'rim light', group: 'lighting', category: 'lighting' },
  { id: 'warm_light', label: '营地暖光', tag: 'warm light', group: 'lighting', category: 'lighting' },
  { id: 'night_snow', label: '雪夜', tag: 'night, snow', group: 'time', category: 'lighting' },
  { id: 'cold_blizzard', label: '风雪寒冷', tag: 'cold blizzard', group: 'atmosphere', category: 'lighting' },
];

export const ALL_DIRECTOR_CHIPS: DirectorChipItem[] = [...FRAMING_CHIPS, ...LIGHTING_CHIPS];

export function parsePromptSegments(prompt: string): string[] {
  return prompt
    .split(/[,，\n]+\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Extract base Danbooru tag by stripping SD weights ((tag:1.2)), brackets [], {} */
export function extractBaseTag(tag: string): string {
  if (!tag) return '';
  let s = tag.trim();
  s = s.replace(/^[\s(\[{<]+/, '').replace(/[\s)\]}>]+$/, '');
  s = s.replace(/:\s*[-+]?(?:\d*\.?\d+)\s*$/, '');
  return s.trim();
}

/**
 * Normalize tag for matching:
 * - Strips outer weights and brackets
 * - Lowercases and trims
 * - Unifies spaces and underscores, but preserves hyphens (so close-up and close_up don't collide)
 */
export function normalizeTag(tag: string): string {
  const base = extractBaseTag(tag);
  return base.toLowerCase().replace(/\s+/g, '_');
}

/** Check whether a director chip is active in the given prompt */
export function isChipActive(prompt: string, chip: DirectorChipItem): boolean {
  if (!prompt || !prompt.trim()) return false;
  const segments = parsePromptSegments(prompt);
  const segmentNorms = new Set(segments.map(normalizeTag));
  const subTags = chip.tag.split(/[,，\n]+\s*/).map(normalizeTag).filter(Boolean);
  return subTags.length > 0 && subTags.every((sub) => segmentNorms.has(sub));
}

/** Toggle a director chip in the given prompt */
export function toggleChipInPrompt(prompt: string, chip: DirectorChipItem): string {
  let segments = parsePromptSegments(prompt || '');
  const active = isChipActive(prompt, chip);
  const subTags = chip.tag.split(/[,，\n]+\s*/).map(normalizeTag).filter(Boolean);
  const subTagSet = new Set(subTags);

  if (active) {
    // Remove the chip's sub-tags (even if weighted or using underscore/space variants)
    segments = segments.filter((seg) => !subTagSet.has(normalizeTag(seg)));
  } else {
    // Resolve mutual conflicts within the same exclusive group
    if (chip.group === 'shot_size') {
      const shotSizeTags = new Set([
        'close-up',
        'close_up',
        'medium_shot',
        'full_body',
        'wide_shot',
        'cowboy_shot',
        'upper_body',
      ]);
      segments = segments.filter((seg) => !shotSizeTags.has(normalizeTag(seg)));
    } else if (chip.group === 'angle') {
      const angleTags = new Set(['from_above', 'from_below']);
      segments = segments.filter((seg) => !angleTags.has(normalizeTag(seg)));
    } else if (chip.group === 'time') {
      const timeTags = new Set(['daytime', 'night', 'snow', 'bright_sunlight']);
      segments = segments.filter((seg) => !timeTags.has(normalizeTag(seg)));
    }

    // Append the chip's tags
    const toAdd = chip.tag.split(/[,，\n]+\s*/).map((s) => s.trim()).filter(Boolean);
    for (const tag of toAdd) {
      const normTag = normalizeTag(tag);
      if (!segments.some((seg) => normalizeTag(seg) === normTag)) {
        segments.push(tag);
      }
    }
  }

  return segments.join(', ');
}

export interface DirectorChipsProps {
  prompt?: string;
  onChange: (nextPrompt: string) => void;
  disabled?: boolean;
  className?: string;
}

export function DirectorChips({
  prompt = '',
  onChange,
  disabled = false,
  className = '',
}: DirectorChipsProps) {
  return (
    <div
      data-testid="director-chips"
      className={`space-y-1.5 rounded-lg border border-border-default/80 bg-surface-muted/30 p-2 text-xs ${className}`}
    >
      {/* 景别 (Framing) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted shrink-0 w-12">
          <Camera className="h-3 w-3 text-accent" />
          <span>景别</span>
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {FRAMING_CHIPS.map((chip) => {
            const active = isChipActive(prompt, chip);
            return (
              <button
                key={chip.id}
                type="button"
                disabled={disabled}
                onClick={() => onChange(toggleChipInPrompt(prompt, chip))}
                title={`点击切换标签: ${chip.tag}`}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-all cursor-pointer ${
                  active
                    ? 'bg-accent text-white font-semibold shadow-2xs border border-accent ring-1 ring-accent/20'
                    : 'bg-surface text-ink/80 hover:text-ink hover:bg-surface-muted border border-border-default/80'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <span>{chip.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 光影与氛围 (Lighting & Atmosphere) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted shrink-0 w-12">
          <Sparkles className="h-3 w-3 text-amber-500" />
          <span>光影</span>
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {LIGHTING_CHIPS.map((chip) => {
            const active = isChipActive(prompt, chip);
            return (
              <button
                key={chip.id}
                type="button"
                disabled={disabled}
                onClick={() => onChange(toggleChipInPrompt(prompt, chip))}
                title={`点击切换标签: ${chip.tag}`}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-all cursor-pointer ${
                  active
                    ? 'bg-accent text-white font-semibold shadow-2xs border border-accent ring-1 ring-accent/20'
                    : 'bg-surface text-ink/80 hover:text-ink hover:bg-surface-muted border border-border-default/80'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <span>{chip.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
