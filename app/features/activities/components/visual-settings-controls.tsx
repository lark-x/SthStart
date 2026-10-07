'use client';
import { useEffect, useState } from 'react';
import type { BeatRenderPreview, DirectorSettings } from '@sthstart/contracts';
import { Input } from '@/app/components/ui/input';
import { DIRECTOR_OPTIONS, toggleDirectorSetting, validVisualNumericValue } from '../structured-director';

export function StructuredDirectorControls({ value = {}, onChange, disabled, includeShotSize = true }: {
  value?: DirectorSettings; onChange(value: DirectorSettings): void; disabled?: boolean; includeShotSize?: boolean;
}) {
  const labels = { shotSize: '景别', angle: '角度', lighting: '光影', mood: '氛围' };
  return <div aria-label="结构化导演设置" className="space-y-2 rounded-[var(--radius-control)] bg-surface-muted p-3">
    {(Object.keys(DIRECTOR_OPTIONS) as Array<keyof DirectorSettings>).filter(key => includeShotSize || key !== 'shotSize').map(key => <fieldset key={key} className="flex min-w-0 flex-wrap items-center gap-1.5">
      <legend className="float-left mr-2 text-xs font-semibold text-muted">{labels[key]}</legend>
      {DIRECTOR_OPTIONS[key].map(option => <button key={option.value} type="button" disabled={disabled} aria-pressed={value[key] === option.value}
        onClick={() => onChange(toggleDirectorSetting(value, key, option.value))}
        className={`rounded-full px-2.5 py-1 text-xs transition-colors ${value[key] === option.value ? 'bg-accent text-white' : 'bg-surface text-ink hover:bg-surface-hover'} disabled:opacity-50`}>{option.label}</button>)}
    </fieldset>)}
    <p className="text-xs text-muted">未选择的项跟随描述；这些设置不会改写你填写的补充提示词。</p>
  </div>;
}

/** Both beat and comic controls consume the server projection, not a frontend guess at workflow defaults. */
export function VisualParameterFields({ fields, values, onChange, onValidityChange, disabled, recoveryKey }: {
  fields: BeatRenderPreview['fields']; values: Record<string, unknown>;
  onChange(values: Record<string, unknown>): void; onValidityChange?(valid: boolean): void; disabled?: boolean; recoveryKey?: string;
}) {
  const [invalidDrafts, setInvalidDrafts] = useState<Record<string, string>>(() => {
    if (!recoveryKey || typeof window === 'undefined') return {};
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(recoveryKey) ?? '{}');
      if (stored && typeof stored === 'object' && !Array.isArray(stored))
        return Object.fromEntries(Object.entries(stored).filter(([, value]) => typeof value === 'string'));
    } catch { /* Optional recovery never overrides the last valid persisted values. */ }
    return {};
  });
  useEffect(() => {
    if (!recoveryKey) return;
    try {
      if (Object.keys(invalidDrafts).length) sessionStorage.setItem(recoveryKey, JSON.stringify(invalidDrafts));
      else sessionStorage.removeItem(recoveryKey);
    } catch { /* In-memory input remains available if storage is unavailable. */ }
  }, [invalidDrafts, recoveryKey]);
  useEffect(() => { onValidityChange?.(Object.keys(invalidDrafts).length === 0); }, [invalidDrafts, onValidityChange]);
  const update = (key: string, value: unknown) => {
    const next = { ...values };
    if (value === undefined) delete next[key]; else next[key] = value;
    onChange(next);
  };
  const clearInvalid = (key: string) => setInvalidDrafts(previous => { const next = { ...previous }; delete next[key]; return next; });
  return <div className="grid gap-3 sm:grid-cols-2">{fields.filter(field => field.type !== 'long-text' && field.type !== 'prompt').map(field => {
    const value = values[field.key] ?? field.value ?? '';
    const numeric = ['integer','number','seed'].includes(field.type);
    const locked = field.type === 'model' && !field.modelEditable;
    const choices = field.allowedModels ?? field.enumValues;
    return <label key={field.key} className="min-w-0 space-y-1"><span className="block text-xs font-medium text-muted">{field.label}{field.required ? ' · 必填' : ''}{locked ? ' · 预设锁定' : ''}</span>
      {locked ? <p className="rounded bg-surface-muted px-3 py-2 text-sm text-ink break-words">{String(value) || '由预设指定'}</p>
        : field.type === 'boolean' ? <input type="checkbox" aria-label={field.label} disabled={disabled} checked={Boolean(value)} onChange={event => update(field.key, event.target.checked)} />
          : choices?.length ? <select aria-label={field.label} disabled={disabled} value={String(value)} className="h-10 w-full rounded border border-border-control bg-surface px-3 text-sm" onChange={event => update(field.key, event.target.value)}>{choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}{!choices.includes(String(value)) && <option value={String(value)}>{String(value) || '当前默认值'}</option>}</select>
            : <Input aria-label={field.label} aria-invalid={field.key in invalidDrafts} disabled={disabled} type={numeric ? 'number' : 'text'} min={field.minimum} max={field.maximum} step={field.step ?? (field.type === 'integer' || field.type === 'seed' ? 1 : undefined)}
              value={invalidDrafts[field.key] ?? String(value)} onChange={event => {
                const raw = event.target.value;
                if (!numeric) { update(field.key, raw); return; }
                if (!raw.trim() && !field.required) { clearInvalid(field.key); update(field.key, undefined); return; }
                const next = validVisualNumericValue(raw, field);
                if (next === null) { setInvalidDrafts(previous => ({ ...previous, [field.key]: raw })); return; }
                clearInvalid(field.key); update(field.key, next);
              }} />}
      {field.key in invalidDrafts && <span role="alert" className="block text-xs text-danger-fg">请填写范围{field.minimum ?? '不限'}～{field.maximum ?? '不限'}、步长 {field.step ?? 1} 的有效数值。</span>}
    </label>;
  })}</div>;
}
