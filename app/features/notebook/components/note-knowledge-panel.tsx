'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ExternalLink, Link2, Plus, Trash2 } from 'lucide-react';
import type {
  CreativeNote, KnowledgeSourceRef, NoteAuthorship, NoteCategory, NoteKnowledge, NoteNature, NoteUsage,
} from '@sthstart/contracts';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { authorshipLabels, categoryLabels, natureLabels, usageLabels } from '../schemas';
import { useNoteReferences } from '../queries';
import { getJson } from '@/app/lib/api-client';

const EMPTY_KNOWLEDGE: NoteKnowledge = {
  schemaVersion: 1,
  works: [],
  characters: [],
  locations: [],
  nature: 'unconfirmed',
  authorship: 'handwritten',
  usage: 'record',
  sources: [],
};

function splitList(value: string, limit: number): string[] {
  return [...new Set(value.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

/**
 * 资料属性：内容性质、形成方式与使用状态三条轴，加上作品/角色/地点/分类与来源。
 * 默认收起，避免把技术字段铺在正文上方。
 */
export function NoteKnowledgePanel({ note, knowledge, onChange }: {
  note: CreativeNote;
  knowledge: NoteKnowledge | null | undefined;
  onChange: (next: NoteKnowledge) => void;
}) {
  const [open, setOpen] = useState(false);
  const [originals, setOriginals] = useState<Record<string, string>>({});
  const [worksText, setWorksText] = useState('');
  const [charactersText, setCharactersText] = useState('');
  const [locationsText, setLocationsText] = useState('');
  const [sourceDraft, setSourceDraft] = useState({ title: '', url: '', excerpt: '' });
  const current = useMemo<NoteKnowledge>(() => knowledge ?? EMPTY_KNOWLEDGE, [knowledge]);
  const references = useNoteReferences(open && note.id ? note.id : undefined);

  const patch = (changes: Partial<NoteKnowledge>) => onChange({ ...current, ...changes });

  const addWorks = () => {
    const added = splitList(worksText, 20).map((name) => ({ key: name, name }));
    if (!added.length) return;
    const merged = [...current.works];
    for (const work of added) if (!merged.some((item) => item.key === work.key)) merged.push(work);
    patch({ works: merged.slice(0, 20) });
    setWorksText('');
  };

  const addCharacters = () => {
    const added = splitList(charactersText, 50).map((name) => ({ work: '', name }));
    if (!added.length) return;
    const merged = [...current.characters];
    for (const character of added) {
      if (!merged.some((item) => item.work === character.work && item.name === character.name)) merged.push(character);
    }
    patch({ characters: merged.slice(0, 50) });
    setCharactersText('');
  };

  const addLocations = () => {
    const added = splitList(locationsText, 30).map((name) => ({ work: '', name }));
    if (!added.length) return;
    const merged = [...current.locations];
    for (const location of added) {
      if (!merged.some((item) => item.work === location.work && item.name === location.name)) merged.push(location);
    }
    patch({ locations: merged.slice(0, 30) });
    setLocationsText('');
  };

  const addSource = () => {
    const title = sourceDraft.title.trim();
    const excerpt = sourceDraft.excerpt.trim();
    if (!title && !excerpt) return;
    const source: KnowledgeSourceRef = {
      id: (crypto.randomUUID?.() ?? String(Date.now())),
      kind: sourceDraft.url.trim() ? 'web' : 'manual',
      title: title || excerpt.slice(0, 60),
      excerpt,
      ...(sourceDraft.url.trim() ? { url: sourceDraft.url.trim() } : {}),
    };
    patch({ sources: [...current.sources, source].slice(0, 30) });
    setSourceDraft({ title: '', url: '', excerpt: '' });
  };

  return (
    <section className="rounded-lg border border-border-subtle bg-surface-muted/60" aria-label="资料属性">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-ink"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        资料属性
        <Badge variant={current.usage === 'reference' ? 'online' : 'stopped'} className="text-xs">{usageLabels[current.usage]}</Badge>
        <Badge variant="outline" className="text-xs">{natureLabels[current.nature]}</Badge>
        {!!current.works.length && <span className="text-xs font-normal text-muted">{current.works.map((work) => work.name).join('、')}</span>}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border-subtle px-3 py-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs text-muted">内容性质</span>
              <Select aria-label="内容性质" value={current.nature} className="h-8 text-sm" onChange={(event) => patch({ nature: event.target.value as NoteNature })}>
                {Object.entries(natureLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted">形成方式</span>
              <Select aria-label="形成方式" value={current.authorship} className="h-8 text-sm" onChange={(event) => patch({ authorship: event.target.value as NoteAuthorship })}>
                {Object.entries(authorshipLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted">使用状态</span>
              <Select aria-label="使用状态" value={current.usage} className="h-8 text-sm" onChange={(event) => patch({ usage: event.target.value as NoteUsage })}>
                {Object.entries(usageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </label>
          </div>
          {current.usage !== 'reference' && (
            <p className="text-xs text-muted">当前是「{usageLabels[current.usage]}」：不会自动进入企划检索参考，仍可在企划里显式选择本次使用。</p>
          )}

          <label className="block space-y-1">
            <span className="text-xs text-muted">资料类型</span>
            <Select aria-label="资料类型" value={current.category ?? ''} className="h-8 text-sm" onChange={(event) => patch({ category: (event.target.value || undefined) as NoteCategory | undefined })}>
              <option value="">未分类</option>
              {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </label>

          <div className="space-y-1.5">
            <span className="text-xs text-muted">作品</span>
            <div className="flex flex-wrap gap-1.5">
              {current.works.map((work) => (
                <button key={work.key} type="button" className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent-dark" onClick={() => patch({ works: current.works.filter((item) => item.key !== work.key) })}>
                  {work.name} ×
                </button>
              ))}
              {!current.works.length && <span className="text-xs text-muted">未填写</span>}
            </div>
            <div className="flex gap-2">
              <Input aria-label="添加作品" value={worksText} placeholder="输入作品名，可用逗号分隔" className="h-8 text-sm" onChange={(event) => setWorksText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addWorks(); } }} />
              <Button size="sm" variant="outline" onClick={addWorks}><Plus className="h-3.5 w-3.5" />添加</Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs text-muted">角色</span>
            <div className="flex flex-wrap gap-1.5">
              {current.characters.map((character) => (
                <button key={character.work + '|' + character.name} type="button" className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent-dark" onClick={() => patch({ characters: current.characters.filter((item) => !(item.work === character.work && item.name === character.name)) })}>
                  {character.name}{character.work ? '（' + character.work + '）' : ''} ×
                </button>
              ))}
              {!current.characters.length && <span className="text-xs text-muted">未填写；同名角色不会跨作品自动合并</span>}
            </div>
            <div className="flex gap-2">
              <Input aria-label="添加角色" value={charactersText} placeholder="输入角色名，可用逗号分隔" className="h-8 text-sm" onChange={(event) => setCharactersText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCharacters(); } }} />
              <Button size="sm" variant="outline" onClick={addCharacters}><Plus className="h-3.5 w-3.5" />添加</Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs text-muted">地点</span>
            <div className="flex flex-wrap gap-1.5">
              {current.locations.map((location) => (
                <button key={location.work + '|' + location.name} type="button" className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent-dark" onClick={() => patch({ locations: current.locations.filter((item) => !(item.work === location.work && item.name === location.name)) })}>
                  {location.name} ×
                </button>
              ))}
              {!current.locations.length && <span className="text-xs text-muted">未填写</span>}
            </div>
            <div className="flex gap-2">
              <Input aria-label="添加地点" value={locationsText} placeholder="输入地点名，可用逗号分隔" className="h-8 text-sm" onChange={(event) => setLocationsText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addLocations(); } }} />
              <Button size="sm" variant="outline" onClick={addLocations}><Plus className="h-3.5 w-3.5" />添加</Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs text-muted">来源与摘录（{current.sources.length}）</span>
            {!current.sources.length && <p className="text-xs text-muted">还没有来源。可从叙事档案摘录，或在这里补一条手工出处。</p>}
            <ul className="space-y-1.5">
              {current.sources.map((source) => (
                <li key={source.id} className="rounded border border-border-subtle bg-surface p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-ink">{source.title}</p>
                      {source.excerpt && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{source.excerpt}</p>}
                      {typeof source.locator?.sourceVersionId === 'string' && (
                        <details className="mt-1 text-xs" onToggle={(event) => {
                          if (!event.currentTarget.open || originals[source.id]) return;
                          void getJson<{ excerpt: string; truncated?: boolean }>('knowledge/source-versions/' + encodeURIComponent(String(source.locator?.sourceVersionId)))
                            .then(version => setOriginals(current => ({ ...current, [source.id]: version.excerpt + (version.truncated ? '\n（搜集时已截断）' : '') })))
                            .catch(() => setOriginals(current => ({ ...current, [source.id]: '原文版本已不可用，仍可查看上方保存的摘录。' })));
                        }}>
                          <summary className="cursor-pointer text-accent">查看整理时的原文</summary>
                          <p className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap">{originals[source.id] ?? '正在读取…'}</p>
                        </details>
                      )}
                      {source.url && (
                        <a href={source.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-accent hover:underline">
                          <Link2 className="h-3 w-3" />来源链接<ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <button type="button" aria-label="移除来源" className="shrink-0 text-fg-subtle hover:text-danger-fg" onClick={() => patch({ sources: current.sources.filter((item) => item.id !== source.id) })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="space-y-1.5 rounded border border-dashed border-border-default p-2">
              <Input aria-label="来源标题" value={sourceDraft.title} placeholder="来源标题" className="h-8 text-sm" onChange={(event) => setSourceDraft((draft) => ({ ...draft, title: event.target.value }))} />
              <Input aria-label="来源链接" value={sourceDraft.url} placeholder="来源链接（可选）" className="h-8 text-sm" onChange={(event) => setSourceDraft((draft) => ({ ...draft, url: event.target.value }))} />
              <Textarea aria-label="来源摘录" rows={2} value={sourceDraft.excerpt} placeholder="原始摘录：AI 摘要不会覆盖这里" className="text-sm" onChange={(event) => setSourceDraft((draft) => ({ ...draft, excerpt: event.target.value }))} />
              <Button size="sm" variant="outline" onClick={addSource}><Plus className="h-3.5 w-3.5" />添加来源</Button>
            </div>
          </div>

          <div className="space-y-1.5 border-t border-border-subtle pt-2">
            <span className="text-xs text-muted">引用记录</span>
            {!note.id && <p className="text-xs text-muted">保存后才能查看引用记录。</p>}
            {note.id && references.data?.items.length === 0 && <p className="text-xs text-muted">还没有被任何企划或活动引用。</p>}
            <ul className="space-y-1">
              {(references.data?.items ?? []).slice(0, 6).map((record) => (
                <li key={record.id} className="text-xs text-muted">
                  {record.createdAt.slice(0, 16).replace('T', ' ')}
                  {record.activityId ? <Link href={'/apps/activities/' + record.activityId} className="ml-2 text-accent hover:underline">查看活动</Link> : record.sessionId ? <span className="ml-2">企划会话 {record.sessionId.slice(0, 8)}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
