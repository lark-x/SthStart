'use client';

import { useState } from 'react';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Download, Copy } from 'lucide-react';
import type { DraftPayload, Engine, Workflow } from '../types';
import { duplicateWorkflow } from '../api';

/**
 * 高级页签（规划 §6.2）：API JSON、节点映射与版本信息只在高级模式展示。
 * 可视化编辑器保存不会删除定义中未映射的内容；此处允许原样检查与导出。
 */

export function AdvancedFieldsEditor({
  workflowId,
  draft,
  workflow,
  baseVersion,
  engines,
  updateDraft,
  onDuplicated,
}: {
  workflowId: string;
  draft: DraftPayload;
  workflow: Workflow | undefined;
  baseVersion: number;
  engines: Engine[];
  updateDraft: (mutator: (current: DraftPayload) => DraftPayload) => void;
  onDuplicated: (newId: string) => void;
}) {
  const [definitionText, setDefinitionText] = useState(() => JSON.stringify(draft.definition, null, 2));
  const [definitionError, setDefinitionError] = useState('');
  const [exporting, setExporting] = useState(false);
  const engine = engines.find((item) => item.id === draft.engineId);

  const applyDefinition = () => {
    try {
      const parsed: unknown = JSON.parse(definitionText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('必须是 JSON 对象');
      updateDraft((current) => ({ ...current, definition: parsed as Record<string, unknown> }));
      setDefinitionError('');
    } catch (error) {
      setDefinitionError(error instanceof Error ? error.message : String(error));
    }
  };

  const duplicate = async () => {
    setExporting(true);
    try {
      const result = await duplicateWorkflow(workflowId);
      onDuplicated(result.id);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Alert variant="info" title="高级区">这里展示原始 ComfyUI API JSON 与节点绑定。可视化编辑器不会删除未映射内容；直接修改 JSON 请自行确认结构有效。</Alert>

      <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-3">
        <h3 className="text-sm font-semibold text-ink">配置信息</h3>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3"><dt className="text-muted">工作流 ID</dt><dd><code>{workflowId}</code></dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">当前版本</dt><dd>v{workflow?.latest_version ?? 0}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">配置格式</dt><dd>{draft.formatVersion === 2 ? 'V2（新编辑器）' : 'V1（旧配置）'}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">草稿基准版本</dt><dd>v{baseVersion}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">执行连接</dt><dd>{engine ? `${engine.name}（${engine.kind === 'comfyui' ? '直连' : engine.kind}）` : '未选择'}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">节点数</dt><dd>{Object.keys(draft.definition).length}</dd></div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => { void duplicate(); }} loading={exporting}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />复制为新工作流
          </Button>
          <a
            href={`/api/admin/generation/workflows/${encodeURIComponent(workflowId)}/versions/${workflow?.latest_version ?? 1}/export`}
            download
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-border-default px-3 text-sm font-medium text-ink hover:bg-ink/4"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />导出当前版本配置包
          </a>
        </div>
      </div>

      <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-3">
        <h3 className="text-sm font-semibold text-ink">ComfyUI API JSON</h3>
        <textarea
          aria-label="ComfyUI API JSON"
          className="mt-2 h-72 w-full rounded-[var(--radius-control)] border border-border-default bg-surface p-2 font-mono text-xs"
          value={definitionText}
          onChange={(event) => setDefinitionText(event.target.value)}
          onBlur={applyDefinition}
          spellCheck={false}
        />
        {definitionError && <p className="mt-1 text-sm text-danger-fg" role="alert">JSON 无效：{definitionError}（未应用修改）</p>}
      </div>

      <div className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-3">
        <h3 className="text-sm font-semibold text-ink">节点绑定</h3>
        <pre className="mt-2 max-h-48 overflow-auto rounded-[var(--radius-control)] bg-ink/4 p-2 font-mono text-xs">{JSON.stringify(draft.nodeBindings, null, 2)}</pre>
      </div>
    </div>
  );
}
