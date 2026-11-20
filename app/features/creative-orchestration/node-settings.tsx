'use client';

import React, { useState } from 'react';
import type { CreativeNode, CreativeRole, CreativeWorkflow } from '@sthstart/contracts';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Checkbox } from '@/app/components/ui/checkbox';
import { nodeLabels, payloadLabels } from './workflow-model';

export function NodeSettings({
  node,
  nodes,
  roles,
  workflows,
  onChange,
  onRemove,
  canRemove,
}: {
  node: CreativeNode;
  nodes: CreativeNode[];
  roles: CreativeRole[];
  workflows: CreativeWorkflow[];
  onChange: (node: CreativeNode) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [parameters, setParameters] = useState(JSON.stringify(node.config.parameters ?? {}, null, 2));
  const [parameterError, setParameterError] = useState('');
  const config = (patch: Partial<CreativeNode['config']>) =>
    onChange({ ...node, config: { ...node.config, ...patch } });
  return (
    <section aria-label="节点设置" className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">节点设置</h3>
        <Button size="sm" variant="danger-ghost" disabled={!canRemove} onClick={onRemove}>
          删除节点
        </Button>
      </div>
      <label className="co-field">
        节点名称
        <Input
          value={node.label}
          maxLength={160}
          onChange={(event) => onChange({ ...node, label: event.target.value })}
        />
      </label>
      <p className="text-sm text-muted">{nodeLabels[node.kind]}</p>
      <label className="co-field">
        输出内容
        <Select
          value={node.outputKind}
          onChange={(event) =>
            onChange({ ...node, outputKind: event.target.value as CreativeNode['outputKind'] })
          }
        >
          {Object.entries(payloadLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </label>
      {['agent', 'revision'].includes(node.kind) && (
        <label className="co-field">
          执行岗位
          <Select
            value={node.roleId ?? ''}
            onChange={(event) => onChange({ ...node, roleId: event.target.value || undefined })}
          >
            <option value="">选择岗位</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {['approval', 'revision'].includes(node.kind) && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">负责复核的岗位</legend>
          {roles.map((role) => (
            <label key={role.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={node.config.reviewerRoleIds?.includes(role.id) ?? false}
                onChange={(event) =>
                  config({
                    reviewerRoleIds: event.target.checked
                      ? [...(node.config.reviewerRoleIds ?? []), role.id]
                      : (node.config.reviewerRoleIds ?? []).filter((id) => id !== role.id),
                  })
                }
              />
              {role.name}
            </label>
          ))}
        </fieldset>
      )}
      {['agent', 'context', 'tool', 'revision'].includes(node.kind) && (
        <label className="co-field">
          任务说明
          <Textarea
            rows={5}
            value={node.config.instruction ?? ''}
            maxLength={20000}
            onChange={(event) => config({ instruction: event.target.value })}
            placeholder="说明需要生成或检查的内容，以及不能改变的约束。"
          />
        </label>
      )}
      {node.kind === 'tool' && (
        <label className="co-field">
          创作工具
          <Select
            value={node.config.tool ?? ''}
            onChange={(event) => config({ tool: event.target.value || undefined })}
          >
            <option value="">选择受控工具</option>
            <option value="image_generation">生成图片</option>
            <option value="video_plan">准备视频方案（仅计划）</option>
          </Select>
        </label>
      )}
      {node.kind === 'condition' && (
        <label className="co-field">
          判断条件
          <Select
            value={node.config.condition ?? 'approved'}
            onChange={(event) =>
              config({ condition: event.target.value as CreativeNode['config']['condition'] })
            }
          >
            <option value="approved">审核通过</option>
            <option value="needs_revision">需要返修</option>
            <option value="ordinary_image">普通插图</option>
            <option value="critical_change">关键变化</option>
          </Select>
        </label>
      )}
      {node.kind === 'revision' && (
        <>
          <label className="co-field">
            返修哪个节点
            <Select
              value={node.config.targetNodeId ?? ''}
              onChange={(event) => config({ targetNodeId: event.target.value || undefined })}
            >
              <option value="">选择返修目标</option>
              {nodes
                .filter(
                  (item) =>
                    item.id !== node.id && ['agent', 'tool', 'condition', 'subworkflow'].includes(item.kind),
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
            </Select>
          </label>
          <label className="co-field">
            最多返修次数
            <Select
              value={node.config.maxRevisions ?? 2}
              onChange={(event) => config({ maxRevisions: Number(event.target.value) })}
            >
              <option value="1">1 次</option>
              <option value="2">2 次</option>
            </Select>
          </label>
        </>
      )}
      {node.kind === 'subworkflow' && (
        <>
          <label className="co-field">
            子流程
            <Select
              value={node.config.workflowId ?? ''}
              onChange={(event) => {
                const selected = workflows.find((item) => item.id === event.target.value);
                config({
                  workflowId: selected?.id,
                  workflowVersion: selected?.publishedVersion || undefined,
                });
              }}
            >
              <option value="">选择已发布流程</option>
              {workflows
                .filter((item) => item.publishedVersion > 0)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.document.name} · 第 {item.publishedVersion} 版
                  </option>
                ))}
            </Select>
          </label>
          {node.config.workflowId && (
            <label className="co-field">
              固定使用版本
              <Input
                type="number"
                min={1}
                value={node.config.workflowVersion ?? 1}
                onChange={(event) => config({ workflowVersion: Math.max(1, Number(event.target.value)) })}
              />
            </label>
          )}
        </>
      )}
      {['tool', 'approval', 'adopt', 'condition'].includes(node.kind) && (
        <label className="co-field">
          内容重要性
          <Select
            value={node.config.importance ?? 'unknown'}
            onChange={(event) =>
              config({ importance: event.target.value as CreativeNode['config']['importance'] })
            }
          >
            <option value="unknown">尚未判断，需人工确认</option>
            <option value="ordinary">普通内容</option>
            <option value="key">关键剧情</option>
            <option value="baseline">角色 / 地点基准</option>
          </Select>
        </label>
      )}
      <section aria-label="上游输入" className="space-y-2">
        <h4 className="text-sm font-semibold">读取的上游内容</h4>
        {Object.entries(node.inputs).length === 0 ? (
          <p className="text-sm text-muted">连接上游节点后，内容会自动传入。</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {Object.entries(node.inputs).map(([key, input]) => (
              <li key={key}>
                {nodes.find((item) => item.id === input.nodeId)?.label ?? input.nodeId}
                <span className="text-muted"> · {payloadLabels[input.kind]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <details className="space-y-3">
        <summary className="cursor-pointer text-sm text-muted">高级参数</summary>
        <label className="co-field">
          工具参数（JSON）
          <Textarea
            rows={6}
            value={parameters}
            aria-invalid={Boolean(parameterError)}
            onChange={(event) => {
              setParameters(event.target.value);
              setParameterError('');
            }}
          />
        </label>
        <Button
          size="sm"
          onClick={() => {
            try {
              const parsed: unknown = JSON.parse(parameters);
              if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
                throw new Error('参数必须是 JSON 对象');
              config({ parameters: parsed as Record<string, unknown> });
              setParameterError('');
            } catch (error) {
              setParameterError(error instanceof Error ? error.message : '参数格式无效');
            }
          }}
        >
          应用参数
        </Button>
        {parameterError && <Alert variant="danger">{parameterError}</Alert>}
        <p className="text-xs text-muted">参数不能扩大岗位工具权限或任务额度。</p>
      </details>
    </section>
  );
}
