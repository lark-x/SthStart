'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Play, Plus, Save, Sparkles, Upload } from 'lucide-react';
import {
  isSystemInternalWorkflowName,
  type CreativeNode,
  type CreativeValidation,
  type CreativeWorkflow,
  type CreativeWorkflowDocument,
  type CreativeWorkflowDryRunResult,
  type CreativeWorkflowNlEditResult,
} from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { Alert } from '@/app/components/ui/alert';
import { Checkbox } from '@/app/components/ui/checkbox';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { Card } from '@/app/components/ui/card';
import { creativeApi } from './api';
import { creativeKeys, useCreativeRoles, useCreativeWorkflows } from './queries';
import { blankWorkflow, connectNodes, nodeLabels, payloadLabels, removeEdges, removeNodes, replaceNode } from './workflow-model';
import { filterUserWorkflows, layoutWorkflowDocument } from './workflow-layout';
import { WorkflowCanvas } from './workflow-canvas';
import { NodeSettings } from './node-settings';
import '@xyflow/react/dist/style.css';

const purposeLabels = {
  story: '故事推演',
  illustration: '插图制作',
  research: '资料研究',
  general: '通用创作',
  'video-plan': '视频方案',
};

export function WorkflowEditor() {
  const workflows = useCreativeWorkflows();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [includeSystem, setIncludeSystem] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const client = useQueryClient();

  const visibleWorkflows = useMemo(
    () =>
      filterUserWorkflows(workflows.data?.items ?? [], {
        includeSystem:
          includeSystem ||
          Boolean(
            selectedId &&
              workflows.data?.items.some(
                (item) => item.id === selectedId && isSystemInternalWorkflowName(item.document.name),
              ),
          ),
      }),
    [workflows.data?.items, includeSystem, selectedId],
  );

  const selected =
    workflows.data?.items.find((item) => item.id === selectedId) ?? visibleWorkflows[0];

  const create = async (document: CreativeWorkflowDocument) => {
    setCreating(true);
    setCreateError('');
    try {
      const saved = await creativeApi.createWorkflow(layoutWorkflowDocument(document));
      await client.invalidateQueries({ queryKey: creativeKeys.workflows });
      setSelectedId(saved.id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : '创建流程失败');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-end gap-3">
        <label className="co-field min-w-0 flex-1">
          创作流程
          <Select
            value={selected?.id ?? ''}
            disabled={dirty || creating}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {!selected && <option value="">选择流程</option>}
            {visibleWorkflows.map((item) => (
              <option key={item.id} value={item.id}>
                {item.document.name}
                {isSystemInternalWorkflowName(item.document.name) ? '（系统托管）' : ''}
              </option>
            ))}
          </Select>
        </label>
        <Button disabled={dirty} loading={creating} onClick={() => void create(blankWorkflow())}>
          <Plus size={16} aria-hidden="true" />
          新建流程
        </Button>
        {selected && (
          <Button
            variant="ghost"
            disabled={dirty || creating}
            onClick={() => void create({ ...selected.document, name: `${selected.document.name}（副本）` })}
          >
            复制此流程
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Checkbox
          label="显示系统托管流程（总管对话与外部候选审核）"
          checked={includeSystem}
          disabled={dirty}
          onChange={(event) => setIncludeSystem(event.target.checked)}
        />
        {dirty && <p className="text-sm text-muted">当前有未保存修改。保存或放弃后可切换流程。</p>}
      </div>
      {(workflows.error || createError) && (
        <Alert variant="danger">
          {createError || workflows.error?.message}
          <Button size="sm" variant="ghost" onClick={() => void workflows.refetch()}>
            重新读取
          </Button>
        </Alert>
      )}
      {workflows.isPending ? (
        <p role="status" className="py-8 text-muted">
          正在读取创作流程…
        </p>
      ) : selected ? (
        <WorkflowDraft
          key={selected.id}
          workflow={selected}
          workflows={workflows.data?.items ?? []}
          onDirtyChange={setDirty}
        />
      ) : (
        <Card>
          <p className="text-muted">创建流程，从读取资料开始连接创作、审核和确认节点。</p>
        </Card>
      )}
    </div>
  );
}

function WorkflowDraft({
  workflow,
  workflows,
  onDirtyChange,
}: {
  workflow: CreativeWorkflow;
  workflows: CreativeWorkflow[];
  onDirtyChange: (dirty: boolean) => void;
}) {
  const roles = useCreativeRoles();
  const client = useQueryClient();
  const [document, setDocument] = useState(workflow.document);
  const documentRef = useRef(document);
  const [saved, setSaved] = useState(workflow);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [view, setView] = useState('canvas');
  const [kind, setKind] = useState<CreativeNode['kind']>('agent');
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [validation, setValidation] = useState<CreativeValidation | null>(null);
  const [dryRun, setDryRun] = useState<CreativeWorkflowDryRunResult | null>(null);
  const [nlOpen, setNlOpen] = useState(false);
  const [nlInstruction, setNlInstruction] = useState('');
  const [nlPreview, setNlPreview] = useState<CreativeWorkflowNlEditResult | null>(null);
  const systemManaged = isSystemInternalWorkflowName(workflow.document.name);
  const dirty = JSON.stringify(document) !== JSON.stringify(saved.document);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);

  const update = (next: CreativeWorkflowDocument) => {
    documentRef.current = next;
    setDocument(next);
    setValidation(null);
    setDryRun(null);
    setNotice('');
  };

  const selectedNode = document.nodes.find((node) => node.id === selectedNodeId);

  const run = async (action: 'save' | 'validate' | 'dryRun' | 'publish' | 'nlEdit') => {
    setBusy(action);
    setError('');
    setNotice('');
    const submitted = document;
    try {
      if (action === 'validate') {
        const result = await creativeApi.validateWorkflow(saved.id, submitted);
        if (documentRef.current === submitted) setValidation(result);
      }
      if (action === 'dryRun') {
        const result = await creativeApi.dryRunWorkflow(saved.id, submitted);
        if (documentRef.current === submitted) {
          setDryRun(result);
          setValidation(result.validation);
        }
      }
      if (action === 'nlEdit') {
        const result = await creativeApi.nlEditWorkflow(saved.id, {
          expectedRevision: saved.revision,
          document: submitted,
          instruction: nlInstruction.trim(),
        });
        setNlPreview(result);
      }
      if (action === 'save') {
        const result = await creativeApi.saveWorkflow(saved.id, saved.revision, submitted);
        setSaved(result);
        if (documentRef.current === submitted) {
          documentRef.current = result.document;
          setDocument(result.document);
          setNotice('流程草稿已保存。');
        } else {
          setNotice('已保存提交时的版本，之后的编辑仍保留为未保存修改。');
        }
        await client.invalidateQueries({ queryKey: creativeKeys.workflows });
      }
      if (action === 'publish') {
        const result = await creativeApi.publishWorkflow(saved.id, saved.revision);
        setNotice(`第 ${result.version} 版已发布，新任务将固定使用该版本。`);
        const latest = await client.fetchQuery({
          queryKey: creativeKeys.workflows,
          queryFn: creativeApi.workflows,
          staleTime: 0,
        });
        const current = latest.items.find((item) => item.id === saved.id);
        if (current) {
          setSaved(current);
          if (documentRef.current === submitted) {
            documentRef.current = current.document;
            setDocument(current.document);
          }
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试');
    } finally {
      setBusy('');
    }
  };

  const addNode = () => {
    const id = `node_${crypto.randomUUID().replaceAll('-', '')}`;
    const outputKind =
      kind === 'context'
        ? 'context'
        : kind === 'agent'
          ? 'scene'
          : ['approval', 'condition'].includes(kind)
            ? 'decision'
            : 'result';
    update({
      ...document,
      nodes: [
        ...document.nodes,
        {
          id,
          kind,
          label: nodeLabels[kind],
          outputKind,
          inputs: {},
          config: kind === 'revision' ? { maxRevisions: 2 } : {},
          position: {
            x: 48 + (document.nodes.length % 5) * 320,
            y: 120 + Math.floor(document.nodes.length / 5) * 160,
          },
        },
      ],
    });
    setSelectedNodeId(id);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="co-field min-w-48 flex-1">
          流程名称
          <Input
            value={document.name}
            required
            maxLength={160}
            onChange={(event) => update({ ...document, name: event.target.value })}
          />
        </label>
        <label className="co-field w-40">
          用途
          <Select
            value={document.purpose}
            onChange={(event) =>
              update({ ...document, purpose: event.target.value as CreativeWorkflowDocument['purpose'] })
            }
          >
            {Object.entries(purposeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <details className="pb-1.5">
          <summary className="cursor-pointer text-xs text-muted">流程说明与加节点</summary>
          <div className="mt-2 flex flex-wrap items-end gap-3 rounded-control bg-surface-sunken p-3">
            <label className="co-field min-w-56 flex-1">
              说明
              <Textarea
                rows={2}
                value={document.description}
                onChange={(event) => update({ ...document, description: event.target.value })}
                maxLength={4000}
              />
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <label className="co-field w-40">
                添加节点
                <Select value={kind} onChange={(event) => setKind(event.target.value as CreativeNode['kind'])}>
                  {Object.entries(nodeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
              <Button size="sm" onClick={addNode} disabled={document.nodes.length >= 100}>
                <Plus size={15} aria-hidden="true" />
                添加节点
              </Button>
            </div>
          </div>
        </details>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTabs
          variant="local"
          ariaLabel="流程编辑方式"
          value={view}
          onChange={setView}
          tabs={[
            { id: 'canvas', label: '可视画布' },
            { id: 'list', label: '节点列表' },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">
            {dirty ? '未保存' : '已保存'} ·{' '}
            {workflow.publishedVersion ? `已发布 ${workflow.publishedVersion} 版` : '尚未发布'}
          </span>
          {!systemManaged && (
            <Button
              size="sm"
              variant={nlOpen ? 'secondary' : 'ghost'}
              disabled={Boolean(busy)}
              onClick={() => setNlOpen((prev) => !prev)}
            >
              <Sparkles size={15} aria-hidden="true" />
              AI 改流程
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void run('validate')}>
            <Check size={15} aria-hidden="true" />
            验证
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={busy === 'dryRun'}
            disabled={Boolean(busy)}
            onClick={() => void run('dryRun')}
          >
            <Play size={15} aria-hidden="true" />
            模拟试跑
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={busy === 'save'}
            disabled={!dirty || Boolean(busy)}
            onClick={() => void run('save')}
          >
            <Save size={15} aria-hidden="true" />
            保存草稿
          </Button>
          <Button size="sm" disabled={dirty || Boolean(busy)} onClick={() => void run('publish')}>
            <Upload size={15} aria-hidden="true" />
            发布版本
          </Button>
          {dirty && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                update(workflow.document);
                setSaved(workflow);
              }}
            >
              放弃修改
            </Button>
          )}
        </div>
      </div>

      {nlOpen && (
        <Card variant="sunken" className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="co-field min-w-0 flex-1">
              用自然语言描述对当前草稿的修改
              <Input
                value={nlInstruction}
                disabled={Boolean(busy)}
                placeholder="例如：在场景审核前增加一个考据专员核查步骤，最多返修 2 轮"
                onChange={(event) => setNlInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.nativeEvent.isComposing &&
                    event.keyCode !== 229 &&
                    nlInstruction.trim()
                  ) {
                    event.preventDefault();
                    void run('nlEdit');
                  }
                }}
              />
            </label>
            <Button
              variant="primary"
              loading={busy === 'nlEdit'}
              disabled={!nlInstruction.trim() || Boolean(busy)}
              onClick={() => void run('nlEdit')}
            >
              生成修改方案
            </Button>
          </div>
          {nlPreview && (
            <div className="space-y-2 rounded-control bg-surface p-3 text-sm">
              <p className="font-medium">{nlPreview.summary}</p>
              {nlPreview.changes.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-muted space-y-1">
                  {nlPreview.changes.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              )}
              {!nlPreview.validation.valid && (
                <Alert variant="warning">
                  生成的流程仍有 {nlPreview.validation.issues.length} 个结构问题，应用后可在画布继续调整。
                </Alert>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    update(layoutWorkflowDocument(nlPreview.document));
                    setValidation(nlPreview.validation);
                    setNlPreview(null);
                    setNlInstruction('');
                    setNotice('已将 AI 修改应用到当前草稿；确认无误后请保存草稿。');
                  }}
                >
                  应用到当前草稿
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNlPreview(null)}>
                  放弃方案
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {error && <Alert variant="danger">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
      {workflow.revision > saved.revision && (
        <Alert variant="warning">
          服务器已有更新。当前草稿仍保留，保存时将检查版本；放弃修改可加载最新内容。
          {!dirty && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                update(workflow.document);
                setSaved(workflow);
              }}
            >
              加载最新草稿
            </Button>
          )}
        </Alert>
      )}
      {dryRun && (
        <Alert
          variant={dryRun.ready ? 'success' : 'warning'}
          title={
            dryRun.ready
              ? `试跑就绪：共 ${dryRun.stages.length} 个执行阶段`
              : `试跑发现 ${dryRun.blockers.length} 项待准备条件`
          }
        >
          <div className="space-y-2 text-sm">
            <p>
              预估单次运行：{dryRun.estimatedCalls.minTextCalls}–{dryRun.estimatedCalls.maxTextCalls} 次模型调用 ·{' '}
              {dryRun.estimatedCalls.minImages}–{dryRun.estimatedCalls.maxImages} 张图片 · 约{' '}
              {dryRun.estimatedCalls.estimatedMinTokens.toLocaleString()}–
              {dryRun.estimatedCalls.estimatedMaxTokens.toLocaleString()} tokens（零付费试跑校验）
            </p>
            {dryRun.branches.length > 0 && (
              <p className="text-xs text-muted">条件分支：{dryRun.branches.join('；')}</p>
            )}
            {dryRun.blockers.length > 0 && (
              <ul className="list-disc pl-5 text-xs space-y-1">
                {dryRun.blockers.map((blocker, index) => (
                  <li key={index}>{blocker}</li>
                ))}
              </ul>
            )}
          </div>
        </Alert>
      )}
      {validation && !dryRun && (
        <Alert
          variant={validation.valid ? 'success' : 'warning'}
          title={validation.valid ? '流程验证通过' : '请修正以下问题'}
        >
          {validation.issues.length > 0 && (
            <ul className="space-y-1">
              {validation.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="whitespace-normal text-left"
                    onClick={() => issue.nodeId && setSelectedNodeId(issue.nodeId)}
                  >
                    {issue.message}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      <Card className={`co-editor p-0 overflow-hidden ${selectedNode ? 'has-inspector' : 'no-inspector'}`}>
        <div className="co-graph min-w-0">
          {view === 'canvas' ? (
            <WorkflowCanvas
              document={document}
              roles={roles.data?.items ?? []}
              selectedNodeId={selectedNodeId}
              dryRun={dryRun}
              onSelectNode={setSelectedNodeId}
              onChange={update}
            />
          ) : (
            <ol className="divide-y divide-border-subtle">
              {document.nodes.map((node, index) => (
                <li key={node.id}>
                  <Button
                    className="w-full justify-start whitespace-normal rounded-none px-4 py-4 text-left"
                    variant={node.id === selectedNodeId ? 'secondary' : 'ghost'}
                    aria-pressed={node.id === selectedNodeId}
                    onClick={() => setSelectedNodeId(node.id)}
                  >
                    <span className="text-muted">{index + 1}.</span>
                    <span>
                      {node.label}
                      <span className="block text-xs text-muted">
                        {nodeLabels[node.kind]} · {payloadLabels[node.outputKind]}
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <details className="p-4" open={view === 'list'}>
            <summary className="cursor-pointer text-sm font-medium">连接与条件（也可在画布直接点击标签切换）</summary>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="co-field flex-1 min-w-32">
                从节点
                <Select value={source} onChange={(event) => setSource(event.target.value)}>
                  <option value="">选择起点</option>
                  {document.nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="co-field flex-1 min-w-32">
                到节点
                <Select value={target} onChange={(event) => setTarget(event.target.value)}>
                  <option value="">选择终点</option>
                  {document.nodes
                    .filter((node) => node.id !== source)
                    .map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.label}
                      </option>
                    ))}
                </Select>
              </label>
              <Button
                disabled={!source || !target}
                onClick={() => update(connectNodes(document, source, target))}
              >
                连接
              </Button>
            </div>
            <ul className="mt-3 space-y-3">
              {document.edges.map((edge) => (
                <li key={edge.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 break-words">
                    {document.nodes.find((node) => node.id === edge.source)?.label} →{' '}
                    {document.nodes.find((node) => node.id === edge.target)?.label}
                  </span>
                  <Select
                    aria-label="连接条件"
                    className="w-28"
                    value={edge.when ?? 'always'}
                    onChange={(event) =>
                      update({
                        ...document,
                        edges: document.edges.map((item) =>
                          item.id === edge.id
                            ? { ...item, when: event.target.value as typeof edge.when }
                            : item,
                        ),
                      })
                    }
                  >
                    <option value="always">始终</option>
                    <option value="approved">通过</option>
                    <option value="rejected">拒绝</option>
                    <option value="ordinary">普通内容</option>
                    <option value="important">重要内容</option>
                  </Select>
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    onClick={() => update(removeEdges(document, [edge.id]))}
                  >
                    移除
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        </div>
        {selectedNode && (
          <aside className="co-node-settings min-w-0">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2 text-xs text-muted">
              <span>节点属性</span>
              <Button size="sm" variant="ghost" onClick={() => setSelectedNodeId(null)}>
                收起
              </Button>
            </div>
            <NodeSettings
              key={selectedNode.id}
              node={selectedNode}
              nodes={document.nodes}
              roles={roles.data?.items ?? []}
              workflows={workflows}
              onChange={(node) => update(replaceNode(document, node))}
              canRemove={document.nodes.length > 1}
              onRemove={() => {
                update(removeNodes(document, [selectedNode.id]));
                setSelectedNodeId(null);
              }}
            />
          </aside>
        )}
      </Card>
    </div>
  );
}
