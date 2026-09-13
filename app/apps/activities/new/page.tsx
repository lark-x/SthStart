import { Suspense } from 'react';
import type { Metadata } from 'next';
import { NewActivityForm } from './new-activity-form';

export const metadata: Metadata = { title: '新建活动 — SthStart', description: '选择模板或让大模型生成完整企划，确认后创建活动。' };

export default function NewActivityPage() {
  return (
    <Suspense fallback={<div className="bg-paper px-4 py-12 text-center text-muted sm:px-8">正在加载新建活动…</div>}>
      <NewActivityForm />
    </Suspense>
  );
}
