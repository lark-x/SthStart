import type { Metadata } from 'next';
import { AiLogsClient } from './ai-logs-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI 调用记录 — SthStart',
  description: '查看由 SthStart 记录的模型推理、生成任务与业务关联。',
};

export default function AiLogsPage() {
  return <AiLogsClient />;
}
