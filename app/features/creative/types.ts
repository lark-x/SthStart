import type { ArtifactDescriptor, CreativeStatusResponse, CreativeTaskResponse } from '@sthstart/contracts';
import type { CreativeTaskInput } from './api';

export type CreativeMode = CreativeTaskInput['mode'];

export type CreativeFormState = {
  prompt: string;
  negativePrompt: string;
  width: string;
  height: string;
  steps: string;
  seed: string;
  duration: string;
  aspectRatio: string;
};

export const EMPTY_CREATIVE_FORM: CreativeFormState = {
  prompt: '',
  negativePrompt: '',
  width: '1024',
  height: '1024',
  steps: '20',
  seed: '',
  duration: '4',
  aspectRatio: '16:9',
};

export const CREATIVE_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  submitting: '提交中',
  accepted: '已接收',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  abandoned: '已放弃',
};

export const CREATIVE_STATUS_VARIANTS: Record<string, 'default' | 'running' | 'online' | 'error' | 'warning' | 'stopped'> = {
  queued: 'default',
  submitting: 'running',
  accepted: 'running',
  running: 'running',
  succeeded: 'online',
  failed: 'error',
  cancelled: 'stopped',
  abandoned: 'warning',
};

export type CreativeBinding = CreativeStatusResponse['modes']['textToImage'];

export const CREATIVE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'] as const;
export const CREATIVE_IMAGE_MAX_BYTES = 12 * 1024 * 1024;

function mediaTypeMatches(actual: string, allowed: string) {
  return allowed === '*' || allowed === actual || (allowed.endsWith('/*') && actual.startsWith(allowed.slice(0, -1)));
}

export function creativeInputMaxBytes(binding: CreativeBinding | undefined, inputKey: string) {
  const configured = binding?.inputCapabilities?.[inputKey]?.maxBytes;
  return typeof configured === 'number' && Number.isSafeInteger(configured) && configured > 0
    ? Math.min(CREATIVE_IMAGE_MAX_BYTES, configured)
    : CREATIVE_IMAGE_MAX_BYTES;
}

export function creativeImageAccept(binding: CreativeBinding | undefined, inputKey: string) {
  const configured = binding?.inputCapabilities?.[inputKey]?.mediaTypes;
  const supported = configured?.length
    ? CREATIVE_IMAGE_TYPES.filter((type) => configured.some((allowed) => mediaTypeMatches(type, allowed)))
    : CREATIVE_IMAGE_TYPES;
  return (supported.length ? supported : CREATIVE_IMAGE_TYPES).join(',');
}

export function creativeImageAllowed(binding: CreativeBinding | undefined, inputKey: string, contentType: string) {
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  if (!CREATIVE_IMAGE_TYPES.includes(normalized as (typeof CREATIVE_IMAGE_TYPES)[number])) return false;
  const configured = binding?.inputCapabilities?.[inputKey]?.mediaTypes;
  return !configured?.length || configured.some((allowed) => mediaTypeMatches(normalized, allowed));
}

export function formatByteLimit(value: number) {
  const mib = value / (1024 * 1024);
  return `${mib >= 10 || Number.isInteger(mib) ? Math.round(mib) : mib.toFixed(1)} MiB`;
}

export function isActiveTask(status: string) {
  return ['queued', 'submitting', 'accepted', 'running'].includes(status);
}

export function taskModeLabel(task: CreativeTaskResponse) {
  if (task.replay.mode === 'image-to-image') return '图生图';
  if (task.replay.mode === 'h3-t2v') return '文生视频';
  if (task.replay.mode === 'h3-i2v') return '图生视频';
  if (task.replay.mode === 'h3-fl2va') return '首尾帧视频';
  return '文本生图';
}

export function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  } catch {
    return value;
  }
}

export function statusCopy(binding: CreativeBinding) {
  if (binding.ready) return `${binding.workflow?.name ?? '已配置'} · ${binding.engine?.name ?? 'ComfyUI'}`;
  if (binding.status === 'not_configured') return '尚未绑定生成工作流';
  if (binding.status === 'engine_unavailable') return '生成引擎不可用';
  if (binding.status === 'unsupported_engine') return '当前工作流引擎暂不支持';
  return '工作流版本不可用';
}

export function statusVariant(binding: CreativeBinding) {
  return binding.ready ? 'online' as const : binding.status === 'not_configured' ? 'warning' as const : 'error' as const;
}

export type ArtifactItem = ArtifactDescriptor;
