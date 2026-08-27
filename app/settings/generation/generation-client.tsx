'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Database, ExternalLink, Film, Plus, RefreshCw, Save, Server, Workflow } from 'lucide-react';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import { PageHeader } from '@/app/components/shared/page-header';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { getJson, postJson, putJson } from '@/app/lib/api-client';
import { useToast } from '@/app/providers/ui-provider';

type Engine = { id: string; name: string; kind: 'comfyui' | 'worker' | 'cloud'; base_url: string; enabled: number | boolean; concurrency_limit: number };
type Worker = { engineId: string; name: string; baseUrl: string; enabled: boolean; model: string; temperature: number; concurrencyLimit: 1; ipAllowlist: string[]; diskWarningBytes: number; diskStopBytes: number; state: 'online' | 'offline' | 'unknown'; lastSeenAt: string | null };
type MediaTool = { available: boolean; version: string | null; error: 'not_found' | 'unavailable' | null };
type MediaDiagnostics = { checkedAt: string; video: { ffmpeg: MediaTool; ffprobe: MediaTool; preprocessingReady: boolean; installHint: string | null }; h3: { enabled: boolean; available: boolean; ready: boolean; reason: string; constraints: { maxWidth: 854; maxHeight: 480; maxDurationSeconds: 4; concurrencyLimit: 1 } } };
type WorkflowVersion = { version: number; engineId: string | null; inputSchema: Record<string, unknown>; nodeBindings: Record<string, string[]>; outputDeclarations: string[]; isPublished: boolean };
type Workflow = { id: string; name: string; description: string; engine_kind: Engine['kind']; latest_version: number; versions: WorkflowVersion[] };
type Assignment = { app_id: string; purpose: string; workflow_id: string; workflow_version: number; engine_id: string };

const SAMPLE_DEFINITION = JSON.stringify({
  '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
  '3': { class_type: 'KSampler', inputs: { seed: 0, steps: 20 } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'SthStart' } },
}, null, 2);

function versionKey(workflowId: string, version: number) {
  return `${workflowId}::${version}`;
}

export function GenerationSettings() {
  const toast = useToast();
  const [engines, setEngines] = useState<Engine[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [diagnostics, setDiagnostics] = useState<MediaDiagnostics | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [workerToken, setWorkerToken] = useState('');
  const [engineForm, setEngineForm] = useState({ id: '', name: '', baseUrl: 'http://127.0.0.1:8188', secret: '', concurrencyLimit: '1' });
  const [workerForm, setWorkerForm] = useState({ id: '', name: '', baseUrl: 'http://127.0.0.1:9200', token: '', model: '', temperature: '0.7', allowedIps: '127.0.0.1', diskWarningBytes: '10737418240', diskStopBytes: '2147483648' });
  const [workflowForm, setWorkflowForm] = useState({ id: '', name: '', description: '' });
  const [versionWorkflowId, setVersionWorkflowId] = useState('');
  const [versionForm, setVersionForm] = useState({ engineId: '', inputSchema: '{\n  "prompt": { "type": "string" }\n}', nodeBindings: '{\n  "prompt": ["1", "inputs", "text"]\n}', outputDeclarations: '9', definition: SAMPLE_DEFINITION });
  const [creativeBindings, setCreativeBindings] = useState<Record<string, string>>({ 'text-to-image': '', 'image-to-image': '' });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [engineResponse, workerResponse, workflowResponse, assignmentResponse, diagnosticsResponse] = await Promise.all([
        getJson<{ items: Engine[] }>('generation/engines'),
        getJson<{ items: Worker[] }>('workers'),
        getJson<{ items: Workflow[] }>('generation/workflows'),
        getJson<{ items: Assignment[] }>('generation/assignments'),
        getJson<MediaDiagnostics>('media/diagnostics'),
      ]);
      setEngines(engineResponse.items);
      setWorkers(workerResponse.items);
      setDiagnostics(diagnosticsResponse);
      setWorkflows(workflowResponse.items);
      setVersionWorkflowId((current) => current || workflowResponse.items[0]?.id || '');
      setVersionForm((current) => ({ ...current, engineId: current.engineId || engineResponse.items[0]?.id || '' }));
      const nextBindings: Record<string, string> = { 'text-to-image': '', 'image-to-image': '' };
      assignmentResponse.items.filter((item) => item.app_id === 'creative-center').forEach((item) => {
        nextBindings[item.purpose] = versionKey(item.workflow_id, item.workflow_version);
      });
      setCreativeBindings(nextBindings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const saveWorker = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('worker');
    setError('');
    try {
      const response = await postJson<{ workerId: string; token?: string }>('workers', {
        id: workerForm.id.trim(), name: workerForm.name.trim(), baseUrl: workerForm.baseUrl.trim(),
        token: workerForm.token.trim() || undefined, model: workerForm.model.trim(), temperature: Number(workerForm.temperature),
        ipAllowlist: workerForm.allowedIps.split(',').map((item) => item.trim()).filter(Boolean),
        diskWarningBytes: Number(workerForm.diskWarningBytes), diskStopBytes: Number(workerForm.diskStopBytes),
      });
      if (response.token) setWorkerToken(response.token);
      setWorkerForm((current) => ({ ...current, id: '', name: '', token: '' }));
      await load();
      toast.success('Windows Worker 已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      toast.error('保存 Windows Worker 失败', err instanceof Error ? err.message : String(err));
    } finally { setBusy(''); }
  };

  // This effect is the initial read for a small management surface; its async callback owns the loading state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  const selectedWorkflow = workflows.find((item) => item.id === versionWorkflowId);
  const publishedVersions = useMemo(() => workflows.flatMap((workflow) => workflow.versions.filter((version) => version.isPublished).map((version) => ({ workflow, version }))), [workflows]);

  const saveEngine = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('engine');
    setError('');
    try {
      await postJson('generation/engines', { id: engineForm.id.trim(), name: engineForm.name.trim(), kind: 'comfyui', baseUrl: engineForm.baseUrl.trim(), secret: engineForm.secret || undefined, concurrencyLimit: Number(engineForm.concurrencyLimit) });
      setEngineForm((current) => ({ ...current, id: '', name: '', secret: '' }));
      await load();
      toast.success('生成引擎已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      toast.error('保存生成引擎失败', err instanceof Error ? err.message : String(err));
    } finally { setBusy(''); }
  };

  const createWorkflow = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('workflow');
    setError('');
    try {
      await postJson('generation/workflows', { id: workflowForm.id.trim(), name: workflowForm.name.trim(), description: workflowForm.description.trim(), engineKind: 'comfyui' });
      setWorkflowForm({ id: '', name: '', description: '' });
      await load();
      toast.success('工作流已创建');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      toast.error('创建工作流失败', err instanceof Error ? err.message : String(err));
    } finally { setBusy(''); }
  };

  const publishVersion = async () => {
    if (!versionWorkflowId) return;
    setBusy('version');
    setError('');
    try {
      const inputSchema = JSON.parse(versionForm.inputSchema) as Record<string, unknown>;
      const nodeBindings = JSON.parse(versionForm.nodeBindings) as Record<string, string[]>;
      const definition = JSON.parse(versionForm.definition) as Record<string, unknown>;
      const outputDeclarations = versionForm.outputDeclarations.split(',').map((item) => item.trim()).filter(Boolean);
      await postJson(`generation/workflows/${encodeURIComponent(versionWorkflowId)}/versions`, { engineId: versionForm.engineId || undefined, inputSchema, nodeBindings, outputDeclarations, definition });
      await load();
      toast.success('工作流版本已发布');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      toast.error('发布工作流版本失败', err instanceof Error ? err.message : String(err));
    } finally { setBusy(''); }
  };

  const saveCreativeBindings = async () => {
    const selected = (['text-to-image', 'image-to-image'] as const).map((purpose) => {
      const value = creativeBindings[purpose];
      const match = publishedVersions.find((item) => versionKey(item.workflow.id, item.version.version) === value);
      return match ? { purpose, workflowId: match.workflow.id, workflowVersion: match.version.version, engineId: match.version.engineId || engines.find((engine) => engine.kind === match.workflow.engine_kind)?.id || '' } : null;
    }).filter((item): item is { purpose: 'text-to-image' | 'image-to-image'; workflowId: string; workflowVersion: number; engineId: string } => Boolean(item?.engineId));
    setBusy('assignment');
    setError('');
    try {
      await putJson(`apps/creative-center/generation-assignments`, { assignments: selected });
      await load();
      toast.success('创作中心绑定已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      toast.error('保存创作中心绑定失败', err instanceof Error ? err.message : String(err));
    } finally { setBusy(''); }
  };

  return (
    <main className="min-h-screen bg-[#f4f0e7] px-4 py-8 text-[#18201d] sm:px-8 md:px-12">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader backHref="/apps/creative" backLabel="返回创作中心" eyebrow="GENERATION ADMINISTRATION" title="生成工作流配置" description="这里管理引擎、版本化 ComfyUI API 工作流和应用绑定。普通创作页面只会看到安全的连接状态，不会看到原始工作流或密钥。" actions={<div className="flex items-center gap-2"><Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />刷新</Button><a href="/apps/creative" className="inline-flex h-8 items-center gap-1.5 rounded border border-[rgb(24_32_29/18%)] bg-[#fffdf8] px-3 text-xs font-semibold text-[#18201d] hover:bg-[#18201d]/5">创作中心<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a></div>} />
        {error && <Alert variant="danger" title="生成配置操作失败" onDismiss={() => setError('')}>{error}</Alert>}
        {loading ? <div className="rounded border border-dashed border-[rgb(24_32_29/18%)] bg-[#fffdf8]/70 p-12 text-center text-sm text-[#68716d]">正在读取生成配置…</div> : <>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader><div className="flex items-center gap-2 text-[#b83b1b]"><Server className="h-4 w-4" aria-hidden="true" /><span className="text-[10px] font-bold tracking-[0.16em] uppercase">ENGINES</span></div><CardTitle>生成引擎</CardTitle><CardDescription>ComfyUI 地址只保存在管理端；凭据会写入系统安全凭据库。</CardDescription></CardHeader>
              <CardContent className="space-y-3"><div className="space-y-2">{engines.length ? engines.map((engine) => <div key={engine.id} className="flex items-center justify-between rounded border border-[rgb(24_32_29/12%)] bg-[#fffdf8] p-3"><div><strong className="text-xs">{engine.name}</strong><code className="mt-0.5 block text-[10px] text-[#68716d]">{engine.id} · {engine.base_url}</code></div><span className="text-[10px] text-[#68716d]">并发 {engine.concurrency_limit}</span></div>) : <p className="text-xs text-[#89908a]">还没有生成引擎。</p>}</div><form onSubmit={saveEngine} className="space-y-2 border-t border-[rgb(24_32_29/10%)] pt-3"><div className="grid grid-cols-2 gap-2"><Input aria-label="引擎 ID" placeholder="引擎 ID" value={engineForm.id} onChange={(event) => setEngineForm((current) => ({ ...current, id: event.target.value }))} required /><Input aria-label="引擎名称" placeholder="引擎名称" value={engineForm.name} onChange={(event) => setEngineForm((current) => ({ ...current, name: event.target.value }))} required /></div><Input aria-label="ComfyUI 地址" placeholder="ComfyUI 地址" value={engineForm.baseUrl} onChange={(event) => setEngineForm((current) => ({ ...current, baseUrl: event.target.value }))} required /><div className="grid grid-cols-2 gap-2"><Input aria-label="引擎凭据" placeholder="引擎凭据（可选）" type="password" value={engineForm.secret} onChange={(event) => setEngineForm((current) => ({ ...current, secret: event.target.value }))} /><Input aria-label="并发限制" placeholder="并发限制" type="number" min={1} value={engineForm.concurrencyLimit} onChange={(event) => setEngineForm((current) => ({ ...current, concurrencyLimit: event.target.value }))} required /></div><Button type="submit" variant="primary" loading={busy === 'engine'}><Plus className="h-3.5 w-3.5" aria-hidden="true" />保存引擎</Button></form></CardContent>
            </Card>
            <Card>
              <CardHeader><div className="flex items-center gap-2 text-[#b83b1b]"><Workflow className="h-4 w-4" aria-hidden="true" /><span className="text-[10px] font-bold tracking-[0.16em] uppercase">WORKFLOW VERSIONS</span></div><CardTitle>版本化工作流</CardTitle><CardDescription>先创建工作流，再发布经过校验的 ComfyUI API JSON 版本。</CardDescription></CardHeader>
              <CardContent className="space-y-3"><form onSubmit={createWorkflow} className="grid grid-cols-1 gap-2 sm:grid-cols-3"><Input aria-label="工作流 ID" placeholder="工作流 ID" value={workflowForm.id} onChange={(event) => setWorkflowForm((current) => ({ ...current, id: event.target.value }))} required /><Input aria-label="工作流名称" placeholder="工作流名称" value={workflowForm.name} onChange={(event) => setWorkflowForm((current) => ({ ...current, name: event.target.value }))} required /><Button type="submit" variant="primary" loading={busy === 'workflow'}><Plus className="h-3.5 w-3.5" aria-hidden="true" />创建工作流</Button></form><Input aria-label="工作流说明" placeholder="工作流说明（可选）" value={workflowForm.description} onChange={(event) => setWorkflowForm((current) => ({ ...current, description: event.target.value }))} />{workflows.length ? <div className="space-y-2">{workflows.map((workflow) => <button type="button" key={workflow.id} onClick={() => setVersionWorkflowId(workflow.id)} className={`flex w-full items-center justify-between rounded border p-3 text-left ${versionWorkflowId === workflow.id ? 'border-[#e45d35] bg-[#e45d35]/6' : 'border-[rgb(24_32_29/12%)] bg-[#fffdf8]'}`}><span><strong className="text-xs">{workflow.name}</strong><code className="mt-0.5 block text-[10px] text-[#68716d]">{workflow.id} · {workflow.versions.length} 个版本</code></span><ChevronRight className="h-4 w-4 text-[#89908a]" aria-hidden="true" /></button>)}</div> : <p className="text-xs text-[#89908a]">创建第一个工作流后，它会出现在这里。</p>}</CardContent>
            </Card>
          </div>

          {workerToken && <Alert variant="warning" title="请立即保存 Worker token" onDismiss={() => setWorkerToken('')}>这是本次创建或轮换后唯一一次显示的 token：<code className="mt-1 block break-all rounded bg-black/5 p-2 text-[11px]">{workerToken}</code>请将它写入 Windows Worker 的安全环境变量，之后不会在列表中再次显示。</Alert>}

          <Card>
            <CardHeader><div className="flex items-center gap-2 text-[#b83b1b]"><Server className="h-4 w-4" aria-hidden="true" /><span className="text-[10px] font-bold tracking-[0.16em] uppercase">WINDOWS WORKERS</span></div><CardTitle>Windows Worker</CardTitle><CardDescription>Worker 只允许单任务并发；token 仅在创建或轮换时显示一次，任务文件会在 SthStart 确认产物后清理。</CardDescription></CardHeader>
            <CardContent className="space-y-3"><div className="space-y-2">{workers.length ? workers.map((worker) => <div key={worker.engineId} className="flex flex-col gap-2 rounded border border-[rgb(24_32_29/12%)] bg-[#fffdf8] p-3 sm:flex-row sm:items-center sm:justify-between"><div><strong className="text-xs">{worker.name}</strong><code className="mt-0.5 block text-[10px] text-[#68716d]">{worker.engineId} · {worker.baseUrl}</code><span className="mt-1 block text-[10px] text-[#68716d]">模型 {worker.model || '未指定'} · 温度 {worker.temperature} · 并发 1</span><span className="mt-1 block text-[10px] text-[#89908a]">磁盘警告 {worker.diskWarningBytes} · 停止 {worker.diskStopBytes}</span></div><span className={`text-[10px] ${worker.state === 'online' ? 'text-[#39794f]' : 'text-[#89908a]'}`}>{worker.state === 'online' ? '在线' : worker.state === 'offline' ? '离线' : '未探测'}</span></div>) : <p className="text-xs text-[#89908a]">还没有配置 Windows Worker。</p>}</div><form onSubmit={saveWorker} className="space-y-2 border-t border-[rgb(24_32_29/10%)] pt-3"><div className="grid grid-cols-2 gap-2"><Input aria-label="Worker ID" placeholder="Worker ID" value={workerForm.id} onChange={(event) => setWorkerForm((current) => ({ ...current, id: event.target.value }))} required /><Input aria-label="Worker 名称" placeholder="Worker 名称" value={workerForm.name} onChange={(event) => setWorkerForm((current) => ({ ...current, name: event.target.value }))} required /></div><Input aria-label="Worker 地址" placeholder="Worker 地址，例如 http://192.168.1.20:9200" value={workerForm.baseUrl} onChange={(event) => setWorkerForm((current) => ({ ...current, baseUrl: event.target.value }))} required /><div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><Input aria-label="Worker token" placeholder="Worker token（新建可留空自动生成）" type="password" value={workerForm.token} onChange={(event) => setWorkerForm((current) => ({ ...current, token: event.target.value }))} /><Input aria-label="Worker 模型" placeholder="模型标识（可选）" value={workerForm.model} onChange={(event) => setWorkerForm((current) => ({ ...current, model: event.target.value }))} /><Input aria-label="Worker 温度" placeholder="温度" type="number" min={0} max={2} step={0.1} value={workerForm.temperature} onChange={(event) => setWorkerForm((current) => ({ ...current, temperature: event.target.value }))} required /></div><Input aria-label="Worker IP 白名单" placeholder="IP 白名单，逗号分隔；例如 127.0.0.1, 192.168.1.0/24" value={workerForm.allowedIps} onChange={(event) => setWorkerForm((current) => ({ ...current, allowedIps: event.target.value }))} /><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Input aria-label="Worker 磁盘警告阈值" placeholder="磁盘警告阈值（字节）" type="number" min={1} value={workerForm.diskWarningBytes} onChange={(event) => setWorkerForm((current) => ({ ...current, diskWarningBytes: event.target.value }))} required /><Input aria-label="Worker 磁盘停止阈值" placeholder="磁盘停止阈值（字节）" type="number" min={1} value={workerForm.diskStopBytes} onChange={(event) => setWorkerForm((current) => ({ ...current, diskStopBytes: event.target.value }))} required /></div><Button type="submit" variant="primary" loading={busy === 'worker'}><Plus className="h-3.5 w-3.5" aria-hidden="true" />保存 Worker</Button></form></CardContent>
          </Card>

          <Card>
            <CardHeader><div className="flex items-center gap-2 text-[#b83b1b]"><Film className="h-4 w-4" aria-hidden="true" /><span className="text-[10px] font-bold tracking-[0.16em] uppercase">MEDIA DIAGNOSTICS</span></div><CardTitle>媒体诊断</CardTitle><CardDescription>视频预处理只在系统实际检测到 ffmpeg 和 ffprobe 时启用；这里不会自动安装或修改系统。</CardDescription></CardHeader>
            <CardContent className="space-y-3">{diagnostics ? <><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><div className="rounded border border-[rgb(24_32_29/12%)] bg-[#fffdf8] p-3"><strong className="text-xs">ffmpeg</strong><span className={`mt-1 block text-[11px] ${diagnostics.video.ffmpeg.available ? 'text-[#39794f]' : 'text-[#b83b1b]'}`}>{diagnostics.video.ffmpeg.available ? `可用${diagnostics.video.ffmpeg.version ? ` · ${diagnostics.video.ffmpeg.version}` : ''}` : diagnostics.video.ffmpeg.error === 'not_found' ? '未安装' : '不可用'}</span></div><div className="rounded border border-[rgb(24_32_29/12%)] bg-[#fffdf8] p-3"><strong className="text-xs">ffprobe</strong><span className={`mt-1 block text-[11px] ${diagnostics.video.ffprobe.available ? 'text-[#39794f]' : 'text-[#b83b1b]'}`}>{diagnostics.video.ffprobe.available ? `可用${diagnostics.video.ffprobe.version ? ` · ${diagnostics.video.ffprobe.version}` : ''}` : diagnostics.video.ffprobe.error === 'not_found' ? '未安装' : '不可用'}</span></div></div>{diagnostics.video.installHint && <p className="rounded bg-[#b83b1b]/8 p-3 text-xs leading-5 text-[#8f2d17]">{diagnostics.video.installHint}</p>}<div className="rounded border border-[rgb(24_32_29/12%)] bg-[#fffdf8] p-3 text-xs"><strong>H3 FL2VA</strong><span className={`ml-2 ${diagnostics.h3.ready ? 'text-[#39794f]' : 'text-[#89908a]'}`}>{diagnostics.h3.ready ? '真实 Worker 已就绪' : diagnostics.h3.enabled ? `实验状态：${diagnostics.h3.reason}` : '默认关闭'}</span><p className="mt-1 text-[11px] text-[#68716d]">固定上限 {diagnostics.h3.constraints.maxWidth}×{diagnostics.h3.constraints.maxHeight}、{diagnostics.h3.constraints.maxDurationSeconds} 秒、并发 {diagnostics.h3.constraints.concurrencyLimit}；当前没有公共生成入口。 <a href="https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE" target="_blank" rel="noreferrer" className="underline underline-offset-2">启用前阅读 H3 Community License</a>，确认所在地区、用途和再分发符合许可要求。</p></div></> : <p className="text-xs text-[#89908a]">正在读取诊断状态…</p>}</CardContent>
          </Card>

          <Card>
            <CardHeader><div className="flex items-center gap-2 text-[#b83b1b]"><Database className="h-4 w-4" aria-hidden="true" /><span className="text-[10px] font-bold tracking-[0.16em] uppercase">PUBLISH A VERSION</span></div><CardTitle>发布工作流版本</CardTitle><CardDescription>{selectedWorkflow ? `当前选择：${selectedWorkflow.name}。发布后版本不可变，应用绑定始终指向明确的版本。` : '请先创建并选择一个工作流。'}</CardDescription></CardHeader>
            <CardContent className="space-y-3"><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Select aria-label="工作流" value={versionWorkflowId} onChange={(event) => setVersionWorkflowId(event.target.value)}><option value="">选择工作流</option>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</Select><Select aria-label="绑定引擎" value={versionForm.engineId} onChange={(event) => setVersionForm((current) => ({ ...current, engineId: event.target.value }))}><option value="">选择引擎（可选）</option>{engines.map((engine) => <option key={engine.id} value={engine.id}>{engine.name}</option>)}</Select></div><div className="grid grid-cols-1 gap-3 lg:grid-cols-3"><div><label htmlFor="generation-input-schema" className="mb-1 block text-xs font-semibold">输入结构</label><Textarea id="generation-input-schema" rows={8} className="font-mono text-[11px]" value={versionForm.inputSchema} onChange={(event) => setVersionForm((current) => ({ ...current, inputSchema: event.target.value }))} /></div><div><label htmlFor="generation-node-bindings" className="mb-1 block text-xs font-semibold">节点绑定</label><Textarea id="generation-node-bindings" rows={8} className="font-mono text-[11px]" value={versionForm.nodeBindings} onChange={(event) => setVersionForm((current) => ({ ...current, nodeBindings: event.target.value }))} /></div><div><label htmlFor="generation-definition" className="mb-1 block text-xs font-semibold">ComfyUI API JSON</label><Textarea id="generation-definition" rows={8} className="font-mono text-[11px]" value={versionForm.definition} onChange={(event) => setVersionForm((current) => ({ ...current, definition: event.target.value }))} /></div></div><Input aria-label="输出节点 ID" placeholder="输出节点 ID，多个用逗号分隔，例如 9" value={versionForm.outputDeclarations} onChange={(event) => setVersionForm((current) => ({ ...current, outputDeclarations: event.target.value }))} /></CardContent><CardFooter><span className="text-[11px] text-[#89908a]">只接受 API 格式工作流，不接受带 nodes 数组的画布导出。</span><Button variant="primary" onClick={() => void publishVersion()} loading={busy === 'version'} disabled={!versionWorkflowId}><Save className="h-3.5 w-3.5" aria-hidden="true" />发布版本</Button></CardFooter>
          </Card>

          <Card>
            <CardHeader><span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#b83b1b]">CREATIVE CENTER ROUTING</span><CardTitle>绑定创作中心</CardTitle><CardDescription>为文本生图和图生图分别选择一个已发布版本。留空表示该模式未配置，创作页面会明确提示。</CardDescription></CardHeader>
            <CardContent className="space-y-3">{(['text-to-image', 'image-to-image'] as const).map((purpose) => <label key={purpose} className="flex flex-col gap-1 text-xs font-semibold sm:flex-row sm:items-center"><span className="w-28">{purpose === 'text-to-image' ? '文本生图' : '图生图'}</span><Select aria-label={purpose === 'text-to-image' ? '文本生图工作流' : '图生图工作流'} value={creativeBindings[purpose]} onChange={(event) => setCreativeBindings((current) => ({ ...current, [purpose]: event.target.value }))}><option value="">尚未绑定</option>{publishedVersions.map(({ workflow, version }) => <option key={versionKey(workflow.id, version.version)} value={versionKey(workflow.id, version.version)}>{workflow.name} · v{version.version}</option>)}</Select></label>)}</CardContent><CardFooter><span className="text-[11px] text-[#89908a]">应用 ID：creative-center</span><Button variant="primary" onClick={() => void saveCreativeBindings()} loading={busy === 'assignment'}><Save className="h-3.5 w-3.5" aria-hidden="true" />保存绑定</Button></CardFooter>
          </Card>
        </>}
      </div>
    </main>
  );
}
