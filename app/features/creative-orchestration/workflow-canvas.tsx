'use client';

import React, { useMemo, useState } from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  getSmoothStepPath,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  BookOpen,
  CheckCircle2,
  Eye,
  GitBranch,
  GitMerge,
  LayoutGrid,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Split,
  Workflow,
  Wrench,
} from 'lucide-react';
import type {
  CreativeEdge,
  CreativeNode,
  CreativeRole,
  CreativeWorkflowDocument,
  CreativeWorkflowDryRunResult,
} from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { connectNodes, nodeLabels, payloadLabels, removeEdges, replaceNode } from './workflow-model';
import { layoutWorkflowDocument, projectVisualWorkflow } from './workflow-layout';

type CreativeFlowNodeData = {
  node: CreativeNode;
  roleName: string | null;
  roleIssue: string | null;
  stageNumber: number | null;
};

type CreativeFlowEdgeData = {
  when: NonNullable<CreativeEdge['when']>;
  isFeedback?: boolean;
  maxRevisions?: number;
  onCycleCondition?: (edgeId: string) => void;
};

const NODE_META: Record<
  CreativeNode['kind'],
  { tone: string; Icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  context: { tone: 'var(--tone-green, #3f7a5a)', Icon: BookOpen },
  agent: { tone: 'var(--accent, #665995)', Icon: Sparkles },
  tool: { tone: 'var(--tone-blue, #3b6ea5)', Icon: Wrench },
  parallel: { tone: 'var(--muted, #767067)', Icon: Split },
  join: { tone: 'var(--muted, #767067)', Icon: GitMerge },
  condition: { tone: 'var(--tone-orange, #b86e2b)', Icon: GitBranch },
  revision: { tone: 'var(--tone-orange, #b86e2b)', Icon: RotateCcw },
  approval: { tone: 'var(--accent, #665995)', Icon: ShieldCheck },
  adopt: { tone: 'var(--tone-green, #3f7a5a)', Icon: CheckCircle2 },
  subworkflow: { tone: 'var(--tone-blue, #3b6ea5)', Icon: Workflow },
};

const EDGE_LABELS: Record<NonNullable<CreativeEdge['when']>, string> = {
  always: '继续',
  approved: '通过',
  rejected: '拒绝',
  ordinary: '普通',
  important: '重要',
};

const EDGE_TONES: Record<NonNullable<CreativeEdge['when']>, string> = {
  always: 'var(--border-strong, #8f887d)',
  approved: 'var(--tone-green, #3f7a5a)',
  rejected: 'var(--tone-orange, #b86e2b)',
  ordinary: 'var(--muted, #767067)',
  important: 'var(--accent, #665995)',
};

const EDGE_CYCLE: NonNullable<CreativeEdge['when']>[] = [
  'always',
  'approved',
  'rejected',
  'ordinary',
  'important',
];

function CreativeFlowNode({ data, selected }: NodeProps<Node<CreativeFlowNodeData>>) {
  const { node, roleName, roleIssue, stageNumber } = data;
  const meta = NODE_META[node.kind];
  const Icon = meta.Icon;
  const showTarget = node.kind !== 'context';
  const showSource = node.kind !== 'adopt';
  const badgeText =
    roleName ??
    (node.kind === 'tool' && node.config.tool
      ? node.config.tool === 'image_generation'
        ? '工具：生图'
        : '工具：视频分镜校验'
      : node.kind === 'revision'
        ? `最多返修 ${node.config.maxRevisions ?? 2} 轮`
        : node.kind === 'approval'
          ? node.config.parameters?.directionGate === true
            ? '人工门：方向确认'
            : '人工门：最终确认'
          : node.kind === 'condition'
            ? `条件：${node.config.condition ?? '未设'}`
            : null);

  return (
    <div
      className={`co-flow-node ${selected ? 'is-selected' : ''} ${roleIssue ? 'has-issue' : ''}`}
      style={{ '--co-node-tone': meta.tone } as React.CSSProperties}
    >
      {showTarget && <Handle type="target" position={Position.Left} className="co-flow-handle" />}
      <div className="co-flow-node-head">
        <span className="co-flow-node-icon" aria-hidden="true">
          <Icon size={14} />
        </span>
        <span className="co-flow-node-kind">{nodeLabels[node.kind]}</span>
        {stageNumber !== null && <span className="co-flow-node-stage">第 {stageNumber} 步</span>}
      </div>
      <div className="co-flow-node-title">{node.label}</div>
      <div className="co-flow-node-meta">
        <span>输出：{payloadLabels[node.outputKind]}</span>
        {badgeText && <span className="co-flow-node-pill">{badgeText}</span>}
      </div>
      {roleIssue && <div className="co-flow-node-warn">{roleIssue}</div>}
      {showSource && <Handle type="source" position={Position.Right} className="co-flow-handle" />}
    </div>
  );
}

function CreativeFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<Edge<CreativeFlowEdgeData>>) {
  const isFeedback = data?.isFeedback === true;
  const [path, labelX, labelY] = isFeedback
    ? getBezierPath({
        sourceX,
        sourceY: sourceY + 12,
        targetX,
        targetY: targetY + 12,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Bottom,
        curvature: 0.45,
      })
    : getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 12,
      });

  const when = data?.when ?? 'always';
  const stroke = isFeedback
    ? 'var(--tone-orange, #b86e2b)'
    : selected
      ? 'var(--accent, #665995)'
      : EDGE_TONES[when];

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke,
          strokeWidth: selected ? 2.2 : 1.6,
          strokeDasharray: isFeedback ? '5 4' : undefined,
          opacity: isFeedback ? 0.8 : when === 'always' && !selected ? 0.68 : 0.95,
        }}
      />
      {(isFeedback || when !== 'always' || selected) && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className={`co-flow-edge-badge nodrag nopan ${isFeedback ? 'is-feedback' : ''}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              borderColor: stroke,
              color: stroke,
            }}
            disabled={isFeedback}
            title={isFeedback ? '返修触发后会重跑该目标节点及下游审核' : '点击切换连线条件'}
            onClick={(event) => {
              event.stopPropagation();
              if (!isFeedback) data?.onCycleCondition?.(id);
            }}
          >
            {isFeedback ? `返修 ≤ ${data?.maxRevisions ?? 2} 轮` : EDGE_LABELS[when]}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const NODE_TYPES = { creative: CreativeFlowNode };
const EDGE_TYPES = { creative: CreativeFlowEdge };

export function WorkflowCanvas({
  document,
  roles,
  selectedNodeId,
  dryRun,
  onSelectNode,
  onChange,
}: {
  document: CreativeWorkflowDocument;
  roles: CreativeRole[];
  selectedNodeId: string | null;
  dryRun: CreativeWorkflowDryRunResult | null;
  onSelectNode: (id: string) => void;
  onChange: (next: CreativeWorkflowDocument) => void;
}) {
  const [showTechnicalNodes, setShowTechnicalNodes] = useState(false);
  const projected = useMemo(
    () => projectVisualWorkflow(document, showTechnicalNodes),
    [document, showTechnicalNodes],
  );
  const viewDocument = projected.document;
  const hasTechnicalJoins = useMemo(
    () => document.nodes.some((node) => node.kind === 'join'),
    [document.nodes],
  );
  const roleById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);
  const roleCheckById = useMemo(
    () => new Map((dryRun?.roles ?? []).map((entry) => [entry.roleId, entry])),
    [dryRun],
  );
  const stageByNodeId = useMemo(() => {
    const map = new Map<string, number>();
    for (const stage of dryRun?.stages ?? []) {
      for (const nodeId of stage.nodeIds) map.set(nodeId, stage.layer + 1);
    }
    return map;
  }, [dryRun]);

  const nodes: Node<CreativeFlowNodeData>[] = useMemo(
    () =>
      viewDocument.nodes.map((node) => {
        const role = node.roleId ? roleById.get(node.roleId) : undefined;
        const roleCheck = node.roleId ? roleCheckById.get(node.roleId) : undefined;
        return {
          id: node.id,
          type: 'creative',
          position: node.position,
          selected: selectedNodeId === node.id,
          data: {
            node,
            roleName: role ? `${role.name}${role.modelId ? '' : '（未设模型）'}` : null,
            roleIssue: roleCheck && !roleCheck.ready ? roleCheck.issue : null,
            stageNumber: stageByNodeId.get(node.id) ?? null,
          },
        };
      }),
    [viewDocument.nodes, roleById, roleCheckById, selectedNodeId, stageByNodeId],
  );

  const cycleEdgeCondition = (edgeId: string) => {
    onChange({
      ...document,
      edges: document.edges.map((edge) => {
        if (edge.id !== edgeId) return edge;
        const current = edge.when ?? 'always';
        const next = EDGE_CYCLE[(EDGE_CYCLE.indexOf(current) + 1) % EDGE_CYCLE.length];
        return { ...edge, when: next };
      }),
    });
  };

  const edges: Edge<CreativeFlowEdgeData>[] = useMemo(() => {
    const realEdges: Edge<CreativeFlowEdgeData>[] = viewDocument.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'creative',
      data: {
        when: edge.when ?? 'always',
        onCycleCondition: edge.id.startsWith('vis_') ? undefined : cycleEdgeCondition,
      },
    }));
    const feedbackEdges: Edge<CreativeFlowEdgeData>[] = viewDocument.nodes
      .filter(
        (node) =>
          node.kind === 'revision' &&
          node.config.targetNodeId &&
          viewDocument.nodes.some((target) => target.id === node.config.targetNodeId),
      )
      .map((node) => ({
        id: `__feedback_${node.id}_${node.config.targetNodeId}`,
        source: node.id,
        target: node.config.targetNodeId!,
        type: 'creative',
        selectable: false,
        focusable: false,
        data: {
          when: 'rejected',
          isFeedback: true,
          maxRevisions: node.config.maxRevisions ?? 2,
        },
      }));
    return [...realEdges, ...feedbackEdges];
  }, [viewDocument]);

  return (
    <div className="co-canvas relative" aria-label="创作流程画布">
      <div className="co-canvas-floating-bar">
        {hasTechnicalJoins && (
          <Button
            size="sm"
            variant={showTechnicalNodes ? 'primary' : 'secondary'}
            type="button"
            onClick={() => setShowTechnicalNodes((prev) => !prev)}
          >
            <Eye size={14} aria-hidden="true" />
            {showTechnicalNodes ? '收起调度汇合节点' : '显示完整调度节点'}
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          type="button"
          onClick={() => onChange(layoutWorkflowDocument(document))}
        >
          <LayoutGrid size={14} aria-hidden="true" />
          自动整理布局
        </Button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.5}
        deleteKeyCode={null}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onNodeDrag={(_, node) => {
          const original = document.nodes.find((item) => item.id === node.id);
          if (original) onChange(replaceNode(document, { ...original, position: node.position }));
        }}
        onConnect={(connection) => {
          if (connection.source && connection.target) {
            onChange(connectNodes(document, connection.source, connection.target));
          }
        }}
        onEdgesDelete={(deleted) =>
          onChange(
            removeEdges(
              document,
              deleted
                .filter((edge) => !edge.id.startsWith('__feedback_') && !edge.id.startsWith('vis_'))
                .map((edge) => edge.id),
            ),
          )
        }
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
