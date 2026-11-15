'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Alert } from '@/app/components/ui/alert';
import { FormField } from '@/app/components/ui/form-field';
import { getEntryLabel, type NewKind } from '../model/story-entry';

export function StoryCreateEntryDialog({
  newKind, isReflection, title, body, error, creating,
  onTitleChange, onBodyChange, onSubmit, onClose,
}: {
  newKind: NewKind | null;
  isReflection: boolean;
  title: string;
  body: string;
  error: string;
  creating: boolean;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return <Dialog
    open={Boolean(newKind)}
    onOpenChange={(open) => { if (!open) onClose(); }}
    title={newKind ? `新建${getEntryLabel(newKind, isReflection)}` : '新建资料'}
    description="创建后从 v1 开始记录修订。关闭弹窗会在当前工作区保留草稿，下次新建同类资料时可继续。"
    size="md"
    footer={<>
      <Button variant="outline" disabled={creating} onClick={onClose}>稍后继续</Button>
      <Button type="submit" form="story-create-entry" disabled={!title.trim() || creating} loading={creating}><Plus className="size-4" aria-hidden="true" />创建正式资料</Button>
    </>}
  >
    <form id="story-create-entry" className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <FormField
        label={newKind === 'character' ? '角色名称' : isReflection ? (newKind === 'outline' ? '纲要标题' : '随笔标题') : '条目标题'}
        required
      >
        <Input autoFocus value={title} maxLength={120} onChange={(event) => onTitleChange(event.target.value)}
          placeholder={newKind === 'character' ? '主角姓名' : isReflection ? (newKind === 'chapter' ? '例如：关于智能体认知的若干反思' : '例如：核心思考脉络') : (newKind === 'chapter' ? '第一章' : '核心设定')} />
      </FormField>
      <FormField label="初始正文（可选）" hint="支持 Markdown；创建后从 v1 开始记录修订。">
        <Textarea value={body} maxLength={100000} rows={10} onChange={(event) => onBodyChange(event.target.value)}
          className="min-h-48 font-mono text-sm leading-6" placeholder="Markdown 正文…" />
      </FormField>
      {error && <Alert variant="danger" title="创建失败">{error}</Alert>}
    </form>
  </Dialog>;
}
