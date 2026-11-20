'use client';

import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CreativeRun, CreativeNodeRun, CreativeBudget } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { Card } from '@/app/components/ui/card';
import { Alert } from '@/app/components/ui/alert';
import { creativeApi } from './api';
import { creativeKeys } from './queries';
import { BudgetFields, defaultCreativeBudget } from './budget-fields';

export function ActivateCandidate({ run }: { run: CreativeRun }) {
  const [budget, setBudget] = useState<CreativeBudget>(defaultCreativeBudget);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const client = useQueryClient();
  return (
    <Card variant="sunken" className="space-y-4">
      <h3 className="font-semibold">审核外部 Agent 提交的候选</h3>
      <p className="text-sm leading-relaxed text-muted">
        候选已保存，尚未采用。确认本次审核额度后，由站内岗位检查内容，再交给你最终决定。
      </p>
      <form
        className="space-y-4"
        aria-label="启动候选审核"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            await creativeApi.activate(run.id, run.revision, budget);
            await client.invalidateQueries({ queryKey: creativeKeys.runs });
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '审核未启动');
          } finally {
            setBusy(false);
          }
        }}
      >
        <BudgetFields budget={budget} onChange={setBudget} disabled={busy} />
        {error && <Alert variant="danger">{error}</Alert>}
        <Button type="submit" variant="primary" loading={busy}>
          确认额度并启动审核
        </Button>
      </form>
    </Card>
  );
}

export function RecoverNode({
  run,
  node,
  label,
}: {
  run: CreativeRun;
  node: CreativeNodeRun;
  label: string;
}) {
  const [resolution, setResolution] = useState<'not_executed' | 'result_received'>('result_received');
  const [note, setNote] = useState('');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const client = useQueryClient();
  return (
    <Card variant="sunken" className="space-y-4">
      <h3 className="font-semibold">核对「{label}」的执行结果</h3>
      <p className="text-sm leading-relaxed text-muted">
        请先核对供应商任务或调用记录。仅在确定没有执行时重新派发；已收到结果时补录原结果，不再次付费调用。
      </p>
      <dl className="space-y-1 break-all text-xs text-muted">
        <div>
          <dt className="inline">外部任务：</dt>
          <dd className="inline">{node.externalTaskId ?? '未返回任务编号'}</dd>
        </div>
        <div>
          <dt className="inline">调用记录：</dt>
          <dd className="inline">{node.traceId}</dd>
        </div>
        <div>
          <dt className="inline">派发时间：</dt>
          <dd className="inline">
            {node.dispatchedAt ? new Date(node.dispatchedAt).toLocaleString('zh-CN') : '未记录'}
          </dd>
        </div>
      </dl>
      <form
        aria-label={`核对${label}的结果`}
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setError('');
          let parsed: Record<string, unknown> | undefined;
          if (resolution === 'result_received') {
            try {
              const value: unknown = JSON.parse(output);
              if (!value || typeof value !== 'object' || Array.isArray(value))
                throw new Error('请提供原始结果的 JSON 对象。');
              parsed = value as Record<string, unknown>;
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : '结果格式无效');
              return;
            }
          }
          setBusy(true);
          try {
            await creativeApi.recover(run.id, node.id, {
              expectedRevision: run.revision,
              resolution,
              note,
              ...(parsed ? { output: parsed } : {}),
            });
            await client.invalidateQueries({ queryKey: creativeKeys.runs });
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '恢复未完成');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="co-field">
          核对结论
          <Select
            value={resolution}
            disabled={busy}
            onChange={(event) => setResolution(event.target.value as typeof resolution)}
          >
            <option value="result_received">已取得原始结果，补录后继续</option>
            <option value="not_executed">已确认未执行，允许重新派发</option>
          </Select>
        </label>
        <label className="co-field">
          核对依据（必填）
          <Textarea
            required
            rows={3}
            maxLength={4000}
            value={note}
            disabled={busy}
            onChange={(event) => setNote(event.target.value)}
            placeholder="记录查询的供应商任务、时间和结果，或确认请求未执行的依据。"
          />
        </label>
        {resolution === 'result_received' && (
          <label className="co-field">
            原始结果（JSON 对象）
            <Textarea
              required
              rows={5}
              value={output}
              disabled={busy}
              onChange={(event) => setOutput(event.target.value)}
              placeholder="粘贴已核实的原始产物内容。服务端仍会验证产物结构与来源。"
            />
          </label>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
        <Button type="submit" loading={busy} variant="outline">
          {resolution === 'not_executed' ? '依据核对结果重新派发' : '保存核对结果并继续'}
        </Button>
      </form>
    </Card>
  );
}
