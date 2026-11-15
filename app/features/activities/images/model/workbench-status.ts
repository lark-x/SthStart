import type { ApiClientError } from '@/app/lib/api-client';

export type WorkbenchNotice = { type: 'success' | 'error'; text: string };

/** Server draft/revision conflicts are recoverable: local input must stay on screen. */
export function isImageConfigConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'status' in error && (error as ApiClientError).status === 409);
}

export function describeImageConfigSaveError(error: unknown): string {
  if (isImageConfigConflict(error)) {
    return '图像配置已在其他位置更新，当前输入仍保留。请重新读取后再保存。';
  }
  return '保存草稿失败: ' + String(error);
}

export function describeImageConfigCommitError(error: unknown): string {
  if (isImageConfigConflict(error)) {
    return '提交版本冲突：活动或图像配置已有新版本，当前输入仍保留。请重新准备或读取后再提交。';
  }
  return '提交版本失败: ' + String(error);
}
