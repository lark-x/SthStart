import {
  isSystemInternalWorkflowName,
  type CreativeWorkflow,
  type CreativeWorkflowDocument,
} from '@sthstart/contracts';

const PURPOSE_PRIORITY: Record<CreativeWorkflowDocument['purpose'], number> = {
  story: 0,
  illustration: 1,
  'video-plan': 2,
  research: 3,
  general: 4,
};

/**
 * Hides internal plumbing workflows (AI manager & external candidate gates)
 * from ordinary user pickers unless explicitly requested, and sorts core
 * creative pipelines first.
 */
export function filterUserWorkflows(
  items: readonly CreativeWorkflow[],
  options: { includeSystem?: boolean; publishedOnly?: boolean } = {},
): CreativeWorkflow[] {
  const { includeSystem = false, publishedOnly = false } = options;
  return items
    .filter((item) => (includeSystem ? true : !isSystemInternalWorkflowName(item.document.name)))
    .filter((item) => (publishedOnly ? item.publishedVersion > 0 : true))
    .slice()
    .sort((left, right) => {
      const leftInternal = isSystemInternalWorkflowName(left.document.name) ? 1 : 0;
      const rightInternal = isSystemInternalWorkflowName(right.document.name) ? 1 : 0;
      if (leftInternal !== rightInternal) return leftInternal - rightInternal;
      const leftRank = PURPOSE_PRIORITY[left.document.purpose] ?? 9;
      const rightRank = PURPOSE_PRIORITY[right.document.purpose] ?? 9;
      if (leftRank !== rightRank) return leftRank - rightRank;
      const storyOrder = (name: string) =>
        name === '故事场景创作' ? 0 : name.startsWith('重要剧情精修') ? 1 : 2;
      const leftStory = storyOrder(left.document.name);
      const rightStory = storyOrder(right.document.name);
      if (leftStory !== rightStory) return leftStory - rightStory;
      return left.document.name.localeCompare(right.document.name, 'zh-CN');
    });
}

/**
 * Produces a clutter-free presentation projection of a workflow DAG by
 * folding technical `join` relays and redundant secondary `context` edges
 * while leaving the underlying executable document untouched.
 */
export function projectVisualWorkflow(
  document: CreativeWorkflowDocument,
  showTechnicalNodes = false,
): { document: CreativeWorkflowDocument; hiddenJoinCount: number } {
  if (showTechnicalNodes) return { document, hiddenJoinCount: 0 };

  const joinIds = new Set(
    document.nodes.filter((node) => node.kind === 'join').map((node) => node.id),
  );
  if (!joinIds.size) {
    return { document, hiddenJoinCount: 0 };
  }

  const rewiredEdges: CreativeWorkflowDocument['edges'] = [];
  const seenEdge = new Set<string>();
  const addEdge = (source: string, target: string, when?: CreativeWorkflowDocument['edges'][number]['when'], id?: string) => {
    if (source === target || joinIds.has(source) || joinIds.has(target)) return;
    const key = `${source}->${target}`;
    if (seenEdge.has(key)) return;
    seenEdge.add(key);
    rewiredEdges.push({
      id: id ?? `vis_${source}_${target}`,
      source,
      target,
      ...(when ? { when } : {}),
    });
  };

  for (const edge of document.edges) {
    if (!joinIds.has(edge.source) && !joinIds.has(edge.target)) {
      addEdge(edge.source, edge.target, edge.when, edge.id);
    }
  }
  for (const joinId of joinIds) {
    const incoming = document.edges.filter((edge) => edge.target === joinId);
    const outgoing = document.edges.filter((edge) => edge.source === joinId);
    for (const inEdge of incoming) {
      if (joinIds.has(inEdge.source)) continue;
      for (const outEdge of outgoing) {
        if (joinIds.has(outEdge.target)) continue;
        // Skip unconditional pass-throughs if a conditional branch already connects the same pair.
        addEdge(inEdge.source, outEdge.target, inEdge.when ?? outEdge.when);
      }
    }
  }

  // Drop redundant background `context -> node` lines when `node` already sits downstream of another visible node.
  const contextIds = new Set(document.nodes.filter((n) => n.kind === 'context').map((n) => n.id));
  const nonContextInbound = new Set(
    rewiredEdges.filter((edge) => !contextIds.has(edge.source)).map((edge) => edge.target),
  );
  const cleanEdges = rewiredEdges.filter(
    (edge) => !(contextIds.has(edge.source) && nonContextInbound.has(edge.target)),
  );
  const visibleNodes = document.nodes.filter((node) => !joinIds.has(node.id));
  const projected = layoutWorkflowDocument({
    ...document,
    nodes: visibleNodes,
    edges: cleanEdges,
  });
  return { document: projected, hiddenJoinCount: joinIds.size };
}

/**
 * Computes a clean left-to-right layered layout for a workflow DAG using
 * longest-path topological depth and barycenter vertical ordering.
 */
export function layoutWorkflowDocument(
  document: CreativeWorkflowDocument,
): CreativeWorkflowDocument {
  if (!document.nodes.length) return document;
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of document.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
  }
  for (const edge of document.edges) {
    if (!incoming.has(edge.target) || !outgoing.has(edge.source) || edge.source === edge.target) {
      continue;
    }
    incoming.get(edge.target)!.push(edge.source);
    outgoing.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const queue = document.nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const topo: string[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    topo.push(current);
    for (const target of outgoing.get(current) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  // Include any remaining nodes (e.g. from incomplete/cyclic user edits) cleanly.
  for (const node of document.nodes) {
    if (!topo.includes(node.id)) topo.push(node.id);
  }

  const layerOf = new Map<string, number>();
  for (const nodeId of topo) {
    const parents = incoming.get(nodeId) ?? [];
    const maxParent = parents.reduce((max, parent) => Math.max(max, layerOf.get(parent) ?? -1), -1);
    layerOf.set(nodeId, maxParent + 1);
  }

  const layers = new Map<number, string[]>();
  for (const nodeId of topo) {
    const layer = layerOf.get(nodeId) ?? 0;
    const list = layers.get(layer) ?? [];
    list.push(nodeId);
    layers.set(layer, list);
  }

  const X_START = 48;
  const X_GAP = 320;
  const Y_CENTER = 220;
  const Y_GAP = 152;
  const positions = new Map<string, { x: number; y: number }>();

  const maxLayer = Math.max(0, ...layers.keys());
  for (let layer = 0; layer <= maxLayer; layer++) {
    const ids = (layers.get(layer) ?? []).slice();
    if (layer > 0) {
      ids.sort((left, right) => {
        const avgY = (id: string) => {
          const parents = (incoming.get(id) ?? []).filter((p) => positions.has(p));
          if (!parents.length) return Y_CENTER;
          return parents.reduce((sum, p) => sum + positions.get(p)!.y, 0) / parents.length;
        };
        return avgY(left) - avgY(right);
      });
    }
    const startY = Y_CENTER - ((ids.length - 1) * Y_GAP) / 2;
    ids.forEach((id, index) => {
      positions.set(id, {
        x: Math.round(X_START + layer * X_GAP),
        y: Math.round(startY + index * Y_GAP),
      });
    });
  }

  return {
    ...document,
    nodes: document.nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
    })),
  };
}
