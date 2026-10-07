/**
 * 工作流选择器的展示文案（计划 §10.2）。
 *
 * 工作流 ID 里的分辨率字样（例如 `anima-activity-1080p-eval` 里的 `1080p`）只是历史命名，
 * 不代表该版本真实生效的默认画布。选择器旁必须显示真实默认尺寸，并在名称与实际不符时
 * 推荐改用新工作流——所以这两个函数刻意不依赖任何运行时类型，方便单独测试。
 */

export interface WorkflowOptionDisplay {
  workflowName: string;
  workflowVersion: number;
  engineName: string;
  defaultWidth?: number | null;
  defaultHeight?: number | null;
}

/** 只提取名称里的分辨率声明；不据此推断实际画布。 */
export function resolutionClaim(workflowId: string): string | null {
  const match = /(?:^|[-_])(\d{3,4})p(?:[-_]|$)/i.exec(workflowId ?? '');
  return match ? `${match[1]}p` : null;
}

/** 下拉项文本：始终带上真实默认尺寸（有的话）。 */
export function workflowOptionLabel(option: WorkflowOptionDisplay): string {
  const size = option.defaultWidth && option.defaultHeight ? ` · 默认 ${option.defaultWidth}×${option.defaultHeight}` : '';
  return `${option.workflowName} v${option.workflowVersion} · ${option.engineName}${size}`;
}

/**
 * 选择器下方的说明。返回 null 表示没有需要提醒的内容。
 * 只有在 ID 声称了分辨率、而真实默认尺寸与之不符时才推荐新工作流。
 */
export function defaultCanvasHint(option: WorkflowOptionDisplay, workflowId: string): string | null {
  if (!option.defaultWidth || !option.defaultHeight) {
    return '该工作流版本没有声明默认画布尺寸，将沿用活动画风设置。';
  }
  const claim = resolutionClaim(workflowId);
  const base = `该工作流版本真实默认画布为 ${option.defaultWidth}×${option.defaultHeight}`;
  if (!claim) return `${base}。`;
  const claimedHeight = Number(claim.slice(0, -1));
  if (Number.isFinite(claimedHeight) && claimedHeight === option.defaultHeight) return `${base}。`;
  return `${base}；名称里的 ${claim} 只是历史命名，不代表实际尺寸，推荐改用「邻舍对齐」新工作流。`;
}
