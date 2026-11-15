'use client';

import React, { useState } from 'react';
import type {
  ResolveWorldRunCall,
  WorldBranch,
  WorldRun,
  WorldRunRecoveryCall,
  WorldRunRecoveryResult,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { FormField } from '@/app/components/ui/form-field';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { useWorldRunRecovery } from '../queries';
import { describeError } from '../hooks/world-format';

export interface RunRecoveryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worldId: string;
  branch: WorldBranch;
  run: WorldRun;
  onResolve: (callId: string, input: ResolveWorldRunCall) => Promise<WorldRunRecoveryResult>;
}

export function RunRecoveryDialog({
  open,
  onOpenChange,
  worldId,
  branch,
  run,
  onResolve,
}: RunRecoveryDialogProps) {
  const recoveryQuery = useWorldRunRecovery(worldId, branch.id, run.id, open);
  const calls = recoveryQuery.data?.items ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="推进异常调用恢复"
      description="推进中断或上游模型结果不明时，必须依人工查验凭据判定处理，禁止盲目自动重试。"
      size="lg"
      footer={
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          关闭
        </Button>
      }
    >
      <div className="space-y-5">
        <Alert variant="warning" title="不可自动重试约束">
          文本调用涉及世界事件因果判定。若调用结果不明，请先在上游平台日志或控制台核验该请求是否实际执行，并提交证据记录。
        </Alert>

        {recoveryQuery.isLoading && (
          <p className="text-sm text-muted">正在查询分支异常调用记录…</p>
        )}

        {recoveryQuery.isError && (
          <Alert variant="danger" title="异常调用记录读取失败">
            {describeError(recoveryQuery.error)}
          </Alert>
        )}

        {!recoveryQuery.isLoading && calls.length === 0 && (
          <div className="rounded-panel border border-dashed border-border-default px-4 py-8 text-center text-sm text-muted">
            当前运行没有挂起的不明调用。若运行处于暂停或错误状态，可核对运行设置后尝试恢复。
          </div>
        )}

        {calls.map((call) => (
          <RunRecoveryCallCard
            key={call.id}
            call={call}
            branchRevision={branch.revision}
            onResolve={(input) => onResolve(call.id, input)}
          />
        ))}
      </div>
    </Dialog>
  );
}

interface RunRecoveryCallCardProps {
  call: WorldRunRecoveryCall;
  branchRevision: number;
  onResolve: (input: ResolveWorldRunCall) => Promise<WorldRunRecoveryResult>;
}

function RunRecoveryCallCard({ call, branchRevision, onResolve }: RunRecoveryCallCardProps) {
  const [resolution, setResolution] = useState<'not-executed' | 'received-result'>('not-executed');
  const [evidence, setEvidence] = useState('');
  const [responseText, setResponseText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resolved, setResolved] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!evidence.trim()) {
      setValidationError('必须提供明确的人工核查证据（如控制台日志记录、无计费记录等）。');
      return;
    }

    if (resolution === 'received-result' && !responseText.trim()) {
      setValidationError('已收到结果模式下，必须填入模型返回的正文内容。');
      return;
    }

    setValidationError(null);
    setError(null);
    setSubmitting(true);

    try {
      await onResolve({
        expectedRevision: branchRevision,
        resolution,
        evidence: evidence.trim(),
        ...(resolution === 'received-result' ? { responseText: responseText.trim() } : {}),
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
          调用 {call.id} 已判定为「{resolution === 'not-executed' ? '确认未执行' : '已补录结果'}」，分支已更新。
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
          <Badge variant={call.status === 'uncertain' ? 'warning' : 'secondary'}>
            {call.status === 'uncertain' ? '结果不明' : '正在提交'}
          </Badge>
          <span className="text-xs font-mono text-muted">调用 ID: {call.id}</span>
        </div>
        <span className="text-xs text-muted">第 {call.attempt + 1} 次尝试 · 阶段: {call.stage}</span>
      </div>

      <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <div>
          <span className="text-muted">用途：</span>
          <span className="font-medium text-ink">{call.purpose}</span>
        </div>
        <div>
          <span className="text-muted">上游调用 ID：</span>
          <span className="font-mono text-ink">{call.aiCallId || '无'}</span>
        </div>
      </div>

      {call.error && (
        <Alert variant="danger" title="上游报错或中断原因">
          {call.error}
        </Alert>
      )}

      {Boolean(error?.trim()) && <Alert variant="danger" title="决议提交失败">{error}</Alert>}
      {Boolean(validationError?.trim()) && <Alert variant="warning" title="还不能提交">{validationError}</Alert>}

      <FormField label="判定结论" required>
        <Select
          value={resolution}
          onChange={(e) => setResolution(e.target.value as 'not-executed' | 'received-result')}
        >
          <option value="not-executed">确认未执行：模型未执行或已超时中断，放弃本次调用</option>
          <option value="received-result">已收到结果：线下获取到有效模型响应，补录入库</option>
        </Select>
      </FormField>

      <FormField
        label="核查证据"
        required
        hint="请详述核查渠道，例如：已登录控制台查阅 TraceID 确认该请求未到达模型/模型已报错未计费。"
      >
        <Textarea
          rows={2}
          value={evidence}
          maxLength={4000}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder="必填：人工核对证据与查验结论"
        />
      </FormField>

      {resolution === 'received-result' && (
        <FormField label="补录模型响应文本" required>
          <Textarea
            rows={4}
            value={responseText}
            onChange={(e) => setResponseText(e.target.value)}
            placeholder="粘贴模型返回的文本或 JSON 内容"
          />
        </FormField>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button size="sm" type="submit" variant="primary" loading={submitting}>
          提交人工决议
        </Button>
      </div>
    </form>
  );
}
