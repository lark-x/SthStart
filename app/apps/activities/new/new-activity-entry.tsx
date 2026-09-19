'use client';

import { PlanningWizard } from '@/app/features/activities/components/planning-wizard';

/**
 * 新建活动只有一个入口：引导式企划（检索 → 候选确认 → 方案对比 → 创建）。
 *
 * 原本并存的 mode=manual 手动表单已移除——它与向导能力高度重叠，
 * 两者并存的代价是用户不知道该走哪条、以及两套实现各自演化。
 * 手动表单独有的「直接建空活动」与「自定义参与者」已并入向导，
 * 分别对应页头的「从空白开始」与参与者列表里的「添加自定义参与者」。
 */
export function NewActivityEntry() {
  return <PlanningWizard />;
}
