'use client';

import { useState } from 'react';
import { MemoryStick, Plus, RefreshCw } from 'lucide-react';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { saveGenerationEngine, saveWorkerConfig, testGenerationEngine, unloadGenerationEngineModels } from '../api';
import type { Engine, MediaDiagnostics, Worker } from '../types';
import { DiagnosticsPanel } from './diagnostics-panel';
import { useToast } from '@/app/providers/ui-provider';

/**
 * 连接页签（规划 §5）：普通用户主要填名称和地址；ComfyUI 直连为新建默认，
 * Worker 配置归入高级选项；凭据留空表示保持原值；删除由服务端引用检查兜底。
 */

function statusBadge(engine: Engine) {
  const lastTest = engine.lastTest;
  if (!lastTest) return <Badge variant="unknown">未检查</Badge>;
  if (lastTest.ok) return <Badge variant="online">连接正常</Badge>;
  return <Badge variant="error">连接失败</Badge>;
}

function ConnectionForm({
  engine,
  workers,
  onSaved,
  onCancel,
}: {
  engine: Engine | null;
  workers: Worker[];
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const worker = engine ? workers.find((item) => item.engineId === engine.id) : null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? '').trim();
    const id = value('id') || `conn-${Date.now().toString(36)}`;
    setSaving(true);
    setError('');
    try {
      if ((value('kind') || (engine?.kind ?? 'comfyui')) === 'worker') {
        await saveWorkerConfig({
          id, name: value('name'), baseUrl: value('baseUrl'),
          token: value('secret') || undefined,
          model: value('model') ?? '', temperature: Number(value('temperature') || 0.7),
          ipAllowlist: value('ipAllowlist').split(',').map((item) => item.trim()).filter(Boolean),
          diskWarningBytes: Number(value('diskWarning') || 10 * 1024 * 1024 * 1024),
          diskStopBytes: Number(value('diskStop') || 2 * 1024 * 1024 * 1024),
        });
      } else {
        await saveGenerationEngine({
          id, name: value('name'), baseUrl: value('baseUrl'),
          secret: value('secret') || undefined,
          kind: (value('kind') || (engine?.kind ?? 'comfyui')) as 'comfyui' | 'worker' | 'cloud',
          concurrencyLimit: Math.max(1, Number(value('concurrency') || 1)),
        });
      }
      await onSaved();
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <Alert variant="danger" title="保存失败" onDismiss={() => setError('')}>{error}</Alert>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="conn-id" className="mb-1 block text-sm font-medium text-ink">名称</label>
          <Input id="conn-id" name="name" required defaultValue={engine?.name ?? ''} />
        </div>
        <div>
          <label htmlFor="conn-kind" className="mb-1 block text-sm font-medium text-ink">连接方式</label>
          <Select id="conn-kind" name="kind" defaultValue={engine?.kind ?? 'comfyui'} disabled={Boolean(engine)}>
            <option value="comfyui">ComfyUI 直连（默认）</option>
            <option value="cloud">云端兼容接口（OpenAI / DALL-E）</option>
            <option value="worker">Windows Worker（高级）</option>
          </Select>
        </div>
      </div>
      <div>
        <label htmlFor="conn-url" className="mb-1 block text-sm font-medium text-ink">地址</label>
        <Input id="conn-url" name="baseUrl" required defaultValue={engine?.base_url ?? ''} placeholder="http://127.0.0.1:8188" />
        <p className="mt-1 text-sm text-muted">Service 与 ComfyUI 不同机时，地址必须从后端所在机器可达；容器部署时 127.0.0.1 不是宿主。</p>
      </div>
      <div>
        <label htmlFor="conn-secret" className="mb-1 block text-sm font-medium text-ink">凭据（可选）</label>
        <Input id="conn-secret" name="secret" type="password" placeholder={engine ? '留空表示保持原值' : '通常无需填写'} />
      </div>

      {(!engine || engine.kind === 'comfyui') && (
        <div className="w-40">
          <label htmlFor="conn-concurrency" className="mb-1 block text-sm font-medium text-ink">并发限制</label>
          <Input id="conn-concurrency" name="concurrency" type="number" min={1} defaultValue={engine?.concurrency_limit ?? 1} />
        </div>
      )}

      <details className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-3">
        <summary className="cursor-pointer text-sm font-semibold">高级：内部 ID</summary>
        <div className="mt-2">
          <label htmlFor="conn-id" className="mb-1 block text-sm font-medium text-ink">内部 ID（自动生成，可自定义）</label>
          <Input id="conn-id" name="id" defaultValue={engine?.id ?? ''} disabled={Boolean(engine)} placeholder={engine ? engine.id : 'conn-xxxxxx'} />
          <p className="mt-1 text-sm text-muted">{engine ? '已有连接的内部 ID 不可修改。' : '留空由系统生成；创建后用于 API 与绑定。'}</p>
        </div>
      </details>

      {(!engine || engine.kind === 'worker') && (
        <details className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-3">
          <summary className="cursor-pointer text-sm font-semibold">高级：Windows Worker 设置</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="conn-worker-model" className="mb-1 block text-sm font-medium text-ink">Worker 备注 model</label>
              <Input id="conn-worker-model" name="model" defaultValue={worker?.model ?? ''} />
              <p className="mt-1 text-sm text-muted">人工备注字段，不是实际生成模型；实际模型由工作流配置决定。</p>
            </div>
            <div>
              <label htmlFor="conn-worker-temp" className="mb-1 block text-sm font-medium text-ink">temperature 备注</label>
              <Input id="conn-worker-temp" name="temperature" type="number" step="0.1" defaultValue={worker?.temperature ?? 0.7} />
            </div>
            <div>
              <label htmlFor="conn-worker-ip" className="mb-1 block text-sm font-medium text-ink">IP 白名单（逗号分隔）</label>
              <Input id="conn-worker-ip" name="ipAllowlist" defaultValue={worker?.ipAllowlist.join(', ') ?? ''} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="conn-worker-warn" className="mb-1 block text-sm font-medium text-ink">磁盘警告（字节）</label>
                <Input id="conn-worker-warn" name="diskWarning" type="number" defaultValue={worker?.diskWarningBytes ?? 10 * 1024 * 1024 * 1024} />
              </div>
              <div>
                <label htmlFor="conn-worker-stop" className="mb-1 block text-sm font-medium text-ink">磁盘停止（字节）</label>
                <Input id="conn-worker-stop" name="diskStop" type="number" defaultValue={worker?.diskStopBytes ?? 2 * 1024 * 1024 * 1024} />
              </div>
            </div>
          </div>
        </details>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>取消</Button>
        <Button type="submit" variant="primary" loading={saving}>保存连接</Button>
      </div>
    </form>
  );
}

export function ConnectionsPanel({
  engines,
  workers,
  diagnostics,
  onRefresh,
}: {
  engines: Engine[];
  workers: Worker[];
  diagnostics: MediaDiagnostics | null;
  onRefresh: () => Promise<void>;
}) {
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [unloading, setUnloading] = useState<string | null>(null);
  const [confirmingUnload, setConfirmingUnload] = useState<Engine | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [unloadMessages, setUnloadMessages] = useState<Record<string, string>>({});

  const runTest = async (engineId: string) => {
    setTesting(engineId);
    try {
      const result = await testGenerationEngine(engineId);
      setResults((current) => ({ ...current, [engineId]: result.ok ? `连接正常 · ${result.latencyMs ?? '—'}ms · ${result.summary ?? ''}` : `失败：${result.errorMessage ?? result.errorCode}` }));
      await onRefresh();
    } catch (error) {
      setResults((current) => ({ ...current, [engineId]: `失败：${error instanceof Error ? error.message : String(error)}` }));
    } finally {
      setTesting(null);
    }
  };

  const unloadModels = async (engine: Engine) => {
    setUnloading(engine.id);
    setUnloadMessages((current) => ({ ...current, [engine.id]: '' }));
    try {
      const result = await unloadGenerationEngineModels(engine.id);
      setUnloadMessages((current) => ({ ...current, [engine.id]: result.message }));
      toast.success('卸载请求已发送', 'ComfyUI 会处理当前驻留模型与显存缓存；下次生成需要重新加载模型。');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUnloadMessages((current) => ({ ...current, [engine.id]: message }));
      toast.error('模型卸载失败', message);
    } finally {
      setUnloading(null);
      setConfirmingUnload(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>连接</CardTitle>
              <CardDescription>统一管理 ComfyUI 直连与 Windows Worker。每个 ComfyUI 实例都可单独卸载已载入模型、释放 ComfyUI 显存缓存；不会删除磁盘模型文件或影响其他程序占用的显存。</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { void onRefresh(); }}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />刷新</Button>
              <Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" aria-hidden="true" />新建连接</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {engines.length === 0 && <p className="text-sm text-fg-subtle">还没有连接。点击「新建连接」填写 ComfyUI 地址，保存后即可测试并读取模型列表。</p>}
          {engines.map((engine) => (
            <div key={engine.id} className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-3" data-testid="engine-card" data-engine-id={engine.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <strong className="text-sm">{engine.name}</strong>
                    <Badge variant={engine.kind === 'comfyui' ? 'accent' : 'secondary'}>{engine.kind === 'comfyui' ? '直连' : engine.kind}</Badge>
                    {statusBadge(engine)}
                    {engine.enabled ? null : <Badge variant="stopped">已禁用</Badge>}
                  </div>
                  <code className="mt-0.5 block truncate text-sm text-muted">{engine.base_url} · {engine.id}</code>
                  {results[engine.id] && <p className="mt-1 text-sm text-muted" data-testid={`engine-test-result-${engine.id}`}>{results[engine.id]}</p>}
                  {unloadMessages[engine.id] && <p className="mt-1 text-sm text-muted" role="status">{unloadMessages[engine.id]}</p>}
                  {engine.lastTest && <p className="text-sm text-fg-subtle">最近检查：{new Date(engine.lastTest.checkedAt).toLocaleString('zh-CN')}</p>}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {engine.kind === 'comfyui' && <Button size="sm" variant="outline" disabled={unloading !== null} onClick={() => setConfirmingUnload(engine)}><MemoryStick className="h-3.5 w-3.5" aria-hidden="true" />卸载已载入模型</Button>}
                  <Button size="sm" variant="outline" onClick={() => { void runTest(engine.id); }} loading={testing === engine.id}>测试连接</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(engine.id)}>编辑</Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <details className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-3">
        <summary className="cursor-pointer text-sm font-semibold text-ink">高级诊断</summary>
        <div className="mt-3">{diagnostics && <DiagnosticsPanel diagnostics={diagnostics} />}</div>
      </details>

      <Dialog open={creating || editing !== null} onOpenChange={(open) => { if (!open) { setCreating(false); setEditing(null); } }} title={editing ? '编辑连接' : '新建连接'} size="lg">
        <ConnectionForm
          engine={editing ? engines.find((item) => item.id === editing) ?? null : null}
          workers={workers}
          onSaved={onRefresh}
          onCancel={() => { setCreating(false); setEditing(null); }}
        />
      </Dialog>

      <Dialog
        open={confirmingUnload !== null}
        onOpenChange={(open) => { if (!open && unloading === null) setConfirmingUnload(null); }}
        title="卸载已载入模型并释放显存？"
        description={confirmingUnload ? `目标实例：${confirmingUnload.name}` : undefined}
        size="sm"
        footer={(
          <>
            <Button variant="outline" onClick={() => setConfirmingUnload(null)} disabled={unloading !== null}>取消</Button>
            <Button
              variant="primary"
              loading={unloading === confirmingUnload?.id}
              disabled={!confirmingUnload}
              onClick={() => { if (confirmingUnload) void unloadModels(confirmingUnload); }}
            >
              卸载模型并释放显存
            </Button>
          </>
        )}
      >
        <div className="space-y-2 text-sm leading-relaxed text-muted">
          <p>将请求此 ComfyUI 实例卸载全部已载入模型并清理显存缓存。模型文件不会被删除。</p>
          <p>正在运行的生成不会被强制中断；ComfyUI 会在队列可处理时执行。下次生成需要重新加载模型，可能会多等待一会儿。</p>
          <p>此操作只释放该 ComfyUI 实例管理的资源，不会卸载其他程序加载的模型。</p>
        </div>
      </Dialog>
    </div>
  );
}
