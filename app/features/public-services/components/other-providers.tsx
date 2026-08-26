'use client';

import React, { useState } from 'react';
import type { PublicServiceOverview } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/app/components/ui/card';

export function OtherProviders({
  overview,
  onSaveOther,
}: {
  overview?: PublicServiceOverview | null;
  onSaveOther: (payload: unknown) => Promise<void>;
}) {
  const otherProfiles = overview?.profiles.filter((p) => p.kind !== 'llm') ?? [];

  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'vector' | 'image'>('vector');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onSaveOther({
        id,
        name,
        kind,
        baseUrl,
        model: model || null,
        secret: secret || undefined,
        headers: {},
        extraBody: {},
      });
      setId('');
      setName('');
      setBaseUrl('');
      setModel('');
      setSecret('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[#b83b1b]">
          OTHER CAPABILITIES
        </span>
        <CardTitle>向量与图片能力</CardTitle>
        <CardDescription>
          接入向量检索嵌入模型与 ComfyUI / 绘图服务。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 record-list">
          {otherProfiles.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-3 rounded border border-[rgb(24_32_29/10%)] bg-[#fffdf8]"
            >
              <div>
                <strong className="text-xs font-semibold text-[#18201d]">{item.name}</strong>
                <code className="text-[11px] text-[#68716d] block font-mono">
                  {item.kind} / {item.id}
                </code>
              </div>
              <span className="text-[10px] text-[#68716d]">
                {item.baseUrl} · 密钥 {item.hasCredential ? `来自${item.credentialSource}` : '未配置'}
              </span>
            </div>
          ))}
          {otherProfiles.length === 0 && (
            <div className="p-4 text-center text-xs text-[#68716d] border border-dashed border-[rgb(24_32_29/14%)] rounded">
              暂未配置向量或独立生图 Provider
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 pt-3 border-t border-[rgb(24_32_29/10%)]">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="配置 ID"
              required
            />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="显示名称"
              required
            />
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="vector">向量</option>
              <option value="image">图片 / ComfyUI</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="上游 Base URL"
              required
            />
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="模型（可留空）"
            />
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="API Key（可选）"
              autoComplete="new-password"
            />
          </div>

          <div className="flex justify-end">
            <Button variant="primary" size="sm" type="submit" loading={loading}>
              保存能力配置
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

