'use client';

import React, { useEffect, useState } from 'react';
import type { ProviderProfile } from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Select } from '@/app/components/ui/select';
import { usePublicOverview } from '@/app/features/public-services/queries';
import { fetchCharacterModelAssignments, updateCharacterModelAssignments } from '../api';

export function CharacterModelRoutingPanel({ characterId }: { characterId?: string }) {
  const { data: overview } = usePublicOverview();
  const [textProfileId, setTextProfileId] = useState('');
  const [multimodalProfileId, setMultimodalProfileId] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const textProfiles = (overview?.profiles ?? []).filter((profile: ProviderProfile) => profile.enabled && profile.capabilities.includes('text'));
  const multimodalProfiles = (overview?.profiles ?? []).filter((profile: ProviderProfile) => profile.enabled && profile.capabilities.includes('multimodal'));

  useEffect(() => {
    if (!characterId) return;
    void fetchCharacterModelAssignments(characterId).then((response) => {
      setTextProfileId(response.items.find((item) => item.role === 'text')?.profile_id ?? '');
      setMultimodalProfileId(response.items.find((item) => item.role === 'multimodal')?.profile_id ?? '');
    }).catch(() => setMessage('当前角色模型配置读取失败。'));
  }, [characterId]);

  const save = async () => {
    if (!characterId) return;
    setSaving(true); setMessage('');
    try {
      await updateCharacterModelAssignments(characterId, { textProfileId: textProfileId || null, multimodalProfileId: multimodalProfileId || null });
      setMessage('角色模型配置已保存。未选择时沿用 characters 应用配置。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '角色模型配置保存失败。');
    } finally { setSaving(false); }
  };

  return (
    <section className="rounded-[4px_16px_4px_4px] border border-[rgb(24_32_29/12%)] bg-surface p-4 space-y-3">
      <div><h4 className="text-sm font-semibold text-ink">角色专用模型配置</h4><p className="mt-0.5 text-sm text-muted">可为试演与识图绑定独立文本/多模态配置；留空则沿用角色库应用配置。</p></div>
      {!characterId ? <p className="text-sm text-muted">保存角色后可配置。</p> : <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-muted">文本模型<Select value={textProfileId} onChange={(event) => setTextProfileId(event.target.value)} className="mt-1"><option value="">沿用 characters 应用配置</option>{textProfiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name} ({profile.model})</option>)}</Select></label>
          <label className="text-sm font-semibold text-muted">多模态模型<Select value={multimodalProfileId} onChange={(event) => setMultimodalProfileId(event.target.value)} className="mt-1"><option value="">沿用 characters 应用配置</option>{multimodalProfiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name} ({profile.model})</option>)}</Select></label>
        </div>
        <Button type="button" size="sm" variant="outline" loading={saving} onClick={() => void save()}>保存角色模型配置</Button>
        {message && <p className="text-sm text-muted">{message}</p>}
      </>}
    </section>
  );
}
