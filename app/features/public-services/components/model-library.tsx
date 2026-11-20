'use client';

import React, { useState } from 'react';
import { Boxes, Pencil, Play, Plus, Power, Search, Trash2 } from 'lucide-react';
import type { ModelProfile, ServiceConnection } from '@sthstart/contracts';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { ConfirmDialog } from '@/app/components/ui/confirm-dialog';
import { EmptyState } from '@/app/components/ui/empty-state';
import { Input } from '@/app/components/ui/input';
import { RowActionsMenu } from '@/app/components/ui/row-actions-menu';
import { useToast } from '@/app/providers/ui-provider';
import {
  createImageModelWorkflow,
  deleteConnection,
  deleteModelProfile,
  saveConnection,
  testConnectionProbe,
  testModelInference,
} from '../api';
import { ModelProfileEditorDialog } from './model-profile-editor-dialog';
import {
  groupModelsBySupplier,
  type SupplierGroup,
  type SupplierModelType,
} from './public-services-model-settings';
import { SupplierDetailDialog } from './supplier-detail-dialog';
import { SupplierEditor } from './supplier-editor';
import { SupplierModelPicker } from './supplier-model-picker';

const TYPE_SHORT_LABELS: Record<SupplierModelType, string> = {
  chat: '文本/看图',
  embedding: '向量',
  image: '绘图',
};

export function ModelLibrary({
  models,
  connections,
  onRefresh,
}: {
  models: ModelProfile[];
  connections: ServiceConnection[];
  onRefresh: () => Promise<void>;
}) {
  const toast = useToast();
  const groups = groupModelsBySupplier(models, connections);
  const [query, setQuery] = useState('');
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [supplierEditor, setSupplierEditor] = useState<{ group: SupplierGroup | null } | null>(null);
  const [picker, setPicker] = useState<{ group: SupplierGroup; type: SupplierModelType } | null>(null);
  const [deleteSupplier, setDeleteSupplier] = useState<SupplierGroup | null>(null);
  const [supplierDeleteError, setSupplierDeleteError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<ModelProfile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModelProfile | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const detailGroup = groups.find(group => group.key === detailKey) ?? null;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = normalizedQuery
    ? groups.filter(group => group.name.toLowerCase().includes(normalizedQuery)
      || group.baseUrl.toLowerCase().includes(normalizedQuery)
      || group.models.some(model => model.name.toLowerCase().includes(normalizedQuery) || model.modelId.toLowerCase().includes(normalizedQuery)))
    : groups;

  const perform = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    try { await action(); }
    catch (error) { toast.error('操作未完成', error instanceof Error ? error.message : String(error)); }
    finally { setBusyId(null); }
  };

  const testModel = (model: ModelProfile) => void perform(model.id, async () => {
    const result = await testModelInference(model.id);
    if (result.success) toast.success(result.output ?? '模型测试成功');
    else toast.warning('模型测试未通过', result.error ?? undefined);
    await onRefresh();
  });

  const createWorkflow = (model: ModelProfile, operation: 'text-to-image' | 'image-to-image') => void perform(model.id, async () => {
    await createImageModelWorkflow(model.id, operation);
    toast.success(operation === 'text-to-image' ? '文生图方案已创建，可在“生成方案”中选择使用。' : '参考图方案已创建，可在“生成方案”中选择使用。');
  });

  const handleDeleteModel = async () => {
    if (!deleteTarget) return;
    try {
      await deleteModelProfile(deleteTarget.id);
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      setDeleteError(reason);
      toast.error('删除失败', reason);
      throw caught;
    }
    toast.success('模型配置已删除。');
    try { await onRefresh(); }
    catch (caught) { toast.warning('模型已删除，但页面刷新失败', caught instanceof Error ? caught.message : undefined); }
    setDeleteTarget(null);
  };

  const toggleSupplier = async (group: SupplierGroup) => {
    const nextEnabled = !group.enabled;
    const failures: string[] = [];
    for (const connection of group.connections) {
      try { await saveConnection({ ...connection, enabled: nextEnabled }); }
      catch (error) { failures.push(`${connection.name}：${error instanceof Error ? error.message : '保存失败'}`); }
    }
    try { await onRefresh(); }
    catch (error) { toast.warning('供应商状态已尝试更新，但列表刷新失败', error instanceof Error ? error.message : undefined); }
    if (failures.length) toast.error('供应商状态未全部更新', failures.join('；'));
    else toast.success(nextEnabled ? '供应商已启用。' : '供应商已停用。');
  };

  const deleteSupplierGroup = async () => {
    if (!deleteSupplier) return;
    if (deleteSupplier.models.length > 0) {
      const message = `该供应商下仍有 ${deleteSupplier.models.length} 个模型，请先删除模型，再删除供应商。`;
      setSupplierDeleteError(message);
      toast.error('无法删除供应商', message);
      throw new Error(message);
    }
    const failures: string[] = [];
    for (const connection of deleteSupplier.connections) {
      try { await deleteConnection(connection.id); }
      catch (error) { failures.push(`${connection.name}：${error instanceof Error ? error.message : '删除失败'}`); }
    }
    if (failures.length) {
      setSupplierDeleteError(failures.join('；'));
      toast.error('供应商未全部删除', failures.join('；'));
      throw new Error(failures.join('；'));
    }
    setDeleteSupplier(null);
    setDetailKey(null);
    try { await onRefresh(); }
    catch (error) { toast.warning('供应商已删除，但列表刷新失败', error instanceof Error ? error.message : undefined); }
    toast.success('供应商已删除。');
  };

  return (
    <>
      <section className="tpl-panel min-w-0 p-4" aria-labelledby="model-library-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="model-library-title" className="flex items-center gap-2 text-base font-semibold text-ink">
              <Boxes className="h-4 w-4 text-muted" aria-hidden="true" />
              供应商与模型
            </h2>
            <p className="mt-1 text-sm text-muted">{groups.length} 个供应商 · {models.length} 个模型。每个供应商集中管理全部用途。</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setSupplierEditor({ group: null })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            添加供应商
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input
              type="search"
              aria-label="搜索供应商或模型"
              placeholder="搜索供应商或模型"
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="pl-9"
            />
          </div>
          {normalizedQuery && <span className="text-xs text-muted">{visibleGroups.length} 个结果</span>}
        </div>

        {groups.length === 0 ? (
          <EmptyState
            className="mt-4 border-y border-border-subtle"
            icon={Boxes}
            title="还没有供应商"
            description="先连接供应商，再获取或手动添加模型。"
            actions={<Button variant="outline" size="sm" onClick={() => setSupplierEditor({ group: null })}>添加第一个供应商</Button>}
          />
        ) : visibleGroups.length === 0 ? (
          <EmptyState className="mt-4 border-y border-border-subtle" icon={Search} title="没有匹配的供应商" description="换一个名称、地址或模型 ID 试试。" />
        ) : (
          <ul className="mt-4 space-y-2">
            {visibleGroups.map(group => {
              const primary = group.primary;
              const connectionIds = group.connections.map(connection => connection.id);
              return (
                <li key={group.key}>
                  <article
                    role="article"
                    className="tpl-panel min-w-0 p-3 transition-colors hover:bg-surface-hover sm:p-4"
                    data-supplier-id={primary?.id ?? group.key}
                    data-supplier-key={group.key}
                    data-supplier-connections={connectionIds.join(',')}
                  >
                    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDetailKey(group.key)} aria-label={`管理供应商 ${group.name}`}>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h3 className="break-words text-sm font-semibold text-ink">{group.name}</h3>
                          <Badge variant="secondary">{group.kindLabel}</Badge>
                          <Badge variant={group.enabled ? 'online' : 'stopped'}>{group.enabled ? '启用' : group.partiallyDisabled ? '部分停用' : '停用'}</Badge>
                          {group.connections.length > 1 && <span className="text-xs text-muted">{group.connections.length} 条连接</span>}
                        </div>
                        <p className="mt-1 break-all text-xs text-muted">{group.baseUrl} · {group.hasCredential ? '密钥已配置' : '未保存密钥'}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {(['chat', 'embedding', 'image'] as const).map(type => (
                            <span key={type} className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-sunken px-2 py-0.5 text-xs text-muted">
                              {TYPE_SHORT_LABELS[type]}
                              <strong className="font-semibold text-ink">{group.modelCounts[type]}</strong>
                            </span>
                          ))}
                          <span className="text-xs text-muted sm:hidden">{group.models.length} 个模型</span>
                          <span className="hidden flex-wrap items-center gap-1.5 sm:flex">
                            {group.models.map(model => (
                              <Badge key={model.id} variant="outline">{model.name}</Badge>
                            ))}
                          </span>
                        </div>
                      </button>
                      <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:shrink-0">
                        <Button size="sm" variant="outline" className="flex-1 sm:flex-none" aria-label={`添加模型 · ${group.name}`} onClick={() => setPicker({ group, type: (['chat', 'embedding', 'image'] as const).find(type => group.modelCounts[type] > 0) ?? 'chat' })}>
                          <Plus className="size-4" aria-hidden="true" />
                          添加模型
                        </Button>
                        <Button size="sm" variant="ghost" className="flex-1 sm:flex-none" onClick={() => setDetailKey(group.key)} aria-label={`打开供应商 ${group.name}`}>
                          详情
                        </Button>
                        <RowActionsMenu
                          label={`供应商操作：${group.name}`}
                          items={[
                            { label: '编辑供应商', icon: <Pencil className="size-4" />, onSelect: () => setSupplierEditor({ group }) },
                            { label: '测试连接', icon: <Play className="size-4" />, onSelect: () => primary && void perform(primary.id, async () => {
                              const result = await testConnectionProbe({ connectionId: primary.id });
                              if (result.success) toast.success('连接正常');
                              else toast.warning('连接未通过', result.message ?? undefined);
                            }) },
                            { label: group.enabled ? '停用供应商' : '启用供应商', icon: <Power className="size-4" />, onSelect: () => void toggleSupplier(group) },
                            { label: '删除供应商', icon: <Trash2 className="size-4" />, tone: 'danger', separatorBefore: true, onSelect: () => { setSupplierDeleteError(''); setDeleteSupplier(group); } },
                          ]}
                        />
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
        {busyId && <p role="status" className="mt-3 text-sm text-muted">正在处理，请稍候…</p>}
      </section>

      {supplierEditor && <SupplierEditor
        key={`supplier-editor:${supplierEditor.group?.key ?? 'new'}`}
        connection={supplierEditor.group?.primary ?? null}
        groupConnections={supplierEditor.group?.connections}
        connections={connections}
        onClose={() => setSupplierEditor(null)}
        onSaved={onRefresh}
      />}
      {picker && <SupplierModelPicker
        key={`supplier-picker:${picker.group.key}:${picker.type}`}
        connections={picker.group.connections}
        supplierName={picker.group.name}
        initialType={picker.type}
        models={models}
        onClose={() => setPicker(null)}
        onSaved={onRefresh}
      />}
      {detailGroup && <SupplierDetailDialog
        key={`supplier-detail:${detailGroup.key}`}
        open={!supplierEditor && !picker && !editTarget && !deleteTarget && !deleteSupplier}
        onOpenChange={open => { if (!open) setDetailKey(null); }}
        group={detailGroup}
        onAddModel={type => setPicker({ group: detailGroup, type })}
        onEditSupplier={() => setSupplierEditor({ group: detailGroup })}
        onTestSupplier={() => detailGroup.primary && void perform(detailGroup.primary.id, async () => {
          const result = await testConnectionProbe({ connectionId: detailGroup.primary!.id });
          if (result.success) toast.success('连接正常');
          else toast.warning('连接未通过', result.message ?? undefined);
        })}
        onToggleSupplier={() => void toggleSupplier(detailGroup)}
        onDeleteSupplier={() => { setSupplierDeleteError(''); setDeleteSupplier(detailGroup); }}
        onEditModel={setEditTarget}
        onDeleteModel={model => { setDeleteError(''); setDeleteTarget(model); }}
        onTestModel={testModel}
        onCreateImageWorkflow={createWorkflow}
      />}

      <ConfirmDialog
        open={Boolean(deleteSupplier)}
        onOpenChange={open => { if (!open) setDeleteSupplier(null); }}
        title={`删除供应商“${deleteSupplier?.name ?? ''}”`}
        description={<div className="space-y-2">
          <p>将删除该供应商及其 {deleteSupplier?.connections.length ?? 0} 条连接。请先移除模型及绘图方案引用。</p>
          {supplierDeleteError && <p className="text-danger-fg">{supplierDeleteError}</p>}
        </div>}
        confirmLabel="删除供应商"
        danger
        onConfirm={deleteSupplierGroup}
      />

      {editTarget && <ModelProfileEditorDialog
        key={editTarget.id}
        open
        onOpenChange={next => { if (!next) setEditTarget(null); }}
        model={editTarget}
        connectionName={connections.find(connection => connection.id === editTarget.connectionId)?.name ?? editTarget.connectionId}
        onSaved={onRefresh}
      />}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={next => { if (!next) { setDeleteTarget(null); setDeleteError(''); } }}
        title={deleteTarget ? `删除模型“${deleteTarget.name}”` : '删除模型'}
        description={<div className="space-y-2">
          <p>正在被常用模型路由或应用例外使用的模型不能删除。此操作不能撤销。</p>
          {deleteError && <p className="text-danger-fg">{deleteError}</p>}
        </div>}
        confirmLabel="删除模型"
        danger
        onConfirm={handleDeleteModel}
      />
    </>
  );
}
