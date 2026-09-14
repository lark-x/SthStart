'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, RefreshCw, Trash2, Edit3, PlugZap, Power, PowerOff } from 'lucide-react';
import type { McpSource, McpSourceSave } from '@sthstart/contracts';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Select } from '@/app/components/ui/select';
import { Switch } from '@/app/components/ui/switch';
import { Alert } from '@/app/components/ui/alert';
import { Spinner } from '@/app/components/ui/spinner';
import { useToast } from '@/app/providers/ui-provider';
import { createMcpSource, deleteMcpSource, discoverMcpTools, fetchMcpSources, setMcpSourceStatus, testMcpSource, updateMcpSource } from './api';

type Draft = {
  id: string;
  name: string;
  url: string;
  authMode: McpSourceSave['authMode'];
  authHeaderName: string;
  secret: string;
  applicableWorksText: string;
  universal: boolean;
  purpose: string;
  allowedTools: string[];
  discoveredTools: NonNullable<McpSource['discoveredTools']>;
  timeoutMs: number;
  status: 'enabled' | 'disabled';
};

const EMPTY_DRAFT: Draft = {
  id: '',
  name: '',
  url: '',
  authMode: 'none',
  authHeaderName: '',
  secret: '',
  applicableWorksText: '',
  universal: false,
  purpose: '',
  allowedTools: [],
  discoveredTools: [],
  timeoutMs: 45_000,
  status: 'enabled',
};

function sourceToDraft(source: McpSource): Draft {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    authMode: source.authMode,
    authHeaderName: source.authHeaderName ?? '',
    secret: '',
    applicableWorksText: source.applicableWorks.join('、'),
    universal: source.universal,
    purpose: source.purpose,
    allowedTools: [...source.allowedTools],
    discoveredTools: source.discoveredTools ?? [],
    timeoutMs: source.timeoutMs ?? 45_000,
    status: source.status,
  };
}

function draftToPayload(draft: Draft): McpSourceSave {
  const works = draft.applicableWorksText.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 100);
  return {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name.trim(),
    url: draft.url.trim(),
    authMode: draft.authMode,
    ...(draft.authMode === 'header' && draft.authHeaderName.trim() ? { authHeaderName: draft.authHeaderName.trim() } : {}),
    ...(draft.secret ? { secret: draft.secret } : {}),
    applicableWorks: works,
    universal: draft.universal,
    purpose: draft.purpose.trim(),
    allowedTools: draft.allowedTools,
    timeoutMs: draft.timeoutMs,
    status: draft.status,
  };
}
export function McpSourceManager() {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);

  // 列表由 React Query 持有：避免在 effect 里同步 setState 触发级联渲染。
  const sourcesQuery = useQuery({ queryKey: ['mcp-sources'], queryFn: fetchMcpSources, staleTime: 15_000 });
  const sources = sourcesQuery.data ?? null;
  const loading = sourcesQuery.isLoading;
  const load = () => sourcesQuery.refetch();
  const loadError = sourcesQuery.error instanceof Error ? sourcesQuery.error.message : sourcesQuery.error ? String(sourcesQuery.error) : null;

  const openNew = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setEditorOpen(true);
  };

  const openEdit = (source: McpSource) => {
    setEditingId(source.id);
    setDraft(sourceToDraft(source));
    setEditorOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = draftToPayload(draft);
      if (editingId) {
        await updateMcpSource(editingId, payload);
        toast.success('资料源已更新');
      } else {
        const result = await createMcpSource(payload);
        if (result.warning) toast.warning('资料源已保存，但凭据未能写入安全存储：' + result.warning);
        else toast.success('资料源已创建');
      }
      setEditorOpen(false);
      void load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const result = await testMcpSource(id);
      if (result.ok) toast.success('连接成功：' + result.message);
      else toast.error('连接失败：' + result.message);
      void load();
    } catch (testError) {
      toast.error(testError instanceof Error ? testError.message : String(testError));
    } finally {
      setTestingId(null);
    }
  };
  const handleDiscover = async () => {
    setDiscovering(true);
    setError(null);
    try {
      const result = await discoverMcpTools({
        sourceId: editingId || undefined,
        url: draft.url.trim(),
        authMode: draft.authMode,
        authHeaderName: draft.authHeaderName || undefined,
        secret: draft.secret || undefined,
        timeoutMs: draft.timeoutMs,
      });
      if (result.ok && result.tools) {
        setDraft((current) => ({ ...current, discoveredTools: result.tools ?? [] }));
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (discoverError) {
      setError(discoverError instanceof Error ? discoverError.message : String(discoverError));
    } finally {
      setDiscovering(false);
    }
  };

  const handleToggle = async (source: McpSource) => {
    const next = source.status === 'enabled' ? 'disabled' : 'enabled';
    try {
      await setMcpSourceStatus(source.id, next);
      toast.success(next === 'enabled' ? '资料源已启用' : '资料源已停用');
      void load();
    } catch (toggleError) {
      toast.error(toggleError instanceof Error ? toggleError.message : String(toggleError));
    }
  };

  const handleDelete = async (source: McpSource) => {
    if (!window.confirm('确定删除资料源「' + source.name + '」？')) return;
    try {
      await deleteMcpSource(source.id);
      toast.success('资料源已删除');
      void load();
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  const toggleTool = (toolName: string) => {
    setDraft((current) => {
      const allowed = current.allowedTools.includes(toolName)
        ? current.allowedTools.filter((item) => item !== toolName)
        : [...current.allowedTools, toolName];
      return { ...current, allowedTools: allowed };
    });
  };
  return (
    <section aria-label="MCP 资料源" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">MCP 资料源 <span className="text-sm font-sans text-muted">{sources ? sources.length : '—'}</span></h2>
          <p className="text-sm text-muted">配置 HTTP MCP 服务，供活动企划研究检索剧情原文、角色与地点资料。密钥进入系统安全凭据库，不回传明文。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" />刷新</Button>
          <Button size="sm" variant="primary" onClick={openNew}><Plus className="h-3.5 w-3.5" />新增资料源</Button>
        </div>
      </div>

      {loadError && <Alert variant="danger" title="资料源加载失败">{loadError}。请点击“刷新”重试；已有配置不会因此删除。</Alert>}
      {loading && !sources ? <p className="flex items-center gap-2 text-sm text-muted"><Spinner className="h-4 w-4" />正在加载资料源…</p> : null}
      {!loading && sources?.length === 0 && (
        <p className="rounded-lg border border-dashed border-border-default p-6 text-sm text-muted">还没有 MCP 资料源。点击“新增资料源”接入 HTTP MCP 服务；未配置时新建活动仍可跳过资料检索。</p>
      )}

      <div className="space-y-2">
        {(sources ?? []).map((source) => {
          const testResult = source.lastTestResult;
          return (
            <article key={source.id} className={`rounded-[var(--radius-panel)] border border-border-default bg-surface p-4 ${source.status === 'disabled' ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm font-semibold">{source.name}</strong>
                    <Badge variant={source.status === 'enabled' ? 'online' : 'stopped'}>{source.status === 'enabled' ? '启用' : '停用'}</Badge>
                    <Badge variant="outline">{source.universal ? '通用资料源' : (source.applicableWorks.join('、') || '未标注作品')}</Badge>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted"><code className="font-mono">{source.url}</code></p>
                  {source.purpose && <p className="mt-0.5 text-sm text-muted">{source.purpose}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
                    <span>允许工具：{source.allowedTools.length ? source.allowedTools.join('、') : '尚未选择'}</span>
                    <span>发现工具：{source.discoveredTools?.length ?? 0}</span>
                    <span>凭据：{source.hasCredential ? '已配置' : '无'}</span>
                    {testResult && (
                      <span className={testResult.ok ? 'text-green-700' : 'text-amber-700'}>连接测试：{testResult.ok ? '成功' : '失败'} · {testResult.message.slice(0, 60)}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button size="sm" variant="ghost" disabled={testingId === source.id || source.status === 'disabled'} onClick={() => void handleTest(source.id)}>
                    {testingId === source.id ? <Spinner className="h-3.5 w-3.5" /> : <PlugZap className="h-3.5 w-3.5" />}测试连接
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(source)}><Edit3 className="h-3.5 w-3.5" />编辑</Button>
                  <Button size="sm" variant="ghost" onClick={() => void handleToggle(source)}>
                    {source.status === 'enabled' ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}{source.status === 'enabled' ? '停用' : '启用'}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/10" onClick={() => void handleDelete(source)}><Trash2 className="h-3.5 w-3.5" />删除</Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <Dialog
        open={editorOpen}
        onOpenChange={(open) => { if (!saving) setEditorOpen(open); }}
        title={editingId ? '编辑 MCP 资料源' : '新增 MCP 资料源'}
        className="max-w-2xl"
      >
        {error && <Alert variant="danger" title="保存失败">{error}</Alert>}
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold">名称</span>
              <Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="例如：虚空终端 / 角色百科" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold">HTTP 地址</span>
              <Input value={draft.url} onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} placeholder="https://example.com/mcp" />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold">认证方式</span>
              <Select value={draft.authMode} onChange={(event) => setDraft((current) => ({ ...current, authMode: event.target.value as McpSourceSave['authMode'] }))}>
                <option value="none">无认证</option>
                <option value="bearer">Bearer Token</option>
                <option value="header">自定义认证请求头</option>
              </Select>
            </label>
            {draft.authMode === 'bearer' && (
              <label className="space-y-1.5">
                <span className="text-xs font-semibold">Token（不回传明文）</span>
                <Input type="password" value={draft.secret} onChange={(event) => setDraft((current) => ({ ...current, secret: event.target.value }))} placeholder="留空表示沿用已保存密钥" />
              </label>
            )}
            {draft.authMode === 'header' && (
              <label className="space-y-1.5">
                <span className="text-xs font-semibold">认证请求头名称</span>
                <Input value={draft.authHeaderName} onChange={(event) => setDraft((current) => ({ ...current, authHeaderName: event.target.value }))} placeholder="例如 X-API-Key" />
              </label>
            )}
          </div>
          {draft.authMode === 'header' && (
            <label className="space-y-1.5">
              <span className="text-xs font-semibold">认证请求头值（不回传明文）</span>
              <Input type="password" value={draft.secret} onChange={(event) => setDraft((current) => ({ ...current, secret: event.target.value }))} placeholder="留空表示沿用已保存密钥" />
            </label>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold">适用作品（顿号或逗号分隔）</span>
              <Input value={draft.applicableWorksText} onChange={(event) => setDraft((current) => ({ ...current, applicableWorksText: event.target.value }))} placeholder="例如：原神、崩坏：星穹铁道" />
            </label>
            <label className="flex items-center gap-2 pt-6">
              <Switch checked={draft.universal} onChange={(event) => setDraft((current) => ({ ...current, universal: event.target.checked }))} />
              <span className="text-sm text-muted">通用资料源（不限定作品）</span>
            </label>
          </div>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold">用途说明</span>
            <Textarea value={draft.purpose} rows={2} onChange={(event) => setDraft((current) => ({ ...current, purpose: event.target.value }))} placeholder="例如：剧情原文检索、角色百科、地点资料" />
          </label>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">允许调用的工具</span>
              <Button size="sm" variant="outline" disabled={discovering || !draft.url.trim()} onClick={() => void handleDiscover()}>
                {discovering ? <Spinner className="h-3.5 w-3.5" /> : <PlugZap className="h-3.5 w-3.5" />}测试连接并发现工具
              </Button>
            </div>
            {draft.discoveredTools.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {draft.discoveredTools.map((tool) => {
                  const checked = draft.allowedTools.includes(tool.name);
                  return (
                    <button
                      key={tool.name}
                      type="button"
                      onClick={() => toggleTool(tool.name)}
                      className={`rounded-full border px-2.5 py-1 text-xs ${checked ? 'border-accent bg-accent/10 text-accent' : 'border-border-default bg-surface text-muted'}`}
                    >
                      {tool.name}
                    </button>
                  );
                })}
              </div>
            )}
            {draft.discoveredTools.length === 0 && <p className="text-xs text-muted">保存前可先“测试连接并发现工具”，再勾选研究可用的工具。</p>}
          </div>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold">超时（毫秒，默认 45000）</span>
            <Input type="number" value={draft.timeoutMs} onChange={(event) => setDraft((current) => ({ ...current, timeoutMs: Number(event.target.value) || 45_000 }))} />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={saving} onClick={() => setEditorOpen(false)}>取消</Button>
          <Button disabled={saving || !draft.name.trim() || !draft.url.trim()} onClick={() => void handleSave()}>{saving ? '保存中…' : '保存'}</Button>
        </div>
      </Dialog>
    </section>
  );
}
