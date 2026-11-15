import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { WorldAuthoringDraft } from '@sthstart/contracts';
import {
  WORLD_AUTHORING_STORAGE_PREFIX,
  createEmptyDraft,
  draftFingerprint,
  parseAuthoringEnvelope,
} from './model';
import { useAuthoringSession, type AuthoringSession } from './use-authoring-session';

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

class MockSessionStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
  get length(): number { return this.store.size; }
}

function sampleDraft(title = '灰烬中的向量'): WorldAuthoringDraft {
  const draft = createEmptyDraft();
  draft.definition.title = title;
  draft.definition.locations = [{ id: 'loc-1', name: '北塔', description: '' }];
  draft.definition.actors = [{
    id: 'actor-1', name: '林', role: 'main', characterId: null, characterVersion: null,
    background: '', personality: '', speechStyle: '', appearance: '', goals: [],
    locationId: 'loc-1', referenceArtifactIds: [],
  }];
  return draft;
}

describe('useAuthoringSession envelope', () => {
  let root: Root | null = null;
  let container: MockHTMLElement | null = null;
  const storage = new MockSessionStorage();

  beforeEach(() => {
    storage.clear();
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
      HTMLIFrameElement: MockHTMLElement,
      sessionStorage: storage,
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
    scope.HTMLIFrameElement = MockHTMLElement;
    scope.sessionStorage = storage;
    scope.IS_REACT_ACT_ENVIRONMENT = true;

    container = new MockHTMLElement();
    (container as unknown as { ownerDocument: unknown }).ownerDocument = doc;
    root = createRoot(container as unknown as HTMLElement);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => { root!.unmount(); });
      root = null;
    }
    storage.clear();
  });

  it('restores a dirty legacy definition and keeps its expected revision', async () => {
    const legacy = sampleDraft('旧世界');
    storage.setItem(
      WORLD_AUTHORING_STORAGE_PREFIX + 'edit:world-1',
      JSON.stringify({ isDirty: true, data: legacy.definition, expectedRevision: 4, updatedAt: 1 }),
    );

    let session: AuthoringSession | undefined;
    function Probe() {
      session = useAuthoringSession({
        worldId: 'world-1',
        branchId: 'branch-1',
        initialValues: sampleDraft('服务器版本'),
        baseRevision: 4,
        branchRevision: 2,
        ready: true,
      });
      return null;
    }

    await act(async () => { root!.render(<Probe />); });
    assert.equal(session?.values.definition.title, '旧世界');
    assert.equal(session?.isDirty, true);
    assert.equal(session?.restoredFromLegacy, true);
    assert.equal(session?.hasConflict, false);
  });

  it('does not let a clean server snapshot overwrite a dirty draft', async () => {
    let session: AuthoringSession | undefined;
    function Probe({ title }: { title: string }) {
      session = useAuthoringSession({
        worldId: 'world-2',
        branchId: 'branch-1',
        initialValues: sampleDraft(title),
        baseRevision: 1,
        branchRevision: 1,
        ready: true,
      });
      return null;
    }

    await act(async () => { root!.render(<Probe title="服务器 v1" />); });
    await act(async () => {
      session!.update((current) => ({
        ...current,
        definition: { ...current.definition, title: '作者改动' },
      }));
    });
    await act(async () => { root!.render(<Probe title="服务器 v2" />); });
    assert.equal(session?.values.definition.title, '作者改动');
    assert.equal(session?.isDirty, true);
  });

  it('marks a conflict when the server revision moves past the captured base', async () => {
    let session: AuthoringSession | undefined;
    function Probe({ revision }: { revision: number }) {
      session = useAuthoringSession({
        worldId: 'world-3',
        branchId: 'branch-1',
        initialValues: sampleDraft(),
        baseRevision: revision,
        branchRevision: 1,
        ready: true,
      });
      return null;
    }
    await act(async () => { root!.render(<Probe revision={2} />); });
    await act(async () => {
      session!.update((current) => ({
        ...current,
        definition: { ...current.definition, summary: '作者输入' },
      }));
    });
    assert.equal(session?.hasConflict, false);
    await act(async () => { root!.render(<Probe revision={5} />); });
    assert.equal(session?.hasConflict, true);
    assert.equal(session?.baseRevision, 2);
  });

  it('rebase keeps author input and only advances the captured revisions', async () => {
    let session: AuthoringSession | undefined;
    function Probe() {
      session = useAuthoringSession({
        worldId: 'world-4',
        branchId: 'branch-1',
        initialValues: sampleDraft(),
        baseRevision: 2,
        branchRevision: 3,
        ready: true,
      });
      return null;
    }
    await act(async () => { root!.render(<Probe />); });
    await act(async () => {
      session!.update((current) => ({
        ...current,
        definition: { ...current.definition, summary: '保留的输入' },
      }));
    });
    await act(async () => { session!.rebaseTo({ baseRevision: 6, branchRevision: 9 }); });
    assert.equal(session?.values.definition.summary, '保留的输入');
    assert.equal(session?.baseRevision, 6);
    assert.equal(session?.branchRevision, 9);
    assert.equal('expectedRevision' in session!.values.definition, false);
  });

  it('rotates the idempotency key when content changed after a failed attempt', async () => {
    let session: AuthoringSession | undefined;
    function Probe() {
      session = useAuthoringSession({
        initialValues: sampleDraft(),
        ready: true,
      });
      return null;
    }
    await act(async () => { root!.render(<Probe />); });
    const firstKey = session!.idempotencyKey;
    let used = '';
    await act(async () => { used = session!.beginCreateAttempt(draftFingerprint(session!.values)); });
    assert.equal(used, firstKey);

    // 内容未变：重试必须复用同一个键。
    let reused = '';
    await act(async () => { reused = session!.beginCreateAttempt(draftFingerprint(session!.values)); });
    assert.equal(reused, firstKey);

    await act(async () => {
      session!.update((current) => ({
        ...current,
        definition: { ...current.definition, title: '改过的名字' },
      }));
    });
    let rotated = '';
    await act(async () => { rotated = session!.beginCreateAttempt(draftFingerprint(session!.values)); });
    assert.notEqual(rotated, firstKey);
    assert.equal(session?.idempotencyKey, rotated);
  });

  it('markSaved clears dirty state and keeps branch-only saves dirty', async () => {
    let session: AuthoringSession | undefined;
    function Probe() {
      session = useAuthoringSession({
        worldId: 'world-5',
        branchId: 'branch-1',
        initialValues: sampleDraft(),
        baseRevision: 1,
        branchRevision: 1,
        ready: true,
      });
      return null;
    }
    await act(async () => { root!.render(<Probe />); });
    await act(async () => {
      session!.update((current) => ({
        ...current,
        initialBranch: { ...current.initialBranch, direction: '向北塔推进。' },
      }));
    });
    await act(async () => {
      session!.markSaved({
        values: {
          definition: { ...sampleDraft().definition, summary: '已保存的世界' },
          initialBranch: { ...sampleDraft().initialBranch, direction: '向北塔推进。' },
        },
        baseRevision: 2,
        branchRevision: 1,
        keepDirty: true,
      });
    });
    assert.equal(session?.isDirty, true);
    assert.equal(session?.baseRevision, 2);
    assert.equal(session?.values.definition.summary, '已保存的世界');

    await act(async () => {
      session!.markSaved({ values: sampleDraft(), baseRevision: 3, branchRevision: 2 });
    });
    assert.equal(session?.isDirty, false);
    assert.equal(session?.baseRevision, 3);
    assert.equal(storage.getItem(WORLD_AUTHORING_STORAGE_PREFIX + 'edit:world-5'), null);
  });

  it('persists dirty drafts with their branch and fingerprint-stable content', async () => {
    let session: AuthoringSession | undefined;
    function Probe() {
      session = useAuthoringSession({
        worldId: 'world-6',
        branchId: 'branch-7',
        initialValues: sampleDraft(),
        baseRevision: 1,
        branchRevision: 2,
        ready: true,
      });
      return null;
    }
    await act(async () => { root!.render(<Probe />); });
    await act(async () => {
      session!.update((current) => ({
        ...current,
        definition: { ...current.definition, summary: '需要恢复的内容' },
      }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });

    const stored = storage.getItem(WORLD_AUTHORING_STORAGE_PREFIX + 'edit:world-6');
    assert.ok(stored);
    const parsed = JSON.parse(stored!);
    assert.equal(parsed.branchId, 'branch-7');
    assert.equal(parsed.values.definition.summary, '需要恢复的内容');
    assert.equal(parsed.attemptedFingerprint, undefined);
    assert.equal(
      draftFingerprint(parsed.values),
      draftFingerprint(session!.values),
    );
  });

  it('flushes the latest draft on pagehide before the debounce window', async () => {
    let session: AuthoringSession | undefined;
    function Probe() {
      session = useAuthoringSession({
        worldId: 'world-7',
        branchId: 'branch-1',
        initialValues: sampleDraft(),
        baseRevision: 1,
        branchRevision: 1,
        ready: true,
      });
      return null;
    }
    await act(async () => { root!.render(<Probe />); });
    await act(async () => {
      session!.update((current) => ({
        ...current,
        definition: { ...current.definition, summary: '页面关闭前的输入' },
      }));
    });

    // 防抖窗口内立刻离开页面：必须已经写入，而不是等 200ms。
    await act(async () => {
      (globalThis as unknown as { window: { dispatchEvent: (event: { type: string }) => void } })
        .window.dispatchEvent({ type: 'pagehide' });
    });
    const stored = storage.getItem(WORLD_AUTHORING_STORAGE_PREFIX + 'edit:world-7');
    assert.ok(stored);
    assert.equal(JSON.parse(stored!).values.definition.summary, '页面关闭前的输入');
  });

  it('persists the create attempt key synchronously before the request goes out', async () => {
    let session: AuthoringSession | undefined;
    function Probe() {
      session = useAuthoringSession({ worldId: 'world-8', initialValues: sampleDraft(), baseRevision: 1, ready: true });
      return null;
    }
    await act(async () => { root!.render(<Probe />); });
    await act(async () => {
      session!.update((current) => ({
        ...current,
        definition: { ...current.definition, title: '待创建' },
      }));
    });
    const fingerprint = draftFingerprint(session!.values);
    let usedKey = '';
    await act(async () => { usedKey = session!.beginCreateAttempt(fingerprint); });

    const stored = storage.getItem(WORLD_AUTHORING_STORAGE_PREFIX + 'edit:world-8');
    assert.ok(stored);
    const parsed = JSON.parse(stored!);
    // 落盘的键必须就是这次请求要用的键。
    assert.equal(parsed.idempotencyKey, usedKey);
    assert.equal(parsed.attemptedFingerprint, fingerprint);
  });

  it('removes a clean draft immediately after save instead of after the debounce', async () => {
    let session: AuthoringSession | undefined;
    function Probe() {
      session = useAuthoringSession({
        worldId: 'world-9',
        branchId: 'branch-1',
        initialValues: sampleDraft(),
        baseRevision: 1,
        branchRevision: 1,
        ready: true,
      });
      return null;
    }
    await act(async () => { root!.render(<Probe />); });
    await act(async () => {
      session!.update((current) => ({
        ...current,
        definition: { ...current.definition, summary: '保存前' },
      }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    assert.ok(storage.getItem(WORLD_AUTHORING_STORAGE_PREFIX + 'edit:world-9'));

    await act(async () => {
      session!.markSaved({ values: sampleDraft(), baseRevision: 2, branchRevision: 2 });
    });
    // 同步删除：刷新页面不能恢复成“未保存”的旧内容。
    assert.equal(storage.getItem(WORLD_AUTHORING_STORAGE_PREFIX + 'edit:world-9'), null);
  });

  it('treats a dirty draft without a captured base as a conflict, not as "use latest"', async () => {
    storage.setItem(
      WORLD_AUTHORING_STORAGE_PREFIX + 'edit:world-10',
      JSON.stringify({
        version: 1,
        isDirty: true,
        updatedAt: 1,
        idempotencyKey: 'world-key',
        values: sampleDraft('旧草稿'),
      }),
    );
    let session: AuthoringSession | undefined;
    function Probe() {
      session = useAuthoringSession({
        worldId: 'world-10',
        branchId: 'branch-1',
        initialValues: sampleDraft('服务器版本'),
        baseRevision: 3,
        branchRevision: 2,
        ready: true,
      });
      return null;
    }
    await act(async () => { root!.render(<Probe />); });
    assert.equal(session?.isDirty, true);
    assert.equal(session?.baseRevision, undefined);
    assert.equal(session?.hasConflict, true);
    assert.equal(session?.conflictKind, 'missing-base');
    assert.equal(session?.values.definition.title, '旧草稿');
  });

  it('flags a stale branch revision even when the world revision is current', async () => {
    let session: AuthoringSession | undefined;
    function Probe({ branchRevision }: { branchRevision: number }) {
      session = useAuthoringSession({
        worldId: 'world-11',
        branchId: 'branch-1',
        initialValues: sampleDraft(),
        baseRevision: 1,
        branchRevision,
        ready: true,
      });
      return null;
    }
    await act(async () => { root!.render(<Probe branchRevision={2} />); });
    await act(async () => {
      session!.update((current) => ({
        ...current,
        initialBranch: { ...current.initialBranch, direction: '作者方向' },
      }));
    });
    assert.equal(session?.hasConflict, false);
    await act(async () => { root!.render(<Probe branchRevision={4} />); });
    assert.equal(session?.hasConflict, true);
    assert.equal(session?.conflictKind, 'branch-stale');
  });

  it('replaces branch fields but keeps world input when the branch switches', async () => {
    let session: AuthoringSession | undefined;
    function Probe({ branchId, title }: { branchId: string; title: string }) {
      session = useAuthoringSession({
        worldId: 'world-12',
        branchId,
        initialValues: {
          ...sampleDraft(),
          initialBranch: { title, mode: 'canon-gap', direction: `${title}方向` },
        },
        baseRevision: 1,
        branchRevision: 1,
        ready: true,
      });
      return null;
    }
    await act(async () => { root!.render(<Probe branchId="branch-a" title="主线" />); });
    await act(async () => {
      session!.update((current) => ({
        ...current,
        definition: { ...current.definition, summary: '世界草稿要保留' },
        initialBranch: { ...current.initialBranch, direction: '主线未保存方向' },
      }));
    });
    await act(async () => { root!.render(<Probe branchId="branch-b" title="支线" />); });
    assert.equal(session?.values.definition.summary, '世界草稿要保留');
    assert.equal(session?.values.initialBranch.title, '支线');
    assert.equal(session?.values.initialBranch.direction, '支线方向');
    assert.equal(session?.branchSwitched, true);
    assert.equal(session?.switchedFromBranchId, 'branch-a');
    // 旧分支的未保存方向被按 branchId 存起来，而不是静默丢弃。
    assert.equal(session?.branchDrafts['branch-a']?.direction, '主线未保存方向');
    assert.equal(session?.hasConflict, false);

    // 切回 branch-a：恢复它自己的未保存方向。
    await act(async () => { root!.render(<Probe branchId="branch-a" title="主线" />); });
    assert.equal(session?.values.initialBranch.direction, '主线未保存方向');
    assert.equal(session?.values.definition.summary, '世界草稿要保留');
  });

  it('never raises the world base revision when switching branches on a dirty draft', async () => {
    let session: AuthoringSession | undefined;
    function Probe({ branchId, revision }: { branchId: string; revision: number }) {
      session = useAuthoringSession({
        worldId: 'world-14',
        branchId,
        initialValues: sampleDraft(),
        baseRevision: revision,
        branchRevision: 1,
        ready: true,
      });
      return null;
    }
    await act(async () => { root!.render(<Probe branchId="branch-a" revision={2} />); });
    await act(async () => {
      session!.update((current) => ({
        ...current,
        definition: { ...current.definition, summary: '基于 rev 2 的世界草稿' },
      }));
    });
    // 切分支时服务端世界已推进到 rev 5：草稿不能因此获得新基准。
    await act(async () => { root!.render(<Probe branchId="branch-b" revision={5} />); });
    assert.equal(session?.baseRevision, 2);
    assert.equal(session?.hasConflict, true);
    assert.equal(session?.conflictKind, 'world-stale');
    assert.equal(session?.values.definition.summary, '基于 rev 2 的世界草稿');
  });

  it('keeps unsaved world definition when only the branch is saved', async () => {
    let session: AuthoringSession | undefined;
    function Probe() {
      session = useAuthoringSession({
        worldId: 'world-15',
        branchId: 'branch-1',
        initialValues: sampleDraft(),
        baseRevision: 3,
        branchRevision: 1,
        ready: true,
      });
      return null;
    }
    await act(async () => { root!.render(<Probe />); });
    const draft = {
      ...sampleDraft(),
      definition: { ...sampleDraft().definition, summary: '未保存的世界改动' },
      initialBranch: { title: '主线', mode: 'canon-gap' as const, direction: '新方向' },
    };
    await act(async () => { session!.replaceValues(draft); });
    // 只保存分支：服务端世界仍是初值。
    await act(async () => {
      session!.markSaved({
        values: {
          definition: draft.definition,
          initialBranch: { title: '主线', mode: 'canon-gap', direction: '新方向' },
        },
        baseRevision: 3,
        branchRevision: 2,
        keepDirty: true,
      });
    });
    assert.equal(session?.values.definition.summary, '未保存的世界改动');
    assert.equal(session?.isDirty, true);
  });

  it('round-trips a persisted suggestion with its selection through storage', async () => {
    let session: AuthoringSession | undefined;
    function Probe() {
      session = useAuthoringSession({
        worldId: 'world-13',
        branchId: 'branch-1',
        initialValues: sampleDraft(),
        baseRevision: 1,
        branchRevision: 1,
        ready: true,
      });
      return null;
    }
    await act(async () => { root!.render(<Probe />); });
    const baseDraft = {
      ...sampleDraft(),
      definition: { ...sampleDraft().definition, summary: '带建议的草稿' },
    };
    await act(async () => {
      session!.replaceValues(baseDraft);
      session!.setSuggestion({
        fingerprint: draftFingerprint(baseDraft),
        scope: 'world',
        instruction: '补全简介',
        candidates: [{
          id: 'c-1', target: 'summary', value: '新简介', sourceIds: [], dependsOn: [], note: '依据简介',
        }],
        gaps: ['缺少年代'],
        selectedIds: ['c-1'],
        confirmations: [],
        baseDraft,
        createdAt: '2026-11-14T00:00:00.000Z',
      });
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });

    const raw = storage.getItem(WORLD_AUTHORING_STORAGE_PREFIX + 'edit:world-13');
    assert.ok(raw);
    const parsed = parseAuthoringEnvelope(raw!);
    assert.ok(parsed?.suggestion);
    assert.equal(parsed!.suggestion!.scope, 'world');
    assert.deepEqual(parsed!.suggestion!.selectedIds, ['c-1']);
    assert.equal(parsed!.suggestion!.candidates[0].target, 'summary');
    assert.equal(parsed!.suggestion!.baseDraft?.definition.summary, '带建议的草稿');
  });
});
