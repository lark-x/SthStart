'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ExternalLink, RefreshCw, XCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { ProviderProfile } from '@sthstart/contracts';
import type { CharacterLlmStatusResponse } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Select } from '@/app/components/ui/select';
import { characterKeys } from '@/app/lib/query-keys';
import { usePublicOverview } from '@/app/features/public-services/queries';
import { fetchCharacterLlmStatus, fetchCharacterModelAssignments, updateCharacterModelAssignments } from '../api';

function StatusRow({ label, status }: { label: string; status: CharacterLlmStatusResponse['text'] | undefined }) {
  if (!status) return null;
  const ok = status.ready;
  return (
    <p className={`flex items-start gap-1.5 text-xs ${ok ? 'text-green-700' : 'text-amber-700'}`}>
      {ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span className="min-w-0">
        {label}：
        {ok
          ? <>{status.profile?.name}{status.profile?.model ? <span className="text-muted"> / {status.profile.model}</span> : null}（{status.overridden ? '角色专用' : '沿用角色库'}）</>
          : status.message || '未就绪'}
        {!ok && <Link href="/settings/public-services?section=routing&app=characters" target="_blank" className="ml-1 inline-flex items-center gap-0.5 text-accent underline">去配置<ExternalLink className="h-3 w-3" /></Link>}
      </span>
    </p>
  );
}

export function CharacterModelRoutingPanel({ characterId }: { characterId?: string }) {
  const { data: overview } = usePublicOverview();
  const queryClient = useQueryClient();
  const [textProfileId, setTextProfileId] = useState('');
  const [multimodalProfileId, setMultimodalProfileId] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<CharacterLlmStatusResponse | null>(null);
  const [statusError, setStatusError] = useState(false);
  const textProfiles = (overview?.profiles ?? []).filter((profile: ProviderProfile) => profile.enabled && profile.capabilities.includes('text'));
  const multimodalProfiles = (overview?.profiles ?? []).filter((profile: ProviderProfile) => profile.enabled && profile.capabilities.includes('multimodal'));

  const loadStatus = useCallback(() => {
    if (!characterId) return;
    fetchCharacterLlmStatus(characterId)
      .then((response) => { setStatus(response); setStatusError(false); })
      .catch(() => setStatusError(true));
  }, [characterId]);

  useEffect(() => {
    if (!characterId) return;
    void fetchCharacterModelAssignments(characterId).then((response) => {
      setTextProfileId(response.items.find((item) => item.role === 'text')?.profile_id ?? '');
      setMultimodalProfileId(response.items.find((item) => item.role === 'multimodal')?.profile_id ?? '');
    }).catch(() => setMessage('当前角色模型配置读取失败。'));
    loadStatus();
  }, [characterId, loadStatus]);

  const save = async () => {
    if (!characterId) return;
    setSaving(true); setMessage('');
    try {
      await updateCharacterModelAssignments(characterId, { textProfileId: textProfileId || null, multimodalProfileId: multimodalProfileId || null });
      setMessage('角色模型配置已保存。未选择时沿用角色库应用配置。');
      loadStatus();
      void queryClient.invalidateQueries({ queryKey: characterKeys.llmStatus(characterId) });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '角色模型配置保存失败。');
    } finally { setSaving(false); }
  };

  return (
    <section className="rounded-[var(--radius-panel)] border border-border-subtle bg-surface p-4 space-y-3">
      <div><h4 className="text-sm font-semibold text-ink">角色专用模型配置</h4><p className="mt-0.5 text-sm text-muted">可为试演与识图绑定独立文本/多模态配置；留空则沿用角色库应用配置。</p></div>
      {!characterId ? <p className="text-sm text-muted">保存角色后可配置。</p> : <>
        <div className="rounded border border-border-subtle bg-surface px-3 py-2 space-y-1">
          {statusError ? (
            <button type="button" onClick={loadStatus} className="flex items-center gap-1 text-xs text-muted underline decoration-dotted"><RefreshCw className="h-3 w-3" />暂时无法确认当前模型配置，点击重试</button>
          ) : status ? (
            <>
              <StatusRow label="文本" status={status.text} />
              <StatusRow label="图文" status={status.multimodal} />
            </>
          ) : (
            <p className="text-xs text-muted">正在读取当前模型配置…</p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-muted">文本模型<Select value={textProfileId} onChange={(event) => setTextProfileId(event.target.value)} className="mt-1"><option value="">沿用角色库应用配置</option>{textProfiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name} ({profile.model})</option>)}</Select></label>
          <label className="text-sm font-semibold text-muted">多模态模型<Select value={multimodalProfileId} onChange={(event) => setMultimodalProfileId(event.target.value)} className="mt-1"><option value="">沿用角色库应用配置</option>{multimodalProfiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name} ({profile.model})</option>)}</Select></label>
        </div>
        <Button type="button" size="sm" variant="outline" loading={saving} onClick={() => void save()}>保存角色模型配置</Button>
        {message && <p className="text-sm text-muted">{message}</p>}
      </>}
    </section>
  );
}
