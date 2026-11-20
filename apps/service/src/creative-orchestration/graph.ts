import { Value } from '@sinclair/typebox/value';
import {
  CreativeWorkflowDocumentSchema,
  type CreativeNode,
  type CreativePayloadKind,
  type CreativeValidation,
  type CreativeWorkflowDocument,
} from '@sthstart/contracts';

type CreativeValidationIssue = CreativeValidation['issues'][number];

type GraphIssueCode =
  | 'graph_type_invalid'
  | 'graph_node_duplicate'
  | 'graph_edge_id_duplicate'
  | 'graph_dependency_duplicate'
  | 'graph_edge_endpoint_missing'
  | 'graph_edge_self'
  | 'graph_input_source_missing'
  | 'graph_input_kind_mismatch'
  | 'graph_input_edge_missing'
  | 'graph_edge_input_missing'
  | 'graph_required_input_missing'
  | 'graph_output_kind_invalid'
  | 'graph_parallel_forwarder_invalid'
  | 'graph_parallel_branch_missing'
  | 'graph_join_output_kind_invalid'
  | 'graph_role_missing'
  | 'graph_tool_missing'
  | 'graph_subworkflow_missing'
  | 'graph_condition_missing'
  | 'graph_condition_branch_missing'
  | 'graph_critical_change_branches_missing'
  | 'graph_direction_gate_missing'
  | 'graph_external_candidate_invalid'
  | 'graph_cycle'
  | 'graph_revision_reviewers_missing'
  | 'graph_revision_reviewer_not_executed'
  | 'graph_revision_budget_invalid'
  | 'graph_revision_target_missing'
  | 'graph_revision_target_invalid'
  | 'graph_approval_missing'
  | 'graph_approval_reviewers_missing'
  | 'graph_approval_candidate_missing'
  | 'graph_approval_review_missing'
  | 'graph_plan_approval_gate_missing'
  | 'graph_direction_gate_binding_missing'
  | 'graph_final_approval_missing'
  | 'graph_story_writer_inputs_missing'
  | 'graph_story_review_inputs_missing'
  | 'graph_illustration_review_inputs_missing'
  | 'graph_adopt_missing'
  | 'graph_terminal_not_adopt'
  | 'graph_approval_bypass';

const issue = (
  code: GraphIssueCode,
  message: string,
  nodeId?: string
): CreativeValidationIssue => ({
  code,
  message,
  ...(nodeId ? { nodeId } : {}),
});

const duplicates = (values: string[]): string[] => {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    else seen.add(value);
  }
  return [...repeated];
};

const pairKey = (source: string, target: string): string => `${source}\u0000${target}`;

const candidateKinds: ReadonlySet<CreativePayloadKind> = new Set([
  'plan',
  'scene',
  'visual-brief',
  'image',
]);

const outputKindByNodeKind: Partial<Record<CreativeNode['kind'], CreativePayloadKind>> = {
  context: 'context',
  condition: 'decision',
  approval: 'decision',
  adopt: 'result',
};

/**
 * Validates the persisted document plus graph-level invariants that TypeBox
 * cannot express. Conditional edges may skip a branch; a join still declares
 * all possible inputs, while runtime decides which conditional artifact exists.
 * Revisions never create structural back edges: config.targetNodeId asks the
 * runtime to replay the target and its downstream review subgraph.
 */
export function validateCreativeGraph(input: unknown): CreativeValidation {
  const issues: CreativeValidationIssue[] = [];
  if (!Value.Check(CreativeWorkflowDocumentSchema, input)) {
    for (const error of Value.Errors(CreativeWorkflowDocumentSchema, input)) {
      issues.push(issue('graph_type_invalid', `${error.path || '/'}: ${error.message}`));
      if (issues.length >= 20) break;
    }
    return { valid: false, issues, order: [] };
  }

  const document = input as CreativeWorkflowDocument;
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, Set<string>>();
  const topologyTargets = new Map<string, string[]>();
  const indegree = new Map(document.nodes.map((node) => [node.id, 0]));
  const edgeByPair = new Map<string, CreativeWorkflowDocument['edges'][number]>();
  const dependencyCount = new Map<string, number>();
  const validEdges: CreativeWorkflowDocument['edges'] = [];

  for (const nodeId of duplicates(document.nodes.map((node) => node.id))) {
    issues.push(issue('graph_node_duplicate', `节点 ID「${nodeId}」重复。`, nodeId));
  }
  for (const edgeId of duplicates(document.edges.map((edge) => edge.id))) {
    issues.push(issue('graph_edge_id_duplicate', `边 ID「${edgeId}」重复。`));
  }

  for (const edge of document.edges) {
    const key = pairKey(edge.source, edge.target);
    dependencyCount.set(key, (dependencyCount.get(key) ?? 0) + 1);
    if (!edgeByPair.has(key)) edgeByPair.set(key, edge);
  }
  for (const [key, count] of dependencyCount) {
    if (count <= 1) continue;
    const [source, target] = key.split('\u0000');
    issues.push(issue(
      'graph_dependency_duplicate',
      `节点 ${source} → ${target} 存在 ${count} 条结构边；每条依赖只能声明一次。`,
      target
    ));
  }

  for (const edge of document.edges) {
    if (edge.source === edge.target) {
      issues.push(issue('graph_edge_self', `边「${edge.id}」不能连接节点自身。`, edge.target));
      continue;
    }
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      issues.push(issue(
        'graph_edge_endpoint_missing',
        `边「${edge.id}」引用了不存在的节点 ${edge.source} → ${edge.target}。`,
        nodes.has(edge.target) ? edge.target : edge.source
      ));
      continue;
    }
    validEdges.push(edge);
    const targets = outgoing.get(edge.source) ?? new Set<string>();
    targets.add(edge.target);
    outgoing.set(edge.source, targets);
    const topoTargets = topologyTargets.get(edge.source) ?? [];
    topoTargets.push(edge.target);
    topologyTargets.set(edge.source, topoTargets);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  for (const node of document.nodes) {
    const inputs = Object.entries(node.inputs);

    if (node.kind === 'context' && inputs.length) {
      issues.push(issue('graph_required_input_missing', '上下文入口不能声明上游输入。', node.id));
    } else if (node.kind === 'parallel' && inputs.length !== 1) {
      issues.push(issue('graph_parallel_forwarder_invalid', '并行转发节点必须且只能声明一个输入。', node.id));
    } else if (node.kind === 'join' && inputs.length < 2) {
      issues.push(issue('graph_required_input_missing', '汇合节点至少需要两个输入。', node.id));
    } else if (node.kind !== 'context' && node.kind !== 'join' && inputs.length === 0) {
      issues.push(issue('graph_required_input_missing', '该节点至少需要一个输入。', node.id));
    }

    const expectedOutputKind = outputKindByNodeKind[node.kind];
    if (expectedOutputKind && node.outputKind !== expectedOutputKind) {
      issues.push(issue(
        'graph_output_kind_invalid',
        `${node.kind} 节点必须输出 ${expectedOutputKind}，当前为 ${node.outputKind}。`,
        node.id
      ));
    }

    const inputKinds = Object.values(node.inputs).map((entry) => entry.kind);
    if (node.kind === 'parallel' && inputKinds.length === 1 && node.outputKind !== inputKinds[0]) {
      issues.push(issue('graph_parallel_forwarder_invalid', '并行转发节点必须原样转发输入类型。', node.id));
    }
    if (node.kind === 'join' && inputKinds.length && !inputKinds.includes(node.outputKind)) {
      issues.push(issue(
        'graph_join_output_kind_invalid',
        '汇合节点的输出类型必须来自它实际汇合的某个输入。',
        node.id
      ));
    }

    if (['agent', 'revision'].includes(node.kind) && !node.roleId) {
      issues.push(issue('graph_role_missing', '该节点必须绑定岗位角色。', node.id));
    }
    if (node.kind === 'tool' && !node.config.tool) {
      issues.push(issue('graph_tool_missing', '工具节点必须声明 config.tool。', node.id));
    }
    if (node.kind === 'subworkflow' && (!node.config.workflowId || !node.config.workflowVersion)) {
      issues.push(issue('graph_subworkflow_missing', '子工作流节点必须声明工作流与版本。', node.id));
    }
    if (node.kind === 'condition' && !node.config.condition) {
      issues.push(issue('graph_condition_missing', '条件节点必须声明 config.condition。', node.id));
    }
    if (node.config.parameters?.externalPrecompleted === true
      && (!['agent', 'tool'].includes(node.kind)
        || !['plan', 'scene', 'visual-brief'].includes(node.outputKind))) {
      issues.push(issue(
        'graph_external_candidate_invalid',
        'externalPrecompleted 只适用于已预生成的 plan、scene 或 visual-brief 候选节点。',
        node.id
      ));
    }
    if (node.kind === 'parallel' && (outgoing.get(node.id)?.size ?? 0) < 2) {
      issues.push(issue('graph_parallel_branch_missing', '并行节点至少需要两个下游分支。', node.id));
    }
    if (node.kind === 'condition' && (outgoing.get(node.id)?.size ?? 0) < 2) {
      issues.push(issue('graph_condition_branch_missing', '条件节点至少需要两个可收敛的分支。', node.id));
    }
    if (node.kind === 'revision') {
      if (!node.config.reviewerRoleIds?.length) {
        issues.push(issue('graph_revision_reviewers_missing', '返修节点必须声明负责复核的岗位。', node.id));
      }
      const executingReviewRoleIds = new Set(
        document.nodes
          .filter((entry) => entry.kind === 'agent' && entry.outputKind === 'review')
          .map((entry) => entry.roleId)
          .filter((roleId): roleId is string => Boolean(roleId))
      );
      const missingExecutors = (node.config.reviewerRoleIds ?? [])
        .filter((roleId) => !executingReviewRoleIds.has(roleId));
      if (missingExecutors.length) {
        issues.push(issue(
          'graph_revision_reviewer_not_executed',
          `返修复核岗位没有实际审核节点：${missingExecutors.join(', ')}。`,
          node.id
        ));
      }
      if (!node.config.maxRevisions || node.config.maxRevisions < 1 || node.config.maxRevisions > 2) {
        issues.push(issue('graph_revision_budget_invalid', '返修节点必须设置 1–2 次有限重试。', node.id));
      }
      if (!node.config.targetNodeId) {
        issues.push(issue('graph_revision_target_missing', '返修节点必须声明重新执行的起点。', node.id));
      } else {
        const target = nodes.get(node.config.targetNodeId);
        if (!target || !['agent', 'tool', 'condition', 'subworkflow'].includes(target.kind)) {
          issues.push(issue(
            'graph_revision_target_invalid',
            `返修起点「${node.config.targetNodeId}」必须是可重新执行的生成或分发节点。`,
            node.id
          ));
        }
      }
    }
    if (node.kind === 'approval') {
      if (!node.config.reviewerRoleIds?.length) {
        issues.push(issue('graph_approval_reviewers_missing', '人工批准节点必须指定审阅岗位。', node.id));
      }
      const hasCandidate = inputs.some(([, input]) => candidateKinds.has(input.kind));
      if (!hasCandidate) {
        issues.push(issue(
          'graph_approval_candidate_missing',
          '批准节点必须绑定可在批准路径上实际存在的候选产物。',
          node.id
        ));
      }
      if (inputKinds.some((kind) => kind === 'scene' || kind === 'image')
        && !inputKinds.includes('review')) {
        issues.push(issue('graph_approval_review_missing', '批准节点必须绑定审核产物。', node.id));
      }
      if (document.purpose === 'story'
        && inputKinds.includes('plan')
        && !inputKinds.includes('scene')
        && !inputKinds.includes('image')
        && node.config.parameters?.directionGate !== true) {
        issues.push(issue(
          'graph_plan_approval_gate_missing',
          'plan-only 审批必须显式声明 directionGate=true，避免绕过最终内容审核。',
          node.id
        ));
      }
      if (node.config.parameters?.directionGate === true) {
        const hasPlan = inputs.some(([, input]) =>
          input.kind === 'plan' && nodes.get(input.nodeId)?.outputKind === 'plan'
        );
        const hasApprovedRoute = inputs.some(([, input]) => {
          const source = nodes.get(input.nodeId);
          const edge = edgeByPair.get(pairKey(input.nodeId, node.id));
          return source?.config.condition === 'critical_change'
            && input.kind === 'decision'
            && edge?.when === 'approved';
        });
        if (!hasPlan || !hasApprovedRoute) {
          issues.push(issue(
            'graph_direction_gate_binding_missing',
            'directionGate 审批必须同时绑定 plan 与 critical_change 的 approved 路由，否则普通支路会误执行。',
            node.id
          ));
        }
      }
    }
    if (document.purpose === 'story' && node.kind === 'agent' && node.outputKind === 'scene') {
      const kinds = new Set(inputKinds);
      if (!kinds.has('context') || !kinds.has('plan')) {
        issues.push(issue(
          'graph_story_writer_inputs_missing',
          '场景主笔必须同时直接读取原始 context 和导演 plan。',
          node.id
        ));
      }
    }
    if (document.purpose === 'story' && node.kind === 'agent' && node.outputKind === 'review'
      && (!inputKinds.includes('scene') || !inputKinds.includes('context'))) {
      issues.push(issue(
        'graph_story_review_inputs_missing',
        '故事审核必须直接读取原始 context 和实际 scene 产物。',
        node.id
      ));
    }
    if (document.purpose === 'illustration' && node.kind === 'agent' && node.outputKind === 'review') {
      const kinds = new Set(inputKinds);
      const missing = ['context', 'image-prompt', 'image'].filter((kind) => !kinds.has(kind as CreativePayloadKind));
      if (missing.length) {
        issues.push(issue(
          'graph_illustration_review_inputs_missing',
          `图片审核必须同时读取原始 brief/context、最终提示词和实际图片；缺少 ${missing.join(', ')}。`,
          node.id
        ));
      }
    }
  }

  for (const condition of document.nodes.filter((node) => node.config.condition === 'critical_change')) {
    const inputKinds = Object.values(condition.inputs).map((entry) => entry.kind);
    const branchKinds = new Set(
      validEdges
        .filter((edge) => edge.source === condition.id)
        .map((edge) => edge.when)
    );
    if (!inputKinds.includes('plan') || !branchKinds.has('approved') || !branchKinds.has('rejected')) {
      issues.push(issue(
        'graph_critical_change_branches_missing',
        'critical_change 必须读取 plan，并声明 approved 与 rejected 两条可收敛分支。',
        condition.id
      ));
    }
  }

  for (const node of document.nodes) {
    const inputs = Object.entries(node.inputs);
    for (const [port, input] of inputs) {
      const source = nodes.get(input.nodeId);
      const pair = pairKey(input.nodeId, node.id);
      if (!source) {
        issues.push(issue(
          'graph_input_source_missing',
          `输入「${port}」引用了不存在的节点「${input.nodeId}」。`,
          node.id
        ));
        continue;
      }
      if (source.outputKind !== input.kind) {
        issues.push(issue(
          'graph_input_kind_mismatch',
          `输入「${port}」需要 ${input.kind}，但节点「${source.id}」输出 ${source.outputKind}。`,
          node.id
        ));
      }
      if (!edgeByPair.has(pair)) {
        issues.push(issue(
          'graph_input_edge_missing',
          `输入「${port}」缺少从「${source.id}」到该节点的边。`,
          node.id
        ));
      }
    }
  }

  for (const edge of validEdges) {
    const target = nodes.get(edge.target);
    if (!target) continue;
    const hasPort = Object.values(target.inputs).some((input) => input.nodeId === edge.source);
    if (!hasPort) {
      issues.push(issue(
        'graph_edge_input_missing',
        `边「${edge.id}」没有对应的目标输入端口。`,
        edge.target
      ));
    }
  }

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([nodeId]) => nodeId)
    .sort();
  const order: string[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    order.push(current);
    for (const target of topologyTargets.get(current) ?? []) {
      const remaining = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, remaining);
      if (remaining === 0) {
        queue.push(target);
        queue.sort();
      }
    }
  }
  if (order.length !== document.nodes.length) {
    const cycleNodes = document.nodes
      .filter((node) => !order.includes(node.id))
      .map((node) => node.id)
      .sort();
    issues.push(issue(
      'graph_cycle',
      `结构边形成循环：${cycleNodes.join(', ')}。返修必须使用有限重试，不能连成结构环。`,
      cycleNodes[0]
    ));
  }

  const approvals = document.nodes.filter((node) => node.kind === 'approval');
  const adopts = document.nodes.filter((node) => node.kind === 'adopt');
  if (!approvals.length) {
    issues.push(issue('graph_approval_missing', '工作流必须包含人工批准节点。'));
  }
  if (!adopts.length) {
    issues.push(issue('graph_adopt_missing', '工作流必须包含服务采用节点。'));
  }
  const hasPlanApproval = approvals.some((node) =>
    node.config.parameters?.directionGate === true
    && Object.values(node.inputs).some((input) =>
      input.kind === 'plan' && nodes.get(input.nodeId)?.outputKind === 'plan'
    )
  );
  const hasCriticalDirectionCondition = document.nodes.some(
    (node) => node.config.condition === 'critical_change'
  );
  const directionApprovals = approvals.filter((node) =>
    node.config.parameters?.directionGate === true
  );
  const storySceneWriters = document.nodes.filter((node) =>
    node.kind === 'agent' && node.outputKind === 'scene'
  );
  const directionReachable = new Set<string>();
  for (const approval of directionApprovals) {
    const queue = [...(outgoing.get(approval.id) ?? [])];
    const visited = new Set<string>();
    while (queue.length) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      directionReachable.add(nodeId);
      queue.push(...(outgoing.get(nodeId) ?? []));
    }
  }
  const reachesSceneWriter = storySceneWriters.some((writer) => directionReachable.has(writer.id));
  if (document.purpose === 'story'
    && (!hasCriticalDirectionCondition || !hasPlanApproval || !directionApprovals.length
      || !reachesSceneWriter)) {
    issues.push(issue(
      'graph_direction_gate_missing',
      '故事工作流必须让 critical_change、directionGate plan 批准和实际场景写入形成可达链路，不能直接采用场景绕过方向确认。'
    ));
  }

  const finalApprovalIds = new Set<string>();
  for (const approval of approvals) {
    const entries = Object.entries(approval.inputs);
    const reviewSources = new Set(entries
      .filter(([, input]) => {
        const edge = edgeByPair.get(pairKey(input.nodeId, approval.id));
        return input.kind === 'review'
          && nodes.get(input.nodeId)?.outputKind === 'review'
          && (!edge?.when || edge.when === 'always' || edge.when === 'approved');
      })
      .map(([, input]) => input.nodeId));
    const candidates = entries.filter(([, input]) => {
      const edge = edgeByPair.get(pairKey(input.nodeId, approval.id));
      return (!edge?.when || edge.when === 'always')
        && ['plan', 'scene', 'image', 'visual-brief'].includes(input.kind);
    });
    const qualifies = candidates.some(([, input]) => {
      const source = nodes.get(input.nodeId);
      const external = source?.config.parameters?.externalPrecompleted === true;
      if (input.kind === 'plan') {
        return external || ['general', 'video-plan', 'research'].includes(document.purpose);
      }
      if (input.kind === 'scene') {
        if (document.purpose === 'story') {
          return reviewSources.size >= 1 && directionReachable.has(input.nodeId);
        }
        if (!external) return false;
        const reviewsReadingCandidate = [...reviewSources].filter((reviewNodeId) =>
          Object.values(nodes.get(reviewNodeId)?.inputs ?? {}).some((reviewInput) =>
            reviewInput.nodeId === input.nodeId && reviewInput.kind === input.kind
          )
        );
        return reviewsReadingCandidate.length >= 2;
      }
      if (input.kind === 'image') {
        if (document.purpose === 'illustration') return reviewSources.size >= 1;
        return external && reviewSources.size >= 1;
      }
      if (input.kind === 'visual-brief') {
        const reviewsReadingCandidate = [...reviewSources].filter((reviewNodeId) =>
          Object.values(nodes.get(reviewNodeId)?.inputs ?? {}).some((reviewInput) =>
            reviewInput.nodeId === input.nodeId && reviewInput.kind === input.kind
          )
        );
        return external && reviewsReadingCandidate.length >= 2;
      }
      return false;
    });
    if (qualifies) finalApprovalIds.add(approval.id);
  }
  if (!finalApprovalIds.size) {
    issues.push(issue(
      'graph_final_approval_missing',
      '最终 plan 方案或 scene/image/visual-brief 内容必须进入实际候选项审批；除方案计划外，内容候选必须绑定有效独立 review。'
    ));
  }
  for (const node of document.nodes) {
    if (
      (outgoing.get(node.id)?.size ?? 0) === 0
      && node.kind !== 'adopt'
      && node.kind !== 'revision'
    ) {
      issues.push(issue('graph_terminal_not_adopt', '所有可见结果都必须汇入服务采用节点。', node.id));
    }
  }
  for (const adopt of adopts) {
    const approvedSources = Object.values(adopt.inputs)
      .filter((input) => input.kind === 'decision')
      .filter((input) => finalApprovalIds.has(input.nodeId))
      .filter((input) => edgeByPair.get(pairKey(input.nodeId, adopt.id))?.when === 'approved');
    if (!approvedSources.length) {
      issues.push(issue(
        'graph_approval_bypass',
        '服务采用节点必须直接接收最终内容 approval 的 approved 决定。',
        adopt.id
      ));
    }
  }

  return { valid: issues.length === 0, issues, order };
}

export const validateCreativeWorkflow = validateCreativeGraph;

export class CreativeGraphValidationError extends Error {
  readonly code = 'creative_graph_invalid';
  readonly validation: CreativeValidation;

  constructor(validation: CreativeValidation) {
    super(validation.issues.map((entry) => `${entry.code}: ${entry.message}`).join('；') || '创作工作流图无效。');
    this.name = 'CreativeGraphValidationError';
    this.validation = validation;
  }
}

export function assertValidCreativeGraph(input: unknown): asserts input is CreativeWorkflowDocument {
  const validation = validateCreativeGraph(input);
  if (!validation.valid) throw new CreativeGraphValidationError(validation);
}

export function isCreativeGraphValid(input: unknown): input is CreativeWorkflowDocument {
  return validateCreativeGraph(input).valid;
}
