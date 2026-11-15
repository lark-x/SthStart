import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, describe, it } from 'node:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  WorldActor,
  WorldAuthoringDraft,
  WorldLocation,
  WorldSuggestionCandidate,
} from '@sthstart/contracts';
import { renderWithUi } from '../../../lib/render-with-ui-test';
import {
  WorldAiPanelView,
  confirmationFor,
  reviewWorldAiCandidates,
  toggleWorldAiSelection,
  useWorldAiPanelController,
  type WorldAiPanelController,
  type WorldAiPersistedState,
  type WorldAiReview,
  type WorldAiRun,
  type WorldAiScope,
} from './world-ai-panel';
import { candidateBefore, draftFingerprint } from './model';

function location(id: string, name: string): WorldLocation {
  return { id, name, description: '' };
}

function actor(id: string, name: string, locationId: string): WorldActor {
  return {
    id,
    name,
    role: 'main',
    characterId: null,
    characterVersion: null,
    background: '',
    personality: '',
    speechStyle: '',
    appearance: '',
    goals: [],
    locationId,
    referenceArtifactIds: [],
  };
}

function draft(): WorldAuthoringDraft {
  return {
    definition: {
      title: '旧世界',
      summary: '旧简介',
      timeLabel: '故事时间',
      locations: [location('loc-harbor', '旧码头')],
      visualReferences: [],
      actors: [actor('actor-lin', '林', 'loc-harbor')],
      sources: [{
        id: 'source-canon',
        title: '原作资料',
        nature: 'canon',
        content: '原文',
        sourceUrl: '',
        sourceVersion: '1',
        capturedAt: '2026-11-01T00:00:00.000Z',
      }],
      lockedFacts: ['既有事实'],
      models: { action: null, adjudication: null, narration: null },
      visualStyle: '动画风格',
    },
    initialBranch: { title: '主线', mode: 'canon-gap', direction: '旧方向' },
  };
}

function titleCandidate(id = 'cand-title'): WorldSuggestionCandidate {
  return {
    id,
    target: 'title',
    value: '新世界',
    sourceIds: ['source-canon'],
    dependsOn: [],
    note: '依据原作标题风格。',
  };
}

function locationCandidate(id = 'cand-loc', locationId = 'loc-reef'): WorldSuggestionCandidate {
  return {
    id,
    target: 'location',
    value: location(locationId, '礁石滩'),
    sourceIds: ['source-canon'],
    dependsOn: [],
    note: '新增开场地点。',
  };
}

function actorCandidate(
  id = 'cand-actor',
  actorLocationId = 'loc-reef',
  dependsOn: string[] = [],
): WorldSuggestionCandidate {
  return {
    id,
    target: 'actor',
    value: actor(`actor-${id}`, '新人物', actorLocationId),
    sourceIds: ['source-canon'],
    dependsOn,
    note: '补充人物。',
  };
}

function review(
  candidates: WorldSuggestionCandidate[],
  options: {
    selected?: string[];
    confirmations?: ReturnType<typeof confirmationFor>[];
    baseDraft?: WorldAuthoringDraft | null;
    current?: WorldAuthoringDraft;
    responseFingerprint?: string;
    currentFingerprint?: string;
  } = {},
): WorldAiReview {
  const current = options.current ?? draft();
  return reviewWorldAiCandidates({
    draft: current,
    candidates,
    selectedIds: options.selected ?? [],
    confirmations: options.confirmations ?? [],
    baseDraft: options.baseDraft ?? null,
    responseFingerprint: options.responseFingerprint ?? 'fp-1',
    currentFingerprint: options.currentFingerprint ?? 'fp-1',
  });
}

test('AI panel defaults to no selection and blocks applying nothing', () => {
  const result = review([titleCandidate()]);
  assert.equal(result.selectedCount, 0);
  assert.equal(result.canApply, false);
  assert.match(result.blockers.join('\n'), /至少勾选一个候选/);
});

test('AI panel blocks a selected candidate whose candidate dependency is not selected', () => {
  const result = review([locationCandidate(), actorCandidate('cand-actor', 'loc-reef', ['cand-loc'])], {
    selected: ['cand-actor'],
  });
  assert.equal(result.canApply, false);
  assert.match(result.blockers.join('\n'), /依赖「地点·礁石滩」/);
  assert.equal(result.items[1].dependencies[0].selected, false);
});

test('AI panel blocks an unknown dependency instead of silently ignoring it', () => {
  const result = review([actorCandidate('cand-actor', 'loc-harbor', ['cand-missing'])], {
    selected: ['cand-actor'],
  });
  assert.equal(result.canApply, false);
  assert.match(result.blockers.join('\n'), /草稿和本次候选里都没有这个对象/);
});

test('AI panel never falls back when an actor location is missing', () => {
  const result = review([actorCandidate('cand-actor', 'loc-nowhere')], { selected: ['cand-actor'] });
  assert.equal(result.canApply, false);
  assert.match(result.blockers.join('\n'), /不在草稿或已选地点中，不能回退到其他地点/);
  assert.ok(result.items[0].missingLocation);

  const withLocation = review(
    [locationCandidate('cand-loc', 'loc-nowhere'), actorCandidate('cand-actor', 'loc-nowhere', ['cand-loc'])],
    { selected: ['cand-loc', 'cand-actor'] },
  );
  assert.equal(withLocation.canApply, true, withLocation.blockers.join('\n'));
  assert.equal(withLocation.items[1].missingLocation, null);
});

test('AI panel flags a response built from an older draft as stale', () => {
  const result = review([titleCandidate()], {
    selected: ['cand-title'],
    responseFingerprint: 'fp-old',
    currentFingerprint: 'fp-new',
  });
  assert.equal(result.stale, true);
  assert.equal(result.canApply, true);
});

test('AI panel requires per-item confirmation only for targets edited after the request', () => {
  const base = draft();
  const current = draft();
  current.definition.summary = '请求后改过的简介';
  const candidates: WorldSuggestionCandidate[] = [
    titleCandidate(),
    {
      id: 'cand-summary',
      target: 'summary',
      value: '新简介',
      sourceIds: [],
      dependsOn: [],
      note: '',
    },
  ];

  const pending = review(candidates, {
    selected: ['cand-title', 'cand-summary'],
    baseDraft: base,
    current,
  });
  assert.equal(pending.items[0].needsConfirmation, false);
  assert.equal(pending.items[1].needsConfirmation, true);
  assert.equal(pending.canApply, false);
  assert.match(pending.blockers.join('\n'), /「世界简介」在请求后已被修改/);

  const confirmed = review(candidates, {
    selected: ['cand-title', 'cand-summary'],
    confirmations: [confirmationFor(current, candidates[1])],
    baseDraft: base,
    current,
  });
  assert.equal(confirmed.canApply, true, confirmed.blockers.join('\n'));
});

test('AI panel re-blocks a confirmed field once it is edited again', () => {
  const base = draft();
  const firstEdit = draft();
  firstEdit.definition.summary = '第一次改过的简介';
  const candidate: WorldSuggestionCandidate = {
    id: 'cand-summary',
    target: 'summary',
    value: '新简介',
    sourceIds: [],
    dependsOn: [],
    note: '',
  };
  const confirmation = confirmationFor(firstEdit, candidate);

  const confirmed = review([candidate], {
    selected: ['cand-summary'],
    confirmations: [confirmation],
    baseDraft: base,
    current: firstEdit,
  });
  assert.equal(confirmed.items[0].confirmed, true);
  assert.equal(confirmed.canApply, true, confirmed.blockers.join('\n'));

  const secondEdit = draft();
  secondEdit.definition.summary = '确认后又改的简介';
  const afterSecondEdit = review([candidate], {
    selected: ['cand-summary'],
    confirmations: [confirmation],
    baseDraft: base,
    current: secondEdit,
  });
  assert.equal(afterSecondEdit.items[0].confirmed, false);
  assert.equal(afterSecondEdit.canApply, false);
  assert.match(afterSecondEdit.blockers.join('\n'), /在请求后已被修改/);
});

test('AI panel invalidates a confirmation when the same source id changes content', () => {
  const base = draft();
  const candidate = { ...titleCandidate(), sourceIds: ['source-canon'] };
  const confirmation = confirmationFor(base, candidate);
  assert.equal(review([candidate], {
    selected: ['cand-title'],
    confirmations: [confirmation],
    baseDraft: base,
    current: base,
  }).canApply, true);

  const editedSource = draft();
  editedSource.definition.sources[0] = {
    ...editedSource.definition.sources[0],
    content: '原文已更新为新版正文。',
  };
  const result = review([candidate], {
    selected: ['cand-title'],
    confirmations: [confirmation],
    baseDraft: base,
    current: editedSource,
  });
  assert.equal(result.items[0].sourcesChanged, true);
  assert.equal(result.items[0].sources[0].changedSinceRequest, true);
  assert.equal(result.items[0].confirmed, false);
  assert.equal(result.canApply, false);
  assert.match(result.blockers.join('\n'), /引用的来源内容在请求后已变化/);

  const reConfirmed = review([candidate], {
    selected: ['cand-title'],
    confirmations: [confirmationFor(editedSource, candidate)],
    baseDraft: base,
    current: editedSource,
  });
  assert.equal(reConfirmed.canApply, true, reConfirmed.blockers.join('\n'));
});

test('AI panel reports when a candidate would not change the draft', () => {
  const unchanged: WorldSuggestionCandidate = {
    id: 'cand-same',
    target: 'summary',
    value: '旧简介',
    sourceIds: [],
    dependsOn: [],
    note: '',
  };
  const result = review([unchanged], { selected: ['cand-same'] });
  assert.equal(result.items[0].changesDraft, false);
  assert.equal(result.canApply, true);
});

test('AI panel marks sources that no longer exist in the draft', () => {
  const candidate = { ...titleCandidate(), sourceIds: ['source-gone'] };
  const result = review([candidate], { selected: ['cand-title'] });
  assert.equal(result.items[0].sources[0].missing, true);
  assert.equal(result.canApply, false);
  assert.match(result.blockers.join('\n'), /已不存在的来源/);
});

test('AI panel shows dependency, source, note and before/after text', () => {
  const current = draft();
  const candidates = [locationCandidate(), actorCandidate('cand-actor', 'loc-reef', ['cand-loc'])];
  const result = review(candidates, { selected: ['cand-loc', 'cand-actor'] });
  const html = renderWithUi(
    <WorldAiPanelView
      scope="actors"
      instruction="补充人物"
      onScopeChange={() => {}}
      onInstructionChange={() => {}}
      onSubmit={() => {}}
      loading={false}
      formError={null}
      requestError={null}
      canRetry={false}
      onRetry={() => {}}
      run={{
        scope: 'actors',
        instruction: '补充人物',
        baseDraft: current,
        response: {
          draftFingerprint: draftFingerprint(current),
          candidates,
          gaps: ['原作没有写明礁石滩的潮汐规律。'],
        },
      } satisfies WorldAiRun}
      review={result}
      autoDependencyIds={['cand-loc']}
      manualIds={['cand-loc', 'cand-actor']}
      dependencyNotice={null}
      actionError={null}
      appliedCount={null}
      onToggle={() => {}}
      onConfirm={() => {}}
      onApply={() => {}}
      onUndo={() => {}}
      canUndo={false}
    />,
  );

  assert.match(html, /AI 候选/);
  assert.match(html, /候选默认都不选中/);
  assert.match(html, /已自动勾选依赖/);
  assert.match(html, /地点·礁石滩/);
  assert.match(html, /人物·新人物/);
  assert.match(html, /原作资料/);
  assert.match(html, /新增开场地点。/);
  assert.match(html, /资料缺口/);
  assert.match(html, /原作没有写明礁石滩的潮汐规律/);
  assert.match(html, /采纳所选/);
  assert.match(html, /disabled/);
});

test('AI panel keeps old candidates visible when a request fails', () => {
  const current = draft();
  const result = review([titleCandidate()]);
  const html = renderWithUi(
    <WorldAiPanelView
      scope="world"
      instruction="改标题"
      onScopeChange={() => {}}
      onInstructionChange={() => {}}
      onSubmit={() => {}}
      loading={false}
      formError={null}
      requestError="模型调用失败：请求超时。"
      canRetry
      onRetry={() => {}}
      run={{
        scope: 'world',
        instruction: '改标题',
        baseDraft: current,
        response: { draftFingerprint: draftFingerprint(current), candidates: [titleCandidate()], gaps: [] },
      }}
      review={result}
      autoDependencyIds={[]}
      manualIds={[]}
      dependencyNotice={null}
      actionError={null}
      appliedCount={null}
      onToggle={() => {}}
      onConfirm={() => {}}
      onApply={() => {}}
      onUndo={() => {}}
      canUndo
    />,
  );
  assert.match(html, /候选生成失败/);
  assert.match(html, /上一批候选会保留/);
  assert.match(html, /重新生成/);
  assert.match(html, /世界名称/);
});

test('AI panel explains cancelled dependencies and stale drafts', () => {
  const current = draft();
  const result = review([titleCandidate()], {
    selected: ['cand-title'],
    responseFingerprint: 'fp-old',
    currentFingerprint: 'fp-new',
  });
  const html = renderWithUi(
    <WorldAiPanelView
      scope="world"
      instruction="改标题"
      onScopeChange={() => {}}
      onInstructionChange={() => {}}
      onSubmit={() => {}}
      loading={false}
      formError={null}
      requestError={null}
      canRetry={false}
      onRetry={() => {}}
      run={{
        scope: 'world',
        instruction: '改标题',
        baseDraft: current,
        response: { draftFingerprint: 'fp-old', candidates: [titleCandidate()], gaps: [] },
      }}
      review={result}
      staleNotice="候选基于草稿 A，当前已是草稿 B。"
      autoDependencyIds={[]}
      manualIds={[]}
      dependencyNotice="已取消「地点·礁石滩」；「人物·新人物」仍依赖它，采纳已被阻止。"
      actionError={null}
      appliedCount={null}
      onToggle={() => {}}
      onConfirm={() => {}}
      onApply={() => {}}
      onUndo={() => {}}
      canUndo
    />,
  );
  assert.match(html, /候选基于旧草稿/);
  assert.match(html, /逐项勾选“已核对”/);
  assert.match(html, /草稿已更新/);
  assert.match(html, /候选基于草稿 A/);
  assert.match(html, /依赖已调整/);
  assert.match(html, /采纳已被阻止/);
});

test('candidateBefore summarises actors and locations without inventing values', () => {
  const current = draft();
  assert.match(candidateBefore(current, actorCandidate('cand-actor', 'loc-harbor')), /新增人物/);
  assert.match(candidateBefore(current, locationCandidate()), /新增地点/);
  assert.match(candidateBefore(current, titleCandidate()), /旧世界/);
  assert.match(
    candidateBefore(current, { ...titleCandidate(), target: 'direction', value: '新方向' }),
    /旧方向/,
  );
});

test('ticking a candidate auto-selects its dependency chain and reports what was added', () => {
  const candidates = [
    locationCandidate('cand-loc'),
    actorCandidate('cand-actor', 'loc-reef', ['cand-loc']),
  ];
  const result = toggleWorldAiSelection(candidates, [], [], candidates[1], true);
  assert.deepEqual(result.selectedIds.sort(), ['cand-actor', 'cand-loc']);
  assert.deepEqual(result.manualIds, ['cand-actor']);
  assert.deepEqual(result.autoAddedIds, ['cand-loc']);
  assert.deepEqual(result.blockedDependents, []);
});

test('unticking a dependency keeps dependents selected and names them as blockers', () => {
  const candidates = [
    locationCandidate('cand-loc'),
    actorCandidate('cand-actor', 'loc-reef', ['cand-loc']),
  ];
  const result = toggleWorldAiSelection(
    candidates,
    ['cand-loc', 'cand-actor'],
    [],
    candidates[0],
    false,
  );
  assert.deepEqual(result.selectedIds, ['cand-actor']);
  assert.deepEqual(result.blockedDependents, ['cand-actor']);
  assert.equal(review(candidates, { selected: result.selectedIds }).canApply, false);
});

test('unticking the main candidate also drops dependencies that were only auto-added', () => {
  const candidates = [
    locationCandidate('cand-loc'),
    actorCandidate('cand-actor', 'loc-reef', ['cand-loc']),
  ];
  const ticked = toggleWorldAiSelection(candidates, [], [], candidates[1], true);
  const unticked = toggleWorldAiSelection(
    candidates,
    ticked.manualIds,
    ticked.excludedIds,
    candidates[1],
    false,
  );
  assert.deepEqual(unticked.selectedIds, []);
  assert.deepEqual(unticked.autoAddedIds, []);
  assert.deepEqual(unticked.manualIds, []);
  assert.equal(review(candidates, { selected: unticked.selectedIds }).canApply, false);
});

test('a dependency still needed by another manual candidate stays selected', () => {
  const candidates = [
    locationCandidate('cand-loc'),
    actorCandidate('cand-a', 'loc-reef', ['cand-loc']),
    actorCandidate('cand-b', 'loc-reef', ['cand-loc']),
  ];
  const bothTicked = toggleWorldAiSelection(candidates, [], [], candidates[1], true);
  const withSecond = toggleWorldAiSelection(
    candidates,
    bothTicked.manualIds,
    bothTicked.excludedIds,
    candidates[2],
    true,
  );
  const afterDropFirst = toggleWorldAiSelection(
    candidates,
    withSecond.manualIds,
    withSecond.excludedIds,
    candidates[1],
    false,
  );
  assert.deepEqual(afterDropFirst.selectedIds.sort(), ['cand-b', 'cand-loc']);
  assert.deepEqual(afterDropFirst.autoAddedIds, ['cand-loc']);
  assert.equal(review(candidates, { selected: afterDropFirst.selectedIds }).canApply, true);
});

test('a manually ticked dependency is kept after the main candidate is unticked', () => {
  const candidates = [
    locationCandidate('cand-loc'),
    actorCandidate('cand-actor', 'loc-reef', ['cand-loc']),
  ];
  const actorTicked = toggleWorldAiSelection(candidates, [], [], candidates[1], true);
  const locationTicked = toggleWorldAiSelection(
    candidates,
    actorTicked.manualIds,
    actorTicked.excludedIds,
    candidates[0],
    true,
  );
  const afterDropActor = toggleWorldAiSelection(
    candidates,
    locationTicked.manualIds,
    locationTicked.excludedIds,
    candidates[1],
    false,
  );
  assert.deepEqual(afterDropActor.selectedIds, ['cand-loc']);
  assert.deepEqual(afterDropActor.manualIds, ['cand-loc']);
  assert.deepEqual(afterDropActor.autoAddedIds, []);
});

function restoredRun(scope: WorldAiScope = 'actors'): WorldAiRun {
  const current = draft();
  const candidates = [locationCandidate('cand-loc'), actorCandidate('cand-actor', 'loc-reef', ['cand-loc'])];
  return {
    scope,
    instruction: '补充人物',
    baseDraft: current,
    response: { draftFingerprint: draftFingerprint(current), candidates, gaps: ['潮汐规律未知。'] },
  };
}

type ListenerFn = (event: unknown) => void;

class MockStyle {
  [key: string]: unknown;
  setProperty(prop: string, val: string) { this[prop] = val; }
  removeProperty(prop: string) { delete this[prop]; }
}

class MockNode { nodeType = 1; }

class MockElement extends MockNode {
  [key: string]: unknown;
  tagName = 'DIV';
  nodeName = 'DIV';
  style = new MockStyle();
  attributes = new Map<string, string>();
  listeners = new Map<string, Set<ListenerFn>>();
  setAttribute(key: string, value: string) { this.attributes.set(key, String(value)); }
  removeAttribute(key: string) { this.attributes.delete(key); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  addEventListener(event: string, fn: ListenerFn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }
  removeEventListener(event: string, fn: ListenerFn) { this.listeners.get(event)?.delete(fn); }
  dispatchEvent(event: { type: string }) { this.listeners.get(event.type)?.forEach((fn) => fn(event)); }
  appendChild() {}
  removeChild() {}
}

class MockHTMLElement extends MockElement {}
class MockHTMLIFrameElement extends MockHTMLElement {}

/** 仓库测试不装 jsdom；这里只提供 createRoot 需要的最小节点环境。 */
function installMinimalDom() {
  const docElement = new MockHTMLElement();
  docElement.tagName = 'HTML';
  docElement.nodeName = 'HTML';
  const listeners = new Map<string, Set<ListenerFn>>();
  const doc = {
    nodeType: 9,
    nodeName: '#document',
    activeElement: null,
    documentElement: docElement,
    defaultView: null as unknown,
    addEventListener(event: string, fn: ListenerFn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    removeEventListener(event: string, fn: ListenerFn) { listeners.get(event)?.delete(fn); },
    createElement(tag: string) {
      const el = new MockHTMLElement();
      el.tagName = tag.toUpperCase();
      el.nodeName = tag.toUpperCase();
      return el;
    },
    createElementNS(_ns: string, tag: string) {
      const el = new MockHTMLElement();
      el.tagName = tag.toUpperCase();
      el.nodeName = tag.toUpperCase();
      return el;
    },
    createTextNode(text: string) {
      const node = new MockNode();
      node.nodeType = 3;
      (node as unknown as { nodeName: string; nodeValue: string }).nodeName = '#text';
      (node as unknown as { nodeName: string; nodeValue: string }).nodeValue = text;
      return node;
    },
  };
  const mockWindow = {
    document: doc,
    HTMLElement: MockHTMLElement,
    Element: MockElement,
    Node: MockNode,
    HTMLIFrameElement: MockHTMLIFrameElement,
    addEventListener(event: string, fn: ListenerFn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    removeEventListener(event: string, fn: ListenerFn) { listeners.get(event)?.delete(fn); },
    dispatchEvent(event: { type: string }) { listeners.get(event.type)?.forEach((fn) => fn(event)); },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  doc.defaultView = mockWindow;

  const scope = globalThis as unknown as Record<string, unknown>;
  scope.window = mockWindow;
  scope.document = doc;
  scope.HTMLElement = MockHTMLElement;
  scope.Element = MockElement;
  scope.Node = MockNode;
  scope.HTMLIFrameElement = MockHTMLIFrameElement;
  scope.IS_REACT_ACT_ENVIRONMENT = true;

  const container = new MockHTMLElement();
  (container as unknown as { ownerDocument: unknown }).ownerDocument = doc;
  return container;
}

describe('WorldAiPanel persisted suggestion state', () => {
  let root: Root | null = null;

  beforeEach(() => {
    const container = installMinimalDom();
    root = createRoot(container as unknown as HTMLElement);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => { root!.unmount(); });
      root = null;
    }
  });

  it('restores the run and its selection from props without ticking anything else', async () => {
    const restored = restoredRun();
    const confirmedCandidate = restored.response.candidates[1];
    let controller: WorldAiPanelController | undefined;
    function Probe() {
      controller = useWorldAiPanelController({
        draft: restored.baseDraft,
        fingerprint: draftFingerprint(restored.baseDraft),
        onApply: () => {},
        initialRun: restored,
        initialSelection: {
          selectedIds: ['cand-loc', 'cand-actor'],
          confirmations: [confirmationFor(restored.baseDraft, confirmedCandidate)],
        },
      });
      return null;
    }

    await act(async () => { root!.render(<Probe />); });
    assert.equal(controller?.run, restored);
    assert.equal(controller?.scope, 'actors');
    assert.equal(controller?.instruction, '补充人物');
    assert.equal(controller?.review.items.length, 2);
    assert.deepEqual(
      controller?.review.selected.map((candidate) => candidate.id).sort(),
      ['cand-actor', 'cand-loc'],
    );
    assert.equal(controller?.review.items[0].candidate.id, 'cand-loc');
    assert.equal(controller?.review.items[0].confirmed, false);
  });

  it('drops a restored confirmation whose field or source no longer matches', async () => {
    const restored = restoredRun();
    const confirmedCandidate = restored.response.candidates[0];
    const staleConfirmation = {
      ...confirmationFor(restored.baseDraft, confirmedCandidate),
      fieldSnapshot: '"旧的字段快照"',
    };
    let controller: WorldAiPanelController | undefined;
    function Probe() {
      controller = useWorldAiPanelController({
        draft: restored.baseDraft,
        fingerprint: draftFingerprint(restored.baseDraft),
        onApply: () => {},
        initialRun: restored,
        initialSelection: {
          selectedIds: ['cand-loc'],
          confirmations: [staleConfirmation],
        },
      });
      return null;
    }
    await act(async () => { root!.render(<Probe />); });
    assert.equal(controller?.review.items[0].confirmed, false);
  });

  it('re-blocks apply when the confirmed field is edited again', async () => {
    const restored = restoredRun();
    const target = restored.response.candidates[0];
    const states: Array<WorldAiPersistedState | null> = [];
    let controller: WorldAiPanelController | undefined;
    function Probe({ current }: { current: WorldAuthoringDraft }) {
      controller = useWorldAiPanelController({
        draft: current,
        fingerprint: draftFingerprint(current),
        onApply: () => {},
        initialRun: restored,
        onStateChange: (state) => states.push(state),
      });
      return null;
    }

    await act(async () => { root!.render(<Probe current={restored.baseDraft} />); });
    await act(async () => {
      controller!.toggle(target, true);
      controller!.confirmCandidate(target, true);
    });
    assert.equal(controller?.review.canApply, true, controller?.review.blockers.join('\n'));

    const edited = structuredClone(restored.baseDraft);
    edited.definition.sources[0] = {
      ...edited.definition.sources[0],
      content: '来源正文在确认后被改写。',
    };
    await act(async () => { root!.render(<Probe current={edited} />); });

    assert.equal(controller?.review.canApply, false);
    assert.equal(controller?.review.items[0].confirmed, false);
    assert.equal(states.at(-1)?.confirmations.length, 0);
  });

  it('notifies the page with the selected ids after ticking a candidate', async () => {
    const restored = restoredRun();
    const states: Array<WorldAiPersistedState | null> = [];
    let controller: WorldAiPanelController | undefined;
    function Probe() {
      controller = useWorldAiPanelController({
        draft: restored.baseDraft,
        fingerprint: draftFingerprint(restored.baseDraft),
        onApply: () => {},
        initialRun: restored,
        onStateChange: (state) => states.push(state),
      });
      return null;
    }

    await act(async () => { root!.render(<Probe />); });
    assert.deepEqual(states.at(-1)?.selectedIds, []);

    const target = restored.response.candidates[0];
    await act(async () => { controller!.toggle(target, true); });

    const last = states.at(-1);
    assert.ok(last?.run, 'run 应随状态一起回传');
    assert.equal(last?.run?.scope, 'actors');
    assert.ok(last?.selectedIds.includes(target.id));
    assert.deepEqual(last?.selectedIds, ['cand-loc']);
  });

  it('keeps a restored run that predates the current draft marked as stale', async () => {
    const restored = restoredRun();
    let controller: WorldAiPanelController | undefined;
    function Probe() {
      controller = useWorldAiPanelController({
        draft: restored.baseDraft,
        fingerprint: 'fp-after-restore-edit',
        onApply: () => {},
        initialRun: restored,
      });
      return null;
    }
    await act(async () => { root!.render(<Probe />); });
    assert.equal(controller?.review.stale, true);
  });

  it('keeps the persisted run JSON-serialisable across a round trip', () => {
    const restored = restoredRun();
    const roundTrip = JSON.parse(JSON.stringify(restored)) as WorldAiRun;
    assert.deepEqual(roundTrip, restored);
    assert.equal(roundTrip.response.candidates.length, 2);
    assert.equal(roundTrip.baseDraft.definition.title, '旧世界');
  });
});
