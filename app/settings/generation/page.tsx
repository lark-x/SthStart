import type { Metadata } from 'next';
import { GenerationSettings } from './generation-client';

export const metadata: Metadata = {
  title: '生成配置 — SthStart',
  description: '管理活动绘制模式、尺寸、画风及高级 ComfyUI 工作流。',
};

export default function GenerationSettingsPage() {
  return <GenerationSettings />;
}
