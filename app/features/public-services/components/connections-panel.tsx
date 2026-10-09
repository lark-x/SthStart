'use client';

import React, { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Compass,
  Key,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { ConnectionTestResult, DiscoveredModelList, ServiceConnection, ServiceConnectionKind } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Dialog } from '@/app/components/ui/dialog';
import { Drawer } from '@/app/components/ui/drawer';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { useToast } from '@/app/providers/ui-provider';
import {
  deleteConnection,
  discoverConnectionModels,
  saveConnection,
  saveModelProfile,
  testConnectionProbe,
} from '../api';

const KIND_LABELS: Record<ServiceConnectionKind, string> = {
  'openai-compatible-text': 'OpenAI 兼容文本',
  'openai-compatible-image': 'OpenAI 兼容绘图',
  comfyui: 'ComfyUI 直连',
  worker: 'Windows Worker',
  vector: '向量数据库',
};

const CREDENTIAL_LABELS: Record<string, string> = {
  keyring: '系统钥匙串',
  environment: '环境变量',
  none: '无凭据',
};

interface ConnectionFormState {
  id: string;
  name: string;
  kind: ServiceConnectionKind;
  baseUrl: string;
  secret: string;
  timeoutMs: number;
  headers: string;
  enabled: boolean;
}

const EMPTY_FORM: ConnectionFormState = {
  id: '',
  name: '',
  kind: 'openai-compatible-text',
  baseUrl: '',
  secret: '',
  timeoutMs: 60000,
  headers: '{}',
  enabled: true,
};

export function ConnectionsPanel({
  connections,
  onRefresh,
}: {
  connections: ServiceConnection[];
  onRefresh: () => Promise<void>;
}) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [filterKind, setFilterKind] = useState<string>('all');

  // 对话框与抽屉状态
  const [formOpen, setFormOpen] = useState(false);
  const [editingConn, setEditingConn] = useState<ServiceConnection | null>(null);
  const [formData, setFormData] = useState<ConnectionFormState>(EMPTY_FORM);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // 连通性测试抽屉
  const [testDrawerOpen, setTestDrawerOpen] = useState(false);
  const [testConn, setTestConn] = useState<ServiceConnection | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  // 模型自动发现抽屉
  const [discoverDrawerOpen, setDiscoverDrawerOpen] = useState(false);
  const [discoverConn, setDiscoverConn] = useState<ServiceConnection | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredModelList | null>(null);
  const [selectedDiscovered, setSelectedDiscovered] = useState<Set<string>>(new Set());
  const [importingModels, setImportingModels] = useState(false);

  const filtered = connections.filter((conn) => {
    const matchesSearch =
      conn.name.toLowerCase().includes(search.toLowerCase()) ||
      conn.baseUrl.toLowerCase().includes(search.toLowerCase()) ||
      conn.id.toLowerCase().includes(search.toLowerCase());
    const matchesKind = filterKind === 'all' || conn.kind === filterKind;
    return matchesSearch && matchesKind;
  });

  const handleOpenCreate = () => {
    setEditingConn(null);
    setFormData({
      ...EMPTY_FORM,
      id: `conn-${Date.now().toString(36)}`,
    });
    setFormError('');
    setFormOpen(true);
  };

  const handleOpenEdit = (conn: ServiceConnection) => {
    setEditingConn(conn);
    setFormData({
      id: conn.id,
      name: conn.name,
      kind: conn.kind,
      baseUrl: conn.baseUrl,
      secret: '',
      timeoutMs: conn.timeoutMs,
      headers: JSON.stringify(conn.headers, null, 2),
      enabled: conn.enabled,
    });
    setFormError('');
    setFormOpen(true);
  };

  const handleSaveConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSaving(true);
    setFormError('');

    let parsedHeaders: Record<string, string> = {};
    if (formData.headers.trim()) {
      try {
        parsedHeaders = JSON.parse(formData.headers);
      } catch {
        setFormError('Headers 必须为有效的 JSON 对象。');
        setFormSaving(false);
        return;
      }
    }

    try {
      const res = await saveConnection({
        id: formData.id.trim(),
        name: formData.name.trim(),
        kind: formData.kind,
        baseUrl: formData.baseUrl.trim(),
        secret: formData.secret.trim() || undefined,
        timeoutMs: Number(formData.timeoutMs) || 60000,
        headers: parsedHeaders,
        enabled: formData.enabled,
      });

      if (res.warning) {
        toast.warning('连接已保存', res.warning);
      } else {
        toast.success(editingConn ? '服务连接已更新。' : '服务连接已创建。');
      }
      setFormOpen(false);
      await onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(msg);
      toast.error('保存失败', msg);
    } finally {
      setFormSaving(false);
    }
  };

  const handleDeleteConnection = async (conn: ServiceConnection) => {
    if (!window.confirm(`确认删除服务连接“${conn.name}”？已绑定的模型配置需先解绑或删除。`)) {
      return;
    }
    try {
      await deleteConnection(conn.id);
      toast.success('服务连接已删除。');
      await onRefresh();
    } catch (err) {
      toast.error('删除失败', err instanceof Error ? err.message : String(err));
    }
  };

  // 开启测试抽屉
  const handleOpenTestDrawer = (conn: ServiceConnection) => {
    setTestConn(conn);
    setTestResult(null);
    setTestDrawerOpen(true);
    void runProbe(conn.id);
  };

  const runProbe = async (connectionId: string) => {
    setTesting(true);
    try {
      const res = await testConnectionProbe({ connectionId });
      setTestResult(res);
      if (res.success) {
        toast.success('连通性测试通过。');
      } else {
        toast.warning('连通性测试未通过', res.message || undefined);
      }
    } catch (err) {
      setTestResult({
        success: false,
        latencyMs: 0,
        statusCode: null,
        message: err instanceof Error ? err.message : '连接异常。',
      });
    } finally {
      setTesting(false);
    }
  };

  // 开启模型自动发现抽屉
  const handleOpenDiscoverDrawer = (conn: ServiceConnection) => {
    setDiscoverConn(conn);
    setDiscovered(null);
    setSelectedDiscovered(new Set());
    setDiscoverDrawerOpen(true);
    void runDiscover(conn.id);
  };

  const runDiscover = async (connectionId: string) => {
    setDiscovering(true);
    try {
      const res = await discoverConnectionModels({ connectionId });
      setDiscovered(res);
      setSelectedDiscovered(new Set(res.models));
      toast.success(`成功发现 ${res.models.length} 个远端模型。`);
    } catch (err) {
      toast.error('模型发现失败', err instanceof Error ? err.message : String(err));
    } finally {
      setDiscovering(false);
    }
  };

  const toggleSelectModel = (modelName: string) => {
    setSelectedDiscovered((prev) => {
      const next = new Set(prev);
      if (next.has(modelName)) next.delete(modelName);
      else next.add(modelName);
      return next;
    });
  };

  const handleImportSelectedModels = async () => {
    if (!discoverConn || selectedDiscovered.size === 0) return;
    setImportingModels(true);
    let successCount = 0;
    try {
      for (const modelId of selectedDiscovered) {
        const id = `${discoverConn.id}-${modelId.toLowerCase().replace(/[^a-z0-9]/g, '-')}`.slice(0, 64);
        try {
          await saveModelProfile({
            id,
            connectionId: discoverConn.id,
            name: `${discoverConn.name} - ${modelId}`,
            modelId,
            capabilities: ['text'],
            contextLength: 128000,
            enabled: true,
          });
          successCount++;
        } catch {
          // 忽略单个重复错误
        }
      }
      toast.success(`成功导入 ${successCount} 个模型配置。`);
      setDiscoverDrawerOpen(false);
      await onRefresh();
    } catch (err) {
      toast.error('导入模型出错', err instanceof Error ? err.message : String(err));
    } finally {
      setImportingModels(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 顶部搜索与操作栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted pointer-events-none" />
            <Input
              placeholder="搜索连接名称、地址或 ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value)}
            className="w-48"
          >
            <option value="all">全部连接类型</option>
            <option value="openai-compatible-text">OpenAI 兼容文本</option>
            <option value="openai-compatible-image">OpenAI 兼容绘图</option>
            <option value="comfyui">ComfyUI 直连</option>
            <option value="worker">Windows Worker</option>
            <option value="vector">向量数据库</option>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void onRefresh()}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
          <Button variant="primary" size="sm" onClick={handleOpenCreate}>
            <Plus className="h-4 w-4" />
            新建连接
          </Button>
        </div>
      </div>

      {/* 连接列表卡片网格 */}
      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted">
          <p className="text-sm">暂无匹配的服务连接。点击上方“新建连接”添加一个。</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((conn) => (
            <Card key={conn.id} className="relative flex flex-col justify-between overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base truncate">{conn.name}</CardTitle>
                    <CardDescription className="text-xs font-mono text-muted truncate mt-0.5">
                      ID: {conn.id}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant={conn.enabled ? 'online' : 'unknown'}>
                      {conn.enabled ? '已启用' : '已停用'}
                    </Badge>
                    <Badge variant="outline">
                      {KIND_LABELS[conn.kind] ?? conn.kind}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm pt-0">
                <div className="text-xs font-mono bg-surface-raised px-2.5 py-1.5 rounded border border-border-subtle truncate text-ink">
                  {conn.baseUrl}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="flex items-center gap-1">
                    <Key className="h-3 w-3" />
                    凭据：{conn.hasCredential ? CREDENTIAL_LABELS[conn.credentialSource] : '未配置'}
                  </span>
                  <span>超时：{conn.timeoutMs / 1000}s</span>
                </div>

                <div className="pt-2 border-t border-border-subtle flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenTestDrawer(conn)}
                      className="text-xs h-7 px-2"
                    >
                      <Activity className="h-3 w-3" />
                      探测连通性
                    </Button>
                    {conn.kind.startsWith('openai-') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenDiscoverDrawer(conn)}
                        className="text-xs h-7 px-2 text-accent"
                      >
                        <Compass className="h-3 w-3" />
                        发现模型
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEdit(conn)}
                      className="h-7 w-7 p-0"
                      aria-label="编辑连接"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteConnection(conn)}
                      className="h-7 w-7 p-0 text-danger"
                      aria-label="删除连接"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 新建/编辑连接对话框 */}
      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editingConn ? '编辑服务连接' : '新建服务连接'}
        className="max-w-lg"
      >
        <form onSubmit={handleSaveConnection} className="space-y-4">
          {formError && <Alert variant="danger" title="保存失败">{formError}</Alert>}
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">连接内部 ID</label>
            <Input
              value={formData.id}
              onChange={(e) => setFormData({ ...formData, id: e.target.value })}
              required
              disabled={Boolean(editingConn)}
              placeholder="e.g. openai-main"
            />
            <p className="text-2xs text-muted mt-1">创建后作为标识符，不可修改。</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">显示名称</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="OpenAI 官方连接"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">连接类型</label>
              <Select
                value={formData.kind}
                onChange={(e) => setFormData({ ...formData, kind: e.target.value as ServiceConnectionKind })}
              >
                <option value="openai-compatible-text">OpenAI 兼容文本</option>
                <option value="openai-compatible-image">OpenAI 兼容绘图</option>
                <option value="comfyui">ComfyUI 直连</option>
                <option value="worker">Windows Worker</option>
                <option value="vector">向量数据库</option>
              </Select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">服务基础地址 (Base URL)</label>
            <Input
              value={formData.baseUrl}
              onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
              required
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              API Key / 认证凭据 {editingConn && '（留空保持不变）'}
            </label>
            <Input
              type="password"
              value={formData.secret}
              onChange={(e) => setFormData({ ...formData, secret: e.target.value })}
              placeholder={editingConn ? '••••••••' : 'sk-...'}
            />
            <p className="text-2xs text-muted mt-1">凭据安全存入本地系统钥匙串或加密库，不以明文回显。</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">请求超时 (毫秒)</label>
              <Input
                type="number"
                min={1000}
                max={600000}
                value={formData.timeoutMs}
                onChange={(e) => setFormData({ ...formData, timeoutMs: Number(e.target.value) })}
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={formData.enabled}
                  onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                  className="rounded text-accent focus:ring-accent"
                />
                启用该连接
              </label>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">自定义请求头 (JSON 格式)</label>
            <textarea
              value={formData.headers}
              onChange={(e) => setFormData({ ...formData, headers: e.target.value })}
              rows={2}
              className="w-full text-xs font-mono rounded-md border border-border-default bg-surface p-2 focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="{}"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" disabled={formSaving}>
              {formSaving && <Spinner className="h-3.5 w-3.5 mr-1" />}
              {editingConn ? '保存修改' : '立即创建'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* 连通性测试抽屉 */}
      <Drawer
        open={testDrawerOpen}
        onOpenChange={setTestDrawerOpen}
        title="连接连通性探测"
        description={testConn ? `探测目标：${testConn.name} (${testConn.baseUrl})` : undefined}
      >
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">即时连通性探测</span>
            <Button
              variant="outline"
              size="sm"
              disabled={testing || !testConn}
              onClick={() => testConn && void runProbe(testConn.id)}
            >
              {testing ? <Spinner className="h-3.5 w-3.5 mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              重新探测
            </Button>
          </div>

          {testing ? (
            <div className="p-8 text-center text-sm text-muted">
              <Spinner className="h-6 w-6 mx-auto mb-2" />
              正在向远端节点发起轻量探测请求...
            </div>
          ) : testResult ? (
            <div className="space-y-3">
              <div
                className={`p-4 rounded-lg border flex items-start gap-3 ${
                  testResult.success
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-danger/30 bg-danger/10 text-danger'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-5 w-5 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-semibold text-sm">
                    {testResult.success ? '探测成功' : '探测未通过'}
                  </div>
                  <div className="text-xs mt-1">{testResult.message}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-3 rounded-lg border border-border-subtle bg-surface-raised">
                  <div className="text-muted">响应往返延迟</div>
                  <div className="text-base font-semibold mt-1">{testResult.latencyMs} ms</div>
                </div>
                <div className="p-3 rounded-lg border border-border-subtle bg-surface-raised">
                  <div className="text-muted">HTTP 状态码</div>
                  <div className="text-base font-semibold mt-1">{testResult.statusCode ?? '—'}</div>
                </div>
              </div>

              {testResult.discoveredModels && testResult.discoveredModels.length > 0 && (
                <div className="space-y-1.5 pt-2">
                  <div className="text-xs font-semibold text-ink">
                    附带发现的模型 ({testResult.discoveredModels.length})
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded border border-border-subtle p-2 space-y-1 bg-surface-raised">
                    {testResult.discoveredModels.map((m) => (
                      <div key={m} className="text-xs font-mono text-muted">
                        {m}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted">准备就绪，点击上方按钮开始探测。</div>
          )}
        </div>
      </Drawer>

      {/* 模型目录自动发现抽屉 */}
      <Drawer
        open={discoverDrawerOpen}
        onOpenChange={setDiscoverDrawerOpen}
        title="发现并导入远端模型"
        description={discoverConn ? `从 ${discoverConn.name} 获取可用模型列表` : undefined}
      >
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">远端可用模型</span>
            <Button
              variant="outline"
              size="sm"
              disabled={discovering || !discoverConn}
              onClick={() => discoverConn && void runDiscover(discoverConn.id)}
            >
              {discovering ? <Spinner className="h-3.5 w-3.5 mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              重新发现
            </Button>
          </div>

          {discovering ? (
            <div className="p-8 text-center text-sm text-muted">
              <Spinner className="h-6 w-6 mx-auto mb-2" />
              正在查询远端模型目录...
            </div>
          ) : discovered ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>共发现 {discovered.models.length} 个模型</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={() => setSelectedDiscovered(new Set(discovered.models))}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className="text-muted hover:underline"
                    onClick={() => setSelectedDiscovered(new Set())}
                  >
                    全清
                  </button>
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto rounded-lg border border-border-default bg-surface divide-y divide-border-subtle">
                {discovered.models.map((modelId) => {
                  const isChecked = selectedDiscovered.has(modelId);
                  return (
                    <label
                      key={modelId}
                      className="flex items-center gap-2.5 p-2.5 text-xs hover:bg-surface-raised cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelectModel(modelId)}
                        className="rounded text-accent focus:ring-accent"
                      />
                      <span className="font-mono text-ink truncate">{modelId}</span>
                    </label>
                  );
                })}
              </div>

              <Button
                variant="primary"
                className="w-full"
                disabled={selectedDiscovered.size === 0 || importingModels}
                onClick={handleImportSelectedModels}
              >
                {importingModels && <Spinner className="h-3.5 w-3.5 mr-1" />}
                一键添加为模型配置 ({selectedDiscovered.size})
              </Button>
            </div>
          ) : (
            <div className="text-xs text-muted">尚未发现模型，请点击刷新开始。</div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
