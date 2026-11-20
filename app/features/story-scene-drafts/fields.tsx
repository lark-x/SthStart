import { useId, type ReactNode } from 'react';
import { Input, type InputProps } from '@/app/components/ui/input';
import { Textarea, type TextareaProps } from '@/app/components/ui/textarea';

export const textClass = 'text-sm leading-relaxed text-muted';
export const surfaceClass = 'min-w-0 rounded-panel bg-surface p-4 shadow-[0_0_0_1px_var(--hairline)] sm:p-6';

export function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return <div className="min-w-0 space-y-1.5">
    <label className="block text-sm font-medium" htmlFor={id}>{label}</label>
    {children(id)}
  </div>;
}

export function SceneInput({ label, ...props }: InputProps & { label: string; name: string }) {
  return <Field label={label}>{id => <Input id={id} className="max-sm:text-base" {...props} />}</Field>;
}

export function SceneText({ label, className, ...props }: TextareaProps & { label: string; name: string }) {
  return <Field label={label}>{id => <Textarea id={id} className={`max-sm:text-base ${className ?? ''}`} {...props} />}</Field>;
}

export function Choice<T extends string>({ label, name, value, options, onChange, disabled }: {
  label: string; name: string; value: T | null; options: { value: T; label: string; description?: string }[];
  onChange: (value: T) => void; disabled?: boolean;
}) {
  return <fieldset disabled={disabled} className="min-w-0">
    <legend className="mb-2 text-sm font-medium">{label}</legend>
    <div className="flex flex-wrap gap-2">
      {options.map(option => <label key={option.value} className="flex min-h-11 min-w-0 cursor-pointer items-start gap-2 rounded-control border border-border-default bg-surface px-3 py-2.5 text-sm hover:bg-surface-hover has-checked:border-accent has-checked:bg-[var(--selection-bg)] has-disabled:cursor-default">
        <input className="mt-1 shrink-0 accent-accent" type="radio" name={name} value={option.value} checked={option.value === value} onChange={() => onChange(option.value)} />
        <span className="min-w-0"><span>{option.label}</span>{option.description && <span className="mt-1 block text-xs text-muted">{option.description}</span>}</span>
      </label>)}
    </div>
  </fieldset>;
}
