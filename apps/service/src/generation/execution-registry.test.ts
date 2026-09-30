import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionRegistry } from './execution-registry.js';

test('ExecutionRegistry tracks tasks, prevents reentrancy, and handles aborts', async () => {
  const registry = new ExecutionRegistry();

  let resolveTask1: () => void = () => {};
  const promise1 = new Promise<void>((resolve) => {
    resolveTask1 = resolve;
  });

  const ac1 = registry.register({
    taskId: 'task-1',
    appId: 'test-app',
    kind: 'cloud_generation',
    promise: promise1,
  });

  assert.equal(registry.isExecuting('task-1'), true);
  assert.equal(registry.getActiveCount(), 1);
  assert.equal(registry.getSignal('task-1'), ac1.signal);

  // Prevent duplicate registration
  assert.throws(
    () => {
      registry.register({
        taskId: 'task-1',
        appId: 'test-app',
        promise: Promise.resolve(),
      });
    },
    /task_already_executing/,
  );

  // Abort task
  assert.equal(registry.abort('task-1', 'user_cancelled'), true);
  assert.equal(ac1.signal.aborted, true);
  assert.equal((ac1.signal.reason as Error).message, 'user_cancelled');

  // Complete promise and ensure auto-cleanup
  resolveTask1();
  await promise1;
  // Yield to microtask queue for .finally() to run
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(registry.isExecuting('task-1'), false);
  assert.equal(registry.getActiveCount(), 0);
});

test('ExecutionRegistry drain gracefully aborts in-flight tasks and awaits completion', async () => {
  const registry = new ExecutionRegistry();

  let resolveTask2: () => void = () => {};
  const promise2 = new Promise<void>((resolve) => {
    resolveTask2 = resolve;
  });

  const ac2 = registry.register({
    taskId: 'task-2',
    appId: 'test-app',
    promise: promise2,
  });

  assert.equal(registry.getActiveCount(), 1);

  // Start drain
  const drainPromise = registry.drain(1000);
  assert.equal(ac2.signal.aborted, true);
  assert.equal((ac2.signal.reason as Error).message, 'server_shutdown');

  // Tasks registered during drain should be immediately aborted
  const ac3 = registry.register({
    taskId: 'task-3',
    appId: 'test-app',
    promise: Promise.resolve(),
  });
  assert.equal(ac3.signal.aborted, true);

  resolveTask2();
  await drainPromise;
  assert.equal(registry.getActiveCount(), 0);
});
