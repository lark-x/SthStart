'use client';

import { Save } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import type { Engine, Workflow } from '../types';

const SAMPLE_DEFINITION = JSON.stringify({
  '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
  '3': { class_type: 'KSampler', inputs: { seed: 0, steps: 20 } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'SthStart' } },
}, null, 2);

export function WorkflowEditor({
  workflows,
  engines,
  selectedWorkflowId,
  busy,
  onSelectWorkflow,
  onPublish,
}: {
  workflows: Workflow[];
  engines: Engine[];
  selectedWorkflowId: string;
  busy: string;
  onSelectWorkflow: (id: string) => void;
  onPublish: (input: { engineId: string; inputSchema: string; inputCapabilities: string; nodeBindings: string; outputDeclarations: string; outputMediaTypes: string; outputSchema: string; definition: string }) => void;
}) {
  const selectedWorkflow = workflows.find((item) => item.id === selectedWorkflowId);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onPublish({
      engineId: String(data.get('version-engine') ?? ''),
      inputSchema: String(data.get('version-input-schema') ?? ''),
      inputCapabilities: String(data.get('version-input-capabilities') ?? ''),
      nodeBindings: String(data.get('version-node-bindings') ?? ''),
      outputDeclarations: String(data.get('version-output-declarations') ?? ''),
      outputMediaTypes: String(data.get('version-output-media-types') ?? ''),
      outputSchema: String(data.get('version-output-schema') ?? ''),
      definition: String(data.get('version-definition') ?? ''),
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 text-[#b83b1b]"><span className="text-[10px] font-bold tracking-[0.16em] uppercase">PUBLISH A VERSION</span></div>
        <CardTitle>发布工作流版本</CardTitle>
        <CardDescription>{selectedWorkflow ? `当前选择：${selectedWorkflow.name}。发布后版本不可变，应用绑定始终指向明确的版本。` : '请先创建并选择一个工作流。'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form key={selectedWorkflowId} id="workflow-version-form" onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Select aria-label="工作流" value={selectedWorkflowId} onChange={(event) => onSelectWorkflow(event.target.value)} name="version-workflow">
              <option value="">选择工作流</option>
              {workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
            </Select>
            <Select aria-label="绑定引擎" name="version-engine" defaultValue={engines[0]?.id ?? ''}>
              <option value="">选择引擎（可选）</option>
              {engines.map((engine) => <option key={engine.id} value={engine.id}>{engine.name}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <div><label htmlFor="generation-input-schema" className="mb-1 block text-xs font-semibold">输入结构</label><Textarea id="generation-input-schema" name="version-input-schema" rows={8} className="font-mono text-[11px]" defaultValue={JSON.stringify({ prompt: { type: 'string' } }, null, 2)} /></div>
            <div><label htmlFor="generation-input-capabilities" className="mb-1 block text-xs font-semibold">媒体输入能力</label><Textarea id="generation-input-capabilities" name="version-input-capabilities" rows={8} className="font-mono text-[11px]" defaultValue="{}" /></div>
            <div><label htmlFor="generation-node-bindings" className="mb-1 block text-xs font-semibold">节点绑定</label><Textarea id="generation-node-bindings" name="version-node-bindings" rows={8} className="font-mono text-[11px]" defaultValue={JSON.stringify({ prompt: ['1', 'inputs', 'text'] }, null, 2)} /></div>
            <div><label htmlFor="generation-definition" className="mb-1 block text-xs font-semibold">ComfyUI API JSON</label><Textarea id="generation-definition" name="version-definition" rows={8} className="font-mono text-[11px]" defaultValue={SAMPLE_DEFINITION} /></div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input aria-label="输出节点 ID" placeholder="输出节点 ID，多个用逗号分隔，例如 9" name="version-output-declarations" defaultValue="9" />
            <Input aria-label="输出媒体类型" placeholder="输出 MIME，多个用逗号分隔" name="version-output-media-types" defaultValue={selectedWorkflow?.category === 'video' ? 'video/mp4' : selectedWorkflow?.category === 'audio' ? 'audio/wav' : 'image/png'} />
            <Textarea aria-label="输出结构" placeholder="输出结构 JSON" name="version-output-schema" rows={1} className="font-mono text-[11px]" defaultValue="{}" />
          </div>
        </form>
      </CardContent>
      <CardFooter>
        <span className="text-[11px] text-[#89908a]">只接受 API 格式工作流，不接受带 nodes 数组的画布导出。</span>
        <Button variant="primary" type="submit" form="workflow-version-form" loading={busy === 'version'} disabled={!selectedWorkflowId}><Save className="h-3.5 w-3.5" aria-hidden="true" />发布版本</Button>
      </CardFooter>
    </Card>
  );
}
