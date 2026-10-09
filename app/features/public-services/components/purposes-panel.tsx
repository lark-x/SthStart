'use client';

import React, { useState } from 'react';
import {
  Check,
  Layers,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  ModelProfile,
  PublicServiceOverview,
  PurposeBinding,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { useToast } from '@/app/providers/ui-provider';
import {
  deletePurposeBinding,
  savePurposeBinding,
  updateLlmAssignments,
} from '../api';
import type { Engine } from '@/app/features/generation/types';

export function PurposesPanel({
  overview,
  models,
  engines,
  purposeBindings,
  onRefresh,
}: {
  overview: PublicServiceOverview | null;
  models: ModelProfile[];
  engines: Engine[];
  purposeBindings: PurposeBinding[];
  onRefresh: () => Promise<void>;
}) {
  const toast = useToast();
  const [savingAppId, setSavingAppId] = useState<string | null>(null);

  // 新增特定用途绑定对话框
  const [bindingOpen, setBindingOpen] = useState(false);
  const [bindingAppId, setBindingAppId] = useState('');
  const [bindingPurpose, setBindingPurpose] = useState('');
  const [bindingTargetId, setBindingTargetId] = useState('');
  const [bindingSaving, setBindingSaving] = useState(false);

  // 临时状态（记录每个应用选择的模型）
  const [appSelections, setAppSelections] = useState<Record<string, { textProfileId: string | null; multimodalProfileId: string | null }>>({});

  const apps = overview?.apps ?? [];
  const textModels = models.filter((m) => m.capabilities.includes('text') && m.enabled);
  const visionModels = models.filter((m) => (m.capabilities.includes('multimodal') || m.capabilities.includes('text')) && m.enabled);

  const getEffectiveSelection = (appId: string) => {
    if (appSelections[appId]) return appSelections[appId];
    const existing = overview?.llmAssignments.find((a) => a.appId === appId);
    return {
      textProfileId: existing?.textProfileId ?? null,
      multimodalProfileId: existing?.multimodalProfileId ?? null,
    };
  };

  const handleModelChange = (appId: string, field: 'textProfileId' | 'multimodalProfileId', value: string) => {
    const current = getEffectiveSelection(appId);
    setAppSelections((prev) => ({
      ...prev,
      [appId]: {
        ...current,
        [field]: value === '' ? null : value,
      },
    }));
  };

  const handleSaveAppAssignment = async (appId: string) => {
    const sel = getEffectiveSelection(appId);
    setSavingAppId(appId);
    try {
      await updateLlmAssignments(appId, sel);
      toast.success('应用模型绑定已保存。');
      await onRefresh();
    } catch (err) {
      toast.error('保存失败', err instanceof Error ? err.message : String(err));
    } finally {
      setSavingAppId(null);
    }
  };

  const handleCreatePurposeBinding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bindingAppId || !bindingPurpose.trim() || !bindingTargetId) return;
    setBindingSaving(true);
    try {
      await savePurposeBinding(bindingAppId, bindingPurpose.trim(), {
        targetType: 'model',
        targetId: bindingTargetId,
      });
      toast.success('用途覆盖已生效。');
      setBindingOpen(false);
      setBindingPurpose('');
      await onRefresh();
    } catch (err) {
      toast.error('添加失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBindingSaving(false);
    }
  };

  const handleDeletePurposeBinding = async (b: PurposeBinding) => {
    if (!window.confirm(`确认删除应用 ${b.appId} 在用途 ${b.purposeKey} 上的覆盖绑定？`)) {
      return;
    }
    try {
      await deletePurposeBinding(b.appId, b.purposeKey);
      toast.success('用途绑定已清除。');
      await onRefresh();
    } catch (err) {
      toast.error('删除失败', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-4">
      {/* 提示条 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          为各个业务应用指定默认的文本推理模型与视觉多模态模型；支持针对特定用途配置粒度覆盖。
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void onRefresh()}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setBindingAppId(apps[0]?.id ?? '');
              setBindingTargetId(models[0]?.id ?? '');
              setBindingOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            添加用途细粒度覆盖
          </Button>
        </div>
      </div>

      {/* 应用绑定卡片列表 */}
      <div className="space-y-4">
        {apps.map((app) => {
          const selection = getEffectiveSelection(app.id);
          const isSaving = savingAppId === app.id;
          const appPurposes = purposeBindings.filter((b) => b.appId === app.id);

          return (
            <Card key={app.id} className="overflow-hidden">
              <CardHeader className="pb-3 border-b border-border-subtle bg-surface-raised/40">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <span>{app.name}</span>
                      <span className="text-xs font-mono text-muted">({app.id})</span>
                    </CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      可用能力：{app.capabilities.join(', ')}
                    </CardDescription>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={isSaving}
                    onClick={() => handleSaveAppAssignment(app.id)}
                  >
                    {isSaving ? <Spinner className="h-3.5 w-3.5 mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                    保存绑定
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-ink mb-1.5">
                      默认文本推理模型 (Primary Text Model)
                    </label>
                    <Select
                      value={selection.textProfileId ?? ''}
                      onChange={(e) => handleModelChange(app.id, 'textProfileId', e.target.value)}
                    >
                      <option value="">未指定（使用系统默认）</option>
                      {textModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.modelId})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-ink mb-1.5">
                      多模态与视觉模型 (Vision / Multimodal)
                    </label>
                    <Select
                      value={selection.multimodalProfileId ?? ''}
                      onChange={(e) => handleModelChange(app.id, 'multimodalProfileId', e.target.value)}
                    >
                      <option value="">跟随文本模型或未指定</option>
                      {visionModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.modelId})
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                {/* 特定用途覆盖列表 */}
                {appPurposes.length > 0 && (
                  <div className="pt-2 border-t border-border-subtle">
                    <div className="text-xs font-semibold text-ink mb-2">特定用途细化覆盖：</div>
                    <div className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-surface-raised/30">
                      {appPurposes.map((p) => {
                        const targetModel = models.find((m) => m.id === p.targetId);
                        return (
                          <div
                            key={p.id}
                            className="flex items-center justify-between p-2.5 text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">{p.purposeKey}</Badge>
                              <span className="text-muted">&rarr;</span>
                              <span className="font-mono text-ink font-medium">
                                {targetModel ? targetModel.name : p.targetId}
                              </span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-danger"
                              onClick={() => handleDeletePurposeBinding(p)}
                              aria-label="删除覆盖"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 新增特定用途细粒度覆盖对话框 */}
      <Dialog
        open={bindingOpen}
        onOpenChange={setBindingOpen}
        title="添加特定用途细粒度覆盖"
        className="max-w-md"
      >
        <form onSubmit={handleCreatePurposeBinding} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">目标应用</label>
            <Select
              value={bindingAppId}
              onChange={(e) => setBindingAppId(e.target.value)}
              required
            >
              {apps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name} ({app.id})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">用途标识 (purposeKey)</label>
            <Input
              value={bindingPurpose}
              onChange={(e) => setBindingPurpose(e.target.value)}
              placeholder="e.g. story:dsh / activities:chat / research:synthesize"
              required
            />
            <p className="text-2xs text-muted mt-1">业务模块在调用公共 AI 内核时指定的特定用途名称。</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink mb-1">绑定模型</label>
            <Select
              value={bindingTargetId}
              onChange={(e) => setBindingTargetId(e.target.value)}
              required
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.modelId})
                </option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setBindingOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" disabled={bindingSaving}>
              {bindingSaving && <Spinner className="h-3.5 w-3.5 mr-1" />}
              确认绑定
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
