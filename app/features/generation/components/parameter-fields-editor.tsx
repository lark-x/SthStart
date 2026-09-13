'use client';

import { useMemo } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { EmptyState } from '@/app/components/ui/empty-state';
import type { DraftPayload } from '../types';

/**
 * 参数页签（规划 §8）：字段键与节点绑定决定执行位置；名称/顺序/分组决定呈现；
 * 默认值、范围与枚举唯一存于 inputSchema，界面只引用字段键。
 */

interface UnmappedInput {
  nodeId: string;
  inputName: string;
  classType: string;
  value: unknown;
}

const EXCLUDED_INPUT_NAMES = new Set(['control_after_generate']);

export function collectUnmappedInputs(draft: DraftPayload): UnmappedInput[] {
  const bound = new Set(Object.values(draft.nodeBindings).map((path) => `${path[0]}::${path[2]}`));
  const result: UnmappedInput[] = [];
  for (const [nodeId, nodeValue] of Object.entries(draft.definition)) {
    const node = nodeValue as { class_type?: string; inputs?: Record<string, unknown> };
    if (!node || typeof node !== 'object' || !node.inputs || typeof node.inputs !== 'object') continue;
    for (const [inputName, value] of Object.entries(node.inputs)) {
      if (EXCLUDED_INPUT_NAMES.has(inputName)) continue;
      if (Array.isArray(value)) continue; // 连线数组不是参数
      if (node.class_type === 'LoadImage' && inputName === 'image') continue; // 媒体槽位
      if (bound.has(`${nodeId}::${inputName}`)) continue;
      result.push({ nodeId, inputName, classType: String(node.class_type ?? ''), value });
    }
  }
  return result;
}

function nextFieldOrder(draft: DraftPayload): number {
  const orders = Object.values(draft.editorConfig?.fields ?? {}).map((field) => field.order);
  return orders.length ? Math.max(...orders) + 1 : 100;
}

export function ParameterFieldsEditor({
  draft,
  updateDraft,
}: {
  draft: DraftPayload;
  updateDraft: (mutator: (current: DraftPayload) => DraftPayload) => void;
}) {
  const fields = useMemo(() => {
    if (!draft.editorConfig) return [];
    return Object.values(draft.editorConfig.fields).sort((left, right) => left.order - right.order);
  }, [draft.editorConfig]);

  const unmapped = useMemo(() => collectUnmappedInputs(draft), [draft]);

  const schemaFor = (key: string): Record<string, unknown> => {
    const entry = draft.inputSchema[key];
    return entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {};
  };

  const patchField = (key: string, schemaPatch: Record<string, unknown>, fieldPatch?: Record<string, unknown>) => {
    updateDraft((current) => {
      const entry = current.inputSchema[key];
      const baseSchema = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
      const next: DraftPayload = {
        ...current,
        inputSchema: { ...current.inputSchema, [key]: { ...baseSchema, ...schemaPatch } },
      };
      if (fieldPatch && next.editorConfig?.fields[key]) {
        const field = next.editorConfig.fields[key];
        next.editorConfig = {
          ...next.editorConfig,
          fields: { ...next.editorConfig.fields, [key]: { ...field, ...fieldPatch } },
        };
      }
      return next;
    });
  };

  const mapInput = (item: UnmappedInput) => {
    const key = `${item.nodeId}_${item.inputName}`.replace(/[^A-Za-z0-9_.-]/g, '_');
    const isNumber = typeof item.value === 'number';
    const isBoolean = typeof item.value === 'boolean';
    updateDraft((current) => ({
      ...current,
      inputSchema: {
        ...current.inputSchema,
        [key]: {
          type: isBoolean ? 'boolean' : isNumber ? (Number.isInteger(item.value) ? 'integer' : 'number') : 'string',
          ...(item.value !== '' && item.value != null ? { default: item.value } : {}),
        },
      },
      nodeBindings: { ...current.nodeBindings, [key]: [item.nodeId, 'inputs', item.inputName] },
      editorConfig: current.editorConfig ? {
        ...current.editorConfig,
        fields: {
          ...current.editorConfig.fields,
          [key]: {
            key,
            label: item.inputName,
            description: `来自节点 ${item.nodeId}（${item.classType}）`,
            section: 'advanced',
            order: nextFieldOrder(current),
          },
        },
      } : current.editorConfig,
    }));
  };

  if (!draft.editorConfig || fields.length === 0) {
    return (
      <EmptyState
        title="还没有业务字段"
        description="导入分析会自动识别提示词、尺寸等常用输入；也可以在下方把未知节点输入映射为业务字段。"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {fields.map((field) => {
          const schema = schemaFor(field.key);
          const type = (field.type ?? (typeof schema.type === 'string' ? schema.type : 'text')) as string;
          const isNumeric = type === 'integer' || type === 'number' || type === 'seed';
          const enumValues = Array.isArray(schema.enum) ? schema.enum as string[] : [];
          return (
            <div key={field.key} className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`param-label-${field.key}`} className="mb-1 block text-sm font-medium text-ink">显示名称</label>
                  <Input id={`param-label-${field.key}`} value={field.label} onChange={(event) => patchField(field.key, {}, { label: event.target.value })} />
                </div>
                <div className="w-36">
                  <label htmlFor={`param-section-${field.key}`} className="mb-1 block text-sm font-medium text-ink">显示层级</label>
                  <Select id={`param-section-${field.key}`} value={field.section} onChange={(event) => patchField(field.key, {}, { section: event.target.value as 'basic' | 'advanced' | 'fixed' })}>
                    <option value="basic">常用</option>
                    <option value="advanced">高级</option>
                    <option value="fixed">固定（不可被覆盖）</option>
                  </Select>
                </div>
                <div className="w-40">
                  <label htmlFor={`param-order-${field.key}`} className="mb-1 block text-sm font-medium text-ink">排序</label>
                  <Input id={`param-order-${field.key}`} type="number" value={String(field.order)} onChange={(event) => patchField(field.key, {}, { order: Number(event.target.value) || 0 })} />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                {type === 'enum' || enumValues.length > 0 ? (
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`param-enum-${field.key}`} className="mb-1 block text-sm font-medium text-ink">枚举值（逗号分隔）</label>
                    <Input
                      id={`param-enum-${field.key}`}
                      value={enumValues.join(', ')}
                      onChange={(event) => patchField(field.key, { type: 'enum', enum: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })}
                    />
                  </div>
                ) : null}
                {isNumeric ? (
                  <>
                    <div className="w-28">
                      <label htmlFor={`param-min-${field.key}`} className="mb-1 block text-sm font-medium text-ink">最小值</label>
                      <Input id={`param-min-${field.key}`} type="number" value={schema.minimum == null ? '' : String(schema.minimum)} onChange={(event) => patchField(field.key, { minimum: event.target.value === '' ? undefined : Number(event.target.value) })} />
                    </div>
                    <div className="w-28">
                      <label htmlFor={`param-max-${field.key}`} className="mb-1 block text-sm font-medium text-ink">最大值</label>
                      <Input id={`param-max-${field.key}`} type="number" value={schema.maximum == null ? '' : String(schema.maximum)} onChange={(event) => patchField(field.key, { maximum: event.target.value === '' ? undefined : Number(event.target.value) })} />
                    </div>
                    <div className="w-28">
                      <label htmlFor={`param-step-${field.key}`} className="mb-1 block text-sm font-medium text-ink">步进</label>
                      <Input id={`param-step-${field.key}`} type="number" step="any" value={schema.step == null ? '' : String(schema.step)} onChange={(event) => patchField(field.key, { step: event.target.value === '' ? undefined : Number(event.target.value) })} />
                    </div>
                  </>
                ) : null}
                <div className="min-w-0 flex-1">
                  <label htmlFor={`param-default-${field.key}`} className="mb-1 block text-sm font-medium text-ink">默认值</label>
                  {type === 'boolean' ? (
                    <Select id={`param-default-${field.key}`} value={schema.default === true ? 'true' : 'false'} onChange={(event) => patchField(field.key, { default: event.target.value === 'true' })}>
                      <option value="true">开</option>
                      <option value="false">关</option>
                    </Select>
                  ) : enumValues.length > 0 ? (
                    <Select id={`param-default-${field.key}`} value={String(schema.default ?? '')} onChange={(event) => patchField(field.key, { default: event.target.value })}>
                      <option value="">（空）</option>
                      {enumValues.map((value) => <option key={value} value={value}>{value}</option>)}
                    </Select>
                  ) : (
                    <Input
                      id={`param-default-${field.key}`}
                      type={isNumeric ? 'number' : 'text'}
                      step={isNumeric ? 'any' : undefined}
                      value={schema.default == null ? '' : String(schema.default)}
                      onChange={(event) => patchField(field.key, { default: isNumeric ? (event.target.value === '' ? undefined : Number(event.target.value)) : event.target.value })}
                    />
                  )}
                </div>
              </div>
              <p className="mt-2 text-sm text-fg-subtle">
                字段键 <code>{field.key}</code> → {draft.nodeBindings[field.key]?.join(' · ') ?? '未绑定节点'}
              </p>
            </div>
          );
        })}
      </div>

      {unmapped.length > 0 && (
        <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-3">
          <h3 className="text-sm font-semibold text-ink">未映射的节点输入（{unmapped.length}）</h3>
          <p className="mt-1 text-sm text-muted">这些输入保留在工作流定义中不会丢失；确认后可映射为业务字段暴露到表单。</p>
          <ul className="mt-2 space-y-1">
            {unmapped.slice(0, 24).map((item) => (
              <li key={`${item.nodeId}::${item.inputName}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  <code>{item.nodeId}.inputs.{item.inputName}</code>
                  <span className="text-muted"> · {item.classType} · 当前值「{String(item.value ?? '').slice(0, 40)}」</span>
                </span>
                <Button type="button" size="sm" variant="outline" onClick={() => mapInput(item)}>映射为字段</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
