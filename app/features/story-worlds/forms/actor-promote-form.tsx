'use client';

import React, { useId, useState } from 'react';
import type {
  PromoteWorldActor,
  WorldActor,
  WorldActorPromotionResult,
  WorldBranch,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Dialog } from '@/app/components/ui/dialog';
import { FormField } from '@/app/components/ui/form-field';
import { FormSection } from '@/app/components/ui/form-section';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { useStoredDraft } from '../hooks/use-stored-draft';
import { describeError } from '../hooks/world-format';

export interface ActorPromoteFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actor: WorldActor;
  branch: WorldBranch;
  onSubmit: (input: PromoteWorldActor) => Promise<WorldActorPromotionResult>;
  onSaved?: (result: WorldActorPromotionResult) => void;
}

interface ActorPromoteDraft {
  promoteToMain: boolean;
  addToLibrary: boolean;
  displayName: string;
  tagsString: string;
  summary: string;
  expectedRevision: number;
}

export function ActorPromoteForm({
  open,
  onOpenChange,
  actor,
  branch,
  onSubmit,
  onSaved,
}: ActorPromoteFormProps) {
  const formId = useId();
  const { draft, setDraft, reset, clear, isDirty, hasConflict, rebase } = useStoredDraft<ActorPromoteDraft>(
    `actor-promote:${branch.id}:${actor.id}`,
    () => ({
      promoteToMain: actor.role !== 'main',
      addToLibrary: !actor.characterId,
      displayName: actor.name,
      tagsString: '',
      summary: actor.background || actor.personality || actor.name,
      expectedRevision: branch.revision,
    }),
    { open, expectedRevision: branch.revision },
  );

  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isAlreadyMain = actor.role === 'main';
  const hasCharacterCard = Boolean(actor.characterId);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    if (!draft.promoteToMain && !draft.addToLibrary) {
      setValidationError('请至少选择「提升为主要角色」或「存入系统角色库」之一。');
      return;
    }

    if (draft.addToLibrary && !draft.displayName.trim()) {
      setValidationError('存入角色库需要填写角色展示名称。');
      return;
    }

    setValidationError(null);
    setError(null);
    setSubmitting(true);

    try {
      const parsedTags = draft.tagsString
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean);

      const payload: PromoteWorldActor = {
        expectedRevision: draft.expectedRevision,
        promoteToMain: draft.promoteToMain,
        addToLibrary: draft.addToLibrary,
        ...(draft.addToLibrary
          ? {
              displayName: draft.displayName.trim(),
              ...(parsedTags.length > 0 ? { tags: parsedTags } : {}),
              ...(draft.summary.trim() ? { summary: draft.summary.trim() } : {}),
            }
          : {}),
      };

      const result = await onSubmit(payload);
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
      title={`人物提升与角色库：${actor.name}`}
      description="提升配角拥有完整视角与记忆；存入系统角色库后可在其他创作项目复用。"
      size="md"
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
            确认执行
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
        {hasConflict && (
          <Alert variant="warning" title="分支修订版本已更新">
            分支已推进至修订版 {branch.revision}（草稿基于修订版 {draft.expectedRevision}）。
            您可以保留设置并更新修订基底，或重置草稿。
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
        {Boolean(error?.trim()) && <Alert variant="danger" title="操作失败">{error}</Alert>}
        {Boolean(validationError?.trim()) && <Alert variant="warning" title="还不能提交">{validationError}</Alert>}

        <div className="rounded-panel border border-border-subtle bg-surface-sunken/35 p-3">
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">{actor.name}</span>
            <Badge variant={isAlreadyMain ? 'accent' : 'outline'}>{isAlreadyMain ? '主要角色' : '配角'}</Badge>
            {hasCharacterCard && <Badge variant="secondary">已建角色库卡</Badge>}
          </div>
          {(actor.background || actor.personality) && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{actor.background || actor.personality}</p>
          )}
        </div>

        <FormSection title="提升选项">
          <Checkbox
            checked={draft.promoteToMain}
            disabled={isAlreadyMain}
            onChange={(e) => setDraft((current) => ({ ...current, promoteToMain: e.target.checked }))}
            label="提升为主要角色"
            description={
              isAlreadyMain
                ? '当前人物已经是主要角色。'
                : '提升后将在故事推进中拥有自主决策行动、独立视角和认知边界记录。'
            }
          />
          <Checkbox
            checked={draft.addToLibrary}
            onChange={(e) => setDraft((current) => ({ ...current, addToLibrary: e.target.checked }))}
            label="存入系统角色库"
            description="在系统角色库中建立该人物的可复用角色卡；已存在时幂等复用。"
          />
        </FormSection>

        {draft.addToLibrary && (
          <FormSection title="角色库建卡信息">
            <FormField label="角色展示名" required>
              <Input
                value={draft.displayName}
                maxLength={200}
                onChange={(e) => setDraft((current) => ({ ...current, displayName: e.target.value }))}
                placeholder="例如：港口信使"
              />
            </FormField>
            <FormField label="标签" hint="多个标签以逗号分隔">
              <Input
                value={draft.tagsString}
                maxLength={200}
                onChange={(e) => setDraft((current) => ({ ...current, tagsString: e.target.value }))}
                placeholder="例如：信使, 港口, 见证者"
              />
            </FormField>
            <FormField label="角色生平与设定概要">
              <Textarea
                rows={3}
                value={draft.summary}
                maxLength={5000}
                onChange={(e) => setDraft((current) => ({ ...current, summary: e.target.value }))}
                placeholder="简述该角色的背景设定与关键经历"
              />
            </FormField>
          </FormSection>
        )}
      </form>
    </Dialog>
  );
}
