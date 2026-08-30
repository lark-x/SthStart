'use client';

import { useRef } from 'react';
import { ChevronRight, Plus, Upload } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import type { Workflow } from '../types';

export function WorkflowPanel({
  workflows,
  selectedWorkflowId,
  busy,
  onSelect,
  onCreate,
  onImport,
  onImportError,
}: {
  workflows: Workflow[];
  selectedWorkflowId: string;
  busy: string;
  onSelect: (id: string) => void;
  onCreate: (event: React.FormEvent<HTMLFormElement>) => void;
  onImport?: (json: unknown) => void;
  onImportError?: (message: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (onImport) onImport(parsed);
    } catch (error) {
      onImportError?.(error instanceof Error ? error.message : '工作流文件不是有效的 JSON。');
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#b83b1b]"><span className="text-[10px] font-bold tracking-[0.16em] uppercase">WORKFLOW VERSIONS</span></div>
          {onImport && (
            <div>
              <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" aria-label="导入工作流 JSON 文件" onChange={handleFileChange} />
              <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} loading={busy === 'workflow-import'}>
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />导入工作流 JSON
              </Button>
            </div>
          )}
        </div>
        <CardTitle>版本化工作流</CardTitle>
        <CardDescription>创建或导入工作流，发布经过校验的 ComfyUI API JSON 版本。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={onCreate} id="workflow-form" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Input aria-label="工作流 ID" placeholder="工作流 ID" name="workflow-id" required />
          <Input aria-label="工作流名称" placeholder="工作流名称" name="workflow-name" required />
          <Input aria-label="工作流说明" placeholder="工作流说明（可选）" name="workflow-description" />
          <Select aria-label="媒体类别" name="workflow-category" defaultValue="image">
            <option value="image">图片</option>
            <option value="video">视频</option>
            <option value="audio">音频</option>
            <option value="transform">转换</option>
          </Select>
          <Button type="submit" variant="primary" loading={busy === 'workflow'}><Plus className="h-3.5 w-3.5" aria-hidden="true" />创建工作流</Button>
        </form>
        {workflows.length ? (
          <div className="space-y-2">
            {workflows.map((workflow) => (
              <button type="button" key={workflow.id} onClick={() => onSelect(workflow.id)} className={`flex w-full items-center justify-between rounded border p-3 text-left ${selectedWorkflowId === workflow.id ? 'border-[#e45d35] bg-[#e45d35]/6' : 'border-[rgb(24_32_29/12%)] bg-[#fffdf8]'}`}>
                <span>
                  <strong className="text-xs">{workflow.name}</strong>
                  <code className="mt-0.5 block text-[10px] text-[#68716d]">{workflow.id} · {workflow.versions.length} 个版本</code>
                </span>
                <ChevronRight className="h-4 w-4 text-[#89908a]" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : <p className="text-xs text-[#89908a]">创建第一个工作流后，它会出现在这里。</p>}
      </CardContent>
    </Card>
  );
}
