import assert from 'node:assert/strict';
import test from 'node:test';
import { processInChunks, runViewTransition, yieldToMain } from './web-platform';

type MutableGlobals = {
  scheduler?: unknown;
  document?: unknown;
  window?: unknown;
  setTimeout?: unknown;
};

const globals = globalThis as unknown as MutableGlobals;
const original = {
  scheduler: globals.scheduler,
  document: globals.document,
  window: globals.window,
  setTimeout: globals.setTimeout,
};
const hadScheduler = 'scheduler' in globals;
const hadDocument = 'document' in globals;
const hadWindow = 'window' in globals;

function setGlobal(key: keyof MutableGlobals, value: unknown) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  });
}

function restoreGlobal(key: keyof MutableGlobals, value: unknown, existed: boolean) {
  if (existed) {
    setGlobal(key, value);
    return;
  }
  Reflect.deleteProperty(globalThis, key);
}

function restoreAll() {
  restoreGlobal('scheduler', original.scheduler, hadScheduler);
  restoreGlobal('document', original.document, hadDocument);
  restoreGlobal('window', original.window, hadWindow);
  setGlobal('setTimeout', original.setTimeout);
}

test('yieldToMain delegates to scheduler.yield when the browser exposes it', async () => {
  let calls = 0;
  let timerCalls = 0;
  setGlobal('scheduler', {
    yield: async () => {
      calls += 1;
    },
  });
  setGlobal('setTimeout', (...args: unknown[]) => {
    timerCalls += 1;
    return (original.setTimeout as typeof setTimeout)(...args as Parameters<typeof setTimeout>);
  });

  try {
    await yieldToMain();
    assert.equal(calls, 1);
    assert.equal(timerCalls, 0);
  } finally {
    restoreAll();
  }
});

test('yieldToMain falls back to setTimeout when scheduler.yield is unavailable', async () => {
  let timerCalls = 0;
  setGlobal('scheduler', undefined);
  setGlobal('setTimeout', (...args: unknown[]) => {
    timerCalls += 1;
    return (original.setTimeout as typeof setTimeout)(...args as Parameters<typeof setTimeout>);
  });

  try {
    await yieldToMain();
    assert.equal(timerCalls, 1);
  } finally {
    restoreAll();
  }
});

test('yieldToMain falls back to setTimeout when scheduler.yield rejects', async () => {
  let timerCalls = 0;
  setGlobal('scheduler', {
    yield: async () => {
      throw new Error('frame discarded');
    },
  });
  setGlobal('setTimeout', (...args: unknown[]) => {
    timerCalls += 1;
    return (original.setTimeout as typeof setTimeout)(...args as Parameters<typeof setTimeout>);
  });

  try {
    await yieldToMain();
    assert.equal(timerCalls, 1);
  } finally {
    restoreAll();
  }
});

test('processInChunks preserves order, passes indexes, and yields between chunks', async () => {
  let yields = 0;
  setGlobal('scheduler', {
    yield: async () => {
      yields += 1;
    },
  });

  try {
    const seen: Array<[number, number]> = [];
    const results = await processInChunks(
      [10, 20, 30, 40, 50],
      (item, index) => {
        seen.push([item, index]);
        return item * 2;
      },
      2
    );

    assert.deepEqual(results, [20, 40, 60, 80, 100]);
    assert.deepEqual(seen, [
      [10, 0],
      [20, 1],
      [30, 2],
      [40, 3],
      [50, 4],
    ]);
    // Three chunks -> a yield after the first two, none after the last.
    assert.equal(yields, 2);
  } finally {
    restoreAll();
  }
});

test('processInChunks handles empty input and a single chunk without yielding', async () => {
  let yields = 0;
  setGlobal('scheduler', {
    yield: async () => {
      yields += 1;
    },
  });

  try {
    assert.deepEqual(await processInChunks([], (item: number) => item), []);
    assert.deepEqual(await processInChunks([1, 2, 3], (item) => item + 1, 10), [2, 3, 4]);
    assert.equal(yields, 0);
  } finally {
    restoreAll();
  }
});

test('runViewTransition uses startViewTransition when supported and motion is allowed', async () => {
  let updates = 0;
  let transitions = 0;
  let finished = 0;

  setGlobal('document', {
    startViewTransition: (callback: () => void | Promise<void>) => {
      transitions += 1;
      return {
        finished: Promise.resolve().then(() => {
          finished += 1;
          return callback();
        }),
      };
    },
  });
  setGlobal('window', { matchMedia: () => ({ matches: false }) });

  try {
    await runViewTransition(() => {
      updates += 1;
    });
    assert.equal(transitions, 1);
    assert.equal(updates, 1);
    assert.equal(finished, 1);
  } finally {
    restoreAll();
  }
});

test('runViewTransition runs directly when the API is unsupported', async () => {
  let updates = 0;
  setGlobal('document', {});
  setGlobal('window', { matchMedia: () => ({ matches: false }) });

  try {
    await runViewTransition(async () => {
      updates += 1;
    });
    assert.equal(updates, 1);
  } finally {
    restoreAll();
  }
});

test('runViewTransition skips the transition when reduced motion is preferred', async () => {
  let updates = 0;
  let transitions = 0;
  setGlobal('document', {
    startViewTransition: () => {
      transitions += 1;
      return { finished: Promise.resolve() };
    },
  });
  setGlobal('window', {
    matchMedia: (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }),
  });

  try {
    await runViewTransition(() => {
      updates += 1;
    });
    assert.equal(transitions, 0);
    assert.equal(updates, 1);
  } finally {
    restoreAll();
  }
});

test('runViewTransition swallows a rejected finished promise', async () => {
  let updates = 0;
  setGlobal('document', {
    startViewTransition: (callback: () => void | Promise<void>) => {
      void callback();
      return { finished: Promise.reject(new Error('transition skipped')) };
    },
  });
  setGlobal('window', { matchMedia: () => ({ matches: false }) });

  try {
    await runViewTransition(() => {
      updates += 1;
    });
    assert.equal(updates, 1);
  } finally {
    restoreAll();
  }
});

test('runViewTransition still updates when document is unavailable (SSR)', async () => {
  let updates = 0;
  restoreGlobal('document', original.document, hadDocument);

  try {
    await runViewTransition(() => {
      updates += 1;
    });
    assert.equal(updates, 1);
  } finally {
    restoreAll();
  }
});
