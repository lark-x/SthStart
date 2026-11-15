'use client';
import type { ActivityPlanningOutput } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';

export function PlanningPlanEditorDialog({
  open,
  setOpen,
  editValue,
  onSave,
  onUpdateActivity,
  onUpdateStage,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  editValue: ActivityPlanningOutput | null;
  onSave: () => void;
  onUpdateActivity: (key: keyof ActivityPlanningOutput['activity'], value: string) => void;
  onUpdateStage: (index: number, key: 'title' | 'location' | 'description' | 'endCondition', value: string) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="编辑方案内容"
      description="这里的改动只影响本次创建的活动，不会写回模型输出，也不会修改其他方案。"
      className="max-w-3xl"
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button variant="primary" onClick={onSave}>保存改动</Button>
        </div>
      )}
    >
      {editValue && (
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">标题</span>
            <Input aria-label="方案标题" value={editValue.activity.title} onChange={(event) => onUpdateActivity('title', event.target.value)} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-ink">主题</span>
              <Input aria-label="方案主题" value={editValue.activity.theme} onChange={(event) => onUpdateActivity('theme', event.target.value)} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-ink">地点</span>
              <Input aria-label="方案地点" value={editValue.activity.location} onChange={(event) => onUpdateActivity('location', event.target.value)} />
            </label>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">概述</span>
            <Textarea aria-label="方案概述" rows={2} value={editValue.activity.overview} onChange={(event) => onUpdateActivity('overview', event.target.value)} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink">活动规则</span>
            <Textarea aria-label="方案规则" rows={2} value={editValue.activity.rules} onChange={(event) => onUpdateActivity('rules', event.target.value)} />
          </label>
          <div className="space-y-2">
            {editValue.stages.map((stage, index) => (
              <div key={stage.clientId} className="space-y-2 rounded-lg border border-border-subtle p-2">
                <p className="text-xs font-semibold text-ink">阶段 {index + 1}</p>
                <Input aria-label={'阶段 ' + (index + 1) + ' 标题'} value={stage.title} onChange={(event) => onUpdateStage(index, 'title', event.target.value)} />
                <Input aria-label={'阶段 ' + (index + 1) + ' 地点'} value={stage.location} onChange={(event) => onUpdateStage(index, 'location', event.target.value)} />
                <Textarea aria-label={'阶段 ' + (index + 1) + ' 描述'} rows={2} value={stage.description} onChange={(event) => onUpdateStage(index, 'description', event.target.value)} />
                <Input aria-label={'阶段 ' + (index + 1) + ' 结束条件'} value={stage.endCondition} onChange={(event) => onUpdateStage(index, 'endCondition', event.target.value)} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}
