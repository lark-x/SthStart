'use client';

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { analyzeWorkflowInput, createWorkflowConfig, saveWorkflowDraft } from '../api';
import type { AnalyzedInput, DraftPayload, Engine, WorkflowAnalyzeResponse } from '../types';

/**
 * 导入对话框（规划 §6.1）：原生 API JSON 分析 / 配置包恢复 / GUI JSON 明确拒绝。
 * 导入先只分析，不发布、不提交生成；用户确认名称与连接后创建工作流外壳与草稿。
 */

export function WorkflowImportDialog({
  open,
  onOpenChange,
  engines,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engines: Engine[];
  onImported: (workflowId: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rawText, setRawText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<WorkflowAnalyzeResponse | null>(null);
  const [name, setName] = useState('');
  const [engineId, setEngineId] = useState('');
  const [enabledKeys, setEnabledKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const reset = () => {
    setRawText('');
    setAnalysis(null);
    setName('');
    setEngineId('');
    setEnabledKeys(new Set());
    setError('');
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setRawText(await file.text());
  };

  const runAnalyze = async () => {
    setAnalyzing(true);
    setError('');
    try {
      const parsed: unknown = JSON.parse(rawText);
      if (!parsed || typeof parsed !== 'object') throw new Error('内容必须是 JSON 对象。');
      const looksLikeBundle = 'workflow' in (parsed as Record<string, unknown>) && 'version' in (parsed as Record<string, unknown>);
      const result = await analyzeWorkflowInput(looksLikeBundle ? { bundle: parsed } : { definition: parsed });
      setAnalysis(result);
      setEnabledKeys(new Set(result.inputs.filter((item) => item.autoMapped).map((item) => item.key)));
      if (!name && result.packageInfo?.name) setName(result.packageInfo.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setAnalysis(null);
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleKey = (key: string) => {
    setEnabledKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const createShell = async () => {
    if (!analysis) return;
    setCreating(true);
    setError('');
    try {
      const suggestedDraft = analysis.suggestedDraft as unknown as DraftPayload;
      // 只启用用户确认的字段：未确认的输入保留在工作流定义中，不映射为参数。
      const fields = analysis.packageInfo ? suggestedDraft.editorConfig?.fields ?? {} : Object.fromEntries(Object.entries(suggestedDraft.editorConfig?.fields ?? {})
        .filter(([key]) => enabledKeys.has(key)));
      const bindings = analysis.packageInfo ? suggestedDraft.nodeBindings : Object.fromEntries(Object.entries(suggestedDraft.nodeBindings ?? {})
        .filter(([key]) => enabledKeys.has(key)));
      const inputSchema = analysis.packageInfo ? suggestedDraft.inputSchema : Object.fromEntries(Object.entries(suggestedDraft.inputSchema ?? {})
        .filter(([key]) => enabledKeys.has(key)));
      if (!analysis.packageInfo) {
        for (const item of analysis.inputs.filter((item) => enabledKeys.has(item.key))) {
          bindings[item.key] = [item.nodeId, 'inputs', item.inputName];
          if (!inputSchema[item.key]) {
            inputSchema[item.key] = {
              type: typeof item.currentValue === 'boolean' ? 'boolean' : typeof item.currentValue === 'number' ? (Number.isInteger(item.currentValue) ? 'integer' : 'number') : 'string',
              ...(item.kind !== 'seed' && item.currentValue != null ? { default: item.currentValue } : {}),
              ...(item.enumValues?.length ? { enum: item.enumValues } : {}),
            };
          }
        }
      }
      const draft: DraftPayload = {
        ...suggestedDraft,
        name: name.trim() || null,
        engineId: engineId || null,
        inputSchema,
        nodeBindings: bindings,
        editorConfig: suggestedDraft.editorConfig ? {
          ...suggestedDraft.editorConfig, fields,
          loraSlots: suggestedDraft.editorConfig.loraSlots.filter((slot) => fields[slot.nameKey] && fields[slot.strengthKey]),
        } : null,
      };
      const created = await createWorkflowConfig({
        name: name.trim() || '未命名工作流',
        category: (draft.category ?? 'image') as 'image' | 'video' | 'audio' | 'transform',
        engineKind: engineId ? (engines.find((item) => item.id === engineId)?.kind ?? 'comfyui') : 'comfyui',
      });
      await saveWorkflowDraft(created.id, 1, draft);
      onImported(created.id);
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const inputBadge = (item: AnalyzedInput) => item.confidence === 'known' ? 'known' : 'guessed';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}
      title="导入工作流"
      description="支持 ComfyUI 原生 API 格式（节点 ID 为对象键）与本项目配置包；带 nodes 数组的画布导出会被拒绝。"
      size="lg"
    >
      <div className="space-y-4">
        {!analysis && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-label="选择工作流 JSON 文件" onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ''; }} />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />选择 JSON 文件
              </Button>
              <span className="text-sm text-muted">或直接粘贴 JSON 内容</span>
            </div>
            <textarea
              aria-label="工作流 JSON 内容"
              className="h-48 w-full rounded-[var(--radius-control)] border border-border-default bg-surface p-2 font-mono text-xs"
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              placeholder='{"3": {"class_type": "KSampler", "inputs": {...}}, ...}'
              spellCheck={false}
            />
            <div className="flex justify-end gap-2">
              <Button variant="primary" onClick={() => { void runAnalyze(); }} loading={analyzing} disabled={!rawText.trim()}>分析</Button>
            </div>
          </>
        )}

        {analysis && (
          <>
            {error && <Alert variant="danger" title="操作失败" onDismiss={() => setError('')}>{error}</Alert>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="import-name" className="mb-1 block text-sm font-medium text-ink">工作流名称</label>
                <Input id="import-name" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div>
                <label htmlFor="import-engine" className="mb-1 block text-sm font-medium text-ink">执行连接</label>
                <Select id="import-engine" value={engineId} onChange={(event) => setEngineId(event.target.value)}>
                  <option value="">稍后选择</option>
                  {engines.map((engine) => (
                    <option key={engine.id} value={engine.id}>{engine.name}（{engine.kind === 'comfyui' ? '直连' : engine.kind}）</option>
                  ))}
                </Select>
              </div>
            </div>
            <p className="text-sm text-muted">
              {analysis.source === 'config-package' ? '识别为配置包。' : '识别为原生 API JSON。'}共 {analysis.nodeCount} 个节点，{analysis.inputs.length} 个候选输入，{analysis.outputCandidates.length} 个输出节点候选。
              {analysis.packageInfo?.presetCount ? ` 包含 ${analysis.packageInfo.presetCount} 个预设；本入口只恢复工作流草稿，预设需在保存版本后重新创建，不会自动开放用途。` : ''}
            </p>
            {analysis.warnings.length > 0 && (
              <Alert variant="warning" title="分析提示">
                <ul className="list-disc space-y-1 pl-4">{analysis.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
              </Alert>
            )}
            {analysis.packageInfo ? <p className="text-sm text-muted">保留配置包中的原始字段、默认值与节点绑定，不重新套用自动识别结果。</p> : <div className="max-h-56 space-y-1 overflow-y-auto rounded-[var(--radius-control)] border border-border-subtle p-2">
              {analysis.inputs.map((item) => (
                <label key={item.key} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={enabledKeys.has(item.key)}
                    onChange={() => toggleKey(item.key)}
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{item.modelLabel ?? item.inputName}</span>
                    <code className="ml-1 text-muted">{item.nodeId}.inputs.{item.inputName}</code>
                    <span className="ml-1 text-fg-subtle">
                      {item.classType} · {inputBadge(item) === 'known' ? '已识别' : '需确认'}
                      {item.modelCategory ? ` · ${item.modelCategory}` : ''}
                    </span>
                    {item.note && <span className="block text-muted">{item.note}</span>}
                  </span>
                </label>
              ))}
            </div>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setAnalysis(null); }}>重新分析</Button>
              <Button variant="primary" onClick={() => { void createShell(); }} loading={creating}>创建并打开编辑器</Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
