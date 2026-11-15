import type { GenerationAttempt } from '@sthstart/contracts';

export const RUNNING_ATTEMPT_STATUSES = ['preparing', 'submitting', 'queued', 'running'] as const;

export function isRunningAttempt(status: string): boolean {
  return (RUNNING_ATTEMPT_STATUSES as readonly string[]).includes(status);
}

/** 合并分页并按出现顺序去重；同一任务刷新后的新数据保留首次位置。 */
export function flattenAttemptPages(pages: ReadonlyArray<{ items: GenerationAttempt[] }> | undefined): GenerationAttempt[] {
  return Array.from(new Map((pages?.flatMap((page) => page.items) ?? []).map((item) => [item.id, item])).values());
}
