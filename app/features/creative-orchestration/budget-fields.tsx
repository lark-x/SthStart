import React from 'react';
import type { CreativeBudget } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';

export interface CreativeBudgetPreset {
  id: 'light' | 'standard' | 'extended';
  label: string;
  hint: string;
  budget: CreativeBudget;
}

export const CREATIVE_BUDGET_PRESETS: readonly CreativeBudgetPreset[] = [
  {
    id: 'light',
    label: '轻量试写',
    hint: '30 次 · 40 万 tokens · 4 张图',
    budget: {
      maxTextCalls: 30,
      maxImages: 4,
      maxTokens: 400_000,
      maxRevisions: 1,
    },
  },
  {
    id: 'standard',
    label: '标准创作',
    hint: '80 次 · 150 万 tokens · 12 张图',
    budget: {
      maxTextCalls: 80,
      maxImages: 12,
      maxTokens: 1_500_000,
      maxRevisions: 2,
    },
  },
  {
    id: 'extended',
    label: '长篇充足',
    hint: '200 次 · 500 万 tokens · 30 张图',
    budget: {
      maxTextCalls: 200,
      maxImages: 30,
      maxTokens: 5_000_000,
      maxRevisions: 2,
    },
  },
];

export const defaultCreativeBudget: CreativeBudget = {
  ...CREATIVE_BUDGET_PRESETS[1].budget,
};

function matchesPreset(budget: CreativeBudget, preset: CreativeBudget): boolean {
  return (
    budget.maxTextCalls === preset.maxTextCalls &&
    budget.maxImages === preset.maxImages &&
    budget.maxTokens === preset.maxTokens &&
    budget.maxRevisions === preset.maxRevisions
  );
}

function formatTokenBudget(tokens: number): string {
  if (tokens >= 10_000) {
    const wan = tokens / 10_000;
    return `${Number.isInteger(wan) ? wan : wan.toFixed(1)} 万`;
  }
  return tokens.toLocaleString();
}

export function BudgetFields({
  budget,
  onChange,
  disabled = false,
}: {
  budget: CreativeBudget;
  onChange: (budget: CreativeBudget) => void;
  disabled?: boolean;
}) {
  const activePreset = CREATIVE_BUDGET_PRESETS.find((preset) =>
    matchesPreset(budget, preset.budget),
  );

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className="font-medium">执行额度方案</legend>
        <span className="text-xs text-muted">
          当前上限：{budget.maxTextCalls} 次调用 · {formatTokenBudget(budget.maxTokens)} tokens ·{' '}
          {budget.maxImages} 张图 · 最多返修 {budget.maxRevisions} 轮
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="执行额度预设">
        {CREATIVE_BUDGET_PRESETS.map((preset) => {
          const active = activePreset?.id === preset.id;
          return (
            <Button
              key={preset.id}
              type="button"
              size="sm"
              variant={active ? 'primary' : 'outline'}
              aria-pressed={active}
              className="h-auto flex-col items-start gap-0.5 px-3 py-2 text-left"
              onClick={() => onChange({ ...preset.budget })}
            >
              <span className="font-medium">{preset.label}</span>
              <span className="text-xs font-normal opacity-85">{preset.hint}</span>
            </Button>
          );
        })}
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-muted">
          {activePreset ? '自定义细分额度参数' : '已使用自定义额度（展开调整）'}
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {(
            [
              { key: 'maxTextCalls', label: '模型调用次数', min: 1, max: 10000 },
              { key: 'maxImages', label: '图片数量', min: 0, max: 500 },
              { key: 'maxTokens', label: 'tokens 额度（含预留）', min: 100, max: 50000000 },
              { key: 'maxRevisions', label: '自动返修轮数', min: 0, max: 2 },
            ] as const
          ).map((field) => (
            <label key={field.key} className="co-field">
              {field.label}
              <Input
                name={field.key}
                type="number"
                min={field.min}
                max={field.max}
                required
                value={budget[field.key]}
                onChange={(event) => onChange({ ...budget, [field.key]: Number(event.target.value) })}
              />
            </label>
          ))}
        </div>
      </details>
      <p className="text-xs leading-relaxed text-muted">
        达到上限会自动停在当前节点并保留全部候选产物，不会盲目重试或继续扣费。
      </p>
    </fieldset>
  );
}
