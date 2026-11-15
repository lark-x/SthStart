'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, Route, Save } from 'lucide-react';
import type { ModelProfile, ModelRoute } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { FormField } from '@/app/components/ui/form-field';
import { Select } from '@/app/components/ui/select';
import { useToast } from '@/app/providers/ui-provider';
import { saveModelRoute } from '../api';
import {
  buildPublicRouteSaves,
  commonModelFormFromRoutes,
  commonRouteFormSignature,
  fallbackOptions,
  modelSupportsCapability,
  modelsForCapability,
  textPrimarySupportsVision,
  type CommonModelFormState,
} from './public-services-model-settings';

function fallbackSetter(
  setter: React.Dispatch<React.SetStateAction<[string, string]>>,
  index: 0 | 1,
  onChange: () => void,
  value: string,
) {
  onChange();
  setter((previous) => {
    const next: [string, string] = [previous[0], previous[1]];
    next[index] = value;
    return next;
  });
}

type Feedback =
  | { tone: 'success'; message: string }
  | { tone: 'error'; message: string }
  | null;

export function CommonModelsCard({
  routes,
  models,
  onRefresh,
}: {
  routes: ModelRoute[];
  models: ModelProfile[];
  onRefresh: () => Promise<void>;
}) {
  const toast = useToast();
  const initial = commonModelFormFromRoutes(routes);
  const [textPrimaryId, setTextPrimaryId] = useState(initial.textPrimaryId);
  const [textFallbackIds, setTextFallbackIds] = useState<[string, string]>(initial.textFallbackIds);
  const [visionPrimaryId, setVisionPrimaryId] = useState(initial.visionPrimaryId);
  const [visionFallbackIds, setVisionFallbackIds] = useState<[string, string]>(initial.visionFallbackIds);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const routeSignatureRef = useRef(commonRouteFormSignature(routes));

  const resetFeedback = useCallback(() => setFeedback(null), []);

  useEffect(() => {
    const signature = commonRouteFormSignature(routes);
    if (signature === routeSignatureRef.current) return;
    routeSignatureRef.current = signature;
    const next = commonModelFormFromRoutes(routes);
    // 服务端路由更新后同步表单；本地输入不会被无关的 overview 刷新重置。
    setTextPrimaryId(next.textPrimaryId);
    setTextFallbackIds(next.textFallbackIds);
    setVisionPrimaryId(next.visionPrimaryId);
    setVisionFallbackIds(next.visionFallbackIds);
  }, [routes]);

  const formState: CommonModelFormState = {
    textPrimaryId,
    textFallbackIds,
    visionPrimaryId,
    visionFallbackIds,
  };
  const visionFollowsText = textPrimarySupportsVision(models, textPrimaryId);
  const showVisionRow = !visionFollowsText;
  const textModels = modelsForCapability(models, 'text');
  const multimodalModels = modelsForCapability(models, 'multimodal');
  const visionSelectedModel = models.find((model) => model.id === visionPrimaryId);
  const visionSupportIssue =
    Boolean(visionPrimaryId) && !modelSupportsCapability(visionSelectedModel, 'multimodal');

  const handleSave = async () => {
    const planned = buildPublicRouteSaves(formState, models);
    if (planned.error) {
      setFeedback({ tone: 'error', message: planned.error });
      return;
    }

    setSaving(true);
    setFeedback(null);
    const savedCapabilities: string[] = [];
    let failure: string | null = null;

    for (const route of planned.routes) {
      try {
        await saveModelRoute(route);
        savedCapabilities.push(route.capability === 'text' ? '文本' : '看图');
      } catch (error) {
        const label = route.capability === 'text' ? '文本' : '看图';
        const reason = error instanceof Error ? error.message : String(error);
        failure = `${savedCapabilities.length > 0 ? `${savedCapabilities.join('、')}已保存，但` : ''}${label}保存失败：${reason}`;
        break;
      }
    }

    try {
      await onRefresh();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failure = failure ?? `路由已保存，但页面刷新失败：${reason}`;
    } finally {
      setSaving(false);
    }

    if (failure) {
      setFeedback({ tone: 'error', message: failure });
      toast.error('常用模型未全部保存', failure);
      return;
    }

    const message = planned.visionMirrorsText
      ? '文本与看图已保存。看图沿用文本主模型，只保留能看图的备用。'
      : '文本与看图常用模型已保存。';
    setFeedback({ tone: 'success', message });
    toast.success('常用模型已保存。');
  };

  return (
    <section className="tpl-panel space-y-4 p-4" aria-labelledby="common-models-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="common-models-title" className="flex items-center gap-2 text-base font-semibold text-ink">
            <Route className="h-4 w-4 text-accent" aria-hidden="true" />
            常用模型
          </h2>
          <p className="mt-1 text-sm text-muted">
            应用默认继承常用模型；备用最多两个，按顺序尝试。
          </p>
        </div>
        <Button variant="primary" size="sm" loading={saving} onClick={() => void handleSave()}>
          {!saving && <Save className="h-4 w-4" aria-hidden="true" />}
          保存常用模型
        </Button>
      </div>

      {feedback && (
        <Alert
          variant={feedback.tone === 'success' ? 'success' : 'danger'}
          title={feedback.tone === 'success' ? '已写入服务端' : '保存未完成'}
          onDismiss={() => setFeedback(null)}
        >
          {feedback.message}
        </Alert>
      )}

      {models.length === 0 ? (
        <div className="border-y border-border-subtle py-6 text-sm text-muted">
          还没有可用模型。先从供应商添加模型，再设置常用模型。
        </div>
      ) : (
        <div className={`grid min-w-0 gap-4 ${showVisionRow ? 'lg:grid-cols-2' : ''}`}>
          <div className="min-w-0 space-y-3 rounded-panel bg-surface-sunken/45 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">文本主模型</h3>
              {textPrimaryId && (
                <span className="text-xs text-muted">
                  {visionFollowsText ? '同时支持看图' : '仅文本'}
                </span>
              )}
            </div>
            <FormField label="主模型">
              <Select
                value={textPrimaryId}
                onChange={(event) => {
                  resetFeedback();
                  const nextPrimary = event.target.value;
                  setTextPrimaryId(nextPrimary);
                  setTextFallbackIds((previous) => [
                    previous[0] === nextPrimary ? '' : previous[0],
                    previous[1] === nextPrimary ? '' : previous[1],
                  ]);
                }}
              >
                <option value="">尚未设置</option>
                {textModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} — {model.modelId}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              {([0, 1] as const).map((index) => (
                <FormField key={index} label={`备用 ${index + 1}`}>
                  <Select
                    value={textFallbackIds[index]}
                    disabled={!textPrimaryId}
                    onChange={(event) =>
                      fallbackSetter(
                        setTextFallbackIds,
                        index,
                        resetFeedback,
                        event.target.value,
                      )
                    }
                  >
                    <option value="">无备用</option>
                    {fallbackOptions(
                      models,
                      'text',
                      [textPrimaryId, textFallbackIds[index === 0 ? 1 : 0]],
                    ).map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name} — {model.modelId}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ))}
            </div>
          </div>

          {showVisionRow && (
            <div className="min-w-0 space-y-3 rounded-panel bg-surface-sunken/45 p-3.5">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <Eye className="h-4 w-4 text-muted" aria-hidden="true" />
                看图模型
              </h3>
              <FormField label="看图主模型">
                <Select
                  value={visionPrimaryId}
                  error={visionSupportIssue ? '该模型不具备看图能力' : undefined}
                  onChange={(event) => {
                    resetFeedback();
                    const nextPrimary = event.target.value;
                    setVisionPrimaryId(nextPrimary);
                    setVisionFallbackIds((previous) => [
                      previous[0] === nextPrimary ? '' : previous[0],
                      previous[1] === nextPrimary ? '' : previous[1],
                    ]);
                  }}
                >
                  <option value="">尚未设置</option>
                  {multimodalModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} — {model.modelId}
                    </option>
                  ))}
                </Select>
              </FormField>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                {([0, 1] as const).map((index) => (
                  <FormField key={index} label={`备用 ${index + 1}`}>
                    <Select
                      value={visionFallbackIds[index]}
                      disabled={!visionPrimaryId}
                      onChange={(event) =>
                        fallbackSetter(
                          setVisionFallbackIds,
                          index,
                          resetFeedback,
                          event.target.value,
                        )
                      }
                    >
                      <option value="">无备用</option>
                      {fallbackOptions(
                        models,
                        'multimodal',
                        [visionPrimaryId, visionFallbackIds[index === 0 ? 1 : 0]],
                      ).map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name} — {model.modelId}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                ))}
              </div>
              {multimodalModels.length === 0 && (
                <p className="text-xs leading-relaxed text-warning-fg">
                  暂无看图模型。请在可看图的模型中勾选「看图（多模态）」。
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {visionFollowsText && models.length > 0 && (
        <p className="text-xs leading-relaxed text-muted">
          保存后，看图沿用文本主模型，只保留能看图的备用。
        </p>
      )}
    </section>
  );
}
