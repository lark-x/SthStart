'use client';

import React, { useId, useState } from 'react';
import type {
  CreateWorldStoryLine,
  WorldActor,
  WorldBranch,
  WorldStoryLine,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Dialog } from '@/app/components/ui/dialog';
import { FormField } from '@/app/components/ui/form-field';
import { FormSection } from '@/app/components/ui/form-section';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { useStoredDraft } from '../hooks/use-stored-draft';
import { describeError } from '../hooks/world-format';

export interface StoryLineFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: WorldBranch;
  actors: WorldActor[];
  onSubmit: (input: CreateWorldStoryLine) => Promise<WorldStoryLine>;
  onSaved?: (storyLine: WorldStoryLine) => void;
}

interface StoryLineDraft {
  title: string;
  description: string;
  actorIds: string[];
  expectedRevision: number;
}

export function StoryLineForm({
  open,
  onOpenChange,
  branch,
  actors,
  onSubmit,
  onSaved,
}: StoryLineFormProps) {
  const formId = useId();
  const { draft, setDraft, reset, clear, isDirty, hasConflict, rebase } = useStoredDraft<StoryLineDraft>(
    `story-line:${branch.id}`,
    () => ({ title: '', description: '', actorIds: [], expectedRevision: branch.revision }),
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
    if (!draft.title.trim()) {
      setValidationError('故事线标题不能为空。');
      return;
    }
    setValidationError(null);
    setError(null);
    setSubmitting(true);
    try {
      const storyLine = await onSubmit({
        expectedRevision: draft.expectedRevision,
        title: draft.title.trim(),
        description: draft.description.trim(),
        actorIds: draft.actorIds,
      });
      clear();
      onOpenChange(false);
      onSaved?.(storyLine);
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
      title="新建故事线"
      description="故事线围绕一个主题串起同一分支的事件，不会复制事件本身。"
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
            创建故事线
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
        {hasConflict && (
          <Alert variant="warning" title="分支修订版本已更新">
            分支已推进至修订版 {branch.revision}（草稿基于修订版 {draft.expectedRevision}）。
            您可以保留内容并更新修订基底，或重置草稿。
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
        {Boolean(error?.trim()) && <Alert variant="danger" title="创建失败">{error}</Alert>}
        {Boolean(validationError?.trim()) && <Alert variant="warning" title="还不能创建">{validationError}</Alert>}
        <FormSection title="故事线">
          <FormField label="标题" required>
            <Input
              value={draft.title}
              maxLength={200}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="例如：失踪的信使"
            />
          </FormField>
          <FormField label="这条线关注什么">
            <Textarea
              rows={4}
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            />
          </FormField>
          <FormField label="关联人物" hint="可以稍后在事件中补充，也可以先留空。">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {actors.map((actor) => (
                <Checkbox
                  key={actor.id}
                  checked={draft.actorIds.includes(actor.id)}
                  onChange={() => toggleActor(actor.id)}
                  label={actor.name}
                  description={actor.role === 'main' ? '主要人物' : '配角'}
                />
              ))}
            </div>
          </FormField>
        </FormSection>
      </form>
    </Dialog>
  );
}
