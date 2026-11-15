'use client';

import React, { useState } from 'react';
import type {
  GenerationRecoveryResolveRequest,
  GenerationRecoveryResolveResponse,
  GenerationRecoveryTask,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { FormField } from '@/app/components/ui/form-field';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { useUncertainGenerationTasks } from '../queries';
import { describeError } from '../hooks/world-format';

export interface GenerationRecoveryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolve: (taskId: string, input: GenerationRecoveryResolveRequest) => Promise<GenerationRecoveryResolveResponse>;
  targetTaskId?: string;
}

export function GenerationRecoveryDialog({
  open,
  onOpenChange,
  onResolve,
  targetTaskId,
}: GenerationRecoveryDialogProps) {
  const query = useUncertainGenerationTasks('story-worlds', open);
  const tasks = query.data?.items ?? [];
  const filteredTasks = targetTaskId ? tasks.filter((t) => t.id === targetTaskId) : tasks;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="图片生成异常任务核对"
      description="公共图片任务结果不明或网络中断时，依上游生图引擎（ComfyUI / 商业生图 API）实际记录人工判定。"
      size="lg"
      footer={
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          关闭
        </Button>
      }
    >
      <div className="space-y-5">
        <Alert variant="info" title="公共生图额度说明">
          结果不明的图片任务在判定为失败前仍会占用公共图片槽位；人工核实失败后将释放槽位，已生成的配图可重新排队提交。
        </Alert>

        {query.isLoading && <p className="text-sm text-muted">正在查询结果不明的图片任务…</p>}
        {query.isError && (
          <Alert variant="danger" title="生成任务读取失败">
            {describeError(query.error)}
          </Alert>
        )}

        {!query.isLoading && filteredTasks.length === 0 && (
          <div className="rounded-panel border border-dashed border-border-default px-4 py-8 text-center text-sm text-muted">
            当前没有挂起的结果不明生成任务。
          </div>
        )}

        {filteredTasks.map((task) => (
          <GenerationRecoveryTaskCard
            key={task.id}
            task={task}
            onResolve={(input) => onResolve(task.id, input)}
          />
        ))}
      </div>
    </Dialog>
  );
}

interface GenerationRecoveryTaskCardProps {
  task: GenerationRecoveryTask;
  onResolve: (input: GenerationRecoveryResolveRequest) => Promise<GenerationRecoveryResolveResponse>;
}

function GenerationRecoveryTaskCard({ task, onResolve }: GenerationRecoveryTaskCardProps) {
  const [outcome, setOutcome] = useState<'failed' | 'cancelled'>('failed');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resolved, setResolved] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!note.trim()) {
      setValidationError('必须填写上游核对说明（如 ComfyUI 历史队列中无此任务/已报错中断）。');
      return;
    }

    setValidationError(null);
    setError(null);
    setSubmitting(true);

    try {
      await onResolve({
        confirmed: true,
        outcome,
        note: note.trim(),
        appId: 'story-worlds',
      });
      setResolved(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (resolved) {
    return (
      <div className="rounded-panel border border-border-subtle bg-surface-sunken/35 p-4">
        <Alert variant="success" title="已完成判定">
          任务 {task.id} 已标记为「{outcome === 'failed' ? '失败' : '已取消'}」，公共图片名额已同步更新。
        </Alert>
      </div>
    );
  }

  return (
    <form
      className="space-y-4 rounded-panel border border-border-default bg-surface p-4 shadow-sm"
      onSubmit={(e) => void handleSubmit(e)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
        <div className="flex items-center gap-2">
          <Badge variant="warning">结果不明</Badge>
          <span className="text-xs font-mono text-muted">任务 ID: {task.id}</span>
        </div>
        <span className="text-xs text-muted">引擎: {task.engineId}</span>
      </div>

      <div className="text-xs text-muted">
        <span>工作流：{task.workflowId || '默认'}</span> · <span>发起时间：{task.createdAt}</span>
      </div>

      {(task.errorMessage || task.errorCode) && (
        <Alert variant="danger" title="异常记录">
          {task.errorMessage || task.errorCode}
        </Alert>
      )}

      {Boolean(error?.trim()) && <Alert variant="danger" title="判定提交失败">{error}</Alert>}
      {Boolean(validationError?.trim()) && <Alert variant="warning" title="还不能提交">{validationError}</Alert>}

      <FormField label="判定结论" required>
        <Select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as 'failed' | 'cancelled')}
        >
          <option value="failed">标记为失败：已核实上游未成功输出图片，释放配额并允许重试</option>
          <option value="cancelled">标记为已取消：上游队列中已放弃该任务</option>
        </Select>
      </FormField>

      <FormField label="上游核对说明" required hint="请注明核验细节，例如：ComfyUI 终端断开/模型显存溢出退出。">
        <Textarea
          rows={2}
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
          placeholder="必填：上游服务核验说明"
        />
      </FormField>

      <div className="flex justify-end gap-2 pt-2">
        <Button size="sm" type="submit" variant="primary" loading={submitting}>
          确认判定
        </Button>
      </div>
    </form>
  );
}
