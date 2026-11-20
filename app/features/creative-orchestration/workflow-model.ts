import type { CreativeNode, CreativeWorkflowDocument, CreativePayloadKind } from '@sthstart/contracts';

export const nodeLabels: Record<CreativeNode['kind'], string> = {
  context: '读取创作资料',
  agent: '岗位创作 / 审核',
  tool: '调用创作工具',
  parallel: '并行分工',
  join: '汇合结果',
  condition: '条件分流',
  revision: '有限返修',
  approval: '人工确认',
  adopt: '正式采用',
  subworkflow: '子流程',
};
export const payloadLabels: Record<CreativePayloadKind, string> = {
  context: '创作资料',
  plan: '创作方案',
  scene: '场景正文',
  review: '审核意见',
  'visual-brief': '视觉任务单',
  'image-prompt': '生图提示词',
  image: '图片',
  decision: '确认决定',
  result: '执行结果',
};
export function blankWorkflow(): CreativeWorkflowDocument {
  return {
    name: '新创作流程',
    description: '',
    purpose: 'general',
    nodes: [
      {
        id: 'context',
        kind: 'context',
        label: '读取创作资料',
        outputKind: 'context',
        inputs: {},
        config: {},
        position: { x: 80, y: 80 },
      },
    ],
    edges: [],
  };
}
export function connectNodes(
  document: CreativeWorkflowDocument,
  sourceId: string,
  targetId: string,
): CreativeWorkflowDocument {
  const source = document.nodes.find((node) => node.id === sourceId);
  const target = document.nodes.find((node) => node.id === targetId);
  if (
    !source ||
    !target ||
    sourceId === targetId ||
    document.edges.some((edge) => edge.source === sourceId && edge.target === targetId)
  )
    return document;
  const keyBase = `from_${sourceId}`;
  let key = keyBase;
  let suffix = 1;
  while (target.inputs[key]) key = `${keyBase}_${suffix++}`;
  return {
    ...document,
    edges: [
      ...document.edges,
      { id: `edge_${sourceId}_${targetId}`, source: sourceId, target: targetId, when: 'always' },
    ],
    nodes: document.nodes.map((node) =>
      node.id === targetId
        ? { ...node, inputs: { ...node.inputs, [key]: { nodeId: sourceId, kind: source.outputKind } } }
        : node,
    ),
  };
}
export function removeEdges(document: CreativeWorkflowDocument, ids: string[]): CreativeWorkflowDocument {
  const removed = document.edges.filter((edge) => ids.includes(edge.id));
  const edges = document.edges.filter((edge) => !ids.includes(edge.id));
  return {
    ...document,
    edges,
    nodes: document.nodes.map((node) => ({
      ...node,
      inputs: Object.fromEntries(
        Object.entries(node.inputs).filter(
          ([, input]) =>
            !removed.some((edge) => edge.source === input.nodeId && edge.target === node.id) ||
            edges.some((edge) => edge.source === input.nodeId && edge.target === node.id),
        ),
      ),
    })),
  };
}
export function removeNodes(document: CreativeWorkflowDocument, ids: string[]): CreativeWorkflowDocument {
  const remaining = removeEdges(
    document,
    document.edges
      .filter((edge) => ids.includes(edge.source) || ids.includes(edge.target))
      .map((edge) => edge.id),
  );
  return {
    ...remaining,
    nodes: remaining.nodes
      .filter((node) => !ids.includes(node.id))
      .map((node) => {
        const config = { ...node.config };
        if (config.targetNodeId && ids.includes(config.targetNodeId)) delete config.targetNodeId;
        return {
          ...node,
          config,
          inputs: Object.fromEntries(
            Object.entries(node.inputs).filter(([, input]) => !ids.includes(input.nodeId)),
          ),
        };
      }),
  };
}
export function replaceNode(
  document: CreativeWorkflowDocument,
  changed: CreativeNode,
): CreativeWorkflowDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === changed.id
        ? changed
        : {
            ...node,
            inputs: Object.fromEntries(
              Object.entries(node.inputs).map(([key, input]) => [
                key,
                input.nodeId === changed.id ? { ...input, kind: changed.outputKind } : input,
              ]),
            ),
          },
    ),
  };
}
