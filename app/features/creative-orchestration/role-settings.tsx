'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import type { CreativeRole, ProviderProfile } from '@sthstart/contracts';
import { usePublicOverview } from '@/app/features/public-services/queries';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Dialog } from '@/app/components/ui/dialog';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { Badge } from '@/app/components/ui/badge';
import { Alert } from '@/app/components/ui/alert';
import { creativeApi } from './api';
import { creativeKeys, useCreativeRoles } from './queries';

export function RoleSettings() {
  const roles = useCreativeRoles();
  const overview = usePublicOverview();
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          为每个创作岗位选择模型。任务开始后固定岗位与模型配置；后续修改用于新任务。视觉审核需要具备看图能力的模型。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            添加专业岗位
          </Button>
          <Link href="/settings/public-services" className="text-sm text-accent underline">
            管理供应商与模型
          </Link>
        </div>
      </div>
      {(roles.error || overview.error) && (
        <Alert variant="danger">
          {roles.error?.message || overview.error?.message}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void roles.refetch();
              void overview.refetch();
            }}
          >
            重新读取
          </Button>
        </Alert>
      )}
      {roles.isPending && (
        <p role="status" className="text-muted">
          正在读取岗位…
        </p>
      )}
      <div className="divide-y divide-border-subtle">
        {roles.data?.items.map((role) => (
          <RoleForm key={role.id} role={role} models={overview.data?.profiles ?? []} />
        ))}
      </div>
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="添加专业岗位">
        <CreateRoleForm roles={roles.data?.items ?? []} onCreated={() => setCreateOpen(false)} />
      </Dialog>
    </div>
  );
}

const roleTemplateIds = new Set([
  'production_manager',
  'creative_director',
  'editor_in_chief',
  'lead_writer',
  'continuity_editor',
  'art_director',
  'prompt_engineer',
  'visual_reviewer',
  'research_specialist',
]);
function CreateRoleForm({ roles, onCreated }: { roles: CreativeRole[]; onCreated: () => void }) {
  const [templateId, setTemplateId] = useState('lead_writer');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const roleId = React.useRef(`role_${crypto.randomUUID().replaceAll('-', '')}`);
  const client = useQueryClient();
  return (
    <form
      aria-label="从模板添加岗位"
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          await creativeApi.createRole({ templateId, id: roleId.current, name: name.trim() });
          await client.invalidateQueries({ queryKey: creativeKeys.roles });
          onCreated();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '添加岗位失败');
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="co-field">
        岗位模板
        <Select disabled={busy} value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
          {roles
            .filter((role) => roleTemplateIds.has(role.id))
            .map((role) => (
              <option value={role.id} key={role.id}>
                {role.name}
              </option>
            ))}
        </Select>
      </label>
      <label className="co-field">
        岗位名称
        <Input
          required
          maxLength={120}
          value={name}
          disabled={busy}
          placeholder="例如：支线人物主笔"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <p className="text-sm text-muted">
        继承模板的职责和受控工具权限。添加后可单独配置模型，新岗位不会替换三个核心岗位。
      </p>
      {error && <Alert variant="danger">{error}</Alert>}
      <Button type="submit" variant="primary" loading={busy}>
        添加岗位
      </Button>
    </form>
  );
}

function RoleForm({ role, models }: { role: CreativeRole; models: ProviderProfile[] }) {
  const [draft, setDraft] = useState(role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const client = useQueryClient();
  const available = models.filter(
    (model) => model.enabled && model.capabilities.some((capability) => capability === draft.capability),
  );
  const selectedUnavailable = draft.modelId && !available.some((model) => model.id === draft.modelId);
  return (
    <form
      aria-label={`${role.name}岗位设置`}
      className="grid gap-4 py-6 first:pt-0 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,1fr)]"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        setSaved(false);
        try {
          const result = await creativeApi.saveRole(draft);
          setDraft(result);
          setSaved(true);
          await client.invalidateQueries({ queryKey: creativeKeys.roles });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '保存岗位失败');
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-ink">{role.name}</h2>
          <Badge variant={role.core ? 'accent' : 'secondary'}>{role.core ? '核心岗位' : '专业岗位'}</Badge>
          <Badge variant="outline">{role.capability === 'multimodal' ? '看图审核' : '文本创作'}</Badge>
        </div>
        <p className="text-sm leading-relaxed text-muted">{role.responsibility}</p>
        <details>
          <summary className="cursor-pointer text-sm text-muted">岗位职责与工具权限</summary>
          <label className="co-field mt-3">
            职责
            <Textarea
              disabled={busy}
              rows={5}
              value={draft.responsibility}
              maxLength={12000}
              onChange={(event) => {
                setDraft({ ...draft, responsibility: event.target.value });
                setSaved(false);
              }}
            />
          </label>
          <p className="mt-3 text-xs text-muted">
            已配置工具权限：{role.tools.length ? role.tools.join('、') : '无独立工具权限'}
          </p>
        </details>
      </div>
      <div className="space-y-3">
        <label className="co-field">
          使用模型
          <Select
            disabled={busy}
            value={draft.modelId ?? ''}
            onChange={(event) => {
              setDraft({ ...draft, modelId: event.target.value || null });
              setSaved(false);
            }}
          >
            <option value="">尚未指定</option>
            {selectedUnavailable && <option value={draft.modelId!}>原模型不可用，请重新选择</option>}
            {available.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} · {model.model}
              </option>
            ))}
          </Select>
        </label>
        {available.length === 0 && (
          <p className="text-sm text-muted">
            暂无可用{role.capability === 'multimodal' ? '看图' : '文本'}模型，请先在公共服务中添加。
          </p>
        )}
        <Button size="sm" type="submit" loading={busy} disabled={Boolean(selectedUnavailable)}>
          保存岗位
        </Button>
        {saved && (
          <p role="status" className="text-sm text-success-fg">
            岗位已保存。
          </p>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
      </div>
    </form>
  );
}
