import type { WorldActor, WorldActorState, WorldBranch, WorldDefinition, WorldEvent, WorldMemory } from '@sthstart/contracts';

export interface WorldPersonalContext {
  actor: WorldActor; state: WorldActorState; tick: number;
  /** Numerical clock only: never expose free-form time labels to an actor. */
  clock?: { day: number; minuteOfDay: number };
  locations: WorldDefinition['locations']; nearbyActors: Array<Pick<WorldActor, 'id' | 'name' | 'appearance'>>;
  facts: Array<{ id: string; eventId: string; tick: number; content: string }>;
  memories: WorldMemory[];
  /** Subjective interpretations, explicitly separate from objective knowledge. */
  beliefs: Array<WorldMemory & { evidenceFactIds: string[] }>;
}
const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+|[㐀-鿿]/gu) ?? []);
export function rankWorldMemories(memories: WorldMemory[], query: string, tick: number, limit = 20): WorldMemory[] {
  const q = tokens(query);
  const score = (m: WorldMemory) => {
    const terms = tokens(m.content);
    const overlap = [...q].filter((t) => terms.has(t)).length / Math.max(1, Math.sqrt(q.size * terms.size));
    return overlap + Math.max(0, Math.min(1, m.importance)) + Math.pow(0.5, Math.max(0, tick - m.learnedAt) / 1440);
  };
  return memories.filter((m) => m.learnedAt <= tick).map((m) => ({ m, score: score(m) }))
    .sort((a, b) => b.score - a.score || b.m.learnedAt - a.m.learnedAt || a.m.id.localeCompare(b.m.id))
    .slice(0, limit).map(({ m }) => structuredClone(m));
}

/** Never send omniscient summaries, source snapshots, other actors' goals, or
 * event prose to an actor. A memory is not authorization to read an entire event. */
export function buildWorldPersonalContext(input: {
  worldId: string; branch: WorldBranch; definition: WorldDefinition; actorId: string;
  states: WorldActorState[]; events: WorldEvent[]; memories: WorldMemory[]; tick: number;
}): WorldPersonalContext {
  const { worldId, branch, definition, actorId, tick } = input;
  const actor = definition.actors.find((a) => a.id === actorId);
  const state = input.states.find((s) => s.actorId === actorId && s.updatedTick <= tick);
  if (!actor || !state) throw new Error(`story_actor_context_missing: ${actorId}`);
  const events = input.events.filter((e) => e.worldId === worldId && e.branchId === branch.id && e.tick + e.duration <= tick);
  const byId = new Map(events.map((e) => [e.id, e]));
  const memories = input.memories.filter((m) => m.worldId === worldId && m.branchId === branch.id && m.learnedAt <= tick && byId.has(m.sourceEventId));
  const knows = (id: string, event: WorldEvent, content: string, at: number, seen = new Set<string>()): boolean => {
    const key = `${id}:${event.id}:${content}`;
    if (seen.has(key) || event.tick + event.duration > at) return false;
    const nextSeen = new Set(seen).add(key);
    if (event.participantIds.includes(id) && event.facts.some((f) => f.content === content && f.knownBy.includes(id))) return true;
    return memories.some((m) => m.actorId === id && m.sourceEventId === event.id && m.content === content && m.learnedAt <= at
      && m.kind === 'heard' && m.fromActorId !== null && m.fromActorId !== id
      && events.some((meeting) => meeting.tick >= event.tick + event.duration && meeting.tick + meeting.duration <= m.learnedAt
        && meeting.participantIds.includes(id) && meeting.participantIds.includes(m.fromActorId!)
        && meeting.facts.some((f) => f.content === content && f.knownBy.includes(id) && f.knownBy.includes(m.fromActorId!)))
      && knows(m.fromActorId, event, content, m.learnedAt, nextSeen));
  };
  const normalize = (text: string) => text.toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
  const safeText = (content: string, at: number) => {
    const text = normalize(content);
    return !input.events.some((event) => event.facts.some((fact) => {
      const secret = normalize(fact.content);
      if (secret.length < 4 || !text.includes(secret)) return false;
      // A later report may repeat an already-known source fact word for word.
      // Knowledge comes exclusively from the earlier, in-branch source, never
      // from the later duplicate that this leak check is currently examining.
      const alreadyKnown = events.some((prior) => prior.tick + prior.duration <= at
        && prior.facts.some((known) => known.content === fact.content && knows(actorId, prior, known.content, at)));
      return !alreadyKnown
        && (event.worldId !== worldId || event.branchId !== branch.id || event.tick + event.duration > at || !knows(actorId, event, fact.content, at));
    }));
  };
  const safeMemories = memories.filter((m) => m.actorId === actorId && (m.kind === 'experienced' || m.kind === 'heard') && byId.get(m.sourceEventId)!.facts.some((f) => f.content === m.content)
    && knows(actorId, byId.get(m.sourceEventId)!, m.content, m.learnedAt) && safeText(m.content, m.learnedAt));
  const beliefs = memories.filter((m) => m.actorId === actorId && (m.kind === 'inferred' || m.kind === 'mistaken'))
    .map((m) => ({ ...m, evidenceFactIds: byId.get(m.sourceEventId)!.facts.filter((f) => knows(actorId, byId.get(m.sourceEventId)!, f.content, m.learnedAt)).map((f) => f.id) }))
    .filter((m) => m.evidenceFactIds.length > 0 && safeText(m.content, m.learnedAt));
  const facts = events.flatMap((e) => e.facts.filter((f) => knows(actorId, e, f.content, tick))
    .map((f) => ({ id: f.id, eventId: e.id, tick: e.tick, content: f.content })));
  const nearby = new Set(input.states.filter((s) => s.updatedTick <= tick && s.locationId === state.locationId).map((s) => s.actorId));
  const safeState = structuredClone(state);
  safeState.relationships = safeState.relationships.filter((r) => !r.sourceEventId || facts.some((f) => f.eventId === r.sourceEventId));
  return { actor: structuredClone(actor), state: safeState, tick,
    ...(Number.isInteger(definition.startMinuteOfDay) && definition.startMinuteOfDay! >= 0 && definition.startMinuteOfDay! < 1440
      ? { clock: { day: Math.floor((definition.startMinuteOfDay! + tick) / 1440), minuteOfDay: (definition.startMinuteOfDay! + tick) % 1440 } } : {}),
    locations: definition.locations.map((l) => ({ id: l.id, name: l.name, description: '' })),
    nearbyActors: definition.actors.filter((a) => a.id !== actorId && nearby.has(a.id)).map(({ id, name, appearance }) => ({ id, name, appearance })),
    facts, memories: rankWorldMemories(safeMemories, [...state.goals, ...actor.goals].join(' '), tick),
    beliefs: rankWorldMemories(beliefs, [...state.goals, ...actor.goals].join(' '), tick).map((m) => beliefs.find((b) => b.id === m.id)!) };
}
