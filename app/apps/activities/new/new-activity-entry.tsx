'use client';

import { useSearchParams } from 'next/navigation';
import { PlanningWizard } from '@/app/features/activities/components/planning-wizard';
import { NewActivityForm } from './new-activity-form';

/**
 * 新建活动的两个入口：默认是引导式企划（检索 → 候选确认 → 方案对比 → 创建），
 * 带 mode=manual 参数时走原有的手动填写表单。
 */
export function NewActivityEntry() {
  const params = useSearchParams();
  if (params.get('mode') === 'manual') return <NewActivityForm />;
  return <PlanningWizard />;
}
