import { ApiClientError } from '@/app/lib/api-client';

export const RUN_STATE_LABEL: Record<string, string> = {
  succeeded: '已完成',
  partial: '部分完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
  running: '进行中',
  queued: '等待中',
};

export const TARGET_STATE_LABEL: Record<string, string> = {
  succeeded: '已完成',
  failed: '需要处理',
  uploading: '上传中',
  verifying: '校验中',
  pending: '等待中',
  skipped: '已跳过',
};

/** 把服务端错误码翻译成用户能照着做的提示，不暴露内部细节。 */
export function describeError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'backup_maintenance') return '正在创建备份快照，请稍后重试；草稿会保留在本地。';
    if (error.code === 'backup_busy') return '已有备份正在执行，请稍后再试。';
    if (error.code === 'backup_locked') return '仓库已锁定，请先解锁。';
    if (error.code === 'unauthorized') return '管理会话已失效，请刷新页面后重试。';
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function formatBytes(value: number | null | undefined): string {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let size = bytes;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return size.toFixed(size >= 10 || index === 0 ? 0 : 1) + ' ' + units[index];
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}
