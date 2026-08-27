'use client';

import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import type { PublicServiceOverview } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/app/components/ui/card';

export function AppTokens({
  overview,
  onCreateApp,
}: {
  overview?: PublicServiceOverview | null;
  onCreateApp: (id: string, name: string) => Promise<string>;
}) {
  const [appId, setAppId] = useState('');
  const [appName, setAppName] = useState('');
  const [issuedToken, setIssuedToken] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appId.trim() || !appName.trim()) return;
    setLoading(true);
    try {
      const token = await onCreateApp(appId.trim(), appName.trim());
      setIssuedToken(token);
      setAppId('');
      setAppName('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#b83b1b]">
          APPLICATION TOKENS
        </span>
        <CardTitle>已接入应用与令牌</CardTitle>
        <CardDescription>
          应用通过分配的令牌访问公共 LLM、向量与图片能力。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 record-list">
          {overview?.apps.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-3 rounded border border-[rgb(24_32_29/10%)] bg-[#fffdf8]"
            >
              <div>
                <strong className="text-xs font-semibold text-[#18201d]">
                  {item.name}
                  {(item.id === 'linshe' || item.id === 'creative-center') && <span className="system-app-badge ml-1">系统托管</span>}
                </strong>
                <code className="text-[11px] text-[#68716d] block font-mono">{item.id}</code>
              </div>
              <span className="text-[10px] text-[#68716d]">
                {item.capabilities.join(' · ')}
              </span>
            </div>
          ))}
        </div>

        {issuedToken && (
          <div className="p-3.5 rounded bg-[#e45d35]/10 border border-[#e45d35]/30 text-xs text-[#b83b1b] space-y-1 one-time-token">
            <strong className="block font-bold">仅显示一次，请立即保存：</strong>
            <code className="block font-mono bg-white p-2 rounded select-all break-all text-[#18201d]">
              {issuedToken}
            </code>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-[rgb(24_32_29/10%)]">
          <Input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="应用 ID，例如 my-app"
            required
            className="flex-1"
          />
          <Input
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            placeholder="应用名称"
            required
            className="flex-1"
          />
          <Button variant="primary" type="submit" loading={loading}>
            <Plus className="h-3.5 w-3.5" />
            <span>创建应用令牌</span>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
