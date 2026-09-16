import { KnowledgeCollectionStore, nextCollectionRun, runKnowledgeCollection, type KnowledgeCollectionOptions } from './collections.js';

/** 检查间隔：每分钟确认一次到期任务。 */
const TICK_MS = 60_000;

/**
 * 资料搜集调度：服务内轻量实现，不引入 Redis、系统 cron 或桌面端自动化。
 *
 * - 浏览器关闭不影响执行；后端停止不执行，恢复后每个启用定义最多补跑一次。
 * - 运行前先持久化配置快照并顺延下次时间，避免刷新或重复 tick 产生同一任务。
 */
export class KnowledgeScheduler {
  private timer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(private readonly options: KnowledgeCollectionOptions) {}

  start() {
    if (this.timer) return;
    const store = new KnowledgeCollectionStore(this.options.database);
    // 进程重启：把未完成的执行记录标记为中断。
    store.interruptDanglingRuns();
    this.timer = setInterval(() => { void this.tick().catch(error => console.warn('资料搜集调度失败：', error instanceof Error ? error.message : String(error))); }, TICK_MS);
    this.timer.unref?.();
    this.startupTimer = setTimeout(() => { void this.tick().catch(error => console.warn('资料搜集调度失败：', error instanceof Error ? error.message : String(error))); }, 8_000);
    this.startupTimer.unref?.();
  }

  stop() {
    if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = null; }
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** 到期的启用定义各启动一次；已在运行的定义跳过。 */
  async tick(now = new Date()): Promise<string[]> {
    if (this.ticking) return [];
    this.ticking = true;
    const started: string[] = [];
    try {
      const store = new KnowledgeCollectionStore(this.options.database);
      for (const collection of store.listDue(now)) {
        // 同一任务同一时刻只运行一次：手动与定时共用占用检查。
        if (store.findActiveRun(collection.id)) continue;
        if (!collection.sources.length) continue;
        // 先顺延下次时间再执行：错过的时间只补一次，不追补停机期间所有周期；
        // 执行若提前失败也不会让定义一直停在到期状态被反复触发。
        store.setNextRunAt(collection.id, nextCollectionRun(now, collection));
        const run = store.createRun({
          collectionId: collection.id,
          trigger: 'scheduled',
          settingsSnapshot: collection as unknown as Record<string, unknown>,
        });
        void runKnowledgeCollection(this.options, collection, run);
        started.push(run.id);
      }
      return started;
    } finally {
      this.ticking = false;
    }
  }
}
