export interface ActiveExecutionItem {
  taskId: string;
  appId: string;
  kind?: string;
  startedAt: string;
  abortController: AbortController;
  promise: Promise<unknown>;
  meta?: Record<string, unknown>;
}

/**
 * 轻量内存任务执行登记器
 * 管理在飞异步任务生命周期、取消信号与停机排空，防重入与防并发重发
 */
export class ExecutionRegistry {
  private active = new Map<string, ActiveExecutionItem>();
  private draining = false;

  /**
   * 登记一项正在执行的异步任务
   */
  register(item: {
    taskId: string;
    appId: string;
    kind?: string;
    abortController?: AbortController;
    promise: Promise<unknown>;
    meta?: Record<string, unknown>;
  }): AbortController {
    if (this.draining) {
      const ac = item.abortController ?? new AbortController();
      ac.abort(new Error('server_draining'));
      return ac;
    }

    if (this.active.has(item.taskId)) {
      throw new Error(`task_already_executing: 任务 ${item.taskId} 正在执行中，禁止重入喵。`);
    }

    const abortController = item.abortController ?? new AbortController();
    const entry: ActiveExecutionItem = {
      taskId: item.taskId,
      appId: item.appId,
      kind: item.kind,
      startedAt: new Date().toISOString(),
      abortController,
      promise: item.promise,
      meta: item.meta,
    };

    this.active.set(item.taskId, entry);

    // 任务完成后自动清理，使用 catch 保护防止未捕获拒绝链
    item.promise
      .catch(() => {})
      .finally(() => {
        this.active.delete(item.taskId);
      });

    return abortController;
  }

  /** Reserve before invoking work, so draining and duplicates cannot dispatch requests. */
  start<T>(item: { taskId: string; appId: string; kind?: string; abortController?: AbortController }, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.draining) return Promise.reject(new Error('server_draining'));
    if (this.isExecuting(item.taskId)) return Promise.reject(new Error('task_already_executing'));
    const controller = item.abortController ?? new AbortController();
    const promise = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return work(controller.signal);
    });
    this.register({ ...item, abortController: controller, promise });
    return promise;
  }

  isExecuting(taskId: string): boolean {
    return this.active.has(taskId);
  }

  getSignal(taskId: string): AbortSignal | undefined {
    return this.active.get(taskId)?.abortController.signal;
  }

  abort(taskId: string, reason = 'cancelled'): boolean {
    const entry = this.active.get(taskId);
    if (!entry) return false;
    entry.abortController.abort(new Error(reason));
    return true;
  }

  getPendingPromises(): Promise<unknown>[] {
    return Array.from(this.active.values(), (entry) => entry.promise);
  }

  getActiveCount(): number {
    return this.active.size;
  }

  getActiveTasks(): Array<Omit<ActiveExecutionItem, 'promise'>> {
    return Array.from(this.active.values()).map(({ taskId, appId, kind, startedAt, abortController, meta }) => ({
      taskId,
      appId,
      kind,
      startedAt,
      abortController,
      meta,
    }));
  }

  private timedOutTasks: Array<Omit<ActiveExecutionItem, 'promise'>> = [];

  getTimedOutTasks(): Array<Omit<ActiveExecutionItem, 'promise'>> {
    return [...this.timedOutTasks];
  }

  /**
   * 优雅关机排空：广播取消信号并等待正在执行的任务退出
   */
  async drain(timeoutMs = 15000): Promise<void> {
    this.draining = true;
    for (const entry of this.active.values()) {
      try {
        entry.abortController.abort(new Error('server_shutdown'));
      } catch {
        // 忽略单个信号错误
      }
    }

    const allPromises = Array.from(this.active.values()).map((e) => e.promise);
    if (allPromises.length === 0) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      Promise.allSettled(allPromises).then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });

    if (!settled) {
      // 记录超时未退出的在飞任务快照，避免丢失追踪
      this.timedOutTasks = this.getActiveTasks();
    }
  }

  reset(): void {
    this.active.clear();
    this.draining = false;
    this.timedOutTasks = [];
  }
}

export const globalExecutionRegistry = new ExecutionRegistry();

// Service instances with different databases must not drain each other's tasks.
const databaseRegistries = new WeakMap<object, ExecutionRegistry>();
export function executionRegistryFor(database: object): ExecutionRegistry {
  let registry = databaseRegistries.get(database);
  if (!registry) { registry = new ExecutionRegistry(); databaseRegistries.set(database, registry); }
  return registry;
}

/** Bound waits without forgetting or rejecting the underlying work. */
export async function waitForExecutions(promises: Promise<unknown>[], timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.allSettled(promises).then(() => true),
    new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}
