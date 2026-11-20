import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CreativeWorkflow } from '@sthstart/contracts';
import { blankWorkflow, connectNodes, removeEdges, removeNodes, replaceNode } from './workflow-model';
import { filterUserWorkflows, layoutWorkflowDocument, projectVisualWorkflow } from './workflow-layout';

function sample() {
  const document = blankWorkflow();
  document.nodes.push({
    id: 'writer',
    kind: 'agent',
    label: '写作',
    outputKind: 'scene',
    inputs: {},
    config: {},
    position: { x: 360, y: 80 },
  });
  document.nodes.push({
    id: 'revision',
    kind: 'revision',
    label: '返修',
    outputKind: 'scene',
    inputs: {},
    config: { targetNodeId: 'writer', maxRevisions: 2 },
    position: { x: 640, y: 80 },
  });
  return document;
}
test('画布连接创建准确类型的输入，拒绝重复和自身连接', () => {
  const document = connectNodes(sample(), 'context', 'writer');
  assert.equal(document.edges.length, 1);
  assert.deepEqual(Object.values(document.nodes[1].inputs), [{ nodeId: 'context', kind: 'context' }]);
  assert.equal(connectNodes(document, 'context', 'writer'), document);
  assert.equal(connectNodes(document, 'writer', 'writer'), document);
});
test('删除连接只移除对应上游的输入', () => {
  const document = connectNodes(connectNodes(sample(), 'context', 'revision'), 'writer', 'revision');
  const result = removeEdges(document, [document.edges[0].id]);
  assert.deepEqual(Object.values(result.nodes[2].inputs), [{ nodeId: 'writer', kind: 'scene' }]);
  assert.equal(result.edges.length, 1);
});
test('删除节点清理入出连线、输入及返修指向', () => {
  const document = connectNodes(connectNodes(sample(), 'context', 'writer'), 'writer', 'revision');
  const result = removeNodes(document, ['writer']);
  assert.equal(result.nodes.length, 2);
  assert.deepEqual(result.edges, []);
  assert.deepEqual(result.nodes[1].inputs, {});
  assert.equal(result.nodes[1].config.targetNodeId, undefined);
  assert.equal(document.nodes.length, 3);
});
test('输出类型变化同步已有消费者输入', () => {
  const document = connectNodes(sample(), 'writer', 'revision');
  const result = replaceNode(document, { ...document.nodes[1], outputKind: 'plan' });
  assert.equal(Object.values(result.nodes[2].inputs)[0].kind, 'plan');
});

test('水平自动排版按拓扑层级从左到右排列节点', () => {
  const document = connectNodes(connectNodes(sample(), 'context', 'writer'), 'writer', 'revision');
  const laid = layoutWorkflowDocument(document);
  const pos = Object.fromEntries(laid.nodes.map((node) => [node.id, node.position]));
  assert.ok(pos.context.x < pos.writer.x);
  assert.ok(pos.writer.x < pos.revision.x);
});

test('工作流筛选默认隐藏系统内部流程并优先排布创作流程', () => {
  const make = (id: string, name: string, purpose: CreativeWorkflow['document']['purpose']): CreativeWorkflow => ({
    id,
    revision: 1,
    publishedVersion: 1,
    createdAt: '2026-11-17T00:00:00.000Z',
    updatedAt: '2026-11-17T00:00:00.000Z',
    document: { ...blankWorkflow(), name, purpose },
  });
  const items = [
    make('sys_ext', '外部视频方案候选审核', 'general'),
    make('sys_mgr', 'AI 创作总管对话', 'general'),
    make('img', '插图生成与审查', 'illustration'),
    make('story', '故事场景创作', 'story'),
  ];
  const visible = filterUserWorkflows(items, { includeSystem: false, publishedOnly: true });
  assert.deepEqual(visible.map((item) => item.id), ['story', 'img']);
  const all = filterUserWorkflows(items, { includeSystem: true });
  assert.equal(all.length, 4);
  assert.equal(all[0].id, 'story');
});

test('简化画布投影折叠技术汇合节点并保留主分支流向', () => {
  const document = blankWorkflow();
  document.nodes.push(
    { id: 'cond', kind: 'condition', label: '判断', outputKind: 'decision', inputs: {}, config: { condition: 'critical_change' }, position: { x: 200, y: 0 } },
    { id: 'join', kind: 'join', label: '汇合', outputKind: 'plan', inputs: {}, config: {}, position: { x: 400, y: 0 } },
    { id: 'writer', kind: 'agent', label: '主笔', outputKind: 'scene', inputs: {}, config: {}, position: { x: 600, y: 0 } },
  );
  document.edges.push(
    { id: 'e1', source: 'context', target: 'cond' },
    { id: 'e2', source: 'cond', target: 'join', when: 'rejected' },
    { id: 'e3', source: 'join', target: 'writer' },
    { id: 'e4', source: 'context', target: 'writer' },
  );
  const simplified = projectVisualWorkflow(document, false);
  assert.equal(simplified.hiddenJoinCount, 1);
  assert.equal(simplified.document.nodes.some((n) => n.id === 'join'), false);
  assert.equal(simplified.document.edges.some((e) => e.source === 'cond' && e.target === 'writer' && e.when === 'rejected'), true);
  assert.equal(simplified.document.edges.some((e) => e.source === 'context' && e.target === 'writer'), false);

  const raw = projectVisualWorkflow(document, true);
  assert.equal(raw.hiddenJoinCount, 0);
  assert.equal(raw.document.nodes.length, 4);
});
