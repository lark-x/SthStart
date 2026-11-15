'use client';

import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { FormField } from '@/app/components/ui/form-field';

export function StoryProjectSettingsDialog({
  open, isReflection, title, summary, workId,
  onOpenChange, onTitleChange, onSummaryChange, onWorkIdChange, onSave,
}: {
  open: boolean;
  isReflection: boolean;
  title: string;
  summary: string;
  workId: string;
  onOpenChange: (open: boolean) => void;
  onTitleChange: (value: string) => void;
  onSummaryChange: (value: string) => void;
  onWorkIdChange: (value: string) => void;
  onSave: () => void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}
    title={isReflection ? '项目资料与主题设置' : '项目资料与作品绑定'}
    description={isReflection ? '项目简介与主题标签会提供给 AI 智能体提炼与查阅上下文。' : '项目简介与作品信息会提供给 AI 智能体创作上下文，并用于角色库筛选。'}
    size="md"
    footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" form="story-project-settings" disabled={!title.trim()}>保存项目资料</Button></>}>
    <form id="story-project-settings" className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <FormField label="项目名称" required>
        <Input value={title} maxLength={120} onChange={(event) => onTitleChange(event.target.value)} />
      </FormField>
      <FormField
        label={isReflection ? '关联主题标签' : '所属作品'}
        hint={isReflection ? '用于归档同类对话感想。' : '用于角色库筛选与创作上下文。'}
      >
        <Input value={workId} maxLength={120} onChange={(event) => onWorkIdChange(event.target.value)}
          placeholder={isReflection ? '例如：智能体对话、系统架构哲学' : '例如：原神、崩坏：星穹铁道，或留空'} />
      </FormField>
      <FormField label="项目简介" hint="会提供给 AI 智能体作为创作上下文。">
        <Textarea value={summary} maxLength={4000} rows={5} onChange={(event) => onSummaryChange(event.target.value)} className="min-h-32" />
      </FormField>
    </form>
  </Dialog>;
}
