'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Alert } from '@/app/components/ui/alert';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';

/**
 * 把活动内容整理成个人设定。
 * 默认「仅记录」并标注来自哪个活动与当时版本，不冒充原作剧情，也不会自动供其他活动参考。
 */
export function ActivityReflectDialog({ open, onOpenChange, activityId, activityTitle, version, stages }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityId: string;
  activityTitle: string;
  version?: number;
  stages: Array<{ id: string; title: string; instruction: string }>;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [extra, setExtra] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTexts = stages
    .filter((stage) => picked[stage.id])
    .map((stage) => stage.title + '：' + stage.instruction)
    .filter((text) => text.trim().length > 1);

  const save = async () => {
    setError(null);
    if (!selectedTexts.length && !extra.trim()) { setError('请先选择要整理的活动片段，或自己写一段说明。'); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/admin/knowledge/notes/from-activity', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          activityId,
          texts: selectedTexts,
          note: extra.trim(),
          ...(title.trim() ? { title: title.trim() } : {}),
        }),
      });
      const payload = await response.json().catch(() => null) as { noteId?: string; message?: string } | null;
      if (!response.ok || !payload?.noteId) throw new Error(payload?.message || '整理为个人设定失败。');
      void client.invalidateQueries({ queryKey: ['notebook'] });
      onOpenChange(false);
      router.push('/apps/notebook/' + payload.noteId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '整理为个人设定失败。');
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="整理为个人设定"
      description="从这场活动里挑选内容，保存成一篇资料。默认只是「仅记录」，需要时再去资料属性里改成可参考。"
      className="max-w-2xl"
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? '正在保存…' : '保存为个人设定'}</Button>
        </div>
      )}
    >
      <div className="space-y-3 text-sm">
        {error && <Alert variant="danger" title="操作未完成">{error}</Alert>}
        <p className="text-xs text-muted">
          来源：{activityTitle}{version === undefined ? '' : '（草稿 v' + version + '）'}。保存后的资料会注明来自这场活动，不会当作原作剧情。
        </p>
        <div className="space-y-1.5">
          <span className="text-sm font-semibold text-ink">选择片段</span>
          <ul className="max-h-56 space-y-1.5 overflow-y-auto">
            {!stages.length && <li className="text-xs text-muted">这场活动还没有阶段内容可以整理。</li>}
            {stages.map((stage) => (
              <li key={stage.id}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    aria-label={'选择片段 ' + stage.title}
                    checked={Boolean(picked[stage.id])}
                    onChange={(event) => setPicked((current) => ({ ...current, [stage.id]: event.target.checked }))}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">{stage.title}</span>
                    <span className="line-clamp-2 block text-xs text-muted">{stage.instruction}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-ink">补充说明（可选）</span>
          <Textarea aria-label="补充说明" rows={2} value={extra} className="text-sm" placeholder="例如：这次大家约定以后每年都来聚一次" onChange={(event) => setExtra(event.target.value)} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-ink">资料标题（可选）</span>
          <Input aria-label="资料标题" value={title} className="h-9 text-sm" placeholder={'留空则使用「活动记录：' + activityTitle + '」'} onChange={(event) => setTitle(event.target.value)} />
        </label>
      </div>
    </Dialog>
  );
}
