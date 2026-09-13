'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import type { DraftPayload } from '../types';

/**
 * 输入与输出页签（规划 §6.2）：参考图槽位（媒体能力 + 节点绑定）与输出节点声明。
 * 绑定目标必须是存在的节点输入；媒体仍走原有上传链路，客户端只提交 artifactId。
 */

interface MediaSlot {
  mediaTypes?: string[];
  maxBytes?: number;
  required?: boolean;
  maxCount?: number;
  semantic?: string;
}

function scalarStringInputs(draft: DraftPayload): Array<{ nodeId: string; inputName: string; classType: string }> {
  const result: Array<{ nodeId: string; inputName: string; classType: string }> = [];
  for (const [nodeId, nodeValue] of Object.entries(draft.definition)) {
    const node = nodeValue as { class_type?: string; inputs?: Record<string, unknown> };
    if (!node || typeof node !== 'object' || !node.inputs || typeof node.inputs !== 'object') continue;
    for (const [inputName, value] of Object.entries(node.inputs)) {
      if (typeof value !== 'string') continue;
      if (Array.isArray(value)) continue;
      result.push({ nodeId, inputName, classType: String(node.class_type ?? '') });
    }
  }
  return result;
}

export function IoFieldsEditor({
  draft,
  updateDraft,
}: {
  draft: DraftPayload;
  updateDraft: (mutator: (current: DraftPayload) => DraftPayload) => void;
}) {
  const slots = useMemo(() => draft.inputCapabilities ?? {}, [draft.inputCapabilities]);
  const candidateInputs = useMemo(() => scalarStringInputs(draft), [draft]);
  const outputCandidates = useMemo(() => Object.entries(draft.definition)
    .filter(([, node]) => /Save/.test(String((node as { class_type?: string }).class_type ?? '')) || String((node as { class_type?: string }).class_type ?? '').endsWith('VideoCombine'))
    .map(([id]) => id), [draft.definition]);
  const [newSlotKey, setNewSlotKey] = useState('');
  const [newSlotTypes, setNewSlotTypes] = useState('image/png, image/jpeg, image/webp');

  const setCapabilities = (next: Record<string, unknown>) => {
    updateDraft((current) => ({ ...current, inputCapabilities: next }));
  };

  const patchSlot = (key: string, patch: Partial<MediaSlot>) => {
    const entry = slots[key];
    const base: MediaSlot = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as MediaSlot : {};
    setCapabilities({ ...slots, [key]: { ...base, ...patch } });
  };

  const setBinding = (key: string, nodeId: string, inputName: string) => {
    updateDraft((current) => ({
      ...current,
      nodeBindings: { ...current.nodeBindings, [key]: [nodeId, 'inputs', inputName] },
    }));
  };

  const addSlot = () => {
    const key = newSlotKey.trim();
    if (!key || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || slots[key]) return;
    const mediaTypes = newSlotTypes.split(',').map((item) => item.trim()).filter(Boolean);
    setCapabilities({ ...slots, [key]: { mediaTypes, required: false } });
    setNewSlotKey('');
  };

  const removeSlot = (key: string) => {
    const next = { ...slots };
    delete next[key];
    setCapabilities(next);
    updateDraft((current) => {
      const bindings = { ...current.nodeBindings };
      delete bindings[key];
      return { ...current, nodeBindings: bindings };
    });
  };

  const toggleOutput = (nodeId: string) => {
    updateDraft((current) => {
      const has = current.outputDeclarations.includes(nodeId);
      return {
        ...current,
        outputDeclarations: has ? current.outputDeclarations.filter((id) => id !== nodeId) : [...current.outputDeclarations, nodeId],
      };
    });
  };

  const bindingFor = (key: string): string => {
    const path = draft.nodeBindings[key];
    return Array.isArray(path) && path.length === 3 ? `${path[0]}::${path[2]}` : '';
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <header>
          <h3 className="text-sm font-semibold text-ink">媒体输入槽位</h3>
          <p className="text-sm text-muted">每个槽位对应工作流的一个媒体输入；上传仍走系统媒体链路，客户端只提交引用 ID。</p>
        </header>
        {Object.keys(slots).length === 0 && (
          <p className="text-sm text-fg-subtle">尚未声明媒体槽位。文生图工作流可以不声明；图生图需要至少一个图片槽位。</p>
        )}
        {Object.entries(slots).map(([key, rawSlot]) => {
          const slot = (rawSlot && typeof rawSlot === 'object' && !Array.isArray(rawSlot) ? rawSlot : {}) as MediaSlot;
          const mediaTypes = Array.isArray(slot.mediaTypes) ? slot.mediaTypes.join(', ') : '';
          return (
            <div key={key} className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-44">
                  <label htmlFor={`slot-types-${key}`} className="mb-1 block text-sm font-medium text-ink">允许 MIME</label>
                  <Input id={`slot-types-${key}`} value={mediaTypes} onChange={(event) => patchSlot(key, { mediaTypes: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />
                </div>
                <div className="w-36">
                  <label htmlFor={`slot-semantic-${key}`} className="mb-1 block text-sm font-medium text-ink">语义</label>
                  <Select id={`slot-semantic-${key}`} value={slot.semantic ?? ''} onChange={(event) => patchSlot(key, { semantic: event.target.value || undefined })}>
                    <option value="">（无）</option>
                    <option value="init_image">init_image</option>
                    <option value="identity">identity</option>
                    <option value="outfit">outfit</option>
                    <option value="pose">pose</option>
                    <option value="style">style</option>
                    <option value="composition">composition</option>
                    <option value="mask">mask</option>
                  </Select>
                </div>
                <label className="flex items-center gap-2 pb-1.5 text-sm">
                  <input type="checkbox" checked={slot.required === true} onChange={(event) => patchSlot(key, { required: event.target.checked })} />
                  必填
                </label>
                <div className="ml-auto flex items-end gap-2">
                  <div className="w-64">
                    <label htmlFor={`slot-binding-${key}`} className="mb-1 block text-sm font-medium text-ink">节点绑定</label>
                    <Select id={`slot-binding-${key}`} value={bindingFor(key)} onChange={(event) => {
                      const [nodeId, inputName] = event.target.value.split('::');
                      if (nodeId && inputName) setBinding(key, nodeId, inputName);
                    }}>
                      <option value="">未绑定</option>
                      {candidateInputs.map((item) => (
                        <option key={`${item.nodeId}::${item.inputName}`} value={`${item.nodeId}::${item.inputName}`}>
                          {item.nodeId}.inputs.{item.inputName}（{item.classType}）
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button type="button" size="sm" variant="outline" className="mb-0.5" onClick={() => removeSlot(key)}>移除</Button>
                </div>
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius-panel)] border border-dashed border-border-default p-3">
          <div className="w-44">
            <label htmlFor="new-slot-key" className="mb-1 block text-sm font-medium text-ink">新槽位键</label>
            <Input id="new-slot-key" value={newSlotKey} onChange={(event) => setNewSlotKey(event.target.value)} placeholder="例如 sourceImage" />
          </div>
          <div className="w-64">
            <label htmlFor="new-slot-types" className="mb-1 block text-sm font-medium text-ink">允许 MIME</label>
            <Input id="new-slot-types" value={newSlotTypes} onChange={(event) => setNewSlotTypes(event.target.value)} />
          </div>
          <Button type="button" size="sm" variant="outline" className="mb-0.5" onClick={addSlot}>添加槽位</Button>
        </div>
      </section>

      <section className="space-y-2">
        <header>
          <h3 className="text-sm font-semibold text-ink">输出节点</h3>
          <p className="text-sm text-muted">勾选保存类节点作为产物来源；至少需要一个，否则无法收集生成结果。</p>
        </header>
        {outputCandidates.length === 0 && <p className="text-sm text-fg-subtle">未识别到保存类节点；请检查工作流定义中是否包含 SaveImage 等输出节点。</p>}
        <div className="flex flex-wrap gap-3">
          {outputCandidates.map((nodeId) => {
            const node = draft.definition[nodeId] as { class_type?: string } | undefined;
            return (
              <label key={nodeId} className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border-subtle bg-surface px-3 py-2 text-sm">
                <input type="checkbox" checked={draft.outputDeclarations.includes(nodeId)} onChange={() => toggleOutput(nodeId)} />
                <code>{nodeId}</code>
                <span className="text-muted">{node?.class_type}</span>
              </label>
            );
          })}
        </div>
        <div className="w-72">
          <label htmlFor="output-media-types" className="mb-1 block text-sm font-medium text-ink">输出 MIME 类型（逗号分隔）</label>
          <Input
            id="output-media-types"
            value={(draft.outputMediaTypes ?? []).join(', ')}
            onChange={(event) => updateDraft((current) => ({ ...current, outputMediaTypes: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))}
          />
        </div>
      </section>
    </div>
  );
}
