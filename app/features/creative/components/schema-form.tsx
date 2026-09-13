'use client';

import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { InputLabel } from '../input-label';
import type { FieldContract } from '@/app/features/generation/types';

/**
 * 共享 schema 参数表单（规划 §10.1/§15）：字段集合、默认值与范围全部来自服务端契约，
 * 客户端不自行决定哪些字段可编辑。basic 字段常驻，advanced 字段折叠展示。
 */

export function SchemaFieldInput({
  field,
  idPrefix,
  value,
  onChange,
}: {
  field: FieldContract;
  idPrefix: string;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const id = `${idPrefix}-${field.key}`;
  if (field.type === 'model') {
    return null; // 模型选择由工作流/预设选择器单独呈现
  }
  if (field.type === 'enum' && field.enumValues?.length) {
    return (
      <div>
        <InputLabel htmlFor={id} hint={field.required ? undefined : '可选'}>{field.label}</InputLabel>
        <Select id={id} className="mt-1.5" value={value == null || value === '' ? '' : String(value)} onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}>
          <option value="">（使用默认）</option>
          {field.enumValues.map((item) => <option key={item} value={item}>{item}</option>)}
        </Select>
      </div>
    );
  }
  if (field.type === 'integer' || field.type === 'number') {
    return (
      <div>
        <InputLabel htmlFor={id} hint={field.required ? undefined : '可选'}>{field.label}</InputLabel>
        <Input
          id={id}
          className="mt-1.5"
          type="number"
          step={field.step ?? (field.type === 'integer' ? 1 : 'any')}
          min={field.minimum}
          max={field.maximum}
          value={value == null ? '' : String(value)}
          onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
        />
      </div>
    );
  }
  if (field.type === 'boolean') {
    return (
      <div>
        <InputLabel htmlFor={id}>{field.label}</InputLabel>
        <Select id={id} className="mt-1.5" value={value === true ? 'true' : 'false'} onChange={(event) => onChange(event.target.value === 'true')}>
          <option value="false">关</option>
          <option value="true">开</option>
        </Select>
      </div>
    );
  }
  if (field.type === 'long-text') {
    return (
      <div>
        <InputLabel htmlFor={id} hint={field.required ? undefined : '可选'}>{field.label}</InputLabel>
        <Textarea id={id} className="mt-1.5 min-h-[96px]" value={value == null ? '' : String(value)} onChange={(event) => onChange(event.target.value)} maxLength={10000} />
      </div>
    );
  }
  return (
    <div>
      <InputLabel htmlFor={id} hint={field.required ? undefined : '可选'}>{field.label}</InputLabel>
      <Input id={id} className="mt-1.5" value={value == null ? '' : String(value)} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

export function SchemaForm({
  fields,
  idPrefix,
  values,
  onValueChange,
}: {
  fields: FieldContract[];
  idPrefix: string;
  values: Record<string, unknown>;
  onValueChange: (key: string, value: unknown) => void;
}) {
  const basic = fields.filter((field) => field.section === 'basic');
  const advanced = fields.filter((field) => field.section === 'advanced');
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {basic.map((field) => (
          <div key={field.key} className={field.type === 'long-text' || field.type === 'text' ? 'col-span-2' : undefined}>
            <SchemaFieldInput field={field} idPrefix={idPrefix} value={values[field.key]} onChange={(value) => onValueChange(field.key, value)} />
          </div>
        ))}
      </div>
      {advanced.length > 0 && (
        <details className="border-t border-border-subtle pt-3">
          <summary className="cursor-pointer text-sm text-muted">高级参数 · 采样与更多</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {advanced.map((field) => (
              <div key={field.key} className={field.type === 'long-text' || field.type === 'text' ? 'col-span-2' : undefined}>
                <SchemaFieldInput field={field} idPrefix={idPrefix} value={values[field.key]} onChange={(value) => onValueChange(field.key, value)} />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
