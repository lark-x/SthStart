'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { PageHeader } from '@/app/components/shared/page-header';
import { useToast } from '@/app/providers/ui-provider';
import {
  createWorkflowConfig,
  fetchGenerationAssignments,
  fetchGenerationEngines,
  fetchGenerationWorkers,
  fetchGenerationWorkflows,
  fetchMediaDiagnostics,
  importWorkflowBundle,
  publishWorkflowVersion,
  saveCreativeCenterAssignments,
  saveGenerationEngine,
  saveWorkerConfig,
} from './api';
import type { Assignment, Engine, MediaDiagnostics, Worker, Workflow } from './types';
import { versionKey } from './types';
import { AssignmentPanel } from './components/assignment-panel';
import { DiagnosticsPanel } from './components/diagnostics-panel';
import { EnginePanel } from './components/engine-panel';
import { WorkerPanel } from './components/worker-panel';
import { WorkflowEditor } from './components/workflow-editor';
import { WorkflowPanel } from './components/workflow-panel';

const CREATIVE_PURPOSES = ['text-to-image', 'image-to-image', 'h3-t2v', 'h3-i2v', 'h3-fl2va'] as const;

export function GenerationSettingsFeature() {
  const toast = useToast();
  const [engines, setEngines] = useState<Engine[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [diagnostics, setDiagnostics] = useState<MediaDiagnostics | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [workerToken, setWorkerToken] = useState('');
  const [versionWorkflowId, setVersionWorkflowId] = useState('');
  const [creativeBindings, setCreativeBindings] = useState<Record<string, string>>({
    'text-to-image': '', 'image-to-image': '', 'h3-t2v': '', 'h3-i2v': '', 'h3-fl2va': '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [engineItems, workerItems, workflowItems, assignmentItems, diagnosticsData] = await Promise.all([
        fetchGenerationEngines(),
        fetchGenerationWorkers(),
        fetchGenerationWorkflows(),
        fetchGenerationAssignments(),
        fetchMediaDiagnostics(),
      ]);
      setEngines(engineItems);
      setWorkers(workerItems);
      setDiagnostics(diagnosticsData);
      setWorkflows(workflowItems);
      setVersionWorkflowId((current) => workflowItems.some((item) => item.id === current) ? current : workflowItems[0]?.id ?? '');
      const nextBindings: Record<string, string> = Object.fromEntries(CREATIVE_PURPOSES.map((purpose) => [purpose, '']));
      assignmentItems
        .filter((item: Assignment) => item.app_id === 'creative-center')
        .forEach((item) => { nextBindings[item.purpose] = versionKey(item.workflow_id, item.workflow_version); });
      setCreativeBindings(nextBindings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // The first request is intentionally owned by this feature component; the
  // page wrapper remains a pure composition layer.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const publishedVersions = useMemo(
    () => workflows.flatMap((workflow) => workflow.versions.filter((version) => version.isPublished).map((version) => ({ workflow, version }))),
    [workflows],
  );

  const handleError = (prefix: string, err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    setError(message);
    toast.error(prefix, message);
  };

  const saveEngine = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('engine');
    setError('');
    try {
      const data = new FormData(event.currentTarget);
      const value = (name: string) => String(data.get(name) ?? '').trim();
      await saveGenerationEngine({
        id: value('engine-id'), name: value('engine-name'), baseUrl: value('engine-url'),
        secret: value('engine-secret') || undefined, concurrencyLimit: Number(value('engine-concurrency')),
      });
      event.currentTarget.reset();
      await load();
      toast.success('生成引擎已保存');
    } catch (err) {
      handleError('保存生成引擎失败', err);
    } finally {
      setBusy('');
    }
  };

  const createWorkflow = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('workflow');
    setError('');
    try {
      const data = new FormData(event.currentTarget);
      const value = (name: string) => String(data.get(name) ?? '').trim();
      await createWorkflowConfig({
        id: value('workflow-id'), name: value('workflow-name'), description: value('workflow-description'),
        engineKind: 'comfyui', category: (value('workflow-category') || 'image') as 'image' | 'video' | 'audio' | 'transform',
      });
      event.currentTarget.reset();
      await load();
      toast.success('工作流已创建');
    } catch (err) {
      handleError('创建工作流失败', err);
    } finally {
      setBusy('');
    }
  };

  const importWorkflow = async (bundle: unknown) => {
    setBusy('workflow-import');
    setError('');
    try {
      const res = await importWorkflowBundle(bundle);
      await load();
      setVersionWorkflowId(res.workflowId || res.id);
      toast.success(`工作流 ${res.workflowId || res.id} 导入成功 (v${res.version})`);
    } catch (err) {
      handleError('导入工作流失败', err);
    } finally {
      setBusy('');
    }
  };

  const saveWorker = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('worker');
    setError('');
    try {
      const data = new FormData(event.currentTarget);
      const value = (name: string) => String(data.get(name) ?? '').trim();
      const response = await saveWorkerConfig({
        id: value('worker-id'), name: value('worker-name'), baseUrl: value('worker-url'),
        token: value('worker-token') || undefined, model: value('worker-model'), temperature: Number(value('worker-temperature')),
        ipAllowlist: value('worker-ip-allowlist').split(',').map((item) => item.trim()).filter(Boolean),
        diskWarningBytes: Number(value('worker-disk-warning')), diskStopBytes: Number(value('worker-disk-stop')),
      });
      if (response.token) setWorkerToken(response.token);
      event.currentTarget.reset();
      await load();
      toast.success('Windows Worker 已保存');
    } catch (err) {
      handleError('保存 Windows Worker 失败', err);
    } finally {
      setBusy('');
    }
  };

  const publishVersion = async (input: {
    engineId: string;
    inputSchema: string;
    inputCapabilities: string;
    nodeBindings: string;
    outputDeclarations: string;
    outputMediaTypes: string;
    outputSchema: string;
    definition: string;
  }) => {
    if (!versionWorkflowId) return;
    setBusy('version');
    setError('');
    try {
      const parseObject = (value: string, label: string) => {
        const parsed: unknown = JSON.parse(value);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label}必须是 JSON 对象。`);
        return parsed as Record<string, unknown>;
      };
      const parseBindings = (value: string) => parseObject(value, '节点绑定') as Record<string, string[]>;
      const selectedWorkflow = workflows.find((item) => item.id === versionWorkflowId);
      const outputMediaTypes = input.outputMediaTypes.split(',').map((item) => item.trim()).filter(Boolean);
      await publishWorkflowVersion(versionWorkflowId, {
        engineId: input.engineId || undefined,
        inputSchema: parseObject(input.inputSchema, '输入结构'),
        inputCapabilities: parseObject(input.inputCapabilities, '输入媒体能力'),
        nodeBindings: parseBindings(input.nodeBindings),
        outputDeclarations: input.outputDeclarations.split(',').map((item) => item.trim()).filter(Boolean),
        outputMediaTypes: outputMediaTypes.length ? outputMediaTypes : selectedWorkflow?.category === 'video' ? ['video/mp4'] : ['image/png'],
        outputSchema: parseObject(input.outputSchema, '输出结构'),
        definition: parseObject(input.definition, 'ComfyUI API JSON'),
      });
      await load();
      toast.success('工作流版本已发布');
    } catch (err) {
      handleError('发布工作流版本失败', err);
    } finally {
      setBusy('');
    }
  };

  const saveCreativeBindings = async () => {
    const selected = CREATIVE_PURPOSES.map((purpose) => {
      const value = creativeBindings[purpose];
      const match = publishedVersions.find((item) => versionKey(item.workflow.id, item.version.version) === value);
      if (!match) return null;
      const engineId = match.version.engineId || engines.find((engine) => engine.kind === match.workflow.engine_kind)?.id || '';
      return engineId ? { purpose, workflowId: match.workflow.id, workflowVersion: match.version.version, engineId } : null;
    }).filter((item): item is { purpose: typeof CREATIVE_PURPOSES[number]; workflowId: string; workflowVersion: number; engineId: string } => Boolean(item));
    setBusy('assignment');
    setError('');
    try {
      await saveCreativeCenterAssignments(selected);
      await load();
      toast.success('创作中心绑定已保存');
    } catch (err) {
      handleError('保存创作中心绑定失败', err);
    } finally {
      setBusy('');
    }
  };

  return (
    <main className="min-h-screen bg-[#f4f0e7] px-4 py-8 text-[#18201d] sm:px-8 md:px-12">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          backHref="/apps/creative"
          backLabel="返回创作中心"
          eyebrow="GENERATION ADMINISTRATION"
          title="生成工作流配置"
          description="这里管理引擎、版本化 ComfyUI API 工作流、媒体能力和应用绑定。普通创作页面只会看到安全连接状态，不会看到原始凭据。"
          actions={(
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />刷新</Button>
              <a href="/apps/creative" className="inline-flex h-8 items-center gap-1.5 rounded border border-[rgb(24_32_29/18%)] bg-[#fffdf8] px-3 text-xs font-semibold text-[#18201d] hover:bg-[#18201d]/5">创作中心<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>
            </div>
          )}
        />
        {error && <Alert variant="danger" title="生成配置操作失败" onDismiss={() => setError('')}>{error}</Alert>}
        {loading ? (
          <div className="rounded border border-dashed border-[rgb(24_32_29/18%)] bg-[#fffdf8]/70 p-12 text-center text-sm text-[#68716d]">正在读取生成配置…</div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <EnginePanel engines={engines} busy={busy} onSubmit={(event) => { void saveEngine(event); }} />
              <WorkflowPanel workflows={workflows} selectedWorkflowId={versionWorkflowId} busy={busy} onSelect={setVersionWorkflowId} onCreate={(event) => { void createWorkflow(event); }} onImport={(json) => { void importWorkflow(json); }} onImportError={(message) => handleError('导入工作流失败', message)} />
            </div>
            {workerToken && <Alert variant="warning" title="请立即保存 Worker token" onDismiss={() => setWorkerToken('')}>这是本次创建或轮换后唯一一次显示的 token：<code className="mt-1 block break-all rounded bg-black/5 p-2 text-[11px]">{workerToken}</code>请将它写入 Windows Worker 的安全环境变量，之后不会在列表中再次显示。</Alert>}
            <WorkerPanel workers={workers} busy={busy} onSubmit={(event) => { void saveWorker(event); }} />
            <DiagnosticsPanel diagnostics={diagnostics} />
            <WorkflowEditor workflows={workflows} engines={engines} selectedWorkflowId={versionWorkflowId} busy={busy} onSelectWorkflow={setVersionWorkflowId} onPublish={(input) => { void publishVersion(input); }} />
            <AssignmentPanel
              workflows={workflows}
              engines={engines}
              bindings={creativeBindings}
              busy={busy}
              onBindingChange={(purpose, value) => setCreativeBindings((current) => ({ ...current, [purpose]: value }))}
              onSave={() => { void saveCreativeBindings(); }}
            />
          </>
        )}
      </div>
    </main>
  );
}
