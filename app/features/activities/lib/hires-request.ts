/**
 * 细化弹窗的可提交判定（计划 §15.2）。
 *
 * 不可用时必须给出**具体原因**，不能只把按钮灰掉。这里把原因拼装逻辑抽出来单独测试，
 * 组件只负责显示。
 */

export interface HiresPreviewGate {
  canSubmit: boolean;
  issues: readonly string[];
}

export function hiresBlockedReason(input: {
  hasSource: boolean;
  preview: HiresPreviewGate | null;
  /** 预览请求本身失败时的原因，优先展示。 */
  failure?: string | null;
}): string {
  if (input.failure) return input.failure;
  if (!input.hasSource) return '当前画面还没有可用的图片产物，请先绘制或选择一张历史图。';
  if (!input.preview) return '';
  if (input.preview.canSubmit) return '';
  const issues = input.preview.issues.map((issue) => issue.trim()).filter(Boolean);
  return issues.length ? issues.join(' ') : '服务端未说明具体原因，请查看调用日志或稍后重试。';
}

/** 提交按钮只在预览成功且服务端允许提交时可用。 */
export function canSubmitHires(preview: HiresPreviewGate | null): boolean {
  return Boolean(preview?.canSubmit);
}

/**
 * 幂等键在打开弹窗时生成一次并保持不变：浏览器响应丢失时用同一个键重发，
 * 不会因为重试而新建任务。
 */
export function hiresIdempotencyKey(sourceArtifactId: string, random: () => string): string {
  return `hires-${sourceArtifactId}-${random()}`;
}
