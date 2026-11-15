import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useStoredDraft } from './use-stored-draft';

type ListenerFn = (event: unknown) => void;

class MockStyle {
  [key: string]: unknown;
  setProperty(prop: string, val: string) {
    this[prop] = val;
  }
  removeProperty(prop: string) {
    delete this[prop];
  }
}

class MockNode {
  nodeType = 1;
}

class MockElement extends MockNode {
  [key: string]: unknown;
  tagName = 'DIV';
  nodeName = 'DIV';
  style = new MockStyle();
  attributes = new Map<string, string>();
  listeners = new Map<string, Set<ListenerFn>>();

  setAttribute(key: string, value: string) {
    this.attributes.set(key, String(value));
  }
  removeAttribute(key: string) {
    this.attributes.delete(key);
  }
  getAttribute(key: string) {
    return this.attributes.get(key) ?? null;
  }
  addEventListener(event: string, fn: ListenerFn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }
  removeEventListener(event: string, fn: ListenerFn) {
    this.listeners.get(event)?.delete(fn);
  }
  dispatchEvent(event: { type: string; [key: string]: unknown }) {
    this.listeners.get(event.type)?.forEach((fn) => fn(event));
  }
  appendChild() {}
  removeChild() {}
}

class MockHTMLElement extends MockElement {}

class MockSessionStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get length(): number {
    return this.store.size;
  }
}

interface TestDraft {
  eventIds: string[];
}

describe('useStoredDraft hook lifecycle & conflict safety', () => {
  let root: Root | null = null;
  let container: MockHTMLElement | null = null;
  let windowListeners: Map<string, Set<ListenerFn>>;
  let documentListeners: Map<string, Set<ListenerFn>>;
  let visibilityState: DocumentVisibilityState;
  const mockStorage = new MockSessionStorage();

  beforeEach(() => {
    mockStorage.clear();
    const docElement = new MockHTMLElement();
    docElement.tagName = 'HTML';
    docElement.nodeName = 'HTML';

    windowListeners = new Map<string, Set<ListenerFn>>();
    documentListeners = new Map<string, Set<ListenerFn>>();
    visibilityState = 'visible';
    const listeners = documentListeners;
    const doc = {
      nodeType: 9,
      nodeName: '#document',
      activeElement: null,
      documentElement: docElement,
      defaultView: null as unknown,
      get visibilityState() {
        return visibilityState;
      },
      addEventListener(event: string, fn: ListenerFn) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
      },
      removeEventListener(event: string, fn: ListenerFn) {
        listeners.get(event)?.delete(fn);
      },
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
        const t = new MockNode();
        t.nodeType = 3;
        (t as unknown as { nodeName: string; nodeValue: string }).nodeName = '#text';
        (t as unknown as { nodeName: string; nodeValue: string }).nodeValue = text;
        return t;
      },
    };

    const mockWindow = {
      document: doc,
      HTMLElement: MockHTMLElement,
      Element: MockElement,
      Node: MockNode,
      HTMLIFrameElement: MockHTMLElement,
      sessionStorage: mockStorage,
      addEventListener(event: string, fn: ListenerFn) {
        if (!windowListeners.has(event)) windowListeners.set(event, new Set());
        windowListeners.get(event)!.add(fn);
      },
      removeEventListener(event: string, fn: ListenerFn) {
        windowListeners.get(event)?.delete(fn);
      },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    };

    doc.defaultView = mockWindow;

    const globalScope = globalThis as unknown as Record<string, unknown>;
    globalScope.window = mockWindow;
    globalScope.document = doc;
    globalScope.HTMLElement = MockHTMLElement;
    globalScope.Element = MockElement;
    globalScope.Node = MockNode;
    globalScope.HTMLIFrameElement = MockHTMLElement;
    globalScope.sessionStorage = mockStorage;
    globalScope.IS_REACT_ACT_ENVIRONMENT = true;

    container = new MockHTMLElement();
    (container as unknown as { ownerDocument: unknown }).ownerDocument = doc;
    root = createRoot(container as unknown as HTMLElement);
  });

  function dispatchWindow(event: string) {
    windowListeners.get(event)?.forEach((fn) => fn({ type: event }));
  }

  function dispatchDocument(event: string) {
    documentListeners.get(event)?.forEach((fn) => fn({ type: event }));
  }

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
      root = null;
    }
    mockStorage.clear();
  });

  it('untouched hidden form does NOT write to sessionStorage', async () => {
    let hookResult: ReturnType<typeof useStoredDraft<TestDraft>> | undefined;

    function TestComponent({ open, revision }: { open: boolean; revision: number }) {
      hookResult = useStoredDraft<TestDraft>(
        'test-untouched',
        () => ({ eventIds: [] }),
        { open, expectedRevision: revision },
      );
      return null;
    }

    await act(async () => {
      root!.render(<TestComponent open={false} revision={1} />);
    });

    assert.equal(hookResult?.isDirty, false);
    assert.equal(hookResult?.baseRevision, 1);
    assert.deepEqual(hookResult?.draft, { eventIds: [] });

    // Wait past the debounce timer (200ms)
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Storage MUST remain untouched and empty
    assert.equal(mockStorage.getItem('sthstart:story-worlds:draft:test-untouched'), null);
  });

  it('clean draft takes fresh revision and initial values on open', async () => {
    let hookResult: ReturnType<typeof useStoredDraft<TestDraft>> | undefined;

    function TestComponent({
      open,
      revision,
      selectedId,
    }: {
      open: boolean;
      revision: number;
      selectedId?: string;
    }) {
      hookResult = useStoredDraft<TestDraft>(
        'test-fresh-open',
        () => ({ eventIds: selectedId ? [selectedId] : [] }),
        { open, expectedRevision: revision },
      );
      return null;
    }

    // Mount initially closed with revision 1, no selection
    await act(async () => {
      root!.render(<TestComponent open={false} revision={1} />);
    });

    assert.equal(hookResult?.isDirty, false);
    assert.equal(hookResult?.baseRevision, 1);
    assert.deepEqual(hookResult?.draft.eventIds, []);

    // Simulation advances to rev 3, user selects event-42 and opens dialog
    await act(async () => {
      root!.render(<TestComponent open={true} revision={3} selectedId="event-42" />);
    });

    // Unedited draft took fresh revision 3 and event-42 immediately!
    assert.equal(hookResult?.isDirty, false);
    assert.equal(hookResult?.baseRevision, 3);
    assert.deepEqual(hookResult?.draft.eventIds, ['event-42']);
  });

  it('dirty draft saves to sessionStorage and preserves edits across upstream revision updates', async () => {
    let hookResult: ReturnType<typeof useStoredDraft<TestDraft>> | undefined;

    function TestComponent({ open, revision }: { open: boolean; revision: number }) {
      hookResult = useStoredDraft<TestDraft>(
        'test-dirty-preserve',
        () => ({ eventIds: [] }),
        { open, expectedRevision: revision },
      );
      return null;
    }

    await act(async () => {
      root!.render(<TestComponent open={true} revision={1} />);
    });

    // User modifies the draft
    await act(async () => {
      hookResult?.setDraft({ eventIds: ['ev-1', 'ev-2'] });
    });

    assert.equal(hookResult?.isDirty, true);
    assert.deepEqual(hookResult?.draft.eventIds, ['ev-1', 'ev-2']);

    // Wait for debounce write to sessionStorage
    await new Promise((resolve) => setTimeout(resolve, 250));

    const raw = mockStorage.getItem('sthstart:story-worlds:draft:test-dirty-preserve');
    assert.ok(raw, 'Dirty draft must be saved to sessionStorage');
    const envelope = JSON.parse(raw!);
    assert.equal(envelope.isDirty, true);
    assert.deepEqual(envelope.data.eventIds, ['ev-1', 'ev-2']);

    // Upstream simulation advances revision from 1 to 3
    await act(async () => {
      root!.render(<TestComponent open={true} revision={3} />);
    });

    // User edits are preserved! Conflict is detected!
    assert.equal(hookResult?.isDirty, true);
    assert.deepEqual(hookResult?.draft.eventIds, ['ev-1', 'ev-2']);
    assert.equal(hookResult?.baseRevision, 1);
    assert.equal(hookResult?.hasConflict, true);

    // Rebase resolves conflict and updates expectedRevision without losing user edits
    await act(async () => {
      hookResult?.rebase(3);
    });

    assert.equal(hookResult?.baseRevision, 3);
    assert.deepEqual(hookResult?.draft.eventIds, ['ev-1', 'ev-2']);
    assert.equal(hookResult?.hasConflict, false);
  });

  it('reset and clear purge sessionStorage and restore clean initial state', async () => {
    let hookResult: ReturnType<typeof useStoredDraft<TestDraft>> | undefined;

    function TestComponent({ open, revision }: { open: boolean; revision: number }) {
      hookResult = useStoredDraft<TestDraft>(
        'test-clear',
        () => ({ eventIds: [] }),
        { open, expectedRevision: revision },
      );
      return null;
    }

    await act(async () => {
      root!.render(<TestComponent open={true} revision={1} />);
    });

    await act(async () => {
      hookResult?.setDraft({ eventIds: ['ev-99'] });
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.ok(mockStorage.getItem('sthstart:story-worlds:draft:test-clear'));

    // Clear draft on successful submit
    await act(async () => {
      hookResult?.clear();
    });

    assert.equal(hookResult?.isDirty, false);
    assert.deepEqual(hookResult?.draft.eventIds, []);
    assert.equal(mockStorage.getItem('sthstart:story-worlds:draft:test-clear'), null);
  });

  it('switching keys isolates drafts and switches dirty state correctly', async () => {
    let hookResult: ReturnType<typeof useStoredDraft<TestDraft>> | undefined;

    function TestComponent({ draftKey, revision }: { draftKey: string; revision: number }) {
      hookResult = useStoredDraft<TestDraft>(
        draftKey,
        () => ({ eventIds: [] }),
        { open: true, expectedRevision: revision },
      );
      return null;
    }

    await act(async () => {
      root!.render(<TestComponent draftKey="branch-alpha" revision={1} />);
    });

    await act(async () => {
      hookResult?.setDraft({ eventIds: ['ev-alpha'] });
    });

    assert.equal(hookResult?.isDirty, true);
    assert.deepEqual(hookResult?.draft.eventIds, ['ev-alpha']);

    // Switch key to branch-beta
    await act(async () => {
      root!.render(<TestComponent draftKey="branch-beta" revision={2} />);
    });

    // New key is clean with initial revision 2
    assert.equal(hookResult?.isDirty, false);
    assert.deepEqual(hookResult?.draft.eventIds, []);
    assert.equal(hookResult?.baseRevision, 2);
  });

  it('legacy envelopes and drafts without revision fields still establish a base and conflict', async () => {
    let hookResult: ReturnType<typeof useStoredDraft<TestDraft>> | undefined;

    function TestComponent({ draftKey, revision }: { draftKey: string; revision: number }) {
      hookResult = useStoredDraft<TestDraft>(
        draftKey,
        () => ({ eventIds: [] }),
        { open: true, expectedRevision: revision },
      );
      return null;
    }

    mockStorage.setItem('sthstart:story-worlds:draft:test-legacy', JSON.stringify({
      isDirty: true, data: { eventIds: ['legacy-event'] }, expectedRevision: 1, updatedAt: Date.now(),
    }));
    await act(async () => {
      root!.render(<TestComponent draftKey="test-legacy" revision={2} />);
    });
    assert.equal(hookResult?.isDirty, true);
    assert.equal(hookResult?.baseRevision, 1);
    assert.equal(hookResult?.hasConflict, true);
    assert.deepEqual(hookResult?.draft, { eventIds: ['legacy-event'] });

    await act(async () => {
      hookResult?.rebase(2);
    });
    assert.equal(hookResult?.baseRevision, 2);
    assert.equal(hookResult?.hasConflict, false);
    assert.deepEqual(hookResult?.draft, { eventIds: ['legacy-event'] });

    mockStorage.setItem('sthstart:story-worlds:draft:test-bare', JSON.stringify({ eventIds: ['bare-event'] }));
    await act(async () => {
      root!.render(<TestComponent draftKey="test-bare" revision={4} />);
    });
    await act(async () => {
      root!.render(<TestComponent draftKey="test-bare" revision={4} />);
    });
    assert.equal(hookResult?.isDirty, true);
    assert.equal(hookResult?.baseRevision, undefined);
    assert.equal(hookResult?.hasConflict, true);
    assert.deepEqual(hookResult?.draft, { eventIds: ['bare-event'] });

    await act(async () => {
      hookResult?.rebase(4);
    });
    assert.equal(hookResult?.baseRevision, 4);
    assert.equal(hookResult?.hasConflict, false);
    assert.deepEqual(hookResult?.draft, { eventIds: ['bare-event'] });
  });

  it('closing before the debounce flushes the final input and reopening restores it', async () => {
    let hookResult: ReturnType<typeof useStoredDraft<TestDraft>> | undefined;

    function TestComponent({ open, revision }: { open: boolean; revision: number }) {
      hookResult = useStoredDraft<TestDraft>(
        'test-flush',
        () => ({ eventIds: [] }),
        { open, expectedRevision: revision },
      );
      return null;
    }

    await act(async () => {
      root!.render(<TestComponent open={true} revision={1} />);
    });
    await act(async () => {
      hookResult?.setDraft({ eventIds: ['final-input'] });
    });
    await act(async () => {
      root!.render(<TestComponent open={false} revision={1} />);
    });

    const raw = mockStorage.getItem('sthstart:story-worlds:draft:test-flush');
    assert.ok(raw);
    assert.deepEqual(JSON.parse(raw!).data, { eventIds: ['final-input'] });

    await act(async () => {
      root!.render(<TestComponent open={true} revision={1} />);
    });
    assert.equal(hookResult?.isDirty, true);
    assert.deepEqual(hookResult?.draft, { eventIds: ['final-input'] });
  });

  it('key changes persist each key separately and never cross-load drafts', async () => {
    let hookResult: ReturnType<typeof useStoredDraft<TestDraft>> | undefined;

    function TestComponent({ draftKey, revision }: { draftKey: string; revision: number }) {
      hookResult = useStoredDraft<TestDraft>(
        draftKey,
        () => ({ eventIds: [] }),
        { open: true, expectedRevision: revision },
      );
      return null;
    }

    await act(async () => {
      root!.render(<TestComponent draftKey="branch-one" revision={1} />);
    });
    await act(async () => {
      hookResult?.setDraft({ eventIds: ['one-input'] });
    });
    await act(async () => {
      root!.render(<TestComponent draftKey="branch-two" revision={2} />);
    });
    assert.equal(hookResult?.isDirty, false);
    await act(async () => {
      hookResult?.setDraft({ eventIds: ['two-input'] });
    });
    await new Promise((resolve) => setTimeout(resolve, 250));

    const one = JSON.parse(mockStorage.getItem('sthstart:story-worlds:draft:branch-one')!);
    const two = JSON.parse(mockStorage.getItem('sthstart:story-worlds:draft:branch-two')!);
    assert.deepEqual(one.data, { eventIds: ['one-input'] });
    assert.deepEqual(two.data, { eventIds: ['two-input'] });
    assert.equal(one.expectedRevision, 1);
    assert.equal(two.expectedRevision, 2);

    await act(async () => {
      root!.render(<TestComponent draftKey="branch-one" revision={3} />);
    });
    assert.deepEqual(hookResult?.draft, { eventIds: ['one-input'] });
    assert.equal(hookResult?.baseRevision, 1);
    assert.equal(hookResult?.hasConflict, true);
  });

  it('pagehide and beforeunload synchronously flush the latest input before debounce', async () => {
    let hookResult: ReturnType<typeof useStoredDraft<TestDraft>> | undefined;

    function TestComponent({ revision }: { revision: number }) {
      hookResult = useStoredDraft<TestDraft>(
        'test-page-exit',
        () => ({ eventIds: [] }),
        { open: true, expectedRevision: revision },
      );
      return null;
    }

    await act(async () => {
      root!.render(<TestComponent revision={1} />);
    });
    await act(async () => {
      hookResult?.setDraft({ eventIds: ['first-input'] });
    });
    dispatchWindow('pagehide');
    const first = mockStorage.getItem('sthstart:story-worlds:draft:test-page-exit');
    assert.ok(first);
    assert.deepEqual(JSON.parse(first!).data, { eventIds: ['first-input'] });

    mockStorage.removeItem('sthstart:story-worlds:draft:test-page-exit');
    await act(async () => {
      hookResult?.setDraft({ eventIds: ['second-input'] });
    });
    dispatchWindow('beforeunload');
    const second = mockStorage.getItem('sthstart:story-worlds:draft:test-page-exit');
    assert.ok(second);
    assert.deepEqual(JSON.parse(second!).data, { eventIds: ['second-input'] });
    assert.equal(JSON.parse(second!).expectedRevision, 1);
  });

  it('visibility hidden flushes, while visible transitions do not', async () => {
    let hookResult: ReturnType<typeof useStoredDraft<TestDraft>> | undefined;

    function TestComponent({ revision }: { revision: number }) {
      hookResult = useStoredDraft<TestDraft>(
        'test-visibility',
        () => ({ eventIds: [] }),
        { open: true, expectedRevision: revision },
      );
      return null;
    }

    await act(async () => {
      root!.render(<TestComponent revision={2} />);
    });
    await act(async () => {
      hookResult?.setDraft({ eventIds: ['hidden-input'] });
    });
    visibilityState = 'visible';
    dispatchDocument('visibilitychange');
    assert.equal(mockStorage.getItem('sthstart:story-worlds:draft:test-visibility'), null);

    visibilityState = 'hidden';
    dispatchDocument('visibilitychange');
    const raw = mockStorage.getItem('sthstart:story-worlds:draft:test-visibility');
    assert.ok(raw);
    assert.deepEqual(JSON.parse(raw!).data, { eventIds: ['hidden-input'] });
    assert.equal(JSON.parse(raw!).expectedRevision, 2);
  });

  it('unload listeners never persist a clean draft and are removed on unmount', async () => {
    function TestComponent({ open, revision }: { open: boolean; revision: number }) {
      useStoredDraft<TestDraft>(
        'test-clean-unload',
        () => ({ eventIds: [] }),
        { open, expectedRevision: revision },
      );
      return null;
    }

    await act(async () => {
      root!.render(<TestComponent open={true} revision={3} />);
    });
    assert.ok((windowListeners.get('pagehide')?.size ?? 0) > 0);
    assert.ok((windowListeners.get('beforeunload')?.size ?? 0) > 0);
    assert.ok((documentListeners.get('visibilitychange')?.size ?? 0) > 0);

    dispatchWindow('pagehide');
    dispatchWindow('beforeunload');
    visibilityState = 'hidden';
    dispatchDocument('visibilitychange');
    assert.equal(mockStorage.getItem('sthstart:story-worlds:draft:test-clean-unload'), null);

    await act(async () => {
      root!.unmount();
    });
    root = null;
    assert.equal(windowListeners.get('pagehide')?.size ?? 0, 0);
    assert.equal(windowListeners.get('beforeunload')?.size ?? 0, 0);
    assert.equal(documentListeners.get('visibilitychange')?.size ?? 0, 0);
    assert.equal(mockStorage.getItem('sthstart:story-worlds:draft:test-clean-unload'), null);
  });
});
