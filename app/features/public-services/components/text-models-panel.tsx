'use client';

import React, { useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Pencil,
  Play,
  Plus,
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
import { Dialog } from '@/app/components/ui/dialog';
import { Drawer } from '@/app/components/ui/drawer';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { Checkbox } from '@/app/components/ui/checkbox';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { FormField } from '@/app/components/ui/form-field';
import { Spinner } from '@/app/components/ui/spinner';
import { RowActionsMenu } from '@/app/components/ui/row-actions-menu';
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
  const [deleteTarget, setDeleteTarget] = useState<ModelProfile | null>(null);

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
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-70">
          <div className="relative flex-1 min-w-45">
            <Input
              leftIcon={<Search className="h-4 w-4 text-muted" />}
              placeholder="搜索模型名称、ID 或实际模型名称..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            aria-label="按关联连接筛选"
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
          <Button variant="primary" size="sm" onClick={handleOpenCreate}>
            <Plus className="h-4 w-4" />
            新建模型配置
          </Button>
        </div>
      </div>

      {/* 模型列表 */}
      {filtered.length === 0 ? (
        <div className="border-y border-border-subtle py-10 text-center text-muted">
          <p className="text-sm">暂无匹配的模型配置。点击上方“新建模型配置”添加一个。</p>
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle border-y border-border-subtle">
          {filtered.map((m) => {
            const conn = connectionMap.get(m.connectionId);
            return (
              <li key={m.id} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-base font-semibold text-ink">{m.name}</h3>
                      <p className="mt-0.5 truncate font-mono text-xs text-muted">
                        ID: {m.id}
                      </p>
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
                  <div className="flex items-center justify-between gap-3 font-mono text-xs">
                    <span className="truncate font-medium text-ink">{m.modelId}</span>
                    <span className="text-muted shrink-0 ml-2">
                      连接：{conn ? conn.name : m.connectionId}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    {m.capabilities.map((cap) => (
                      <span key={cap} className="font-mono">{cap}</span>
                    ))}
                    {m.contextLength && (
                      <span className="font-mono">
                        {Math.round(m.contextLength / 1000)}k 窗口
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 md:justify-end">
                  <Button variant="ghost" size="sm" onClick={() => handleOpenTestDrawer(m)}>
                    <Sparkles className="h-3.5 w-3.5" />推理测试
                  </Button>
                  <RowActionsMenu
                    label={`更多模型操作：${m.name}`}
                    items={[
                      { label: '编辑配置', icon: <Pencil className="h-3.5 w-3.5 text-muted" />, onSelect: () => handleOpenEdit(m) },
                      { label: '删除配置', icon: <Trash2 className="h-3.5 w-3.5" />, onSelect: () => setDeleteTarget(m), tone: 'danger', separatorBefore: true },
                    ]}
                  />
                </div>
              </li>
            );
          })}
        </ul>
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
          <FormField label="模型配置内部 ID" required>
            <Input
              value={formData.id}
              onChange={(e) => setFormData({ ...formData, id: e.target.value })}
              required
              disabled={Boolean(editingModel)}
              placeholder="e.g. gpt-4o-mini-text"
            />
          </FormField>
          <FormField label="所属服务连接" required>
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
          </FormField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="显示名称" required>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="GPT-4o Mini 主力"
              />
            </FormField>
            <FormField label="实际模型标识 (modelId)" required>
              <Input
                value={formData.modelId}
                onChange={(e) => setFormData({ ...formData, modelId: e.target.value })}
                required
                placeholder="gpt-4o-mini"
              />
            </FormField>
          </div>

          <div>
            <div className="text-xs font-semibold text-ink mb-1.5">能力标签</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ALL_CAPABILITIES.map((cap) => (
                <div key={cap.id} className="rounded border border-border-subtle bg-surface-raised p-2">
                  <Checkbox
                    label={cap.label}
                    checked={formData.capabilities.includes(cap.id)}
                    onChange={() => handleToggleCapability(cap.id)}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="上下文窗口长度">
              <Input
                type="number"
                value={formData.contextLength}
                onChange={(e) => setFormData({ ...formData, contextLength: e.target.value === '' ? '' : Number(e.target.value) })}
                placeholder="128000"
              />
            </FormField>
            <FormField label="最大输出 Token">
              <Input
                type="number"
                value={formData.maxOutputTokens}
                onChange={(e) => setFormData({ ...formData, maxOutputTokens: e.target.value === '' ? '' : Number(e.target.value) })}
                placeholder="4096"
              />
            </FormField>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              label="启用该模型配置"
              checked={formData.enabled}
              onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" loading={formSaving}>
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
              <Button
                type="button"
                size="sm"
                variant={testType === 'text' ? 'outline' : 'ghost'}
                aria-pressed={testType === 'text'}
                onClick={() => handleSelectTestType('text')}
              >
                通用文本连通性
              </Button>
              <Button
                type="button"
                size="sm"
                variant={testType === 'json' ? 'outline' : 'ghost'}
                aria-pressed={testType === 'json'}
                onClick={() => handleSelectTestType('json')}
              >
                JSON 结构校验
              </Button>
              <Button
                type="button"
                size="sm"
                variant={testType === 'vision' ? 'outline' : 'ghost'}
                aria-pressed={testType === 'vision'}
                onClick={() => handleSelectTestType('vision')}
              >
                多模态视觉测试
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>快捷测试预设：</span>
              <div className="flex items-center gap-1.5">
                {PRESET_PROMPTS.map((p) => (
                  <Button
                    key={p.label}
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-auto px-1.5 py-0.5 text-xs"
                    onClick={() => {
                      setPrompt(p.prompt);
                      if (p.label === 'JSON 结构化') setTestType('json');
                      else setTestType('text');
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="输入测试提示词..."
              className="text-xs"
            />
          </div>

          <Button
            variant="primary"
            className="w-full"
            loading={testing}
            disabled={!prompt.trim() || !testingModel}
            onClick={runInferenceTest}
          >
            {!testing && <Play className="h-3.5 w-3.5 mr-1.5" />}
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
                    ? 'border-success-border bg-success-bg text-success-fg'
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
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="复制模型输出"
                      onClick={() => {
                        void navigator.clipboard.writeText(testResult.output || '');
                        toast.success('已复制到剪贴板。');
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
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

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={deleteTarget ? `删除模型配置“${deleteTarget.name}”` : '删除模型配置'}
        description="依赖这个模型的用途绑定和应用选择会失效。此操作不能撤销。"
        confirmLabel="删除配置"
        danger
        onConfirm={async () => {
          if (deleteTarget) await handleDeleteModel(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
