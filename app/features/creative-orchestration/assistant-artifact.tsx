import React from 'react';
import type { CreativeMessageResponse, CreativeWorkflowDocument } from '@sthstart/contracts';
import { Card } from '@/app/components/ui/card';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';

type Proposal = NonNullable<CreativeMessageResponse['proposal']>;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const fields: Record<string, string> = {
  name: '名称',
  title: '标题',
  body: '正文',
  workNature: '作品属性',
  background: '背景',
  completed: '配置完成',
  kind: '内容类型',
  instruction: '修改要求',
  groups: '分组',
  tags: '标签',
  interpretation: '演绎说明',
  mode: '故事模式',
  nodes: '流程节点',
  edges: '流程连线',
};
const tools: Record<string, string> = {
  'work.create': '新建作品',
  'world.setup.create': '建立故事资料',
  'story.document.create': '创建正文',
  'story.document.update': '修改正文',
  'workflow.create': '创建流程草稿',
  'workflow.update': '修改流程草稿',
  'character.organization.update': '调整角色整理信息',
  'timeline.branch.create': '建立故事分支',
};
function display(value: unknown): string {
  if (value == null || value === '') return '未设置';
  if (typeof value === 'string')
    return (
      {
        original: '原创',
        canon: '原作',
        derivative: '同人',
        alternate: '平行版本',
        adaptation: '改编',
        'canon-gap': '原作补白',
      }[value] ?? value
    );
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value))
    return (
      value
        .map((item) =>
          typeof item === 'string' ? item : String(record(item).label ?? record(item).name ?? ''),
        )
        .filter(Boolean)
        .join('、') || `${value.length} 项`
    );
  return typeof value === 'number' ? String(value) : '结构化内容，见完整提案';
}
function WorkflowChanges({ document }: { document: Record<string, unknown> }) {
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  const edges = Array.isArray(document.edges) ? document.edges : [];
  return (
    <div className="space-y-2">
      <h4 className="font-medium">修改后的流程：{String(document.name ?? '创作流程')}</h4>
      <p className="text-sm text-muted">
        {nodes.length} 个节点 · {edges.length} 条连接；批准后更新草稿，发布版本仍需单独确认。
      </p>
      <ol className="space-y-2 text-sm">
        {nodes.map((value, index) => {
          const node = record(value);
          return (
            <li key={String(node.id ?? index)}>
              <span className="font-medium">
                {index + 1}. {String(node.label ?? '')}
              </span>
              {typeof record(node.config).instruction === 'string' && (
                <p className="mt-1 whitespace-pre-wrap break-words text-muted">
                  {String(record(node.config).instruction)}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function AssistantArtifact({
  content,
  onPropose,
  currentWorkflow,
}: {
  content: Record<string, unknown>;
  onPropose?: (proposal: Proposal) => void;
  currentWorkflow?: CreativeWorkflowDocument;
}) {
  const preview = record(content.preview);
  const action = record(content.action);
  const args = record(action.args);
  const proposedWorkflow = record(args.document);
  const proposal = record(content.proposal);
  const startable =
    typeof proposal.workflowId === 'string' &&
    typeof proposal.workflowVersion === 'number' &&
    typeof proposal.instruction === 'string';
  const items = Array.isArray(preview.items) ? preview.items : [];
  return (
    <article className="space-y-5">
      <h3 className="text-lg font-semibold">创作总管的建议</h3>
      {typeof content.answer === 'string' && (
        <p className="whitespace-pre-wrap break-words leading-7">{content.answer}</p>
      )}
      {content.executionStatus === 'awaiting_budget_confirmation' && (
        <Alert variant="info">已整理启动方案。检查额度后才会启动后续创作。</Alert>
      )}
      {startable && (
        <Card variant="sunken" className="space-y-3">
          <h4 className="font-medium">待启动的创作任务</h4>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {String(proposal.instruction)}
          </p>
          {onPropose && content.kind === 'assistant-result' && (
            <Button
              variant="primary"
              onClick={() =>
                onPropose({
                  workflowId: String(proposal.workflowId),
                  workflowVersion: Number(proposal.workflowVersion),
                  instruction: String(proposal.instruction),
                  input: record(proposal.input),
                  reason: typeof proposal.reason === 'string' ? proposal.reason : '总管建议的下一步创作',
                })
              }
            >
              检查额度并启动
            </Button>
          )}
          {content.kind !== 'assistant-result' && <p className="text-xs text-muted">先确认本次总管提案，再检查后续任务额度并启动。</p>}
        </Card>
      )}
      {items.map((value, index) => {
        const item = record(value);
        const entity = record(item.entity);
        const changes = Array.isArray(item.changes) ? item.changes : [];
        return (
          <section key={index} className="space-y-3">
            <h4 className="font-semibold">
              {tools[String(item.tool)] ?? '拟执行操作'} · {String(entity.name ?? '')}
            </h4>
            {item.affectsGlobalLibrary === true && (
              <p className="text-sm text-muted">会修改公共资料库中的这个对象。</p>
            )}
            <dl className="space-y-3">
              {changes.map((value, changeIndex) => {
                const change = record(value);
                const field = String(change.field);
                if (field.toLowerCase().includes('hash')) return null;
                return (
                  <div key={changeIndex}>
                    <dt className="text-sm font-medium">{fields[field] ?? field}</dt>
                    <dd className="mt-1 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-control bg-surface-sunken p-3">
                        <span className="text-xs text-muted">修改前</span>
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                          {display(change.before)}
                        </p>
                      </div>
                      <div className="rounded-control bg-surface-sunken p-3">
                        <span className="text-xs text-muted">修改后</span>
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                          {display(change.after)}
                        </p>
                      </div>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}
      {typeof action.tool === 'string' && items.length === 0 && (
        <Alert variant="warning">此提案缺少可审阅的修改预览，请先要求总管重新提供完整预览。</Alert>
      )}
      {['workflow.create', 'workflow.update'].includes(String(action.tool)) && (
        <>
          {currentWorkflow && (
            <p className="text-sm text-muted">
              当前流程：{currentWorkflow.nodes.length} 个节点、{currentWorkflow.edges.length} 条连接。
            </p>
          )}
          <WorkflowChanges document={proposedWorkflow} />
        </>
      )}
      {Array.isArray(preview.issues) && preview.issues.length > 0 && (
        <Alert variant="warning">
          {preview.issues.map((value, index) => (
            <p key={index}>{String(record(value).message ?? '')}</p>
          ))}
        </Alert>
      )}
      {(action.tool || content.kind === 'assistant-proposal') && (
        <details>
          <summary className="cursor-pointer text-xs text-muted">完整提案与版本依据</summary>
          <pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed">
            {JSON.stringify({ action, preview }, null, 2)}
          </pre>
        </details>
      )}
    </article>
  );
}
