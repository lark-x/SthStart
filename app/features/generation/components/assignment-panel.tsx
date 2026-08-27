'use client';

import { Save } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Select } from '@/app/components/ui/select';
import { versionKey, type Engine, type Workflow } from '../types';

export function AssignmentPanel({
  workflows,
  engines,
  bindings,
  busy,
  onBindingChange,
  onSave,
}: {
  workflows: Workflow[];
  engines: Engine[];
  bindings: Record<string, string>;
  busy: string;
  onBindingChange: (purpose: string, value: string) => void;
  onSave: () => void;
}) {
  const publishedVersions = workflows.flatMap((workflow) => workflow.versions.filter((version) => version.isPublished).map((version) => ({ workflow, version })));
  const purposes = [
    ['text-to-image', '文本生图', 'image', 'comfyui'],
    ['image-to-image', '图生图', 'image', 'comfyui'],
    ['h3-t2v', 'H3 文生视频', 'video', 'worker'],
    ['h3-i2v', 'H3 图生视频', 'video', 'worker'],
    ['h3-fl2va', 'H3 首尾帧视频', 'video', 'worker'],
  ] as const;
  return (
    <Card>
      <CardHeader><span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#b83b1b]">CREATIVE CENTER ROUTING</span><CardTitle>绑定创作中心</CardTitle><CardDescription>按应用用途选择已发布的媒体工作流版本。留空表示该模式未配置，创作页面会明确提示。</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {purposes.map(([purpose, label, category, engineKind]) => (
          <label key={purpose} className="flex flex-col gap-1 text-xs font-semibold sm:flex-row sm:items-center">
            <span className="w-32">{label}</span>
            <Select aria-label={`${label}工作流`} value={bindings[purpose] ?? ''} onChange={(event) => onBindingChange(purpose, event.target.value)}>
              <option value="">尚未绑定</option>
              {publishedVersions.filter(({ workflow }) => (workflow.category ?? 'image') === category && workflow.engine_kind === engineKind).map(({ workflow, version }) => (
                <option key={versionKey(workflow.id, version.version)} value={versionKey(workflow.id, version.version)}>
                  {workflow.name} · v{version.version}
                </option>
              ))}
            </Select>
          </label>
        ))}
        {engines.length === 0 && <p className="text-xs text-[#89908a]">还没有可用引擎，保存绑定前请先创建。</p>}
      </CardContent>
      <CardFooter>
        <span className="text-[11px] text-[#89908a]">应用 ID：creative-center</span>
        <Button variant="primary" onClick={onSave} loading={busy === 'assignment'}><Save className="h-3.5 w-3.5" aria-hidden="true" />保存绑定</Button>
      </CardFooter>
    </Card>
  );
}
