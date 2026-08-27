'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import type { Worker } from '../types';

export function WorkerPanel({
  workers,
  busy,
  onSubmit,
}: {
  workers: Worker[];
  busy: string;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Card>
      <CardHeader><div className="flex items-center gap-2 text-[#b83b1b]"><span className="text-[10px] font-bold tracking-[0.16em] uppercase">WINDOWS WORKERS</span></div><CardTitle>Windows Worker</CardTitle><CardDescription>Worker 只允许单任务并发；token 仅在创建或轮换时显示一次，任务文件会在 SthStart 确认产物后清理。</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {workers.length ? workers.map((worker) => (
            <div key={worker.engineId} className="flex flex-col gap-2 rounded border border-[rgb(24_32_29/12%)] bg-[#fffdf8] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <strong className="text-xs">{worker.name}</strong>
                <code className="mt-0.5 block text-[10px] text-[#68716d]">{worker.engineId} · {worker.baseUrl}</code>
                <span className="mt-1 block text-[10px] text-[#68716d]">模型 {worker.model || '未指定'} · 温度 {worker.temperature} · 并发 1</span>
                <span className="mt-1 block text-[10px] text-[#89908a]">磁盘警告 {worker.diskWarningBytes} · 停止 {worker.diskStopBytes}</span>
              </div>
              <span className={`text-[10px] ${worker.state === 'online' ? 'text-[#39794f]' : 'text-[#89908a]'}`}>{worker.state === 'online' ? '在线' : worker.state === 'offline' ? '离线' : '未探测'}</span>
            </div>
          )) : <p className="text-xs text-[#89908a]">还没有配置 Windows Worker。</p>}
        </div>
        <form onSubmit={onSubmit} id="worker-form" className="space-y-2 border-t border-[rgb(24_32_29/10%)] pt-3">
          <div className="grid grid-cols-2 gap-2">
            <Input aria-label="Worker ID" placeholder="Worker ID" name="worker-id" required />
            <Input aria-label="Worker 名称" placeholder="Worker 名称" name="worker-name" required />
          </div>
          <Input aria-label="Worker 地址" placeholder="Worker 地址，例如 http://192.168.1.20:9200" name="worker-url" required />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input aria-label="Worker token" placeholder="Worker token（新建可留空自动生成）" type="password" name="worker-token" />
            <Input aria-label="Worker 模型" placeholder="模型标识（可选）" name="worker-model" />
            <Input aria-label="Worker 温度" placeholder="温度" type="number" min={0} max={2} step={0.1} name="worker-temperature" required />
          </div>
          <Input aria-label="Worker IP 白名单" placeholder="IP 白名单，逗号分隔；例如 127.0.0.1, 192.168.1.0/24" name="worker-ip-allowlist" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input aria-label="Worker 磁盘警告阈值" placeholder="磁盘警告阈值（字节）" type="number" min={1} name="worker-disk-warning" required />
            <Input aria-label="Worker 磁盘停止阈值" placeholder="磁盘停止阈值（字节）" type="number" min={1} name="worker-disk-stop" required />
          </div>
          <Button type="submit" variant="primary" loading={busy === 'worker'}><Plus className="h-3.5 w-3.5" aria-hidden="true" />保存 Worker</Button>
        </form>
      </CardContent>
    </Card>
  );
}
