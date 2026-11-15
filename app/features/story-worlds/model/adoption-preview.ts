import type { WorldEvent } from '@sthstart/contracts';

export const ADOPTION_TITLE_MAX = 120;
export const ADOPTION_BODY_MAX = 100_000;
export const ADOPTION_EVENT_MAX = 100;

export interface AdoptionRequestIdentity {
  projectId: string;
  eventIds: string[];
  actorId: string | null;
  title: string;
}

export interface AdoptionPerspectiveIssue {
  eventId: string;
  eventTitle: string;
  reason: string;
}

export interface AdoptionPreviewInput {
  worldId: string;
  branchId: string;
  branchRevision: number;
  actorId: string | null;
  events: WorldEvent[];
  actorNames?: Map<string, string>;
}

export interface AdoptionAttempt {
  key: string;
  fingerprint: string;
}

export interface MinuteRange {
  from: number;
  to: number;
}

function clampMinute(value: number, maxTick: number) {
  const ceiling = Math.max(0, Math.floor(maxTick));
  if (!Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? ceiling : 0;
  return Math.min(Math.max(0, Math.floor(value)), ceiling);
}

export function normalizeMinuteRange(from: number, to: number, maxTick: number): MinuteRange {
  const normalizedFrom = clampMinute(from, maxTick);
  const normalizedTo = clampMinute(to, maxTick);
  return {
    from: normalizedFrom,
    to: Math.max(normalizedFrom, normalizedTo),
  };
}

export function eventWithinRange(event: WorldEvent, range: MinuteRange) {
  return event.tick >= range.from && event.tick <= range.to;
}

export function sortedAdoptionEvents(events: WorldEvent[]) {
  return [...events].sort((left, right) =>
    left.tick === right.tick ? left.id.localeCompare(right.id) : left.tick - right.tick);
}

export function adoptionTitleError(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return '采纳标题不能为空。';
  if (trimmed.length > ADOPTION_TITLE_MAX) {
    return `采纳标题不能超过 ${ADOPTION_TITLE_MAX} 个字符（当前 ${trimmed.length} 个）。请缩短标题后重试。`;
  }
  return null;
}

export function defaultAdoptionTitle(worldTitle: string, branchTitle: string) {
  const combined = `${worldTitle} · ${branchTitle}`;
  return combined.length <= ADOPTION_TITLE_MAX ? combined : branchTitle;
}

export function adoptionBodyError(bodyLength: number): string | null {
  if (bodyLength <= ADOPTION_BODY_MAX) return null;
  return `采纳正文共 ${bodyLength} 个字符，超过单章 ${ADOPTION_BODY_MAX} 字符上限。请减少所选事件或缩短事件正文后重试。`;
}

export function adoptionRequestFingerprint(input: AdoptionRequestIdentity) {
  return JSON.stringify({
    projectId: input.projectId,
    eventIds: [...new Set(input.eventIds)].sort(),
    actorId: input.actorId,
    title: input.title.trim(),
  });
}

export function nextAdoptionAttempt(
  previous: AdoptionAttempt | null,
  fingerprint: string,
  createKey: () => string,
): AdoptionAttempt {
  if (previous && previous.fingerprint === fingerprint) return previous;
  return { key: createKey(), fingerprint };
}

export function adoptionPerspectiveIssues(
  events: WorldEvent[],
  actorId: string | null,
  actorNames?: Map<string, string>,
): AdoptionPerspectiveIssue[] {
  if (!actorId) return [];
  const actorName = actorNames?.get(actorId) ?? actorId;
  const issues: AdoptionPerspectiveIssue[] = [];
  for (const event of events) {
    if (!event.participantIds.includes(actorId)) {
      issues.push({
        eventId: event.id,
        eventTitle: event.title,
        reason: `角色“${actorName}”未参与该事件。`,
      });
      continue;
    }
    const perspective = event.perspectives.find((item) => item.actorId === actorId);
    if (!perspective?.text.trim()) {
      issues.push({
        eventId: event.id,
        eventTitle: event.title,
        reason: `角色“${actorName}”缺少该事件的个人视角正文。`,
      });
    }
  }
  return issues;
}

export function composeAdoptionChapterBody(input: AdoptionPreviewInput) {
  const actorNames = input.actorNames ?? new Map<string, string>();
  const sections = sortedAdoptionEvents(input.events).map((event) => {
    if (input.actorId) {
      const perspective = event.perspectives.find((item) => item.actorId === input.actorId);
      return `### ${event.title}\n\n${perspective?.text.trim() ?? ''}`;
    }
    const views = event.perspectives.map((perspective) => {
      const actorName = actorNames.get(perspective.actorId) ?? perspective.actorId;
      return `> **${actorName}**：${perspective.text}`;
    });
    const narrative = views.length > 0
      ? `${event.summary}\n\n${views.join('\n\n')}`
      : event.summary;
    return `### ${event.title}\n\n${narrative}`;
  });
  return [
    `<!-- 采纳自故事世界：世界ID=${input.worldId} 分支ID=${input.branchId} 基准版本=${input.branchRevision} 视角=${input.actorId || '导演视角'} -->`,
    ...sections,
  ].join('\n\n');
}

export function toggleAdoptionEvent(
  eventIds: string[],
  eventId: string,
  maxSelected = ADOPTION_EVENT_MAX,
) {
  if (eventIds.includes(eventId)) {
    return { ids: eventIds.filter((id) => id !== eventId), limitReached: false };
  }
  if (eventIds.length >= maxSelected) {
    return { ids: eventIds, limitReached: true };
  }
  return { ids: [...eventIds, eventId], limitReached: false };
}

export interface AdoptionSelectionReview {
  titleError: string | null;
  bodyLength: number;
  bodyError: string | null;
  perspectiveIssues: AdoptionPerspectiveIssue[];
  selectedCount: number;
  ready: boolean;
}

export function reviewAdoptionSelection(input: {
  title: string;
  worldId: string;
  branchId: string;
  branchRevision: number;
  actorId: string | null;
  events: WorldEvent[];
  actorNames?: Map<string, string>;
}): AdoptionSelectionReview {
  const titleError = adoptionTitleError(input.title);
  const perspectiveIssues = adoptionPerspectiveIssues(input.events, input.actorId, input.actorNames);
  const bodyLength = input.events.length > 0
    ? composeAdoptionChapterBody({
        worldId: input.worldId,
        branchId: input.branchId,
        branchRevision: input.branchRevision,
        actorId: input.actorId,
        events: input.events,
        actorNames: input.actorNames,
      }).length
    : 0;
  const bodyError = adoptionBodyError(bodyLength);
  return {
    titleError,
    bodyLength,
    bodyError,
    perspectiveIssues,
    selectedCount: input.events.length,
    ready: input.events.length > 0
      && !titleError
      && !bodyError
      && perspectiveIssues.length === 0,
  };
}
