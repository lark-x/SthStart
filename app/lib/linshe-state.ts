import type { AppStatus } from '@sthstart/contracts';

export type EmbedLoadState = 'loading' | 'ready' | 'offline' | 'unknown';

const homeLabels: Record<AppStatus, string> = {
  online: '邻舍已就绪',
  offline: '邻舍尚未启动',
  unknown: '正在连接本地服务',
};

export function homeStatusLabel(status: AppStatus): string {
  return homeLabels[status];
}

export function homeStatusHint(status: AppStatus): string {
  return status === 'online' ? '可在门户内完整使用' : '启动后会自动连接';
}

export function embedStateForStatus(status: AppStatus): EmbedLoadState {
  if (status === 'online') return 'ready';
  if (status === 'offline') return 'offline';
  return 'unknown';
}

export function embedStatusLabel(state: EmbedLoadState): string {
  if (state === 'ready') return '已连接';
  if (state === 'loading') return '连接中';
  return '未连接';
}

export function shouldRenderLinshe(state: EmbedLoadState, forceOpen: boolean): boolean {
  return state === 'ready' || forceOpen;
}
