'use client';

import React, { useId, useState } from 'react';
import type {
  CreateWorldBranch,
  StoryWorld,
  WorldBranch,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { FormField } from '@/app/components/ui/form-field';
import { FormSection, ShortFieldGrid } from '@/app/components/ui/form-section';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { useStoredDraft } from '../hooks/use-stored-draft';
import {
  BRANCH_MODE_META,
  branchModeLabel,
  describeError,
  formatTick,
} from '../hooks/world-format';

export interface BranchFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  world: StoryWorld;
  branches: WorldBranch[];
  defaultParentBranchId?: string | null;
  defaultForkTick?: number;
  onSubmit: (input: CreateWorldBranch) => Promise<WorldBranch>;
  onSaved?: (branch: WorldBranch) => void;
}

interface BranchDraft {
  title: string;
  mode: WorldBranch['mode'];
  direction: string;
  parentBranchId: string;
  forkTick: number;
  expectedRevision: number;
}

function createDraft(
  world: StoryWorld,
  branches: WorldBranch[],
  defaultParentBranchId?: string | null,
  defaultForkTick?: number,
): BranchDraft {
  const parent = branches.find((branch) => branch.id === defaultParentBranchId);
  return {
    title: `${world.title} · 新分支 ${branches.length + 1}`,
    mode: 'canon-gap',
    direction: '',
    parentBranchId: parent?.id ?? '',
    forkTick: defaultForkTick ?? parent?.currentTick ?? 0,
    expectedRevision: world.revision,
  };
}

export function BranchForm({
  open,
  onOpenChange,
  world,
  branches,
  defaultParentBranchId,
  defaultForkTick,
  onSubmit,
  onSaved,
}: BranchFormProps) {
  const formId = useId();
  const { draft, setDraft, reset, clear, isDirty, hasConflict, rebase } = useStoredDraft<BranchDraft>(
    `branch:${world.id}`,
    () => createDraft(world, branches, defaultParentBranchId, defaultForkTick),
    { open, expectedRevision: world.revision },
  );
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const parent = branches.find((branch) => branch.id === draft.parentBranchId);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (!draft.title.trim()) {
      setValidationError('分支标题不能为空。');
      return;
    }
    if (parent && (draft.forkTick < parent.forkTick || draft.forkTick > parent.currentTick)) {
      setValidationError(`分叉时刻需要在 ${parent.forkTick} 到 ${parent.currentTick} 分钟之间（当前是 ${formatTick(parent.currentTick)}）。`);
      return;
    }
    setValidationError(null);
    setError(null);
    setSubmitting(true);
    try {
      const payload: CreateWorldBranch = {
        title: draft.title.trim(),
        mode: draft.mode,
        direction: draft.direction.trim(),
        expectedRevision: draft.expectedRevision,
        ...(parent ? { parentBranchId: parent.id, forkTick: draft.forkTick } : {}),
      };
      const branch = await onSubmit(payload);
      clear();
      onOpenChange(false);
      onSaved?.(branch);
    } catch (submitError) {
      setError(describeError(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
      title="新建世界分支"
      description="分支拥有独立的事件、人物状态与记忆；从历史节点分叉时不会改写原分支。"
      size="lg"
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={() => {
              reset();
              setError(null);
              setValidationError(null);
            }}
          >
            重置草稿
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={submitting}>
            创建分支
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
        {hasConflict && (
          <Alert variant="warning" title="世界设定版本已更新">
            世界设定已推进至修订版 {world.revision}（草稿基于修订版 {draft.expectedRevision}）。
            您可以保留内容并更新修订基底，或重置草稿。
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" type="button" onClick={() => rebase(world.revision)}>
                更新至 rev {world.revision}
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => reset()}>
                重置草稿
              </Button>
            </div>
          </Alert>
        )}
        {Boolean(error?.trim()) && <Alert variant="danger" title="创建失败">{error}</Alert>}
        {Boolean(validationError?.trim()) && <Alert variant="warning" title="还不能创建">{validationError}</Alert>}
        {world.sources.length === 0 && (
          <Alert variant="info" title="这个还没有来源资料">
            运行仍可开始，但角色行动会缺少可核对的原文依据，服务会显示资料缺口。
          </Alert>
        )}

        <FormSection title="分支设定">
          <FormField label="分支标题" required>
            <Input
              value={draft.title}
              maxLength={200}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            />
          </FormField>
          <ShortFieldGrid>
            <FormField label="与原作的关系">
              <Select
                value={draft.mode}
                onChange={(event) => setDraft((current) => ({ ...current, mode: event.target.value as WorldBranch['mode'] }))}
              >
                {Object.entries(BRANCH_MODE_META).map(([value, meta]) => (
                  <option key={value} value={value}>{meta.label}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="从哪个分支分出" hint="不选择时从世界起点创建。">
              <Select
                value={draft.parentBranchId}
                onChange={(event) => {
                  const nextParent = branches.find((branch) => branch.id === event.target.value);
                  setDraft((current) => ({
                    ...current,
                    parentBranchId: event.target.value,
                    forkTick: nextParent?.currentTick ?? 0,
                  }));
                }}
              >
                <option value="">世界起点</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.title} · {branchModeLabel(branch.mode)} · {formatTick(branch.currentTick)}
                  </option>
                ))}
              </Select>
            </FormField>
          </ShortFieldGrid>
          <p className="text-sm leading-relaxed text-muted">{BRANCH_MODE_META[draft.mode].description}</p>
          <FormField label="创作方向" hint="写清这条分支要探索的走向、禁止改动的设定和希望保留的关系。">
            <Textarea
              rows={4}
              value={draft.direction}
              onChange={(event) => setDraft((current) => ({ ...current, direction: event.target.value }))}
            />
          </FormField>
        </FormSection>

        {parent && (
          <FormSection title="历史分叉">
            <FormField
              label={`分叉时刻（分钟）`}
              hint={`该分支当前推进到 ${formatTick(parent.currentTick)}。只继承在分叉时刻已经结束的事件及其记忆；尚在进行的事件不会带入最终结果。`}
            >
              <Input
                type="number"
                min={parent.forkTick}
                max={parent.currentTick}
                value={draft.forkTick}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  forkTick: Math.max(parent.forkTick, Math.min(parent.currentTick, Number(event.target.value) || 0)),
                }))}
              />
            </FormField>
            <Alert variant="info">
              创建后可以并排比较两条分支；首版不做自动合并。已有分支的历史不会被新分支改动。
            </Alert>
          </FormSection>
        )}
      </form>
    </Dialog>
  );
}
