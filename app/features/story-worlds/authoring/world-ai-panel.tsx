'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link2, RefreshCw, Sparkles, Undo2 } from 'lucide-react';
import type {
  WorldActor,
  WorldAuthoringDraft,
  WorldLocation,
  WorldSuggestionCandidate,
  WorldSuggestionResponse,
} from '@sthstart/contracts';
import { Alert } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Checkbox } from '@/app/components/ui/checkbox';
import { CjkTextarea } from '@/app/components/ui/cjk-textarea';
import { FormField } from '@/app/components/ui/form-field';
import { Select } from '@/app/components/ui/select';
import { Spinner } from '@/app/components/ui/spinner';
import { cn } from '@/app/lib/cn';
import { describeError } from '../hooks/world-format';
import { ApiClientError } from '@/app/lib/api-client';
import {
  WORLD_TARGET_LABELS,
  candidateAfter,
  candidateBefore,
  candidateChangesDraft,
  draftFingerprint,
  orderCandidates,
  postWorldSuggestions,
  validateSelection,
} from './model';

export type WorldAiScope = 'all' | 'world' | 'actors' | 'locations' | 'direction';

/**
 * 一次“已核对”的凭据：绑定确认当时的字段内容与来源内容摘要。
 * 任一摘要与当前草稿不符，这次确认即失效，必须重新核对。
 */
export interface WorldAiConfirmation {
  candidateId: string;
  fieldSnapshot: string;
  sourceSnapshot: string;
}

/** 候选勾选状态；随草稿信封持久化，刷新后原样恢复。 */
export interface WorldAiPersistedSelection {
  selectedIds: string[];
  /** 用户显式勾选的候选；缺省时把 selectedIds 视为全部显式勾选。 */
  manualIds?: string[];
  /** 用户显式取消的候选；自动依赖不会覆盖这里的取消。 */
  excludedIds?: string[];
  confirmations?: WorldAiConfirmation[];
  /** 旧字段，缺少快照无法核验，恢复时一律忽略并要求重新核对。 */
  confirmedIds?: string[];
}

export interface WorldAiPanelProps {
  draft: WorldAuthoringDraft;
  fingerprint: string;
  onApply: (candidates: WorldSuggestionCandidate[]) => void;
  onUndo: () => void;
  canUndo: boolean;
  staleNotice?: string | null;
  /** 页面从草稿信封恢复的上一次建议；传入后直接显示候选。 */
  initialRun?: WorldAiRun | null;
  /** 与 initialRun 配套的勾选恢复；不传则默认全部不勾选。 */
  initialSelection?: WorldAiPersistedSelection | null;
  /** run 或勾选变化时回传，供页面写进草稿信封；卸载时不回调。 */
  onStateChange?: (state: WorldAiPersistedState | null) => void;
}

export interface WorldAiPersistedState {
  run: WorldAiRun;
  selectedIds: string[];
  manualIds: string[];
  excludedIds: string[];
  confirmations: WorldAiConfirmation[];
}

const SCOPE_OPTIONS: ReadonlyArray<{ value: WorldAiScope; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'world', label: '世界设定' },
  { value: 'actors', label: '人物' },
  { value: 'locations', label: '地点' },
  { value: 'direction', label: '故事方向' },
];

const SCOPE_LABELS: Record<WorldAiScope, string> = {
  all: '全部',
  world: '世界设定',
  actors: '人物',
  locations: '地点',
  direction: '故事方向',
};

const INSTRUCTION_MAX = 8000;

export interface WorldAiDependencyView {
  id: string;
  label: string;
  kind: 'candidate' | 'actor' | 'location' | 'unknown';
  selected: boolean;
}

export interface WorldAiCandidateView {
  candidate: WorldSuggestionCandidate;
  targetLabel: string;
  title: string;
  before: string;
  after: string;
  note: string;
  sources: Array<{ id: string; title: string; missing: boolean; changedSinceRequest: boolean }>;
  dependencies: WorldAiDependencyView[];
  changesDraft: boolean;
  changedSinceRequest: boolean;
  needsConfirmation: boolean;
  confirmed: boolean;
  sourcesChanged: boolean;
  missingLocation: { id: string; name: string } | null;
}

export interface WorldAiReview {
  items: WorldAiCandidateView[];
  selected: WorldSuggestionCandidate[];
  selectedCount: number;
  blockers: string[];
  canApply: boolean;
  stale: boolean;
  changedCount: number;
  sourcesChangedCount: number;
}

export interface WorldAiReviewInput {
  draft: WorldAuthoringDraft;
  candidates: WorldSuggestionCandidate[];
  selectedIds: readonly string[];
  confirmations: readonly WorldAiConfirmation[];
  /** 发起请求时的草稿快照；没有快照时不做“请求后已修改”判断。 */
  baseDraft?: WorldAuthoringDraft | null;
  responseFingerprint: string;
  currentFingerprint: string;
}

function candidateName(candidate: WorldSuggestionCandidate): string {
  if (candidate.target === 'actor') return (candidate.value as WorldActor).name || candidate.id;
  if (candidate.target === 'location') return (candidate.value as WorldLocation).name || candidate.id;
  return WORLD_TARGET_LABELS[candidate.target];
}

function candidateTitle(candidate: WorldSuggestionCandidate): string {
  if (candidate.target === 'actor') return `人物·${candidateName(candidate)}`;
  if (candidate.target === 'location') return `地点·${candidateName(candidate)}`;
  return WORLD_TARGET_LABELS[candidate.target];
}

/** 目标字段的当前内容；只用于比较“请求后是否被改过”，不做展示。 */
function targetSnapshot(draft: WorldAuthoringDraft, candidate: WorldSuggestionCandidate): string {
  const definition = draft.definition;
  switch (candidate.target) {
    case 'title':
      return JSON.stringify(definition.title);
    case 'summary':
      return JSON.stringify(definition.summary);
    case 'timeLabel':
      return JSON.stringify(definition.timeLabel);
    case 'startMinuteOfDay':
      return JSON.stringify(definition.startMinuteOfDay ?? null);
    case 'visualStyle':
      return JSON.stringify(definition.visualStyle);
    case 'lockedFacts':
      return JSON.stringify(definition.lockedFacts);
    case 'direction':
      return JSON.stringify(draft.initialBranch.direction);
    case 'actor': {
      const existing = candidate.entityId
        ? definition.actors.find((actor) => actor.id === candidate.entityId)
        : undefined;
      return JSON.stringify(existing ?? null);
    }
    case 'location': {
      const existing = candidate.entityId
        ? definition.locations.find((location) => location.id === candidate.entityId)
        : undefined;
      return JSON.stringify(existing ?? null);
    }
    default:
      return 'null';
  }
}

function sourceBodySnapshot(source: WorldAuthoringDraft['definition']['sources'][number]): string {
  return JSON.stringify([
    source.title,
    source.nature,
    source.content,
    source.sourceUrl,
    source.sourceVersion,
    source.capturedAt,
  ]);
}

/**
 * 候选引用来源的内容摘要。同 ID 但正文、版本或采集时间变了，摘要就会不同：
 * 只按 ID 存在无法证明候选仍基于当前资料。
 */
export function sourceSnapshotOf(draft: WorldAuthoringDraft, candidate: WorldSuggestionCandidate): string {
  const byId = new Map(draft.definition.sources.map((source) => [source.id, source]));
  return JSON.stringify(candidate.sourceIds.map((sourceId) => {
    const source = byId.get(sourceId);
    return source ? [sourceId, sourceBodySnapshot(source)] : [sourceId, null];
  }));
}

/** 一次“已核对”的凭据：绑定确认当时的字段内容与来源内容。 */
export function confirmationFor(
  draft: WorldAuthoringDraft,
  candidate: WorldSuggestionCandidate,
): WorldAiConfirmation {
  return {
    candidateId: candidate.id,
    fieldSnapshot: targetSnapshot(draft, candidate),
    sourceSnapshot: sourceSnapshotOf(draft, candidate),
  };
}

/** 确认凭据是否仍与当前草稿一致；任何一处变了就作废。 */
export function isConfirmationCurrent(
  draft: WorldAuthoringDraft,
  candidate: WorldSuggestionCandidate,
  confirmation: WorldAiConfirmation | undefined,
): boolean {
  if (!confirmation || confirmation.candidateId !== candidate.id) return false;
  const current = confirmationFor(draft, candidate);
  return confirmation.fieldSnapshot === current.fieldSnapshot
    && confirmation.sourceSnapshot === current.sourceSnapshot;
}

/**
 * 候选的展示与采纳门禁：依赖、缺失地点、请求后改动和过期判定都在这里汇总。
 * 组件只负责渲染，页面只负责真正写入草稿。
 */
export function reviewWorldAiCandidates(input: WorldAiReviewInput): WorldAiReview {
  const { draft, candidates, baseDraft } = input;
  const selectedIds = new Set(input.selectedIds);
  const confirmationsById = new Map(
    input.confirmations.map((confirmation) => [confirmation.candidateId, confirmation]),
  );
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const sourcesById = new Map(draft.definition.sources.map((source) => [source.id, source]));
  const baseSourcesById = new Map(
    (baseDraft?.definition.sources ?? []).map((source) => [source.id, source]),
  );
  const actorNames = new Map(draft.definition.actors.map((actor) => [actor.id, actor.name]));
  const locationNames = new Map(draft.definition.locations.map((location) => [location.id, location.name]));
  const draftLocationIds = new Set(draft.definition.locations.map((location) => location.id));
  const selectedLocationIds = new Set(
    candidates
      .filter((candidate) => selectedIds.has(candidate.id) && candidate.target === 'location')
      .map((candidate) => (candidate.value as WorldLocation).id),
  );
  const blockers: string[] = [];

  const items = candidates.map<WorldAiCandidateView>((candidate) => {
    const targetLabel = WORLD_TARGET_LABELS[candidate.target];
    const changesDraft = candidateChangesDraft(draft, candidate);
    const changedSinceRequest = baseDraft
      ? targetSnapshot(baseDraft, candidate) !== targetSnapshot(draft, candidate)
      : false;
    const sources = candidate.sourceIds.map((sourceId) => {
      const source = sourcesById.get(sourceId);
      const baseSource = baseSourcesById.get(sourceId);
      const contentChanged = Boolean(baseDraft)
        && (source === undefined || baseSource === undefined
          ? source !== baseSource
          : sourceBodySnapshot(source) !== sourceBodySnapshot(baseSource));
      return {
        id: sourceId,
        title: source?.title ?? sourceId,
        missing: source === undefined,
        changedSinceRequest: contentChanged,
      };
    });
    const sourcesChanged = sources.some((source) => source.missing || source.changedSinceRequest);
    const confirmed = isConfirmationCurrent(draft, candidate, confirmationsById.get(candidate.id));
    const dependencies = candidate.dependsOn.map<WorldAiDependencyView>((dependencyId) => {
      const dependencyCandidate = candidatesById.get(dependencyId);
      if (dependencyCandidate) {
        return {
          id: dependencyId,
          label: candidateTitle(dependencyCandidate),
          kind: 'candidate',
          selected: selectedIds.has(dependencyId),
        };
      }
      if (actorNames.has(dependencyId)) {
        return { id: dependencyId, label: `人物·${actorNames.get(dependencyId)}`, kind: 'actor', selected: true };
      }
      if (locationNames.has(dependencyId)) {
        return { id: dependencyId, label: `地点·${locationNames.get(dependencyId)}`, kind: 'location', selected: true };
      }
      return { id: dependencyId, label: dependencyId, kind: 'unknown', selected: false };
    });

    let missingLocation: { id: string; name: string } | null = null;
    if (candidate.target === 'actor') {
      const actor = candidate.value as WorldActor;
      if (!draftLocationIds.has(actor.locationId) && !selectedLocationIds.has(actor.locationId)) {
        missingLocation = { id: actor.locationId, name: actor.name || actor.id };
      }
    }

    return {
      candidate,
      targetLabel,
      title: candidateTitle(candidate),
      before: candidateBefore(draft, candidate),
      after: candidateAfter(candidate),
      note: candidate.note.trim(),
      sources,
      dependencies,
      changesDraft,
      changedSinceRequest,
      needsConfirmation: changesDraft && (changedSinceRequest || sourcesChanged),
      confirmed,
      sourcesChanged,
      missingLocation,
    };
  });

  const selectedItems = items.filter((item) => selectedIds.has(item.candidate.id));
  const selected = selectedItems.map((item) => item.candidate);

  if (selected.length === 0) {
    blockers.push('请至少勾选一个候选。');
  }

  for (const item of selectedItems) {
    for (const dependency of item.dependencies) {
      if (dependency.kind === 'candidate' && !dependency.selected) {
        blockers.push(`「${item.title}」依赖「${dependency.label}」，请同时勾选，或先取消它。`);
      }
      if (dependency.kind === 'unknown') {
        blockers.push(`「${item.title}」依赖 ${dependency.id}，但草稿和本次候选里都没有这个对象，请重新生成。`);
      }
    }
    if (item.missingLocation) {
      blockers.push(
        `人物「${item.missingLocation.name}」的地点 ${item.missingLocation.id} 不在草稿或已选地点中，不能回退到其他地点。`,
      );
    }
    const missingSources = item.sources.filter((source) => source.missing);
    if (missingSources.length > 0) {
      blockers.push(`「${item.targetLabel}」引用了已不存在的来源 ${missingSources
        .map((source) => source.id)
        .join('、')}，请补回来源或重新生成。`);
    }
    if (item.needsConfirmation && !item.confirmed && missingSources.length === 0) {
      blockers.push(item.changedSinceRequest
        ? `「${item.targetLabel}」在请求后已被修改，请勾选“已核对”后再采纳。`
        : `「${item.targetLabel}」引用的来源内容在请求后已变化，请重新核对后再采纳。`);
    }
  }

  if (blockers.length === 0 && selected.length > 0) {
    const validation = validateSelection(draft, selected);
    if (!validation.ok) blockers.push(...validation.errors);
  }

  const changedCount = selectedItems.filter((item) => item.needsConfirmation).length;
  const sourcesChangedCount = selectedItems.filter((item) => item.sourcesChanged).length;

  return {
    items,
    selected,
    selectedCount: selected.length,
    blockers: [...new Set(blockers)],
    canApply: selected.length > 0 && blockers.length === 0,
    stale: input.responseFingerprint !== input.currentFingerprint,
    changedCount,
    sourcesChangedCount,
  };
}

export interface WorldAiRun {
  response: WorldSuggestionResponse;
  scope: WorldAiScope;
  instruction: string;
  baseDraft: WorldAuthoringDraft;
}

export interface WorldAiToggleResult {
  selectedIds: string[];
  /** 用户显式勾选的候选。 */
  manualIds: string[];
  /** 用户显式取消的候选。 */
  excludedIds: string[];
  /** 当前因为别人依赖而被自动带上的候选（只含未显式勾选者）。 */
  autoAddedIds: string[];
  /** 取消依赖后仍依赖它、因而会阻止采纳的候选。 */
  blockedDependents: string[];
}

/**
 * 勾选/取消候选时的依赖处理。选中集合始终由“显式勾选 + 仍被需要的依赖闭包”推导，
 * 因此取消主候选后，只为它自动带上的依赖会一起退出；用户自己勾过的依赖保留。
 * 手动取消一个仍被依赖的候选时不做隐式连带取消，而是把它留给采纳校验阻断。
 */
export function resolveWorldAiSelection(
  candidates: WorldSuggestionCandidate[],
  manualIds: readonly string[],
  excludedIds: readonly string[],
): WorldAiToggleResult {
  const candidatesById = new Map(candidates.map((item) => [item.id, item]));
  const excluded = new Set(excludedIds);
  const selected = new Set(manualIds.filter((id) => !excluded.has(id)));
  const closure = new Set<string>();
  const addDependencies = (id: string) => {
    const item = candidatesById.get(id);
    if (!item) return;
    for (const dependency of item.dependsOn) {
      if (!candidatesById.has(dependency) || selected.has(dependency)) continue;
      if (excluded.has(dependency)) continue;
      selected.add(dependency);
      closure.add(dependency);
      addDependencies(dependency);
    }
  };
  for (const id of selected) addDependencies(id);

  return {
    selectedIds: [...selected],
    manualIds: [...manualIds],
    excludedIds: [...excludedIds],
    autoAddedIds: [...closure],
    blockedDependents: candidates
      .filter((item) => selected.has(item.id) && item.dependsOn.some((id) => excluded.has(id)))
      .map((item) => item.id),
  };
}

export function toggleWorldAiSelection(
  candidates: WorldSuggestionCandidate[],
  manualIds: readonly string[],
  excludedIds: readonly string[],
  candidate: WorldSuggestionCandidate,
  checked: boolean,
): WorldAiToggleResult {
  const nextManual = new Set(manualIds);
  const nextExcluded = new Set(excludedIds);
  if (checked) {
    nextManual.add(candidate.id);
    nextExcluded.delete(candidate.id);
  } else {
    nextManual.delete(candidate.id);
    nextExcluded.add(candidate.id);
  }
  return resolveWorldAiSelection(candidates, [...nextManual], [...nextExcluded]);
}

export interface WorldAiPanelViewProps {
  scope: WorldAiScope | '';
  instruction: string;
  onScopeChange: (value: string) => void;
  onInstructionChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  formError: string | null;
  requestError: string | null;
  canRetry: boolean;
  onRetry: () => void;
  run: WorldAiRun | null;
  review: WorldAiReview;
  staleNotice?: string | null;
  autoDependencyIds: readonly string[];
  manualIds: readonly string[];
  dependencyNotice: string | null;
  actionError: string | null;
  appliedCount: number | null;
  onToggle: (candidate: WorldSuggestionCandidate, checked: boolean) => void;
  onConfirm: (candidate: WorldSuggestionCandidate, checked: boolean) => void;
  onApply: () => void;
  onUndo: () => void;
  canUndo: boolean;
}

export function WorldAiPanelView({
  scope,
  instruction,
  onScopeChange,
  onInstructionChange,
  onSubmit,
  loading,
  formError,
  requestError,
  canRetry,
  onRetry,
  run,
  review,
  staleNotice,
  autoDependencyIds,
  manualIds,
  dependencyNotice,
  actionError,
  appliedCount,
  onToggle,
  onConfirm,
  onApply,
  onUndo,
  canUndo,
}: WorldAiPanelViewProps) {
  const autoDependencies = autoDependencyIds
    .map((id) => review.items.find((item) => item.candidate.id === id))
    .filter((item): item is WorldAiCandidateView => Boolean(item));
  const requestDiffers = run
    ? run.scope !== scope || run.instruction !== instruction.trim()
    : false;
  const justApplied = appliedCount !== null && review.selectedCount === 0;

  return (
    <section aria-label="AI 候选" className="space-y-4 rounded-panel border border-border-subtle bg-surface p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
            AI 候选
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            按当前草稿和已选来源生成可逐项采纳的设定。候选默认都不选中；采纳只写入勾选项，之后仍可撤销。
            候选使用公共服务的设定建议模型（默认继承故事世界文本模型），独立于运行模型。
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onUndo} disabled={!canUndo}>
          <Undo2 className="h-4 w-4" aria-hidden="true" />
          撤销上次采纳
        </Button>
      </header>

      <div className="space-y-3">
        <FormField label="生成范围" required htmlFor="world-ai-scope">
          <Select
            id="world-ai-scope"
            value={scope}
            disabled={loading}
            onChange={(event) => onScopeChange(event.currentTarget.value)}
          >
            <option value="">请选择范围</option>
            {SCOPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </FormField>

        <FormField
          label="创作要求"
          required
          htmlFor="world-ai-instruction"
          hint="Ctrl / Cmd + Enter 生成；普通回车换行，输入法选词回车不会触发。"
        >
          <CjkTextarea
            id="world-ai-instruction"
            rows={3}
            value={instruction}
            maxLength={INSTRUCTION_MAX}
            disabled={loading}
            placeholder="例如：补全开场地点的氛围，并为两位关键人物补充目标与说话方式。"
            onChange={(event) => onInstructionChange(event.currentTarget.value)}
            onSubmitShortcut={onSubmit}
          />
        </FormField>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">{instruction.length} / {INSTRUCTION_MAX}</p>
          <div className="flex items-center gap-3">
            {loading && <Spinner size="sm" label="正在生成候选…" />}
            <Button
              type="button"
              variant="primary"
              onClick={onSubmit}
              loading={loading}
              disabled={!scope || !instruction.trim()}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              生成候选
            </Button>
          </div>
        </div>
      </div>

      {formError && (
        <Alert variant="danger" title="还差一步">
          <p>{formError}</p>
        </Alert>
      )}

      {requestError && (
        <Alert variant="danger" title="候选生成失败">
          <p>{requestError}</p>
          <p className="mt-1 text-xs leading-relaxed">
            {run
              ? '上一批候选会保留，不会被这次失败清空。确认要求后可以手动重试。'
              : '没有生成新的候选。确认要求后可以手动重试。'}
          </p>
          {canRetry && (
            <Button type="button" size="sm" variant="outline" className="mt-3" onClick={onRetry}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              重新生成
            </Button>
          )}
        </Alert>
      )}

      {appliedCount !== null && (
        <Alert variant="success" title="已采纳候选">
          <p>已写入 {appliedCount} 项候选。如果结果不对，可以用“撤销上次采纳”恢复采纳前的草稿。</p>
        </Alert>
      )}

      {run && review.stale && !justApplied && (
        <Alert variant="warning" title="候选基于旧草稿">
          <p>
            这批候选生成后草稿又发生了变化。只有“请求后已修改”的字段或来源需要逐项勾选“已核对”，确认采纳会覆盖你后来的编辑。
          </p>
        </Alert>
      )}

      {staleNotice && (
        <Alert variant="warning" title="草稿已更新">
          <p>{staleNotice}</p>
        </Alert>
      )}

      {dependencyNotice && (
        <Alert variant="warning" title="依赖已调整">
          <p>{dependencyNotice}</p>
        </Alert>
      )}

      {autoDependencies.length > 0 && (
        <Alert variant="info" title="已自动勾选依赖">
          <p>
            勾选候选时自动补选了：{autoDependencies.map((item) => item.title).join('、')}。
            这些是自动带入项，取消主候选时会一并移除；自己勾过的依赖则会保留。取消仍被依赖的项会阻止采纳并给出提示。
          </p>
        </Alert>
      )}

      {requestDiffers && run && (
        <p className="text-xs leading-relaxed text-muted">
          当前表单与这批候选的请求不同；下方候选仍按「{SCOPE_LABELS[run.scope]}」生成，重新生成才会采用新要求。
        </p>
      )}

      {run && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">候选 {run.response.candidates.length} 项</h3>
            <Badge variant="outline">范围：{SCOPE_LABELS[run.scope]}</Badge>
            {review.selectedCount > 0 && <Badge variant="accent">已选 {review.selectedCount} 项</Badge>}
          </div>

          {run.response.gaps.length > 0 && (
            <div className="rounded-control border border-warning-border bg-warning-bg/60 p-3">
              <p className="text-sm font-medium text-warning-fg">资料缺口</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink">
                {run.response.gaps.map((gap) => <li key={gap} className="break-words">{gap}</li>)}
              </ul>
            </div>
          )}

          {review.items.length === 0 ? (
            <p className="rounded-control border border-dashed border-border-default px-4 py-6 text-center text-sm text-muted">
              这次没有生成可采纳的候选。可以调整范围或创作要求后重新生成。
            </p>
          ) : (
            <ul className="space-y-2">
              {review.items.map((item) => {
                const selected = review.selected.some((candidate) => candidate.id === item.candidate.id);
                const autoSelected = selected && !manualIds.includes(item.candidate.id);
                const entityTarget = item.candidate.target === 'actor' || item.candidate.target === 'location';
                return (
                  <li
                    key={item.candidate.id}
                    className={cn(
                      'rounded-control border p-3',
                      selected ? 'border-accent/40 bg-accent/5' : 'border-border-subtle bg-surface',
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Checkbox
                        label={`采纳「${item.title}」${autoSelected ? '（依赖自动带入）' : ''}`}
                        checked={selected}
                        onChange={(event) => onToggle(item.candidate, event.currentTarget.checked)}
                      />
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Badge variant="outline">{item.targetLabel}</Badge>
                        {entityTarget && (
                          item.candidate.entityId
                            ? <Badge variant="secondary">更新现有</Badge>
                            : <Badge variant="accent">新增</Badge>
                        )}
                        {!item.changesDraft && <Badge variant="stopped">与当前一致</Badge>}
                        {autoSelected && <Badge variant="secondary">自动依赖</Badge>}
                        {item.changedSinceRequest && <Badge variant="warning">请求后已修改</Badge>}
                        {item.sourcesChanged && <Badge variant="warning">来源已变化</Badge>}
                      </div>
                    </div>

                    {item.dependencies.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>依赖：</span>
                        {item.dependencies.map((dependency) => (
                          <Badge
                            key={dependency.id}
                            variant={
                              dependency.kind === 'unknown' || (dependency.kind === 'candidate' && !dependency.selected)
                                ? 'warning'
                                : 'secondary'
                            }
                          >
                            {dependency.label}
                            {dependency.kind === 'candidate' && !dependency.selected && '（未勾选）'}
                            {dependency.kind === 'unknown' && '（缺失）'}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {item.missingLocation && (
                      <p className="mt-2 text-xs leading-relaxed text-danger-fg">
                        关联地点 {item.missingLocation.id} 不在草稿或已选地点中。系统不会回退到其他地点，请先补选对应地点。
                      </p>
                    )}

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-control border border-border-subtle bg-surface-sunken/40 px-2.5 py-2">
                        <p className="text-[11px] font-medium text-muted">当前</p>
                        <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-ink">
                          {item.before}
                        </p>
                      </div>
                      <div className="rounded-control border border-accent/30 bg-accent/5 px-2.5 py-2">
                        <p className="text-[11px] font-medium text-muted">候选</p>
                        <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-ink">
                          {item.after}
                        </p>
                      </div>
                    </div>

                    <p className="mt-2 text-xs leading-relaxed text-muted">
                      {item.note || '（没有补充说明，请结合来源核对）'}
                    </p>

                    <p className="mt-1.5 text-xs leading-relaxed text-muted">
                      来源：
                      {item.sources.length === 0
                        ? '未标注来源，请核对后采纳。'
                        : item.sources.map((source, index) => (
                          <React.Fragment key={source.id}>
                            {index > 0 && ' · '}
                            <span className={source.missing ? 'text-danger-fg' : undefined}>
                              {source.title}
                              {source.missing ? '（来源已不在草稿中）' : ''}
                              {!source.missing && source.changedSinceRequest ? '（正文或版本已变化）' : ''}
                            </span>
                          </React.Fragment>
                        ))}
                    </p>

                    {item.needsConfirmation && (
                      <div className="mt-3 rounded-control border border-warning-border bg-warning-bg/50 px-3 py-2">
                        <p className="text-xs leading-relaxed text-ink">
                          {item.changedSinceRequest
                            ? '这个字段在请求后被你改过。'
                            : '这个候选引用的来源在请求后改了内容。'}
                          {' '}确认只对你当时看到的内容有效；字段或来源再变就要重新核对。
                        </p>
                        <Checkbox
                          label="已核对：我确认用候选覆盖这段内容，并接受当前来源版本"
                          checked={item.confirmed}
                          onChange={(event) => onConfirm(item.candidate, event.currentTarget.checked)}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {run && review.blockers.length > 0 && review.selectedCount > 0 && (
        <Alert variant="warning" title="采纳前还需处理">
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {review.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
        </Alert>
      )}

      {actionError && (
        <Alert variant="danger" title="采纳未执行">
          <p>{actionError}</p>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3">
        <p className="text-xs leading-relaxed text-muted">
          {run
            ? `已选 ${review.selectedCount} 项；未勾选的字段保持原样。`
            : '先选择范围和创作要求，生成后再逐项确认。'}
        </p>
        <Button
          type="button"
          variant="primary"
          onClick={onApply}
          disabled={!run || loading || !review.canApply}
        >
          采纳所选
        </Button>
      </div>
    </section>
  );
}

function freezeDraft(draft: WorldAuthoringDraft): WorldAuthoringDraft {
  return typeof structuredClone === 'function'
    ? structuredClone(draft)
    : JSON.parse(JSON.stringify(draft)) as WorldAuthoringDraft;
}

export interface WorldAiPanelControllerOptions {
  draft: WorldAuthoringDraft;
  fingerprint: string;
  onApply: (candidates: WorldSuggestionCandidate[]) => void;
  initialRun?: WorldAiRun | null;
  initialSelection?: WorldAiPersistedSelection | null;
  onStateChange?: (state: WorldAiPersistedState | null) => void;
}

export interface WorldAiPanelController {
  scope: WorldAiScope | '';
  instruction: string;
  setScope: (value: WorldAiScope | '') => void;
  setInstruction: (value: string) => void;
  loading: boolean;
  formError: string | null;
  requestError: string | null;
  actionError: string | null;
  appliedCount: number | null;
  run: WorldAiRun | null;
  review: WorldAiReview;
  autoDependencyIds: string[];
  manualIds: string[];
  dependencyNotice: string | null;
  canRetry: boolean;
  submit: () => void;
  retry: () => void;
  toggle: (candidate: WorldSuggestionCandidate, checked: boolean) => void;
  confirmCandidate: (candidate: WorldSuggestionCandidate, checked: boolean) => void;
  apply: () => void;
}

/**
 * AI 候选面板的状态机：与渲染分离，便于在 node 环境验证勾选、依赖与持久化回调。
 * 页面通过 initialRun / onStateChange 负责把建议写进草稿信封。
 */
export function useWorldAiPanelController({
  draft,
  fingerprint,
  onApply,
  initialRun = null,
  initialSelection = null,
  onStateChange,
}: WorldAiPanelControllerOptions): WorldAiPanelController {
  const [scope, setScopeState] = useState<WorldAiScope | ''>(initialRun?.scope ?? '');
  const [instruction, setInstructionState] = useState(initialRun?.instruction ?? '');
  const [run, setRun] = useState<WorldAiRun | null>(initialRun);
  const [manualIds, setManualIds] = useState<string[]>(() => (
    initialSelection?.manualIds ?? initialSelection?.selectedIds ?? []
  ));
  const [excludedIds, setExcludedIds] = useState<string[]>(initialSelection?.excludedIds ?? []);
  const [confirmations, setConfirmations] = useState<WorldAiConfirmation[]>(() => {
    if (!initialRun || !initialSelection?.confirmations) return [];
    const byId = new Map(
      initialRun.response.candidates.map((candidate) => [candidate.id, candidate]),
    );
    return initialSelection.confirmations.filter((confirmation) => {
      const candidate = byId.get(confirmation.candidateId);
      if (!candidate) return false;
      const current = confirmationFor(draft, candidate);
      return confirmation.fieldSnapshot === current.fieldSnapshot
        && confirmation.sourceSnapshot === current.sourceSnapshot;
    });
  });
  const [dependencyNotice, setDependencyNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);
  const [lastRequest, setLastRequest] = useState<{ scope: WorldAiScope; instruction: string } | null>(null);
  const requestSeq = useRef(0);
  const mountedRef = useRef(true);
  const onStateChangeRef = useRef(onStateChange);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  const selection = useMemo(() => {
    const candidates = run?.response.candidates ?? [];
    return resolveWorldAiSelection(candidates, manualIds, excludedIds);
  }, [run, manualIds, excludedIds]);
  const selectedIds = selection.selectedIds;

  const validConfirmations = useMemo(() => {
    if (!run || confirmations.length === 0) return confirmations;
    const byId = new Map(run.response.candidates.map((candidate) => [candidate.id, candidate]));
    return confirmations.filter((confirmation) => {
      const candidate = byId.get(confirmation.candidateId);
      return candidate ? isConfirmationCurrent(draft, candidate, confirmation) : false;
    });
  }, [draft, run, confirmations]);

  useEffect(() => {
    const notify = onStateChangeRef.current;
    if (!notify) return;
    notify(run
      ? { run, selectedIds, manualIds, excludedIds, confirmations: validConfirmations }
      : null);
  }, [run, selectedIds, manualIds, excludedIds, validConfirmations]);

  const review = useMemo(
    () => reviewWorldAiCandidates({
      draft,
      candidates: run?.response.candidates ?? [],
      selectedIds,
      confirmations: validConfirmations,
      baseDraft: run?.baseDraft ?? null,
      responseFingerprint: run?.response.draftFingerprint ?? '',
      currentFingerprint: fingerprint || draftFingerprint(draft),
    }),
    [draft, fingerprint, run, selectedIds, validConfirmations],
  );

  const submit = async (nextScope: WorldAiScope | '', nextInstruction: string) => {
    if (loading) return;
    const trimmed = nextInstruction.trim();
    if (!nextScope || !trimmed) {
      setFormError('请先选择生成范围并填写创作要求。');
      return;
    }
    setFormError(null);
    setRequestError(null);
    setActionError(null);
    setAppliedCount(null);
    setDependencyNotice(null);
    setLastRequest({ scope: nextScope, instruction: trimmed });
    setLoading(true);

    const baseDraft = freezeDraft(draft);
    const baseFingerprint = fingerprint || draftFingerprint(baseDraft);
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;

    try {
      const response = await postWorldSuggestions({
        draft: baseDraft,
        instruction: trimmed,
        scope: nextScope,
        draftFingerprint: baseFingerprint,
      });
      if (!mountedRef.current || requestSeq.current !== seq) return;
      setRun({ response, scope: nextScope, instruction: trimmed, baseDraft });
      setManualIds([]);
      setExcludedIds([]);
      setConfirmations([]);
    } catch (error) {
      if (!mountedRef.current || requestSeq.current !== seq) return;
      setRequestError(error instanceof ApiClientError && [
        'world_suggestion_duplicate_id', 'world_suggestion_unresolved_dependency',
        'world_suggestion_unknown_location', 'world_suggestion_dependency_cycle',
        'world_suggestion_entity_conflict',
      ].includes(error.code ?? '')
        ? '这次建议的人物、地点或相互引用有冲突，草稿已保留。'
        : describeError(error));
    } finally {
      if (mountedRef.current && requestSeq.current === seq) setLoading(false);
    }
  };

  const retry = () => {
    if (!lastRequest) return;
    void submit(lastRequest.scope, lastRequest.instruction);
  };

  const labelOf = (candidate: WorldSuggestionCandidate) => candidateTitle(candidate);

  const toggle = (candidate: WorldSuggestionCandidate, checked: boolean) => {
    if (!run) return;
    setActionError(null);
    setAppliedCount(null);
    const before = resolveWorldAiSelection(run.response.candidates, manualIds, excludedIds);
    const result = toggleWorldAiSelection(
      run.response.candidates,
      manualIds,
      excludedIds,
      candidate,
      checked,
    );
    setManualIds(result.manualIds);
    setExcludedIds(result.excludedIds);
    setConfirmations((previous) => previous.filter(
      (confirmation) => result.selectedIds.includes(confirmation.candidateId),
    ));
    const droppedDependencies = before.selectedIds.filter(
      (id) => id !== candidate.id && !result.selectedIds.includes(id),
    );
    const labelOfId = (id: string) => {
      const found = run.response.candidates.find((item) => item.id === id);
      return found ? labelOf(found) : id;
    };
    setDependencyNotice(
      result.blockedDependents.length > 0
        ? `已取消「${labelOf(candidate)}」；「${result.blockedDependents
          .map(labelOfId)
          .join('、')}」仍依赖它，采纳已被阻止。请同时取消这些候选，或重新勾选依赖。`
        : droppedDependencies.length > 0
          ? `已取消「${labelOf(candidate)}」，同时移除了只为它自动勾选的依赖：${droppedDependencies
            .map(labelOfId)
            .join('、')}。`
          : null,
    );
  };

  const confirmCandidate = (candidate: WorldSuggestionCandidate, checked: boolean) => {
    setActionError(null);
    setConfirmations((previous) => {
      const rest = previous.filter((confirmation) => confirmation.candidateId !== candidate.id);
      return checked ? [...rest, confirmationFor(draft, candidate)] : rest;
    });
  };

  const apply = () => {
    if (!run || loading) return;
    if (!review.canApply) {
      setActionError(review.blockers[0] ?? '还有未解决的依赖或确认项，暂不能采纳。');
      return;
    }
    setActionError(null);
    const selected = orderCandidates(review.selected);
    onApply(selected);
    setAppliedCount(selected.length);
    setManualIds([]);
    setExcludedIds([]);
    setConfirmations([]);
    setDependencyNotice(null);
  };

  const setScope = useCallback((value: WorldAiScope | '') => {
    setScopeState(value);
    setFormError(null);
  }, []);

  const setInstruction = useCallback((value: string) => {
    setInstructionState(value);
    setFormError(null);
  }, []);

  return {
    scope,
    instruction,
    setScope,
    setInstruction,
    loading,
    formError,
    requestError,
    actionError,
    appliedCount,
    run,
    review,
    autoDependencyIds: selection.autoAddedIds,
    manualIds,
    dependencyNotice,
    canRetry: Boolean(lastRequest) && !loading,
    submit: () => void submit(scope, instruction),
    retry,
    toggle,
    confirmCandidate,
    apply,
  };
}

export function WorldAiPanel({
  draft,
  fingerprint,
  onApply,
  onUndo,
  canUndo,
  staleNotice,
  initialRun,
  initialSelection,
  onStateChange,
}: WorldAiPanelProps) {
  const controller = useWorldAiPanelController({
    draft,
    fingerprint,
    onApply,
    initialRun,
    initialSelection,
    onStateChange,
  });

  return (
    <WorldAiPanelView
      scope={controller.scope}
      instruction={controller.instruction}
      onScopeChange={(value) => controller.setScope(value as WorldAiScope | '')}
      onInstructionChange={controller.setInstruction}
      onSubmit={controller.submit}
      loading={controller.loading}
      formError={controller.formError}
      requestError={controller.requestError}
      canRetry={controller.canRetry}
      onRetry={controller.retry}
      run={controller.run}
      review={controller.review}
      staleNotice={staleNotice}
      autoDependencyIds={controller.autoDependencyIds}
      manualIds={controller.manualIds}
      dependencyNotice={controller.dependencyNotice}
      actionError={controller.actionError}
      appliedCount={controller.appliedCount}
      onToggle={controller.toggle}
      onConfirm={controller.confirmCandidate}
      onApply={controller.apply}
      onUndo={onUndo}
      canUndo={canUndo}
    />
  );
}
