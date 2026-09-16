import type { BackupPlan } from '@sthstart/contracts';
import type { RuntimeLogService } from '../runtime.js';
import type { BackupRunner } from './runner.js';
import type { BackupStore } from './store.js';

/** 检查间隔：每分钟确认一次到期计划。 */
const TICK_MS = 60_000;

function zonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

function timezoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(pick('year'), pick('month') - 1, pick('day'), pick('hour') % 24, pick('minute'), pick('second'));
  return asUtc - date.getTime();
}

/** 把「用户时区的某天某时刻」换成 UTC 时间点；偏移修正两次以覆盖夏令时切换。 */
function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let round = 0; round < 2; round += 1) guess = target - timezoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/**
 * 按用户时区计算下一次执行时间。
 * weekday 采用 0=周日 … 6=周六（与 JS 的星期编号一致）。
 */
export function nextBackupRun(from: Date, plan: Pick<BackupPlan, 'frequency' | 'dailyTime' | 'timezone'> & { weekday?: number | null }): string | null {
  if (plan.frequency === 'manual') return null;
  const [rawHour, rawMinute] = (plan.dailyTime || '03:00').split(':');
  const hour = Math.min(Math.max(Number.parseInt(rawHour ?? '3', 10) || 0, 0), 23);
  const minute = Math.min(Math.max(Number.parseInt(rawMinute ?? '0', 10) || 0, 0), 59);
  const timeZone = plan.timezone || 'Asia/Shanghai';
  const today = zonedParts(from, timeZone);
  for (let add = 0; add <= 8; add += 1) {
    const calendar = new Date(Date.UTC(today.year, today.month - 1, today.day + add));
    if (plan.frequency === 'weekly' && calendar.getUTCDay() !== (plan.weekday ?? 1)) continue;
    const candidate = zonedTimeToUtc(calendar.getUTCFullYear(), calendar.getUTCMonth() + 1, calendar.getUTCDate(), hour, minute, timeZone);
    // 至少留半分钟余量，避免同一分钟被反复判为「已到期」。
    if (candidate.getTime() > from.getTime() + 30_000) return candidate.toISOString();
  }
  return null;
}

/**
 * 备份调度：跟随服务进程运行，浏览器关闭不影响执行。
 *
 * - 每次 tick 前先把 next_run_at 顺延，重复 tick、重复点击、服务重启都不会并行捕获同一计划。
 * - 停机期间的到期计划在启动时最多补一次。
 * - 未解锁时由执行器记录「等待解锁」，解锁后补做。
 */
export class BackupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly deferred = new Map<string, number>();

  constructor(private readonly options: {
    store: BackupStore;
    runner: BackupRunner;
    logs: RuntimeLogService;
  }) {}

  start(): void {
    if (this.timer) return;
    // 服务重启：把未结束的运行标为中断，不伪造成功。
    const interrupted = this.options.store.interruptDanglingRuns();
    if (interrupted > 0) this.options.logs.append({ appId: 'sthstart', serviceId: 'backup', stream: 'system', level: 'warn', message: '服务重启：' + interrupted + ' 个未完成的备份运行已标记为中断。', force: true, phase: 'done' });
    this.timer = setInterval(() => { void this.tick().catch((error) => console.warn('备份调度失败：', error instanceof Error ? error.message : String(error))); }, TICK_MS);
    this.timer.unref?.();
    this.startupTimer = setTimeout(() => { void this.tick().catch(() => undefined); }, 10_000);
    this.startupTimer.unref?.();
  }

  stop(): void {
    if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = null; }
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async tick(now = new Date()): Promise<string[]> {
    if (this.ticking) return [];
    this.ticking = true;
    const started: string[] = [];
    try {
      for (const plan of this.options.store.listDuePlans(now)) {
        if (!plan.targetIds.length) {
          this.options.store.savePlan({ ...plan, targetIds: [], nextRunAt: nextBackupRun(now, plan) });
          this.options.logs.append({ appId: 'sthstart', serviceId: 'backup', stream: 'system', level: 'warn', message: '计划「' + plan.name + '」没有目标网盘，已顺延下一次执行。', force: true, phase: 'waiting' });
          continue;
        }
        const deferredUntil = this.deferred.get(plan.id) ?? 0;
        if (deferredUntil > now.getTime()) continue;
        if (this.options.runner.isBusy()) {
          // 服务忙：稍后再试，不重复创建任务，也不无限阻拦正常创作。
          this.deferred.set(plan.id, now.getTime() + 5 * 60_000);
          this.options.logs.append({ appId: 'sthstart', serviceId: 'backup', stream: 'system', level: 'warn', message: '计划「' + plan.name + '」到点但已有备份在运行，稍后重试。', force: true, errorCode: 'backup_busy', phase: 'waiting' });
          continue;
        }
        // 先顺延下次时间再执行：错过的时间只补一次，不追补停机期间所有周期。
        this.options.store.savePlan({ ...plan, nextRunAt: nextBackupRun(now, plan) });
        this.deferred.delete(plan.id);
        try {
          const run = await this.options.runner.start({ planId: plan.id, trigger: 'scheduled', planName: plan.name });
          started.push(run.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.options.logs.append({ appId: 'sthstart', serviceId: 'backup', stream: 'system', level: 'error', message: '计划「' + plan.name + '」启动失败：' + message, force: true, errorCode: message, phase: 'waiting' });
        }
      }
      return started;
    } finally {
      this.ticking = false;
    }
  }
}
