import { Value } from '@sinclair/typebox/value';
import type { ComicDocument, ContentDocument } from '@sthstart/contracts';
import { ComicDocumentSchema } from '@sthstart/contracts';

export class ComicDocumentValidationError extends Error {
  readonly code = 'comic_invalid_document';
  readonly statusCode = 400;

  constructor(readonly issues: string[]) {
    super(`漫画文档无效：${issues.join('；')}`);
    this.name = 'ComicDocumentValidationError';
  }
}

const expectedPanelCount = { single: 1, duo: 2, trio: 3, quad: 4 } as const;

function effectiveScenes(document: ContentDocument) {
  const result = new Map<string, { stageId: string; beatIds: Set<string> }>();
  for (const stage of document.stages) {
    for (const scene of stage.scenes ?? []) {
      result.set(scene.id, { stageId: scene.stageId ?? stage.id, beatIds: new Set(scene.beats.map((beat) => beat.id)) });
    }
  }
  for (const scene of document.scenes ?? []) {
    if (!scene.stageId) continue;
    const previous = result.get(scene.id);
    const beatIds = new Set(scene.beats.map((beat) => beat.id));
    if (previous) for (const beatId of previous.beatIds) beatIds.add(beatId);
    result.set(scene.id, { stageId: scene.stageId, beatIds });
  }
  return result;
}

function duplicateIds(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

/** Validate both the TypeBox shape and cross references inside the frozen activity revision. */
export function validateComicDocument(raw: unknown, source?: ContentDocument): asserts raw is ComicDocument {
  const issues: string[] = [];
  if (!Value.Check(ComicDocumentSchema, raw)) {
    for (const error of Value.Errors(ComicDocumentSchema, raw)) issues.push(`${error.path || '/'}: ${error.message}`);
    throw new ComicDocumentValidationError(issues);
  }

  const document = raw as ComicDocument;
  const pageIds = document.pages.map((page) => page.id);
  const panelIds = document.panels.map((panel) => panel.id);
  if (duplicateIds(pageIds).length) issues.push(`页面 ID 重复：${duplicateIds(pageIds).join(', ')}`);
  if (duplicateIds(panelIds).length) issues.push(`画格 ID 重复：${duplicateIds(panelIds).join(', ')}`);
  const bubbleDuplicates = duplicateIds(document.panels.flatMap((panel) => panel.bubbles.map((bubble) => bubble.id)));
  if (bubbleDuplicates.length) issues.push(`气泡 ID 重复（整份漫画）：${bubbleDuplicates.join(', ')}`);

  const panelsById = new Map(document.panels.map((panel) => [panel.id, panel]));
  const pagePanelOccurrences = new Map<string, number>();
  for (const page of document.pages) {
    if (page.panelIds.length !== expectedPanelCount[page.template]) {
      issues.push(`页面 ${page.id} 的 ${page.template} 模板需要 ${expectedPanelCount[page.template]} 格，实际 ${page.panelIds.length} 格`);
    }
    for (const panelId of page.panelIds) {
      if (!panelsById.has(panelId)) issues.push(`页面 ${page.id} 引用了不存在的画格 ${panelId}`);
      pagePanelOccurrences.set(panelId, (pagePanelOccurrences.get(panelId) ?? 0) + 1);
    }
  }
  for (const panel of document.panels) {
    const count = pagePanelOccurrences.get(panel.id) ?? 0;
    if (count !== 1) issues.push(`画格 ${panel.id} 必须恰好属于一个页面，实际 ${count} 个`);
    for (const bubble of panel.bubbles) {
      const { x, y, width, height } = bubble.rect;
      if (x < 0 || y < 0 || x + width > 1 || y + height > 1) issues.push(`画格 ${panel.id} 的气泡 ${bubble.id} 超出画格范围`);
    }
  }

  if (source) {
    const stageIds = new Set(source.stages.map((stage) => stage.id));
    const actorIds = new Set(source.actors.map((actor) => actor.id));
    const scenes = effectiveScenes(source);
    for (const panel of document.panels) {
      if (!stageIds.has(panel.source.stageId)) {
        issues.push(`画格 ${panel.id} 来源阶段不存在：${panel.source.stageId}`);
        continue;
      }
      const scene = scenes.get(panel.source.sceneId);
      if (!scene || scene.stageId !== panel.source.stageId) {
        issues.push(`画格 ${panel.id} 来源场次不属于阶段 ${panel.source.stageId}：${panel.source.sceneId}`);
      } else {
        for (const beatId of panel.source.beatIds) {
          if (!scene.beatIds.has(beatId)) issues.push(`画格 ${panel.id} 来源镜头不存在：${beatId}`);
        }
      }
      for (const actorId of panel.actorIds) {
        if (!actorIds.has(actorId)) issues.push(`画格 ${panel.id} 引用了不存在的角色：${actorId}`);
      }
      for (const bubble of panel.bubbles) {
        if (bubble.speakerActorId && !actorIds.has(bubble.speakerActorId)) {
          issues.push(`画格 ${panel.id} 的气泡 ${bubble.id} 引用了不存在的说话人：${bubble.speakerActorId}`);
        }
        if (bubble.speakerActorId && !panel.actorIds.includes(bubble.speakerActorId)) {
          issues.push(`画格 ${panel.id} 的气泡 ${bubble.id} 说话人未出现在画格角色列表中`);
        }
      }
    }
  }

  if (issues.length) throw new ComicDocumentValidationError(issues);
}
