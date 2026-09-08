'use client';
import React, { useEffect, useState } from 'react';
import type { SourceRef } from '@sthstart/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { fetchActivity, fetchDraft, fetchImageConfigDraft, saveDraft, commitDraft, commitImageConfigRevision } from '../api';
import { Dialog } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { Textarea } from '@/app/components/ui/textarea';

/** Edit the exact local entity field; never mutate the shared character library. */
export function SourceFieldEditor({ activityId, source, onClose, onSaved }: {
  activityId: string; source: SourceRef; onClose: () => void; onSaved: () => void;
}) {
  const client = useQueryClient();
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const parts = source.fieldPath.replace(/^.*\]\./, '').split(/[/.]/).filter(Boolean);
  if (['activity', 'actor', 'stage', 'fact'].includes(parts[0])) parts.shift();
  const entity = (doc: any) => {
    if (source.ownerKind === 'image_config') {
      if (source.entityKind === 'style') return doc;
      return doc.slotConfigs.find((s: any) => s.slotId === source.entityId);
    }
    const collection: Record<string, string> = { actor: 'actors', stage: 'stages', fact: 'facts', shot: 'mediaSlots' };
    return source.entityKind === 'activity' ? doc.activity : doc[collection[source.entityKind]]?.find((r: any) => r.id === source.entityId);
  };
  useEffect(() => {
    let active = true;
    Promise.all([fetchActivity(activityId), source.ownerKind === 'image_config' ? fetchImageConfigDraft(activityId) : fetchDraft(activityId).then(r => r.draft)])
      .then(([activity, draft]) => {
        if (!active) return;
        const target = entity(draft.document);
        if (!target) throw new Error('来源实体已删除；历史值仍可查看，请在当前活动创建新内容。');
        let value = target;
        for (const part of parts) value = value?.[part];
        setText(typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2));
        setLoaded({ activity: activity.activity, draft, structured: typeof value === 'object' && value !== null });
      }).catch(e => active && setError(String(e)));
    return () => { active = false; };
  }, [activityId, source.id]);
  async function save() {
    if (!loaded) return;
    setBusy(true); setError('');
    try {
      const document = structuredClone(loaded.draft.document);
      let target = entity(document);
      for (const part of parts.slice(0, -1)) {
        if (['__proto__', 'constructor', 'prototype'].includes(part)) throw new Error('无效字段');
        target[part] ??= {}; target = target[part];
      }
      const key = parts.at(-1)!;
      if (!key || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('无效字段');
      target[key] = loaded.structured ? JSON.parse(text) : text;
      if (source.ownerKind === 'image_config') {
        await commitImageConfigRevision(activityId, document, loaded.draft.draftVersion, loaded.activity.headVersion);
      } else {
        const saved = await saveDraft(activityId, loaded.draft.draftVersion, document);
        await commitDraft(activityId, loaded.activity.headVersion, saved.draftVersion);
      }
      await client.invalidateQueries(); onSaved(); onClose();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => !open && onClose()} title={`修改来源：${source.labelSnapshot}`}>
    <div className="space-y-4">
      <p className="text-sm">本场实体：{source.entityId} · 字段：{source.fieldPath}</p>
      <div className="text-sm whitespace-pre-wrap">生成当时的值：{typeof source.valueSnapshot === 'string' ? source.valueSnapshot : JSON.stringify(source.valueSnapshot)}</div>
      <label className="block">当前字段值<Textarea autoFocus value={text} onChange={e => setText(e.target.value)} disabled={!loaded || busy} rows={7} /></label>
      <p className="text-sm">保存为本场新版本后，请重新准备配方。公共角色资料不会被修改。</p>
      {error && <p role="alert">{error}</p>}
      <Button onClick={save} disabled={!loaded || busy}>保存本场来源并发布版本</Button>
    </div>
  </Dialog>;
}
