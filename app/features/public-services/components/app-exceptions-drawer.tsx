'use client';

import React, { useState } from 'react';
import { ChevronDown, RotateCcw, Save } from 'lucide-react';
import type { LlmModelCapability, ModelProfile } from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { Drawer } from '@/app/components/ui/drawer';
import { EmptyState } from '@/app/components/ui/empty-state';
import { FormField } from '@/app/components/ui/form-field';
import { Select } from '@/app/components/ui/select';
import { useToast } from '@/app/providers/ui-provider';
import {
  applyPublicModelRoute,
  deleteAppModelRoute,
  saveModelRoute,
} from '../api';
import {
  buildAppRouteSave,
  modelsForCapability,
  type AppExceptionRow,
} from './public-services-model-settings';

const INHERIT = '__inherit__';
const CAPABILITY_LABELS: Record<LlmModelCapability, string> = {
  text: '文本',
  multimodal: '看图',
};

function capabilityRoute(row: AppExceptionRow, capability: LlmModelCapability) {
  return capability === 'text' ? row.textRoute : row.multimodalRoute;
}

function AppRouteEditor({
  row,
  models,
  onRefresh,
}: {
  row: AppExceptionRow;
  models: ModelProfile[];
  onRefresh: () => Promise<void>;
}) {
  const toast = useToast();
  const [choices, setChoices] = useState<Record<LlmModelCapability, string>>({
    text: row.textRoute?.primaryModelId ?? INHERIT,
    multimodal: row.multimodalRoute?.primaryModelId ?? INHERIT,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');

  const original: Record<LlmModelCapability, string> = {
    text: row.textRoute?.primaryModelId ?? INHERIT,
    multimodal: row.multimodalRoute?.primaryModelId ?? INHERIT,
  };
  const changedCapabilities = (['text', 'multimodal'] as const).filter(
    (capability) => choices[capability] !== original[capability],
  );

  const handleChoiceChange = (capability: LlmModelCapability, value: string) => {
    setChoices((previous) => ({ ...previous, [capability]: value }));
    setError('');
    setSavedMessage('');
  };

  const handleSave = async () => {
    if (changedCapabilities.length === 0) return;
    setSaving(true);
    setError('');
    setSavedMessage('');
    const completed: string[] = [];
    let failure: string | null = null;

    for (const capability of changedCapabilities) {
      const choice = choices[capability];
      const label = CAPABILITY_LABELS[capability];
      try {
        if (choice === INHERIT) {
          await deleteAppModelRoute(row.app.id, capability);
        } else {
          await saveModelRoute(buildAppRouteSave(row.app.id, capability, choice));
        }
        completed.push(label);
      } catch (caught) {
        const reason = caught instanceof Error ? caught.message : String(caught);
        failure = `${completed.length > 0 ? `${completed.join('、')}已保存，但` : ''}${label}保存失败：${reason}`;
        break;
      }
    }

    try {
      await onRefresh();
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      failure = failure ?? `路由已保存，但页面刷新失败：${reason}`;
    } finally {
      setSaving(false);
    }

    if (failure) {
      setError(failure);
      toast.error('应用例外未全部保存', failure);
      return;
    }
    setSavedMessage('应用例外已写入服务端。');
    toast.success('应用例外已保存。');
  };

  return (
    <div className="space-y-3 border-t border-border-subtle px-1 pb-4 pt-3">
      {error && <Alert variant="danger" title="保存失败">{error}</Alert>}
      {savedMessage && <Alert variant="success" title="已保存">{savedMessage}</Alert>}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {(['text', 'multimodal'] as const).map((capability) => {
          const options = modelsForCapability(models, capability);
          const selected = choices[capability];
          const selectedIsUsable = options.some((model) => model.id === selected);
          return (
            <FormField
              key={capability}
              label={`${CAPABILITY_LABELS[capability]}模型`}
              hint={capability === 'multimodal' ? '仅列出已标为看图的模型。' : undefined}
            >
              <Select
                value={selected}
                onChange={(event) => handleChoiceChange(capability, event.target.value)}
              >
                <option value={INHERIT}>继承常用模型</option>
                {selected !== INHERIT && !selectedIsUsable && (
                  <option value={selected}>{selected}（当前不可用）</option>
                )}
                {options.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} — {model.modelId}
                  </option>
                ))}
              </Select>
            </FormField>
          );
        })}
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="primary"
          loading={saving}
          disabled={changedCapabilities.length === 0}
          onClick={() => void handleSave()}
        >
          {!saving && <Save className="h-4 w-4" aria-hidden="true" />}
          保存本应用
        </Button>
      </div>
    </div>
  );
}

function AppExceptionRowView({
  row,
  models,
  expanded,
  highlighted,
  onToggle,
  onRefresh,
}: {
  row: AppExceptionRow;
  models: ModelProfile[];
  expanded: boolean;
  highlighted: boolean;
  onToggle: () => void;
  onRefresh: () => Promise<void>;
}) {
  const statusLabel = (capability: LlmModelCapability) => {
    const route = capabilityRoute(row, capability);
    return route ? '自定义' : '继承';
  };

  return (
    <li
      id={`app-exception-${row.app.id}`}
      className={`border-b border-border-subtle ${highlighted ? 'bg-accent/5' : ''}`}
    >
      <button
        type="button"
        className="flex w-full min-w-0 items-start justify-between gap-3 py-3 text-left"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <strong className="truncate text-sm font-semibold text-ink">{row.app.name}</strong>
            <code className="truncate font-mono text-xs text-muted">{row.app.id}</code>
            {!row.app.enabled && <Badge variant="stopped">已停用</Badge>}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {(['text', 'multimodal'] as const).map((capability) => (
              <Badge
                key={capability}
                variant={capabilityRoute(row, capability) ? 'accent' : 'secondary'}
              >
                {CAPABILITY_LABELS[capability]} {statusLabel(capability)}
              </Badge>
            ))}
          </span>
        </span>
        <ChevronDown
          className={`mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <AppRouteEditor
          key={`${row.textRoute?.updatedAt ?? 'none'}:${row.multimodalRoute?.updatedAt ?? 'none'}`}
          row={row}
          models={models}
          onRefresh={onRefresh}
        />
      )}
    </li>
  );
}

export function AppExceptionsDrawer({
  open,
  onOpenChange,
  rows,
  models,
  highlightAppId,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: AppExceptionRow[];
  models: ModelProfile[];
  highlightAppId: string | null;
  onRefresh: () => Promise<void>;
}) {
  const toast = useToast();
  const [expandedAppId, setExpandedAppId] = useState<string | null>(highlightAppId);
  const [applyAllOpen, setApplyAllOpen] = useState(false);
  const [applyAllError, setApplyAllError] = useState('');

  const handleApplyAll = async () => {
    setApplyAllError('');
    const failures: string[] = [];
    for (const capability of ['text', 'multimodal'] as const) {
      try {
        await applyPublicModelRoute(capability);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push(`${CAPABILITY_LABELS[capability]}：${reason}`);
      }
    }

    try {
      await onRefresh();
    } catch (error) {
      failures.push(`刷新：${error instanceof Error ? error.message : String(error)}`);
    }

    if (failures.length > 0) {
      const message = failures.join('；');
      setApplyAllError(message);
      toast.error('未能全部继承', message);
      throw new Error(message);
    }
    toast.success('所有应用已继承常用模型。');
  };

  const customCount = rows.filter((row) => row.custom).length;

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        title="应用模型例外"
        description="可为单个应用指定文本或看图主模型，备用仍沿用常用设置。"
        footer={
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs leading-relaxed text-muted">
              {rows.length} 个应用 · {customCount} 个自定义。应用例外优先于旧分配。
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={rows.length === 0}
              onClick={() => {
                setApplyAllError('');
                setApplyAllOpen(true);
              }}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              全部继承常用模型
            </Button>
          </div>

          {applyAllError && (
            <Alert variant="danger" title="有例外未能继承" onDismiss={() => setApplyAllError('')}>
              {applyAllError}
            </Alert>
          )}

          {rows.length === 0 ? (
            <EmptyState
              title="暂无可配置应用"
              description="应用加载后会显示文本和看图模型的继承状态。"
            />
          ) : (
            <ul className="border-t border-border-subtle">
              {rows.map((row) => (
                <AppExceptionRowView
                  key={row.app.id}
                  row={row}
                  models={models}
                  expanded={expandedAppId === row.app.id}
                  highlighted={highlightAppId === row.app.id}
                  onToggle={() =>
                    setExpandedAppId((current) => (current === row.app.id ? null : row.app.id))
                  }
                  onRefresh={onRefresh}
                />
              ))}
            </ul>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        open={applyAllOpen}
        onOpenChange={setApplyAllOpen}
        title="全部应用继承常用模型"
        description={
          <div className="space-y-2">
            <p>所有应用的文本和看图模型将恢复为常用模型。此操作不能撤销。</p>
            {applyAllError && (
              <Alert variant="danger" title="操作未全部完成">
                {applyAllError}
              </Alert>
            )}
          </div>
        }
        confirmLabel="确认全部继承"
        danger
        onConfirm={handleApplyAll}
      />
    </>
  );
}
