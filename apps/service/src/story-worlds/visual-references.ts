import type { WorldDefinition, WorldEvent, WorldVisualReference } from '@sthstart/contracts';

/**
 * 画面参考匹配的纯函数集合。
 *
 * 设计要点：
 * - 只做「这段画面该出现哪些参考」的筛选，不把描述写入事件事实、角色记忆或来源资料。
 * - 场景锚点只匹配事件所在地点；道具只在该地点限定或事件文本明确提及时出现，避免把
 *   世界里的全部道具都塞进每一幅画面。
 * - 参考素材顺序固定为：场景锚点、道具、人物外观。当前云端多图路径实际只发送首张，
 *   因此上游调用方据此顺序保证物理连续性的优先项。
 */

export type VisualReferenceMatchReason = 'scene' | 'prop-location' | 'prop-mention';

export interface MatchedVisualReference {
  reference: WorldVisualReference;
  reason: VisualReferenceMatchReason;
}

export interface EventVisualReferenceSummary {
  matches: MatchedVisualReference[];
  sceneCount: number;
  propCount: number;
  /** 仅参考设定自身的素材，尚未合并人物外观素材。 */
  artifactIds: string[];
  promptSection: string;
}

function compact(value: string): string {
  return value.replace(/\s+/g, '');
}

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[。！？.!?]$/.test(trimmed) ? trimmed : `${trimmed}。`;
}

function dedupeIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function referenceArtifactIds(reference: WorldVisualReference): string[] {
  return dedupeIds(reference.referenceArtifactIds ?? []);
}

/** 事件文本用于判断道具是否被明确提及；标题、摘要与事实都会参与。 */
export function eventVisualText(
  event: Pick<WorldEvent, 'title' | 'summary' | 'facts'>,
): string {
  return compact([
    event.title ?? '',
    event.summary ?? '',
    ...(event.facts ?? []).map((fact) => fact.content ?? ''),
  ].join('\n'));
}

function isMentioned(reference: WorldVisualReference, eventText: string): boolean {
  const name = compact(reference.name ?? '');
  // 过短的名称（如单字）容易误匹配，只接受至少两个字符的明确提及。
  return name.length >= 2 && eventText.includes(name);
}

/**
 * 匹配事件对应的画面参考。
 * 同名/同 ID 的重复定义只保留第一条，保持定义顺序稳定。
 */
export function matchVisualReferences(
  definition: Pick<WorldDefinition, 'visualReferences'>,
  event: Pick<WorldEvent, 'locationId' | 'title' | 'summary' | 'facts'>,
): MatchedVisualReference[] {
  const references = definition.visualReferences ?? [];
  const eventText = eventVisualText(event);
  const seen = new Set<string>();
  const matches: MatchedVisualReference[] = [];

  for (const reference of references) {
    if (seen.has(reference.id)) continue;

    if (reference.kind === 'location') {
      const targetLocationId = reference.locationId ?? reference.id;
      if (targetLocationId !== event.locationId) continue;
      matches.push({ reference, reason: 'scene' });
      seen.add(reference.id);
      continue;
    }

    if (reference.locationId && reference.locationId === event.locationId) {
      matches.push({ reference, reason: 'prop-location' });
      seen.add(reference.id);
      continue;
    }

    if (isMentioned(reference, eventText)) {
      matches.push({ reference, reason: 'prop-mention' });
      seen.add(reference.id);
    }
  }

  return matches;
}

/**
 * 合并参考素材 ID：场景锚点优先，其次道具，最后人物外观。
 * 调用方（云端/ComfyUI 首图绑定）直接取第一个 ID。
 */
export function composeReferenceArtifactIds(
  matches: readonly MatchedVisualReference[],
  actorArtifactIds: readonly string[],
): string[] {
  const scene = matches
    .filter((match) => match.reference.kind === 'location')
    .flatMap((match) => referenceArtifactIds(match.reference));
  const props = matches
    .filter((match) => match.reference.kind === 'prop')
    .flatMap((match) => referenceArtifactIds(match.reference));
  return dedupeIds([...scene, ...props, ...actorArtifactIds]);
}

function describeMatch(match: MatchedVisualReference, eventLocationId: string): string {
  const { reference, reason } = match;
  const label = reference.kind === 'location' ? '场景锚点' : '道具参考';
  const scopedElsewhere = reason === 'prop-mention'
    && reference.locationId !== undefined
    && reference.locationId !== eventLocationId;
  const mentionNote = scopedElsewhere ? '（事件明确提及）' : '';
  const description = sentence(reference.description ?? '');
  return `${label}「${reference.name}」${mentionNote}${description ? `：${description}` : ''}`;
}

/**
 * 汇总提示词片段与参考素材。
 * 文案明确标注「仅画面设定」，避免模型把视觉备注当成事件新增事实。
 */
export function summarizeEventVisualReferences(
  definition: Pick<WorldDefinition, 'visualReferences'>,
  event: Pick<WorldEvent, 'locationId' | 'title' | 'summary' | 'facts'>,
): EventVisualReferenceSummary {
  const matches = matchVisualReferences(definition, event);
  const matchesByKind = [
    ...matches.filter((match) => match.reference.kind === 'location'),
    ...matches.filter((match) => match.reference.kind === 'prop'),
  ];
  const promptSection = matchesByKind.length
    ? `【固定场景与道具参考（仅用于画面一致性，不代表本次事件新增事实或设定）】${
      matchesByKind.map((match) => describeMatch(match, event.locationId)).join(' ')
    }`
    : '';

  return {
    matches,
    sceneCount: matches.filter((match) => match.reference.kind === 'location').length,
    propCount: matches.filter((match) => match.reference.kind === 'prop').length,
    artifactIds: dedupeIds(matchesByKind.flatMap((match) => referenceArtifactIds(match.reference))),
    promptSection,
  };
}
