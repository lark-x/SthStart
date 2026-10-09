'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Image as ImageIcon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { GenerationConnectionTestResult } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button, buttonVariants } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Dialog } from '@/app/components/ui/dialog';
import { Drawer } from '@/app/components/ui/drawer';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { useToast } from '@/app/providers/ui-provider';
import { saveGenerationEngine, testGenerationEngine } from '@/app/features/generation/api';
import type { Engine } from '@/app/features/generation/types';

interface EngineFormState {
  id: string;
  name: string;
  kind: 'comfyui' | 'cloud' | 'worker';
  baseUrl: string;
  secret: string;
  concurrencyLimit: number;
  enabled: boolean;
}

const EMPTY_ENGINE_FORM: EngineFormState = {
  id: '',
  name: '',
  kind: 'comfyui',
  baseUrl: '',
  secret: '',
  concurrencyLimit: 1,
  enabled: true,
};

export function ImageModelsPanel({
  engines,
  onRefresh,
}: {
  engines: Engine[];
  onRefresh: () => Promise<void>;
}) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [filterKind, setFilterKind] = useState<string>('all');

  // 对话框状态
  const [formOpen, setFormOpen] = useState(false);
  const [editingEngine, setEditingEngine] = useState<Engine | null>(null);
  const [formData, setFormData] = useState<EngineFormState>(EMPTY_ENGINE_FORM);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // 连通性测试抽屉
  const [testDrawerOpen, setTestDrawerOpen] = useState(false);
  const [testingEngine, setTestingEngine] = useState<Engine | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<GenerationConnectionTestResult | null>(null);

  const filtered = engines.filter((e) => {
    const matchesSearch =
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.base_url.toLowerCase().includes(search.toLowerCase()) ||
      e.id.toLowerCase().includes(search.toLowerCase());
    const matchesKind = filterKind === 'all' || e.kind === filterKind;
    return matchesSearch && matchesKind;
  });

  const handleOpenCreate = () => {
    setEditingEngine(null);
    setFormData({
      ...EMPTY_ENGINE_FORM,
      id: `eng-${Date.now().toString(36)}`,
    });
    setFormError('');
    setFormOpen(true);
  };

  const handleOpenEdit = (eng: Engine) => {
    setEditingEngine(eng);
    setFormData({
      id: eng.id,
      name: eng.name,
      kind: eng.kind,
      baseUrl: eng.base_url,
      secret: '',
      concurrencyLimit: eng.concurrency_limit || 1,
      enabled: Boolean(eng.enabled),
    });
    setFormError('');
    setFormOpen(true);
  };

  const handleSaveEngine = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSaving(true);
    setFormError('');

    try {
      await saveGenerationEngine({
        id: formData.id.trim(),
        name: formData.name.trim(),
        kind: formData.kind,
        baseUrl: formData.baseUrl.trim(),
        secret: formData.secret.trim() || undefined,
        concurrencyLimit: Number(formData.concurrencyLimit) || 1,
        enabled: formData.enabled,
      });

      toast.success(editingEngine ? '绘图引擎已更新。' : '绘图引擎已创建。');
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

  // 探测测试
  const handleOpenTestDrawer = (eng: Engine) => {
    setTestingEngine(eng);
    setTestResult(null);
    setTestDrawerOpen(true);
    void runProbe(eng.id);
  };

  const runProbe = async (engineId: string) => {
    setTesting(true);
    try {
      const res = await testGenerationEngine(engineId);
      setTestResult(res);
      if (res.ok) {
        toast.success('引擎连通性测试通过。');
      } else {
        toast.warning('引擎连通性测试未通过', res.errorMessage || undefined);
      }
    } catch (err) {
      setTestResult({
        ok: false,
        kind: testingEngine?.kind ?? 'comfyui',
        latencyMs: 0,
        checkedAt: new Date().toISOString(),
        summary: null,
        discoverySupported: null,
        errorCode: 'probe_error',
        errorMessage: err instanceof Error ? err.message : '连接异常。',
      });
    } finally {
      setTesting(false);
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
              placeholder="搜索引擎名称、地址或 ID..."
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
            <option value="all">全部引擎类型</option>
            <option value="comfyui">ComfyUI 直连</option>
            <option value="cloud">云端兼容接口 (Cloud)</option>
            <option value="worker">Windows Worker</option>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/settings/generation"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1" />
            高级生图工作台
          </Link>
          <Button variant="outline" size="sm" onClick={() => void onRefresh()}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
          <Button variant="primary" size="sm" onClick={handleOpenCreate}>
            <Plus className="h-4 w-4" />
            新建绘图引擎
          </Button>
        </div>
      </div>

      {/* 提示信息条 */}
      <div className="p-3.5 rounded-lg border border-border-default bg-surface-raised flex items-center justify-between gap-3 text-xs text-muted">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-accent shrink-0" />
          <span>支持本地 ComfyUI GPU 算力集群与 OpenAI 兼容云端生图接口（DALL-E 3、聚合绘图等）双模调度。</span>
        </div>
        <Link href="/settings/generation" className="text-accent hover:underline shrink-0">
          管理生图配方与工作流 &rarr;
        </Link>
      </div>

      {/* 引擎列表 */}
      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted">
          <p className="text-sm">暂无匹配的绘图引擎。点击上方“新建绘图引擎”添加一个。</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((eng) => (
            <Card key={eng.id} className="relative flex flex-col justify-between overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base truncate">{eng.name}</CardTitle>
                    <CardDescription className="text-xs font-mono text-muted truncate mt-0.5">
                      ID: {eng.id}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant={eng.enabled ? 'online' : 'unknown'}>
                      {eng.enabled ? '已启用' : '已停用'}
                    </Badge>
                    <Badge variant="outline">
                      {eng.kind === 'comfyui'
                        ? 'ComfyUI'
                        : eng.kind === 'cloud'
                        ? '云端兼容'
                        : 'Worker'}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm pt-0">
                <div className="text-xs font-mono bg-surface-raised px-2.5 py-1.5 rounded border border-border-subtle truncate text-ink">
                  {eng.base_url}
                </div>
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>并发调度上限：{eng.concurrency_limit} 任务</span>
                  {eng.lastTest && (
                    <span className={eng.lastTest.ok ? 'text-emerald-600' : 'text-danger'}>
                      {eng.lastTest.ok ? '连接正常' : '连接异常'}
                    </span>
                  )}
                </div>

                <div className="pt-2 border-t border-border-subtle flex items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenTestDrawer(eng)}
                    className="text-xs h-7 px-2.5 text-accent"
                  >
                    <Activity className="h-3 w-3" />
                    探测连通性
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenEdit(eng)}
                    className="h-7 w-7 p-0"
                    aria-label="编辑引擎"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 新建/编辑引擎对话框 */}
      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editingEngine ? '编辑绘图引擎' : '新建绘图引擎'}
        className="max-w-lg"
      >
        <form onSubmit={handleSaveEngine} className="space-y-4">
          {formError && <Alert variant="danger" title="保存失败">{formError}</Alert>}
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">引擎内部 ID</label>
            <Input
              value={formData.id}
              onChange={(e) => setFormData({ ...formData, id: e.target.value })}
              required
              disabled={Boolean(editingEngine)}
              placeholder="e.g. comfyui-local / cloud-openai"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">显示名称</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="本地 ComfyUI 或 OpenAI 绘图"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">引擎类型</label>
              <Select
                value={formData.kind}
                onChange={(e) => setFormData({ ...formData, kind: e.target.value as 'comfyui' | 'cloud' | 'worker' })}
                disabled={Boolean(editingEngine)}
              >
                <option value="comfyui">ComfyUI 直连（默认）</option>
                <option value="cloud">云端兼容接口（OpenAI / DALL-E）</option>
                <option value="worker">Windows Worker（高级）</option>
              </Select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">服务地址 (Base URL)</label>
            <Input
              value={formData.baseUrl}
              onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
              required
              placeholder={formData.kind === 'cloud' ? 'https://api.openai.com/v1' : 'http://127.0.0.1:8188'}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">
              认证凭据 / Token {editingEngine && '（留空保持不变）'}
            </label>
            <Input
              type="password"
              value={formData.secret}
              onChange={(e) => setFormData({ ...formData, secret: e.target.value })}
              placeholder={editingEngine ? '••••••••' : '通常云端接口需填 API Key，本地 ComfyUI 留空'}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">并发限制</label>
              <Input
                type="number"
                min={1}
                value={formData.concurrencyLimit}
                onChange={(e) => setFormData({ ...formData, concurrencyLimit: Number(e.target.value) })}
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
                启用该引擎
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" disabled={formSaving}>
              {formSaving && <Spinner className="h-3.5 w-3.5 mr-1" />}
              {editingEngine ? '保存修改' : '立即创建'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* 引擎探测抽屉 */}
      <Drawer
        open={testDrawerOpen}
        onOpenChange={setTestDrawerOpen}
        title="绘图引擎探测"
        description={testingEngine ? `探测目标：${testingEngine.name} (${testingEngine.base_url})` : undefined}
      >
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">即时连通性状态</span>
            <Button
              variant="outline"
              size="sm"
              disabled={testing || !testingEngine}
              onClick={() => testingEngine && void runProbe(testingEngine.id)}
            >
              {testing ? <Spinner className="h-3.5 w-3.5 mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              重新探测
            </Button>
          </div>

          {testing ? (
            <div className="p-8 text-center text-sm text-muted">
              <Spinner className="h-6 w-6 mx-auto mb-2" />
              正在探测绘图引擎接口...
            </div>
          ) : testResult ? (
            <div className="space-y-3">
              <div
                className={`p-4 rounded-lg border flex items-start gap-3 ${
                  testResult.ok
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-danger/30 bg-danger/10 text-danger'
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-5 w-5 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-semibold text-sm">
                    {testResult.ok ? '引擎正常就绪' : '引擎不可达或异常'}
                  </div>
                  <div className="text-xs mt-1">
                    {testResult.summary || testResult.errorMessage}
                  </div>
                </div>
              </div>

              {testResult.latencyMs != null && (
                <div className="p-3 rounded-lg border border-border-subtle bg-surface-raised text-xs">
                  <div className="text-muted">往返延迟</div>
                  <div className="text-base font-semibold mt-1">{testResult.latencyMs} ms</div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted">准备就绪，点击上方按钮开始探测。</div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
