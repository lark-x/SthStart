'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreativeCharacterVoice, CreativeScope, CreativeScopePolicyView } from '@sthstart/contracts';
import { useWorldBranchDetail } from '@/app/features/story-worlds/queries';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Button } from '@/app/components/ui/button';
import { Alert } from '@/app/components/ui/alert';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Select } from '@/app/components/ui/select';
import { PageTabs } from '@/app/components/ui/page-tabs';
import { creativeApi } from './api';
import { creativeKeys, useAcceptedScenes } from './queries';

const DEFAULT_ANTI_SLOP_PRESET = [
  '一阵复杂的情绪涌上心头',
  '不禁深吸一口气',
  '不仅是……更是……',
  '仿佛在诉说着什么',
  '空气仿佛凝固了',
  '命运的齿轮开始转动',
];

export function ScopePolicy({
  scope,
  defaultTab = 'illustration',
}: {
  scope: CreativeScope;
  defaultTab?: 'style' | 'voices' | 'illustration';
}) {
  const scopeKey = JSON.stringify(scope);
  const query = useQuery({
    queryKey: [...creativeKeys.all, 'scope-policy', scopeKey],
    queryFn: () => creativeApi.scopePolicy(scope),
  });
  const sceneQuery = useAcceptedScenes(scope);
  const branchDetail = useWorldBranchDetail(scope.worldId ?? undefined, scope.branchId ?? undefined);
  const actors = useMemo(
    () =>
      (branchDetail.data?.definition.actors ?? []).map((actor) => ({
        id: actor.id,
        name: actor.name,
      })),
    [branchDetail.data?.definition.actors],
  );
  const scenes = sceneQuery.scenes;

  return (
    <div className="space-y-3">
      {query.isPending && <p className="text-sm text-muted">正在读取创作风格与范围策略…</p>}
      {query.error && <Alert variant="danger">{query.error.message}</Alert>}
      {sceneQuery.error && <Alert variant="danger">场景列表读取失败：{sceneQuery.error.message}</Alert>}
      {query.data && (
        <PolicyForm
          key={`${scopeKey}-${query.data.revision}-${defaultTab}`}
          saved={query.data}
          defaultTab={defaultTab}
          actors={actors}
          scenes={scenes.map((scene) => ({
            id: scene.id,
            title: typeof scene.content.title === 'string' ? scene.content.title : '已采用场景',
            summary: typeof scene.content.summary === 'string' ? scene.content.summary : '',
          }))}
        />
      )}
    </div>
  );
}

function PolicyForm({
  saved,
  defaultTab,
  actors,
  scenes,
}: {
  saved: CreativeScopePolicyView;
  defaultTab: 'style' | 'voices' | 'illustration';
  actors: { id: string; name: string }[];
  scenes: { id: string; title: string; summary: string }[];
}) {
  const [policy, setPolicy] = useState(saved.policy);
  const [tab, setTab] = useState<'style' | 'voices' | 'illustration'>(defaultTab);
  const [selectedActorId, setSelectedActorId] = useState<string>(actors[0]?.id ?? '');
  const [customActorId, setCustomActorId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const client = useQueryClient();

  const styleGuide = policy.styleGuide ?? {};
  const voices = policy.characterVoices ?? {};
  const activeActorKey = selectedActorId || customActorId.trim();
  const currentVoice: CreativeCharacterVoice = activeActorKey
    ? voices[activeActorKey] ?? { voiceSamples: [] }
    : { voiceSamples: [] };

  const updateStyle = (patch: Partial<NonNullable<typeof policy.styleGuide>>) => {
    setPolicy({
      ...policy,
      styleGuide: { ...styleGuide, ...patch },
    });
  };

  const updateVoice = (actorKey: string, next: CreativeCharacterVoice | null) => {
    if (!actorKey) return;
    const copy = { ...voices };
    if (!next || (!next.voiceSamples.length && !next.mannerisms?.trim() && !(next.taboos?.length))) {
      delete copy[actorKey];
    } else {
      copy[actorKey] = next;
    }
    setPolicy({
      ...policy,
      characterVoices: Object.keys(copy).length ? copy : undefined,
    });
  };

  return (
    <form
      aria-label="普通插图自动采用策略"
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        setNotice('');
        try {
          await creativeApi.saveScopePolicy({
            scope: saved.scope,
            expectedRevision: saved.revision,
            policy,
          });
          await client.invalidateQueries({ queryKey: [...creativeKeys.all, 'scope-policy'] });
          setNotice('已保存文风指南、角色声线与采用策略。');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '策略保存失败');
        } finally {
          setBusy(false);
        }
      }}
    >
      <PageTabs
        variant="local"
        ariaLabel="创作质量与策略分类"
        value={tab}
        onChange={(next) => setTab(next as typeof tab)}
        tabs={[
          { id: 'style', label: '文风与反套话' },
          { id: 'voices', label: '角色原声样本' },
          { id: 'illustration', label: '插图自动采用' },
        ]}
      />

      {tab === 'style' && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-muted">
            这些指南会注入场景主笔与审核节点，压制空洞抒情和“AI 腔”，零额外模型调用费。
          </p>
          <label className="co-field">
            整体文风基调
            <Input
              value={styleGuide.tone ?? ''}
              disabled={busy}
              maxLength={500}
              placeholder="例如：冷峻写实、对白交锋克制、用动作与感官代替心理旁白"
              onChange={(event) => updateStyle({ tone: event.target.value })}
            />
          </label>
          <label className="co-field">
            文风示范样段（建议 200–500 字）
            <Textarea
              rows={4}
              value={styleGuide.styleSample ?? ''}
              disabled={busy}
              maxLength={3000}
              placeholder="贴入一段你最满意的原著片段或范文，模型将模仿其句长节奏与留白感。"
              onChange={(event) => updateStyle({ styleSample: event.target.value })}
            />
          </label>
          <label className="co-field">
            节奏与结尾规范
            <Input
              value={styleGuide.pacingHint ?? ''}
              disabled={busy}
              maxLength={500}
              placeholder="例如：结尾停在未竟动作或对话顿挫，不写说教总结。"
              onChange={(event) => updateStyle({ pacingHint: event.target.value })}
            />
          </label>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">禁用套话清单（每行一条）</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => updateStyle({ bannedCliches: DEFAULT_ANTI_SLOP_PRESET })}
              >
                填入常用反套话预设
              </Button>
            </div>
            <Textarea
              rows={3}
              value={(styleGuide.bannedCliches ?? []).join('\n')}
              disabled={busy}
              placeholder="每行填写一个要避免的 AI 高频套话或句式"
              onChange={(event) => {
                const list = event.target.value
                  .split(/\n+/u)
                  .map((item) => item.trim())
                  .filter(Boolean)
                  .slice(0, 50);
                updateStyle({ bannedCliches: list.length ? list : undefined });
              }}
            />
          </div>
        </div>
      )}

      {tab === 'voices' && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-muted">
            为关键角色提供 3–5 句原声台词样本与细微习惯，可有效防止长篇连载中所有人物说话变成同一个腔调。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {actors.length > 0 ? (
              <label className="co-field">
                选择当前作品角色
                <Select
                  value={selectedActorId}
                  disabled={busy}
                  onChange={(event) => setSelectedActorId(event.target.value)}
                >
                  <option value="">手动输入角色标识</option>
                  {actors.map((actor) => (
                    <option key={actor.id} value={actor.id}>
                      {actor.name}（{actor.id}）
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            {(!actors.length || !selectedActorId) && (
              <label className="co-field">
                角色名称或 ID
                <Input
                  value={customActorId}
                  disabled={busy}
                  placeholder="例如：lin 或 沈青"
                  onChange={(event) => setCustomActorId(event.target.value)}
                />
              </label>
            )}
          </div>
          {activeActorKey && (
            <div className="space-y-3 rounded-control bg-surface-sunken p-3">
              <label className="co-field">
                代表性原声对白样本（每行一句，建议 3–5 句）
                <Textarea
                  rows={4}
                  disabled={busy}
                  value={currentVoice.voiceSamples.join('\n')}
                  placeholder={'“账本不在我手里，你找错人了。”\n“把门带上。”'}
                  onChange={(event) => {
                    const samples = event.target.value
                      .split(/\n+/u)
                      .map((line) => line.trim())
                      .filter(Boolean)
                      .slice(0, 10);
                    updateVoice(activeActorKey, { ...currentVoice, voiceSamples: samples });
                  }}
                />
              </label>
              <label className="co-field">
                标志性动作 / 说话习惯
                <Input
                  disabled={busy}
                  value={currentVoice.mannerisms ?? ''}
                  maxLength={400}
                  placeholder="例如：撒谎时指节轻叩桌沿；从不连问两个问题"
                  onChange={(event) =>
                    updateVoice(activeActorKey, {
                      ...currentVoice,
                      mannerisms: event.target.value || undefined,
                    })
                  }
                />
              </label>
              <label className="co-field">
                语言禁忌（每行一条）
                <Textarea
                  rows={2}
                  disabled={busy}
                  value={(currentVoice.taboos ?? []).join('\n')}
                  placeholder="例如：从不向陌生人自报家门；不用网络热词"
                  onChange={(event) => {
                    const taboos = event.target.value
                      .split(/\n+/u)
                      .map((line) => line.trim())
                      .filter(Boolean)
                      .slice(0, 20);
                    updateVoice(activeActorKey, {
                      ...currentVoice,
                      taboos: taboos.length ? taboos : undefined,
                    });
                  }}
                />
              </label>
            </div>
          )}
          {Object.keys(voices).length > 0 && (
            <p className="text-xs text-muted">
              已配置声线角色：{Object.keys(voices).join('、')}
            </p>
          )}
        </div>
      )}

      {tab === 'illustration' && (
        <div className="space-y-3">
          <Checkbox
            label="允许指定场景的普通插图通过审核后自动采用"
            checked={policy.enabled}
            disabled={busy}
            onChange={(event) => setPolicy({ ...policy, enabled: event.target.checked })}
          />
          <p className="text-sm leading-relaxed text-muted">
            只对你勾选的已采用场景生效，仍需独立视觉审核。定妆图、地点基准、关键剧情或重要性不明的内容保留人工确认。
          </p>
          <fieldset className="space-y-3" disabled={busy}>
            <legend className="mb-2 text-sm font-medium">允许的场景</legend>
            {scenes.length === 0 ? (
              <p className="text-sm text-muted">当前范围尚无可选的已采用场景。</p>
            ) : (
              scenes.map((scene) => (
                <Checkbox
                  key={scene.id}
                  label={scene.title}
                  description={scene.summary}
                  checked={policy.allowedSceneArtifactIds.includes(scene.id)}
                  onChange={(event) =>
                    setPolicy({
                      ...policy,
                      allowedSceneArtifactIds: event.target.checked
                        ? [...policy.allowedSceneArtifactIds, scene.id]
                        : policy.allowedSceneArtifactIds.filter((id) => id !== scene.id),
                    })
                  }
                />
              ))
            )}
          </fieldset>
        </div>
      )}

      {error && <Alert variant="danger">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
      <Button type="submit" variant="primary" loading={busy}>
        保存当前范围策略
      </Button>
    </form>
  );
}
