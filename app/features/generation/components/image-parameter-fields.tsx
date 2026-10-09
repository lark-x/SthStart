'use client';

import { useId } from 'react';
import type { GenerationFieldContract, ImageConfiguration } from '@sthstart/contracts';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';

export function ImageParameterFields({ fields, values, onChange, disabled, modelChoices = [] }: {
  fields: GenerationFieldContract[]; values: Record<string, unknown>; onChange(key: string, value: unknown): void;
  disabled?: boolean; modelChoices?: ImageConfiguration['modelChoices'];
}) {
  const prefix = useId();
  return <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">{fields.map(field => {
    const id = `${prefix}-${field.key}`;
    const value = (Object.hasOwn(values, field.key) ? values[field.key] : field.defaultValue) ?? '';
    const numeric = ['integer', 'number', 'seed'].includes(field.type);
    const options = field.type === 'model'
      ? modelChoices.filter(model => (!field.modelCategory || model.category === field.modelCategory)
        && (!field.allowedModels?.length || field.allowedModels.includes(model.name))).map(model => model.name)
      : field.enumValues ?? [];
    const locked = field.type === 'model' && field.modelEditable !== true;
    return <div key={field.key} className={`min-w-0 space-y-1.5 ${field.type === 'long-text' || locked ? 'sm:col-span-2' : ''}`}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">{field.label}{locked ? ' · 随预设切换' : ''}</label>
      {locked ? <p id={id} className="break-words rounded-[var(--radius-control)] bg-surface-muted p-2.5 text-sm text-muted">{String(value) || '未指定'}</p>
        : options.length || field.type === 'model' ? <Select id={id} disabled={disabled || (field.type === 'model' && !options.length)} value={String(value)} onChange={event => onChange(field.key, event.target.value || undefined)}>
          <option value="">使用默认</option>
          {!options.includes(String(value)) && value !== '' && <option value={String(value)}>{String(value)}（当前值）</option>}
          {options.map(option => <option key={option} value={option}>{option}</option>)}
        </Select> : field.type === 'boolean' ? <Select id={id} disabled={disabled} value={String(value === true)} onChange={event => onChange(field.key, event.target.value === 'true')}><option value="false">关闭</option><option value="true">开启</option></Select>
          : field.type === 'long-text' ? <Textarea id={id} disabled={disabled} rows={3} value={String(value)} onChange={event => onChange(field.key, event.target.value)} />
            : <Input id={id} disabled={disabled} type={numeric ? 'number' : 'text'} value={String(value)} min={field.minimum} max={field.maximum}
              step={field.step ?? (numeric && field.type !== 'number' ? 1 : 'any')}
              onChange={event => onChange(field.key, event.target.value === '' ? (field.type === 'seed' ? null : '') : numeric ? Number(event.target.value) : event.target.value)} />}
      {field.type === 'model' && !locked && !options.length && <p className="text-xs text-muted">暂无可选模型，保留当前值；请在连接设置中刷新模型发现。</p>}
      {field.description && <p className="text-xs leading-relaxed text-muted">{field.description}</p>}
    </div>;
  })}</div>;
}
