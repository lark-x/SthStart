'use client';

import React, { useState } from 'react';
import {
  Brain,
  CheckCircle2,
  Copy,
  ExternalLink,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import type {
  LlmModelCapability,
  ModelInferenceTestResult,
  ModelProfile,
  ServiceConnection,
} from '@sthstart/contracts';
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
  deleteModelProfile,
  saveModelProfile,
  testModelInference,
} from '../api';

const ALL_CAPABILITIES: Array<{ id: LlmModelCapability; label: string }> = [
  { id: 'text', label: '通用文本 (text)' },
  { id: 'multimodal', label: '多模态视觉 (multimodal)' },
];

const PRESET_PROMPTS = [
  { label: '自我介绍', prompt: '你好！请用一两句话介绍你自己。' },
  { label: 'JSON 结构化', prompt: '请输出包含 greeting 和 timestamp 字段的纯 JSON 对象，不要附加任何 Markdown 标记。' },
  { label: '推理问答', prompt: '树上有 5 只鸟，猎人开枪打中 1 只，树上还剩下几只鸟？请简要推理回答。' },
];

interface ModelFormState {
  id: string;
  connectionId: string;
  name: string;
  modelId: string;
  capabilities: LlmModelCapability[];
  contextLength: number | '';
  maxOutputTokens: number | '';
  enabled: boolean;
}

const EMPTY_MODEL_FORM: ModelFormState = {
  id: '',
  connectionId: '',
  name: '',
  modelId: '',
  capabilities: ['text'],
  contextLength: '',
  maxOutputTokens: '',
  enabled: true,
};

export function TextModelsPanel({
  models,
  connections,
  onRefresh,
}: {
  models: ModelProfile[];
  connections: ServiceConnection[];
  onRefresh: () => Promise<void>;
}) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [filterConn, setFilterConn] = useState<string>('all');

  // 对话框状态
  const [formOpen, setFormOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelProfile | null>(null);
  const [formData, setFormData] = useState<ModelFormState>(EMPTY_MODEL_FORM);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // 推理测试抽屉
  const [testDrawerOpen, setTestDrawerOpen] = useState(false);
  const [testingModel, setTestingModel] = useState<ModelProfile | null>(null);
  const [testType, setTestType] = useState<'text' | 'json' | 'vision'>('text');
  const [prompt, setPrompt] = useState(PRESET_PROMPTS[0].prompt);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ModelInferenceTestResult | null>(null);

  const connectionMap = new Map(connections.map((c) => [c.id, c]));

  const filtered = models.filter((model) => {
    const matchesSearch =
      model.name.toLowerCase().includes(search.toLowerCase()) ||
      model.modelId.toLowerCase().includes(search.toLowerCase()) ||
      model.id.toLowerCase().includes(search.toLowerCase());
    const matchesConn = filterConn === 'all' || model.connectionId === filterConn;
    return matchesSearch && matchesConn;
  });

  const handleOpenCreate = () => {
    setEditingModel(null);
    setFormData({
      ...EMPTY_MODEL_FORM,
      id: `model-${Date.now().toString(36)}`,
      connectionId: connections[0]?.id ?? '',
    });
    setFormError('');
    setFormOpen(true);
  };

  const handleOpenEdit = (m: ModelProfile) => {
    setEditingModel(m);
    setFormData({
      id: m.id,
      connectionId: m.connectionId,
      name: m.name,
      modelId: m.modelId,
      capabilities: [...m.capabilities],
      contextLength: m.contextLength ?? '',
      maxOutputTokens: m.maxOutputTokens ?? '',
      enabled: m.enabled,
    });
    setFormError('');
    setFormOpen(true);
  };

  const handleToggleCapability = (cap: LlmModelCapability) => {
    setFormData((prev) => {
      const exists = prev.capabilities.includes(cap);
      const nextCaps = exists
        ? prev.capabilities.filter((c) => c !== cap)
        : [...prev.capabilities, cap];
      return { ...prev, capabilities: nextCaps };
    });
  };

  const handleSaveModel = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSaving(true);
    setFormError('');

    if (formData.capabilities.length === 0) {
      setFormError('请至少选择一个模型能力标签。');
      setFormSaving(false);
      return;
    }

    try {
      await saveModelProfile({
        id: formData.id.trim(),
        connectionId: formData.connectionId.trim(),
        name: formData.name.trim(),
        modelId: formData.modelId.trim(),
        capabilities: formData.capabilities,
        contextLength: Number(formData.contextLength) || null,
        maxOutputTokens: Number(formData.maxOutputTokens) || null,
        enabled: formData.enabled,
      });

      toast.success(editingModel ? '模型配置已更新。' : '模型配置已创建。');
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

  const handleDeleteModel = async (m: ModelProfile) => {
    if (!window.confirm(`确认删除模型配置“${m.name}”？`)) {
      return;
    }
    try {
      await deleteModelProfile(m.id);
      toast.success('模型配置已删除。');
      await onRefresh();
    } catch (err) {
      toast.error('删除失败', err instanceof Error ? err.message : String(err));
    }
  };

  // 开启推理测试抽屉
  const handleOpenTestDrawer = (m: ModelProfile) => {
    setTestingModel(m);
    setTestResult(null);
    setTestType('text');
    setPrompt(PRESET_PROMPTS[0].prompt);
    setTestDrawerOpen(true);
  };

  const handleSelectTestType = (type: 'text' | 'json' | 'vision') => {
    setTestType(type);
    setTestResult(null);
    if (type === 'json') {
      setPrompt('请输出包含 status: "ok" 与 message: "connected" 的合法 JSON 对象。');
    } else if (type === 'vision') {
      setPrompt('请识别所提供图片中的内容，并简要回复图片描述与颜色。');
    } else {
      setPrompt(PRESET_PROMPTS[0].prompt);
    }
  };

  const runInferenceTest = async () => {
    if (!testingModel) return;
    setTesting(true);
    try {
      const res = await testModelInference(testingModel.id, prompt.trim(), testType);
      setTestResult(res);
      if (res.success) {
        toast.success('模型推理成功。');
      } else {
        toast.warning('模型推理失败', res.error || undefined);
      }
      await onRefresh();
    } catch (err) {
      setTestResult({
        success: false,
        latencyMs: 0,
        output: null,
        tokenUsage: null,
        error: err instanceof Error ? err.message : '请求异常。',
        aiCallId: null,
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
              placeholder="搜索模型名称、ID 或实际模型名称..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={filterConn}
            onChange={(e) => setFilterConn(e.target.value)}
            className="w-48"
          >
            <option value="all">全部关联连接</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void onRefresh()}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
          <Button variant="primary" size="sm" onClick={handleOpenCreate}>
            <Plus className="h-4 w-4" />
            新建模型配置
          </Button>
        </div>
      </div>

      {/* 模型列表 */}
      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted">
          <p className="text-sm">暂无匹配的模型配置。点击上方“新建模型配置”添加一个。</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((m) => {
            const conn = connectionMap.get(m.connectionId);
            return (
              <Card key={m.id} className="relative flex flex-col justify-between overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base truncate">{m.name}</CardTitle>
                      <CardDescription className="text-xs font-mono text-muted truncate mt-0.5">
                        ID: {m.id}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant={m.enabled ? 'online' : 'unknown'}>
                        {m.enabled ? '已启用' : '已停用'}
                      </Badge>
                      {m.testStatus === 'passed' && <Badge variant="online">测试通过</Badge>}
                      {m.testStatus === 'failed' && <Badge variant="error">测试失败</Badge>}
                      {m.testStatus === 'untested' && <Badge variant="unknown">未测试</Badge>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm pt-0">
                  <div className="flex items-center justify-between text-xs font-mono bg-surface-raised px-2.5 py-1.5 rounded border border-border-subtle">
                    <span className="text-ink truncate font-medium">{m.modelId}</span>
                    <span className="text-muted shrink-0 ml-2">
                      连接：{conn ? conn.name : m.connectionId}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {m.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="text-2xs font-mono px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20"
                      >
                        {cap}
                      </span>
                    ))}
                    {m.contextLength && (
                      <span className="text-2xs font-mono px-2 py-0.5 rounded-full bg-surface-raised text-muted border border-border-subtle">
                        {Math.round(m.contextLength / 1000)}k 窗口
                      </span>
                    )}
                  </div>

                  <div className="pt-2 border-t border-border-subtle flex items-center justify-between gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenTestDrawer(m)}
                      className="text-xs h-7 px-2.5 text-accent"
                    >
                      <Sparkles className="h-3 w-3" />
                      能力推理测试
                    </Button>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenEdit(m)}
                        className="h-7 w-7 p-0"
                        aria-label="编辑模型"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteModel(m)}
                        className="h-7 w-7 p-0 text-danger"
                        aria-label="删除模型"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 新建/编辑模型对话框 */}
      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editingModel ? '编辑模型配置' : '新建模型配置'}
        className="max-w-lg"
      >
        <form onSubmit={handleSaveModel} className="space-y-4">
          {formError && <Alert variant="danger" title="保存失败">{formError}</Alert>}
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">模型配置内部 ID</label>
            <Input
              value={formData.id}
              onChange={(e) => setFormData({ ...formData, id: e.target.value })}
              required
              disabled={Boolean(editingModel)}
              placeholder="e.g. gpt-4o-mini-text"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">所属服务连接</label>
            <Select
              value={formData.connectionId}
              onChange={(e) => setFormData({ ...formData, connectionId: e.target.value })}
              required
            >
              <option value="" disabled>请选择服务连接</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.baseUrl})
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">显示名称</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="GPT-4o Mini 主力"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">实际模型标识 (modelId)</label>
              <Input
                value={formData.modelId}
                onChange={(e) => setFormData({ ...formData, modelId: e.target.value })}
                required
                placeholder="gpt-4o-mini"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink mb-1.5">能力标签</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ALL_CAPABILITIES.map((cap) => (
                <label
                  key={cap.id}
                  className="flex items-center gap-2 p-2 rounded border border-border-subtle bg-surface-raised cursor-pointer text-xs"
                >
                  <input
                    type="checkbox"
                    checked={formData.capabilities.includes(cap.id)}
                    onChange={() => handleToggleCapability(cap.id)}
                    className="rounded text-accent focus:ring-accent"
                  />
                  <span>{cap.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">上下文窗口长度</label>
              <Input
                type="number"
                value={formData.contextLength}
                onChange={(e) => setFormData({ ...formData, contextLength: e.target.value === '' ? '' : Number(e.target.value) })}
                placeholder="128000"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">最大输出 Token</label>
              <Input
                type="number"
                value={formData.maxOutputTokens}
                onChange={(e) => setFormData({ ...formData, maxOutputTokens: e.target.value === '' ? '' : Number(e.target.value) })}
                placeholder="4096"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={formData.enabled}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                className="rounded text-accent focus:ring-accent"
              />
              启用该模型配置
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" disabled={formSaving}>
              {formSaving && <Spinner className="h-3.5 w-3.5 mr-1" />}
              {editingModel ? '保存修改' : '立即创建'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* 模型推理能力即时测试抽屉 */}
      <Drawer
        open={testDrawerOpen}
        onOpenChange={setTestDrawerOpen}
        title="模型推理能力即时测试"
        description={testingModel ? `测试模型：${testingModel.name} (${testingModel.modelId})` : undefined}
      >
        <div className="space-y-4 p-4">
          {/* 测试类型选择 */}
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-ink">能力测试模式：</div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleSelectTestType('text')}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  testType === 'text'
                    ? 'border-accent bg-accent/10 text-accent font-semibold'
                    : 'border-border-default hover:bg-surface-raised text-muted'
                }`}
              >
                通用文本连通性
              </button>
              <button
                type="button"
                onClick={() => handleSelectTestType('json')}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  testType === 'json'
                    ? 'border-accent bg-accent/10 text-accent font-semibold'
                    : 'border-border-default hover:bg-surface-raised text-muted'
                }`}
              >
                JSON 结构校验
              </button>
              <button
                type="button"
                onClick={() => handleSelectTestType('vision')}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  testType === 'vision'
                    ? 'border-accent bg-accent/10 text-accent font-semibold'
                    : 'border-border-default hover:bg-surface-raised text-muted'
                }`}
              >
                多模态视觉测试
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>快捷测试预设：</span>
              <div className="flex items-center gap-1.5">
                {PRESET_PROMPTS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      setPrompt(p.prompt);
                      if (p.label === 'JSON 结构化') setTestType('json');
                      else setTestType('text');
                    }}
                    className="px-2 py-0.5 rounded border border-border-subtle hover:bg-surface-raised text-accent"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="输入测试提示词..."
              className="w-full text-xs rounded-md border border-border-default bg-surface p-2.5 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <Button
            variant="primary"
            className="w-full"
            disabled={testing || !prompt.trim() || !testingModel}
            onClick={runInferenceTest}
          >
            {testing ? <Spinner className="h-3.5 w-3.5 mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
            {testing ? '正在执行推理测试...' : '开始测试推理'}
          </Button>

          {testing && (
            <div className="p-8 text-center text-sm text-muted">
              <Spinner className="h-6 w-6 mx-auto mb-2" />
              正在调用公共 LLM 内核执行推理测试...
            </div>
          )}

          {testResult && !testing && (
            <div className="space-y-3 pt-2">
              <div
                className={`p-3.5 rounded-lg border flex items-start gap-2.5 ${
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
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm">
                    {testResult.success ? '推理测试通过' : '推理测试失败'}
                  </div>
                  {testResult.error && (
                    <div className="text-xs mt-1 break-words">{testResult.error}</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-lg border border-border-subtle bg-surface-raised">
                  <div className="text-muted">生成耗时</div>
                  <div className="text-base font-semibold mt-0.5">{testResult.latencyMs} ms</div>
                </div>
                <div className="p-2.5 rounded-lg border border-border-subtle bg-surface-raised">
                  <div className="text-muted">Token 消耗</div>
                  <div className="text-base font-semibold mt-0.5">
                    {testResult.tokenUsage ? (
                      <span>
                        {testResult.tokenUsage.totalTokens ?? (testResult.tokenUsage.promptTokens ?? 0) + (testResult.tokenUsage.completionTokens ?? 0)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
              </div>

              {testResult.output && (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-ink flex items-center justify-between">
                    <span>模型生成内容：</span>
                    <button
                      type="button"
                      className="text-muted hover:text-ink"
                      onClick={() => {
                        void navigator.clipboard.writeText(testResult.output || '');
                        toast.success('已复制到剪贴板。');
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="p-3 rounded-lg border border-border-subtle bg-surface-raised text-xs leading-relaxed max-h-60 overflow-y-auto whitespace-pre-wrap font-sans text-ink">
                    {testResult.output}
                  </div>
                </div>
              )}

              {testResult.aiCallId && (
                <div className="text-2xs font-mono text-muted flex items-center justify-between border-t border-border-subtle pt-2">
                  <span>审计调用 ID: {testResult.aiCallId}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
