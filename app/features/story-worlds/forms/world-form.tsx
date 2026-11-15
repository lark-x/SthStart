'use client';

import React, { useDeferredValue, useId, useState } from 'react';
import { Library, Plus, RotateCcw, Trash2, UserRound } from 'lucide-react';
import type {
  CharacterProfile,
  CreativeNote,
  NarrativeStoryNode,
  NarrativeWork,
  StoryWorld,
  WorldActor,
  WorldDefinition,
  WorldSource,
  WorldVisualReference,
} from '@sthstart/contracts';
import { Button } from '@/app/components/ui/button';
import { Dialog } from '@/app/components/ui/dialog';
import { FormField } from '@/app/components/ui/form-field';
import { FormSection, ShortFieldGrid } from '@/app/components/ui/form-section';
import { Input } from '@/app/components/ui/input';
import { Select } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { useCharacterBrowser } from '@/app/features/characters/public';
import { fetchCharacterDetail } from '@/app/features/characters/api';
import { fetchReadingNode } from '@/app/features/narrative/api';
import {
  useKnowledgeSourceOptions,
  useNarrativeTreeOptions,
  useNarrativeWorkOptions,
  useNoteSourceOptions,
} from '../hooks/use-external-options';
import { useStoredDraft } from '../hooks/use-stored-draft';
import {
  SOURCE_NATURE_META,
  actorFromCharacterVersion,
  createEmptyActor,
  createEmptyLocation,
  createEmptySource,
  describeError,
  type ModelProfileOption,
  normalizeWorldDefinition,
  sourceFromKnowledge,
  sourceFromNote,
  sourceFromNarrative,
  validateWorldDefinition,
} from '../hooks/world-format';

export interface WorldFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  world?: StoryWorld | null;
  profiles: ModelProfileOption[];
  profilesUnavailable?: boolean;
  onSubmit: (definition: WorldDefinition, expectedRevision?: number) => Promise<StoryWorld>;
  onSaved?: (world: StoryWorld) => void;
}

/**
 * 新世界的默认画风。邻舍的二次元取向以日式动画为准；这里用可读的中文描述，
 * 服务端在提交英文工作流前会把这段风格交给改写模型。
 */
export const DEFAULT_VISUAL_STYLE =
  '日式动画赛璐璐画风，清晰的线稿与平涂上色，柔和渐变光影，二次元角色五官，非写实照片、非三维渲染、非欧美卡通';

function cloneDefinition(world?: StoryWorld | null): WorldDefinition {
  if (!world) {
    return {
      title: '',
      summary: '',
      timeLabel: '故事时间',
      locations: [createEmptyLocation(0)],
      visualReferences: [],
      actors: [],
      sources: [],
      lockedFacts: [],
      models: { action: null, adjudication: null, narration: null },
      // 新世界默认日式动画画风：与邻舍的二次元取向一致，避免默认落成写实照片。
      visualStyle: DEFAULT_VISUAL_STYLE,
    };
  }
  return {
    title: world.title,
    summary: world.summary,
    timeLabel: world.timeLabel,
    startMinuteOfDay: world.startMinuteOfDay,
    locations: world.locations.map((location) => ({ ...location })),
    visualReferences: (world.visualReferences ?? []).map((reference) => ({
      ...reference,
      referenceArtifactIds: [...reference.referenceArtifactIds],
    })),
    actors: world.actors.map((actor) => ({
      ...actor,
      goals: [...actor.goals],
      referenceArtifactIds: [...actor.referenceArtifactIds],
    })),
    sources: world.sources.map((source) => ({ ...source })),
    lockedFacts: [...world.lockedFacts],
    models: { ...world.models },
    visualStyle: world.visualStyle,
  };
}

function createEmptyVisualReference(
  kind: WorldVisualReference['kind'],
  locationId?: string,
): WorldVisualReference {
  return {
    id: `visual-${crypto.randomUUID()}`,
    name: kind === 'location' ? '场景锚点' : '重要道具',
    kind,
    locationId,
    description: '',
    referenceArtifactIds: [],
  };
}

/**
 * 保存前收敛画面参考：丢弃空名称、去重素材 ID、清理已不存在的地点。
 * 场景锚点必须落在有效地点上；道具可以保持不限定地点，只在事件提及时匹配。
 */
function normalizeVisualReferences(
  references: WorldVisualReference[] | undefined,
  locationIds: Set<string>,
): WorldVisualReference[] {
  const seen = new Set<string>();
  const normalized: WorldVisualReference[] = [];
  for (const reference of references ?? []) {
    const name = reference.name.trim();
    if (!name || seen.has(reference.id)) continue;
    const kind: WorldVisualReference['kind'] = reference.kind === 'prop' ? 'prop' : 'location';
    const explicitLocation = reference.locationId && locationIds.has(reference.locationId)
      ? reference.locationId
      : undefined;
    const anchorLocation = kind === 'location'
      ? explicitLocation ?? (locationIds.has(reference.id) ? reference.id : undefined)
      : explicitLocation;
    if (kind === 'location' && !anchorLocation) continue;
    seen.add(reference.id);
    const base: Omit<WorldVisualReference, 'locationId'> = {
      id: reference.id,
      name,
      kind,
      description: reference.description.trim(),
      referenceArtifactIds: [...new Set(
        reference.referenceArtifactIds.map((id) => id.trim()).filter(Boolean),
      )],
    };
    normalized.push(anchorLocation ? { ...base, locationId: anchorLocation } : base);
  }
  return normalized;
}

function formatMinuteOfDay(minute: number | undefined): string {
  if (typeof minute !== 'number' || !Number.isInteger(minute) || minute < 0 || minute > 1439) return '';
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** 空字符串表示未定义；不根据地点或文风反推昼夜。 */
function parseMinuteOfDay(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

export function WorldForm({
  open,
  onOpenChange,
  world,
  profiles,
  profilesUnavailable,
  onSubmit,
  onSaved,
}: WorldFormProps) {
  const formId = useId();
  const draftKey = world ? `edit:${world.id}` : 'create';
  const { draft, setDraft, reset, clear, hasConflict, rebase, baseRevision } = useStoredDraft<WorldDefinition>(
    draftKey,
    () => cloneDefinition(world),
    { open, expectedRevision: world?.revision },
  );
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [characterLoadingId, setCharacterLoadingId] = useState('');
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [sourceTab, setSourceTab] = useState<'knowledge' | 'notes' | 'narrative'>('knowledge');
  const [characterQuery, setCharacterQuery] = useState('');
  const [noteQuery, setNoteQuery] = useState('');
  const deferredNoteQuery = useDeferredValue(noteQuery);
  const [narrativeWorkId, setNarrativeWorkId] = useState('');
  const [narrativeLoadingId, setNarrativeLoadingId] = useState('');
  const characters = useCharacterBrowser(
    { page: 1, pageSize: 12 },
    open && characterPickerOpen,
  );
  const knowledgeSources = useKnowledgeSourceOptions(open && sourcePickerOpen && sourceTab === 'knowledge');
  const notes = useNoteSourceOptions(deferredNoteQuery, open && sourcePickerOpen && sourceTab === 'notes');
  const narrativeWorks = useNarrativeWorkOptions(open && sourcePickerOpen && sourceTab === 'narrative');
  const narrativeTree = useNarrativeTreeOptions(narrativeWorkId, open && sourcePickerOpen && sourceTab === 'narrative');
  const textProfiles = profiles.filter((profile) => profile.capabilities.includes('text'));

  const updateActor = (index: number, patch: Partial<WorldActor>) => {
    setDraft((current) => ({
      ...current,
      actors: current.actors.map((actor, actorIndex) =>
        actorIndex === index ? { ...actor, ...patch } : actor),
    }));
  };

  const updateSource = (index: number, patch: Partial<WorldSource>) => {
    setDraft((current) => ({
      ...current,
      sources: current.sources.map((source, sourceIndex) =>
        sourceIndex === index ? { ...source, ...patch } : source),
    }));
  };

  const updateVisualReference = (index: number, patch: Partial<WorldVisualReference>) => {
    setDraft((current) => ({
      ...current,
      visualReferences: (current.visualReferences ?? []).map((reference, referenceIndex) =>
        referenceIndex === index ? { ...reference, ...patch } : reference),
    }));
  };

  const removeLocation = (locationId: string) => {
    setDraft((current) => {
      const locations = current.locations.filter((location) => location.id !== locationId);
      const fallback = locations[0]?.id ?? '';
      return {
        ...current,
        locations,
        actors: current.actors.map((actor) =>
          actor.locationId === locationId ? { ...actor, locationId: fallback } : actor),
        visualReferences: (current.visualReferences ?? []).flatMap((reference) => {
          if (reference.locationId !== locationId) return [reference];
          if (reference.kind === 'location') return [];
          const next: WorldVisualReference = { ...reference };
          delete next.locationId;
          return [next];
        }),
      };
    });
  };

  const addCharacter = async (profile: CharacterProfile) => {
    const locationId = draft.locations[0]?.id;
    if (!locationId) {
      setValidationError('请先添加一个地点，再引入角色库人物。');
      return;
    }
    if (draft.actors.some((actor) => actor.characterId === profile.id)) {
      setValidationError(`角色库人物「${profile.displayName}」已经在当前世界中。`);
      return;
    }
    if (!profile.latestVersion) {
      setValidationError(`角色「${profile.displayName}」还没有已发布版本，不能建立真实快照。`);
      return;
    }
    setCharacterLoadingId(profile.id);
    setValidationError(null);
    try {
      const detail = await fetchCharacterDetail(profile.id);
      const version = detail.versions.find((item) => item.version === profile.latestVersion)
        ?? [...detail.versions].sort((left, right) => right.version - left.version)[0];
      if (!version) {
        setValidationError(`角色「${profile.displayName}」的已发布版本不可读取。`);
        return;
      }
      setDraft((current) => ({
        ...current,
        actors: [...current.actors, actorFromCharacterVersion(profile, version, current.locations[0]?.id ?? locationId)],
      }));
      setCharacterPickerOpen(false);
    } catch (error) {
      setValidationError(describeError(error));
    } finally {
      setCharacterLoadingId('');
    }
  };

  const addKnowledgeSource = (item: Parameters<typeof sourceFromKnowledge>[0]) => {
    const source = sourceFromKnowledge(item);
    if (draft.sources.some((existing) => existing.id === source.id)) {
      setValidationError('这条资料已经在当前世界中。');
      return;
    }
    setDraft((current) => ({ ...current, sources: [...current.sources, source] }));
    setValidationError(null);
  };

  const addNoteSource = (note: CreativeNote) => {
    const source = sourceFromNote(note);
    if (draft.sources.some((existing) => existing.id === source.id)) {
      setValidationError('这条笔记已经在当前世界中。');
      return;
    }
    setDraft((current) => ({ ...current, sources: [...current.sources, source] }));
    setValidationError(null);
  };

  const addNarrativeSource = async (work: NarrativeWork, node: NarrativeStoryNode) => {
    setNarrativeLoadingId(node.id);
    setValidationError(null);
    try {
      const reading = await fetchReadingNode(node.id);
      const source = sourceFromNarrative(work, node, reading);
      if (draft.sources.some((existing) => existing.id === source.id)) {
        setValidationError('这个叙事节点已经在当前世界中。');
        return;
      }
      setDraft((current) => ({ ...current, sources: [...current.sources, source] }));
    } catch (error) {
      setValidationError(describeError(error));
    } finally {
      setNarrativeLoadingId('');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (world && baseRevision === undefined) {
      setError('缺少草稿的修订基准，请重置草稿后重新编辑。');
      return;
    }
    if (hasConflict) {
      setError('世界设定已在其他窗口更新。请先更新修订基底或重置草稿，再保存。');
      return;
    }
    const normalized = normalizeWorldDefinition(draft);
    if ((normalized.visualReferences ?? []).some((reference) => reference.referenceArtifactIds.length > 10)) {
      setValidationError('每个场景或道具参考最多填写 10 个参考素材 ID。');
      return;
    }
    const { startMinuteOfDay, ...rest } = normalized;
    const definition: WorldDefinition = {
      ...rest,
      visualReferences: normalizeVisualReferences(
        normalized.visualReferences,
        new Set(normalized.locations.map((location) => location.id)),
      ),
      ...(typeof startMinuteOfDay === 'number'
        && Number.isInteger(startMinuteOfDay)
        && startMinuteOfDay >= 0
        && startMinuteOfDay <= 1439
        ? { startMinuteOfDay }
        : {}),
    };
    const validation = validateWorldDefinition(definition);
    if (validation) {
      setValidationError(validation);
      return;
    }
    setValidationError(null);
    setError(null);
    setSubmitting(true);
    try {
      const saved = await onSubmit(definition, world ? baseRevision : undefined);
      clear();
      onOpenChange(false);
      onSaved?.(saved);
    } catch (submitError) {
      setError(describeError(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const resetDraft = () => {
    reset();
    setError(null);
    setValidationError(null);
    setCharacterQuery('');
    characters.change({ q: '' });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
      title={world ? '编辑故事世界' : '创建故事世界'}
      description="世界保存的是角色与来源的快照；运行不会直接改写全局角色卡。"
      size="lg"
      className="max-w-3xl"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={resetDraft} disabled={submitting}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            重置草稿
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={submitting}>
            {world ? '保存世界' : '创建世界'}
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-8" onSubmit={(event) => void handleSubmit(event)}>
        <p className="text-xs leading-relaxed text-muted">
          关闭弹窗不会丢失草稿；保存失败时会保留当前内容，版本冲突则需要刷新后重新提交。
        </p>
        {hasConflict && world && (
          <Alert variant="warning" title="世界设定版本已更新">
            当前世界设定已推进至修订版 {world.revision}（草稿基于旧版本）。
            您可以保留编辑并更新修订基底，或重置草稿。
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" type="button" onClick={() => rebase(world.revision)}>
                更新至 rev {world.revision}
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => reset()}>
                重置草稿
              </Button>
            </div>
          </Alert>
        )}
        {Boolean(error?.trim()) && <Alert variant="danger" title="保存失败">{error}</Alert>}
        {Boolean(validationError?.trim()) && <Alert variant="warning" title="还不能保存">{validationError}</Alert>}
        {profilesUnavailable && (
          <Alert variant="warning" title="模型配置暂不可用">
            无法读取公共模型名称。世界仍可保存和运行，但这里不能确认绑定是否有效。
          </Alert>
        )}

        <FormSection title="世界基础" description="标题与视觉风格会用于后续叙事和配图提示。">
          <FormField label="世界名称" required error={!draft.title.trim() && validationError ? '世界名称不能为空。' : undefined}>
            <Input
              value={draft.title}
              maxLength={200}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="例如：雾港纪事"
            />
          </FormField>
          <FormField label="世界摘要">
            <Textarea
              rows={3}
              value={draft.summary}
              onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}
              placeholder="这个世界的基本状况、冲突和读者需要先知道的事。"
            />
          </FormField>
          <ShortFieldGrid>
            <FormField label="时间标签" hint="用于替代原作没有给出的公历日期。">
              <Input
                value={draft.timeLabel}
                maxLength={200}
                onChange={(event) => setDraft((current) => ({ ...current, timeLabel: event.target.value }))}
              />
            </FormField>
            <FormField label="开始时刻" hint="可选的世界起点日内时刻；留空表示未定义，不会自动推断昼夜。">
              <Input
                type="time"
                value={formatMinuteOfDay(draft.startMinuteOfDay)}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  startMinuteOfDay: parseMinuteOfDay(event.target.value),
                }))}
              />
            </FormField>
          </ShortFieldGrid>
          <FormField label="视觉风格" hint="会作为配图的共同风格约束。">
            <Input
              value={draft.visualStyle}
              maxLength={8000}
              onChange={(event) => setDraft((current) => ({ ...current, visualStyle: event.target.value }))}
              placeholder={`例如：${DEFAULT_VISUAL_STYLE}`}
            />
          </FormField>
        </FormSection>

        <FormSection title="地点" description="建议首版使用 3–5 个地点；人物必须有当前地点。">
          <div className="space-y-3">
            {draft.locations.map((location, index) => (
              <div key={location.id} className="rounded-panel border border-border-subtle bg-surface-sunken/35 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <p className="text-xs font-medium text-muted">地点 {index + 1}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removeLocation(location.id)}
                    disabled={draft.locations.length <= 1}
                    aria-label={`删除地点 ${location.name || index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    删除
                  </Button>
                </div>
                <ShortFieldGrid>
                  <FormField label="地点名称" required>
                    <Input
                      value={location.name}
                      maxLength={200}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        locations: current.locations.map((item) =>
                          item.id === location.id ? { ...item, name: event.target.value } : item),
                      }))}
                    />
                  </FormField>
                  <FormField label="地点说明">
                    <Input
                      value={location.description}
                      maxLength={5000}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        locations: current.locations.map((item) =>
                          item.id === location.id ? { ...item, description: event.target.value } : item),
                      }))}
                    />
                  </FormField>
                </ShortFieldGrid>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => setDraft((current) => ({
                ...current,
                locations: [...current.locations, createEmptyLocation(current.locations.length)],
              }))}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              添加地点
            </Button>
          </div>

          <details className="rounded-panel border border-border-subtle bg-surface-sunken/35 p-4">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-sm font-semibold text-ink">场景与重要道具参考</span>
              <Badge variant="outline">{(draft.visualReferences ?? []).length} 条</Badge>
              <span className="text-xs text-muted">可选</span>
            </summary>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              场景锚点只匹配事件所在地点；道具按所属地点或事件中的名称出现，不会把全部道具塞进每一幅画面。
              这些说明只约束画面，不会写入事件事实或角色记忆。云端多图路径目前实际只发送首张参考图，因此参考顺序以场景锚点优先。
            </p>
            <div className="mt-3 space-y-3">
              {(draft.visualReferences ?? []).map((reference, index) => (
                <div key={reference.id} className="space-y-3 rounded-control border border-border-subtle bg-surface p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs font-medium text-muted">
                      {reference.kind === 'location' ? '场景锚点' : '重要道具'} {index + 1}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setDraft((current) => ({
                        ...current,
                        visualReferences: (current.visualReferences ?? []).filter((item) => item.id !== reference.id),
                      }))}
                      aria-label={`删除参考 ${reference.name || index + 1}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      删除
                    </Button>
                  </div>
                  <ShortFieldGrid>
                    <FormField label="名称" required>
                      <Input
                        value={reference.name}
                        maxLength={200}
                        onChange={(event) => updateVisualReference(index, { name: event.target.value })}
                      />
                    </FormField>
                    <FormField label="类型">
                      <Select
                        value={reference.kind}
                        onChange={(event) => {
                          const kind = event.target.value === 'prop' ? 'prop' : 'location';
                          updateVisualReference(index, kind === 'location'
                            ? { kind, locationId: reference.locationId ?? draft.locations[0]?.id }
                            : { kind });
                        }}
                      >
                        <option value="location">场景锚点</option>
                        <option value="prop">重要道具</option>
                      </Select>
                    </FormField>
                    <FormField
                      label="关联地点"
                      hint={reference.kind === 'prop' ? '留空则仅在事件明确提及时出现。' : '场景锚点必须关联地点。'}
                    >
                      <Select
                        value={reference.locationId ?? ''}
                        onChange={(event) => updateVisualReference(index, { locationId: event.target.value || undefined })}
                      >
                        {reference.kind === 'prop' && <option value="">不限定（按提及匹配）</option>}
                        {draft.locations.map((location) => (
                          <option key={location.id} value={location.id}>{location.name}</option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField label="参考素材 ID" hint="可选；多个 ID 用逗号分隔，最多 10 个。">
                      <Input
                        value={reference.referenceArtifactIds.join(', ')}
                        onChange={(event) => updateVisualReference(index, {
                          referenceArtifactIds: event.target.value.split(/[,，\s]+/).map((value) => value.trim()).filter(Boolean),
                        })}
                      />
                    </FormField>
                  </ShortFieldGrid>
                  <FormField label="画面说明" hint="固定造型、位置关系与材质；仅用于配图，不会成为事件事实。">
                    <Textarea
                      rows={2}
                      value={reference.description}
                      onChange={(event) => updateVisualReference(index, { description: event.target.value })}
                    />
                  </FormField>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDraft((current) => ({
                  ...current,
                  visualReferences: [
                    ...(current.visualReferences ?? []),
                    createEmptyVisualReference('location', current.locations[0]?.id),
                  ],
                }))}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                添加场景锚点
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDraft((current) => ({
                  ...current,
                  visualReferences: [
                    ...(current.visualReferences ?? []),
                    createEmptyVisualReference('prop'),
                  ],
                }))}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                添加道具参考
              </Button>
            </div>
          </details>
        </FormSection>

        <FormSection title="人物" description="可以写原创人物，也可以从角色库建立世界内快照。快照之后仍可单独编辑。">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const locationId = draft.locations[0]?.id;
                if (!locationId) {
                  setValidationError('请先添加一个地点。');
                  return;
                }
                setDraft((current) => ({
                  ...current,
                  actors: [...current.actors, createEmptyActor(current.locations[0]?.id ?? locationId)],
                }));
              }}
            >
              <UserRound className="h-4 w-4" aria-hidden="true" />
              添加原创人物
            </Button>
            <Button type="button" variant="outline" onClick={() => setCharacterPickerOpen((value) => !value)}>
              <Library className="h-4 w-4" aria-hidden="true" />
              从角色库加入
            </Button>
          </div>

          {characterPickerOpen && (
            <div className="space-y-3 rounded-panel border border-border-subtle bg-surface-sunken/35 p-4">
              <Input
                aria-label="搜索角色库"
                placeholder="按名称搜索角色库"
                value={characterQuery}
                onChange={(event) => {
                  setCharacterQuery(event.target.value);
                  characters.change({ q: event.target.value });
                }}
              />
              {characters.isError && (
                <Alert variant="danger" title="角色库读取失败">{describeError(characters.error)}</Alert>
              )}
              {characters.isLoading && <p className="text-sm text-muted">正在读取角色库…</p>}
              {!characters.isLoading && !characters.isError && (characters.data?.items?.length ?? 0) === 0 && (
                <p className="text-sm text-muted">角色库没有匹配人物。可以直接写原创人物。</p>
              )}
              <div className="max-h-56 space-y-1 overflow-y-auto pr-1" data-autohide-scroll>
                {(characters.data?.items ?? []).map((profile: CharacterProfile) => {
                  const added = draft.actors.some((actor) => actor.characterId === profile.id);
                  return (
                    <div key={profile.id} className="flex items-center justify-between gap-3 rounded-control bg-surface px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{profile.displayName}</p>
                        <p className="text-xs text-muted">
                          {profile.latestVersion ? `角色库版本 v${profile.latestVersion}` : '尚未发布版本'}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={added ? 'ghost' : 'secondary'}
                        disabled={added || !profile.latestVersion || characterLoadingId === profile.id}
                        loading={characterLoadingId === profile.id}
                        onClick={() => void addCharacter(profile)}
                      >
                        {added ? '已加入' : profile.latestVersion ? '加入世界' : '无已发布版本'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-3">
            {draft.actors.length === 0 && (
              <p className="rounded-panel border border-dashed border-border-default px-4 py-6 text-center text-sm text-muted">
                还没有人物。至少加入一名主要人物后才能保存世界。
              </p>
            )}
            {draft.actors.map((actor, index) => (
              <details key={actor.id} open={index === 0} className="rounded-panel border border-border-subtle bg-surface-sunken/35 p-4">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                    {actor.name || `未命名人物 ${index + 1}`}
                  </span>
                  <Badge variant={actor.role === 'main' ? 'accent' : 'secondary'}>
                    {actor.role === 'main' ? '主要人物' : '配角'}
                  </Badge>
                  {actor.characterId && (
                    <Badge variant="outline">
                      角色库快照{actor.characterVersion ? ` v${actor.characterVersion}` : ''}
                    </Badge>
                  )}
                  <span className="text-xs text-muted">
                    {draft.locations.find((location) => location.id === actor.locationId)?.name ?? '未设地点'}
                  </span>
                </summary>
                <div className="mt-4 space-y-4">
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setDraft((current) => ({
                        ...current,
                        actors: current.actors.filter((item) => item.id !== actor.id),
                      }))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      移出世界
                    </Button>
                  </div>
                  <ShortFieldGrid>
                    <FormField label="人物名称" required>
                      <Input
                        value={actor.name}
                        maxLength={200}
                        onChange={(event) => updateActor(index, { name: event.target.value })}
                      />
                    </FormField>
                    <FormField label="身份">
                      <Select
                        value={actor.role}
                        onChange={(event) => updateActor(index, { role: event.target.value === 'supporting' ? 'supporting' : 'main' })}
                      >
                        <option value="main">主要人物</option>
                        <option value="supporting">配角</option>
                      </Select>
                    </FormField>
                    <FormField label="当前地点" required>
                      <Select
                        value={actor.locationId}
                        onChange={(event) => updateActor(index, { locationId: event.target.value })}
                      >
                        {draft.locations.map((location) => (
                          <option key={location.id} value={location.id}>{location.name}</option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField label="未来目标" hint="每行一条；会影响人物行动。">
                      <Textarea
                        rows={2}
                        value={actor.goals.join('\n')}
                        onChange={(event) => updateActor(index, { goals: event.target.value.split('\n') })}
                      />
                    </FormField>
                  </ShortFieldGrid>
                  <FormField label="背景与当前处境">
                    <Textarea
                      rows={4}
                      value={actor.background}
                      onChange={(event) => updateActor(index, { background: event.target.value })}
                    />
                  </FormField>
                  <ShortFieldGrid>
                    <FormField label="性格与动机">
                      <Textarea
                        rows={3}
                        value={actor.personality}
                        onChange={(event) => updateActor(index, { personality: event.target.value })}
                      />
                    </FormField>
                    <FormField label="说话方式">
                      <Textarea
                        rows={3}
                        value={actor.speechStyle}
                        onChange={(event) => updateActor(index, { speechStyle: event.target.value })}
                      />
                    </FormField>
                  </ShortFieldGrid>
                  <FormField label="外观与固定参考">
                    <Textarea
                      rows={3}
                      value={actor.appearance}
                      onChange={(event) => updateActor(index, { appearance: event.target.value })}
                    />
                  </FormField>
                  <FormField label="参考素材 ID" hint="可选；多个 ID 用逗号分隔，供配图保持人物外观。">
                    <Input
                      value={actor.referenceArtifactIds.join(', ')}
                      onChange={(event) => updateActor(index, {
                        referenceArtifactIds: event.target.value.split(/[,，\s]+/).map((value) => value.trim()).filter(Boolean),
                      })}
                    />
                  </FormField>
                </div>
              </details>
            ))}
          </div>
        </FormSection>

        <FormSection title="来源资料" description="原作、作者设定和 AI 创作分开标记；运行期间使用固定快照。">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDraft((current) => ({ ...current, sources: [...current.sources, createEmptySource()] }))}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              手动添加来源
            </Button>
            <Button type="button" variant="outline" onClick={() => setSourcePickerOpen((value) => !value)}>
              <Library className="h-4 w-4" aria-hidden="true" />
              从资料库加入
            </Button>
          </div>

          {sourcePickerOpen && (
            <div className="space-y-3 rounded-panel border border-border-subtle bg-surface-sunken/35 p-4">
              <div className="flex flex-wrap gap-1.5">
                {([
                  ['knowledge', '资料库'],
                  ['notes', '笔记'],
                  ['narrative', '叙事档案'],
                ] as const).map(([tab, label]) => (
                  <Button
                    key={tab}
                    type="button"
                    size="sm"
                    variant={sourceTab === tab ? 'secondary' : 'ghost'}
                    onClick={() => setSourceTab(tab)}
                  >
                    {label}
                  </Button>
                ))}
              </div>

              {sourceTab === 'knowledge' && (
                <div className="space-y-3">
                  <p className="text-xs leading-relaxed text-muted">
                    从现有资料库只读载入已保留条目的摘要；加入后成为世界内的来源快照，性质标记为“待核实”。完整正文请粘贴到来源内容中。
                  </p>
                  {knowledgeSources.isError && (
                    <Alert variant="danger" title="资料库读取失败">{describeError(knowledgeSources.error)}</Alert>
                  )}
                  {knowledgeSources.isLoading && <p className="text-sm text-muted">正在读取资料库…</p>}
                  {!knowledgeSources.isLoading && !knowledgeSources.isError
                    && (knowledgeSources.data?.items.length ?? 0) === 0 && (
                      <p className="text-sm text-muted">资料库没有已保留来源；可以手动填写，或先在资料库整理来源。</p>
                    )}
                  <div className="max-h-56 space-y-1 overflow-y-auto pr-1" data-autohide-scroll>
                    {(knowledgeSources.data?.items ?? []).map((item) => {
                      const added = draft.sources.some((source) => source.id === `source-${item.id}`);
                      return (
                        <div key={item.id} className="flex items-start justify-between gap-3 rounded-control bg-surface px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                            <p className="line-clamp-2 text-xs leading-relaxed text-muted">{item.excerpt || '没有摘要'}</p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={added ? 'ghost' : 'secondary'}
                            disabled={added}
                            onClick={() => addKnowledgeSource(item)}
                          >
                            {added ? '已加入' : '加入'}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {sourceTab === 'notes' && (
                <div className="space-y-3">
                  <p className="text-xs leading-relaxed text-muted">
                    读取现有笔记库；加入后成为世界内的来源快照，性质按笔记资料元数据映射，缺省为待核实。
                  </p>
                  <Input
                    aria-label="搜索笔记来源"
                    placeholder="按标题或内容搜索笔记"
                    value={noteQuery}
                    onChange={(event) => setNoteQuery(event.target.value)}
                  />
                  {notes.isError && <Alert variant="danger" title="笔记读取失败">{describeError(notes.error)}</Alert>}
                  {notes.isLoading && <p className="text-sm text-muted">正在读取笔记…</p>}
                  {!notes.isLoading && !notes.isError && (notes.data?.items.length ?? 0) === 0 && (
                    <p className="text-sm text-muted">没有匹配的笔记。</p>
                  )}
                  <div className="max-h-56 space-y-1 overflow-y-auto pr-1" data-autohide-scroll>
                    {(notes.data?.items ?? []).map((note) => {
                      const sourceId = sourceFromNote(note).id;
                      const added = draft.sources.some((source) => source.id === sourceId);
                      return (
                        <div key={note.id ?? note.title} className="flex items-start justify-between gap-3 rounded-control bg-surface px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">{note.title}</p>
                            <p className="line-clamp-2 text-xs leading-relaxed text-muted">{note.summary || '没有摘要'}</p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={added ? 'ghost' : 'secondary'}
                            disabled={added}
                            onClick={() => addNoteSource(note)}
                          >
                            {added ? '已加入' : '加入'}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {sourceTab === 'narrative' && (
                <div className="space-y-3">
                  <p className="text-xs leading-relaxed text-muted">
                    从叙事档案选择作品与节点，读取节点正文后加入；性质标记为待核实，加入后可在来源中调整。
                  </p>
                  {narrativeWorks.isError && (
                    <Alert variant="danger" title="叙事档案读取失败">{describeError(narrativeWorks.error)}</Alert>
                  )}
                  {narrativeWorks.isLoading && <p className="text-sm text-muted">正在读取叙事档案…</p>}
                  <FormField label="叙事作品">
                    <Select
                      value={narrativeWorkId}
                      onChange={(event) => setNarrativeWorkId(event.target.value)}
                    >
                      <option value="">选择作品</option>
                      {(narrativeWorks.data?.items ?? []).map((work) => (
                        <option key={work.id} value={work.id}>{work.title}</option>
                      ))}
                    </Select>
                  </FormField>
                  {narrativeTree.isError && (
                    <Alert variant="danger" title="叙事节点读取失败">{describeError(narrativeTree.error)}</Alert>
                  )}
                  {narrativeTree.isLoading && <p className="text-sm text-muted">正在读取节点…</p>}
                  <div className="max-h-56 space-y-1 overflow-y-auto pr-1" data-autohide-scroll>
                    {(narrativeTree.data?.items ?? []).map((node) => {
                      const added = draft.sources.some((source) => source.id === `source-narrative-${node.id}`);
                      return (
                        <div key={node.id} className="flex items-start justify-between gap-3 rounded-control bg-surface px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">{node.title}</p>
                            <p className="line-clamp-2 text-xs leading-relaxed text-muted">{node.summary || node.kind}</p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={added ? 'ghost' : 'secondary'}
                            disabled={added || narrativeLoadingId === node.id}
                            loading={narrativeLoadingId === node.id}
                            onClick={() => {
                              const work = (narrativeWorks.data?.items ?? []).find((item) => item.id === narrativeWorkId);
                              if (work) void addNarrativeSource(work, node);
                            }}
                          >
                            {added ? '已加入' : '加入'}
                          </Button>
                        </div>
                      );
                    })}
                    {narrativeWorkId && !narrativeTree.isLoading && (narrativeTree.data?.items.length ?? 0) === 0 && (
                      <p className="text-sm text-muted">这个作品没有可用节点。</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            {draft.sources.length === 0 && (
              <p className="rounded-panel border border-dashed border-border-default px-4 py-5 text-center text-sm text-muted">
                还没有来源资料。运行仍可开始，但服务会标注资料缺口。
              </p>
            )}
            {draft.sources.map((source, index) => (
              <details key={source.id} open={index === 0} className="rounded-panel border border-border-subtle bg-surface-sunken/35 p-4">
                <summary className="flex cursor-pointer list-none items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                    {source.title || `未命名来源 ${index + 1}`}
                  </span>
                  <Badge variant={SOURCE_NATURE_META[source.nature].tone}>
                    {SOURCE_NATURE_META[source.nature].label}
                  </Badge>
                </summary>
                <div className="mt-4 space-y-4">
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setDraft((current) => ({
                        ...current,
                        sources: current.sources.filter((item) => item.id !== source.id),
                      }))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      删除来源
                    </Button>
                  </div>
                  <ShortFieldGrid>
                    <FormField label="来源标题" required>
                      <Input
                        value={source.title}
                        maxLength={300}
                        onChange={(event) => updateSource(index, { title: event.target.value })}
                      />
                    </FormField>
                    <FormField label="性质">
                      <Select
                        value={source.nature}
                        onChange={(event) => updateSource(index, { nature: event.target.value as WorldSource['nature'] })}
                      >
                        {Object.entries(SOURCE_NATURE_META).map(([value, meta]) => (
                          <option key={value} value={value}>{meta.label}</option>
                        ))}
                      </Select>
                    </FormField>
                  </ShortFieldGrid>
                  <FormField label="来源内容">
                    <Textarea
                      rows={4}
                      value={source.content}
                      onChange={(event) => updateSource(index, { content: event.target.value })}
                    />
                  </FormField>
                  <ShortFieldGrid>
                    <FormField label="来源链接">
                      <Input
                        value={source.sourceUrl}
                        maxLength={2000}
                        onChange={(event) => updateSource(index, { sourceUrl: event.target.value })}
                      />
                    </FormField>
                    <FormField label="来源版本">
                      <Input
                        value={source.sourceVersion}
                        maxLength={200}
                        onChange={(event) => updateSource(index, { sourceVersion: event.target.value })}
                      />
                    </FormField>
                  </ShortFieldGrid>
                </div>
              </details>
            ))}
          </div>
        </FormSection>

        <FormSection title="禁止改动与模型" description="锁定事实会作为硬约束；模型可分别绑定人物行动、环境裁定和叙事整理。">
          <FormField label="禁止改动的设定" hint="每行一条；运行时由程序校验。">
            <Textarea
              rows={4}
              value={draft.lockedFacts.join('\n')}
              onChange={(event) => setDraft((current) => ({
                ...current,
                lockedFacts: event.target.value.split('\n'),
              }))}
            />
          </FormField>
          <ShortFieldGrid>
            {(['action', 'adjudication', 'narration'] as const).map((purpose) => (
              <FormField
                key={purpose}
                label={purpose === 'action' ? '人物行动模型' : purpose === 'adjudication' ? '环境裁定模型' : '叙事整理模型'}
              >
                <Select
                  value={draft.models[purpose] ?? ''}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    models: { ...current.models, [purpose]: event.target.value || null },
                  }))}
                >
                  <option value="">不单独绑定</option>
                  {textProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}{profile.model ? ` · ${profile.model}` : ''}{profile.enabled ? '' : '（已停用）'}
                    </option>
                  ))}
                </Select>
              </FormField>
            ))}
          </ShortFieldGrid>
        </FormSection>
      </form>
    </Dialog>
  );
}
