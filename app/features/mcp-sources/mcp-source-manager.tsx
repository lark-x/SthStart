'use client';

import React, { useDeferredValue, useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Check,
  Clock3,
  Globe2,
  Network,
  Pencil,
  PlugZap,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react';
import type { McpSource, McpSourceSave, McpTransport } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { FormField } from '@/app/components/ui/form-field';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { Switch } from '@/app/components/ui/switch';
import { Textarea } from '@/app/components/ui/textarea';
import { useToast } from '@/app/providers/ui-provider';
import {
  createMcpSource,
  deleteMcpSource,
  discoverMcpTools,
  fetchMcpSources,
  setMcpSourceStatus,
  testMcpSource,
  updateMcpSource,
} from './api';
import { mcpSourceKeys } from '@/app/lib/query-keys';

const TRANSPORT_OPTIONS = [
  {
    value: 'auto',
    label: '自动检测',
    compactLabel: '自动',
    description: '优先使用 Streamable HTTP；仅在协议不匹配时回退到旧式 SSE。',
  },
  {
    value: 'streamable-http',
    label: 'Streamable HTTP',
    compactLabel: 'Streamable HTTP',
    description: '适用于支持标准 MCP Streamable HTTP 的现代服务。',
  },
  {
    value: 'sse',
    label: '旧式 SSE',
    compactLabel: 'SSE',
    description: '兼容使用 EventSource 与消息 POST 端点的旧式 MCP 服务。',
  },
] as const satisfies ReadonlyArray<{
  value: McpTransport;
  label: string;
  compactLabel: string;
  description: string;
}>;

const AUTH_LABELS: Record<McpSourceSave['authMode'], string> = {
  none: '无认证',
  bearer: 'Bearer Token',
  header: '自定义请求头',
};

type ToolChoice = NonNullable<McpSource['discoveredTools']>[number] & {
  savedOnly?: boolean;
};

type Draft = {
  id: string;
  name: string;
  url: string;
  transport: McpTransport;
  authMode: McpSourceSave['authMode'];
  authHeaderName: string;
  secret: string;
  hasCredential: boolean;
  applicableWorksText: string;
  universal: boolean;
  purpose: string;
  allowedTools: string[];
  discoveredTools: NonNullable<McpSource['discoveredTools']>;
  timeoutMs: string;
  status: 'enabled' | 'disabled';
};

const EMPTY_DRAFT: Draft = {
  id: '',
  name: '',
  url: '',
  transport: 'auto',
  authMode: 'none',
  authHeaderName: '',
  secret: '',
  hasCredential: false,
  applicableWorksText: '',
  universal: false,
  purpose: '',
  allowedTools: [],
  discoveredTools: [],
  timeoutMs: '45000',
  status: 'enabled',
};

function transportOption(value: McpTransport | undefined) {
  return TRANSPORT_OPTIONS.find((option) => option.value === (value ?? 'auto')) ?? TRANSPORT_OPTIONS[0];
}

function sourceToDraft(source: McpSource): Draft {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    transport: source.transport ?? 'auto',
    authMode: source.authMode,
    authHeaderName: source.authHeaderName ?? '',
    secret: '',
    hasCredential: source.hasCredential,
    applicableWorksText: source.applicableWorks.join('、'),
    universal: source.universal,
    purpose: source.purpose,
    allowedTools: [...source.allowedTools],
    discoveredTools: source.discoveredTools ?? [],
    timeoutMs: String(source.timeoutMs ?? 45_000),
    status: source.status,
  };
}

function normalizeTimeout(value: string): number {
  const timeout = Number(value);
  if (!Number.isFinite(timeout)) return 45_000;
  return Math.min(Math.max(Math.round(timeout), 1_000), 300_000);
}

function draftToPayload(draft: Draft): McpSourceSave {
  const works = draft.applicableWorksText
    .split(/[、,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100);

  return {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name.trim(),
    url: draft.url.trim(),
    transport: draft.transport,
    authMode: draft.authMode,
    ...(draft.authMode === 'header' && draft.authHeaderName.trim()
      ? { authHeaderName: draft.authHeaderName.trim() }
      : {}),
    ...(draft.authMode !== 'none' && draft.secret ? { secret: draft.secret } : {}),
    applicableWorks: works,
    universal: draft.universal,
    purpose: draft.purpose.trim(),
    allowedTools: draft.allowedTools,
    timeoutMs: normalizeTimeout(draft.timeoutMs),
    status: draft.status,
  };
}

function EditorSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-panel bg-surface-sunken/50 p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function McpSourceManager() {
  const toast = useToast();
  const instanceId = useId().replaceAll(':', '');
  const managerTitleId = `${instanceId}-title`;
  const editorFormId = `${instanceId}-editor-form`;
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);

  const sourcesQuery = useQuery({
    queryKey: mcpSourceKeys.all,
    queryFn: fetchMcpSources,
    staleTime: 15_000,
  });
  const sources = sourcesQuery.data ?? null;
  const loading = sourcesQuery.isLoading;
  const load = () => sourcesQuery.refetch();
  const loadError = sourcesQuery.error instanceof Error
    ? sourcesQuery.error.message
    : sourcesQuery.error
      ? String(sourcesQuery.error)
      : null;

  const filteredSources = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    const list = sources ?? [];
    if (!query) return list;
    return list.filter((source) => [
      source.name,
      source.url,
      source.purpose,
      ...source.applicableWorks,
      ...source.allowedTools,
      transportOption(source.transport).label,
      AUTH_LABELS[source.authMode],
    ].join(' ').toLowerCase().includes(query));
  }, [deferredSearch, sources]);

  const enabledCount = useMemo(
    () => (sources ?? []).filter((source) => source.status === 'enabled').length,
    [sources],
  );
  const allowedToolCount = useMemo(
    () => (sources ?? []).reduce((total, source) => total + source.allowedTools.length, 0),
    [sources],
  );
  const toolChoices = useMemo<ToolChoice[]>(() => {
    const choices = new Map<string, ToolChoice>();
    for (const tool of draft.discoveredTools) choices.set(tool.name, tool);
    for (const name of draft.allowedTools) {
      if (!choices.has(name)) choices.set(name, { name, savedOnly: true });
    }
    return [...choices.values()];
  }, [draft.allowedTools, draft.discoveredTools]);

  const openNew = () => {
    setError(null);
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT, allowedTools: [], discoveredTools: [] });
    setEditorOpen(true);
  };

  const openEdit = (source: McpSource) => {
    setError(null);
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
        toast.success('MCP 连接已更新');
      } else {
        const result = await createMcpSource(payload);
        if (result.warning) {
          toast.warning('MCP 连接已保存，但凭据未能写入安全存储：' + result.warning);
        } else {
          toast.success('MCP 连接已创建');
        }
      }
      setEditorOpen(false);
      void load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (source: McpSource) => {
    setTestingId(source.id);
    try {
      const result = await testMcpSource(source.id);
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
        transport: draft.transport,
        authMode: draft.authMode,
        authHeaderName: draft.authHeaderName.trim() || undefined,
        secret: draft.secret || undefined,
        timeoutMs: normalizeTimeout(draft.timeoutMs),
      });
      if (result.ok) {
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
    if (mutatingId) return;
    const next = source.status === 'enabled' ? 'disabled' : 'enabled';
    setMutatingId(source.id);
    try {
      await setMcpSourceStatus(source.id, next);
      toast.success(next === 'enabled' ? 'MCP 连接已启用' : 'MCP 连接已停用');
      void load();
    } catch (toggleError) {
      toast.error(toggleError instanceof Error ? toggleError.message : String(toggleError));
    } finally {
      setMutatingId(null);
    }
  };

  const handleDelete = async (source: McpSource) => {
    if (mutatingId) return;
    if (!window.confirm('确定删除 MCP 连接「' + source.name + '」？')) return;
    setMutatingId(source.id);
    try {
      await deleteMcpSource(source.id);
      toast.success('MCP 连接已删除');
      void load();
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setMutatingId(null);
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
    <section aria-labelledby={managerTitleId} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={managerTitleId} className="text-base font-semibold text-ink">MCP 连接</h2>
            <Badge variant="secondary">{sources ? `${sources.length} 个接口` : '加载中'}</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            管理供资料搜集、查证与创作检索使用的 MCP 接口。可同时配置多个服务，并为每个连接单独设置传输协议和工具权限。
          </p>
          {sources && sources.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{enabledCount} 个已启用</span>
              <span aria-hidden="true">·</span>
              <span>{allowedToolCount} 项工具权限</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            loading={sourcesQuery.isFetching}
            leftSection={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => void load()}
          >
            刷新
          </Button>
          <Button size="sm" variant="primary" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            新增连接
          </Button>
        </div>
      </div>

      {sources && sources.length > 0 && (
        <search aria-label="筛选 MCP 连接" className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${instanceId}-search`} className="sr-only">搜索 MCP 连接</label>
          <div className="relative min-w-0 flex-1 basis-64">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <Input
              id={`${instanceId}-search`}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
              placeholder="按名称、地址、作品或工具筛选"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {search && (
            <Button size="sm" variant="ghost" onClick={() => setSearch('')}>
              清除筛选
            </Button>
          )}
        </search>
      )}

      {loadError && (
        <Alert variant="danger" title="MCP 连接加载失败">
          {loadError}。请点击“刷新”重试；已有配置不会因此删除。
        </Alert>
      )}
      {loading && !sources ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="h-4 w-4" />正在加载 MCP 连接…
        </p>
      ) : null}
      {!loading && sources?.length === 0 && (
        <div className="rounded-panel bg-surface-sunken/50 p-6">
          <h3 className="text-sm font-semibold text-ink">还没有 MCP 连接</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            添加 Streamable HTTP 或兼容 SSE 的 MCP 服务后，研究任务即可按你的工具权限进行检索。未配置时仍可使用本地资料库。
          </p>
          <Button className="mt-4" variant="outline" onClick={openNew}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            添加第一个连接
          </Button>
        </div>
      )}
      {sources && sources.length > 0 && filteredSources.length === 0 && (
        <div className="rounded-panel bg-surface-sunken/50 p-6 text-sm text-muted">
          没有匹配“{deferredSearch.trim()}”的 MCP 连接。
        </div>
      )}

      <div className="space-y-3">
        {filteredSources.map((source) => {
          const transport = transportOption(source.transport);
          const testResult = source.lastTestResult;
          const sourceTitleId = `${instanceId}-source-${source.id}`;
          return (
            <article
              key={source.id}
              aria-labelledby={sourceTitleId}
              data-transport={source.transport ?? 'auto'}
              className={`rounded-panel border border-border-subtle p-4 ${
                source.status === 'enabled' ? 'bg-surface' : 'bg-surface-sunken/50'
              }`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 id={sourceTitleId} className="min-w-0 break-words text-sm font-semibold text-ink">
                      {source.name}
                    </h3>
                    <Badge variant={source.status === 'enabled' ? 'online' : 'stopped'} dot>
                      {source.status === 'enabled' ? '已启用' : '已停用'}
                    </Badge>
                    <Badge variant="secondary">
                      <Network className="h-3 w-3" aria-hidden="true" />
                      {transport.compactLabel}
                    </Badge>
                    <Badge variant="outline">
                      {source.universal ? '通用范围' : (source.applicableWorks.join('、') || '未标注作品')}
                    </Badge>
                  </div>

                  <p className="mt-2 flex min-w-0 items-start gap-2 text-sm text-muted">
                    <Globe2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <code className="min-w-0 break-all font-mono text-xs leading-relaxed text-ink/85">{source.url}</code>
                  </p>
                  {source.purpose && (
                    <p className="mt-2 break-words text-sm leading-relaxed text-muted">{source.purpose}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      {AUTH_LABELS[source.authMode]}
                      {source.authMode !== 'none' && (source.hasCredential ? ' · 已存凭据' : ' · 未存凭据')}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                      {source.allowedTools.length} 个工具可调用
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                      {Math.round((source.timeoutMs ?? 45_000) / 1_000)} 秒超时
                    </span>
                  </div>

                  {testResult && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant={testResult.ok ? 'online' : 'error'}>
                        {testResult.ok ? '连接正常' : '连接失败'}
                      </Badge>
                      {testResult.transport && (
                        <span className="text-muted">实际传输：{transportOption(testResult.transport).label}</span>
                      )}
                      <span className="min-w-0 break-words text-muted">{testResult.message}</span>
                    </div>
                  )}

                  <details className="mt-3 border-t border-border-subtle pt-3 text-sm text-muted">
                    <summary className="cursor-pointer select-none font-medium text-ink">接口详情与工具权限</summary>
                    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-medium text-ink">配置传输</dt>
                        <dd className="mt-0.5">{transport.label}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-ink">认证状态</dt>
                        <dd className="mt-0.5">
                          {AUTH_LABELS[source.authMode]}
                          {source.authMode !== 'none' && (source.hasCredential ? '，凭据已安全保存' : '，尚未保存凭据')}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-3">
                      <p className="text-xs font-medium text-ink">允许工具</p>
                      <p className="mt-1 break-words leading-relaxed">
                        {source.allowedTools.join('、') || '尚未授权任何工具'}
                      </p>
                    </div>
                  </details>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1 lg:max-w-64 lg:justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    loading={testingId === source.id}
                    disabled={testingId === source.id || source.status === 'disabled'}
                    aria-label={`测试连接 ${source.name}`}
                    onClick={() => void handleTest(source)}
                  >
                    {testingId !== source.id && <PlugZap className="h-3.5 w-3.5" aria-hidden="true" />}
                    测试连接
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`编辑 ${source.name}`}
                    onClick={() => openEdit(source)}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(mutatingId)}
                    aria-label={`${source.status === 'enabled' ? '停用' : '启用'} ${source.name}`}
                    onClick={() => void handleToggle(source)}
                  >
                    {source.status === 'enabled'
                      ? <PowerOff className="h-3.5 w-3.5" aria-hidden="true" />
                      : <Power className="h-3.5 w-3.5" aria-hidden="true" />}
                    {source.status === 'enabled' ? '停用' : '启用'}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger-ghost"
                    disabled={Boolean(mutatingId)}
                    aria-label={`删除 ${source.name}`}
                    onClick={() => void handleDelete(source)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    删除
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (!saving) setEditorOpen(open);
        }}
        title={editingId ? '编辑 MCP 连接' : '新增 MCP 连接'}
        description="为资料检索配置接口、认证、适用范围和明确的工具权限。"
        size="lg"
        className="max-w-3xl"
        footer={(
          <div className="flex w-full flex-wrap items-center justify-end gap-3">
            <Button variant="outline" disabled={saving} onClick={() => setEditorOpen(false)}>取消</Button>
            <Button type="submit" form={editorFormId} variant="primary" disabled={saving}>
              {saving ? '保存中…' : (editingId ? '保存更改' : '创建连接')}
            </Button>
          </div>
        )}
      >
        <form
          id={editorFormId}
          aria-label={editingId ? '编辑 MCP 连接表单' : '新增 MCP 连接表单'}
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          {error && <Alert variant="danger" title="操作失败">{error}</Alert>}

          <EditorSection
            title="连接配置"
            description="填写服务名称和 MCP 端点，并选择协议探测方式。自动检测适用于大多数服务。"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="连接名称" required>
                <Input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="例如：虚空终端 / 项目资料库"
                  autoComplete="off"
                />
              </FormField>
              <FormField label="接口地址" required hint="支持 HTTP 或 HTTPS MCP 端点。">
                <Input
                  type="url"
                  value={draft.url}
                  onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
                  placeholder="https://example.com/mcp"
                  autoComplete="url"
                  spellCheck={false}
                />
              </FormField>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-ink">传输协议</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {TRANSPORT_OPTIONS.map((option) => {
                  const checked = draft.transport === option.value;
                  return (
                    <label
                      key={option.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors ${
                        checked
                          ? 'border-[var(--selection-border)] bg-[var(--selection-bg)]'
                          : 'border-border-subtle bg-surface hover:bg-surface-hover'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`${instanceId}-transport`}
                        value={option.value}
                        checked={checked}
                        onChange={() => setDraft((current) => ({ ...current, transport: option.value }))}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">{option.label}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted">{option.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="认证方式">
                <Select
                  value={draft.authMode}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    authMode: event.target.value as McpSourceSave['authMode'],
                  }))}
                >
                  <option value="none">无认证</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="header">自定义认证请求头</option>
                </Select>
              </FormField>
              <FormField
                label="连接超时（毫秒）"
                required
                hint="允许范围 1,000 至 300,000 毫秒。"
              >
                <Input
                  type="number"
                  min={1_000}
                  max={300_000}
                  step={1_000}
                  value={draft.timeoutMs}
                  onChange={(event) => setDraft((current) => ({ ...current, timeoutMs: event.target.value }))}
                  inputMode="numeric"
                />
              </FormField>
            </div>

            {draft.authMode === 'header' && (
              <FormField label="认证请求头" required hint="只保存请求头名称；请求头值进入安全凭据存储。">
                <Input
                  value={draft.authHeaderName}
                  onChange={(event) => setDraft((current) => ({ ...current, authHeaderName: event.target.value }))}
                  placeholder="例如：X-API-Key"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </FormField>
            )}

            {draft.authMode !== 'none' && (
              <FormField
                label={draft.authMode === 'bearer' ? '访问 Token' : '认证请求头值'}
                hint={draft.hasCredential
                  ? '已安全保存凭据。留空将继续使用现有值。'
                  : '新值会写入安全存储；留空时尝试使用该连接对应的服务环境变量。'}
              >
                <Input
                  type="password"
                  value={draft.secret}
                  onChange={(event) => setDraft((current) => ({ ...current, secret: event.target.value }))}
                  placeholder={draft.hasCredential ? '留空保持现有凭据' : '输入凭据；不会在下次编辑时回显'}
                  autoComplete="new-password"
                />
              </FormField>
            )}
          </EditorSection>

          <EditorSection
            title="研究范围"
            description="说明连接用途并限定适用范围。通用连接会参与所有作品的可选资料源。"
          >
            <FormField label="用途说明">
              <Textarea
                value={draft.purpose}
                rows={3}
                onChange={(event) => setDraft((current) => ({ ...current, purpose: event.target.value }))}
                placeholder="例如：剧情原文检索、角色百科、地点资料"
              />
            </FormField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="适用作品" hint="使用顿号、逗号或换行分隔；最多保存 100 项。">
                <Input
                  value={draft.applicableWorksText}
                  disabled={draft.universal}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    applicableWorksText: event.target.value,
                  }))}
                  placeholder="例如：原神、崩坏：星穹铁道"
                />
              </FormField>
              <FormField label="连接状态" hint="停用后保留配置与已存凭据，但不会参与资料检索。">
                <div className="flex min-h-10 items-center">
                  <Switch
                    label="启用此连接"
                    checked={draft.status === 'enabled'}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      status: event.target.checked ? 'enabled' : 'disabled',
                    }))}
                  />
                </div>
              </FormField>
            </div>
            <div className="rounded-control bg-surface p-3">
              <Switch
                label="通用连接"
                description="不限定作品，所有研究任务都可以选择此接口。"
                checked={draft.universal}
                onChange={(event) => setDraft((current) => ({ ...current, universal: event.target.checked }))}
              />
            </div>
          </EditorSection>

          <EditorSection
            title="工具权限"
            description="先测试连接并发现工具，再只授权研究所需的工具。未勾选的工具不会暴露给检索流程。"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-ink">允许调用的工具</p>
                <p className="mt-0.5 text-xs text-muted">
                  已选择 {draft.allowedTools.length} 个
                  {toolChoices.length > 0 ? `，当前列出 ${toolChoices.length} 个` : ''}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                loading={discovering}
                disabled={discovering || !draft.url.trim()}
                onClick={() => void handleDiscover()}
              >
                {!discovering && <PlugZap className="h-3.5 w-3.5" aria-hidden="true" />}
                测试并发现工具
              </Button>
            </div>

            {toolChoices.length > 0 ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={draft.allowedTools.length === toolChoices.length}
                    onClick={() => setDraft((current) => ({
                      ...current,
                      allowedTools: toolChoices.map((tool) => tool.name),
                    }))}
                  >
                    全选
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={draft.allowedTools.length === 0}
                    onClick={() => setDraft((current) => ({ ...current, allowedTools: [] }))}
                  >
                    清空
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {toolChoices.map((tool) => {
                    const checked = draft.allowedTools.includes(tool.name);
                    return (
                      <button
                        key={tool.name}
                        type="button"
                        aria-pressed={checked}
                        aria-label={`允许调用 ${tool.name}`}
                        onClick={() => toggleTool(tool.name)}
                        className={`flex min-w-0 items-start gap-3 rounded-control border p-3 text-left transition-colors ${
                          checked
                            ? 'border-[var(--selection-border)] bg-[var(--selection-bg)]'
                            : 'border-border-subtle bg-surface hover:bg-surface-hover'
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border ${
                            checked
                              ? 'border-accent bg-accent text-fg-on-accent'
                              : 'border-border-default bg-surface text-transparent'
                          }`}
                          aria-hidden="true"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0">
                          <span className="flex min-w-0 flex-wrap items-center gap-2">
                            <code className="break-all font-mono text-xs font-semibold text-ink">{tool.name}</code>
                            {tool.savedOnly && <Badge variant="secondary">已保存权限</Badge>}
                          </span>
                          {tool.description && (
                            <span className="mt-1 block break-words text-xs leading-relaxed text-muted">
                              {tool.description}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="rounded-control bg-surface p-3 text-sm leading-relaxed text-muted">
                尚无工具清单。保存前可先测试连接并发现工具，再按需勾选。
              </div>
            )}
          </EditorSection>
        </form>
      </Dialog>
    </section>
  );
}
