import type { TopicCollectionRun } from '@sthstart/contracts';
import { TopicStore } from './store.js';
import { runTopicCollection, type TopicCollectionOptions } from './collection.js';
import { COLLECTION_WINDOW_DAYS } from './collection.js';
import { computeNextRunAt } from './time.js';

/** 检查间隔：服务启动后每分钟确认一次下次执行时间。 */
const TICK_MS = 60_000;

/**
 * 轻量调度器：不引入 Redis、独立队列或系统 cron。
 * 浏览器关闭不影响执行；电脑关机或后端停止时不执行，恢复后只补采一次最近七天。
 */
export class TopicScheduler {
  private timer: NodeJS.Timeout | null = null;
  /** 启动后的首次检查；停服时必须一起清掉，否则会在数据库关闭后触发。 */
  private startupTimer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(private readonly options: TopicCollectionOptions) {}

  start() {
    if (this.timer) return;
    const topics = new TopicStore(this.options.database);
    // 进程重启后把未结束任务标记为中断，并清理运行占用。
    const interrupted = topics.interruptDanglingRuns();
    if (interrupted && topics.getSettings().enabled) topics.setNextRunAt(new Date().toISOString());
    topics.pruneRawCandidates(30);
    this.timer = setInterval(() => { void this.tick().catch(error => console.warn('话题搜集调度失败：', (error as Error).message)); }, TICK_MS);
    // 不阻塞服务启动：错过的计划在启动后立刻补采一次。
    this.startupTimer = setTimeout(() => { void this.tick().catch(error => console.warn('话题搜集调度失败：', (error as Error).message)); }, 5_000);
    this.startupTimer.unref?.();
    this.timer.unref?.();
  }

  stop() {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 到点则启动一次定时搜集；已在运行的任务不会被并行启动。 */
  async tick(): Promise<TopicCollectionRun | null> {
    if (this.ticking) return null;
    this.ticking = true;
    try {
      const topics = new TopicStore(this.options.database);
      topics.pruneRawCandidates(30);
      const settings = topics.getSettings();
      if (!settings.enabled) return null;
      // 已有排队或运行中的任务时不再启动一份。
      const active = topics.findActiveRun();
      if (active) return null;
      const now = Date.now();
      const due = settings.nextRunAt ? Date.parse(settings.nextRunAt) : NaN;
      const missed = Number.isFinite(due) && now >= due;
      // 从未设置过下次执行时间（例如刚开启）时先补一次，避免开启后一直等到明天。
      const neverScheduled = !settings.nextRunAt;
      if (!missed && !neverScheduled) return null;

      // 先顺延下次执行时间再执行，避免采集耗时导致同一时刻被重复触发。
      topics.setNextRunAt(computeNextRunAt(new Date(), settings.dailyTime, settings.timezone));
      const run = topics.createRun({
        trigger: 'scheduled',
        settingsSnapshot: { ...settings, windowDays: COLLECTION_WINDOW_DAYS, missedCatchUp: missed } as unknown as Record<string, unknown>,
      });
      void runTopicCollection(this.options, run, settings, {});
      return run;
    } finally {
      this.ticking = false;
    }
  }
}

export { runTopicCollection };
