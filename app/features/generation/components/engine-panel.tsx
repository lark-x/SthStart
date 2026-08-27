'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import type { Engine } from '../types';

export function EnginePanel({
  engines,
  busy,
  onSubmit,
}: {
  engines: Engine[];
  busy: string;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Card>
      <CardHeader><div className="flex items-center gap-2 text-[#b83b1b]"><span className="text-[10px] font-bold tracking-[0.16em] uppercase">ENGINES</span></div><CardTitle>生成引擎</CardTitle><CardDescription>ComfyUI 地址只保存在管理端；凭据会写入系统安全凭据库。</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {engines.length ? engines.map((engine) => (
            <div key={engine.id} className="flex items-center justify-between rounded border border-[rgb(24_32_29/12%)] bg-[#fffdf8] p-3">
              <div>
                <strong className="text-xs">{engine.name}</strong>
                <code className="mt-0.5 block text-[10px] text-[#68716d]">{engine.id} · {engine.base_url}</code>
              </div>
              <span className="text-[10px] text-[#68716d]">并发 {engine.concurrency_limit}</span>
            </div>
          )) : <p className="text-xs text-[#89908a]">还没有生成引擎。</p>}
        </div>
        <form onSubmit={onSubmit} className="space-y-2 border-t border-[rgb(24_32_29/10%)] pt-3" id="engine-form">
          <div className="grid grid-cols-2 gap-2">
            <Input aria-label="引擎 ID" placeholder="引擎 ID" name="engine-id" required />
            <Input aria-label="引擎名称" placeholder="引擎名称" name="engine-name" required />
          </div>
          <Input aria-label="ComfyUI 地址" placeholder="ComfyUI 地址" name="engine-url" required />
          <div className="grid grid-cols-2 gap-2">
            <Input aria-label="引擎凭据" placeholder="引擎凭据（可选）" type="password" name="engine-secret" />
            <Input aria-label="并发限制" placeholder="并发限制" type="number" min={1} name="engine-concurrency" required />
          </div>
          <Button type="submit" variant="primary" loading={busy === 'engine'}><Plus className="h-3.5 w-3.5" aria-hidden="true" />保存引擎</Button>
        </form>
      </CardContent>
    </Card>
  );
}
