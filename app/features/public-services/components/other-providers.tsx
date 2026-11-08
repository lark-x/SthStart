'use client';

import React, { useState } from 'react';
import type { PublicServiceOverview } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';

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
    <section className="min-w-0 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-ink">向量与图片能力</h2>
        <p className="mt-1 text-sm text-muted">
          接入向量检索嵌入模型与 ComfyUI / 绘图服务。
        </p>
      </div>
      <div className="space-y-4">
        <div className="divide-y divide-border-subtle border-y border-border-subtle record-list">
          {otherProfiles.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3"
            >
              <div>
                <strong className="text-sm font-semibold text-ink">{item.name}</strong>
                <code className="text-sm text-muted block font-mono">
                  {item.kind} / {item.id}
                </code>
              </div>
              <span className="text-sm text-muted">
                {item.baseUrl} · 密钥 {item.hasCredential ? `来自${item.credentialSource}` : '未配置'}
              </span>
            </div>
          ))}
          {otherProfiles.length === 0 && (
            <div className="py-6 text-center text-sm text-muted">
              暂未配置向量或独立生图 Provider
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 pt-3 border-t border-border-subtle">
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
            <label htmlFor="other-provider-kind" className="sr-only">能力类型</label>
            <Select
              id="other-provider-kind"
              aria-label="能力类型"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
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
      </div>
    </section>
  );
}
