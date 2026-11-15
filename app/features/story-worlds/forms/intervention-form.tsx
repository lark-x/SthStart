'use client';

import React, { useId, useState } from 'react';
import type {
  CreateWorldIntervention,
  WorldActor,
  WorldBranch,
  WorldIntervention,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Dialog } from '@/app/components/ui/dialog';
import { FormField } from '@/app/components/ui/form-field';
import { FormSection } from '@/app/components/ui/form-section';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { useStoredDraft } from '../hooks/use-stored-draft';
import {
  INTERVENTION_KIND_META,
  describeError,
  formatTick,
} from '../hooks/world-format';

export interface InterventionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: WorldBranch;
  actors: WorldActor[];
  onSubmit: (input: CreateWorldIntervention) => Promise<WorldIntervention>;
  onSaved?: (intervention: WorldIntervention) => void;
}

interface InterventionDraft {
  tick: number;
  kind: WorldIntervention['kind'];
  actorIds: string[];
  instruction: string;
  expectedRevision: number;
}

export function InterventionForm({
  open,
  onOpenChange,
  branch,
  actors,
  onSubmit,
  onSaved,
}: InterventionFormProps) {
  const formId = useId();
  const { draft, setDraft, reset, clear, isDirty, hasConflict, rebase } = useStoredDraft<InterventionDraft>(
    `intervention:${branch.id}`,
    () => ({
      tick: branch.currentTick,
      kind: 'goal',
      actorIds: [],
      instruction: '',
      expectedRevision: branch.revision,
    }),
    { open, expectedRevision: branch.revision },
  );
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleActor = (actorId: string) => {
    setDraft((current) => ({
      ...current,
      actorIds: current.actorIds.includes(actorId)
        ? current.actorIds.filter((id) => id !== actorId)
        : [...current.actorIds, actorId],
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (!draft.instruction.trim()) {
      setValidationError('请写下这次干预要增加的目标、约束或事件。');
      return;
    }
    if (draft.tick < branch.currentTick) {
      setValidationError('不能直接改写已经发生的历史；要改变过去请从历史节点创建分支。');
      return;
    }
    if (draft.kind !== 'external-event' && draft.actorIds.length === 0) {
      setValidationError('目标或约束至少需要选择一名人物。');
      return;
    }
    setValidationError(null);
    setError(null);
    setSubmitting(true);
    try {
      const result = await onSubmit({
        expectedRevision: draft.expectedRevision,
        tick: draft.tick,
        kind: draft.kind,
        actorIds: draft.actorIds,
        instruction: draft.instruction.trim(),
      });
      clear();
      onOpenChange(false);
      onSaved?.(result);
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
      title="导演干预"
      description="干预只影响未来，或从当前时刻推入外部事件；已发生的历史不会被静默改写。"
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
            加入干预
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
        {hasConflict && (
          <Alert variant="warning" title="分支修订版本已更新">
            分支已推进至修订版 {branch.revision}（草稿基于修订版 {draft.expectedRevision}）。
            您可以保留干预内容并更新修订基底，或重置草稿。
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" type="button" onClick={() => rebase(branch.revision)}>
                更新至 rev {branch.revision}
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => reset()}>
                重置草稿
              </Button>
            </div>
          </Alert>
        )}
        {Boolean(error?.trim()) && <Alert variant="danger" title="干预保存失败">{error}</Alert>}
        {Boolean(validationError?.trim()) && <Alert variant="warning" title="还不能提交">{validationError}</Alert>}
        <Alert variant="info">
          当前分支推进到 {formatTick(branch.currentTick)}。如果要改变这个时刻之前的选择，请使用“从历史节点分支”。
        </Alert>

        <FormSection title="干预内容">
          <FormField label="生效时刻（分钟）" required hint="从世界起点起算。">
            <Input
              type="number"
              min={branch.currentTick}
              value={draft.tick}
              onChange={(event) => setDraft((current) => ({
                ...current,
                tick: Math.max(branch.currentTick, Number(event.target.value) || branch.currentTick),
              }))}
            />
          </FormField>
          <FormField label="干预类型">
            <Select
              value={draft.kind}
              onChange={(event) => setDraft((current) => ({
                ...current,
                kind: event.target.value as WorldIntervention['kind'],
              }))}
            >
              {Object.entries(INTERVENTION_KIND_META).map(([value, meta]) => (
                <option key={value} value={value}>{meta.label}</option>
              ))}
            </Select>
          </FormField>
          <p className="text-sm leading-relaxed text-muted">{INTERVENTION_KIND_META[draft.kind].description}</p>
          <FormField
            label={draft.kind === 'external-event' ? '涉及人物（可选）' : '涉及人物'}
            required={draft.kind !== 'external-event'}
            hint="人物只能依据自己获知的信息行动；干预会作为新的外部信息进入后续步骤。"
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {actors.map((actor) => (
                <div
                  key={actor.id}
                  className="rounded-control bg-surface-sunken/40 px-3 py-2"
                >
                  <Checkbox
                    checked={draft.actorIds.includes(actor.id)}
                    onChange={() => toggleActor(actor.id)}
                    label={actor.name}
                    description={actor.role === 'main' ? '主要人物' : '配角'}
                  />
                </div>
              ))}
            </div>
          </FormField>
          <FormField label="具体指令" required>
            <Textarea
              rows={5}
              value={draft.instruction}
              maxLength={8000}
              onChange={(event) => setDraft((current) => ({ ...current, instruction: event.target.value }))}
              placeholder="例如：让 A 在两天后收到一封来自旧友的信，信中提到 B 的失踪。"
            />
          </FormField>
        </FormSection>
      </form>
    </Dialog>
  );
}
