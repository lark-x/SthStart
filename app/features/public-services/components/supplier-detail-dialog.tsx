'use client';

import React, { useState } from 'react';
import { ImageIcon, Pencil, Play, Plus, Power, Trash2 } from 'lucide-react';
import type { ModelProfile } from '@sthstart/contracts';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { EmptyState } from '@/app/components/ui/empty-state';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { RowActionsMenu } from '@/app/components/ui/row-actions-menu';
import {
  modelParameterSummary,
  supplierModelType,
  supplierModelTypeLabel,
  type SupplierGroup,
  type SupplierModelType,
} from './public-services-model-settings';

const TYPE_LABELS: Record<SupplierModelType, string> = {
  chat: '文本 / 看图',
  embedding: '向量计算',
  image: '绘图',
};

function statusLabel(group: SupplierGroup) {
  if (group.enabled) return '启用';
  return group.partiallyDisabled ? '部分停用' : '停用';
}

export function SupplierDetailDialog({
  open,
  onOpenChange,
  group,
  onAddModel,
  onEditSupplier,
  onTestSupplier,
  onToggleSupplier,
  onDeleteSupplier,
  onEditModel,
  onDeleteModel,
  onTestModel,
  onCreateImageWorkflow,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: SupplierGroup;
  onAddModel: (type: SupplierModelType) => void;
  onEditSupplier: () => void;
  onTestSupplier: () => void;
  onToggleSupplier: () => void;
  onDeleteSupplier: () => void;
  onEditModel: (model: ModelProfile) => void;
  onDeleteModel: (model: ModelProfile) => void;
  onTestModel: (model: ModelProfile) => void;
  onCreateImageWorkflow: (model: ModelProfile, operation: 'text-to-image' | 'image-to-image') => void;
}) {
  const firstWithModels = (['chat', 'embedding', 'image'] as const).find(type => group.modelCounts[type] > 0);
  const [activeType, setActiveType] = useState<SupplierModelType>(firstWithModels ?? 'chat');
  const visibleModels = group.models.filter(model => supplierModelType(model) === activeType);
  const modelTabs = (['chat', 'embedding', 'image'] as const).map(type => ({
    id: type,
    label: TYPE_LABELS[type],
    count: group.modelCounts[type],
  }));

  // Keep the selected type, but release the modal portal while editing a child.
  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={group.name}
      description={`${group.kindLabel} · ${statusLabel(group)}`}
      size="lg"
      footer={
        <>
          <Button variant="danger-ghost" onClick={onDeleteSupplier}>
            <Trash2 className="size-4" aria-hidden="true" />
            删除供应商
          </Button>
          <span className="flex-1" />
          <Button variant="outline" onClick={onToggleSupplier}>
            <Power className="size-4" aria-hidden="true" />
            {group.enabled ? '停用供应商' : '启用供应商'}
          </Button>
          <Button variant="outline" onClick={onTestSupplier}>
            <Play className="size-4" aria-hidden="true" />
            测试连接
          </Button>
          <Button variant="primary" onClick={onEditSupplier}>
            <Pencil className="size-4" aria-hidden="true" />
            编辑供应商
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section className="rounded-panel border border-border-subtle bg-surface-sunken p-3" aria-label="供应商连接信息">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted">接口地址</span>
            <code className="min-w-0 break-all text-sm text-ink">{group.baseUrl || '未记录'}</code>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>密钥：{group.hasCredential ? '已配置' : '未配置'}</span>
            <span>状态：{statusLabel(group)}</span>
            {group.connections.length > 1 && <span>已合并 {group.connections.length} 条历史连接</span>}
          </div>
        </section>

        <section aria-labelledby="supplier-models-title" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="supplier-models-title" className="text-sm font-semibold text-ink">模型</h3>
              <p className="mt-1 text-xs text-muted">按用途管理这个供应商下的模型。</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => onAddModel(activeType)}>
              <Plus className="size-4" aria-hidden="true" />
              添加模型
            </Button>
          </div>

          <PageTabs
            variant="local"
            ariaLabel="供应商模型类型"
            value={activeType}
            onChange={(next) => setActiveType(next as SupplierModelType)}
            tabs={modelTabs}
            className="mt-3"
          />

          {visibleModels.length === 0 ? (
            <EmptyState
              className="mt-3 border-y border-border-subtle"
              title={`还没有${TYPE_LABELS[activeType]}模型`}
              description="可以获取供应商模型目录，也可以手动填写模型 ID。"
              actions={
                <Button size="sm" variant="outline" onClick={() => onAddModel(activeType)}>
                  <Plus className="size-4" aria-hidden="true" />
                  添加模型
                </Button>
              }
            />
          ) : (
            <ul className="mt-3 divide-y divide-border-subtle border-y border-border-subtle">
              {visibleModels.map((model) => (
                <li key={model.id} className="flex min-w-0 items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <strong className="break-words text-sm font-semibold text-ink">{model.name}</strong>
                      <Badge variant="secondary">{supplierModelTypeLabel(model)}</Badge>
                      <Badge variant={model.enabled ? 'online' : 'stopped'}>{model.enabled ? '启用' : '停用'}</Badge>
                    </div>
                    {model.modelId !== model.name && (
                      <code className="mt-1 block break-all font-mono text-xs text-muted">{model.modelId}</code>
                    )}
                    <p className="mt-1 break-words text-xs leading-relaxed text-muted">{modelParameterSummary(model)}</p>
                  </div>
                  <RowActionsMenu
                    label={`模型操作：${model.name}`}
                    items={[
                      model.modelType === 'image' ? {
                        label: '创建文生图方案',
                        icon: <ImageIcon className="size-4" />,
                        onSelect: () => onCreateImageWorkflow(model, 'text-to-image'),
                      } : {
                        label: '测试模型',
                        icon: <Play className="size-4" />,
                        onSelect: () => onTestModel(model),
                      },
                      ...(model.modelType === 'image' ? [{
                        label: '创建参考图方案',
                        icon: <ImageIcon className="size-4" />,
                        onSelect: () => onCreateImageWorkflow(model, 'image-to-image'),
                      }] : []),
                      {
                        label: '编辑模型',
                        icon: <Pencil className="size-4" />,
                        onSelect: () => onEditModel(model),
                      },
                      {
                        label: '删除模型',
                        icon: <Trash2 className="size-4" />,
                        onSelect: () => onDeleteModel(model),
                        tone: 'danger' as const,
                        separatorBefore: true,
                      },
                    ]}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {group.connections.length > 1 && (
          <details className="border-t border-border-subtle pt-3">
            <summary className="cursor-pointer text-sm font-medium text-muted">连接明细（{group.connections.length}）</summary>
            <ul className="mt-2 space-y-2">
              {group.connections.map(connection => (
                <li key={connection.id} className="rounded-control bg-surface-sunken px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{connection.name}</span>
                    <Badge variant={connection.enabled ? 'online' : 'stopped'}>{connection.enabled ? '启用' : '停用'}</Badge>
                  </div>
                  <code className="mt-1 block break-all text-muted">{connection.id} · {connection.kind}</code>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Dialog>
  );
}
