'use client';

import { BookOpen, Lightbulb } from 'lucide-react';
import type { StoryProjectType } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';

const OPTIONS = [
  {
    value: 'fiction' as const,
    label: '剧情创作',
    description: '小说章节、大纲、世界观与角色设定，串联制作版本。',
    icon: BookOpen,
  },
  {
    value: 'reflection' as const,
    label: '对话感想',
    description: '记录与角色聊天、剧情体验后的随笔、复盘与灵感摘录。',
    icon: Lightbulb,
  },
];

/** Two project kinds share one choice treatment in the create overlay. */
export function StoryProjectTypeChoice({
  value,
  onChange,
}: {
  value: StoryProjectType;
  onChange: (value: StoryProjectType) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label="项目类型">
      {OPTIONS.map(({ value: option, label, description, icon: Icon }) => {
        const selected = value === option;
        return (
          <Button
            key={option}
            type="button"
            variant={selected ? 'secondary' : 'outline'}
            aria-pressed={selected}
            data-selected={selected || undefined}
            onClick={() => onChange(option)}
            className={`h-auto min-h-20 flex-col items-start gap-1.5 whitespace-normal p-3 text-left ${
              selected ? 'border-accent ring-1 ring-accent/40' : ''
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Icon className="size-4 text-muted" aria-hidden="true" />
              {label}
            </span>
            <span className="text-xs font-normal leading-relaxed text-muted">{description}</span>
          </Button>
        );
      })}
    </div>
  );
}
