import type { Metadata } from 'next';
import { ControlCenter } from './control-center-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '邻舍运行控制中心 — SthStart',
  description: '管理本地服务、自启配置、模型接入与实时日志。',
};

export default function ControlCenterPage() {
  return <ControlCenter />;
}
