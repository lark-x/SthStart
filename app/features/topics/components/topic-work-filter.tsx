'use client';
import { useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { AnchoredPopover } from '@/app/components/ui/anchored-popover';

/** Shared work facet: a non-modal popover with a stable trigger and keyboard close. */
export function TopicWorkFilter({ options, value, onChange }: { options: string[]; value: string[]; onChange: (value: string[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <AnchoredPopover
      title="按作品筛选"
      open={open}
      onOpenChange={setOpen}
      align="start"
      side="bottom"
      trigger={
        <Button type="button" size="sm" variant="outline" aria-expanded={open} aria-haspopup="dialog" className="h-9 w-full justify-between sm:w-auto">
          {value.length ? `作品（${value.length}）` : '全部作品'}
        </Button>
      }
    >
      <div className="max-h-60 min-w-48 overflow-y-auto">
        <Button type="button" size="sm" variant="ghost" className="mb-2 px-1 text-accent" disabled={!value.length} onClick={() => onChange([])}>清除作品筛选</Button>
        <div className="space-y-1">
          {options.map((work) => (
            <Checkbox key={work} label={work} checked={value.includes(work)} onChange={(event) => onChange(event.target.checked ? [...value, work] : value.filter((item) => item !== work))} />
          ))}
        </div>
        {!options.length && <p className="text-sm text-muted">暂无作品</p>}
      </div>
    </AnchoredPopover>
  );
}
