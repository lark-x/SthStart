import { KNOWLEDGE_MAX_REFERENCES } from '@sthstart/contracts';
import type {
  PlanningKnowledgeReference,
  PlanningKnowledgeSnapshot,
  PlanningReferenceSelection,
} from '@sthstart/contracts';
import type { ReferenceDraft } from './types';

export function referenceFromFrozen(reference: PlanningKnowledgeReference): ReferenceDraft {
  return {
    key: reference.sourceKind + ':' + reference.sourceId,
    sourceKind: reference.sourceKind,
    sourceId: reference.sourceId,
    usage: reference.usage,
    title: reference.title,
    excerpt: reference.excerpt,
    nature: reference.nature,
    authorship: reference.authorship,
    frozenReference: reference,
  };
}

export function referenceFromSelection(
  selection: PlanningReferenceSelection,
  snapshot?: PlanningKnowledgeSnapshot,
): ReferenceDraft {
  const frozen = selection.frozenReference ?? snapshot?.references.find(
    (reference) => reference.sourceKind === selection.sourceKind && reference.sourceId === selection.sourceId,
  );
  return {
    key: selection.sourceKind + ':' + selection.sourceId,
    sourceKind: selection.sourceKind,
    sourceId: selection.sourceId,
    usage: selection.usage,
    title: frozen?.title ?? '已选资料',
    excerpt: selection.excerptOverride ?? frozen?.excerpt ?? '',
    nature: frozen?.nature,
    authorship: frozen?.authorship,
    pinnedExcerpt: selection.excerptOverride,
    frozenReference: frozen,
  };
}

/** 同一来源只保留一条，顺序按首次加入，遵守知识引用上限。 */
export function appendReferences(current: ReferenceDraft[], additions: ReferenceDraft[]): ReferenceDraft[] {
  const next = [...current];
  for (const item of additions) {
    if (next.some((entry) => entry.key === item.key)) continue;
    next.push(item);
  }
  return next.slice(0, KNOWLEDGE_MAX_REFERENCES);
}

export function parseReferenceSelections(raw: string | null): PlanningReferenceSelection[] {
  if (!raw) return [];
  const selections: PlanningReferenceSelection[] = [];
  for (const entry of raw.split(',')) {
    const [kind, id] = entry.split(':');
    if (!id) continue;
    if (kind === 'collection' || kind === 'note' || kind === 'narrative' || kind === 'topic') {
      selections.push({ sourceKind: kind, sourceId: id, usage: 'background' });
    }
  }
  return selections;
}

export function toReferenceSelections(references: ReferenceDraft[]) {
  return references.map((item) => ({
    sourceKind: item.sourceKind,
    sourceId: item.sourceId,
    usage: item.usage,
    ...(item.pinnedExcerpt ? { excerptOverride: item.pinnedExcerpt } : {}),
    ...(item.frozenReference ? { frozenReference: item.frozenReference } : {}),
  }));
}
