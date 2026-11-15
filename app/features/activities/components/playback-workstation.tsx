'use client';

/**
 * 兼容性单向重导出入口：
 * 实际回放编排工作台、控制 Hook、标签与尺寸模型已迁移至 @/app/features/activities/playback。
 * 本文件保留作为旧调用方的单向过渡接入，不得反向依赖旧实现。
 */
export {
  PlaybackWorkstation,
  actionLabels,
  type PlaybackWorkstationProps,
} from '../playback';
